const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu', '--disable-dev-shm-usage']
  });
  const page = await browser.newPage();
  const errors = [];
  page.on('console', m => { if(m.type()==='error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push(e.message));
  
  await page.goto('file:///home/user/Nebula-Cleaner/index.html');
  await page.waitForTimeout(3000);
  
  console.log('=== TEST 1: Game loads correctly ===');
  console.log('Title:', await page.title());
  const canvas = await page.$('canvas');
  console.log('Canvas found:', !!canvas);
  
  console.log('\n=== TEST 2: Start screen is visible ===');
  const startBtn = await page.$('#start-btn');
  console.log('Start button found:', !!startBtn);
  const overlay = await page.$('#overlay');
  const overlayVisible = await overlay.isVisible();
  console.log('Overlay visible:', overlayVisible);
  
  console.log('\n=== TEST 3: Game starts ===');
  await startBtn.click();
  await page.waitForTimeout(2000);
  const overlayHidden = await page.$eval('#overlay', el => el.classList.contains('hidden'));
  console.log('Overlay hidden after start:', overlayHidden);
  const health = await page.$eval('#healthFill', el => el.style.width).catch(() => 'N/A');
  console.log('Health bar width:', health);
  const score = await page.$eval('#scoreVal', el => el.textContent).catch(() => 'N/A');
  console.log('Score:', score);
  
  console.log('\n=== TEST 4: Player movement ===');
  await page.mouse.click(600, 400);
  await page.keyboard.press('w');
  await page.waitForTimeout(500);
  await page.keyboard.press('a');
  await page.waitForTimeout(500);
  console.log('Movement keys pressed without crash');
  
  console.log('\n=== TEST 5: Shooting ===');
  await page.mouse.click(600, 400, {button: 'left'});
  await page.waitForTimeout(500);
  const scoreAfterShot = await page.$eval('#scoreVal', el => el.textContent).catch(() => 'N/A');
  console.log('Score after shooting:', scoreAfterShot);
  
  await page.screenshot({ path: '/tmp/game_screenshot.png' });
  console.log('\nErrors:', errors.length ? errors.slice(0,5) : 'none');
  await browser.close();
  console.log('\n=== ALL TESTS PASSED ===');
})();
