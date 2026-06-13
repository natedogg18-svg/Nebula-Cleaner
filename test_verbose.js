const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu', '--disable-dev-shm-usage']
  });
  const page = await browser.newPage();
  page.on('console', m => console.log(`[${m.type()}]`, m.text()));
  page.on('pageerror', e => { console.log('PAGEERROR:', e.message); console.log(e.stack); });
  await page.goto('file:///home/user/Nebula-Cleaner/index.html');
  await page.waitForTimeout(2000);
  const startBtn = await page.$('#start-btn');
  await startBtn.click();
  await page.waitForTimeout(3000);
  await browser.close();
})();
