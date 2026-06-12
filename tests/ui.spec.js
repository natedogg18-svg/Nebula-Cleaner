const { test, expect, chromium } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const os = require('os');

const APP_URL = `file://${path.resolve(__dirname, '../src/renderer/index.html')}`;

test.describe('Nebula Cleaner UI', () => {
  let browser, page;

  test.beforeAll(async () => {
    browser = await chromium.launch({ headless: false });
    page = await browser.newPage();
    // Mock window.nebula API since we're in a browser, not Electron
    await page.addInitScript(() => {
      const mockFiles = [
        { path: 'C:\\TestDir\\bigfile1.mp4', name: 'bigfile1.mp4', size: 1024*1024*200, sizeFormatted: '200 MB', mtime: new Date().toISOString() },
        { path: 'C:\\TestDir\\bigfile2.zip', name: 'bigfile2.zip', size: 1024*1024*150, sizeFormatted: '150 MB', mtime: new Date().toISOString() },
      ];
      const mockDupes = [[
        { path: 'C:\\TestDir\\photo.jpg', name: 'photo.jpg', size: 1024*500, sizeFormatted: '500 KB', mtime: new Date().toISOString() },
        { path: 'C:\\TestDir\\sub\\photo.jpg', name: 'photo.jpg', size: 1024*500, sizeFormatted: '500 KB', mtime: new Date().toISOString() },
      ]];
      const mockJunk = [
        { path: 'C:\\TestDir\\temp.tmp', name: 'temp.tmp', size: 1024, sizeFormatted: '1 KB', mtime: new Date().toISOString() },
        { path: 'C:\\TestDir\\debug.log', name: 'debug.log', size: 2048, sizeFormatted: '2 KB', mtime: new Date().toISOString() },
      ];
      let binItems = [];

      window.nebula = {
        selectDirectory: async () => 'C:\\TestDir',
        scanDuplicates: async () => mockDupes,
        scanLargeFiles: async () => mockFiles,
        scanJunk: async () => mockJunk,
        moveToBin: async (paths) => {
          paths.forEach(p => {
            const name = p.split('\\').pop();
            binItems.push({ id: Date.now() + '_' + Math.random().toString(36).slice(2), originalPath: p, name, size: 1024*100, sizeFormatted: '100 KB', deletedAt: new Date().toISOString() });
          });
          return paths.map(p => ({ success: true, path: p }));
        },
        getBin: async () => binItems,
        restoreFromBin: async (id) => { binItems = binItems.filter(i => i.id !== id); return { success: true }; },
        deleteFromBin: async (ids) => { binItems = binItems.filter(i => !ids.includes(i.id)); return { success: true }; },
        getDiskInfo: async () => ({ totalMem: 16*1024*1024*1024, freeMem: 8*1024*1024*1024, homedir: 'C:\\Users\\test', platform: 'win32' }),
        minimize: () => {}, maximize: () => {}, close: () => {},
      };
    });
    await page.goto(APP_URL);
    await page.waitForLoadState('domcontentloaded');
  });

  test.afterAll(async () => {
    await browser.close();
  });

  test('loads with space theme and dashboard', async () => {
    await expect(page.locator('.app-name')).toHaveText('Nebula Cleaner');
    await expect(page.locator('#tab-dashboard')).toBeVisible();
    await expect(page.locator('.stars')).toBeVisible();
    await page.screenshot({ path: 'tests/screenshots/01-dashboard.png' });
  });

  test('sidebar navigation switches tabs', async () => {
    for (const tab of ['duplicates', 'large', 'junk', 'bin', 'dashboard']) {
      await page.click(`[data-tab="${tab}"]`);
      await expect(page.locator(`#tab-${tab}`)).toBeVisible();
    }
    await page.screenshot({ path: 'tests/screenshots/02-navigation.png' });
  });

  test('error toast when scanning without directory', async () => {
    await page.click('#scan-all-btn');
    await expect(page.locator('.toast')).toBeVisible();
    await expect(page.locator('.toast')).toContainText('select a directory');
    await page.screenshot({ path: 'tests/screenshots/03-no-dir-error.png' });
  });

  test('full scan populates all tabs with mock data', async () => {
    // Set directory via mock
    await page.evaluate(() => { document.getElementById('dir-input').value = 'C:\\TestDir'; window._state_dir = 'C:\\TestDir'; });
    await page.evaluate(() => { window.state = window.state || {}; state.dir = 'C:\\TestDir'; });
    // Click browse to set dir properly
    await page.evaluate(async () => {
      const dir = await window.nebula.selectDirectory();
      document.getElementById('dir-input').value = dir;
      state.dir = dir;
    });
    await page.click('#scan-all-btn');
    await page.waitForTimeout(1000);
    // Check result cards updated
    await expect(page.locator('#result-large')).not.toHaveText('—');
    await expect(page.locator('#result-junk')).not.toHaveText('—');
    await page.screenshot({ path: 'tests/screenshots/04-scan-results.png' });
  });

  test('large files tab shows results and select all works', async () => {
    await page.click('[data-tab="large"]');
    await expect(page.locator('#large-list .file-item')).toHaveCount(2);
    await page.click('button:has-text("Select All")');
    const checked = await page.locator('#large-list input[type=checkbox]:checked').count();
    expect(checked).toBe(2);
    await page.screenshot({ path: 'tests/screenshots/05-large-files.png' });
  });

  test('move large files to bin shows success toast', async () => {
    await page.click('[data-tab="large"]');
    await page.click('button:has-text("Select All")');
    await page.click('button:has-text("Move to Bin")');
    await expect(page.locator('.toast')).toBeVisible();
    await expect(page.locator('.toast')).toContainText('Moved 2 file(s) to bin');
    await page.screenshot({ path: 'tests/screenshots/06-moved-to-bin.png' });
  });

  test('recycle bin shows moved files', async () => {
    await page.click('[data-tab="bin"]');
    await page.waitForTimeout(300);
    await expect(page.locator('#bin-list .file-item')).toHaveCount(2);
    await page.screenshot({ path: 'tests/screenshots/07-bin-contents.png' });
  });

  test('restore from bin works', async () => {
    await page.click('[data-tab="bin"]');
    await page.waitForTimeout(300);
    await page.locator('#bin-list input[type=checkbox]').first().check();
    await page.click('button:has-text("Restore Selected")');
    await expect(page.locator('.toast')).toContainText('Restored');
    await page.screenshot({ path: 'tests/screenshots/08-restore.png' });
  });

  test('delete forever from bin works', async () => {
    await page.click('[data-tab="bin"]');
    await page.waitForTimeout(300);
    await page.click('button:has-text("Select All")');
    await page.click('button:has-text("Delete Forever")');
    await expect(page.locator('.toast')).toContainText('deleted');
    await page.screenshot({ path: 'tests/screenshots/09-deleted.png' });
  });

  test('junk files tab shows results', async () => {
    await page.click('[data-tab="junk"]');
    await expect(page.locator('#junk-list .file-item')).toHaveCount(2);
    await page.screenshot({ path: 'tests/screenshots/10-junk-files.png' });
  });

  test('duplicates tab shows groups', async () => {
    await page.click('[data-tab="duplicates"]');
    await expect(page.locator('.dup-group')).toHaveCount(1);
    await page.screenshot({ path: 'tests/screenshots/11-duplicates.png' });
  });

  test('error when moving to bin with nothing selected', async () => {
    await page.click('[data-tab="large"]');
    // Uncheck all
    await page.evaluate(() => document.querySelectorAll('#large-list input[type=checkbox]').forEach(c => c.checked = false));
    await page.click('button:has-text("Move to Bin")');
    await expect(page.locator('.toast')).toContainText('No files selected');
    await page.screenshot({ path: 'tests/screenshots/12-no-selection-error.png' });
  });

  test('window control buttons exist', async () => {
    await expect(page.locator('.ctrl-btn.minimize')).toBeVisible();
    await expect(page.locator('.ctrl-btn.maximize')).toBeVisible();
    await expect(page.locator('.ctrl-btn.close')).toBeVisible();
    await page.screenshot({ path: 'tests/screenshots/13-window-controls.png' });
  });
});
