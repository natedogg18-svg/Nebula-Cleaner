const { app, BrowserWindow, ipcMain, dialog, shell, Notification } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const os = require('os');

let mainWindow;
const RECYCLE_BIN_BASE = path.join(app.getPath('userData'), 'RecycleBin');
const META_FILE = path.join(RECYCLE_BIN_BASE, 'meta.json');
const SCHEDULE_FILE = path.join(app.getPath('userData'), 'schedule.json');

// Module-level walk progress counter
let _walkFileCount = 0;

function getBinDirForDrive(filePath) {
  const root = path.parse(filePath).root;
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
  checkScheduleOnStartup();
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

const EXCLUDED_DIR_NAMES = new Set([
  'windows', 'system32', 'syswow64', 'winsxs', 'boot', 'recovery',
  'system volume information', '$recycle.bin', '$windows.~bt', '$windows.~ws',
  'programdata', 'program files', 'program files (x86)',
  'adobetemp', 'adobe temp', 'temp', 'tmp',
  'appdata', 'application data', 'node_modules', '.git',
  '.nebula-bin',
]);

const PROTECTED_ROOT_FILES = new Set([
  'csb.log', 'dumpstack.log', 'dumpstack.log.tmp', 'install.log',
  'hiberfil.sys', 'pagefile.sys', 'swapfile.sys',
]);

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
  if (file.name.toLowerCase().match(/\.(exe|dll|sys)\.bak$/i)) return false;
  const root = path.parse(file.path).root;
  const dir = path.dirname(file.path);
  if (dir.toLowerCase() === root.toLowerCase().replace(/\\$/, '') &&
      PROTECTED_ROOT_FILES.has(file.name.toLowerCase())) return false;
  if (dir.toLowerCase() === root.toLowerCase().replace(/\\$/, '') &&
      file.name.match(/^(DUMP|WRP|hiberfil|pagefile|swapfile)/i)) return false;
  return true;
}

// walkDir with progress reporting every 50 files
async function walkDir(dir, files = [], depth = 0) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return files; }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      if (isExcluded(full)) continue;
      await new Promise(r => setImmediate(r));
      await walkDir(full, files, depth + 1);
    } else if (entry.isFile()) {
      try {
        const stat = fs.statSync(full);
        files.push({ path: full, name: entry.name, size: stat.size, mtime: stat.mtime.toISOString() });
        _walkFileCount++;
        if (_walkFileCount % 50 === 0 && mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('scan-progress', { type: 'walk', current: _walkFileCount, total: 0 });
          await new Promise(r => setImmediate(r));
        }
      } catch {}
    }
  }
  return files;
}

// Throttled copy
const COPY_CHUNK = 64 * 1024;
const COPY_DELAY = 20;

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

// Scan for duplicates
ipcMain.handle('scan-duplicates', async (_, dir) => {
  _walkFileCount = 0;
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('scan-progress', { type: 'walk', current: 0, total: 0 });
  const files = (await walkDir(dir)).filter(isSafeToShow);
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('scan-progress', { type: 'done', current: _walkFileCount, total: _walkFileCount });
  const groups = [];

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
  _walkFileCount = 0;
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('scan-progress', { type: 'walk', current: 0, total: 0 });
  const minBytes = minSizeMB * 1024 * 1024;
  const files = (await walkDir(dir)).filter(f => f.size >= minBytes && isSafeToShow(f));
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('scan-progress', { type: 'done', current: _walkFileCount, total: _walkFileCount });
  files.sort((a, b) => b.size - a.size);
  return files.slice(0, 100).map(f => ({ ...f, sizeFormatted: formatBytes(f.size) }));
});

// Scan for junk files
ipcMain.handle('scan-junk', async (_, dir) => {
  _walkFileCount = 0;
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('scan-progress', { type: 'walk', current: 0, total: 0 });
  const files = (await walkDir(dir)).filter(f => isJunk(f.name) && isSafeToShow(f));
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('scan-progress', { type: 'done', current: _walkFileCount, total: _walkFileCount });
  return files.map(f => ({ ...f, sizeFormatted: formatBytes(f.size) }));
});

// Scan for old files
ipcMain.handle('scan-old-files', async (_, dir, months = 12) => {
  _walkFileCount = 0;
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('scan-progress', { type: 'walk', current: 0, total: 0 });
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - months);
  const allFiles = await walkDir(dir);
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('scan-progress', { type: 'done', current: _walkFileCount, total: _walkFileCount });
  const old = allFiles.filter(f => {
    const mtime = new Date(f.mtime);
    return mtime < cutoff && isSafeToShow(f);
  });
  old.sort((a, b) => new Date(a.mtime) - new Date(b.mtime));
  return old.slice(0, 500).map(f => ({ ...f, sizeFormatted: formatBytes(f.size) }));
});

// Scan for empty folders
ipcMain.handle('scan-empty-folders', async (_, dir) => {
  const emptyFolders = [];

  async function hasFiles(dirPath) {
    let entries;
    try { entries = fs.readdirSync(dirPath, { withFileTypes: true }); } catch { return false; }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const full = path.join(dirPath, entry.name);
      if (entry.isFile()) return true;
      if (entry.isDirectory()) {
        const name = entry.name.toLowerCase();
        if (EXCLUDED_DIR_NAMES.has(name)) continue;
        if (await hasFiles(full)) return true;
      }
    }
    return false;
  }

  async function findEmpty(dirPath, depth = 0) {
    let entries;
    try { entries = fs.readdirSync(dirPath, { withFileTypes: true }); } catch { return; }
    await new Promise(r => setImmediate(r));
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
      const full = path.join(dirPath, entry.name);
      const name = entry.name.toLowerCase();
      if (EXCLUDED_DIR_NAMES.has(name)) continue;
      const hasAnyFiles = await hasFiles(full);
      if (!hasAnyFiles) {
        emptyFolders.push({ path: full, name: entry.name, size: 0, sizeFormatted: '0 B', mtime: '' });
      } else {
        await findEmpty(full, depth + 1);
      }
    }
  }

  await findEmpty(dir);
  return emptyFolders.slice(0, 300);
});

// Delete empty folders
ipcMain.handle('delete-empty-folders', async (_, folderPaths) => {
  const results = [];
  for (const p of folderPaths) {
    try {
      fs.rmSync(p, { recursive: true });
      results.push({ success: true, path: p });
    } catch (e) {
      results.push({ success: false, path: p, error: e.message });
    }
  }
  return results;
});

// Read file preview
ipcMain.handle('read-file-preview', async (_, filePath) => {
  try {
    const stat = fs.statSync(filePath);
    const name = path.basename(filePath);
    const ext = path.extname(filePath).toLowerCase();
    const imageExts = new Set(['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp', '.svg', '.ico']);
    const textExts = new Set(['.txt', '.log', '.md', '.json', '.xml', '.csv', '.js', '.ts', '.css', '.html', '.yml', '.yaml', '.ini', '.cfg', '.conf', '.py', '.rb', '.sh', '.bat', '.cmd', '.ps1', '.env', '.toml']);

    let type = 'binary';
    let content = null;

    if (imageExts.has(ext)) {
      type = 'image';
      const buf = fs.readFileSync(filePath);
      content = 'data:image/' + ext.slice(1) + ';base64,' + buf.toString('base64');
    } else if (textExts.has(ext)) {
      type = 'text';
      const buf = Buffer.alloc(2048);
      const fd = fs.openSync(filePath, 'r');
      const bytesRead = fs.readSync(fd, buf, 0, 2048, 0);
      fs.closeSync(fd);
      content = buf.slice(0, bytesRead).toString('utf8');
    }

    return {
      type,
      content,
      name,
      size: stat.size,
      sizeFormatted: formatBytes(stat.size),
      mtime: stat.mtime.toISOString(),
      path: filePath,
      ext,
    };
  } catch (e) {
    return { type: 'error', content: e.message, name: path.basename(filePath), path: filePath };
  }
});

// Export report as CSV
ipcMain.handle('export-report', async (_, data, format) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Export Report',
    defaultPath: 'nebula-report-' + Date.now() + '.csv',
    filters: [{ name: 'CSV Files', extensions: ['csv'] }],
  });
  if (result.canceled) return { success: false };
  try {
    const header = 'Type,Name,Path,Size,Modified\n';
    const rows = data.map(row => {
      const type = (row.type || '').replace(/,/g, ';');
      const name = (row.name || '').replace(/,/g, ';').replace(/"/g, '""');
      const p = (row.path || '').replace(/,/g, ';').replace(/"/g, '""');
      const size = row.sizeFormatted || row.size || '';
      const mtime = row.mtime || '';
      return '"' + type + '","' + name + '","' + p + '","' + size + '","' + mtime + '"';
    }).join('\n');
    fs.writeFileSync(result.filePath, header + rows, 'utf8');
    return { success: true, filePath: result.filePath };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// Move to recycle bin
ipcMain.handle('move-to-bin', async (_, filePaths) => {
  const results = [];
  let meta = [];
  try { meta = JSON.parse(fs.readFileSync(META_FILE, 'utf8')); } catch {}

  for (let i = 0; i < filePaths.length; i++) {
    const filePath = filePaths[i];
    try {
      if (!fs.existsSync(filePath)) {
        results.push({ success: true, path: filePath });
        continue;
      }
      const stat = fs.statSync(filePath);
      const id = Date.now() + '_' + i + '_' + Math.random().toString(36).slice(2);
      const binDir = getBinDirForDrive(filePath);
      const dest = path.join(binDir, id);
      fs.renameSync(filePath, dest);
      meta.push({ id, binDir, originalPath: filePath, name: path.basename(filePath), size: stat.size, sizeFormatted: formatBytes(stat.size), deletedAt: new Date().toISOString() });
      results.push({ success: true, path: filePath });
    } catch (e) {
      console.error('move-to-bin failed:', filePath, e.code, e.message);
      results.push({ success: false, path: filePath, error: '[' + e.code + '] ' + e.message });
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
    const src = path.join(item ? item.binDir || RECYCLE_BIN_BASE : RECYCLE_BIN_BASE, id);
    try { fs.unlinkSync(src); } catch {}
  }
  fs.writeFileSync(META_FILE, JSON.stringify(meta.filter(m => !ids.includes(m.id)), null, 2));
  return { success: true };
});

// Move files/folders to another drive/location
function countFilesSync(src) {
  let count = 0;
  try {
    const stat = fs.statSync(src);
    if (!stat.isDirectory()) return 1;
    for (const entry of fs.readdirSync(src)) {
      count += countFilesSync(path.join(src, entry));
    }
  } catch {}
  return count;
}

ipcMain.handle('move-to-drive', async (event, srcPaths, destDir) => {
  const results = [];
  for (const src of srcPaths) {
    try {
      if (!fs.existsSync(src)) { results.push({ success: false, path: src, error: 'File not found' }); continue; }
      const destPath = path.join(destDir, path.basename(src));
      try {
        fs.renameSync(src, destPath);
        event.sender.send('copy-progress', { done: true });
      } catch (e) {
        if (e.code === 'EXDEV') {
          const total = countFilesSync(src);
          let copied = 0;
          await copyRecursive(src, destPath, (file) => {
            copied++;
            event.sender.send('copy-progress', { copied, total, file: path.basename(file) });
          });
          await deleteRecursive(src);
          event.sender.send('copy-progress', { done: true });
        } else throw e;
      }
      results.push({ success: true, path: src, dest: destPath });
    } catch (e) {
      console.error('move-to-drive failed:', src, e.code, e.message);
      event.sender.send('copy-progress', { done: true });
      results.push({ success: false, path: src, error: `[${e.code}] ${e.message}` });
    }
  }
  return results;
});

async function copyRecursive(src, dest, onFile) {
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    for (const entry of fs.readdirSync(src)) {
      await new Promise(r => setImmediate(r));
      await copyRecursive(path.join(src, entry), path.join(dest, entry), onFile);
    }
  } else {
    await fs.promises.copyFile(src, dest);
    if (onFile) onFile(src);
  }
}

async function deleteRecursive(src) {
  fs.rmSync(src, { recursive: true, force: true });
}

// Space analyzer — Feature 1: yield every dir AND limit depth to 3
async function getDirSize(dir, depth = 0) {
  if (depth >= 3) return 0;
  let size = 0;
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return 0; }
  await new Promise(r => setImmediate(r));
  for (const e of entries) {
    if (e.isSymbolicLink()) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (depth + 1 < 3) {
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

// Detect available drives
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

// Schedule IPC handlers
ipcMain.handle('get-schedule', async () => {
  try { return JSON.parse(fs.readFileSync(SCHEDULE_FILE, 'utf8')); } catch { return { enabled: false, lastNotified: null }; }
});

ipcMain.handle('set-schedule', async (_, settings) => {
  fs.writeFileSync(SCHEDULE_FILE, JSON.stringify(settings, null, 2));
  return { success: true };
});

ipcMain.handle('trigger-schedule-check', async () => {
  return checkScheduleNow();
});

function checkScheduleNow() {
  try {
    let sched = { enabled: false, lastNotified: null };
    try { sched = JSON.parse(fs.readFileSync(SCHEDULE_FILE, 'utf8')); } catch {}
    if (!sched.enabled) return { triggered: false };
    const now = new Date();
    const last = sched.lastNotified ? new Date(sched.lastNotified) : null;
    const daysDiff = last ? (now - last) / (1000 * 60 * 60 * 24) : 999;
    if (daysDiff >= 7) {
      if (Notification.isSupported()) {
        new Notification({
          title: 'Nebula Cleaner',
          body: 'Time for your weekly scan! Open Nebula Cleaner to clean up your drive.',
        }).show();
      }
      sched.lastNotified = now.toISOString();
      fs.writeFileSync(SCHEDULE_FILE, JSON.stringify(sched, null, 2));
      return { triggered: true };
    }
    return { triggered: false };
  } catch (e) {
    return { triggered: false, error: e.message };
  }
}

function checkScheduleOnStartup() {
  try {
    let sched = { enabled: false };
    try { sched = JSON.parse(fs.readFileSync(SCHEDULE_FILE, 'utf8')); } catch {}
    if (sched.enabled) {
      setTimeout(() => checkScheduleNow(), 3000);
    }
  } catch {}
}
