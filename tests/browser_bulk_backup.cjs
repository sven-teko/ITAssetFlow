/* Browser checks with a local Vite preview and a mocked API. */
const assert = require('node:assert/strict');
const path = require('node:path');
const { gzipSync } = require('node:zlib');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

(async () => {
  const root = path.resolve(__dirname,'../web');
  const port = 5182;
  const url = 'http://127.0.0.1:'+port;
  const vite = await (await import(require.resolve('vite',{paths:[root]}))).preview({root,preview:{host:'127.0.0.1',port,strictPort:true}});
  const browser = await chromium.launch({headless:true,...(process.env.CHROMIUM_EXECUTABLE?{
    executablePath:process.env.CHROMIUM_EXECUTABLE,
    args:['--no-sandbox','--disable-dev-shm-usage','--no-zygote','--single-process'],
  }:{})});
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(10000);
    let bulk = null;
    let postedBackup = null;
    let frequency = 'weekly';
    let newAsset = null;
    const backups = Array.from({length:6}, (_,index)=>({id:100+index,name:`Sicherung-${index}.p7m`,size:4,created_at:`2026-11-0${6-index}T01:00:00Z`}));
    const newEntry = {
      id:1, _record_type:'asset', product_model_id:1, asset_tag:'TEST-1', serial_number:'SERIAL-PRIVATE',
      mac_address:'11:22:33:44:55:66', qr_code:'PRIVATE-QR', ean:'4006381333931', image_id:92,
      site_id:1, storage_location_id:1, assigned_department_id:1, assigned_employee_id:1,
      status:'in_use', condition:'used', new_price:100, note:'Notiz der Vorlage', connected_child_ids:[3],
    };
    const formData = {
      sites:[{id:1,name:'Basel'}], departments:[{id:1,name:'IT',site_id:1}],
      storage_locations:[{id:1,name:'Lager',site_id:1,department_id:1,is_active:true}],
      employees:[{id:1,first_name:'Test',last_name:'Person',department_id:1}],
      product_categories:[{id:1,name:'Hardware',code:'hardware',inventory_group:'device',specification_schema:{fields:[]}}],
      manufacturers:[{id:1,name:'Keiner'}],
      product_models:[{id:1,name:'Laptop',category_id:1,manufacturer_id:1,is_active:true,tracking_mode:'serialized'}],
      parent_assets:[{id:3,label:'Zubehör'}],
    };
    const contents = gzipSync(JSON.stringify({format:'ITAssetFlow-Backup',version:1,tables:{}}));
    const meta = {
      column_order:['asset_tag','product_model_name','stock_quantity','condition','status','updated_at'],
      default_visible_columns:['asset_tag','product_model_name','stock_quantity','condition','status','updated_at'],
      headers:{asset_tag:'Produkterkennung',product_model_name:'Produktmodell',stock_quantity:'Lagerbestand',condition:'Zustand',status:'Status',updated_at:'Geändert am'},
      condition_labels:{new:'Neu',used:'Gebraucht',defective:'Defekt'},
      status_labels:{available:'Verfügbar',in_use:'Im Einsatz',defective:'Defekt'},inventory_group_labels:{},
    };
    const rows = [
      {id:1,asset_tag:'TEST-1',_record_type:'asset',product_model_id:1,product_model_name:'Laptop',site_name:'Basel',new_price:100,condition:'used',status:'available',stock_quantity:null,updated_at:'2026-11-03T03:00:00Z'},
      {id:2,asset_tag:'TEST-2',_record_type:'asset',product_model_id:1,product_model_name:'Laptop',site_name:'Basel',new_price:0,condition:'new',status:'in_use',stock_quantity:99,updated_at:'2026-11-03T03:00:00Z'},
      {id:'stock:3:1:used',_record_type:'stock',product_model_id:3,storage_location_id:1,product_model_name:'Kabel',site_name:'Basel',new_price:12.5,condition:'used',stock_quantity:4,updated_at:'2026-11-03T10:23:52Z'},
    ];
    await page.route('**/api/**', async route => {
      const request = route.request();
      const headers = {'Access-Control-Allow-Origin':url,'Access-Control-Allow-Credentials':'true',
        'Access-Control-Allow-Headers':'*','Access-Control-Allow-Methods':'GET,POST,PUT,PATCH,OPTIONS',
        'Access-Control-Expose-Headers':'Content-Disposition'};
      const json = data=>route.fulfill({headers,contentType:'application/json',body:JSON.stringify(data)});
      if(request.method()==='OPTIONS') return route.fulfill({status:204,headers});
      switch(new URL(request.url()).pathname) {
        case '/api/auth/session': return json({authenticated:true,email:'admin@example.test',role:'admin'});
        case '/api/inventory':
          if (request.method() === 'POST') { newAsset=request.postDataJSON(); return json({entry_type:'asset', id:5}); }
          return json(rows);
        case '/api/inventory/edit-form-data': return json({...formData,edit_entry:newEntry});
        case '/api/inventory/form-data': return json(formData);
        case '/api/inventory/meta': return json(meta);
        case '/api/inventory/revision': return json({revision:1});
        case '/api/inventory/events': return route.fulfill({headers,contentType:'text/event-stream',body:': ready\n\n'});
        case '/api/preferences/inventory-columns': return json({preferences:null});
        case '/api/inventory/bulk':
          bulk = request.postDataJSON();
          for(const row of rows) if(bulk.entries.some(entry=>entry.id===row.id)) Object.assign(row,bulk.changes);
          return json({updated_count:bulk.entries.length});
        case '/api/settings': return json({...meta,sites:[],departments:[],storage_locations:[],
          product_categories:[],manufacturers:[],employees:[],factory_default_visible_columns:meta.default_visible_columns});
        case '/api/backup/automatic':
          if(request.method()==='PUT'){frequency=request.postDataJSON().frequency;return json({frequency});}
          return json({configured:true,frequency,backups});
        case '/api/backup/automatic/100':
          return route.fulfill({headers:{...headers,'Content-Disposition':'attachment; filename="Sicherung.p7m"'},
            contentType:'application/pkcs7-mime',body:'mock'});
        case '/api/backup/download': return route.fulfill({headers:{...headers,'Content-Disposition':'attachment; filename="Sicherung.json.gz"'},
          contentType:'application/gzip',body:contents});
        case '/api/backup/recovery-sql':
          postedBackup=request.postDataBuffer();
          return route.fulfill({headers:{...headers,'Content-Disposition':'attachment; filename="Sicherung.restore.sql"'},
            contentType:'application/sql',body:'BEGIN;\nSELECT private.restore_inventory_backup(NULL,false);\nCOMMIT;'});
        default: return route.fulfill({status:404,headers});
      }
    });
    await page.goto(url+'/#/inventory');
    const first=page.getByRole('row').filter({has:page.getByRole('cell',{name:'TEST-1',exact:true})});
    const second=page.getByRole('row').filter({has:page.getByRole('cell',{name:'TEST-2',exact:true})});
    await first.getByRole('cell',{name:'1',exact:true}).waitFor();
    await second.getByRole('cell',{name:'1',exact:true}).waitFor();
    await page.getByRole('row').filter({hasText:'Kabel'}).getByRole('cell',{name:'03.11.2026-11-23',exact:true}).waitFor();
    const priceFrom = page.getByLabel('Neupreis von');
    const priceTo = page.getByLabel('Neupreis bis');
    await priceFrom.fill('12,50');
    await priceTo.fill('12.50');
    assert.equal(await first.count(),0);
    assert.equal(await second.count(),0);
    assert.equal(await page.getByRole('cell',{name:'Kabel',exact:true}).count(),1);
    await priceTo.fill('0');
    await page.getByText('«Von» darf nicht grösser sein als «Bis».').waitFor();
    await priceFrom.clear();
    assert.equal(await first.count(),0);
    assert.equal(await second.count(),1);
    await priceTo.clear();

    await first.click({button:'right'});
    await page.getByRole('menuitem',{name:'Aus Produktmodell duplizieren',exact:true}).click();
    await page.getByRole('heading',{name:'Neuer Inventareintrag',exact:true}).waitFor();
    await page.getByLabel('Seriennummer:',{exact:true}).waitFor();
    assert.equal(await page.getByLabel('Seriennummer:',{exact:true}).inputValue(),'');
    assert.equal(await page.getByLabel('QR-Code / Barcode:',{exact:true}).inputValue(),'');
    assert.equal(await page.getByLabel('EAN:',{exact:true}).inputValue(),'');
    assert.equal(await page.getByPlaceholder('z. B. IT-000123').inputValue(),'');
    assert.equal(await page.getByRole('button',{name:'MAC-Adresse hinzufügen'}).count(),1);
    await page.getByPlaceholder('z. B. IT-000123').fill('NEW-5');
    await page.getByRole('button',{name:'Eintrag speichern'}).click();
    await page.waitForURL('**/#/inventory');
    assert.equal(newAsset.model.id,1);
    assert.equal(newAsset.storage_location_id,1);
    assert.deepEqual(newAsset.assignment,{employee_id:null,department_id:1});
    assert.deepEqual(newAsset.scanner_codes,{qr_code:null,ean:null});
    assert.equal(newAsset.asset.serial_number,null);
    assert.equal(newAsset.asset.new_price,100);
    assert.equal(newAsset.connection_changes,undefined);

    await first.click();
    await second.click({modifiers:['Control']});
    await first.click({button:'right'});
    await page.getByRole('menuitem',{name:'Auswahl bearbeiten',exact:true}).click();
    const dialog=page.locator('.asset-form-page--editor');
    await dialog.getByRole('heading',{name:'Auswahl bearbeiten',exact:true}).waitFor();
    assert.equal(await dialog.getByLabel('Zustand:',{exact:true}).inputValue(),'');
    assert.equal(await dialog.getByLabel('Status:',{exact:true}).inputValue(),'');
    const model = dialog.getByLabel('Produktmodell:',{exact:true});
    assert.equal(await model.inputValue(),'Laptop');
    assert.equal(await model.isDisabled(),true);
    assert.equal(await dialog.getByLabel('Standort:',{exact:true}).inputValue(),'Basel');
    assert.equal(await dialog.getByLabel('Produkterkennung:',{exact:true}).inputValue(),'');
    assert.equal(await dialog.getByText('Spezifikationen',{exact:true}).count(),0);
    await dialog.getByLabel('Zustand:',{exact:true}).selectOption('defective');
    page.once('dialog',d=>d.dismiss());
    await dialog.getByRole('button',{name:'Änderungen speichern'}).click();
    assert.equal(bulk,null);
    page.once('dialog',async d=>{assert.match(d.message(),/Wirklich auf alle anwenden/);await d.accept();});
    await dialog.getByRole('button',{name:'Änderungen speichern'}).click();
    await dialog.waitFor({state:'hidden'});
    await first.getByRole('cell',{name:'Defekt',exact:true}).waitFor();
    await second.getByRole('cell',{name:'Defekt',exact:true}).waitFor();
    assert.deepEqual(bulk.changes,{condition:'defective'});
    assert.deepEqual(bulk.entries.map(row=>row.id),[1,2]);
    await first.click();
    await page.getByRole('cell',{name:'Kabel',exact:true}).click({modifiers:['Control']});
    await first.click({button:'right'});
    await page.getByRole('menuitem',{name:'Auswahl bearbeiten',exact:true}).click();
    await dialog.getByLabel('Zustand:',{exact:true}).waitFor();
    assert.equal(await dialog.getByLabel('Status:',{exact:true}).isDisabled(),true);
    assert.equal(await dialog.getByLabel('Produktmodell:',{exact:true}).inputValue(),'');
    await dialog.getByRole('button',{name:'Abbrechen',exact:true}).click();
    await page.goto(url+'/#/settings?tab=backup');
    const interval = page.getByLabel('Sicherungsintervall');
    await interval.waitFor();
    assert.equal(await interval.inputValue(),'weekly');
    await page.getByText(/Jeden Sonntag um 02:00 Uhr/).waitFor();
    assert.equal(await page.locator('.backup-saved li').count(),5);
    await interval.selectOption('monthly');
    await page.getByRole('button',{name:'Intervall speichern'}).click();
    await page.getByText('Sicherungsintervall gespeichert.',{exact:true}).waitFor();
    assert.equal(frequency,'monthly');
    await page.reload();
    await page.getByText(/Am 1. jedes Monats um 02:00 Uhr/).waitFor();
    const [automatic] = await Promise.all([page.waitForEvent('download'),page.locator('.backup-saved button').first().click()]);
    assert.equal(automatic.suggestedFilename(),'Sicherung.p7m');
    const backup = page.getByRole('button',{name:'Backup herunterladen'});
    const [download] = await Promise.all([page.waitForEvent('download'),backup.click()]);
    assert.equal(download.suggestedFilename(),'Sicherung.json.gz');
    await page.getByLabel('Backup-Datei').setInputFiles({name:'Sicherung.json.gz',mimeType:'application/gzip',buffer:contents});
    const [restore] = await Promise.all([page.waitForEvent('download'),page.getByRole('button',{name:'SQL-Datei erstellen'}).click()]);
    assert.equal(restore.suggestedFilename(),'Sicherung.restore.sql');
    assert.deepEqual(postedBackup,contents);
    console.log('PASS: Preisfilter für beide Artikeltypen, saubere Duplizierung, Sammelformular, fünf Sicherungen, Intervall und Downloads.');
  } finally { await browser.close(); await vite.close(); }
})().catch(error=>{ console.error(error);process.exitCode=1; });
