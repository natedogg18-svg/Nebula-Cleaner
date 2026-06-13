# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: ui.spec.js >> Nebula Cleaner UI >> duplicates tab shows groups
- Location: tests\ui.spec.js:146:3

# Error details

```
Error: expect(locator).toHaveCount(expected) failed

Locator:  locator('.dup-group')
Expected: 1
Received: 0
Timeout:  5000ms

Call log:
  - Expect "toHaveCount" with timeout 5000ms
  - waiting for locator('.dup-group')
    14 × locator resolved to 0 elements
       - unexpected value "0"

```

# Test source

```ts
  48  |     });
  49  |     await page.goto(APP_URL);
  50  |     await page.waitForLoadState('domcontentloaded');
  51  |   });
  52  | 
  53  |   test.afterAll(async () => {
  54  |     await browser.close();
  55  |   });
  56  | 
  57  |   test('loads with space theme and dashboard', async () => {
  58  |     await expect(page.locator('.app-name')).toHaveText('Nebula Cleaner');
  59  |     await expect(page.locator('#tab-dashboard')).toBeVisible();
  60  |     await expect(page.locator('.stars')).toBeVisible();
  61  |     await page.screenshot({ path: 'tests/screenshots/01-dashboard.png' });
  62  |   });
  63  | 
  64  |   test('sidebar navigation switches tabs', async () => {
  65  |     for (const tab of ['duplicates', 'large', 'junk', 'bin', 'dashboard']) {
  66  |       await page.click(`[data-tab="${tab}"]`);
  67  |       await expect(page.locator(`#tab-${tab}`)).toBeVisible();
  68  |     }
  69  |     await page.screenshot({ path: 'tests/screenshots/02-navigation.png' });
  70  |   });
  71  | 
  72  |   test('error toast when scanning without directory', async () => {
  73  |     await page.click('#scan-all-btn');
  74  |     await expect(page.locator('.toast')).toBeVisible();
  75  |     await expect(page.locator('.toast')).toContainText('select a directory');
  76  |     await page.screenshot({ path: 'tests/screenshots/03-no-dir-error.png' });
  77  |   });
  78  | 
  79  |   test('full scan populates all tabs with mock data', async () => {
  80  |     // Set directory via mock
  81  |     await page.evaluate(() => { document.getElementById('dir-input').value = 'C:\\TestDir'; window._state_dir = 'C:\\TestDir'; });
  82  |     await page.evaluate(() => { window.state = window.state || {}; state.dir = 'C:\\TestDir'; });
  83  |     // Click browse to set dir properly
  84  |     await page.evaluate(async () => {
  85  |       const dir = await window.nebula.selectDirectory();
  86  |       document.getElementById('dir-input').value = dir;
  87  |       state.dir = dir;
  88  |     });
  89  |     await page.click('#scan-all-btn');
  90  |     await page.waitForTimeout(1000);
  91  |     // Check result cards updated
  92  |     await expect(page.locator('#result-large')).not.toHaveText('—');
  93  |     await expect(page.locator('#result-junk')).not.toHaveText('—');
  94  |     await page.screenshot({ path: 'tests/screenshots/04-scan-results.png' });
  95  |   });
  96  | 
  97  |   test('large files tab shows results and select all works', async () => {
  98  |     await page.click('[data-tab="large"]');
  99  |     await expect(page.locator('#large-list .file-item')).toHaveCount(2);
  100 |     await page.click('button:has-text("Select All")');
  101 |     const checked = await page.locator('#large-list input[type=checkbox]:checked').count();
  102 |     expect(checked).toBe(2);
  103 |     await page.screenshot({ path: 'tests/screenshots/05-large-files.png' });
  104 |   });
  105 | 
  106 |   test('move large files to bin shows success toast', async () => {
  107 |     await page.click('[data-tab="large"]');
  108 |     await page.click('button:has-text("Select All")');
  109 |     await page.click('button:has-text("Move to Bin")');
  110 |     await expect(page.locator('.toast')).toBeVisible();
  111 |     await expect(page.locator('.toast')).toContainText('Moved 2 file(s) to bin');
  112 |     await page.screenshot({ path: 'tests/screenshots/06-moved-to-bin.png' });
  113 |   });
  114 | 
  115 |   test('recycle bin shows moved files', async () => {
  116 |     await page.click('[data-tab="bin"]');
  117 |     await page.waitForTimeout(300);
  118 |     await expect(page.locator('#bin-list .file-item')).toHaveCount(2);
  119 |     await page.screenshot({ path: 'tests/screenshots/07-bin-contents.png' });
  120 |   });
  121 | 
  122 |   test('restore from bin works', async () => {
  123 |     await page.click('[data-tab="bin"]');
  124 |     await page.waitForTimeout(300);
  125 |     await page.locator('#bin-list input[type=checkbox]').first().check();
  126 |     await page.click('button:has-text("Restore Selected")');
  127 |     await expect(page.locator('.toast')).toContainText('Restored');
  128 |     await page.screenshot({ path: 'tests/screenshots/08-restore.png' });
  129 |   });
  130 | 
  131 |   test('delete forever from bin works', async () => {
  132 |     await page.click('[data-tab="bin"]');
  133 |     await page.waitForTimeout(300);
  134 |     await page.click('button:has-text("Select All")');
  135 |     await page.click('button:has-text("Delete Forever")');
  136 |     await expect(page.locator('.toast')).toContainText('deleted');
  137 |     await page.screenshot({ path: 'tests/screenshots/09-deleted.png' });
  138 |   });
  139 | 
  140 |   test('junk files tab shows results', async () => {
  141 |     await page.click('[data-tab="junk"]');
  142 |     await expect(page.locator('#junk-list .file-item')).toHaveCount(2);
  143 |     await page.screenshot({ path: 'tests/screenshots/10-junk-files.png' });
  144 |   });
  145 | 
  146 |   test('duplicates tab shows groups', async () => {
  147 |     await page.click('[data-tab="duplicates"]');
> 148 |     await expect(page.locator('.dup-group')).toHaveCount(1);
      |                                              ^ Error: expect(locator).toHaveCount(expected) failed
  149 |     await page.screenshot({ path: 'tests/screenshots/11-duplicates.png' });
  150 |   });
  151 | 
  152 |   test('error when moving to bin with nothing selected', async () => {
  153 |     await page.click('[data-tab="large"]');
  154 |     // Uncheck all
  155 |     await page.evaluate(() => document.querySelectorAll('#large-list input[type=checkbox]').forEach(c => c.checked = false));
  156 |     await page.click('button:has-text("Move to Bin")');
  157 |     await expect(page.locator('.toast')).toContainText('No files selected');
  158 |     await page.screenshot({ path: 'tests/screenshots/12-no-selection-error.png' });
  159 |   });
  160 | 
  161 |   test('window control buttons exist', async () => {
  162 |     await expect(page.locator('.ctrl-btn.minimize')).toBeVisible();
  163 |     await expect(page.locator('.ctrl-btn.maximize')).toBeVisible();
  164 |     await expect(page.locator('.ctrl-btn.close')).toBeVisible();
  165 |     await page.screenshot({ path: 'tests/screenshots/13-window-controls.png' });
  166 |   });
  167 | });
  168 | 
```