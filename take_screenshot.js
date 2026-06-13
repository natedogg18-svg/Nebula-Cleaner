const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu', '--disable-dev-shm-usage']
  });
  const page = await browser.newPage();
  await page.setViewportSize({width: 1280, height: 720});
  await page.goto('file:///home/user/Nebula-Cleaner/index.html');
  await page.waitForTimeout(2000);
  await page.screenshot({ path: '/tmp/start_screen.png' });
  const startBtn = await page.$('#start-btn');
  await startBtn.click();
  await page.waitForTimeout(3000);
  await page.screenshot({ path: '/tmp/gameplay.png' });
  await browser.close();
  console.log('done');
})();
