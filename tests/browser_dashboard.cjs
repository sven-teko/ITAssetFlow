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
      configured_thresholds: 0, low_stock: 0, changed_at: null, latest_item: null,
    };
    const sites = [
      { ...defaults, site_id: '1', name: 'Basel', assets: 2, in_use: 1, known_value: 320, missing_prices: 1,
        changed_at: '2026-11-02T10:03:51Z', latest_item: 'Laptop · A-1', configured_thresholds: 1, low_stock: 1,
        departments: [{ ...defaults, id: '11', name: 'Informatik', assets: 2, known_value: 320 }] },
      { ...defaults, site_id: '2', name: 'Büro Allschwil', stock_positions: 1, known_value: 44, changed_at: '2026-11-03T12:23:11Z', latest_item: 'Kabel' },
      { ...defaults, site_id: '3', name: 'Leerer Standort' },
    ];
    const review = [
      { key: 'asset:1', item_name: 'Laptop', asset_tag: 'A-1', issue: 'in_repair', stale: false, site_name: 'Basel', location_name: 'Lager',
        changed_at: '2026-11-02T10:03:51Z' },
      { key: 'stock:2:2:new', item_name: 'Kabel', asset_tag: null, issue: 'defective', stale: true, site_name: 'Büro Allschwil', location_name: 'Lager',
        changed_at: '2025-01-01T10:03:51Z' },
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
          case '/api/inventory': return json([{ id: 1, _record_type: 'asset', asset_tag: 'TEST-001' },{ id: 2, _record_type: 'asset', asset_tag: 'TEST-002' }]);
          case '/api/inventory/revision': return json({ revision });
          case '/api/inventory/events': return route.fulfill({ headers, contentType: 'text/event-stream', body: ': ready\n\n' });
          case '/api/preferences/inventory-columns': return json({ preferences: null });
          case '/api/inventory/dashboard':
            requests++;
            return fail ? json({ detail: 'Dashboard vorübergehend nicht verfügbar.' }, 503)
              : json({ sites: restricted ? sites.slice(0, 1) : sites, review_after_days: 180, review_items: restricted ? review.slice(0, 1) : review });
          default: return json({}, 404);
        }
      });
    }
    const page = await browser.newPage({ viewport: { width: 1440, height: 850 } });
    page.setDefaultTimeout(8000);
    await mock(page);
    await page.goto(origin + '/#/inventory');
    const inventory = page.getByRole('tab', { name: 'IT-Inventar', exact: true });
    const dashboard = page.getByRole('tab', { name: 'Dashboard', exact: true });
    const panel = page.getByRole('tabpanel', { name: 'Dashboard', exact: true });
    await page.getByRole('cell', { name: 'TEST-001' }).waitFor();
    assert.equal(requests, 0);
    assert.equal(await page.locator('.menu-bar').getByRole('tab').count(), 2);
    const scanner = page.locator('.menu-bar').getByRole('button', { name: 'Scanner', exact: true });
    assert.ok(await scanner.isVisible());
    assert.ok(Math.abs((await scanner.boundingBox()).y - (await inventory.boundingBox()).y) < 6);
    const checkAlignment = () => page.waitForFunction(() => {
      const area = document.querySelector('.table-wrapper').getBoundingClientRect();
      const tabs = document.querySelector('.workspace-tabs').getBoundingClientRect();
      const scan = document.querySelector('.menu-scanner-button').getBoundingClientRect();
      const menu = document.querySelector('.menu-leading-end').getBoundingClientRect();
      const logout = document.querySelector('.menu-logout-button').getBoundingClientRect();
      return document.querySelector('.menu-bar').dataset.toolbarRow === 'inline'
        && Math.abs(tabs.left - Math.max(area.left, menu.right + 8)) < 2
        && Math.abs(scan.right - Math.min(area.right, logout.left - 8)) < 2;
    });
    await checkAlignment();
    await page.setViewportSize({ width: 1190, height: 850 });
    await checkAlignment();
    await page.setViewportSize({ width: 740, height: 850 });
    await page.waitForFunction(() => {
      const area = document.querySelector('.table-wrapper').getBoundingClientRect();
      const tabs = document.querySelector('.workspace-tabs').getBoundingClientRect();
      const scan = document.querySelector('.menu-scanner-button').getBoundingClientRect();
      return Math.abs(tabs.left-area.left) < 2 && Math.abs(scan.right-area.right) < 2;
    });
    await page.setViewportSize({ width: 1440, height: 850 });
    await page.getByRole('button', { name: 'Optionen', exact: true }).click();
    await page.getByText('Sortieren nach', { exact: true }).click();
    await page.getByLabel('Reihenfolge', { exact: true }).selectOption('desc');
    await page.getByLabel('Spalte', { exact: true }).selectOption('asset_tag');
    assert.equal(await page.locator('.inventory-table tbody tr').first().innerText(), 'TEST-002');
    await page.keyboard.press('Escape');
    await page.getByRole('columnheader', { name: /Produkterkennung/ }).click();
    assert.equal(await page.locator('.inventory-table tbody tr').first().innerText(), 'TEST-001');
    await inventory.focus();
    await inventory.press('ArrowRight');
    await panel.getByRole('alert').waitFor();
    fail = false;
    await panel.getByRole('button', { name: 'Erneut laden' }).click();
    const table = panel.getByRole('table', { name: 'Standortübersicht' });
    await table.waitFor();
    assert.match(await panel.locator('.dashboard-metric-value').first().innerText(), /364\.00/);
    await table.getByRole('cell', { name: '03.11.2026-13-23', exact: true }).waitFor();
    await table.getByRole('cell', { name: 'Keine erfasst', exact: true }).waitFor();
    await table.getByRole('cell', { name: 'Laptop · A-1', exact: true }).waitFor();
    await table.getByRole('button', { name: 'Basel', exact: true }).click();
    await table.getByRole('rowheader', { name: 'Informatik', exact: true }).waitFor();
    await table.getByRole('button', { name: 'Basel', exact: true }).click();
    assert.equal(await table.getByRole('rowheader', { name: 'Informatik', exact: true }).count(), 0);
    assert.equal(await panel.getByText(/ohne Preis|Die letzte Änderung zeigt|Einzelartikel zum erfassten/i).count(), 0);
    const reviewTable = panel.getByRole('table', { name: /Zu prüfende Artikel/ });
    await reviewTable.getByText('In Reparatur', { exact: true }).waitFor();
    await reviewTable.getByText('Defekt', { exact: true }).waitFor();
    await reviewTable.getByText('Lange unverändert', { exact: true }).waitFor();
    assert.ok(await scanner.isVisible());
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
    assert.equal(await mobile.getByRole('table', { name: 'Standortübersicht' }).getByRole('rowheader').count(), 1);
    assert.equal(await mobile.getByRole('table', { name: /Zu prüfende Artikel/ }).getByRole('rowheader').count(), 1);
    assert.equal(await mobile.getByRole('button', { name: 'Scanner', exact: true }).count(), 1);
    await mobile.setViewportSize({ width: 320, height: 780 });
    assert.ok(await mobile.locator('.menu-bar').evaluate(el => el.scrollWidth <= el.clientWidth));
    assert.equal(await mobile.getByRole('tab', { name: 'Filter', exact: true }).isVisible(), false);
    assert.ok(await mobile.locator('.dashboard-panel').evaluate(el => el.scrollWidth <= el.clientWidth));
    await mobile.getByRole('tab', { name: 'IT-Inventar', exact: true }).click();
    assert.equal(await mobile.getByRole('tab', { name: 'Filter', exact: true }).getAttribute('aria-selected'), 'true');
    await mobile.getByRole('button', { name: 'Optionen', exact: true }).tap();
    await mobile.getByRole('button', { name: 'Spalten' }).tap();
    const mobileColumns = mobile.locator('.column-submenu');
    await mobileColumns.getByRole('checkbox', { name: 'Produkterkennung' }).waitFor();
    const columnBounds = await mobileColumns.boundingBox();
    assert.ok(columnBounds.x >= 0 && columnBounds.x + columnBounds.width <= 320);
    console.log('PASS: Dashboard tabs, sorting, error retry, auto-refresh, and mobile layout.');
  } finally {
    await browser.close();
    await vite.httpServer.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
