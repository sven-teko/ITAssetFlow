const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

(async () => {
  const root = path.resolve(__dirname, '../web');
  const origin = 'http://127.0.0.1:5183';
  const vite = await (await import(require.resolve('vite', { paths: [root] }))).preview({
    root, preview: { host: '127.0.0.1', port: 5183, strictPort: true },
  });
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? {
    executablePath: process.env.CHROMIUM_EXECUTABLE,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--no-zygote', '--single-process'],
  } : {}) });
  try {
    const meta = {
      column_order: ['asset_tag'], default_visible_columns: ['asset_tag'],
      headers: { asset_tag: 'Produkterkennung' }, status_labels: {}, condition_labels: {}, inventory_group_labels: {},
    };
    const defaults = {
      assets: 0, in_use: 0, stock_positions: 0, attention: 0, known_value: 0, missing_prices: 0,
      configured_thresholds: 0, low_stock: 0, changed_at: null,
    };
    const sites = [
      { ...defaults, site_id: '1', name: 'Basel', assets: 2, in_use: 1, known_value: 320, missing_prices: 1,
        changed_at: '2026-11-02T10:03:51Z', configured_thresholds: 1, low_stock: 1 },
      { ...defaults, site_id: '2', name: 'Büro Allschwil', stock_positions: 1, known_value: 44, changed_at: '2026-11-03T12:23:11Z' },
      { ...defaults, site_id: '3', name: 'Leerer Standort' },
    ];
    let fail = true, revision = 1, requests = 0;
    async function mock(page, restricted = false) {
      await page.route('**/api/**', async route => {
        const req = route.request();
        const headers = { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Credentials': 'true',
          'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET,OPTIONS' };
        const json = (data, status = 200) => route.fulfill({ status, headers, json: data });
        if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
        switch (new URL(req.url()).pathname) {
          case '/api/auth/session': return json({ authenticated: true, email: 'test@example.test', role: restricted ? 'viewer' : 'admin' });
          case '/api/inventory/meta': return json(meta);
          case '/api/inventory': return json([{ id: 1, _record_type: 'asset', asset_tag: 'TEST-001' }]);
          case '/api/inventory/revision': return json({ revision });
          case '/api/inventory/events': return route.fulfill({ headers, contentType: 'text/event-stream', body: ': ready\n\n' });
          case '/api/preferences/inventory-columns': return json({ preferences: null });
          case '/api/inventory/dashboard':
            requests++;
            return fail ? json({ detail: 'Dashboard vorübergehend nicht verfügbar.' }, 503)
              : json({ sites: restricted ? sites.slice(0, 1) : sites });
          default: return json({}, 404);
        }
      });
    }
    const page = await browser.newPage({ viewport: { width: 1440, height: 850 } });
    await mock(page);
    await page.goto(origin + '/#/inventory');
    const inventory = page.getByRole('tab', { name: 'IT-Inventar', exact: true });
    const dashboard = page.getByRole('tab', { name: 'Dashboard', exact: true });
    const panel = page.getByRole('tabpanel', { name: 'Dashboard', exact: true });
    await page.getByRole('cell', { name: 'TEST-001' }).waitFor();
    assert.equal(requests, 0);
    await inventory.focus();
    await inventory.press('ArrowRight');
    await panel.getByRole('alert').waitFor();
    fail = false;
    await panel.getByRole('button', { name: 'Erneut laden' }).click();
    const table = panel.getByRole('table');
    await table.waitFor();
    assert.match(await panel.locator('.dashboard-metric-value').first().innerText(), /364\.00/);
    await table.getByRole('cell', { name: '03.11.2026-13-23', exact: true }).waitFor();
    await table.getByRole('cell', { name: 'Keine erfasst', exact: true }).waitFor();
    await table.getByRole('button', { name: 'Letzte Änderung' }).click();
    assert.equal(await table.locator('tbody th').first().innerText(), 'Büro Allschwil');
    assert.equal(await page.locator('.inventory-table').isVisible(), false);
    sites[0].known_value = 500;
    revision++;
    await panel.getByText(/544\.00/).waitFor();
    await dashboard.press('Home');
    await page.getByRole('cell', { name: 'TEST-001' }).waitFor();
    assert.equal(await inventory.getAttribute('aria-selected'), 'true');
    assert.equal(await page.getByRole('button', { name: 'Scanner', exact: true }).isVisible(), true);

    const mobile = await browser.newPage({ viewport: { width: 390, height: 780 }, isMobile: true, hasTouch: true });
    await mock(mobile, true);
    await mobile.goto(origin + '/#/inventory');
    await mobile.getByRole('tab', { name: 'Filter', exact: true }).click();
    await mobile.getByRole('tab', { name: 'Dashboard', exact: true }).click();
    await mobile.getByRole('rowheader', { name: 'Basel', exact: true }).waitFor();
    assert.equal(await mobile.getByRole('rowheader').count(), 1);
    assert.equal(await mobile.getByRole('tab', { name: 'Filter', exact: true }).isVisible(), false);
    assert.ok(await mobile.locator('.dashboard-panel').evaluate(el => el.scrollWidth <= el.clientWidth));
    await mobile.getByRole('tab', { name: 'IT-Inventar', exact: true }).click();
    assert.equal(await mobile.getByRole('tab', { name: 'Filter', exact: true }).getAttribute('aria-selected'), 'true');
    console.log('PASS: Dashboard tabs, sorting, error retry, auto-refresh, and mobile layout.');
  } finally {
    await browser.close();
    await vite.httpServer.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
