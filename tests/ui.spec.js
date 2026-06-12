const { test, expect, chromium } = require('@playwright/test');
const path = require('path');

const APP_URL = `file://${path.resolve(__dirname, '../src/renderer/index.html')}`;

test.describe('Nebula Cleaner UI', () => {
  let browser, page;

  test.beforeAll(async () => {
    browser = await chromium.launch({ headless: false });
    page = await browser.newPage();
    await page.goto(APP_URL);
    await page.waitForLoadState('domcontentloaded');
  });

  test.afterAll(async () => {
    await browser.close();
  });

  test('loads with space theme and dashboard visible', async () => {
    await expect(page.locator('.app-name')).toHaveText('Nebula Cleaner');
    await expect(page.locator('#tab-dashboard')).toBeVisible();
    await expect(page.locator('.stars')).toBeVisible();
    await page.screenshot({ path: 'tests/screenshots/dashboard.png' });
  });

  test('sidebar navigation works', async () => {
    // Click Duplicates
    await page.click('[data-tab="duplicates"]');
    await expect(page.locator('#tab-duplicates')).toBeVisible();
    await page.screenshot({ path: 'tests/screenshots/duplicates-tab.png' });

    // Click Large Files
    await page.click('[data-tab="large"]');
    await expect(page.locator('#tab-large')).toBeVisible();
    await page.screenshot({ path: 'tests/screenshots/large-tab.png' });

    // Click Junk
    await page.click('[data-tab="junk"]');
    await expect(page.locator('#tab-junk')).toBeVisible();
    await page.screenshot({ path: 'tests/screenshots/junk-tab.png' });

    // Click Recycle Bin
    await page.click('[data-tab="bin"]');
    await expect(page.locator('#tab-bin')).toBeVisible();
    await page.screenshot({ path: 'tests/screenshots/bin-tab.png' });

    // Back to dashboard
    await page.click('[data-tab="dashboard"]');
    await expect(page.locator('#tab-dashboard')).toBeVisible();
  });

  test('shows error toast when scanning without directory', async () => {
    await page.click('#scan-all-btn');
    await expect(page.locator('.toast')).toBeVisible();
    await expect(page.locator('.toast')).toContainText('select a directory');
    await page.screenshot({ path: 'tests/screenshots/no-dir-error.png' });
  });

  test('shows error when moving to bin with nothing selected', async () => {
    await page.click('[data-tab="large"]');
    await page.click('button:has-text("Move to Bin")');
    await expect(page.locator('.toast')).toBeVisible();
    await expect(page.locator('.toast')).toContainText('No files selected');
    await page.screenshot({ path: 'tests/screenshots/no-selection-error.png' });
  });

  test('recycle bin shows empty state', async () => {
    await page.click('[data-tab="bin"]');
    await expect(page.locator('#bin-list')).toContainText('empty');
    await page.screenshot({ path: 'tests/screenshots/empty-bin.png' });
  });

  test('window control buttons exist', async () => {
    await expect(page.locator('.ctrl-btn.minimize')).toBeVisible();
    await expect(page.locator('.ctrl-btn.maximize')).toBeVisible();
    await expect(page.locator('.ctrl-btn.close')).toBeVisible();
  });
});
