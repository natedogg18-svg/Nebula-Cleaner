const { chromium } = require('@playwright/test');
const path = require('path');

(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: ['--no-sandbox']
  });
  const page = await browser.newPage();
  const logs = [];
  page.on('console', msg => logs.push(`[${msg.type()}] ${msg.text()}`));
  page.on('pageerror', err => logs.push(`[PAGEERROR] ${err.message}`));

  await page.addInitScript(() => {
    let moveToBinCalls = [];
    let moveToDriveCalls = [];
    const mockFile = { path: 'C:\\Downloads\\movie.mkv', name: 'movie.mkv', size: 182*1024*1024, sizeFormatted: '182 MB', mtime: new Date().toISOString() };
    window.nebula = {
      selectDirectory: async () => 'C:\\Downloads',
      scanLargeFiles: async () => [mockFile],
      scanJunk: async () => [], scanDuplicates: async () => [],
      scanOldFiles: async () => [], scanEmptyFolders: async () => [],
      getBin: async () => [],
      getDiskInfo: async () => ({ totalMem: 16*1024*1024*1024, freeMem: 8*1024*1024*1024, homedir:'C:\\Users\\test', platform:'win32' }),
      getDrives: async () => [
        { path: 'C:\\', label: 'Windows', freeFormatted: '50 GB', sizeFormatted: '500 GB', size: 1 },
        { path: 'E:\\', label: 'External', freeFormatted: '200 GB', sizeFormatted: '500 GB', size: 1 },
      ],
      analyzeSpace: async () => [mockFile],
      moveToDrive: async (paths, dest) => { moveToDriveCalls.push({paths,dest}); return paths.map(p=>({success:true,path:p})); },
      moveToBin: async (paths) => { moveToBinCalls.push(paths); return paths.map(p=>({success:true,path:p})); },
      restoreFromBin: async () => ({success:true}), deleteFromBin: async () => ({success:true}),
      getSchedule: async () => ({enabled:false}), setSchedule: async () => {},
      minimize:()=>{}, maximize:()=>{}, close:()=>{}, onProgress:(cb)=>{},
    };
    window._binCalls = () => moveToBinCalls;
    window._moveCalls = () => moveToDriveCalls;
  });

  await page.goto(`file://${path.resolve('/home/user/Nebula-Cleaner/src/renderer/index.html')}`);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(600);

  // Go to Large Files, scan, select, move to bin
  console.log('=== Large Files tab: Move to Bin ===');
  await page.click('[data-tab="large"]');
  await page.waitForTimeout(300);
  await page.click('button[onclick="rescanLarge()"]').catch(async () => {
    // try scan button
    const btns = await page.$$('button');
    for (const b of btns) {
      const txt = await b.textContent();
      if (txt.includes('Scan') || txt.includes('Rescan')) { await b.click(); break; }
    }
  });
  await page.waitForTimeout(800);

  const fileItems = await page.$$('#large-list .file-item');
  console.log(`File items after scan: ${fileItems.length}`);

  if (fileItems.length > 0) {
    // Check the checkbox
    const cb = await page.$('#large-list .file-item input[type="checkbox"]');
    if (cb) await cb.check();
    await page.waitForTimeout(200);

    // Click Move to Bin
    await page.click('button[onclick="sendSelectedToBin(\'large\')"]').catch(() => console.log('bin btn not found by onclick'));
    await page.waitForTimeout(500);

    const binCalls = await page.evaluate(() => window._binCalls());
    console.log(`moveToBin called with: ${JSON.stringify(binCalls)}`);
  } else {
    const largeHtml = await page.$eval('#large-list', el => el.innerHTML.substring(0,200)).catch(()=>'not found');
    console.log(`large-list HTML: ${largeHtml}`);
  }

  // Go to Space Analyzer, move to drive
  console.log('\n=== Space Analyzer: Move to Drive ===');
  await page.click('[data-tab="analyzer"]');
  await page.waitForTimeout(1000);
  const moveBtns = await page.$$('.analyzer-move');
  console.log(`Analyzer move btns: ${moveBtns.length}`);
  if (moveBtns.length > 0) {
    await moveBtns[0].click();
    await page.waitForTimeout(400);
    const driveBtns = await page.$$('#move-drive-list .drive-pick-btn');
    console.log(`Drive pick buttons: ${driveBtns.length}`);
    if (driveBtns.length >= 2) { await driveBtns[1].click(); await page.waitForTimeout(500); }
  }

  const moveCalls = await page.evaluate(() => window._moveCalls());
  console.log(`moveToDrive calls: ${JSON.stringify(moveCalls)}`);
  const toasts = await page.$$eval('.toast', els => els.map(e=>e.textContent.trim())).catch(()=>[]);
  console.log(`Toasts: ${JSON.stringify(toasts)}`);
  if (logs.length) { console.log('\n--- Errors ---'); logs.forEach(l=>console.log(l)); }

  await browser.close();
})();
