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
  const badgeHtml = badge ? `<span class="file-badge ${badge === 'Original' ? 'badge-original' : 'badge-dupe'}">${badge}</span>` : '';
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
    html += `<div class="dup-group"><div class="dup-group-header">Group ${gi+1} — ${group.length} identical files (${group[0].sizeFormatted} each)</div>`;
    group.forEach((f, i) => { html += fileItem(f, i > 0, i === 0 ? 'Original' : 'Duplicate'); });
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
    if (badge && badge.classList.contains('badge-dupe')) c.checked = true;
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
  await runScan(type, true);
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

// Init
initStars();
loadDiskInfo();
