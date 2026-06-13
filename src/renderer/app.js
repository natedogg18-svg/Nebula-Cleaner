// State
const state = {
  dir: '',
  duplicates: [],
  largeFiles: [],
  junkFiles: [],
  binItems: [],
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
  document.querySelector(`[data-tab="${tab}"]`).classList.add('active');
  if (tab === 'bin') loadBin();
  if (tab === 'analyzer') runAnalyzer();
}

// Toast
let toastTimeout;
function showToast(msg, type = '') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = `toast show ${type}`;
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => t.classList.remove('show'), 3000);
}

// Status
function setStatus(msg, loading = false) {
  const s = document.getElementById('scan-status');
  s.innerHTML = loading ? `<span class="spinner"></span>${msg}` : msg;
}

// Pick directory
async function pickDirectory() {
  const dir = await window.nebula.selectDirectory();
  if (dir) {
    state.dir = dir;
    document.getElementById('dir-input').value = dir;
    setStatus('');
    ['duplicates','large','junk'].forEach(k => { document.getElementById(`result-${k}`).textContent = '—'; });
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
      if (!silent) setStatus('Scanning...', true);
      const groups = await window.nebula.scanDuplicates(state.dir);
      state.duplicates = groups;
      const total = groups.reduce((s, g) => s + g.length, 0);
      document.getElementById('result-duplicates').textContent = `${groups.length} groups (${total} files)`;
      renderDuplicates();
    } else if (type === 'large') {
      const minMB = parseInt(document.getElementById('min-size')?.value || 50);
      const files = await window.nebula.scanLargeFiles(state.dir, minMB);
      state.largeFiles = files;
      document.getElementById('result-large').textContent = `${files.length} files`;
      renderLargeFiles();
    } else if (type === 'junk') {
      const files = await window.nebula.scanJunk(state.dir);
      state.junkFiles = files;
      document.getElementById('result-junk').textContent = `${files.length} files`;
      renderJunkFiles();
    }
    if (!silent) setStatus('');
  } catch (e) {
    if (!silent) setStatus(`Error: ${e.message}`);
  }
}

async function rescanLarge() {
  await runScan('large');
}

// Render helpers
function emptyState(icon, msg) {
  return `<div class="empty-state"><div class="icon">${icon}</div><div>${msg}</div></div>`;
}

function fileItem(file, checked = false, badge = '') {
  const badgeClass = badge === 'Original' ? 'badge-original' : badge === 'Similar' ? 'badge-similar' : 'badge-dupe';
  const badgeHtml = badge ? `<span class="file-badge ${badgeClass}">${badge}</span>` : '';
  return `
    <div class="file-item">
      <input type="checkbox" ${checked ? 'checked' : ''} data-path="${escHtml(file.path)}" />
      <div class="file-info">
        <div class="file-name">${escHtml(file.name)}</div>
        <div class="file-path">${escHtml(file.path)}</div>
      </div>
      ${badgeHtml}
      <div class="file-size">${file.sizeFormatted}</div>
    </div>`;
}

function escHtml(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function renderDuplicates() {
  const list = document.getElementById('duplicate-list');
  if (!state.duplicates.length) { list.innerHTML = emptyState('👯', 'No duplicates found'); document.getElementById('dup-count').textContent = ''; return; }
  let html = '';
  let totalWaste = 0;
  state.duplicates.forEach((group, gi) => {
    const waste = group[0].size * (group.length - 1);
    totalWaste += waste;
    const isExact = group[0].matchType === 'exact';
    const label = isExact ? `${group.length} identical files (${group[0].sizeFormatted} each)` : `${group.length} similar files — review before deleting`;
    const icon = isExact ? '🔴 Exact Duplicates' : '🟡 Similar Names';
    html += `<div class="dup-group"><div class="dup-group-header">${icon} · Group ${gi+1} — ${label}</div>`;
    group.forEach((f, i) => { html += fileItem(f, isExact && i > 0, i === 0 ? 'Original' : isExact ? 'Duplicate' : 'Similar'); });
    html += '</div>';
  });
  list.innerHTML = html;
  const wasteGB = (totalWaste / 1e9).toFixed(2);
  document.getElementById('dup-count').textContent = `${state.duplicates.length} groups · ~${wasteGB} GB recoverable`;
}

function renderLargeFiles() {
  const list = document.getElementById('large-list');
  if (!state.largeFiles.length) { list.innerHTML = emptyState('🌍', 'No large files found'); document.getElementById('large-count').textContent = ''; return; }
  list.innerHTML = state.largeFiles.map(f => fileItem(f)).join('');
  document.getElementById('large-count').textContent = `${state.largeFiles.length} files`;
}

function renderJunkFiles() {
  const list = document.getElementById('junk-list');
  if (!state.junkFiles.length) { list.innerHTML = emptyState('🗑️', 'No junk files found'); document.getElementById('junk-count').textContent = ''; return; }
  list.innerHTML = state.junkFiles.map(f => fileItem(f)).join('');
  document.getElementById('junk-count').textContent = `${state.junkFiles.length} files`;
}

async function loadBin() {
  state.binItems = await window.nebula.getBin();
  renderBin();
}

function renderBin() {
  const list = document.getElementById('bin-list');
  if (!state.binItems.length) { list.innerHTML = emptyState('♻️', 'Recycle bin is empty'); document.getElementById('bin-count').textContent = ''; return; }
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
    const badge = item.querySelector('.file-badge');
    // Select everything that isn't marked Original
    if (!badge || !badge.classList.contains('badge-original')) c.checked = true;
  });
}

// Send to bin
async function sendSelectedToBin(type) {
  const listId = type === 'duplicates' ? 'duplicate-list' : type === 'large' ? 'large-list' : 'junk-list';
  const checked = [...document.querySelectorAll(`#${listId} input[type=checkbox]:checked`)];
  if (!checked.length) { showToast('No files selected', 'error'); return; }
  const paths = checked.map(c => c.dataset.path);
  showToast(`⏳ Moving ${paths.length} file(s) to bin... please wait`);
  const results = await window.nebula.moveToBin(paths);
  const ok = results.filter(r => r.success).length;
  const fail = results.length - ok;
  const firstErr = results.find(r => !r.success);
  const errDetail = firstErr ? ` — ${firstErr.error}` : '';
  console.error('Bin results:', results.filter(r => !r.success));
  showToast(`Moved ${ok} file(s) to bin${fail ? ` (${fail} failed${errDetail})` : ''}`, ok > 0 ? 'success' : 'error');

  // Remove successfully moved files from state and re-render without rescanning
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
  }
}

// Restore
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
  const dir = state.dir || 'C:\\';
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
  const drives = await window.nebula.getDrives();
  const modal = document.getElementById('move-modal');
  const list = document.getElementById('move-drive-list');
  list.innerHTML = drives.map(d => `
    <button class="btn drive-pick-btn" onclick="confirmMoveToDrive('${d.path.replace(/\\/g, '\\\\')}')">
      💾 ${d.path} <span class="drive-name">${d.label || ''}</span>
      <span class="drive-free">${d.freeFormatted} free</span>
    </button>`).join('');
  modal.classList.add('show');
}

function closeModal() {
  document.getElementById('move-modal').classList.remove('show');
  pendingMovePath = null;
}

async function confirmMoveToDrive(destDrive) {
  closeModal();
  if (!pendingMovePath) return;
  showToast(`⏳ Moving to ${destDrive}... please wait`);
  const results = await window.nebula.moveToDrive([pendingMovePath], destDrive);
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
    // Refresh current analyzer view
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
    <button class="btn btn-drive" onclick="selectDrive('${d.path.replace(/\\/g, '\\\\')}', '${d.label}')" title="${d.freeFormatted || ''} free of ${d.sizeFormatted || ''}">
      💾 ${d.path} ${d.label ? `<span class="drive-name">${d.label}</span>` : ''}
      ${d.size ? `<span class="drive-free">${d.freeFormatted} free</span>` : ''}
    </button>`).join('');
}

function selectDrive(drivePath, label) {
  state.dir = drivePath;
  document.getElementById('dir-input').value = drivePath;
  setStatus(`Selected drive: ${drivePath} — click Launch Full Scan`);
  document.querySelectorAll('.btn-drive').forEach(b => b.classList.remove('active-drive'));
  event.target.closest('.btn-drive').classList.add('active-drive');
}

// Init
initStars();
loadDiskInfo();
loadDrives();
