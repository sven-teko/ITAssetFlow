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
    let loggedIn = false, failInventory = false, lastSettings = null, lastAsset = null;
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
      sites:[{id:1,name:'Basel',organization_id:1},{id:2,name:'Bern',organization_id:1}],
      departments:[{id:10,name:'IT',site_id:1,organization_id:1},{id:20,name:'IT',site_id:2,organization_id:1}],
      storage_locations:[{id:11,name:'Lager',site_id:1,department_id:10,is_active:true,location_type:'warehouse'}],
      product_categories:[{id:1,name:'Laptop',code:'laptop',inventory_group:'device',specification_schema:{fields:[]}}],
      manufacturers:[{id:1,name:'Keiner'}],
      employees:[
        {id:1,first_name:'Test',last_name:'Admin',email:'admin@example.test',department_id:10,is_active:true,auth_user_id:'auth-admin',app_role:'admin'},
        {id:2,first_name:'Maria',last_name:'Muster',email:'maria@example.test',department_id:20,is_active:true,auth_user_id:null,app_role:'viewer'},
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
      if(path==='/api/inventory/meta')return json(meta);
      if(path==='/api/inventory/revision')return json({revision:1});
      if(path==='/api/inventory/events')return route.fulfill({headers,contentType:'text/event-stream',body:': test\n\n'});
      if(path==='/api/settings'){
        if(request.method()==='PUT'){
          lastSettings=request.postDataJSON();
          data.employees=lastSettings.employees.map((row,index)=>({
            ...data.employees.find(old=>String(old.id)===String(row.id)),...row,
            id:row.id??100+index,department_id:row.department_ref?Number(row.department_ref.replace('id:','')):null,
          }));
          return json({saved:true});
        }
        return json(data);
      }
      if(path==='/api/inventory/form-data')return json(data);
      if(path==='/api/inventory'){
        if(request.method()==='POST'){lastAsset=request.postDataJSON();return json({id:3,entry_type:'asset'});}
        await pause(650);return failInventory?json({detail:'Test: API vorübergehend nicht erreichbar'},503):json(rows);
      }
      return json({detail:`Unbekannter Test-Endpunkt ${path}`},404);
    });

    await page.goto((process.env.UI_BASE_URL || 'http://127.0.0.1:5173')+'/#/login');
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
    await page.getByText('Version 1.1.3 · 29.10.2026',{exact:true}).waitFor();
    await page.getByText('QR- und EAN-Scanner mit Lagerbuchungen.',{exact:true}).waitFor();
    if(process.env.SCREENSHOT_DIR){fs.mkdirSync(process.env.SCREENSHOT_DIR,{recursive:true});await page.screenshot({path:process.env.SCREENSHOT_DIR+'/about.png'});}
    await page.getByRole('button',{name:'OK',exact:true}).click();
    if(process.env.SCREENSHOT_DIR)await page.screenshot({path:process.env.SCREENSHOT_DIR+'/inventory.png'});
    console.log('PASS: Dunklere Seitenleisten, Anzahl nur unten, rotes Power-Symbol und Über 1.1.3');


    await page.getByRole('button',{name:'Status',exact:true}).click();
    await page.locator('.filter-option').filter({hasText:'Verfügbar'}).locator('input').check();
    assert.equal(await page.locator('.inventory-table tbody tr').count(),1);
    assert.equal(await page.getByText('TEST-002',{exact:true}).count(),0);
    await page.getByRole('button',{name:'Alle anzeigen',exact:true}).click();
    await page.locator('.page-header').click();
    assert.equal(await page.locator('.inventory-table tbody tr').count(),2);
    console.log('PASS: Statusfilter und Zurücksetzen');

    await page.evaluate(()=>{location.hash='/settings?tab=employees';});
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

    await page.emulateMedia({reducedMotion:'reduce'});
    await page.evaluate(()=>{location.hash='/settings?tab=employees';});
    await page.getByRole('table',{name:'Mitarbeiter'}).waitFor();
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
