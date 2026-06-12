const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const os = require('os');

let mainWindow;
const RECYCLE_BIN_BASE = path.join(app.getPath('userData'), 'RecycleBin');
const META_FILE = path.join(RECYCLE_BIN_BASE, 'meta.json');

function getBinDirForDrive(filePath) {
  // Put bin folder on same drive as the file so rename is instant
  const root = path.parse(filePath).root; // e.g. "E:\"
  const binDir = path.join(root, '.nebula-bin');
  if (!fs.existsSync(binDir)) fs.mkdirSync(binDir, { recursive: true });
  return binDir;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    frame: false,
    backgroundColor: '#0a0a1a',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    icon: path.join(__dirname, 'assets', 'icon.png'),
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

app.whenReady().then(() => {
  if (!fs.existsSync(RECYCLE_BIN_BASE)) fs.mkdirSync(RECYCLE_BIN_BASE, { recursive: true });
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

// Window controls
ipcMain.on('window-minimize', () => mainWindow.minimize());
ipcMain.on('window-maximize', () => mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize());
ipcMain.on('window-close', () => mainWindow.close());

// Select directory
ipcMain.handle('select-directory', async () => {
  const result = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'] });
  return result.canceled ? null : result.filePaths[0];
});

function hashFile(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('md5');
    const stream = fs.createReadStream(filePath);
    stream.on('data', d => hash.update(d));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

const JUNK_PATTERNS = [
  /\.tmp$/i, /\.temp$/i, /\.log$/i, /\.bak$/i, /\.old$/i,
  /\.cache$/i, /~$/, /\.DS_Store$/i, /Thumbs\.db$/i,
  /desktop\.ini$/i, /\.crdownload$/i, /\.part$/i
];

function isJunk(filename) {
  return JUNK_PATTERNS.some(p => p.test(filename));
}

// Folders never scanned — system critical or app internals
const EXCLUDED_DIR_NAMES = new Set([
  // Windows system
  'windows', 'system32', 'syswow64', 'winsxs', 'boot', 'recovery',
  'system volume information', '$recycle.bin', '$windows.~bt', '$windows.~ws',
  'programdata', 'program files', 'program files (x86)',
  // Adobe / app temp
  'adobetemp', 'adobe temp', 'temp', 'tmp',
  // App data / runtime
  'appdata', 'application data', 'node_modules', '.git',
  // Nebula internal
  '.nebula-bin',
]);

// Paths at root of C:\ that Windows locks — never touch these
const PROTECTED_ROOT_FILES = new Set([
  'csb.log', 'dumpstack.log', 'dumpstack.log.tmp', 'install.log',
  'hiberfil.sys', 'pagefile.sys', 'swapfile.sys',
]);

// File extensions never safe to delete
const PROTECTED_EXTENSIONS = new Set([
  '.exe', '.dll', '.sys', '.msi', '.inf', '.cat', '.drv',
  '.ocx', '.scr', '.com', '.bat', '.cmd', '.ps1',
  '.reg', '.lnk', '.url', '.pif',
]);

function isExcluded(fullPath) {
  if (fullPath.toLowerCase().startsWith(RECYCLE_BIN_BASE.toLowerCase())) return true;
  const name = path.basename(fullPath).toLowerCase();
  return EXCLUDED_DIR_NAMES.has(name);
}

function isSafeToShow(file) {
  const ext = path.extname(file.name).toLowerCase();
  if (PROTECTED_EXTENSIONS.has(ext)) return false;
  // Block .bak of executables (e.g. Adobe Crash Processor.exe.bak)
  if (file.name.toLowerCase().match(/\.(exe|dll|sys)\.bak$/i)) return false;
  // Block locked root-level Windows files
  const root = path.parse(file.path).root;
  const dir = path.dirname(file.path);
  if (dir.toLowerCase() === root.toLowerCase().replace(/\\$/, '') &&
      PROTECTED_ROOT_FILES.has(file.name.toLowerCase())) return false;
  // Block files directly in C:\ root that start with known patterns
  if (dir.toLowerCase() === root.toLowerCase().replace(/\\$/, '') &&
      file.name.match(/^(DUMP|WRP|hiberfil|pagefile|swapfile)/i)) return false;
  return true;
}

async function walkDir(dir, files = [], depth = 0) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return files; }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      if (isExcluded(full)) continue;
      // Yield to event loop every directory to keep UI responsive
      await new Promise(r => setImmediate(r));
      await walkDir(full, files, depth + 1);
    } else if (entry.isFile()) {
      try {
        const stat = fs.statSync(full);
        files.push({ path: full, name: entry.name, size: stat.size, mtime: stat.mtime.toISOString() });
      } catch {}
    }
  }
  return files;
}

// Throttled copy — gentle pace to keep system responsive
const COPY_CHUNK = 64 * 1024; // 64 KB chunks
const COPY_DELAY = 20;         // 20ms pause between chunks (~3 MB/s max)

async function throttledCopy(src, dest) {
  const fdr = fs.openSync(src, 'r');
  const fdw = fs.openSync(dest, 'w');
  const buf = Buffer.allocUnsafe(COPY_CHUNK);
  let bytesRead;
  try {
    while ((bytesRead = fs.readSync(fdr, buf, 0, COPY_CHUNK, null)) > 0) {
      fs.writeSync(fdw, buf, 0, bytesRead);
      await new Promise(r => setTimeout(r, COPY_DELAY));
    }
  } finally {
    fs.closeSync(fdr);
    fs.closeSync(fdw);
  }
}

async function moveFile(src, dest) {
  try {
    fs.renameSync(src, dest);
  } catch (e) {
    if (e.code === 'EXDEV') {
      await throttledCopy(src, dest);
      try {
        fs.unlinkSync(src);
      } catch (unlinkErr) {
        try { fs.unlinkSync(dest); } catch {}
        throw new Error(`Copied but could not delete original: [${unlinkErr.code}] ${unlinkErr.message}`);
      }
    } else {
      throw e;
    }
  }
}

// Strip trailing number/copy suffix: "file (2).jpg" -> "file.jpg", "file - Copy.jpg" -> "file.jpg"
function baseName(name) {
  const ext = path.extname(name);
  const stem = path.basename(name, ext);
  return stem
    .replace(/\s*\(\d+\)\s*$/, '')
    .replace(/\s*-\s*copy(\s*\(\d+\))?\s*$/i, '')
    .replace(/\s*\d+$/, '')
    .trim()
    .toLowerCase() + ext.toLowerCase();
}

// Scan for duplicates (exact hash matches + similar name groups)
ipcMain.handle('scan-duplicates', async (_, dir) => {
  const files = (await walkDir(dir)).filter(isSafeToShow);
  const groups = [];

  // 1. Exact duplicates — same size + same MD5
  const bySize = {};
  for (const f of files) {
    if (!bySize[f.size]) bySize[f.size] = [];
    bySize[f.size].push(f);
  }
  const exactCandidates = Object.values(bySize).filter(g => g.length > 1);
  const exactPaths = new Set();
  for (const group of exactCandidates) {
    const hashes = {};
    for (const f of group) {
      try {
        const h = await hashFile(f.path);
        if (!hashes[h]) hashes[h] = [];
        hashes[h].push(f);
      } catch {}
    }
    for (const dupes of Object.values(hashes)) {
      if (dupes.length > 1) {
        groups.push(dupes.map(f => ({ ...f, sizeFormatted: formatBytes(f.size), matchType: 'exact' })));
        dupes.forEach(f => exactPaths.add(f.path));
      }
    }
  }

  // 2. Similar name groups — same base name pattern, same extension, same parent folder
  const byBaseName = {};
  for (const f of files) {
    if (exactPaths.has(f.path)) continue;
    const key = path.dirname(f.path) + '|' + baseName(f.name);
    if (!byBaseName[key]) byBaseName[key] = [];
    byBaseName[key].push(f);
  }
  for (const group of Object.values(byBaseName)) {
    if (group.length > 1) {
      group.sort((a, b) => a.name.localeCompare(b.name));
      groups.push(group.map(f => ({ ...f, sizeFormatted: formatBytes(f.size), matchType: 'similar' })));
    }
  }

  return groups;
});

// Scan for large files
ipcMain.handle('scan-large-files', async (_, dir, minSizeMB = 50) => {
  const minBytes = minSizeMB * 1024 * 1024;
  const files = (await walkDir(dir)).filter(f => f.size >= minBytes && isSafeToShow(f));
  files.sort((a, b) => b.size - a.size);
  return files.slice(0, 100).map(f => ({ ...f, sizeFormatted: formatBytes(f.size) }));
});

// Scan for junk files
ipcMain.handle('scan-junk', async (_, dir) => {
  const files = (await walkDir(dir)).filter(f => isJunk(f.name) && isSafeToShow(f));
  return files.map(f => ({ ...f, sizeFormatted: formatBytes(f.size) }));
});

// Move to recycle bin
ipcMain.handle('move-to-bin', async (_, filePaths) => {
  const results = [];
  let meta = [];
  try { meta = JSON.parse(fs.readFileSync(META_FILE, 'utf8')); } catch {}

  for (let i = 0; i < filePaths.length; i++) {
    const filePath = filePaths[i];
    try {
      // Check file exists before trying anything
      if (!fs.existsSync(filePath)) {
        // Ghost file (e.g. .DS_Store on Windows) — just skip it as success
        results.push({ success: true, path: filePath });
        continue;
      }
      const stat = fs.statSync(filePath);
      const id = `${Date.now()}_${i}_${Math.random().toString(36).slice(2)}`;
      // Store on same drive for instant rename — no cross-drive copy needed
      const binDir = getBinDirForDrive(filePath);
      const dest = path.join(binDir, id);
      fs.renameSync(filePath, dest);
      meta.push({ id, binDir, originalPath: filePath, name: path.basename(filePath), size: stat.size, sizeFormatted: formatBytes(stat.size), deletedAt: new Date().toISOString() });
      results.push({ success: true, path: filePath });
    } catch (e) {
      console.error('move-to-bin failed:', filePath, e.code, e.message);
      results.push({ success: false, path: filePath, error: `[${e.code}] ${e.message}` });
    }
  }
  fs.writeFileSync(META_FILE, JSON.stringify(meta, null, 2));
  return results;
});

// Get recycle bin contents
ipcMain.handle('get-bin', async () => {
  try { return JSON.parse(fs.readFileSync(META_FILE, 'utf8')); } catch { return []; }
});

// Restore from bin
ipcMain.handle('restore-from-bin', async (_, id) => {
  let meta = [];
  try { meta = JSON.parse(fs.readFileSync(META_FILE, 'utf8')); } catch { return { success: false }; }
  const item = meta.find(m => m.id === id);
  if (!item) return { success: false, error: 'Item not found' };
  const src = path.join(item.binDir || RECYCLE_BIN_BASE, id);
  try {
    const destDir = path.dirname(item.originalPath);
    if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
    fs.renameSync(src, item.originalPath);
    fs.writeFileSync(META_FILE, JSON.stringify(meta.filter(m => m.id !== id), null, 2));
    return { success: true };
  } catch (e) { return { success: false, error: e.message }; }
});

// Permanently delete from bin
ipcMain.handle('delete-from-bin', async (_, ids) => {
  let meta = [];
  try { meta = JSON.parse(fs.readFileSync(META_FILE, 'utf8')); } catch {}
  for (const id of ids) {
    const item = meta.find(m => m.id === id);
    const src = path.join(item?.binDir || RECYCLE_BIN_BASE, id);
    try { fs.unlinkSync(src); } catch {}
  }
  fs.writeFileSync(META_FILE, JSON.stringify(meta.filter(m => !ids.includes(m.id)), null, 2));
  return { success: true };
});

// Space analyzer — top folders by size, async to keep UI responsive
async function getDirSize(dir, depth = 0) {
  let size = 0;
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return 0; }
  for (const e of entries) {
    if (e.isSymbolicLink()) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (depth < 4) {
        await new Promise(r => setImmediate(r));
        size += await getDirSize(full, depth + 1);
      }
    } else {
      try { size += fs.statSync(full).size; } catch {}
    }
  }
  return size;
}

ipcMain.handle('analyze-space', async (_, dir) => {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return []; }
  const results = [];
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const size = await getDirSize(full);
      results.push({ name: entry.name, path: full, size, sizeFormatted: formatBytes(size), type: 'folder' });
    } else {
      try {
        const stat = fs.statSync(full);
        results.push({ name: entry.name, path: full, size: stat.size, sizeFormatted: formatBytes(stat.size), type: 'file' });
      } catch {}
    }
  }
  results.sort((a, b) => b.size - a.size);
  return results.slice(0, 30);
});

// Get disk info
ipcMain.handle('get-disk-info', async () => {
  return { totalMem: os.totalmem(), freeMem: os.freemem(), homedir: os.homedir(), platform: process.platform };
});

// Detect available drives (Windows only)
ipcMain.handle('get-drives', async () => {
  if (process.platform !== 'win32') {
    return [{ path: '/', label: 'Root' }];
  }
  const { execSync } = require('child_process');
  try {
    const output = execSync(
      'powershell -NoProfile -Command "Get-PSDrive -PSProvider FileSystem | Select-Object Name,@{N=\'Size\';E={$_.Used+$_.Free}},Free,Description | ConvertTo-Json"',
      { encoding: 'utf8', timeout: 8000 }
    );
    const raw = JSON.parse(output);
    const items = Array.isArray(raw) ? raw : [raw];
    return items.filter(d => d.Name && d.Name.match(/^[A-Z]$/i)).map(d => ({
      path: d.Name.toUpperCase() + ':\\',
      label: d.Description || '',
      freeSpace: d.Free || 0,
      size: d.Size || 0,
      freeFormatted: formatBytes(d.Free || 0),
      sizeFormatted: formatBytes(d.Size || 0),
    }));
  } catch { return []; }
});
