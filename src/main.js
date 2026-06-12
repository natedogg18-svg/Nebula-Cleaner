const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const os = require('os');

let mainWindow;
const RECYCLE_BIN_DIR = path.join(app.getPath('userData'), 'RecycleBin');

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
  if (!fs.existsSync(RECYCLE_BIN_DIR)) fs.mkdirSync(RECYCLE_BIN_DIR, { recursive: true });
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

async function moveFile(src, dest) {
  try {
    fs.renameSync(src, dest);
  } catch (e) {
    if (e.code === 'EXDEV') {
      // Cross-device move — stream copy to avoid blocking UI
      await new Promise((resolve, reject) => {
        const rd = fs.createReadStream(src);
        const wr = fs.createWriteStream(dest);
        rd.on('error', reject);
        wr.on('error', reject);
        wr.on('finish', resolve);
        rd.pipe(wr);
      });
      fs.unlinkSync(src);
    } else {
      throw e;
    }
  }
}

// Scan for duplicates
ipcMain.handle('scan-duplicates', async (_, dir) => {
  const files = walkDir(dir);
  const bySize = {};
  for (const f of files) {
    if (!bySize[f.size]) bySize[f.size] = [];
    bySize[f.size].push(f);
  }
  const candidates = Object.values(bySize).filter(g => g.length > 1);
  const groups = [];
  for (const group of candidates) {
    const hashes = {};
    for (const f of group) {
      try {
        const h = await hashFile(f.path);
        if (!hashes[h]) hashes[h] = [];
        hashes[h].push(f);
      } catch {}
    }
    for (const dupes of Object.values(hashes)) {
      if (dupes.length > 1) groups.push(dupes.map(f => ({ ...f, size: f.size, sizeFormatted: formatBytes(f.size) })));
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
  const metaFile = path.join(RECYCLE_BIN_DIR, 'meta.json');
  let meta = [];
  try { meta = JSON.parse(fs.readFileSync(metaFile, 'utf8')); } catch {}

  for (let i = 0; i < filePaths.length; i++) {
    const filePath = filePaths[i];
    try {
      const stat = fs.statSync(filePath);
      const id = `${Date.now()}_${i}_${Math.random().toString(36).slice(2)}`;
      const dest = path.join(RECYCLE_BIN_DIR, id);
      moveFile(filePath, dest);
      meta.push({ id, originalPath: filePath, name: path.basename(filePath), size: stat.size, sizeFormatted: formatBytes(stat.size), deletedAt: new Date().toISOString() });
      results.push({ success: true, path: filePath });
    } catch (e) {
      console.error('move-to-bin failed:', filePath, e.code, e.message);
      results.push({ success: false, path: filePath, error: `[${e.code}] ${e.message}` });
    }
  }
  fs.writeFileSync(metaFile, JSON.stringify(meta, null, 2));
  return results;
});

// Get recycle bin contents
ipcMain.handle('get-bin', async () => {
  const metaFile = path.join(RECYCLE_BIN_DIR, 'meta.json');
  try { return JSON.parse(fs.readFileSync(metaFile, 'utf8')); } catch { return []; }
});

// Restore from bin
ipcMain.handle('restore-from-bin', async (_, id) => {
  const metaFile = path.join(RECYCLE_BIN_DIR, 'meta.json');
  let meta = [];
  try { meta = JSON.parse(fs.readFileSync(metaFile, 'utf8')); } catch { return { success: false }; }
  const item = meta.find(m => m.id === id);
  if (!item) return { success: false, error: 'Item not found' };
  const src = path.join(RECYCLE_BIN_DIR, id);
  try {
    const destDir = path.dirname(item.originalPath);
    if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
    moveFile(src, item.originalPath);
    fs.writeFileSync(metaFile, JSON.stringify(meta.filter(m => m.id !== id), null, 2));
    return { success: true };
  } catch (e) { return { success: false, error: e.message }; }
});

// Permanently delete from bin
ipcMain.handle('delete-from-bin', async (_, ids) => {
  const metaFile = path.join(RECYCLE_BIN_DIR, 'meta.json');
  let meta = [];
  try { meta = JSON.parse(fs.readFileSync(metaFile, 'utf8')); } catch {}
  for (const id of ids) {
    const src = path.join(RECYCLE_BIN_DIR, id);
    try { fs.unlinkSync(src); } catch {}
  }
  fs.writeFileSync(metaFile, JSON.stringify(meta.filter(m => !ids.includes(m.id)), null, 2));
  return { success: true };
});

// Get disk info
ipcMain.handle('get-disk-info', async () => {
  return { totalMem: os.totalmem(), freeMem: os.freemem(), homedir: os.homedir(), platform: process.platform };
});
