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

function walkDir(dir, files = []) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return files; }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      walkDir(full, files);
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
  console.log(`moveFile: ${src} -> ${dest}`);
  try {
    fs.renameSync(src, dest);
    console.log(`moveFile: renameSync succeeded`);
    if (fs.existsSync(src)) console.error(`moveFile: original still exists after rename!`);
  } catch (e) {
    console.log(`moveFile: renameSync failed [${e.code}], trying throttledCopy`);
    if (e.code === 'EXDEV') {
      await throttledCopy(src, dest);
      console.log(`moveFile: copy done, now deleting src`);
      try {
        fs.unlinkSync(src);
        console.log(`moveFile: unlink succeeded`);
        if (fs.existsSync(src)) console.error(`moveFile: original still exists after unlink!`);
      } catch (unlinkErr) {
        console.error(`moveFile: unlink failed [${unlinkErr.code}] ${unlinkErr.message}`);
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
  const files = walkDir(dir);
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
  const files = walkDir(dir).filter(f => f.size >= minBytes);
  files.sort((a, b) => b.size - a.size);
  return files.slice(0, 100).map(f => ({ ...f, sizeFormatted: formatBytes(f.size) }));
});

// Scan for junk files
ipcMain.handle('scan-junk', async (_, dir) => {
  const files = walkDir(dir).filter(f => isJunk(f.name));
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

// Get disk info
ipcMain.handle('get-disk-info', async () => {
  return { totalMem: os.totalmem(), freeMem: os.freemem(), homedir: os.homedir(), platform: process.platform };
});
