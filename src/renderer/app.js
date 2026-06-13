// State
const state = {
  dir: '',
  duplicates: [],
  largeFiles: [],
  junkFiles: [],
  oldFiles: [],
  emptyFolders: [],
  binItems: [],
  sortState: {},
};

// Stars
function initStars() {
  const container = document.getElementById('stars');
  for (let i = 0; i < 120; i++) {
    const s = document.createElement('div');
    s.className = 'star';
    const size = Math.random() * 2.5 + 0.5;
    s.style.cssText = `width:${size}px;height:${size}px;top:${Math.random()*100}%;left:${Math.random()*100}%;--d:${2+Math.random()*4}s;--op:${0.3+Math.random()*0.7};animation-delay:${Math.random()*5}s`;
    container.appendChild(s);
  }
}

// Tab switching
function switchTab(tab) {
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.getElementById(`tab-${tab}`).classList.add('active');
  const navEl = document.querySelector(`[data-tab="${tab}"]`);
  if (navEl) navEl.classList.add('active');
  if (tab === 'bin') loadBin();
  if (tab === 'analyzer') runAnalyzer();
  if (tab === 'settings') loadSettings();
}

// Toast
let toastTimeout;
function showToast(msg, type = '') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = `toast show ${type}`;
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => t.classList.remove('show'), 3500);
}

// Status
function setStatus(msg, loading = false) {
  const s = document.getElementById('scan-status');
  if (s) s.innerHTML = loading ? `<span class="spinner"></span>${msg}` : msg;
}

// Progress bar
function showProgress(tabKey, show) {
  const wrap = document.getElementById(`progress-${tabKey}`);
  if (wrap) wrap.style.display = show ? 'flex' : 'none';
}

function updateProgress(tabKey, current, total) {
  const fill = document.getElementById(`progress-fill-${tabKey}`);
  const label = document.getElementById(`progress-label-${tabKey}`);
  if (!fill || !label) return;
  if (total > 0) {
    const pct = Math.min(100, Math.round((current / total) * 100));
    fill.style.width = pct + '%';
    label.textContent = `${pct}% (${current} / ${total})`;
  } else {
    // Indeterminate: animate using current count
    const pct = Math.min(95, (current % 500) / 5);
    fill.style.width = pct + '%';
    label.textContent = `${current} files scanned...`;
  }
}

// Listen for progress events from main process
let _currentProgressTab = null;
window.nebula.onProgress((data) => {
  if (!_currentProgressTab) return;
  const key = _currentProgressTab;
  if (data.type === 'done') {
    updateProgress(key, data.current, data.current);
    setTimeout(() => showProgress(key, false), 800);
  } else {
    showProgress(key, true);
    updateProgress(key, data.current, data.total);
  }
});

// Pick directory
async function pickDirectory() {
  const dir = await window.nebula.selectDirectory();
  if (dir) {
    state.dir = dir;
    document.getElementById('dir-input').value = dir;
    setStatus('');
    ['duplicates','large','junk'].forEach(k => {
      const el = document.getElementById(`result-${k}`);
      if (el) el.textContent = '—';
    });
  }
}

// Disk info
async function loadDiskInfo() {
  const info = await window.nebula.getDiskInfo();
  const freeGB = (info.freeMem / 1e9).toFixed(1);
  const totalGB = (info.totalMem / 1e9).toFixed(1);
  document.getElementById('disk-info').innerHTML =
    `<div>🖥 RAM Free</div><div>${freeGB} / ${totalGB} GB</div><div style="margin-top:6px">📁 ${info.homedir}</div>`;
}

// Run all scans
async function runAllScans() {
  if (!state.dir) { showToast('Please select a directory first', 'error'); return; }
  const btn = document.getElementById('scan-all-btn');
  btn.disabled = true;
  setStatus('Scanning for duplicates...', true);
  await runScan('duplicates', true);
  setStatus('Scanning for large files...', true);
  await runScan('large', true);
  setStatus('Scanning for junk files...', true);
  await runScan('junk', true);
  setStatus('✅ Scan complete!');
  btn.disabled = false;
  showToast('Full scan complete!', 'success');
}

async function runScan(type, silent = false) {
  if (!state.dir) { if (!silent) showToast('Please select a directory first', 'error'); return; }
  try {
    if (type === 'duplicates') {
      _currentProgressTab = 'duplicates';
      showProgress('duplicates', true);
      if (!silent) setStatus('Scanning...', true);
      const groups = await window.nebula.scanDuplicates(state.dir);
      _currentProgressTab = null;
      showProgress('duplicates', false);
      state.duplicates = groups;
      const total = groups.reduce((s, g) => s + g.length, 0);
      const el = document.getElementById('result-duplicates');
      if (el) el.textContent = `${groups.length} groups (${total} files)`;
      renderDuplicates();
    } else if (type === 'large') {
      _currentProgressTab = 'large';
      showProgress('large', true);
      const minMB = parseInt(document.getElementById('min-size')?.value || 50);
      const files = await window.nebula.scanLargeFiles(state.dir, minMB);
      _currentProgressTab = null;
      showProgress('large', false);
      state.largeFiles = files;
      const el = document.getElementById('result-large');
      if (el) el.textContent = `${files.length} files`;
      renderLargeFiles();
    } else if (type === 'junk') {
      _currentProgressTab = 'junk';
      showProgress('junk', true);
      const files = await window.nebula.scanJunk(state.dir);
      _currentProgressTab = null;
      showProgress('junk', false);
      state.junkFiles = files;
      const el = document.getElementById('result-junk');
      if (el) el.textContent = `${files.length} files`;
      renderJunkFiles();
    } else if (type === 'old-files') {
      if (!state.dir) { showToast('Please select a directory first', 'error'); return; }
      _currentProgressTab = 'old-files';
      showProgress('old-files', true);
      const months = parseInt(document.getElementById('old-months')?.value || 12);
      const files = await window.nebula.scanOldFiles(state.dir, months);
      _currentProgressTab = null;
      showProgress('old-files', false);
      state.oldFiles = files;
      renderOldFiles();
    } else if (type === 'empty-folders') {
      if (!state.dir) { showToast('Please select a directory first', 'error'); return; }
      showToast('Scanning for empty folders...');
      const folders = await window.nebula.scanEmptyFolders(state.dir);
      state.emptyFolders = folders;
      renderEmptyFolders();
    }
    if (!silent) setStatus('');
  } catch (e) {
    _currentProgressTab = null;
    if (!silent) setStatus(`Error: ${e.message}`);
    showToast(`Scan error: ${e.message}`, 'error');
  }
}

async function rescanLarge() {
  await runScan('large');
}

// Escape HTML
function escHtml(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// Empty state
function emptyState(icon, msg) {
  return `<div class="empty-state"><div class="icon">${icon}</div><div>${msg}</div></div>`;
}

// File item HTML (with preview on name click)
function fileItem(file, checked = false, badge = '', showDate = false) {
  const badgeClass = badge === 'Original' ? 'badge-original' : badge === 'Similar' ? 'badge-similar' : 'badge-dupe';
  const badgeHtml = badge ? `<span class="file-badge ${badgeClass}">${badge}</span>` : '';
  const dateHtml = showDate && file.mtime ? `<div class="badge-date">${new Date(file.mtime).toLocaleDateString()}</div>` : '';
  const safePath = escHtml(file.path);
  return `
    <div class="file-item">
      <input type="checkbox" ${checked ? 'checked' : ''} data-path="${safePath}" />
      <div class="file-info">
        <div class="file-name file-preview-link" onclick="openPreview(${JSON.stringify(file.path)})">${escHtml(file.name)}</div>
        <div class="file-path">${escHtml(file.path)}</div>
      </div>
      ${badgeHtml}
      ${dateHtml}
      <div class="file-size">${file.sizeFormatted || ''}</div>
    </div>`;
}

// Sort helpers
function sortFiles(files, key) {
  const sorted = [...files];
  if (key === 'name') sorted.sort((a, b) => a.name.localeCompare(b.name));
  else if (key === 'size') sorted.sort((a, b) => b.size - a.size);
  else if (key === 'date') sorted.sort((a, b) => new Date(b.mtime) - new Date(a.mtime));
  return sorted;
}

function sortTab(tabKey, key) {
  state.sortState[tabKey] = key;
  if (tabKey === 'large') renderLargeFiles();
  else if (tabKey === 'junk') renderJunkFiles();
  else if (tabKey === 'old-files') renderOldFiles();
}

// Filter helpers
function getFilter(id) {
  const el = document.getElementById(id);
  return el ? el.value.toLowerCase() : '';
}

function filterFiles(files, query) {
  if (!query) return files;
  return files.filter(f => f.name.toLowerCase().includes(query) || f.path.toLowerCase().includes(query));
}

// Render duplicates
function renderDuplicates() {
  const list = document.getElementById('duplicate-list');
  const query = getFilter('search-duplicates');
  if (!state.duplicates.length) {
    list.innerHTML = emptyState('👯', 'No duplicates found');
    document.getElementById('dup-count').textContent = '';
    return;
  }
  let html = '';
  let totalWaste = 0;
  let shownGroups = 0;
  state.duplicates.forEach((group, gi) => {
    const filtered = filterFiles(group, query);
    if (!filtered.length) return;
    shownGroups++;
    const waste = group[0].size * (group.length - 1);
    totalWaste += waste;
    const isExact = group[0].matchType === 'exact';
    const label = isExact ? `${group.length} identical files (${group[0].sizeFormatted} each)` : `${group.length} similar files — review before deleting`;
    const icon = isExact ? '🔴 Exact Duplicates' : '🟡 Similar Names';
    html += `<div class="dup-group"><div class="dup-group-header">${icon} · Group ${gi+1} — ${label}</div>`;
    filtered.forEach((f, i) => { html += fileItem(f, isExact && i > 0, i === 0 ? 'Original' : isExact ? 'Duplicate' : 'Similar'); });
    html += '</div>';
  });
  list.innerHTML = html || emptyState('🔍', 'No results match filter');
  const wasteGB = (totalWaste / 1e9).toFixed(2);
  document.getElementById('dup-count').textContent = `${shownGroups} groups · ~${wasteGB} GB recoverable`;
}

function filterDuplicates() { renderDuplicates(); }

// Render large files
function renderLargeFiles() {
  const list = document.getElementById('large-list');
  const query = getFilter('search-large');
  const sortKey = state.sortState['large'] || 'size';
  let files = filterFiles(state.largeFiles, query);
  files = sortFiles(files, sortKey);
  if (!files.length) {
    list.innerHTML = emptyState('🌍', 'No large files found');
    document.getElementById('large-count').textContent = '';
    return;
  }
  list.innerHTML = files.map(f => fileItem(f, false, '', true)).join('');
  document.getElementById('large-count').textContent = `${files.length} files`;
}

function filterLarge() { renderLargeFiles(); }

// Render junk files
function renderJunkFiles() {
  const list = document.getElementById('junk-list');
  const query = getFilter('search-junk');
  const sortKey = state.sortState['junk'] || 'name';
  let files = filterFiles(state.junkFiles, query);
  files = sortFiles(files, sortKey);
  if (!files.length) {
    list.innerHTML = emptyState('🗑️', 'No junk files found');
    document.getElementById('junk-count').textContent = '';
    return;
  }
  list.innerHTML = files.map(f => fileItem(f, false, '', true)).join('');
  document.getElementById('junk-count').textContent = `${files.length} files`;
}

function filterJunk() { renderJunkFiles(); }

// Render old files
function renderOldFiles() {
  const list = document.getElementById('old-files-list');
  const query = getFilter('search-old-files');
  const sortKey = state.sortState['old-files'] || 'date';
  let files = filterFiles(state.oldFiles, query);
  files = sortFiles(files, sortKey);
  if (!files.length) {
    list.innerHTML = emptyState('🕰', state.oldFiles.length ? 'No results match filter' : 'No old files found — run a scan');
    document.getElementById('old-files-count').textContent = '';
    return;
  }
  list.innerHTML = files.map(f => fileItem(f, false, '', true)).join('');
  document.getElementById('old-files-count').textContent = `${files.length} files`;
}

function filterOldFiles() { renderOldFiles(); }

// Render empty folders
function renderEmptyFolders() {
  const list = document.getElementById('empty-folders-list');
  const folders = state.emptyFolders;
  if (!folders.length) {
    list.innerHTML = emptyState('📂', 'No empty folders found');
    document.getElementById('empty-folders-count').textContent = '';
    return;
  }
  list.innerHTML = folders.map(f => `
    <div class="file-item">
      <input type="checkbox" data-path="${escHtml(f.path)}" />
      <div class="file-info">
        <div class="file-name">📁 ${escHtml(f.name)}</div>
        <div class="file-path">${escHtml(f.path)}</div>
      </div>
    </div>`).join('');
  document.getElementById('empty-folders-count').textContent = `${folders.length} folders`;
}

async function deleteSelectedEmptyFolders() {
  const checked = [...document.querySelectorAll('#empty-folders-list input[type=checkbox]:checked')];
  if (!checked.length) { showToast('No folders selected', 'error'); return; }
  const paths = checked.map(c => c.dataset.path);
  if (!confirm(`Permanently delete ${paths.length} empty folder(s)? This cannot be undone.`)) return;
  const results = await window.nebula.deleteEmptyFolders(paths);
  const ok = results.filter(r => r.success).length;
  const fail = results.length - ok;
  showToast(`Deleted ${ok} folder(s)${fail ? ` (${fail} failed)` : ''}`, ok > 0 ? 'success' : 'error');
  const removedPaths = new Set(results.filter(r => r.success).map(r => r.path));
  state.emptyFolders = state.emptyFolders.filter(f => !removedPaths.has(f.path));
  renderEmptyFolders();
}

// Recycle bin
async function loadBin() {
  state.binItems = await window.nebula.getBin();
  renderBin();
}

function renderBin() {
  const list = document.getElementById('bin-list');
  if (!state.binItems.length) {
    list.innerHTML = emptyState('♻️', 'Recycle bin is empty');
    document.getElementById('bin-count').textContent = '';
    return;
  }
  list.innerHTML = state.binItems.map(item => `
    <div class="file-item">
      <input type="checkbox" data-id="${escHtml(item.id)}" />
      <div class="file-info">
        <div class="file-name">${escHtml(item.name)}</div>
        <div class="file-path">${escHtml(item.originalPath)}</div>
      </div>
      <div class="badge-date">${new Date(item.deletedAt).toLocaleDateString()}</div>
      <div class="file-size">${item.sizeFormatted}</div>
    </div>`).join('');
  const totalSize = state.binItems.reduce((s, i) => s + i.size, 0);
  document.getElementById('bin-count').textContent = `${state.binItems.length} files · ${(totalSize/1e6).toFixed(1)} MB`;
}

// Select helpers
function selectAll(listId) {
  document.querySelectorAll(`#${listId} input[type=checkbox]`).forEach(c => c.checked = true);
}

function selectAllDuplicates() {
  document.querySelectorAll('#duplicate-list input[type=checkbox]').forEach(c => {
    const item = c.closest('.file-item');
    const badge = item ? item.querySelector('.file-badge') : null;
    if (!badge || !badge.classList.contains('badge-original')) c.checked = true;
  });
}

// Send to bin
async function sendSelectedToBin(type) {
  const listMap = {
    duplicates: 'duplicate-list',
    large: 'large-list',
    junk: 'junk-list',
    'old-files': 'old-files-list',
  };
  const listId = listMap[type];
  const checked = [...document.querySelectorAll(`#${listId} input[type=checkbox]:checked`)];
  if (!checked.length) { showToast('No files selected', 'error'); return; }
  const paths = checked.map(c => c.dataset.path);
  showToast(`⏳ Moving ${paths.length} file(s) to bin... please wait`);
  const results = await window.nebula.moveToBin(paths);
  const ok = results.filter(r => r.success).length;
  const fail = results.length - ok;
  const firstErr = results.find(r => !r.success);
  const errDetail = firstErr ? ` — ${firstErr.error}` : '';
  showToast(`Moved ${ok} file(s) to bin${fail ? ` (${fail} failed${errDetail})` : ''}`, ok > 0 ? 'success' : 'error');

  const movedPaths = new Set(results.filter(r => r.success).map(r => r.path));
  if (type === 'duplicates') {
    state.duplicates = state.duplicates.map(g => g.filter(f => !movedPaths.has(f.path))).filter(g => g.length > 1);
    renderDuplicates();
  } else if (type === 'large') {
    state.largeFiles = state.largeFiles.filter(f => !movedPaths.has(f.path));
    renderLargeFiles();
  } else if (type === 'junk') {
    state.junkFiles = state.junkFiles.filter(f => !movedPaths.has(f.path));
    renderJunkFiles();
  } else if (type === 'old-files') {
    state.oldFiles = state.oldFiles.filter(f => !movedPaths.has(f.path));
    renderOldFiles();
  }
}

// Restore from bin
async function restoreSelected() {
  const checked = [...document.querySelectorAll('#bin-list input[type=checkbox]:checked')];
  if (!checked.length) { showToast('No files selected', 'error'); return; }
  let ok = 0;
  for (const c of checked) {
    const res = await window.nebula.restoreFromBin(c.dataset.id);
    if (res.success) ok++;
  }
  showToast(`Restored ${ok} file(s)`, 'success');
  await loadBin();
}

// Delete forever
async function deleteSelected() {
  const checked = [...document.querySelectorAll('#bin-list input[type=checkbox]:checked')];
  if (!checked.length) { showToast('No files selected', 'error'); return; }
  const ids = checked.map(c => c.dataset.id);
  await window.nebula.deleteFromBin(ids);
  showToast(`Permanently deleted ${ids.length} file(s)`, 'success');
  await loadBin();
}

// Export CSV
async function exportTab(type) {
  let data = [];
  if (type === 'duplicates') {
    state.duplicates.forEach(group => {
      group.forEach(f => data.push({ type: f.matchType || 'duplicate', name: f.name, path: f.path, sizeFormatted: f.sizeFormatted, mtime: f.mtime }));
    });
  } else if (type === 'large') {
    data = state.largeFiles.map(f => ({ type: 'large', name: f.name, path: f.path, sizeFormatted: f.sizeFormatted, mtime: f.mtime }));
  } else if (type === 'junk') {
    data = state.junkFiles.map(f => ({ type: 'junk', name: f.name, path: f.path, sizeFormatted: f.sizeFormatted, mtime: f.mtime }));
  } else if (type === 'old-files') {
    data = state.oldFiles.map(f => ({ type: 'old', name: f.name, path: f.path, sizeFormatted: f.sizeFormatted, mtime: f.mtime }));
  }
  if (!data.length) { showToast('No data to export', 'error'); return; }
  const res = await window.nebula.exportReport(data, 'csv');
  if (res.success) showToast(`Exported to ${res.filePath}`, 'success');
  else if (!res.canceled) showToast(`Export failed: ${res.error}`, 'error');
}

// File Preview
async function openPreview(filePath) {
  const modal = document.getElementById('preview-modal');
  const title = document.getElementById('preview-title');
  const meta = document.getElementById('preview-meta');
  const content = document.getElementById('preview-content');

  title.textContent = 'Loading...';
  meta.textContent = '';
  content.innerHTML = '<div class="empty-state"><span class="spinner"></span></div>';
  modal.classList.add('show');

  const result = await window.nebula.readFilePreview(filePath);
  title.textContent = result.name || filePath;
  meta.innerHTML = `<span>Size: ${result.sizeFormatted || ''}</span> <span>Modified: ${result.mtime ? new Date(result.mtime).toLocaleString() : ''}</span> <span class="preview-path">${escHtml(result.path || filePath)}</span>`;

  if (result.type === 'image') {
    content.innerHTML = `<img class="preview-img" src="${escHtml(result.content)}" alt="${escHtml(result.name || '')}" />`;
  } else if (result.type === 'text') {
    content.innerHTML = `<pre class="preview-text">${escHtml(result.content)}</pre>`;
  } else if (result.type === 'error') {
    content.innerHTML = emptyState('❌', `Cannot preview: ${result.content || result.error || 'Unknown error'}`);
  } else {
    const ext = (result.ext || '').toLowerCase();
    const isVideo = ['.mp4', '.mkv', '.avi', '.mov', '.webm'].includes(ext);
    const isAudio = ['.mp3', '.wav', '.flac', '.aac', '.ogg'].includes(ext);
    const icon = isVideo ? '🎬' : isAudio ? '🎵' : '📄';
    content.innerHTML = `<div class="empty-state">
      <div class="icon">${icon}</div>
      <div><strong>${escHtml(result.name || '')}</strong></div>
      <div>Size: ${result.sizeFormatted || ''}</div>
      <div>Modified: ${result.mtime ? new Date(result.mtime).toLocaleString() : ''}</div>
      <div style="margin-top:8px;color:var(--text3);font-size:11px">${escHtml(filePath)}</div>
    </div>`;
  }
}

function closePreviewModal() {
  document.getElementById('preview-modal').classList.remove('show');
}

// Space Analyzer
const analyzerHistory = [];

async function analyzeDir(dir) {
  document.getElementById('analyzer-count').textContent = `Analyzing ${dir} ...`;
  document.getElementById('analyzer-bars').innerHTML = '<div class="empty-state"><span class="spinner"></span> Calculating folder sizes...</div>';
  try {
    const results = await window.nebula.analyzeSpace(dir);
    renderAnalyzer(results, dir);
  } catch (e) {
    document.getElementById('analyzer-bars').innerHTML = emptyState('❌', `Error: ${e.message}`);
    document.getElementById('analyzer-count').textContent = '';
  }
}

async function runAnalyzer() {
  const dir = state.dir || '/';
  analyzerHistory.length = 0;
  analyzerHistory.push(dir);
  await analyzeDir(dir);
}

async function analyzerDrillDown(folderPath) {
  analyzerHistory.push(folderPath);
  await analyzeDir(folderPath);
}

async function analyzerBack() {
  if (analyzerHistory.length <= 1) return;
  analyzerHistory.pop();
  await analyzeDir(analyzerHistory[analyzerHistory.length - 1]);
}

function renderAnalyzer(results, dir) {
  const container = document.getElementById('analyzer-bars');
  const canGoBack = analyzerHistory.length > 1;
  const backBtn = canGoBack ? `<button class="btn btn-sm" onclick="analyzerBack()" style="margin-bottom:8px">⬅ Back</button>` : '';
  const breadcrumb = `<div class="analyzer-breadcrumb">${backBtn}<span class="analyzer-path">${escHtml(dir)}</span></div>`;

  if (!results.length) {
    container.innerHTML = breadcrumb + emptyState('📊', 'Nothing found or folder is empty');
    return;
  }
  const max = results[0].size;
  document.getElementById('analyzer-count').textContent = `Top ${results.length} items in ${dir}`;
  container.innerHTML = breadcrumb + results.map(item => {
    const pct = max > 0 ? Math.round((item.size / max) * 100) : 0;
    const isFolder = item.type === 'folder';
    const icon = isFolder ? '📁' : '📄';
    const safePath = item.path.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    const clickable = isFolder ? `onclick="analyzerDrillDown('${safePath}')"` : '';
    const hoverClass = isFolder ? 'analyzer-row-folder' : '';
    return `
      <div class="analyzer-row ${hoverClass}">
        <div class="analyzer-icon" ${clickable} style="${isFolder ? 'cursor:pointer' : ''}">${icon}</div>
        <div class="analyzer-info" ${clickable} style="${isFolder ? 'cursor:pointer' : ''}">
          <div class="analyzer-name">${escHtml(item.name)}${isFolder ? ' <span class="analyzer-drill">▶</span>' : ''}</div>
          <div class="analyzer-bar-wrap"><div class="analyzer-bar" style="width:${pct}%"></div></div>
        </div>
        <div class="analyzer-size">${item.sizeFormatted}</div>
        <button class="btn btn-sm analyzer-move" onclick="showMoveToDrive('${safePath}')" title="Move to another drive">📦 Move</button>
        <button class="btn btn-sm btn-danger analyzer-del" onclick="analyzerMoveToBin('${safePath}', '${item.type}')" title="Move to bin">🗑</button>
      </div>`;
  }).join('');
}

let pendingMovePath = null;

async function showMoveToDrive(itemPath) {
  pendingMovePath = itemPath;
  const modal = document.getElementById('move-modal');
  const list = document.getElementById('move-drive-list');
  list.innerHTML = '<div style="color:var(--text2);font-size:13px">Loading drives...</div>';
  modal.classList.add('show');
  try {
    let drives = await window.nebula.getDrives();
    // Fallback: if PowerShell failed, offer common drive letters
    if (!drives || !drives.length) {
      drives = ['C:\\','D:\\','E:\\','F:\\'].map(p => ({ path: p, label: '', freeFormatted: '', sizeFormatted: '' }));
    }
    list.innerHTML = drives.map(d => `
      <button class="btn drive-pick-btn" onclick="confirmMoveToDrive('${d.path.replace(/\\/g, '\\\\')}')">
        💾 ${d.path} <span class="drive-name">${d.label || ''}</span>
        ${d.freeFormatted ? `<span class="drive-free">${d.freeFormatted} free</span>` : ''}
      </button>`).join('');
  } catch (e) {
    list.innerHTML = `<div style="color:var(--danger);font-size:12px">Error loading drives: ${e.message}</div>`;
  }
}

function closeModal() {
  document.getElementById('move-modal').classList.remove('show');
  pendingMovePath = null;
}

async function confirmMoveToDrive(destDrive) {
  const srcPath = pendingMovePath;
  closeModal();
  if (!srcPath) return;
  showToast(`⏳ Moving to ${destDrive}... please wait`);
  const results = await window.nebula.moveToDrive([srcPath], destDrive);
  if (results[0].success) {
    showToast(`✅ Moved to ${destDrive}`, 'success');
    await analyzeDir(analyzerHistory[analyzerHistory.length - 1]);
  } else {
    showToast(`Failed: ${results[0].error}`, 'error');
  }
}

async function analyzerMoveToBin(itemPath, type) {
  showToast(`⏳ Moving to bin...`);
  const results = await window.nebula.moveToBin([itemPath]);
  if (results[0].success) {
    showToast(`Moved to bin!`, 'success');
    await analyzeDir(analyzerHistory[analyzerHistory.length - 1]);
  } else {
    showToast(`Failed: ${results[0].error}`, 'error');
  }
}

// Drive selector
async function loadDrives() {
  const drives = await window.nebula.getDrives();
  const container = document.getElementById('drive-btns');
  if (!drives.length) { container.innerHTML = '<span class="drive-hint">No drives detected</span>'; return; }
  container.innerHTML = drives.map(d => `
    <button class="btn btn-drive" onclick="selectDrive('${d.path.replace(/\\/g, '\\\\')}', '${d.label || ''}')" title="${d.freeFormatted || ''} free of ${d.sizeFormatted || ''}">
      💾 ${d.path} ${d.label ? `<span class="drive-name">${d.label}</span>` : ''}
      ${d.size ? `<span class="drive-free">${d.freeFormatted} free</span>` : ''}
    </button>`).join('');
}

function selectDrive(drivePath, label) {
  state.dir = drivePath;
  document.getElementById('dir-input').value = drivePath;
  setStatus(`Selected drive: ${drivePath} — click Launch Full Scan`);
  document.querySelectorAll('.btn-drive').forEach(b => b.classList.remove('active-drive'));
  if (event && event.target) event.target.closest('.btn-drive').classList.add('active-drive');
}

// Theme toggle
let isLightTheme = false;
function toggleTheme() {
  isLightTheme = !isLightTheme;
  document.body.classList.toggle('light-theme', isLightTheme);
  const btn = document.getElementById('theme-btn');
  const settingsBtn = document.getElementById('theme-settings-btn');
  if (btn) btn.textContent = isLightTheme ? '☀️' : '🌙';
  if (settingsBtn) settingsBtn.textContent = isLightTheme ? 'Switch to Dark' : 'Switch to Light';
  localStorage.setItem('nebula-theme', isLightTheme ? 'light' : 'dark');
}

function loadTheme() {
  const saved = localStorage.getItem('nebula-theme');
  if (saved === 'light') {
    isLightTheme = true;
    document.body.classList.add('light-theme');
    const btn = document.getElementById('theme-btn');
    if (btn) btn.textContent = '☀️';
  }
}

// Settings / schedule
async function loadSettings() {
  try {
    const sched = await window.nebula.getSchedule();
    const toggle = document.getElementById('schedule-toggle');
    if (toggle) toggle.checked = !!sched.enabled;
  } catch (e) {}
  const settingsBtn = document.getElementById('theme-settings-btn');
  if (settingsBtn) settingsBtn.textContent = isLightTheme ? 'Switch to Dark' : 'Switch to Light';
}

async function saveSchedule() {
  const toggle = document.getElementById('schedule-toggle');
  await window.nebula.setSchedule({ enabled: toggle ? toggle.checked : false, lastNotified: null });
  showToast(toggle && toggle.checked ? 'Weekly reminder enabled' : 'Weekly reminder disabled', 'success');
}

async function checkScheduleNow() {
  const res = await window.nebula.triggerScheduleCheck();
  showToast(res.triggered ? 'Notification sent!' : 'Not due yet (less than 7 days since last)', 'success');
}

// Init
initStars();
loadDiskInfo();
loadDrives();
loadTheme();
