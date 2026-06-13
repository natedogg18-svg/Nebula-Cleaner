const { chromium } = require('@playwright/test');
const path = require('path');

const APP_URL = `file://${path.resolve(__dirname, '../src/renderer/index.html')}`;

(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: ['--no-sandbox']
  });
  const page = await browser.newPage();

  const logs = [];
  page.on('console', msg => logs.push(`[${msg.type()}] ${msg.text()}`));
  page.on('pageerror', err => logs.push(`[ERROR] ${err.message}`));

  await page.addInitScript(() => {
    let moveToDriveCalls = [];
    let moveToBinCalls = [];

    const mockAnalyzerData = [
      { path: 'C:\\Downloads\\Marvel Comics', type: 'dir', size: 5*1024*1024*1024, sizeFormatted: '5 GB', children: [] },
      { path: 'C:\\Downloads\\movie.mkv', type: 'file', size: 2*1024*1024*1024, sizeFormatted: '2 GB', children: [] },
    ];

    window.nebula = {
      selectDirectory: async () => 'C:\\Downloads',
      scanLargeFiles: async () => [],
      scanJunk: async () => [],
      scanDuplicates: async () => [],
      scanOldFiles: async () => [],
      scanEmptyFolders: async () => [],
      getBin: async () => [],
      getDiskInfo: async () => ({ totalMem: 16*1024*1024*1024, freeMem: 8*1024*1024*1024, homedir: 'C:\\Users\\test', platform: 'win32' }),
      getDrives: async () => [
        { path: 'C:\\', label: 'Windows (C:)', freeFormatted: '50 GB', sizeFormatted: '500 GB', size: 500*1024*1024*1024 },
        { path: 'E:\\', label: 'External (E:)', freeFormatted: '200 GB', sizeFormatted: '500 GB', size: 500*1024*1024*1024 },
      ],
      analyzeSpace: async (dir) => mockAnalyzerData,
      moveToDrive: async (paths, dest) => {
        moveToDriveCalls.push({ paths, dest });
        return paths.map(p => ({ success: true, path: p }));
      },
      moveToBin: async (paths) => {
        moveToBinCalls.push(paths);
        return paths.map(p => ({ success: true, path: p }));
      },
      restoreFromBin: async () => ({ success: true }),
      deleteFromBin: async () => ({ success: true }),
      getSchedule: async () => ({ enabled: false }),
      setSchedule: async () => {},
      minimize: () => {}, maximize: () => {}, close: () => {},
      onProgress: (cb) => {},
    };

    window._getMoveToDriveCalls = () => moveToDriveCalls;
    window._getMoveToBinCalls = () => moveToBinCalls;
  });

  const appUrl = `file://${path.resolve('/home/user/Nebula-Cleaner/src/renderer/index.html')}`;
  await page.goto(appUrl);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(500);

  // Navigate to Space Analyzer
  await page.click('[data-tab="analyzer"]');
  await page.waitForTimeout(1000);

  // Check analyzer rows
  const rows = await page.$$('.analyzer-row');
  console.log(`Analyzer rows: ${rows.length}`);

  for (const row of rows) {
    const dataPath = await row.getAttribute('data-path');
    const dataType = await row.getAttribute('data-type');
    console.log(`Row: path="${dataPath}" type="${dataType}"`);
  }

  // Check if Move buttons exist
  const moveBtns = await page.$$('.analyzer-move');
  console.log(`Move buttons: ${moveBtns.length}`);

  if (moveBtns.length > 0) {
    // Click the first Move button
    await moveBtns[0].click();
    await page.waitForTimeout(500);

    // Check if modal opened
    const modal = await page.$('#move-modal');
    const isVisible = modal ? await modal.isVisible() : false;
    console.log(`Move modal visible: ${isVisible}`);

    if (isVisible) {
      // Check drive list
      const driveItems = await page.$$('#move-drive-list .drive-pick-btn');
      console.log(`Drive options in modal: ${driveItems.length}`);

      for (const item of driveItems) {
        const text = await item.textContent();
        console.log(`Drive option: ${text.trim().substring(0, 50)}`);
      }

      if (driveItems.length > 0) {
        // Click last drive (E:)
        await driveItems[driveItems.length - 1].click();
        await page.waitForTimeout(500);
      } else {
        console.log('NO DRIVE OPTIONS - checking modal HTML');
        const modalHtml = await page.$eval('#move-modal', el => el.innerHTML);
        console.log(`Modal HTML: ${modalHtml.substring(0, 500)}`);
      }
    } else {
      console.log('Modal not visible - checking why');
      const modalHtml = await page.$eval('#move-modal', el => el.outerHTML).catch(() => 'not found');
      console.log(`Modal: ${modalHtml.substring(0, 200)}`);
    }
  }

  // Check calls
  const moveCalls = await page.evaluate(() => window._getMoveToDriveCalls());
  console.log(`moveToDrive calls: ${JSON.stringify(moveCalls)}`);

  // Check toasts
  const toasts = await page.$$('.toast');
  for (const t of toasts) {
    console.log(`Toast: ${await t.textContent()}`);
  }

  // Print all logs
  console.log('\n--- Console logs ---');
  logs.forEach(l => console.log(l));

  await browser.close();
})();
