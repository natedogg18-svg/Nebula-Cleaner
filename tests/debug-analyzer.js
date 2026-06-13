const { chromium } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

(async () => {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1200, height: 800 });

  // Mock nebula API
  await page.addInitScript(() => {
    window.nebula = {
      selectDirectory: async () => 'C:\\',
      scanDuplicates: async () => [],
      scanLargeFiles: async () => [],
      scanJunk: async () => [],
      moveToBin: async (p) => p.map(x => ({ success: true, path: x })),
      getBin: async () => [],
      restoreFromBin: async () => ({ success: true }),
      deleteFromBin: async () => ({ success: true }),
      getDiskInfo: async () => ({ totalMem: 34 * 1e9, freeMem: 9.1 * 1e9, homedir: 'C:\\Users\\nated', platform: 'win32' }),
      getDrives: async () => [
        { path: 'C:\\', label: 'Windows', freeFormatted: '120 GB', sizeFormatted: '476 GB' },
        { path: 'D:\\', label: 'Data', freeFormatted: '500 GB', sizeFormatted: '1 TB' },
        { path: 'E:\\', label: 'External', freeFormatted: '200 GB', sizeFormatted: '2 TB' },
      ],
      analyzeSpace: async (dir) => [
        { name: 'Users', path: dir + 'Users', size: 150 * 1e9, sizeFormatted: '150 GB', type: 'folder' },
        { name: 'Program Files', path: dir + 'Program Files', size: 40 * 1e9, sizeFormatted: '40 GB', type: 'folder' },
        { name: 'adobeTemp', path: dir + 'adobeTemp', size: 20 * 1e9, sizeFormatted: '20 GB', type: 'folder' },
        { name: 'Games', path: dir + 'Games', size: 80 * 1e9, sizeFormatted: '80 GB', type: 'folder' },
        { name: 'pagefile.sys', path: dir + 'pagefile.sys', size: 16 * 1e9, sizeFormatted: '16 GB', type: 'file' },
      ],
      minimize: () => {}, maximize: () => {}, close: () => {},
    };
  });

  const htmlPath = `file://${path.resolve(__dirname, '../src/renderer/index.html')}`;
  await page.goto(htmlPath);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(500);

  // Screenshot dashboard
  await page.screenshot({ path: 'tests/screenshots/debug-dashboard.png', fullPage: true });
  console.log('✅ Dashboard');

  // Click Space Analyzer
  await page.click('[data-tab="analyzer"]');
  await page.waitForTimeout(2000); // wait for analyzeSpace mock
  await page.screenshot({ path: 'tests/screenshots/debug-analyzer.png', fullPage: true });
  console.log('✅ Space Analyzer - check tests/screenshots/debug-analyzer.png');

  // Check if content is visible
  const barsVisible = await page.locator('#analyzer-bars').isVisible();
  const barsContent = await page.locator('#analyzer-bars').innerText();
  console.log('analyzer-bars visible:', barsVisible);
  console.log('analyzer-bars content preview:', barsContent.slice(0, 100));

  await browser.close();
})();
