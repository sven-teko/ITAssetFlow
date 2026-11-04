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
      id: index + 1, _record_type: 'asset', asset_tag: 'TEST-' + String(index + 1).padStart(4, '0'), new_price: index === 1204 ? 123 : 0,
    }));
    const meta = { column_order: ['asset_tag'], default_visible_columns: ['asset_tag'],
      headers: { asset_tag: 'Produkterkennung' }, status_labels: {}, condition_labels: {}, inventory_group_labels: {} };
    let revision = 1, loads = 0, failNext = false, failPage = false, blocked = false;
    const offsets = [];
    const snapshot = () => String(revision).padStart(64, "0");
    const page = await browser.newPage({ viewport: { width: 1440, height: 850 } });
    page.setDefaultTimeout(10000);
    await page.addInitScript(() => { window.EventSource = undefined; });
    await page.route('**/api/**', async route => {
      const req = route.request();
      const headers = { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Credentials': 'true',
        'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS' };
      const json = (data, status = 200) => route.fulfill({ status, headers, json: data });
      if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
      switch (new URL(req.url()).pathname) {
        case '/api/auth/session': return json({ authenticated: true, email: 'editor@example.test', role: 'user' });
        case '/api/inventory/meta': return json(meta);
        case '/api/inventory/revision': return blocked ? json({ detail: 'Zugriff entzogen' }, 403) : json({ revision });
        case '/api/preferences/inventory-columns': return json({ preferences: null });
        case '/api/inventory/page': {
          const { offset, query, snapshot: previous } = req.postDataJSON();
          offsets.push(offset);
          loads++;
          if (blocked) return json({ detail: 'Zugriff entzogen' }, 403);
          if (offset && previous !== snapshot()) return json({ detail: 'Inventar geändert' }, 409);
          if (failNext || (offset && failPage)) {
            failNext = false; failPage = false; return json({ detail: 'Kurzzeitig nicht verfügbar' }, 503);
          }
          const hits = rows.filter(row => row.asset_tag.toLowerCase().includes(query.search.toLowerCase())
            && (query.price_from == null || row.new_price >= query.price_from));
          if (query.column && query.sort === 'desc') hits.sort((a,b) => b.asset_tag.localeCompare(a.asset_tag));
          const options = {groups:[],categories:[],conditions:[],statuses:[],sites:[],departments:[],storageLocations:[]};
          return json({ rows:hits.slice(offset, offset + 100), total:rows.length, matched:hits.length, revision,
            snapshot:snapshot(), next_offset:offset + 100 < hits.length ? offset + 100 : null, options:offset ? null : options });
        }
        case '/api/inventory':
          throw new Error('The browser must not request the complete inventory.');
        default: return json({}, 404);
      }
    });
    await page.goto(origin + '/#/inventory');
    const inventoryRows = page.locator('.inventory-table tbody tr').filter({has:page.getByRole('cell',{name:/^(TEST|UPDATED)-/})});
    const table = page.locator('.inventory-table');
    const cell = name => table.getByRole('cell', { name, exact: true });
    await cell('TEST-0001').waitFor();
    assert.deepEqual(offsets, [0]);
    assert.equal(await inventoryRows.count(), 100);
    await page.locator('.status-bar').getByText('1205 Datensätze',{exact:true}).waitFor();

    failPage = true;
    await page.locator('.table-wrapper').evaluate(el => { el.scrollTop = el.scrollHeight; });
    await page.getByRole('alert').getByText('Kurzzeitig nicht verfügbar').waitFor();
    assert.equal(await inventoryRows.count(), 100);
    await page.getByRole('button',{name:'Erneut laden',exact:true}).click();
    await cell('TEST-0101').waitFor({ state: 'attached' });
    assert.equal(await cell('TEST-0201').count(), 0);
    assert.deepEqual(offsets.slice(0,3), [0,100,100]);

    const search = page.getByPlaceholder('Name, Kennung, Seriennummer, Code …');
    await search.fill('TEST-1205');
    await cell('TEST-1205').waitFor();
    await page.locator('.status-bar').getByText('1 von 1205 Datensätzen',{exact:true}).waitFor();
    await search.clear();
    const from = page.getByLabel('Neupreis von');
    await from.fill('120');
    await cell('TEST-1205').waitFor();
    assert.equal(await inventoryRows.count(), 1);
    await from.clear();
    const header = table.getByRole('columnheader', { name: /Produkterkennung/ });
    await header.click();
    await header.click();
    await cell('TEST-1205').waitFor();
    assert.equal(await table.locator('tbody tr').first().getByRole('cell').first().innerText(), 'TEST-1205');

    rows[1204].asset_tag = 'UPDATED-1205';
    revision++;
    failNext = true;
    const failed = page.waitForResponse(res => res.url().endsWith('/api/inventory/page') && res.status() === 503);
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await failed;
    assert.equal(await cell('TEST-1205').count(), 1);
    await cell('UPDATED-1205').waitFor();
    assert.ok(loads >= 3, 'revision retried without SSE or another change');

    revision++;
    const stale = page.waitForResponse(res => res.url().endsWith('/api/inventory/page') && res.status() === 409);
    await page.locator('.table-wrapper').evaluate(el => { el.scrollTop = el.scrollHeight; });
    await stale;
    await cell('UPDATED-1205').waitFor();
    assert.equal(await inventoryRows.count(), 100);

    blocked = true;
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await page.waitForURL('**/#/login');
    assert.equal(await cell('UPDATED-1205').count(), 0);
    assert.equal(await inventoryRows.count(), 0);
    console.log('PASS: Echte Serveranfragen beim Scrollen, Suche/Filter/Sortierung über 1205 Zeilen, Nachladefehler, geänderter Bestand und HTTP 403.');
  } finally {
    await browser.close();
    await vite.httpServer.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
