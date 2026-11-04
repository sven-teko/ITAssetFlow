const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

(async () => {
  const root = path.resolve(__dirname, '../web');
  const origin = 'http://127.0.0.1:5187';
  const vite = await (await import(require.resolve('vite', { paths: [root] }))).preview({
    root, preview: { host: '127.0.0.1', port: 5187, strictPort: true },
  });
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? {
    executablePath: process.env.CHROMIUM_EXECUTABLE,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--no-zygote', '--single-process'],
  } : {}) });
  try {
    const rows = Array.from({ length: 1205 }, (_, index) => ({
      id: index + 1, _record_type: 'asset', asset_tag: 'TEST-' + String(index + 1).padStart(4, '0'),
    }));
    const meta = { column_order: ['asset_tag'], default_visible_columns: ['asset_tag'],
      headers: { asset_tag: 'Produkterkennung' }, status_labels: {}, condition_labels: {}, inventory_group_labels: {} };
    let revision = 1, loads = 0, failNext = false, blocked = false;
    const page = await browser.newPage({ viewport: { width: 1440, height: 850 } });
    page.setDefaultTimeout(10000);
    await page.addInitScript(() => { window.EventSource = undefined; });
    await page.route('**/api/**', async route => {
      const req = route.request();
      const headers = { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Credentials': 'true',
        'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET,OPTIONS' };
      const json = (data, status = 200) => route.fulfill({ status, headers, json: data });
      if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
      switch (new URL(req.url()).pathname) {
        case '/api/auth/session': return json({ authenticated: true, email: 'editor@example.test', role: 'user' });
        case '/api/inventory/meta': return json(meta);
        case '/api/inventory/revision': return blocked ? json({ detail: 'Zugriff entzogen' }, 403) : json({ revision });
        case '/api/preferences/inventory-columns': return json({ preferences: null });
        case '/api/inventory':
          loads++;
          if (failNext) { failNext = false; return json({ detail: 'Kurzzeitig nicht verfügbar' }, 503); }
          return json(rows);
        default: return json({}, 404);
      }
    });
    await page.goto(origin + '/#/inventory');
    const inventoryRows = page.locator('.inventory-table tbody tr[data-row-index]');
    const table = page.locator('.inventory-table');
    const cell = name => table.getByRole('cell', { name, exact: true });
    await cell('TEST-0001').waitFor();
    assert.equal(await cell('TEST-0101').count(), 0);
    await page.locator('.table-wrapper').evaluate(el => { el.scrollTop = el.scrollHeight; });
    await cell('TEST-0101').waitFor({ state: 'attached' });
    assert.equal(await cell('TEST-0201').count(), 0);

    const search = page.getByPlaceholder('Name, Kennung, Seriennummer, Code …');
    await search.fill('TEST-1205');
    await cell('TEST-1205').waitFor();
    await search.fill('');
    const header = table.getByRole('columnheader', { name: /Produkterkennung/ });
    await header.click();
    await header.click();
    assert.equal(await table.locator('tbody tr').first().getByRole('cell').first().innerText(), 'TEST-1205');

    rows[1204].asset_tag = 'UPDATED-1205';
    revision++;
    failNext = true;
    const failed = page.waitForResponse(res => res.url().endsWith('/api/inventory') && res.status() === 503);
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await failed;
    assert.equal(await cell('TEST-1205').count(), 1);
    await cell('UPDATED-1205').waitFor();
    assert.ok(loads >= 3, 'revision retried without SSE or another change');

    blocked = true;
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await page.waitForURL('**/#/login');
    assert.equal(await cell('UPDATED-1205').count(), 0);
    assert.equal(await inventoryRows.count(), 0);
    console.log('PASS: Scroll-Laden, vollständige Suche/Sortierung, erneuter Abruf nach Fehler und leere Ansicht nach HTTP 403.');
  } finally {
    await browser.close();
    await vite.httpServer.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
