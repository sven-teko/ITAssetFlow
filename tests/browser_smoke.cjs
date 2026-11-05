/* Browserregressionen mit Testdaten, ohne Verbindung zur produktiven API.
   Aufruf bei laufendem Vite: node tests/browser_smoke.cjs
   Benötigt Playwright mit Chromium; optional PLAYWRIGHT_MODULE, CHROMIUM_EXECUTABLE, UI_BASE_URL. */
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || require.resolve('playwright', { paths:[path.resolve(__dirname,'../web')] }));
const assert = require('node:assert/strict');
const fs = require('node:fs');

const run = (async () => {
  const vite = process.env.START_PREVIEW ? await (await import(require.resolve('vite', {paths:[path.resolve(__dirname,'../web')]}))).preview({root:path.resolve(__dirname,'../web'),preview:{host:'127.0.0.1',port:5173,strictPort:true}}) : process.env.START_VITE ? await (await import(require.resolve('vite', {
    paths:[path.resolve(__dirname,'../web')],
  }))).createServer({root:path.resolve(__dirname,'../web'),server:{host:'127.0.0.1',port:5173}}) : null;
  if(vite && !process.env.START_PREVIEW) await vite.listen();
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE,
      args: ['--no-sandbox', '--disable-dev-shm-usage', '--no-zygote', '--single-process'] } : {}),
  });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    page.setDefaultTimeout(10000);
    const pageErrors = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    let loggedIn = false, failInventory = false, lastSettings = null, lastAsset = null, metaFailure = 0;
    let failSettingsLoad = false, failSettingsSave = false, failModelLoad = false;
    let lastModel = null;
    let failExport = false;
    let currentEmail='admin@example.test';
    const columnPreferences=new Map();
    const labels = {available:'Verfügbar', in_use:'Im Einsatz', defective:'Defekt', in_repair:'In Reparatur'};
    const meta = {
      column_order:['asset_tag','product_model_name','status','condition','site_name','department_name'],
      default_visible_columns:['asset_tag','product_model_name','status','site_name'],
      headers:{asset_tag:'Produkterkennung',product_model_name:'Produktmodell',status:'Status',site_name:'Standort'},
      status_labels:labels, condition_labels:{new:'Neu',like_new:'Neuwertig',used:'Gebraucht',defective:'Defekt'},
      inventory_group_labels:{device:'Gerät'},
    };
    const rows = [
      {id:1,_record_type:'asset',asset_tag:'TEST-001',product_model_name:'TestBook',status:'available',condition:'used',site_name:'Basel',department_name:'IT',_web_inventory_group:'device',_web_category_key:'laptop',_web_condition_key:'used'},
      {id:2,_record_type:'asset',asset_tag:'TEST-002',product_model_name:'TestBook',status:'in_use',condition:'used',site_name:'Bern',department_name:'IT',_web_inventory_group:'device',_web_category_key:'laptop',_web_condition_key:'used'},
    ];
    const data = {
      site_permissions_available:true,
      sites:[{id:1,name:'Basel',organization_id:1},{id:2,name:'Bern',organization_id:1},{id:3,name:'Büro Allschwil',organization_id:1},
        {id:4,name:'Park Lange Erlen',organization_id:1},{id:5,name:'Parterre ONE',organization_id:1},{id:6,name:'Rialto',organization_id:1},{id:7,name:'Werkstatt Allschwil',organization_id:1}],
      departments:[{id:10,name:'IT',site_id:1,organization_id:1},{id:20,name:'IT',site_id:2,organization_id:1}],
      storage_locations:[{id:11,name:'Lager',site_id:1,department_id:10,is_active:true,location_type:'warehouse'}],
      product_categories:[{id:1,name:'Laptop',code:'laptop',inventory_group:'device',specification_schema:{fields:[]}}],
      manufacturers:[{id:1,name:'Keiner'},{id:2,name:'Alpha'},{id:3,name:'Beta'}],
      employees:[
        {id:1,first_name:'Test',last_name:'Admin',email:'admin@example.test',department_id:10,is_active:true,auth_user_id:'auth-admin',app_role:'admin'},
        {id:2,first_name:'Maria',last_name:'Muster',email:'maria@example.test',department_id:20,is_active:true,auth_user_id:null,app_role:'viewer'},
        {id:3,first_name:'Lara',last_name:'Standort',email:'lara@example.test',department_id:10,is_active:true,auth_user_id:'auth-lara',app_role:'user',allowed_site_ids:[1,2,3,4,5,6,7]},
        {id:4,first_name:'Noah',last_name:'Sicht',email:'noah@example.test',department_id:10,is_active:true,auth_user_id:'auth-noah',app_role:'viewer',allowed_site_ids:[1]},
      ],
      product_models:[{id:100,name:'TestBook',category_id:1,manufacturer_id:1,is_active:true,tracking_mode:'serialized',unit_code:'piece',specifications:{}}],
      parent_assets:[{id:21,label:"Monitor"},{id:22,label:"Maus"}], ...meta, factory_default_visible_columns:meta.default_visible_columns,
    };
    const pause = ms => new Promise(resolve=>setTimeout(resolve,ms));
    await page.route(url => url.pathname.startsWith('/api/'), async route => {
      const request=route.request(), path=new URL(request.url()).pathname;
      const headers={'Access-Control-Allow-Origin':new URL(process.env.UI_BASE_URL || 'http://127.0.0.1:5173').origin,
        'Access-Control-Allow-Credentials':'true','Access-Control-Allow-Headers':'*','Access-Control-Allow-Methods':'GET,POST,PUT,OPTIONS'};
      const json = (body,status=200) => route.fulfill({status,headers,contentType:'application/json',body:JSON.stringify(body)});
      if(request.method()==='OPTIONS')return route.fulfill({status:204,headers});
      if(path==='/api/auth/login'){loggedIn=true;currentEmail=request.postDataJSON().email;return json({authenticated:true,email:currentEmail,role:'admin'});}
      if(path==='/api/auth/logout'){loggedIn=false;return json({success:true});}
      if(path==='/api/auth/session'){await pause(180); return json({authenticated:loggedIn,email:loggedIn?currentEmail:null,role:loggedIn?'admin':null});}
      if(path==='/api/preferences/inventory-columns'){
        if(request.headers()['x-itassetflow-user']!==currentEmail)return json({detail:'Konto gewechselt'},409);
        if(request.method()==='PUT'){
          await pause(100);
          columnPreferences.set(currentEmail,request.postDataJSON());
        }
        const saved=columnPreferences.get(currentEmail)??null;
        await pause(150);
        return json({preferences:saved});
      }
      if(path.startsWith('/api/transfer/export/')){
        await pause(1200);
        if(failExport)return json({detail:'Test: Export vorübergehend nicht erreichbar.'},503);
        const [suffix, type, body] = ({
          csv:['csv','text/csv','\uFEFFitassetflow_format,version,table,row_json\r\n'],
          postgresql:['sql','application/sql','BEGIN;\nCOMMIT;\n'],
          'csv-tables':['zip','application/zip','fixture-csv-tables'],
          excel:['xlsx','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','fixture-excel'],
        })[path.split('/').pop()];
        return route.fulfill({headers:{...headers,'Access-Control-Expose-Headers':'Content-Disposition','Content-Disposition':`attachment; filename="ITAssetFlow_Test.${suffix}"`},contentType:type,body});
      }
      if(path==='/api/inventory/meta')return metaFailure==='invalid'?json({}):metaFailure?json({detail:'Keine Berechtigung für Tabelleninformationen.'},metaFailure):json(meta);
      if(path==='/api/inventory/revision')return json({revision:1});
      if(path==='/api/inventory/events')return route.fulfill({headers,contentType:'text/event-stream',body:': test\n\n'});
      if(path==='/api/settings'){
        await pause(400);
        if(request.method()==='PUT'){
          if(failSettingsSave)return json({detail:'Test: Einstellungen konnten nicht gespeichert werden.'},503);
          lastSettings=request.postDataJSON();
          data.employees=lastSettings.employees.map((row,index)=>({
            ...data.employees.find(old=>String(old.id)===String(row.id)),...row,
            id:row.id??100+index,department_id:row.department_ref?Number(row.department_ref.replace('id:','')):null,
            allowed_site_ids:Array.isArray(row.allowed_site_refs)?row.allowed_site_refs.map(ref=>Number(ref.replace('id:',''))):data.employees.find(old=>String(old.id)===String(row.id))?.allowed_site_ids??[],
          }));
          return json({saved:true});
        }
        return failSettingsLoad?json({detail:'Test: Einstellungen konnten nicht geladen werden.'},503):json(data);
      }
      if(path==='/api/product-models'){
        await pause(400);
        if(request.method()==='POST'){
          lastModel=request.postDataJSON();
          const manufacturer=data.manufacturers.find(row=>row.name===lastModel.manufacturer_name)
            ?? {id:data.manufacturers.length+1,name:lastModel.manufacturer_name};
          if(!data.manufacturers.includes(manufacturer)) data.manufacturers.push(manufacturer);
          const model={...lastModel,id:100+data.product_models.length,manufacturer_id:manufacturer.id,is_active:true,specifications:{}};
          data.product_models.push(model);
          return json(model,201);
        }
        return failModelLoad?json({detail:'Test: Modellliste nicht erreichbar.'},503):json({product_models:data.product_models,manufacturers:data.manufacturers,product_categories:data.product_categories.map(row=>({...row,fields:[]}))});
      }
      if(path==='/api/product-models/100' && request.method()==='PUT'){
        await pause(400);
        data.product_models[0]={...data.product_models[0],...request.postDataJSON()};
        return json(data.product_models[0]);
      }
      if(path==='/api/inventory/form-data')return json(data);
      if(path==='/api/inventory'){
        if(request.method()==='POST'){lastAsset=request.postDataJSON();return json({id:3,entry_type:'asset'});}
        await pause(650);return failInventory?json({detail:'Test: API vorübergehend nicht erreichbar'},503):json(rows);
      }
      return json({detail:`Unbekannter Test-Endpunkt ${path}`},404);
    });

    await page.goto((process.env.UI_BASE_URL || 'http://127.0.0.1:5173')+'/#/login');
    await page.getByLabel('E-Mail-Adresse:').waitFor();
    const logoBox=await page.locator('.login-logo img').boundingBox();
    const loginBox=await page.locator('.login-group').boundingBox();
    assert.ok(logoBox.width>=280 && logoBox.x+logoBox.width<loginBox.x);
    if(process.env.SCREENSHOT_DIR){fs.mkdirSync(process.env.SCREENSHOT_DIR,{recursive:true});await page.screenshot({path:process.env.SCREENSHOT_DIR+'/login-desktop.png'});}
    for(const width of [390,360]){
      await page.setViewportSize({width,height:844});
      const logo=await page.locator('.login-logo img').boundingBox(),form=await page.locator('.login-group').boundingBox();
      assert.ok(logo.width>=170 && logo.y+logo.height<=form.y);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth && document.querySelector('.login-page').scrollWidth<=innerWidth),true);
      if(process.env.SCREENSHOT_DIR)await page.screenshot({path:process.env.SCREENSHOT_DIR+`/login-mobile-${width}.png`});
    }
    await page.setViewportSize({width:844,height:390});
    await page.getByRole('button',{name:'Anmelden',exact:true}).scrollIntoViewIfNeeded();
    assert.ok(await page.getByRole('button',{name:'Anmelden',exact:true}).isVisible());
    await page.setViewportSize({width:1440,height:1000});
    console.log('PASS: Grosses Loginlogo links vom Formular; mobile und niedrige Fenster ohne Überlappungen');
    await page.getByLabel('E-Mail-Adresse:').fill('admin@example.test');
    await page.getByLabel('Passwort:',{exact:true}).fill('test-password');
    await page.getByRole('button',{name:'Anmelden',exact:true}).click();
    await page.locator('.brand-loading').waitFor({state:'visible'});
    await page.getByText('TEST-001',{exact:true}).waitFor();
    console.log('PASS: Anmeldung und Logo-Ladeanzeige');
    await page.getByRole('cell',{name:'TEST-001',exact:true}).click();
    await page.setViewportSize({width:1440,height:560});
    assert.ok(await page.locator('.selection-box').filter({hasText:'TEST-001'}).evaluate(el=>{
      const text=document.createRange();text.selectNodeContents(el);
      return text.getBoundingClientRect().bottom < el.getBoundingClientRect().bottom;
    }));
    await page.setViewportSize({width:1440,height:1000});
    assert.equal(await page.locator('.menu-bar').getByText(/Datensätze?/).count(),0);
    assert.equal(await page.locator('.status-bar').getByText('2 Datensätze',{exact:true}).count(),1);
    assert.equal(await page.locator('.menu-logout-button .menu-power-icon').evaluate(el=>getComputedStyle(el).color),'rgb(200, 50, 50)');
    assert.equal(await page.getByRole('button',{name:'Abmelden',exact:true}).count(),1);
    assert.equal(await page.locator('.navigation').evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(226, 231, 236)');
    assert.equal(await page.locator('.details').evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(226, 231, 236)');
    await page.getByRole('button',{name:'Hilfe',exact:true}).click();
    await page.getByRole('button',{name:'Über',exact:true}).click();
    await page.getByRole('dialog',{name:'ITAssetFlow',exact:true}).waitFor();
    await page.getByText('Version 1.6.15 · 05.11.2026',{exact:true}).waitFor();
    await page.getByText('IT-Inventarverwaltung für Geräte, Mengenartikel und Standorte.',{exact:true}).waitFor();
    assert.equal(await page.locator('.about-dialog-content p').count(),3);
    if(process.env.SCREENSHOT_DIR){fs.mkdirSync(process.env.SCREENSHOT_DIR,{recursive:true});await page.screenshot({path:process.env.SCREENSHOT_DIR+'/about.png'});}
    await page.getByRole('button',{name:'OK',exact:true}).click();
    if(process.env.SCREENSHOT_DIR)await page.screenshot({path:process.env.SCREENSHOT_DIR+'/inventory.png'});
    console.log('PASS: Dunklere Seitenleisten, Anzahl nur unten, rotes Power-Symbol und Über 1.6.15');

    const exportMenu=()=>page.locator('.menu-submenu').filter({has:page.getByRole('button',{name:'Export',exact:false})});
    async function openExportMenu(){
      await page.getByRole('button',{name:'Datei',exact:true}).click();
      await exportMenu().getByRole('button',{name:'Export',exact:false}).hover();
    }
    for(const [label, button, suffix, expected] of [
      ['CSV','CSV','csv','itassetflow_format'],
      ['PostgreSQL','PostgreSQL','sql','BEGIN;'],
      ['Excel','Excel','xlsx','fixture-excel'],
      ['CSV-Tabellen','CSV-Tabellen (ZIP)','zip','fixture-csv-tables'],
    ]){
      await openExportMenu();
      if(process.env.SCREENSHOT_DIR && label==='CSV')await page.screenshot({path:process.env.SCREENSHOT_DIR+'/export-menu.png'});
      const downloadEvent=page.waitForEvent('download');
      await exportMenu().getByRole('button',{name:button,exact:true}).click();
      await page.getByText(`${label}-Export wird erstellt ...`,{exact:true}).waitFor();
      await openExportMenu();
      assert.equal(await exportMenu().getByRole('button',{name:'CSV',exact:true}).isDisabled(),true);
      assert.equal(await exportMenu().getByRole('button',{name:'PostgreSQL',exact:true}).isDisabled(),true);
      const download=await downloadEvent;
      assert.equal(download.suggestedFilename(),`ITAssetFlow_Test.${suffix}`);
      const content=fs.readFileSync(await download.path(),'utf8');
      assert.ok(content.includes(expected));
      await page.getByText(`${label}-Export wurde erstellt.`,{exact:true}).waitFor();
      await page.locator('.status-bar').click();
    }
    failExport=true;
    await openExportMenu();
    await exportMenu().getByRole('button',{name:'PostgreSQL',exact:true}).click();
    await page.getByText('Test: Export vorübergehend nicht erreichbar.',{exact:true}).waitFor();
    failExport=false;
    await openExportMenu();
    assert.equal(await exportMenu().getByRole('button',{name:'PostgreSQL',exact:true}).isEnabled(),true);
    await page.locator('.status-bar').click();
    console.log('PASS: CSV-, Excel-, CSV-Tabellen- und PostgreSQL-Download, Dateinamen, Ladezustand, gesperrte Aktionen und sichtbare Exportfehler');

    const headerLabels=()=>page.locator('.inventory-table .table-header-label').allTextContents();
    await page.getByRole('columnheader',{name:'Standort',exact:true}).dragTo(page.getByRole('columnheader',{name:'Produkterkennung',exact:true}));
    await page.locator('.inventory-table thead th').first().click({button:'right'});
    const savedColumns=page.waitForResponse(response=>response.url().endsWith('/api/preferences/inventory-columns')
      && response.request().method()==='PUT' && !response.request().postDataJSON().visible_columns.includes('status'));
    await page.locator('.header-context-option').filter({hasText:/^Status$/}).locator('input').uncheck();
    await savedColumns;
    await page.locator('.status-bar').click();
    const expectedHeaders=await headerLabels();
    assert.equal(expectedHeaders[0],'Standort');assert.ok(!expectedHeaders.includes('Status'));
    await page.evaluate(()=>localStorage.removeItem('itassetflow.inventory_columns:v1:admin@example.test'));
    await page.reload();
    await page.getByText('TEST-001',{exact:true}).waitFor();
    await page.waitForFunction(()=>document.querySelector('.inventory-table .table-header-label')?.textContent==='Standort'
      && ![...document.querySelectorAll('.inventory-table .table-header-label')].some(el=>el.textContent==='Status'));
    assert.deepEqual(await headerLabels(),expectedHeaders);
    await page.evaluate(()=>{location.hash='/settings?tab=employees';});
    await page.getByRole('table',{name:'Mitarbeiter'}).waitFor();
    assert.equal(await page.getByText('Einstellungen bereit.',{exact:true}).count(),0);
    assert.equal(await page.locator('.settings-message').count(),0);
    await page.getByRole('button',{name:'Zurück zum Inventar',exact:false}).click();
    await page.getByText('TEST-001',{exact:true}).waitFor();
    assert.deepEqual(await headerLabels(),expectedHeaders);
    async function loginAs(email){
      await page.getByRole('button',{name:'Abmelden',exact:true}).click();
      await page.getByLabel('E-Mail-Adresse:').fill(email);
      await page.getByLabel('Passwort:',{exact:true}).fill('test-password');
      await page.getByRole('button',{name:'Anmelden',exact:true}).click();
      await page.getByText('TEST-001',{exact:true}).waitFor();
    }
    await loginAs('second@example.test');
    assert.deepEqual(await headerLabels(),['Produkterkennung','Produktmodell','Status','Standort']);
    await loginAs('admin@example.test');
    assert.deepEqual(await headerLabels(),expectedHeaders);
    console.log('PASS: Spaltenreihenfolge und Auswahl am Konto gespeichert; Wiederherstellung ohne lokalen Cache, Einstellungen und Kontowechsel; keine Bereitschaftsmeldung');


    await page.getByRole('button',{name:'Status',exact:true}).click();
    await page.locator('.filter-option').filter({hasText:'Verfügbar'}).locator('input').check();
    assert.equal(await page.locator('.inventory-table tbody tr').count(),1);
    assert.equal(await page.getByText('TEST-002',{exact:true}).count(),0);
    await page.getByRole('button',{name:'Alle anzeigen',exact:true}).click();
    await page.locator('.status-bar').click();
    assert.equal(await page.locator('.inventory-table tbody tr').count(),2);
    console.log('PASS: Statusfilter und Zurücksetzen');

    await page.evaluate(()=>{location.hash='/settings?tab=employees';});
    await page.locator('.settings-content .brand-loading').waitFor({state:'visible'});
    assert.equal(await page.locator('.settings-content').getAttribute('aria-busy'),'true');
    assert.equal(await page.getByRole('tab',{name:'Berechtigungen',exact:true}).isDisabled(),true);
    await page.getByRole('heading',{name:'Einstellungen',exact:true}).waitFor();
    if(process.env.SCREENSHOT_DIR)await page.screenshot({path:process.env.SCREENSHOT_DIR+'/settings-loading.png'});
    await page.getByRole('tab',{name:'Mitarbeiter',exact:true}).waitFor();
    await page.getByRole('table',{name:'Mitarbeiter',exact:true}).waitFor();
    await page.getByLabel('Mitarbeiter nach Standort filtern').selectOption('id:2');
    assert.equal(await page.getByRole('table',{name:'Mitarbeiter'}).locator('tbody tr').count(),1);
    await page.getByRole('button',{name:'Mitarbeiter hinzufügen'}).click();
    await page.getByRole('textbox',{name:'Vorname',exact:true}).fill('Anna');
    await page.getByRole('textbox',{name:'Nachname',exact:true}).fill('Beispiel');
    await page.getByRole('textbox',{name:'E-Mail (optional)',exact:true}).fill('anna@example.test');
    assert.equal(await page.getByRole('columnheader',{name:/Personalnr|Aktiv/}).count(),0);
    assert.equal(await page.getByText('Inaktive anzeigen',{exact:true}).count(),0);
    await page.getByRole('button',{name:'Übernehmen',exact:true}).click();
    const saveProgress=page.getByRole('button',{name:'Wird gespeichert …',exact:true});
    await saveProgress.waitFor();
    assert.equal(await saveProgress.isDisabled(),true);
    assert.equal(await page.locator('.settings-message-busy .settings-spinner').isVisible(),true);
    if(process.env.SCREENSHOT_DIR)await page.screenshot({path:process.env.SCREENSHOT_DIR+'/settings-saving.png'});
    await page.getByText('Einstellungen werden aktualisiert …',{exact:true}).waitFor();
    await page.getByText('Anna',{exact:true}).waitFor();
    const newEmployee=lastSettings.employees.find(row=>row.first_name==='Anna');
    assert.equal(newEmployee.department_ref,'id:20');
    assert.ok(!('is_active' in newEmployee));
    assert.ok(!('employee_number' in newEmployee));
    assert.ok(!('auth_user_id' in newEmployee));
    const annaRow=page.getByRole('table',{name:'Mitarbeiter'}).locator('tbody tr').filter({hasText:'Anna'});
    await annaRow.dblclick();
    await page.getByRole('textbox',{name:'E-Mail (optional)',exact:true}).fill('anna.updated@example.test');
    await page.getByRole('button',{name:'Übernehmen',exact:true}).click();
    await page.getByText('anna.updated@example.test',{exact:true}).waitFor();
    assert.ok(!('is_active' in lastSettings.employees.find(row=>row.first_name==='Anna')));
    await page.getByText('Anna',{exact:true}).click();
    page.once('dialog',dialog=>dialog.accept());
    await page.getByRole('button',{name:'Löschen',exact:true}).click();
    await page.getByRole('button',{name:'Übernehmen',exact:true}).click();
    await page.getByText('Einstellungen erfolgreich gespeichert.',{exact:true}).waitFor();
    assert.ok(!lastSettings.employees.some(row=>row.first_name==='Anna'));
    assert.ok(lastSettings.deleted.employees.length>0);
    await page.getByLabel('Mitarbeiter nach Standort filtern').selectOption('id:1');
    await page.getByRole('table',{name:'Mitarbeiter'}).locator('tbody tr').filter({hasText:'Admin'}).dblclick();
    assert.equal(await page.getByRole('columnheader',{name:'Aktiv',exact:true}).count(),0);
    assert.ok(await page.getByRole('button',{name:'Löschen',exact:true}).isDisabled());
    console.log('PASS: Mitarbeiter anlegen, bearbeiten, löschen, Standortzuordnung und Kontoschutz ohne Personalnummer und Aktivstatus');

    await page.getByRole('tab',{name:'Struktur',exact:true}).click();
    const structure = page.getByRole('tablist',{name:'Strukturbereiche'});
    const sitesTab = structure.getByRole('tab',{name:'Standorte',exact:true});
    const departmentsTab = structure.getByRole('tab',{name:'Abteilungen',exact:true});
    const locationsTab = structure.getByRole('tab',{name:'Lagerorte',exact:true});
    assert.equal(await structure.getAttribute('aria-orientation'),'vertical');
    await page.getByRole('table',{name:'Standorte',exact:true}).waitFor();
    assert.equal(await page.getByRole('table',{name:'Abteilungen',exact:true}).count(),0);
    await sitesTab.press('ArrowDown');
    assert.equal(await departmentsTab.getAttribute('aria-selected'),'true');
    await page.getByRole('table',{name:'Abteilungen',exact:true}).waitFor();
    await locationsTab.click();
    await page.getByRole('table',{name:'Lagerorte',exact:true}).waitFor();
    assert.equal(await page.getByRole('table',{name:'Abteilungen',exact:true}).count(),0);
    await page.setViewportSize({width:390,height:844});
    await page.waitForFunction(()=>document.querySelector('.settings-structure-tabs')?.getAttribute('aria-orientation')==='horizontal');
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    await locationsTab.press('ArrowRight');
    await page.getByRole('table',{name:'Standorte',exact:true}).waitFor();
    await page.setViewportSize({width:1440,height:1000});
    await page.getByRole('tab',{name:'Hersteller',exact:true}).click();
    const makers = page.getByRole('tabpanel',{name:'Hersteller',exact:true});
    await makers.getByRole('row',{name:'Alpha',exact:true}).dblclick();
    const makerInput = makers.locator('tbody input');
    await makerInput.fill('Alpha angepasst');
    await makers.getByRole('row',{name:'Beta',exact:true}).dblclick();
    assert.equal(await makerInput.count(),1);
    await makers.getByRole('cell',{name:'Alpha angepasst',exact:true}).waitFor();
    await makers.getByRole('cell',{name:'Alpha angepasst',exact:true}).click();
    await makers.getByRole('button',{name:'Bearbeiten',exact:true}).click();
    assert.equal(await makerInput.count(),1);
    assert.equal(await makerInput.inputValue(),'Alpha angepasst');
    await makerInput.fill('Alpha');
    console.log('PASS: Strukturtabs seitlich und mobil, Tastatur, Hersteller einzeln bearbeiten mit erhaltenem Entwurf');
    await page.getByRole('tab',{name:'Berechtigungen',exact:true}).click();
    assert.equal(await page.getByText('Benutzerberechtigungen',{exact:true}).count(),0);
    const permissions=page.getByRole('group',{name:'Standorte für Lara Standort',exact:true});
    const siteTrigger=page.getByRole('button',{name:'Standorte für Lara Standort auswählen',exact:true});
    const adminTrigger=page.getByRole('button',{name:'Standorte für Test Admin auswählen',exact:true});
    assert.equal(await adminTrigger.isDisabled(),true);
    assert.equal(await adminTrigger.textContent(),'Alle Standorte');
    assert.equal(await page.locator('.site-access-popup').count(),0);
    assert.ok((await page.locator('.settings-permissions-table tbody tr').last().boundingBox()).height<70);
    await siteTrigger.focus();
    await page.keyboard.press('ArrowDown');
    await permissions.waitFor();
    await permissions.getByLabel('Büro Allschwil',{exact:true}).uncheck();
    assert.equal(await siteTrigger.textContent(),'6 von 7 Standorten');
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('.site-access-popup').count(),0);
    assert.equal(await siteTrigger.evaluate(el=>document.activeElement===el),true);
    if(process.env.SCREENSHOT_DIR)await page.screenshot({path:process.env.SCREENSHOT_DIR+'/site-dropdown-closed.png'});
    await siteTrigger.click();
    await permissions.waitFor();
    if(process.env.SCREENSHOT_DIR)await page.screenshot({path:process.env.SCREENSHOT_DIR+'/site-dropdown-open.png'});
    await page.getByRole('heading',{name:'Einstellungen',exact:true}).click();
    assert.equal(await page.locator('.site-access-popup').count(),0);
    await siteTrigger.click();
    await page.getByRole('button',{name:'Standorte für Noah Sicht auswählen',exact:true}).focus();
    await page.keyboard.press('ArrowDown');
    assert.equal(await page.locator('.site-access-popup').count(),1);
    assert.equal(await permissions.count(),0);
    assert.equal(await page.getByRole('group',{name:'Standorte für Noah Sicht',exact:true}).getByRole('checkbox',{checked:true}).count(),1);
    await page.keyboard.press('Escape');
    failSettingsSave=true;
    await page.getByRole('button',{name:'Übernehmen',exact:true}).click();
    await page.getByRole('alert').filter({hasText:'Test: Einstellungen konnten nicht gespeichert werden.'}).waitFor();
    assert.equal(await page.locator('.settings-spinner').count(),0);
    assert.equal(await siteTrigger.textContent(),'6 von 7 Standorten');
    failSettingsSave=false;
    await page.getByRole('button',{name:'Übernehmen',exact:true}).click();
    await page.getByText('Einstellungen erfolgreich gespeichert.',{exact:true}).waitFor();
    assert.deepEqual(lastSettings.employees.find(row=>row.id===3).allowed_site_refs,['id:1','id:2','id:4','id:5','id:6','id:7']);
    assert.deepEqual(lastSettings.employees.find(row=>row.id===4).allowed_site_refs,['id:1']);
    await siteTrigger.click();
    assert.equal(await permissions.getByLabel('Büro Allschwil',{exact:true}).isChecked(),false);
    await page.getByRole('button',{name:'Auswahl aufheben',exact:true}).click();
    await page.getByRole('button',{name:'Übernehmen',exact:true}).click();
    await page.getByText('Einstellungen erfolgreich gespeichert.',{exact:true}).waitFor();
    assert.deepEqual(lastSettings.employees.find(row=>row.id===3).allowed_site_refs,[]);
    await page.getByText('Kein Standort freigegeben',{exact:true}).waitFor();
    await siteTrigger.click();
    await permissions.getByLabel('Basel',{exact:true}).check();
    await page.getByRole('button',{name:'Übernehmen',exact:true}).click();
    await page.getByText('Einstellungen erfolgreich gespeichert.',{exact:true}).waitFor();
    assert.deepEqual(lastSettings.employees.find(row=>row.id===3).allowed_site_refs,['id:1']);
    await siteTrigger.click();
    await page.getByRole('button',{name:'Alle auswählen',exact:true}).click();
    assert.equal(await permissions.getByRole('checkbox',{checked:true}).count(),7);
    await page.getByRole('button',{name:'Auswahl aufheben',exact:true}).click();
    await permissions.getByLabel('Basel',{exact:true}).check();
    await page.keyboard.press('Escape');
    if(process.env.SCREENSHOT_DIR)await page.screenshot({path:process.env.SCREENSHOT_DIR+'/site-permissions.png'});
    console.log('PASS: Kompaktes Standortdropdown, Checkboxen, Mehrfachauswahl, Sammelauswahl, Tastatur/Aussenklick, Speichern und Administratorzugriff');

    data.site_permissions_available=false;
    await page.reload();
    await page.getByRole('tab',{name:'Berechtigungen',exact:true}).click();
    await page.getByRole('status').filter({hasText:'Die Standortmigration fehlt noch.'}).waitFor();
    assert.equal(await page.locator('.site-access-dropdown').count(),0);
    await page.locator('.settings-table tbody tr').filter({hasText:'lara@example.test'}).locator('select').selectOption('viewer');
    await page.getByRole('button',{name:'Übernehmen',exact:true}).click();
    await page.getByText('Einstellungen erfolgreich gespeichert.',{exact:true}).waitFor();
    assert.ok(lastSettings.employees.every(row=>!('allowed_site_refs' in row)));
    assert.equal(lastSettings.employees.find(row=>row.id===3).app_role,'viewer');
    assert.deepEqual(data.employees.find(row=>row.id===3).allowed_site_ids,[1]);
    data.site_permissions_available=true;
    console.log('PASS: Fehlende Standortmigration blockiert andere Einstellungen nicht; keine vorgetäuschten Standortfreigaben');

    failSettingsLoad=true;
    await page.reload();
    await page.getByRole('alert').filter({hasText:'Test: Einstellungen konnten nicht geladen werden.'}).waitFor();
    assert.equal(await page.locator('.settings-content .brand-loading').count(),0);
    failSettingsLoad=false;
    await page.setViewportSize({width:390,height:844});
    await page.getByRole('button',{name:'Erneut laden',exact:true}).click();
    await page.locator('.settings-content .brand-loading').waitFor({state:'visible'});
    if(process.env.SCREENSHOT_DIR)await page.screenshot({path:process.env.SCREENSHOT_DIR+'/settings-loading-mobile.png'});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    await siteTrigger.click();
    if(process.env.SCREENSHOT_DIR)await page.screenshot({path:process.env.SCREENSHOT_DIR+'/site-dropdown-mobile.png'});
    await permissions.waitFor();
    const popupBox=await page.locator('.site-access-popup').boundingBox();
    assert.ok(popupBox.x>=0 && popupBox.x+popupBox.width<=390 && popupBox.y>=0 && popupBox.y+popupBox.height<=844);
    if(process.env.SCREENSHOT_DIR)await page.screenshot({path:process.env.SCREENSHOT_DIR+'/site-dropdown-mobile.png'});
    await page.keyboard.press('Escape');
    await page.setViewportSize({width:1440,height:1000});
    console.log('PASS: Lade- und Speicheranimationen, gesperrte Aktionen, mobile Anzeige und erneutes Laden nach Fehler');

    failModelLoad=true;
    await page.getByRole('tab',{name:'Produktmodelle',exact:true}).click();
    await page.getByText('Produktmodelle werden geladen …',{exact:true}).waitFor();
    await page.getByRole('alert').filter({hasText:'Test: Modellliste nicht erreichbar.'}).waitFor();
    assert.equal(await page.locator('.product-models-panel .brand-loading').count(),0);
    failModelLoad=false;
    await page.getByRole('button',{name:'Erneut laden',exact:true}).click();
    await page.getByText('Produktmodelle werden geladen …',{exact:true}).waitFor();
    await page.getByLabel('Bezeichnung *:',{exact:true}).fill('TestBook aktualisiert');
    await page.getByRole('button',{name:'Änderungen speichern',exact:true}).click();
    await page.getByRole('button',{name:'Wird gespeichert …',exact:true}).waitFor();
    await page.getByRole('status').filter({hasText:'Produktmodell wird gespeichert …'}).waitFor();
    assert.equal(await page.getByLabel('Bezeichnung *:',{exact:true}).isDisabled(),true);
    await page.getByText('„TestBook aktualisiert“ wurde gespeichert.',{exact:true}).waitFor();
    assert.equal(await page.locator('.settings-spinner').count(),0);
    const manufacturerInput=page.getByLabel('Hersteller:',{exact:true});
    for(const [name,manufacturer] of [['Ohne Hersteller','Keiner'],['Mit Hersteller','Freie Marke']]){
      await page.getByRole('button',{name:'Produktmodell hinzufügen',exact:true}).click();
      await page.getByLabel('Bezeichnung *:',{exact:true}).fill(name);
      assert.equal(await manufacturerInput.inputValue(),'Keiner');
      if(manufacturer!=='Keiner')await manufacturerInput.fill(manufacturer);
      await page.getByRole('button',{name:'Produktmodell speichern',exact:true}).click();
      await page.getByText(`„${name}“ wurde hinzugefügt.`,{exact:true}).waitFor();
      assert.equal(lastModel.manufacturer_name,manufacturer);
      assert.equal(await manufacturerInput.inputValue(),manufacturer);
    }
    assert.equal(await page.locator('#model-manufacturers option[value="Freie Marke"]').count(),1);
    await page.getByRole('tab',{name:'Berechtigungen',exact:true}).click();
    console.log('PASS: Produktmodelle mit Lade-/Speicheranimation, Fehlerzustand und erneutem Abruf');

    if(process.env.SCREENSHOT_DIR){fs.mkdirSync(process.env.SCREENSHOT_DIR,{recursive:true});await page.screenshot({path:process.env.SCREENSHOT_DIR+'/employees.png'});}
    await page.getByRole('button',{name:'Zurück zum Inventar',exact:false}).click();
    await page.locator('.brand-loading').waitFor({state:'visible'});
    await page.getByText('TEST-001',{exact:true}).waitFor();
    console.log('PASS: Logoanzeige bei Rückkehr aus Einstellungen');

    await page.getByRole('button',{name:'Neuer Eintrag',exact:true}).click();
    await page.getByRole('heading',{name:'Neuer Inventareintrag'}).waitFor();
    assert.equal(await page.getByText(/QR-Code oder Barcode-Kennung, EAN/).count(),0);
    for (const width of [1440,390]){
      await page.setViewportSize({width,height:560});
      const scroll=page.locator('.asset-form-scroll');
      const footer=page.locator('.asset-form-actions');
      const start=await footer.boundingBox();
      assert.ok(await scroll.evaluate(el=>el.scrollHeight>el.clientHeight));
      await scroll.evaluate(el=>{el.scrollTop=el.scrollHeight;});
      assert.equal((await footer.boundingBox()).y,start.y);
      const viewport=await scroll.boundingBox();
      assert.ok(viewport.y+viewport.height<=start.y && start.y+start.height<=560);
    }
    await page.setViewportSize({width:1440,height:1000});
    const formRow=label=>page.locator('.asset-form-row').filter({has:page.locator('label').filter({hasText:label})});
    await formRow(/^Standort \*:/).locator('select').selectOption('1');
    await formRow(/^Abteilung \*:/).locator('select').selectOption('10');
    await formRow(/^Lagerort \*:/).locator('select').selectOption('11');
    await formRow(/^Produkterkennung \*:/).locator('input').fill('TEST-003');
    await page.getByLabel('Kaufdatum *:',{exact:true}).fill('2026-10-21');
    await page.getByLabel('Verbundenes Produkt hinzufügen',{exact:true}).selectOption('21');
    await page.getByLabel('Verbundenes Produkt hinzufügen',{exact:true}).selectOption('22');
    await page.getByLabel('Garantie bis:',{exact:true}).fill('2026-10-20');
    assert.equal(await page.getByLabel('Garantie bis:',{exact:true}).evaluate(el=>el.validity.rangeUnderflow),true);
    // Browserprüfung und serverunabhängige Formularprüfung separat ausführen.
    await page.locator('form').evaluate(el=>el.noValidate=true);
    await page.getByRole('button',{name:/speichern/i}).click();
    await page.getByRole('alert').filter({hasText:'Garantie bis darf nicht vor dem Kaufdatum liegen.'}).waitFor();
    assert.equal(lastAsset,null);
    await page.getByLabel('Garantie bis:',{exact:true}).fill('2028-02-29');
    await page.getByRole('button',{name:/speichern/i}).click();
    await page.getByText('TEST-001',{exact:true}).waitFor();
    assert.equal(lastAsset.asset.warranty_until,'2028-02-29');
    assert.deepEqual(lastAsset.connection_changes,{add:['21','22'],remove:[]});
    console.log('PASS: Garantieprüfung und Speichern mit gültigem Schalttag');

    failInventory=true;
    await page.evaluate(()=>{location.hash='/settings?tab=employees';});
    await page.getByRole('table',{name:'Mitarbeiter'}).waitFor();
    await page.getByRole('button',{name:'Zurück zum Inventar',exact:false}).click();
    await page.getByRole('alert').filter({hasText:'Test: API vorübergehend nicht erreichbar'}).waitFor();
    assert.equal(await page.locator('.brand-loading').count(),0);
    failInventory=false;
    await page.getByRole('button',{name:'Erneut laden',exact:true}).click();
    await page.getByText('TEST-001',{exact:true}).waitFor();
    console.log('PASS: Ladefehler sichtbar und erneuter Abruf erfolgreich');

    for(const failure of [500,404,'invalid']) {
      metaFailure=failure;
      await page.reload();
      await page.getByText('TEST-001',{exact:true}).waitFor();
      assert.equal(await page.locator('.inventory-table tbody tr').count(),2);
      await page.locator('.inventory-status').filter({hasText:'Standardspalten'}).waitFor();
    }
    metaFailure=403;
    await page.reload();
    await page.getByRole('alert').filter({hasText:'Keine Berechtigung für Tabelleninformationen.'}).waitFor();
    assert.equal(await page.getByText('TEST-001',{exact:true}).count(),0);
    metaFailure=0;
    await page.reload();
    await page.getByText('TEST-001',{exact:true}).waitFor();
    console.log('PASS: Fehlende/fehlerhafte Tabelleninformationen verwenden Standardspalten; HTTP 403 bleibt gesperrt');

    await page.emulateMedia({reducedMotion:'reduce'});
    await page.evaluate(()=>{location.hash='/settings?tab=employees';});
    await page.locator('.settings-content .brand-loading-logo').waitFor({state:'visible'});
    assert.equal(await page.locator('.settings-content .brand-loading-logo').evaluate(el=>getComputedStyle(el).animationName),'none');
    await page.getByRole('table',{name:'Mitarbeiter'}).waitFor();
    await page.getByRole('tab',{name:'Berechtigungen',exact:true}).click();
    await page.getByRole('button',{name:'Übernehmen',exact:true}).click();
    await page.locator('.settings-message-busy .settings-spinner').waitFor();
    assert.equal(await page.locator('.settings-message-busy .settings-spinner').evaluate(el=>getComputedStyle(el).animationName),'none');
    await page.getByText('Einstellungen erfolgreich gespeichert.',{exact:true}).waitFor();
    await page.getByRole('button',{name:'Zurück zum Inventar',exact:false}).click();
    await page.locator('.brand-loading-logo').waitFor({state:'visible'});
    assert.equal(await page.locator('.brand-loading-logo').evaluate(el=>getComputedStyle(el).animationName),'none');
    await page.getByText('TEST-001',{exact:true}).waitFor();
    assert.deepEqual(pageErrors,[]);
    console.log('PASS: Reduzierte Bewegung und keine JavaScript-Laufzeitfehler');
  } finally { await browser.close(); if(vite) await vite.close(); }
})();
run.catch(error=>{console.error(error);process.exitCode=1;});
module.exports=run;
