/* QR-, Docking- und Mobilregressionen mit isolierter Test-API.
   START_VITE=1 PLAYWRIGHT_MODULE=/pfad/playwright CHROMIUM_EXECUTABLE=/pfad/chromium node tests/browser_qr_mobile.cjs */
const path = require('node:path');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || require.resolve('playwright', { paths: [path.resolve(__dirname, '../web')] }));
const run = (async () => {
  const vite = process.env.START_PREVIEW ? await (await import(require.resolve('vite', {paths:[path.resolve(__dirname,'../web')]}))).preview({root:path.resolve(__dirname,'../web'),preview:{host:'127.0.0.1',port:5173,strictPort:true}}) : process.env.START_VITE ? await (await import(require.resolve('vite', { paths: [path.resolve(__dirname, '../web')] })))
    .createServer({ root: path.resolve(__dirname, '../web'), server: { host: '127.0.0.1', port: 5173 } }) : null;
  if (vite && !process.env.START_PREVIEW) await vite.listen();
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? {
    executablePath: process.env.CHROMIUM_EXECUTABLE,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--no-zygote', '--single-process', '--autoplay-policy=no-user-gesture-required'],
  } : {}) });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, hasTouch: true });
    page.setDefaultTimeout(10000);
    const errors = [], wasmRequests = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => { if (request.url().includes('.wasm')) wasmRequests.push(request.url()); });
    const bookingResults=new Map();
    let stock = 5, bookings = [], savedSettings = null, lastAsset = null, uncertain = false, malformed = false, role = 'admin', deletedKeys = [], lookups = [];
    let lastEdit = null;
    let knownRetail = 'ean';
    const meta = {
      column_order: ['asset_tag', 'product_model_name', 'status', 'condition', 'site_name', 'department_name'],
      default_visible_columns: ['asset_tag', 'product_model_name', 'status', 'site_name'],
      headers: { asset_tag: 'Produkterkennung', product_model_name: 'Produktmodell', status: 'Status', site_name: 'Standort' },
      status_labels: { available: 'Verfügbar', in_use: 'Im Einsatz' },
      condition_labels: { new: 'Neu', used: 'Gebraucht' }, inventory_group_labels: { device: 'Gerät', material: 'Material' },
    };
    const location = { id: 11, storage_location_name: 'Lager', site_name: 'Basel', department_name: 'IT' };
    const data = {
      site_permissions_available:true,
      sites: [{ id: 1, name: 'Basel', organization_id: 1 }],
      departments: [{ id: 10, name: 'IT', site_id: 1, organization_id: 1 }],
      storage_locations: [{ id: 11, name: 'Lager', site_id: 1, department_id: 10, is_active: true, location_type: 'warehouse' }],
      product_categories: [{ id: 1, name: 'Laptop', code: 'laptop', inventory_group: 'device', specification_schema: { fields: [] } }],
      manufacturers: [{ id: 1, name: 'Keiner' }],
      employees: [{ id: 1, first_name: 'Test', last_name: 'Admin', email: 'admin@example.test', department_id: 10, is_active: true, auth_user_id: 'auth-admin', app_role: 'admin' }],
      product_models: [{ id: 100, name: 'TestBook', category_id: 1, manufacturer_id: 1, is_active: true, tracking_mode: 'serialized', unit_code: 'piece', specifications: {} }],
      parent_assets: [], ...meta, factory_default_visible_columns: meta.default_visible_columns,
    };
    const inventory = () => [
      { id: 1, _record_type: 'asset', asset_tag: 'PC-001', product_model_name: 'TestBook', status: 'available', condition: 'used', site_name: 'Basel', department_name: 'IT', storage_location: 'Lager', _web_inventory_group: 'device', _web_category_key: 'laptop', _web_condition_key: 'used' },
      { id: 2, _record_type: 'stock', product_model_id: 101, product_model_name: 'USB-C Kabel', product_category_name: 'Kabel', storage_location_id: 11, stock_quantity: stock, status: 'available', condition: 'new', site_name: 'Basel', department_name: 'IT', storage_location: 'Lager', _web_inventory_group: 'material', _web_category_key: 'cable', _web_condition_key: 'new' },
    ];
    const handleApi = async route => {
      const req = route.request(), url = new URL(req.url()), endpoint = url.pathname;
      const headers = { 'Access-Control-Allow-Origin': new URL(process.env.UI_BASE_URL || 'http://127.0.0.1:5173').origin, 'Access-Control-Allow-Credentials': 'true', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS' };
      const json = (body, status = 200) => route.fulfill({ status, headers, contentType: 'application/json', body: JSON.stringify(body) });
      if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
      if (endpoint === '/api/auth/session') return json({ authenticated: true, email: 'admin@example.test', role });
      if (endpoint === '/api/inventory/meta') return json(meta);
      if (endpoint === '/api/preferences/inventory-columns') return json({ preferences: null });
      if (endpoint === '/api/inventory/revision') return json({ revision: 1 });
      if (endpoint === '/api/inventory/events') return route.fulfill({ headers, contentType: 'text/event-stream', body: ': test\n\n' });
      if (endpoint === '/api/inventory/form-data') return json(data);
      if (endpoint === '/api/inventory/edit-form-data') return json({...data, edit_entry:{id:1,_record_type:'asset',
        product_model_id:100,asset_tag:'PC-001',serial_number:'OLD-SN',mac_address:'AA:BB:CC:11:22:33',
        site_id:1,department_id:10,storage_location_id:11,status:'available',condition:'used',purchase_date:'2026-11-04'}});
      if (endpoint === '/api/settings') {
        if (req.method() === 'PUT') {
          savedSettings = req.postDataJSON();
          data.employees = savedSettings.employees.map((row, index) => ({ ...row, id: row.id ?? 50 + index, department_id: 10 }));
          return json({ saved: true });
        }
        return json(data);
      }
      if (endpoint === '/api/inventory') {
        if (req.method() === 'POST') { lastAsset = req.postDataJSON(); return json({ id: 3, entry_type: 'asset' }); }
        if (req.method() === 'PUT') { lastEdit = req.postDataJSON(); return json({ id: 1, entry_type: 'asset' }); }
        return json(inventory());
      }
      if (endpoint === '/api/scanner/lookup') {
        const code = url.searchParams.get('code'); lookups.push({code, type: url.searchParams.get('code_type')});
        if (code === '6938818307575' || code === '841885106377') {
          const known = code === (knownRetail === 'ean' ? '6938818307575' : '841885106377');
          return json({
            code, matches: known ? [5, 6].map(id => ({
              id, key: `asset:${id}`, record_type:'asset', product_model_id:105, product_model_name:'Test DECT',
              asset_tag:`DECT-${id}`, ...location, storage_location_id:11, condition:'used', quantity:1,
            })) : [], locations:[location], models:known ? [{id:105,name:'Test DECT',tracking_mode:'serialized'}] : [],
            direct_asset_keys:[],
          });
        }
        const matches = (code === 'QR-CABLE' || code === '4006381333931' || code === '87954252804') ? [{ key: 'stock:101:11:new', record_type: 'stock', product_model_id: 101, product_model_name: 'USB-C Kabel', ...location, storage_location_id: 11, condition: 'new', quantity: stock }]
          : (code === 'PC-001' || code === '96385074') ? [{ key: 'asset:1', record_type: 'asset', id: 1, asset_tag: 'PC-001', product_model_id: 100, product_model_name: 'TestBook', ...location, storage_location_id: 11, condition: 'used', quantity: 1 }] : [];
        return json({ code, matches: code === '96385074' ? [...matches, {...matches[0], key:'asset:2', id:2, asset_tag:'PC-002'}] : matches, locations: [location] });
      }
      if (endpoint === '/api/scanner/stock') {
        const payload = req.postDataJSON(); bookings.push(payload);
        let result=bookingResults.get(payload.request_id);
        if(!result){stock += payload.direction === 'add' ? payload.quantity : -payload.quantity;
          result={saved:true,quantity:stock,changed_quantity:payload.quantity};bookingResults.set(payload.request_id,result);}
        if (uncertain) { uncertain = false; return route.abort('failed'); }
        if (malformed) { malformed = false; return json({}); }
        return json(result);
      }
      if (endpoint === '/api/inventory/delete') { deletedKeys = req.postDataJSON().entry_keys; return json({deleted_count: deletedKeys.length}); }
      return json({ detail: `Unbekannter Test-Endpunkt ${endpoint}` }, 404);
    };
    await page.route(url => url.pathname.startsWith('/api/'), handleApi);
    const openQr = async () => {
      await page.getByRole('button', { name: /^Scanner$/ }).filter({ visible: true }).click();
      await page.getByRole('dialog', { name: 'Scanner' }).waitFor();
      assert.equal(await page.locator('#scan-code-type').count(),0);
      await page.locator('.qr-auto-label').waitFor();
    };
    const lookup = async code => {
      await page.getByLabel('QR-Code / EAN / Artikelkennung', { exact: true }).fill(code);
      await page.getByRole('button', { name: 'Prüfen', exact: true }).click();
    };
    const closeQr = () => page.getByRole('button', { name: 'Scanner schliessen' }).click();
    const screenshot = async name => {
      if (process.env.SCREENSHOT_DIR) {
        fs.mkdirSync(process.env.SCREENSHOT_DIR, { recursive: true });
        await page.screenshot({ path: path.join(process.env.SCREENSHOT_DIR, `${name}.png`) });
      }
    };
    const noHorizontalOverflow = async () => {
      const sizes = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, width: innerWidth }));
      assert.ok(sizes.scroll <= sizes.width, JSON.stringify(sizes));
    };
    await page.goto((process.env.UI_BASE_URL || 'http://127.0.0.1:5173') + '/#/inventory');
    await page.locator('.inventory-table tbody tr').first().waitFor();

    // Der sichtbare Randbereich muss derselbe Bereich sein wie das tatsächliche Dropziel.
    const workspace = await page.locator('.workspace').boundingBox();
    const drag = async (panel, x, targetClass) => {
      const box = await page.locator(`[data-dock-panel="${panel}"] .dock-title`).boundingBox();
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(x, workspace.y + 100, { steps: 8 });
      await page.locator(targetClass).waitFor();
      if (targetClass.includes('dock-drop-zone')) {
        await page.waitForFunction(() => getComputedStyle(document.querySelector('.dock-drop-zone.active')).opacity === '1');
        const zone = await page.locator(targetClass).boundingBox();
        assert.ok(x >= zone.x && x <= zone.x + zone.width);
      }
      await screenshot(`dock-${panel}-${x < 200 ? 'left' : 'right'}`);
      await page.mouse.up();
    };
    const order = () => page.locator('.workspace > .dock-shell, .workspace > .inventory-area').evaluateAll(els => els.map(el => el.dataset.dockPanel || 'inventory'));
    const checkDockLayout = () => page.waitForFunction(() => {
      const rect = selector => document.querySelector(selector).getBoundingClientRect();
      const root = document.querySelector('.menu-bar');
      const table = rect('.table-wrapper');
      const area = rect('.inventory-area');
      const tabs = rect('.workspace-tabs');
      const scanner = rect('.menu-scanner-button');
      const menu = rect('.menu-leading-end');
      const logout = rect('.menu-logout-button');
      return root.dataset.toolbarRow === 'inline'
        && tabs.left >= menu.right + 7
        && scanner.right <= logout.left - 7
        && scanner.left >= tabs.right + 3
        && Math.abs(tabs.left - Math.max(table.left, menu.right + 8)) < 2
        && Math.abs(scanner.right - Math.min(table.right, logout.left - 8)) < 2
        && Math.abs((tabs.top + tabs.bottom) - (scanner.top + scanner.bottom)) < 2
        && [table.left - area.left, table.top - area.top, area.right - table.right, area.bottom - table.bottom]
          .every(inset => inset >= 0 && inset <= 5);
    });
    await checkDockLayout();
    await drag('detail', workspace.x + 10, '.dock-drop-zone-left.active');
    assert.deepEqual(await order(), ['detail', 'navigation', 'inventory']);
    await checkDockLayout();
    await screenshot('docked-both-left');
    await drag('navigation', workspace.x + workspace.width - 10, '.dock-drop-zone-right.active');
    assert.deepEqual(await order(), ['detail', 'inventory', 'navigation']);
    await checkDockLayout();
    await drag('detail', workspace.x + workspace.width - 10, '.dock-drop-zone-right.active');
    assert.deepEqual(await order(), ['inventory', 'navigation', 'detail']);
    await checkDockLayout();
    await screenshot('docked-both-right');
    const navBox = await page.locator('[data-dock-panel="navigation"]').boundingBox();
    await drag('detail', navBox.x + navBox.width * 0.35, '.dock-navigation-shell.dock-shell-drop-before');
    assert.deepEqual(await order(), ['inventory', 'detail', 'navigation']);
    await checkDockLayout();
    const beforeCancel = await order();
    const title = await page.locator('[data-dock-panel="detail"] .dock-title').boundingBox();
    await page.mouse.move(title.x + 30, title.y + 10); await page.mouse.down();
    await page.mouse.move(5, 5, { steps: 5 }); await page.mouse.up();
    assert.deepEqual(await order(), beforeCancel);
    console.log('PASS: Randziele und Nachbarziele, kompakte Kopfzeile und 4-px-Tabellenrand bei allen Dockpositionen');

    await page.evaluate(() => { location.hash = '/settings?tab=employees'; });
    await page.getByRole('table', { name: 'Mitarbeiter' }).waitFor();
    await page.getByRole('button', { name: 'Mitarbeiter hinzufügen' }).click();
    await page.getByRole('textbox', { name: 'Vorname', exact: true }).fill('Ohne');
    await page.getByRole('textbox', { name: 'Nachname', exact: true }).fill('Mail');
    await page.getByRole('button', { name: 'Übernehmen', exact: true }).click();
    await page.getByText('Einstellungen erfolgreich gespeichert.', { exact: true }).waitFor();
    assert.equal(savedSettings.employees.find(row => row.first_name === 'Ohne').email, null);
    console.log('PASS: Mitarbeiter ohne E-Mail im Browser speichern');
    await page.getByRole('button', { name: /Zurück zum Inventar/ }).click();

    await openQr();
    const labelBounds=await page.locator('.qr-code-form > label').boundingBox();
    const inputBounds=await page.getByLabel('QR-Code / EAN / Artikelkennung',{exact:true}).boundingBox();
    assert.ok(labelBounds.y+labelBounds.height <= inputBounds.y,'Die Beschriftung muss oberhalb des Eingabefelds stehen');
    await screenshot('desktop-scanner-start');
    await lookup('4006381333931');
    await page.getByRole('heading',{name:'USB-C Kabel',exact:true}).waitFor();
    assert.deepEqual(lookups.at(-1),{code:'4006381333931',type:'ean'});
    await page.getByRole('button',{name:'Weiteren Code scannen',exact:true}).click();
    await lookup('PC-001');
    await page.getByRole('button',{name:'Gerät bearbeiten',exact:true}).waitFor();
    assert.deepEqual(lookups.at(-1),{code:'PC-001',type:'serial'});
    await page.getByRole('button',{name:'Weiteren Code scannen',exact:true}).click();
    await lookup('96385074');
    await page.getByLabel('Gefundenen Artikel auswählen').waitFor();
    assert.deepEqual(lookups.at(-1),{code:'96385074',type:'ean'});
    await closeQr();
    await openQr();
    await page.getByLabel('Code-Bild öffnen',{exact:true}).setInputFiles(path.join(__dirname,'fixtures/QR-NUMERIC.svg'));
    await page.getByRole('heading',{name:'USB-C Kabel',exact:true}).waitFor();
    assert.deepEqual(lookups.at(-1),{code:'4006381333931',type:'qr'});
    await closeQr();
    console.log('PASS: Keine Codeart-Auswahl, Eingabelabel ohne Überlappung, automatische EAN/QR-Wechsel und numerischer QR-Code');

    for (const [fixture, code, format, heading] of [
      ['CODE128.svg', '87954252804', 'Code 128', 'USB-C Kabel'],
      ['CODE39.svg', 'PC-001', 'Code 39', 'TestBook'],
    ]) {
      await openQr();
      await page.getByLabel('Code-Bild öffnen', {exact:true}).setInputFiles(path.join(__dirname,'fixtures',fixture));
      await page.getByRole('heading',{name:heading,exact:true}).waitFor();
      assert.deepEqual(lookups.at(-1), {code,type:'serial'});
      assert.equal(await page.locator('.qr-code-badge').textContent(),format+' · Seriennummer');
      await page.getByRole('button',{name:'Bestand neu prüfen',exact:true}).click();
      await page.waitForFunction(()=>!document.querySelector('.qr-refresh-button').disabled);
      assert.deepEqual(lookups.at(-1), {code,type:'serial'});
      assert.equal(await page.locator('.qr-code-badge').textContent(),format+' · Seriennummer');
      await closeQr();
    }
    await openQr();
    await page.getByLabel('Code-Bild öffnen',{exact:true}).setInputFiles(path.join(__dirname,'fixtures/CODE128-NEW.svg'));
    await page.getByRole('heading',{name:'Neuer Inventareintrag'}).waitFor();
    assert.match(await page.locator('.asset-form-qr-notice').textContent(),/Code 128: PART-128-NEW/);
    assert.equal(await page.getByLabel('Seriennummer:',{exact:true}).inputValue(),'PART-128-NEW');
    assert.equal(await page.getByLabel('EAN:',{exact:true}).inputValue(),'');
    await page.getByRole('button',{name:/Zurück zum Inventar/}).click();
    assert.ok(wasmRequests.length > 0);
    assert.ok(wasmRequests.every(url=>url.startsWith(process.env.UI_BASE_URL || 'http://127.0.0.1:5173')),'WASM muss vom Anwendungsserver kommen');
    console.log('PASS: Code 128 / Code 39 aus Bildern, Format bleibt bei Aktualisierung erhalten, Barcode-Neuanlage und lokaler WASM-Decoder');

    await openQr(); await lookup('QR-NEU-42');
    await page.getByRole('heading', { name: 'Neuer Inventareintrag' }).waitFor();
    assert.equal(await page.locator('.asset-form-qr-notice').textContent().then(text => text.includes('QR-NEU-42')), true);
    const row = label => page.locator('.asset-form-row').filter({ has: page.locator('label').filter({ hasText: label }) });
    assert.equal(await row(/^Produkterkennung \*:/).locator('input').inputValue(), 'QR-NEU-42');
    assert.equal(await row(/^Produkterkennung \*:/).locator('input').getAttribute('readonly'), null);
    await row(/^Standort \*:/).locator('select').selectOption('1');
    await row(/^Abteilung \*:/).locator('select').selectOption('10');
    await row(/^Lagerort \*:/).locator('select').selectOption('11');
    await page.getByLabel('Kaufdatum *:', { exact: true }).fill('2026-10-22');
    await page.getByRole('button', { name: /speichern/i }).click();
    await page.locator('.inventory-table tbody tr').first().waitFor();
    assert.equal(lastAsset.asset.serial_number, 'QR-NEU-42');
    assert.equal(lastAsset.scanner_codes.qr_code, null);
    assert.equal(lastAsset.asset.asset_tag, 'QR-NEU-42');
    console.log('PASS: Unbekannter Code öffnet neuen Artikel und bleibt beim Speichern zugeordnet');

    await openQr();
    await page.getByLabel('Code-Bild öffnen', { exact: true }).setInputFiles(path.join(__dirname, 'fixtures/QR-CABLE.png'));
    await page.getByRole('heading', { name: 'USB-C Kabel', exact: true }).waitFor();
    assert.match(await page.locator('.qr-stock-balance').textContent(), /5 Stück/);
    await page.getByLabel('Menge [Stück]', { exact: true }).fill('2');
    await page.getByRole('button', { name: 'Bestand erhöhen', exact: true }).click();
    await page.getByRole('status').filter({ hasText: 'Zugang von 2 Stück gespeichert.' }).waitFor();
    assert.equal(bookings.length, 1); assert.equal(stock, 7);
    await page.getByLabel('Menge [Stück]', { exact: true }).fill('8');
    await page.getByRole('button', { name: 'Bestand reduzieren', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: 'grösser als' }).waitFor();
    assert.equal(bookings.length, 1);
    await page.getByLabel('Menge [Stück]', { exact: true }).fill('7');
    await page.getByRole('button', { name: 'Bestand reduzieren', exact: true }).click();
    const withdrawal=page.getByRole('dialog',{name:'Bestand entnehmen',exact:true});
    await withdrawal.getByLabel('Verwendung *',{exact:true}).selectOption('archive');
    await withdrawal.getByLabel('Grund *',{exact:true}).selectOption('lost');
    await withdrawal.getByRole('button',{name:'Entnahme buchen',exact:true}).click();
    await withdrawal.waitFor({state:'hidden'});
    await page.getByRole('status').filter({ hasText: 'Entnahme ins Archiv von 7 Stück gespeichert.' }).waitFor();
    assert.equal(stock, 0); assert.equal(bookings.length, 2);
    assert.equal(await page.getByRole('button', { name: 'Bestand reduzieren', exact: true }).isDisabled(), true);
    await page.getByRole('button', { name: 'Bestand neu prüfen', exact: true }).click();
    await page.getByRole('heading', { name: 'USB-C Kabel', exact: true }).waitFor();
    assert.match(await page.locator('.qr-stock-balance').textContent(), /0 Stück/);
    console.log('PASS: Echten QR-Code aus Bild lesen, Zugang/Abgang, Mengenprüfung und Wiedererkennung bei null');

    uncertain = true;
    await page.getByLabel('Menge [Stück]', { exact: true }).fill('1');
    await page.getByRole('button', { name: 'Bestand erhöhen', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: 'Buchungsstatus ist unklar' }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Bestand erhöhen', exact: true }).isDisabled(), true);
    const pending=bookings.at(-1).request_id;
    await page.getByRole('button', { name: 'Buchung erneut prüfen', exact: true }).click();
    await page.waitForFunction(() => !document.querySelector('.qr-result .primary-button').disabled);
    assert.equal(bookings.at(-1).request_id,pending);assert.equal(stock,1);
    malformed = true;
    await page.getByRole('button', { name: 'Bestand erhöhen', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: 'Buchungsstatus ist unklar' }).waitFor();
    await page.getByRole('button', { name: 'Buchung erneut prüfen', exact: true }).click();
    await page.waitForFunction(() => !document.querySelector('.qr-result .primary-button').disabled);
    assert.equal(stock,2);
    await closeQr();
    console.log('PASS: Verbindungsabbruch und ungültige Antwort nach bereits gespeicherter Buchung; Wiederholung ohne Doppelbuchung');

    const imageData = 'data:image/png;base64,' + fs.readFileSync(path.join(__dirname, 'fixtures/QR-CABLE.png')).toString('base64');
    await page.evaluate(dataUrl => {
      window.testStreams = [];
      navigator.mediaDevices.getUserMedia = async constraints => {
        window.testCameraConstraints = constraints;
        const image = new Image(); image.src = window.testCodeImage || dataUrl; await image.decode();
        const neighbors = (window.testCameraNeighbors || []).map(spec => {
          const neighbor = new Image(); neighbor.src = spec.url;
          return { ...spec, image: neighbor };
        });
        await Promise.all(neighbors.map(({image}) => image.decode()));
        const canvas = document.createElement('canvas'); canvas.width = window.testPortraitCamera ? 1080 : 640; canvas.height = window.testPortraitCamera ? 1920 : 480;
        const context = canvas.getContext('2d');
        const paint = () => {
          context.fillStyle = 'white'; context.fillRect(0, 0, canvas.width, canvas.height);
          if (!window.testBlankCamera) {
            const factor=Math.min(canvas.width*(neighbors.length ? .55 : .75)/image.naturalWidth,canvas.height*.65/image.naturalHeight);
            const w=image.naturalWidth*factor,h=image.naturalHeight*factor;
            context.drawImage(image,(canvas.width-w)/2,(canvas.height-h)/2,w,h);
          }
          for (const {image, x, y, size} of neighbors) context.drawImage(image, x, y, size, size);
        };
        paint(); const timer = setInterval(paint, 100);
        const stream = canvas.captureStream(10); window.testStreams.push(stream);
        const track=stream.getVideoTracks()[0];
        const originalStop = track.stop.bind(track);
        track.stop = () => { clearInterval(timer); originalStop(); };
        track.getCapabilities = () => ({focusMode:['continuous'],zoom:{min:1,max:4,step:.1},torch:true});
        track.applyConstraints = async constraints => {
          (window.testAppliedConstraints ||= []).push(constraints);
          if (window.testRejectCameraSetting) throw new Error('unsupported');
        };
        return stream;
      };
      navigator.mediaDevices.enumerateDevices = async () => [];
      window.fakeScannerGetUserMedia = navigator.mediaDevices.getUserMedia;
    }, imageData);
    await openQr(); await page.getByRole('button', { name: 'Kamera starten', exact: true }).click();
    await page.getByRole('heading', { name: 'USB-C Kabel', exact: true }).waitFor();
    assert.equal(await page.evaluate(() => window.testStreams.every(s => s.getTracks().every(t => t.readyState === 'ended'))), true);
    assert.equal(await page.evaluate(() => window.testCameraConstraints.video.facingMode.ideal), 'environment');
    await closeQr();
    await page.evaluate(() => { navigator.mediaDevices.getUserMedia = async () => { throw new DOMException('Permission denied', 'NotAllowedError'); }; });
    await openQr(); await page.getByRole('button', { name: 'Kamera starten', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: 'Kamerazugriff nicht erlaubt' }).waitFor();
    await closeQr();
    console.log('PASS: Video-QR-Erkennung mit Kamerabild, Rückkamerawunsch, Freigabe der Tracks und Berechtigungsfehler');

    const code128Data = 'data:image/svg+xml;base64,' + fs.readFileSync(path.join(__dirname,'fixtures/CODE128.svg')).toString('base64');
    await page.evaluate(dataUrl => { window.testCodeImage=dataUrl; navigator.mediaDevices.getUserMedia=window.fakeScannerGetUserMedia; },code128Data);
    await openQr(); await page.getByRole('button',{name:'Kamera starten',exact:true}).click();
    await page.getByRole('heading',{name:'USB-C Kabel',exact:true}).waitFor();
    assert.deepEqual(lookups.at(-1),{code:'87954252804',type:'serial'});
    assert.equal(await page.locator('.qr-code-badge').textContent(),'Code 128 · Seriennummer');
    assert.equal(await page.evaluate(()=>window.testStreams.every(s=>s.getTracks().every(t=>t.readyState==='ended'))),true);
    assert.ok(await page.evaluate(()=>window.testAppliedConstraints.some(c=>c.advanced?.[0]?.focusMode==='continuous')));
    assert.equal(await page.evaluate(()=>window.testCameraConstraints.video.width.ideal),1920);
    await closeQr();
    console.log('PASS: Code-128-Kamerastream mit bestätigter Erkennung, Autofokus, hoher Auflösung und Track-Freigabe');

    const lookupsBeforeSerial = lookups.length;
    await page.evaluate(() => { location.hash = '/inventory/asset%3A1/edit'; });
    await page.getByRole('heading',{name:'Inventareintrag bearbeiten',exact:true}).waitFor();
    const serialField = page.getByLabel('Seriennummer:',{exact:true});
    assert.equal(await serialField.inputValue(),'OLD-SN');
    await page.setViewportSize({width:390,height:844});
    const photoButton = page.getByRole('button',{name:'Foto aufnehmen',exact:true});
    await photoButton.waitFor();
    assert.equal(await photoButton.evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(40, 104, 173)');
    await photoButton.hover();
    assert.equal(await photoButton.evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(33, 91, 152)');
    await page.setViewportSize({width:1440,height:1000});
    await page.getByRole('button',{name:'Seriennummer scannen',exact:true}).click();
    const serialDialog = page.getByRole('dialog',{name:'Seriennummer scannen',exact:true});
    await serialDialog.getByLabel('Code-Bild öffnen',{exact:true}).setInputFiles(path.join(__dirname,'fixtures/4006381333931.svg'));
    await serialDialog.getByRole('alert').filter({hasText:'Kein Seriennummern-Barcode gefunden'}).waitFor();
    await serialDialog.getByRole('button',{name:'Kamera starten',exact:true}).click();
    await serialDialog.getByRole('button',{name:'87954252804 übernehmen',exact:true}).click();
    await serialDialog.waitFor({state:'hidden'});
    assert.equal(await serialField.inputValue(),'87954252804');
    assert.equal(await page.getByLabel('Produkterkennung *:',{exact:true}).inputValue(),'PC-001');
    assert.equal(await page.getByLabel('MAC-Adresse:',{exact:true}).inputValue(),'AA:BB:CC:11:22:33');
    assert.equal(lookups.length,lookupsBeforeSerial);
    assert.ok(await page.evaluate(()=>window.testStreams.every(s=>s.getTracks().every(t=>t.readyState==='ended'))));
    await page.getByRole('button',{name:'Änderungen speichern',exact:true}).click();
    await page.locator('.inventory-table tbody tr').first().waitFor();
    assert.deepEqual([lastEdit.asset.serial_number,lastEdit.asset.asset_tag,lastEdit.asset.mac_address],
      ['87954252804','PC-001','AA:BB:CC:11:22:33']);
    console.log('PASS: Seriennummer im Bearbeitungsformular mit Kamera übernommen; EAN abgewiesen, andere Felder unverändert, Foto-Button blau');

    const eanVideo = 'data:image/svg+xml;base64,' + fs.readFileSync(path.join(__dirname,'fixtures/4006381333931.svg')).toString('base64');
    await page.evaluate(dataUrl => { window.testCodeImage = dataUrl; navigator.mediaDevices.getUserMedia = window.fakeScannerGetUserMedia; }, eanVideo);
    await openQr(); await page.getByRole('button',{name:'Kamera starten',exact:true}).click();
    await page.getByRole('heading',{name:'USB-C Kabel',exact:true}).waitFor();
    assert.deepEqual(lookups.at(-1), {code:'4006381333931',type:'ean'});
    assert.equal(await page.evaluate(() => window.testStreams.every(stream => stream.getTracks().every(track => track.readyState === 'ended'))),true);
    await closeQr();
    console.log('PASS: EAN-13 auch aus simuliertem Kamerabild erkannt und Kamera freigegeben');

    const distractingQr = 'data:image/svg+xml;base64,' + fs.readFileSync(path.join(__dirname,'fixtures/QR-NUMERIC.svg')).toString('base64');
    const lookupsBefore = lookups.length;
    await page.evaluate(url => {
      window.testBlankCamera = true;
      window.testCameraNeighbors = [{ url, x: 3, y: 200, size: 42 }];
    }, distractingQr);
    await openQr();
    await page.getByRole('button',{name:'Kamera starten',exact:true}).click();
    await page.getByText('Kamera aktiv', {exact:true}).waitFor();
    await page.waitForTimeout(750);
    assert.equal(lookups.length, lookupsBefore, 'QR ausserhalb des Rahmens bleibt unberücksichtigt');
    await closeQr();
    await page.evaluate(url => { window.testCameraNeighbors = [{ url, x: 65, y: 100, size: 90 }]; }, distractingQr);
    await openQr(); await page.getByRole('button',{name:'Kamera starten',exact:true}).click();
    await page.getByRole('heading',{name:'USB-C Kabel',exact:true}).waitFor();
    assert.deepEqual(lookups.at(-1), {code:'4006381333931',type:'qr'}, 'QR im Rahmen ist auch allein lesbar');
    await closeQr();
    await page.evaluate(({ url, ean }) => {
      window.testBlankCamera = false;
      window.testCodeImage = ean;
      window.testCameraNeighbors = [{ url, x: 65, y: 100, size: 90 }];
    }, {url:distractingQr, ean:eanVideo});
    await openQr(); await page.getByRole('button',{name:'Kamera starten',exact:true}).click();
    await page.getByRole('heading',{name:'Erkannte Codes zuordnen',exact:true}).waitFor();
    const cameraChoices = page.getByRole('combobox',{name:'Zuordnung für 4006381333931',exact:true});
    assert.equal(await cameraChoices.count(), 2);
    for (const choice of await cameraChoices.all()) {
      if (await choice.inputValue() === 'qr') await choice.selectOption('ignore');
    }
    await page.getByRole('button',{name:'Zuordnung prüfen',exact:true}).click();
    await page.getByRole('heading',{name:'USB-C Kabel',exact:true}).waitFor();
    assert.deepEqual(lookups.at(-1), {code:'4006381333931',type:'ean'});
    await closeQr();
    await page.evaluate(() => { window.testCameraNeighbors = []; });
    console.log('PASS: QR am Bildrand wird ignoriert; QR und EAN im Rahmen werden gemeinsam erkannt');

    // Gleicher Mengenartikel über EAN-13, echter Barcode-Decoder statt Textsimulation.
    await openQr();
    await page.getByLabel('Code-Bild öffnen', {exact:true}).setInputFiles(path.join(__dirname,'fixtures/4006381333931.svg'));
    await page.getByRole('heading',{name:'USB-C Kabel',exact:true}).waitFor();
    assert.deepEqual(lookups.at(-1), {code:'4006381333931',type:'ean'});
    await page.getByLabel('Menge [Stück]', {exact:true}).fill('3');
    await page.getByRole('button',{name:'Bestand erhöhen',exact:true}).click();
    await page.getByRole('status').filter({hasText:'Zugang von 3 Stück gespeichert.'}).waitFor();
    assert.equal(bookings.at(-1).code,'4006381333931');
    await closeQr();
    // EAN-8 mit mehreren Geräten verlangt eine ausdrückliche Auswahl.
    await openQr();
    await page.getByLabel('Code-Bild öffnen', {exact:true}).setInputFiles(path.join(__dirname,'fixtures/96385074.svg'));
    await page.getByLabel('Gefundenen Artikel auswählen').waitFor();
    assert.equal(await page.getByLabel('Gefundenen Artikel auswählen').inputValue(), '');
    assert.equal(await page.getByRole('button',{name:'Gerät löschen',exact:true}).count(),0);
    await page.getByLabel('Gefundenen Artikel auswählen').selectOption('asset:2');
    await page.getByRole('button',{name:'Gerät bearbeiten',exact:true}).waitFor();
    assert.deepEqual(lookups.at(-1), {code:'96385074',type:'ean'});
    await closeQr();
    // EAN-13 mit führender Null hat das Strichmuster eines UPC-A.
    await openQr();
    await page.getByLabel('Code-Bild öffnen', {exact:true}).setInputFiles(path.join(__dirname,'fixtures/0012345678905.svg'));
    await page.getByRole('alert').filter({hasText:'Diese UPC ist noch nicht hinterlegt.'}).waitFor();
    await page.getByRole('button',{name:'Weiteren Code scannen',exact:true}).click();
    await page.getByLabel('Code-Bild öffnen', {exact:true}).setInputFiles(path.join(__dirname,'fixtures/96385074.svg'));
    await page.getByLabel('Zuordnung für 012345678905',{exact:true}).waitFor();
    await page.getByLabel('Zuordnung für 96385074',{exact:true}).waitFor();
    await page.getByRole('button',{name:'Zuordnung prüfen',exact:true}).click();
    await page.getByLabel('Gefundenen Artikel auswählen').waitFor();
    assert.equal(await page.getByLabel('Gefundenen Artikel auswählen').locator('option').count(),3);
    await closeQr();
    await openQr();
    await page.getByLabel('Code-Bild öffnen', {exact:true}).setInputFiles(path.join(__dirname,'fixtures/0012345678905.svg'));
    await page.getByRole('button',{name:'Zuordnung prüfen',exact:true}).click();
    await page.getByRole('heading',{name:'Neuer Inventareintrag'}).waitFor();
    assert.equal(await page.getByLabel('UPC-A:',{exact:true}).inputValue(),'012345678905');
    assert.equal(await page.getByLabel('QR-Code / Barcode:',{exact:true}).inputValue(),'');
    assert.equal(await row(/^Produkterkennung \*:/).locator('input').inputValue(),'');
    await row(/^Produktmodell \*:/).locator('select').selectOption('100');
    await page.getByLabel('UPC-A:',{exact:true}).fill('012345678906');
    await row(/^Produkterkennung \*:/).locator('input').fill('PC-NEW');
    await row(/^Standort \*:/).locator('select').selectOption('1');
    await row(/^Abteilung \*:/).locator('select').selectOption('10');
    await row(/^Lagerort \*:/).locator('select').selectOption('11');
    await page.getByRole('button',{name:/speichern/i}).click();
    await page.getByRole('alert').filter({hasText:'gültige UPC-A'}).waitFor();
    await page.getByLabel('UPC-A:',{exact:true}).fill('012345678905');
    await page.getByRole('button',{name:/speichern/i}).click();
    await page.locator('.inventory-table tbody tr').first().waitFor();
    assert.equal(lastAsset.scanner_codes.upc,'012345678905');
    assert.equal(lastAsset.scanner_codes.qr_code,null);
    assert.equal(lastAsset.asset.asset_tag,'PC-NEW');
    console.log('PASS: EAN-13, EAN-8, Mehrfachtreffer, Prüfziffer und unabhängige optionale Kennungen');

    // With no retail match, an exact device identity wins.
    await openQr(); await lookup('SN: PC-001');
    await page.getByRole('button',{name:'Gerät bearbeiten',exact:true}).waitFor();
    assert.equal(await page.getByLabel('Gefundenen Artikel auswählen').count(),0);
    await closeQr();
    await openQr(); await lookup('SN: PC-001; EAN: 96385074');
    await page.getByRole('button',{name:'Zuordnung prüfen',exact:true}).click();
    await page.getByLabel('Gefundenen Artikel auswählen').waitFor();
    assert.equal(await page.getByLabel('Gefundenen Artikel auswählen').locator('option').count(),3);
    await closeQr();

    // The original label's EAN finds the model even if UPC and serial number are unknown.
    data.product_models.push({id:105,name:'Test DECT',category_id:1,manufacturer_id:1,
      is_active:true,tracking_mode:'serialized',ean:'6938818307575',upc:'841885106377',specifications:{}});
    await openQr();
    if (process.env.MULTISCAN_LABEL) {
      const printedSerial = process.env.MULTISCAN_LABEL_SERIAL;
      const otherIdentifier = process.env.MULTISCAN_LABEL_OTHER;
      await page.getByLabel('Code-Bild öffnen',{exact:true}).setInputFiles(process.env.MULTISCAN_LABEL);
      await page.getByRole('heading',{name:'Erkannte Codes zuordnen',exact:true}).waitFor();
      assert.equal(await page.getByLabel('Zuordnung für 841885106377',{exact:true}).inputValue(),'upc');
      assert.equal(await page.getByLabel('Zuordnung für 6938818307575',{exact:true}).inputValue(),'ean');
      const other = page.getByLabel(`Zuordnung für ${otherIdentifier}`,{exact:true});
      if (await other.count()) await other.selectOption('ignore');
      const serial = page.getByLabel(`Zuordnung für ${printedSerial}`,{exact:true});
      if (await serial.count()) await serial.selectOption('serial');
      else {
        await page.getByLabel('Fehlende Kennung ergänzen',{exact:true}).fill(`SN: ${printedSerial}`);
        await page.getByRole('button',{name:'Hinzufügen',exact:true}).click();
      }
      await page.getByRole('button',{name:'Zuordnung prüfen',exact:true}).click();
      await page.getByRole('heading',{name:'Test DECT',exact:true}).waitFor();
      assert.deepEqual(await page.getByLabel('Gefundenen Artikel auswählen').locator('option:not([disabled])').evaluateAll(options=>options.map(option=>option.value)),['asset:5','asset:6']);
      await closeQr();
      await openQr();
    }
    knownRetail = 'upc';
    await lookup('SN: DECT-NEW; EAN: 6938818307575; UPC: 841885106377; MAC ID: AA-BB-CC-11-22-33');
    await page.getByRole('button',{name:'Zuordnung prüfen',exact:true}).click();
    await page.getByRole('heading',{name:'Test DECT',exact:true}).waitFor();
    assert.equal(await page.getByLabel('Gefundenen Artikel auswählen').locator('option').count(),3);
    await closeQr();
    await openQr(); await lookup('EAN: 96385074; UPC: 841885106377');
    await page.getByRole('button',{name:'Zuordnung prüfen',exact:true}).click();
    await page.getByRole('alert').filter({hasText:'gehören zu unterschiedlichen Modellen'}).waitFor();
    await closeQr();
    await openQr();
    await lookup('SN:DECT-NEW;EAN:5901234123457;UPC:012345678905;MAC ID:00AbC-123;MAC-Adresse:AA-BB-CC-11-22-33');
    assert.equal(await page.getByLabel('Zuordnung für 00AbC-123',{exact:true}).inputValue(),'asset_tag');
    await page.getByLabel('Fehlende Kennung ergänzen',{exact:true}).fill('DEVICE-QR');
    await page.getByRole('button',{name:'Hinzufügen',exact:true}).click();
    await page.getByLabel('Zuordnung für DEVICE-QR',{exact:true}).selectOption('qr');
    await page.getByRole('button',{name:'Zuordnung prüfen',exact:true}).click();
    await page.getByRole('heading',{name:'Neuer Inventareintrag'}).waitFor();
    assert.equal(await page.getByLabel('Produkterkennung *:',{exact:true}).inputValue(),'00AbC-123');
    assert.equal(await row(/^Produktmodell \*:/).locator('select').inputValue(),'');
    assert.equal(await page.getByLabel('Seriennummer:',{exact:true}).inputValue(),'DECT-NEW');
    assert.equal(await page.getByLabel('MAC-Adresse:',{exact:true}).inputValue(),'AA:BB:CC:11:22:33');
    assert.equal(await page.getByLabel('EAN:',{exact:true}).inputValue(),'5901234123457');
    assert.equal(await page.getByLabel('UPC-A:',{exact:true}).inputValue(),'012345678905');
    assert.equal(await page.getByLabel('QR-Code / Barcode:',{exact:true}).inputValue(),'DEVICE-QR');
    await page.goto((process.env.UI_BASE_URL || 'http://127.0.0.1:5173') + '/#/inventory');
    await page.locator('.inventory-table tbody tr').first().waitFor();
    console.log('PASS: EAN- und UPC-Treffer zeigen alle Modellartikel; Einzelcode, Konflikt und vorausgefüllter Neuantrag');

    await page.locator('.inventory-table tbody tr').first().click({button:'right'});
    await page.getByRole('menu',{name:'Eintrag',exact:true}).waitFor();
    assert.equal(await page.getByRole('menuitem',{name:'Eintrag bearbeiten'}).count(),1);
    await page.keyboard.press('Escape');
    await page.locator('.inventory-table tbody tr').nth(1).click({button:'right'});
    await page.waitForFunction(()=>document.querySelector('[role=menuitem]:last-child')?.getAttribute('aria-disabled')==='false');
    await page.getByRole('menuitem',{name:'Eintrag löschen'}).click();
    const archiveDialog=page.getByRole('dialog',{name:'Artikel archivieren',exact:true});
    await archiveDialog.getByLabel('Grund *',{exact:true}).selectOption('defective');
    await archiveDialog.getByLabel('Wurde der Artikel vernichtet? *',{exact:true}).selectOption('yes');
    await archiveDialog.getByRole('button',{name:'Archivieren',exact:true}).click();
    await archiveDialog.waitFor({state:'hidden'});
    await page.waitForFunction(()=>!document.querySelector('.entry-context-menu'));
    assert.ok(deletedKeys.length === 1 && deletedKeys[0].startsWith('stock:'));

    // Das schmale Fenster aus dem Fehlerbericht bekommt eine Tabelle über die ganze Breite.
    const pc = await browser.newPage({viewport:{width:853,height:910},hasTouch:false});
    await pc.route(url=>url.pathname.startsWith('/api/'),handleApi);
    await pc.goto((process.env.UI_BASE_URL || 'http://127.0.0.1:5173')+'/#/inventory');
    await pc.locator('.inventory-table tbody tr').first().waitFor();
    assert.equal(await pc.getByRole('tab', { name: 'Tabelle', exact: true }).getAttribute('aria-selected'), 'true');
    assert.equal(await pc.locator('.dock-navigation-shell').isVisible(),false);
    const compactTable = await pc.locator('.table-wrapper').boundingBox();
    assert.ok(compactTable.x < 20 && compactTable.width > 820);
    if (process.env.SCREENSHOT_DIR) await pc.screenshot({ path: path.join(process.env.SCREENSHOT_DIR, 'desktop-853.png') });
    assert.equal(await pc.getByText(/Inventareinträge geladen\./).count(), 0);
    assert.equal(await pc.locator('.status-bar').getByText(/Datensätze/).count(), 1);
    await pc.getByRole('searchbox', { name: 'Inventar durchsuchen' }).fill('kein passender Eintrag');
    await pc.getByText('Keine Inventareinträge gefunden.').waitFor();
    await pc.getByRole('searchbox', { name: 'Inventar durchsuchen' }).clear();
    await pc.getByRole('tab', { name: 'Filter', exact: true }).click();
    await pc.locator('.dock-navigation-shell').waitFor();
    await pc.getByRole('tab', { name: 'Details', exact: true }).click();
    await pc.locator('.dock-detail-shell').waitFor();
    // Unter Chromium --single-process bleiben beide Testkontexte bis zum Testende offen.
    console.log('PASS: Kontextmenü, Löschen nur des angeklickten Artikels und kompaktes PC-Layout mit Maus');

    for (const width of [390, 360, 844]) {
      await page.setViewportSize({ width, height: width === 844 ? 390 : 800 });
      await page.locator('.inventory-table tbody tr').first().waitFor();

      const cdp = await page.context().newCDPSession(page);
      const swipe = async (x1,y1,x2,y2) => {
        await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:x1,y:y1}]});
        for(let i=1;i<=5;i++) await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x1+(x2-x1)*i/5,y:y1+(y2-y1)*i/5}]});
        await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
      };
      // Wischen neben der Tabelle wechselt zum nächsten Bereich.
      const table = await page.locator('.table-wrapper').boundingBox();
      await swipe(width-3,table.y+12,20,table.y+12);
      await page.waitForFunction(()=>document.querySelector('#mobile-tab-detail')?.getAttribute('aria-selected') === 'true');
      const detail=await page.locator('.details-content').boundingBox();
      await swipe(20,detail.y+70,width-20,detail.y+70);
      await page.waitForFunction(()=>document.querySelector('#mobile-tab-inventory')?.getAttribute('aria-selected') === 'true');
      let bounds=await page.locator('.inventory-table tbody tr').first().boundingBox();
      await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:Math.min(width-20,bounds.x+80),y:bounds.y+15}]});
      await page.waitForTimeout(650);
      await page.getByRole('menu',{name:'Eintrag',exact:true}).waitFor();
      await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
      await page.keyboard.press('Escape');
      // Scrollbewegung bricht das lange Drücken ab.
      await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:80,y:bounds.y+15}]});
      await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:80,y:bounds.y+60}]});
      await page.waitForTimeout(650);
      assert.equal(await page.getByRole('menu',{name:'Eintrag',exact:true}).count(),0);
      await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
      await cdp.detach();

      await noHorizontalOverflow(); await screenshot(`mobile-${width}-inventory`);
      assert.equal(await page.getByRole('tab', { name: 'Tabelle', exact: true }).getAttribute('aria-selected'), 'true');
      await page.getByRole('tab', { name: 'Filter', exact: true }).click();
      await page.getByRole('searchbox', { name: 'Inventar durchsuchen', exact: true }).waitFor();
      await noHorizontalOverflow(); await screenshot(`mobile-${width}-filter`);
      await page.getByRole('button', { name: 'Status', exact: true }).click();
      await page.locator('.filter-dropdown-menu').filter({ visible: true }).waitFor();
      const popup = await page.locator('.filter-dropdown-menu').filter({ visible: true }).boundingBox();
      assert.ok(popup.x >= 0 && popup.x + popup.width <= width);
      await page.getByRole('button', { name: 'Status', exact: true }).click();
      await page.getByRole('tab', { name: 'Tabelle', exact: true }).click();
      await page.locator('.inventory-table tbody tr').first().click();
      await page.getByRole('tab', { name: 'Details', exact: true }).click();
      await page.locator('.dock-detail-shell').waitFor({ state: 'visible' });
      await noHorizontalOverflow(); await screenshot(`mobile-${width}-details`);
      await openQr();
      await screenshot(`mobile-${width}-scanner-start`);
      assert.equal(await page.locator('.qr-dialog').evaluate(el=>el.scrollWidth > el.clientWidth),false);
      await page.evaluate(()=>{window.testBlankCamera=true;window.testPortraitCamera=true;});
      await page.getByRole('button',{name:'Kamera starten',exact:true}).click();
      await page.getByText('Kamera aktiv',{exact:true}).waitFor();
      await page.getByLabel('Kamera-Zoom').press('ArrowRight');
      await page.getByRole('button',{name:'Licht an',exact:true}).click();
      assert.equal(await page.getByRole('button',{name:'Licht aus',exact:true}).getAttribute('aria-pressed'),'true');
      const cameraBox=await page.locator('.qr-video-wrap').boundingBox();
      assert.ok(cameraBox.width > 200 && cameraBox.width <= width && cameraBox.height <= 340);
      assert.equal(await page.locator('.qr-dialog-body').evaluate(el=>el.scrollWidth > el.clientWidth),false);
      const manualLabel=await page.locator('.qr-code-form > label').boundingBox();
      const manualInput=await page.locator('#qr-code-input').boundingBox();
      assert.ok(manualLabel.y+manualLabel.height <= manualInput.y);
      await page.locator('.qr-video-wrap').scrollIntoViewIfNeeded();
      await screenshot(`mobile-${width}-scanner-camera`);
      await page.getByRole('button',{name:'Kamera stoppen',exact:true}).click();
      assert.equal(await page.evaluate(()=>window.testStreams.every(s=>s.getTracks().every(t=>t.readyState==='ended'))),true);
      await page.evaluate(()=>{window.testBlankCamera=false;window.testPortraitCamera=false;});
      await lookup('QR-CABLE');
      await page.getByRole('heading', { name: 'USB-C Kabel', exact: true }).waitFor();
      await noHorizontalOverflow(); await screenshot(`mobile-${width}-qr`);
      const dialog = await page.locator('.qr-dialog').boundingBox();
      if (width <= 600) {
        assert.equal(dialog.x, 0); assert.equal(dialog.width, width);
      } else {
        assert.ok(dialog.x >= 0 && dialog.x + dialog.width <= width);
        assert.ok(dialog.y >= 0 && dialog.y + dialog.height <= 390);
      }
      await closeQr();
      await page.getByRole('tab', { name: 'Tabelle', exact: true }).click();
      await page.getByRole('button', { name: '+ Neuer Artikel', exact: true }).click();
      await page.getByRole('heading', { name: 'Neuer Inventareintrag' }).waitFor();
      await noHorizontalOverflow(); await screenshot(`mobile-${width}-form`);
      await page.getByRole('button', { name: /Zurück zum Inventar/ }).click();
      await page.evaluate(() => { location.hash = '/settings?tab=employees'; });
      await page.getByRole('table', { name: 'Mitarbeiter' }).waitFor();
      await noHorizontalOverflow(); await screenshot(`mobile-${width}-employees`);
      await page.getByRole('button', { name: /Zurück zum Inventar/ }).click();
    }
    console.log('PASS: Hochformat 390/360 px und Querformat 844 px: Tabelle, Wischen, langes Drücken, Filter, Details, Scanner, Artikel und Mitarbeiter');

    role = 'viewer'; await page.reload();
    await page.locator('.inventory-table tbody tr').first().waitFor();
    await openQr(); await lookup('QR-CABLE');
    await page.getByRole('heading', { name: 'USB-C Kabel', exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Bestand erhöhen', exact: true }).isDisabled(), true);
    assert.equal(await page.getByRole('button', { name: 'Bestand reduzieren', exact: true }).isDisabled(), true);
    await page.getByRole('button', { name: 'Weiteren Code scannen', exact: true }).click();
    await lookup('NEW-VIEWER');
    await page.getByRole('alert').filter({ hasText: 'Bearbeitungsrechte erforderlich' }).waitFor();
    assert.ok(page.url().endsWith('/#/inventory'));
    assert.deepEqual(errors, []);
    console.log('PASS: Leserrechte geschützt und keine JavaScript-Laufzeitfehler');
  } finally { await browser.close(); if (vite) await vite.close(); }
})();
run.catch(error => { console.error(error); process.exitCode = 1; });
module.exports = run;
