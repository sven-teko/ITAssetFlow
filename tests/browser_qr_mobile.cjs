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
    let stock = 5, bookings = [], savedSettings = null, lastAsset = null, uncertain = false, malformed = false, role = 'admin', deletedKeys = [], lookups = [];
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
      if (endpoint === '/api/inventory/revision') return json({ revision: 1 });
      if (endpoint === '/api/inventory/events') return route.fulfill({ headers, contentType: 'text/event-stream', body: ': test\n\n' });
      if (endpoint === '/api/inventory/form-data') return json(data);
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
        return json(inventory());
      }
      if (endpoint === '/api/scanner/lookup') {
        const code = url.searchParams.get('code'); lookups.push({code, type: url.searchParams.get('code_type')});
        const matches = (code === 'QR-CABLE' || code === '4006381333931' || code === '87954252804') ? [{ key: 'stock:101:11:new', record_type: 'stock', product_model_id: 101, product_model_name: 'USB-C Kabel', ...location, storage_location_id: 11, condition: 'new', quantity: stock }]
          : (code === 'PC-001' || code === '96385074') ? [{ key: 'asset:1', record_type: 'asset', id: 1, asset_tag: 'PC-001', product_model_id: 100, product_model_name: 'TestBook', ...location, storage_location_id: 11, condition: 'used', quantity: 1 }] : [];
        return json({ code, matches: code === '96385074' ? [...matches, {...matches[0], key:'asset:2', id:2, asset_tag:'PC-002'}] : matches, locations: [location] });
      }
      if (endpoint === '/api/scanner/stock') {
        const payload = req.postDataJSON(); bookings.push(payload);
        if (uncertain) { uncertain = false; return route.abort('failed'); }
        if (malformed) { malformed = false; return json({}); }
        stock += payload.direction === 'add' ? payload.quantity : -payload.quantity;
        return json({ saved: true, quantity: stock, changed_quantity: payload.quantity });
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
    await drag('detail', workspace.x + 10, '.dock-drop-zone-left.active');
    assert.deepEqual(await order(), ['detail', 'navigation', 'inventory']);
    await drag('navigation', workspace.x + workspace.width - 10, '.dock-drop-zone-right.active');
    assert.deepEqual(await order(), ['detail', 'inventory', 'navigation']);
    await drag('detail', workspace.x + workspace.width - 10, '.dock-drop-zone-right.active');
    assert.deepEqual(await order(), ['inventory', 'navigation', 'detail']);
    const navBox = await page.locator('[data-dock-panel="navigation"]').boundingBox();
    await drag('detail', navBox.x + navBox.width * 0.35, '.dock-navigation-shell.dock-shell-drop-before');
    assert.deepEqual(await order(), ['inventory', 'detail', 'navigation']);
    const beforeCancel = await order();
    const title = await page.locator('[data-dock-panel="detail"] .dock-title').boundingBox();
    await page.mouse.move(title.x + 30, title.y + 10); await page.mouse.down();
    await page.mouse.move(5, 5, { steps: 5 }); await page.mouse.up();
    assert.deepEqual(await order(), beforeCancel);
    console.log('PASS: Randziele links/rechts, Reihenfolge, Nachbarziel und Abbruch ausserhalb');

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
    assert.deepEqual(lookups.at(-1),{code:'PC-001',type:'qr'});
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
      assert.deepEqual(lookups.at(-1), {code,type:'auto'});
      assert.equal(await page.locator('.qr-code-badge').textContent(),format);
      await page.getByRole('button',{name:'Bestand neu prüfen',exact:true}).click();
      await page.waitForFunction(()=>!document.querySelector('.qr-refresh-button').disabled);
      assert.deepEqual(lookups.at(-1), {code,type:'auto'});
      assert.equal(await page.locator('.qr-code-badge').textContent(),format);
      await closeQr();
    }
    await openQr();
    await page.getByLabel('Code-Bild öffnen',{exact:true}).setInputFiles(path.join(__dirname,'fixtures/CODE128-NEW.svg'));
    await page.getByRole('heading',{name:'Neuer Inventareintrag'}).waitFor();
    assert.match(await page.locator('.asset-form-qr-notice').textContent(),/Code 128: PART-128-NEW/);
    assert.equal(await page.getByLabel('QR-Code / Barcode:',{exact:true}).inputValue(),'PART-128-NEW');
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
    assert.equal(lastAsset.scanner_codes.qr_code, 'QR-NEU-42');
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
    await page.getByRole('status').filter({ hasText: 'Abgang von 7 Stück gespeichert.' }).waitFor();
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
    assert.equal(bookings.length, 3);
    await page.getByRole('button', { name: 'Bestand neu prüfen', exact: true }).click();
    await page.waitForFunction(() => !document.querySelector('.qr-result .primary-button').disabled);
    malformed = true;
    await page.getByRole('button', { name: 'Bestand erhöhen', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: 'Buchungsstatus ist unklar' }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Bestand erhöhen', exact: true }).isDisabled(), true);
    assert.equal(bookings.length, 4);
    await closeQr();
    console.log('PASS: Verbindungsabbruch und ungültige Antwort sperren weitere Buchungen bis zur Bestandsprüfung');

    const imageData = 'data:image/png;base64,' + fs.readFileSync(path.join(__dirname, 'fixtures/QR-CABLE.png')).toString('base64');
    await page.evaluate(dataUrl => {
      window.testStreams = [];
      navigator.mediaDevices.getUserMedia = async constraints => {
        window.testCameraConstraints = constraints;
        const image = new Image(); image.src = window.testCodeImage || dataUrl; await image.decode();
        const canvas = document.createElement('canvas'); canvas.width = window.testPortraitCamera ? 1080 : 640; canvas.height = window.testPortraitCamera ? 1920 : 480;
        const context = canvas.getContext('2d');
        const paint = () => {
          context.fillStyle = 'white'; context.fillRect(0, 0, canvas.width, canvas.height);
          if (!window.testBlankCamera) {
            const factor=Math.min(canvas.width*.75/image.naturalWidth,canvas.height*.75/image.naturalHeight);
            const w=image.naturalWidth*factor,h=image.naturalHeight*factor;
            context.drawImage(image,(canvas.width-w)/2,(canvas.height-h)/2,w,h);
          }
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
    assert.deepEqual(lookups.at(-1),{code:'87954252804',type:'auto'});
    assert.equal(await page.locator('.qr-code-badge').textContent(),'Code 128');
    assert.equal(await page.evaluate(()=>window.testStreams.every(s=>s.getTracks().every(t=>t.readyState==='ended'))),true);
    assert.ok(await page.evaluate(()=>window.testAppliedConstraints.some(c=>c.advanced?.[0]?.focusMode==='continuous')));
    assert.equal(await page.evaluate(()=>window.testCameraConstraints.video.width.ideal),1920);
    await closeQr();
    console.log('PASS: Code-128-Kamerastream mit bestätigter Erkennung, Autofokus, hoher Auflösung und Track-Freigabe');


    const eanVideo = 'data:image/svg+xml;base64,' + fs.readFileSync(path.join(__dirname,'fixtures/4006381333931.svg')).toString('base64');
    await page.evaluate(dataUrl => { window.testCodeImage = dataUrl; navigator.mediaDevices.getUserMedia = window.fakeScannerGetUserMedia; }, eanVideo);
    await openQr(); await page.getByRole('button',{name:'Kamera starten',exact:true}).click();
    await page.getByRole('heading',{name:'USB-C Kabel',exact:true}).waitFor();
    assert.deepEqual(lookups.at(-1), {code:'4006381333931',type:'ean'});
    assert.equal(await page.evaluate(() => window.testStreams.every(stream => stream.getTracks().every(track => track.readyState === 'ended'))),true);
    await closeQr();
    console.log('PASS: EAN-13 auch aus simuliertem Kamerabild erkannt und Kamera freigegeben');

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
    // Unbekannte EAN mit führenden Nullen bleibt getrennt von Asset-Tag und QR.
    await openQr();
    await page.getByLabel('Code-Bild öffnen', {exact:true}).setInputFiles(path.join(__dirname,'fixtures/0012345678905.svg'));
    await page.getByRole('heading',{name:'Neuer Inventareintrag'}).waitFor();
    assert.equal(await page.getByLabel('EAN:',{exact:true}).inputValue(),'0012345678905');
    assert.equal(await page.getByLabel('QR-Code / Barcode:',{exact:true}).inputValue(),'');
    assert.equal(await row(/^Produkterkennung \*:/).locator('input').inputValue(),'');
    await page.getByLabel('EAN:',{exact:true}).fill('4006381333932');
    await row(/^Produkterkennung \*:/).locator('input').fill('PC-NEW');
    await row(/^Standort \*:/).locator('select').selectOption('1');
    await row(/^Abteilung \*:/).locator('select').selectOption('10');
    await row(/^Lagerort \*:/).locator('select').selectOption('11');
    await page.getByRole('button',{name:/speichern/i}).click();
    await page.getByRole('alert').filter({hasText:'gültige EAN'}).waitFor();
    await page.getByLabel('EAN:',{exact:true}).fill('0012345678905');
    await page.getByRole('button',{name:/speichern/i}).click();
    await page.locator('.inventory-table tbody tr').first().waitFor();
    assert.equal(lastAsset.scanner_codes.ean,'0012345678905');
    assert.equal(lastAsset.scanner_codes.qr_code,null);
    assert.equal(lastAsset.asset.asset_tag,'PC-NEW');
    console.log('PASS: EAN-13, EAN-8, Mehrfachtreffer, Prüfziffer und unabhängige optionale Kennungen');

    await page.locator('.inventory-table tbody tr').first().click({button:'right'});
    await page.getByRole('menu',{name:'Eintrag',exact:true}).waitFor();
    assert.equal(await page.getByRole('menuitem',{name:'Eintrag bearbeiten'}).count(),1);
    await page.keyboard.press('Escape');
    await page.locator('.inventory-table tbody tr').nth(1).click({button:'right'});
    page.once('dialog',dialog=>dialog.accept());
    await page.getByRole('menuitem',{name:'Eintrag löschen'}).click();
    await page.waitForFunction(()=>!document.querySelector('.entry-context-menu'));
    assert.ok(deletedKeys.length === 1 && deletedKeys[0].startsWith('stock:'));

    // Ein schmales PC-Fenster mit Maus bleibt im normalen Layout.
    const pc = await browser.newPage({viewport:{width:390,height:844},hasTouch:false});
    await pc.route(url=>url.pathname.startsWith('/api/'),handleApi);
    await pc.goto((process.env.UI_BASE_URL || 'http://127.0.0.1:5173')+'/#/inventory');
    await pc.locator('.inventory-table tbody tr').first().waitFor();
    assert.equal(await pc.getByRole('tablist',{name:'Inventarbereiche'}).count(),0);
    assert.equal(await pc.locator('.dock-navigation-shell').isVisible(),true);
    // Unter Chromium --single-process bleiben beide Testkontexte bis zum Testende offen.
    console.log('PASS: Kontextmenü, Löschen nur des angeklickten Artikels und PC-Layout mit Maus');

    for (const width of [390, 360]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 800 });
      await page.locator('.inventory-table tbody tr').first().waitFor();

      const cdp = await page.context().newCDPSession(page);
      const swipe = async (x1,y1,x2,y2) => {
        await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:x1,y:y1}]});
        for(let i=1;i<=5;i++) await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x1+(x2-x1)*i/5,y:y1+(y2-y1)*i/5}]});
        await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
      };
      // Wischen auf der Tabellenüberschrift wechselt zum nächsten Bereich.
      let heading=await page.locator('.inventory-status').boundingBox();
      await swipe(width-20,heading.y+8,20,heading.y+8);
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
      await page.getByLabel('Inventar durchsuchen', { exact: true }).waitFor();
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
      assert.equal(dialog.x, 0); assert.equal(dialog.width, width);
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
    console.log('PASS: Hochformat 390/360 px: Tabelle, Wischen, langes Drücken, Filter, Details, Scanner, Artikel und Mitarbeiter');

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
