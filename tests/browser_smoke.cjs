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
    let failExport = false;
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
      manufacturers:[{id:1,name:'Keiner'}],
      employees:[
        {id:1,first_name:'Test',last_name:'Admin',email:'admin@example.test',department_id:10,is_active:true,auth_user_id:'auth-admin',app_role:'admin'},
        {id:2,first_name:'Maria',last_name:'Muster',email:'maria@example.test',department_id:20,is_active:true,auth_user_id:null,app_role:'viewer'},
        {id:3,first_name:'Lara',last_name:'Standort',email:'lara@example.test',department_id:10,is_active:true,auth_user_id:'auth-lara',app_role:'user',allowed_site_ids:[1,2,3,4,5,6,7]},
        {id:4,first_name:'Noah',last_name:'Sicht',email:'noah@example.test',department_id:10,is_active:true,auth_user_id:'auth-noah',app_role:'viewer',allowed_site_ids:[1]},
      ],
      product_models:[{id:100,name:'TestBook',category_id:1,manufacturer_id:1,is_active:true,tracking_mode:'serialized',unit_code:'piece',specifications:{}}],
      parent_assets:[], ...meta, factory_default_visible_columns:meta.default_visible_columns,
    };
    const pause = ms => new Promise(resolve=>setTimeout(resolve,ms));
    await page.route(url => url.pathname.startsWith('/api/'), async route => {
      const request=route.request(), path=new URL(request.url()).pathname;
      const headers={'Access-Control-Allow-Origin':new URL(process.env.UI_BASE_URL || 'http://127.0.0.1:5173').origin,
        'Access-Control-Allow-Credentials':'true','Access-Control-Allow-Headers':'*','Access-Control-Allow-Methods':'GET,POST,PUT,OPTIONS'};
      const json = (body,status=200) => route.fulfill({status,headers,contentType:'application/json',body:JSON.stringify(body)});
      if(request.method()==='OPTIONS')return route.fulfill({status:204,headers});
      if(path==='/api/auth/login'){loggedIn=true; return json({authenticated:true,email:'admin@example.test'});}
      if(path==='/api/auth/session'){await pause(180); return json({authenticated:loggedIn,email:loggedIn?'admin@example.test':null,role:loggedIn?'admin':null});}
      if(path.startsWith('/api/transfer/export/')){
        await pause(1200);
        if(failExport)return json({detail:'Test: Export vorübergehend nicht erreichbar.'},503);
        const sql=path.endsWith('/postgresql'),suffix=sql?'sql':'csv';
        return route.fulfill({headers:{...headers,'Access-Control-Expose-Headers':'Content-Disposition','Content-Disposition':`attachment; filename="ITAssetFlow_Test.${suffix}"`},contentType:sql?'application/sql':'text/csv',body:sql?'-- ITAssetFlow PostgreSQL Export\nBEGIN;\nCOMMIT;\n':'\uFEFFitassetflow_format,version,table,row_json\r\n'});
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
    assert.equal(await page.locator('.inventory-header-actions').getByText(/Datensätze?/).count(),0);
    assert.equal(await page.locator('.status-bar').getByText('2 Datensätze',{exact:true}).count(),1);
    assert.equal(await page.locator('.menu-logout-button .menu-power-icon').evaluate(el=>getComputedStyle(el).color),'rgb(200, 50, 50)');
    assert.equal(await page.getByRole('button',{name:'Abmelden',exact:true}).count(),1);
    assert.equal(await page.locator('.navigation').evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(226, 231, 236)');
    assert.equal(await page.locator('.details').evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(226, 231, 236)');
    await page.getByRole('button',{name:'Hilfe',exact:true}).click();
    await page.getByRole('button',{name:'Über',exact:true}).click();
    await page.getByRole('dialog',{name:'ITAssetFlow',exact:true}).waitFor();
    await page.getByText('Version 1.2.11 · 29.10.2026',{exact:true}).waitFor();
    await page.getByText('Scanner mit automatischer QR-, EAN-, Code-128- und Code-39-Erkennung sowie Lagerbuchungen.',{exact:true}).waitFor();
    if(process.env.SCREENSHOT_DIR){fs.mkdirSync(process.env.SCREENSHOT_DIR,{recursive:true});await page.screenshot({path:process.env.SCREENSHOT_DIR+'/about.png'});}
    await page.getByRole('button',{name:'OK',exact:true}).click();
    if(process.env.SCREENSHOT_DIR)await page.screenshot({path:process.env.SCREENSHOT_DIR+'/inventory.png'});
    console.log('PASS: Dunklere Seitenleisten, Anzahl nur unten, rotes Power-Symbol und Über 1.2.11');

    const exportMenu=()=>page.locator('.menu-submenu').filter({has:page.getByRole('button',{name:'Export',exact:false})});
    async function openExportMenu(){
      await page.getByRole('button',{name:'Datei',exact:true}).click();
      await exportMenu().getByRole('button',{name:'Export',exact:false}).hover();
    }
    for(const label of ['CSV','PostgreSQL']){
      await openExportMenu();
      if(process.env.SCREENSHOT_DIR && label==='CSV')await page.screenshot({path:process.env.SCREENSHOT_DIR+'/export-menu.png'});
      const downloadEvent=page.waitForEvent('download');
      await exportMenu().getByRole('button',{name:label,exact:true}).click();
      await page.getByText(`${label}-Export wird erstellt ...`,{exact:true}).waitFor();
      await openExportMenu();
      assert.equal(await exportMenu().getByRole('button',{name:'CSV',exact:true}).isDisabled(),true);
      assert.equal(await exportMenu().getByRole('button',{name:'PostgreSQL',exact:true}).isDisabled(),true);
      const download=await downloadEvent;
      assert.equal(download.suggestedFilename(),`ITAssetFlow_Test.${label==='CSV'?'csv':'sql'}`);
      const content=fs.readFileSync(await download.path(),'utf8');
      assert.ok(content.includes(label==='CSV'?'itassetflow_format':'BEGIN;'));
      await page.getByText(`${label}-Export wurde erstellt.`,{exact:true}).waitFor();
      await page.locator('.page-header').click();
    }
    failExport=true;
    await openExportMenu();
    await exportMenu().getByRole('button',{name:'PostgreSQL',exact:true}).click();
    await page.getByText('Test: Export vorübergehend nicht erreichbar.',{exact:true}).waitFor();
    failExport=false;
    await openExportMenu();
    assert.equal(await exportMenu().getByRole('button',{name:'PostgreSQL',exact:true}).isEnabled(),true);
    await page.locator('.page-header').click();
    console.log('PASS: CSV- und PostgreSQL-Download, Dateinamen, Ladezustand, gesperrte Aktionen und sichtbare Exportfehler');


    await page.getByRole('button',{name:'Status',exact:true}).click();
    await page.locator('.filter-option').filter({hasText:'Verfügbar'}).locator('input').check();
    assert.equal(await page.locator('.inventory-table tbody tr').count(),1);
    assert.equal(await page.getByText('TEST-002',{exact:true}).count(),0);
    await page.getByRole('button',{name:'Alle anzeigen',exact:true}).click();
    await page.locator('.page-header').click();
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
    await page.getByRole('textbox',{name:'Personalnummer',exact:true}).fill('E-200');
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
    assert.equal(newEmployee.is_active,true);
    assert.ok(!('auth_user_id' in newEmployee));
    const annaRow=page.getByRole('table',{name:'Mitarbeiter'}).locator('tbody tr').filter({hasText:'Anna'});
    await annaRow.dblclick();
    await page.getByRole('textbox',{name:'E-Mail (optional)',exact:true}).fill('anna.updated@example.test');
    await page.getByLabel('Aktiv: Anna Beispiel',{exact:true}).uncheck();
    await page.getByRole('button',{name:'Übernehmen',exact:true}).click();
    await page.getByText('anna.updated@example.test',{exact:true}).waitFor();
    assert.equal(lastSettings.employees.find(row=>row.first_name==='Anna').is_active,false);
    await page.getByLabel('Inaktive anzeigen',{exact:true}).uncheck();
    assert.equal(await page.getByText('Anna',{exact:true}).count(),0);
    await page.getByLabel('Inaktive anzeigen',{exact:true}).check();
    await page.getByText('Anna',{exact:true}).click();
    page.once('dialog',dialog=>dialog.accept());
    await page.getByRole('button',{name:'Löschen',exact:true}).click();
    await page.getByRole('button',{name:'Übernehmen',exact:true}).click();
    await page.getByText('Einstellungen erfolgreich gespeichert.',{exact:true}).waitFor();
    assert.ok(!lastSettings.employees.some(row=>row.first_name==='Anna'));
    assert.ok(lastSettings.deleted.employees.length>0);
    await page.getByLabel('Mitarbeiter nach Standort filtern').selectOption('id:1');
    await page.getByRole('table',{name:'Mitarbeiter'}).locator('tbody tr').filter({hasText:'Admin'}).dblclick();
    assert.ok(await page.getByLabel('Aktiv: Test Admin',{exact:true}).isDisabled());
    assert.ok(await page.getByRole('button',{name:'Löschen',exact:true}).isDisabled());
    console.log('PASS: Mitarbeiter anlegen, bearbeiten, deaktivieren, löschen, Standortzuordnung und Kontoschutz');

    await page.getByRole('tab',{name:'Berechtigungen',exact:true}).click();
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
    await page.getByRole('tab',{name:'Berechtigungen',exact:true}).click();
    console.log('PASS: Produktmodelle mit Lade-/Speicheranimation, Fehlerzustand und erneutem Abruf');

    if(process.env.SCREENSHOT_DIR){fs.mkdirSync(process.env.SCREENSHOT_DIR,{recursive:true});await page.screenshot({path:process.env.SCREENSHOT_DIR+'/employees.png'});}
    await page.getByRole('button',{name:'Zurück zum Inventar',exact:false}).click();
    await page.locator('.brand-loading').waitFor({state:'visible'});
    await page.getByText('TEST-001',{exact:true}).waitFor();
    console.log('PASS: Logoanzeige bei Rückkehr aus Einstellungen');

    await page.getByRole('button',{name:'Neuer Eintrag',exact:true}).click();
    await page.getByRole('heading',{name:'Neuer Inventareintrag'}).waitFor();
    const formRow=label=>page.locator('.asset-form-row').filter({has:page.locator('label').filter({hasText:label})});
    await formRow(/^Standort \*:/).locator('select').selectOption('1');
    await formRow(/^Abteilung \*:/).locator('select').selectOption('10');
    await formRow(/^Lagerort \*:/).locator('select').selectOption('11');
    await formRow(/^Produkterkennung \*:/).locator('input').fill('TEST-003');
    await page.getByLabel('Kaufdatum *:',{exact:true}).fill('2026-10-21');
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
