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
      new_price: [0, 10, 100][index] ?? (index === 1204 ? 123 : 0),
      purchase_date: ['2020-01-01', '2020-03-02', '2021-01-01', '2021-12-31'][index] ?? '2022-01-01',
    }));
    const columns = ['asset_tag', 'product_model', 'manufacturer', 'stock_quantity', 'category', 'condition',
      'site', 'department', 'storage_location', 'serial_number', 'created_at', 'updated_at'];
    const meta = { column_order: columns, default_visible_columns: columns,
      headers: { asset_tag: 'Produkterkennung' }, status_labels: {}, condition_labels: {}, inventory_group_labels: {} };
    let revision = 1, loads = 0, failNext = false, failPage = false, blocked = false;
    let searchGate = null, sortGate = null;
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
          if (query.search && searchGate) await searchGate;
          if (query.sort === 'desc' && sortGate) await sortGate;
          const hits = rows.filter(row => row.asset_tag.toLowerCase().includes(query.search.toLowerCase())
            && (query.price_from == null || row.new_price >= query.price_from)
            && (query.price_to == null || row.new_price <= query.price_to)
            && (query.date_from == null || row.purchase_date >= query.date_from)
            && (query.date_to == null || row.purchase_date <= query.date_to));
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

    const search = page.locator('.navigation').getByPlaceholder('Inventar durchsuchen', { exact: true });
    assert.equal(await page.locator('.navigation .sidebar-title').getByText('Inventar durchsuchen').count(), 0);
    let releaseSearch;
    searchGate = new Promise(resolve => { releaseSearch = resolve; });
    await search.fill('TEST-1205');
    const loading = page.locator('.inventory-table-status').getByText('Inventar wird geladen …', { exact: true });
    await loading.waitFor();
    const scroller = page.locator('.table-wrapper');
    const checkLoadingPosition = async status => {
      const width = await scroller.evaluate(el => el.scrollWidth - el.clientWidth);
      assert.ok(width > 0, 'table has horizontal overflow');
      for (const left of [0, width]) {
        await scroller.evaluate((el, x) => { el.scrollLeft = x; }, left);
        const [viewport, label] = await Promise.all([scroller.boundingBox(), status.boundingBox()]);
        assert.ok(Math.abs(viewport.x + viewport.width / 2 - label.x - label.width / 2) < 2,
          'loading status stays centred in the visible table');
      }
    };
    await checkLoadingPosition(loading);
    await page.setViewportSize({ width: 390, height: 740 });
    await checkLoadingPosition(loading);
    await page.setViewportSize({ width: 1440, height: 850 });
    await scroller.evaluate(el => { el.scrollLeft = 0; });
    releaseSearch();
    searchGate = null;
    await cell('TEST-1205').waitFor();
    await loading.waitFor({ state: 'hidden' });
    await page.locator('.status-bar').getByText('1 von 1205 Datensätzen',{exact:true}).waitFor();
    await search.clear();
    const price = page.getByLabel('Neupreis (CHF)', { exact: true });
    const date = page.getByLabel('Kaufdatum', { exact: true });
    async function checkFilter(input, value, field, from, to, identifiers) {
      const response = page.waitForResponse(res => {
        if (!res.url().endsWith('/api/inventory/page') || res.status() !== 200) return false;
        const { query } = res.request().postDataJSON();
        return query[field + '_from'] === from && query[field + '_to'] === to;
      });
      await input.fill(value);
      await response;
      await cell(identifiers[0]).waitFor();
      assert.deepEqual(await inventoryRows.allTextContents(), identifiers);
    }
    await checkFilter(price, '10', 'price', 10, 10, ['TEST-0002']);
    await checkFilter(price, '10-100', 'price', 10, 100, ['TEST-0002', 'TEST-0003']);
    await checkFilter(price, '0', 'price', 0, 0, rows.slice(0, 102).filter(row => row.new_price === 0).map(row => row.asset_tag));
    await price.clear();
    await checkFilter(date, '2020', 'date', '2020-01-01', '2020-12-31', ['TEST-0001', 'TEST-0002']);
    await checkFilter(date, '01.01.2020', 'date', '2020-01-01', '2020-01-01', ['TEST-0001']);
    await checkFilter(date, '02.03.2020-01.01.2021', 'date', '2020-03-02', '2021-01-01', ['TEST-0002', 'TEST-0003']);
    await checkFilter(date, '2020-2021', 'date', '2020-01-01', '2021-12-31', ['TEST-0001', 'TEST-0002', 'TEST-0003', 'TEST-0004']);
    await date.fill('31.02.2020');
    await date.press('Tab');
    assert.equal(await date.getAttribute('aria-invalid'), 'true');
    await date.clear();
    const header = table.getByRole('columnheader', { name: /Produkterkennung/ });
    let releaseSort;
    sortGate = new Promise(resolve => { releaseSort = resolve; });
    await header.click();
    await header.click();
    const sortStatus = page.getByRole('status').filter({ hasText: 'Inventar wird sortiert' });
    await sortStatus.getByRole('img', { name: 'ITAssetFlow' }).waitFor();
    await checkLoadingPosition(sortStatus);
    await scroller.evaluate(el => { el.scrollLeft = 0; });
    releaseSort();
    sortGate = null;
    await cell('TEST-1205').waitFor();
    await sortStatus.waitFor({ state: 'hidden' });
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
    // If the user is still near the bottom after refreshing, a second page
    // can already be appended. In either case, no rows may be duplicated.
    const freshRows = await inventoryRows.allTextContents();
    assert.ok(freshRows.length >= 100 && freshRows.length <= 200);
    assert.equal(new Set(freshRows).size, freshRows.length);
    assert.equal(freshRows[0], 'UPDATED-1205');

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
