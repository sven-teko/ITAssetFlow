/* Neue Arbeitsabläufe mit lokaler API und echtem gebündeltem Barcode-Decoder. */
const path=require('node:path'),fs=require('node:fs'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const run=(async()=>{
 const vite=await (await import(require.resolve('vite',{paths:[path.resolve(__dirname,'../web')]}))).preview({root:path.resolve(__dirname,'../web'),preview:{host:'127.0.0.1',port:5176,strictPort:true}});
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE,args:['--no-sandbox','--disable-dev-shm-usage','--no-zygote','--single-process']});
 try{
  const page=await browser.newPage({viewport:{width:1440,height:1000},hasTouch:true}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(10000);
  const imageId='00000000-0000-0000-0000-000000000001';
  let photo=null,saved=null,archivePayload=null,lookup=null,stockPhoto=null,stockSaved=false,deletions=0,restores=0,role='admin';
  let finishEditLoad;
  const editLoad=new Promise(resolve=>{finishEditLoad=resolve;});
  const longTag='W'.repeat(50);
  const mac='AA:BB:CC:11:22:33';
  const archived=[{id:'archive-2',source_key:'asset:3',label:'PC-003',snapshot:{id:3,_record_type:'asset',asset_tag:'PC-003',site_name:'Basel'},reason:'lost',archived_at:'2026-10-29T10:00:00Z',archived_by_name:'Test Admin'}];
  const meta={column_order:['asset_tag','mac_address','product_model_name','created_at','updated_at','site_name'],default_visible_columns:['asset_tag','mac_address','product_model_name','created_at','updated_at','site_name'],headers:{asset_tag:'Produkterkennung',product_model_name:'Produktmodell',created_at:'Erstellt am',updated_at:'Geändert am',site_name:'Standort',serial_number:'Seriennummer',mac_address:'MAC-Adresse'},status_labels:{available:'Verfügbar'},condition_labels:{used:'Gebraucht'},inventory_group_labels:{device:'Gerät'}};
  let rows=[{id:1,_record_type:'asset',asset_tag:longTag,product_model_name:'Notebook',site_name:'Basel',department_name:'IT',storage_location:'Lager',created_at:'2026-11-02T09:07:58Z',updated_at:'2026-07-04T14:03:59Z',status:'available',condition:'used',_web_inventory_group:'device',_web_category_key:'laptop',_web_condition_key:'used'}];
  const form={sites:[{id:1,name:'Basel'}],departments:[{id:10,name:'IT',site_id:1}],storage_locations:[{id:11,name:'Lager',site_id:1,department_id:10,is_active:true}],employees:[],manufacturers:[{id:1,name:'Test'}],product_categories:[{id:1,name:'Notebook',code:'laptop',inventory_group:'device',specification_schema:{fields:[]}}],product_models:[{id:100,name:'Notebook',category_id:1,manufacturer_id:1,tracking_mode:'serialized',is_active:true,specifications:{}}],parent_assets:[]};
  await page.route(url=>url.pathname.startsWith('/api/'),async route=>{
   const req=route.request(),url=new URL(req.url()),p=decodeURIComponent(url.pathname);
   const headers={'Access-Control-Allow-Origin':'http://127.0.0.1:5176','Access-Control-Allow-Credentials':'true','Access-Control-Allow-Headers':'*','Access-Control-Allow-Methods':'GET,POST,PUT,DELETE,OPTIONS'};
   const json=(body,status=200)=>route.fulfill({status,headers,contentType:'application/json',body:JSON.stringify(body)});
   if(req.method()==='OPTIONS')return route.fulfill({status:204,headers});
   if(p==='/api/auth/session')return json({authenticated:true,email:'admin@example.test',role});
   if(p==='/api/preferences/inventory-columns')return json({preferences:null});
   if(p==='/api/inventory/meta')return json(meta);
   if(p==='/api/inventory/revision')return json({revision:1});
   if(p==='/api/inventory/events')return route.fulfill({headers,contentType:'text/event-stream',body:': test\n\n'});
   if(p==='/api/inventory/form-data')return json(form);
   if(p==='/api/inventory/edit-form-data'){await editLoad;return json({...form,edit_entry:{id:'stock:101:11:used',_record_type:'stock',product_model_id:101,storage_location_id:11,department_id:10,site_id:1,condition:'used',status:'available',stock_quantity:5,image_id:imageId,purchase_date:'2026-11-02'}});}
   if(p==='/api/scanner/lookup'){lookup={code:url.searchParams.get('code'),type:url.searchParams.get('code_type')};return json({code:lookup.code,code_type:lookup.type,matches:[],locations:[]});}
   if(p==='/api/inventory'){
    if(req.method()==='PUT'){stockSaved=true;return json({entry_type:'stock',product_model_id:101,quantity:5});}
    if(req.method()==='POST'){
     saved=req.postDataJSON();rows.push({...rows[0],id:2,asset_tag:saved.asset.asset_tag,mac_address:saved.asset.mac_address,serial_number:saved.asset.serial_number});
     return json({id:2,entry_type:'asset'});
    }return json(rows);
   }
   if(p==='/api/inventory/asset:2/image'){
    assert.equal(req.headers()['content-type'],'image/webp');photo=req.postDataBuffer();
    assert.equal(photo.toString('ascii',0,4),'RIFF');assert.equal(photo.toString('ascii',8,12),'WEBP');
    rows[1].image_id=imageId;return json({image_id:imageId});
   }
   if(p===`/api/images/${imageId}`)return route.fulfill({headers,contentType:'image/webp',body:photo});
   if(p==='/api/inventory/stock:101:12:used/image'){assert.equal(stockSaved,true);stockPhoto=req.postDataBuffer();return json({image_id:imageId});}
   if(p==='/api/inventory/delete'){
    archivePayload=req.postDataJSON();assert.equal(archivePayload.reason.customer_name,'Beispielkunde');
    const row=rows.find(r=>r.id===2);archived.unshift({id:'archive-1',source_key:'asset:2',label:row.asset_tag,snapshot:{...row},...archivePayload.reason,archived_at:'2026-11-02T10:12:59Z',archived_by_name:'Test Admin'});
    rows=rows.filter(r=>r.id!==2);return json({deleted_count:1});
   }
   if(p==='/api/archive')return json({items:archived,total:archived.length});
   if(p==='/api/archive/archive-1/restore'&&req.method()==='POST'){
    restores++;rows.push(archived.shift().snapshot);return json({restored:true,key:'asset:2',quantity:1});
   }
   if(p==='/api/archive/archive-2'&&req.method()==='DELETE'){
    deletions++;archived.splice(0,1);return route.fulfill({status:204,headers});
   }
   return json({detail:`Unbekannter Test-Endpunkt ${p}`},404);
  });
  const screenshot=async name=>{if(process.env.SCREENSHOT_DIR){fs.mkdirSync(process.env.SCREENSHOT_DIR,{recursive:true});await page.screenshot({path:path.join(process.env.SCREENSHOT_DIR,name+'.png')});}};
  await page.goto('http://127.0.0.1:5176/#/inventory');
  await page.getByRole('cell',{name:'02.11.2026-10-07',exact:true}).waitFor();
  await page.getByRole('cell',{name:'04.07.2026-16-03',exact:true}).waitFor();
  assert.equal(await page.getByRole('columnheader',{name:'MAC-Adresse',exact:true}).count(),0);
  await page.getByRole('cell',{name:longTag,exact:true}).click();
  const selection=page.locator('.selection-box');
  assert.equal(await selection.getAttribute('title'),longTag);
  assert.equal(await selection.evaluate(el=>el.scrollWidth<=el.clientWidth),true);
  assert.equal(await page.locator('.details').getByText('MAC-Adresse',{exact:true}).count(),0);
  console.log('PASS: Erstell- und Änderungsdatum ohne Sekunden, Winter-/Sommerzeit Schweiz');
  await page.getByRole('button',{name:'Scanner',exact:true}).click();
  await page.getByLabel('Code-Bild öffnen',{exact:true}).setInputFiles(path.join(__dirname,'fixtures/CODE128-MAC.svg'));
  await page.getByRole('heading',{name:'Neuer Inventareintrag'}).waitFor();
  assert.deepEqual(lookup,{code:'AABBCC112233',type:'mac'});
  assert.equal(await page.getByLabel('MAC-Adresse:',{exact:true}).inputValue(),'AA:BB:CC:11:22:33');
  assert.equal(await page.getByLabel('Seriennummer:',{exact:true}).inputValue(),'');
  await page.getByLabel('Barcode enthält').selectOption('serial');
  assert.equal(await page.getByLabel('Seriennummer:',{exact:true}).inputValue(),'AABBCC112233');
  assert.equal(await page.getByLabel('MAC-Adresse:',{exact:true}).count(),0);
  await page.getByLabel('Barcode enthält').selectOption('mac');
  const row=label=>page.locator('.asset-form-row').filter({has:page.locator('label').filter({hasText:label})});
  await row(/^Standort \*:/).locator('select').selectOption('1');
  await row(/^Abteilung \*:/).locator('select').selectOption('10');
  await row(/^Lagerort \*:/).locator('select').selectOption('11');
  await page.getByLabel('Kaufdatum *:',{exact:true}).fill('2026-11-02');
  await page.setViewportSize({width:390,height:844});
  const capture=page.locator('input[capture="environment"]');
  assert.equal(await capture.getAttribute('accept'),'image/*');
  const [chooser]=await Promise.all([page.waitForEvent('filechooser'),page.getByRole('button',{name:'Foto aufnehmen'}).click()]);
  await chooser.setFiles(path.join(__dirname,'fixtures/QR-CABLE.png'));
  await page.getByAltText('Vorschau des Artikelbilds').waitFor();
  await screenshot('artikel-mit-bild');
  await page.getByRole('button',{name:/speichern/i}).click();
  await page.setViewportSize({width:1440,height:1000});
  await page.getByRole('cell',{name:mac,exact:true}).waitFor();
  assert.equal(saved.asset.mac_address,'AA:BB:CC:11:22:33');assert.equal(saved.asset.serial_number,null);assert.ok(photo.length>20&&photo.length<=1048576);
  await page.getByRole('cell',{name:mac,exact:true}).click();
  const specCard=page.locator('.detail-card').filter({has:page.getByRole('heading',{name:'Spezifikationen',exact:true})});
  await specCard.getByText('MAC-Adresse',{exact:true}).waitFor();
  await specCard.getByText(mac,{exact:true}).waitFor();
  await page.getByAltText('Artikelbild',{exact:true}).scrollIntoViewIfNeeded();
  await page.waitForFunction(()=>document.querySelector('.item-image img')?.naturalWidth>0);
  await screenshot('detail-bild-unten');
  console.log('PASS: MAC-Code aus echtem Barcode, korrigierbare Seriennummer-Zuordnung, WebP-Upload und Bild unten in Details');
  await page.getByRole('cell',{name:mac,exact:true}).click({button:'right'});
  await page.getByRole('menuitem',{name:'Eintrag löschen'}).click();
  const dialog=page.getByRole('dialog',{name:'Artikel archivieren',exact:true});
  await dialog.getByRole('button',{name:'Archivieren',exact:true}).click();
  assert.equal(archivePayload,null);assert.equal(await dialog.getByLabel('Kundenname *',{exact:true}).evaluate(el=>el.validity.valueMissing),true);
  await dialog.getByLabel('Kundenname *',{exact:true}).fill('Beispielkunde');
  await dialog.getByLabel('Bemerkung',{exact:true}).fill('Am Empfang abgegeben.');
  await screenshot('archiv-pflichtgrund');
  await dialog.getByRole('button',{name:'Archivieren',exact:true}).click();
  await dialog.waitFor({state:'hidden'});
  assert.deepEqual(archivePayload.entry_keys,['asset:2']);
  await page.getByRole('cell',{name:mac,exact:true}).waitFor({state:'hidden'});
  assert.equal(await page.getByText('Beispielkunde',{exact:false}).count(),0);
  await page.getByRole('button',{name:'Datei',exact:true}).click();
  await page.getByRole('button',{name:'Archiv',exact:true}).click();
  await page.getByRole('heading',{name:'Archiv',exact:true}).waitFor();
  await page.getByText('Kunde: Beispielkunde',{exact:true}).waitFor();
  await page.getByText('Am Empfang abgegeben.',{exact:true}).waitFor();
  await page.getByRole('cell',{name:'02.11.2026-11-12',exact:true}).waitFor();
  await page.getByAltText('Artikelbild',{exact:true}).scrollIntoViewIfNeeded();
  await page.waitForFunction(()=>document.querySelector('.item-image img')?.naturalWidth>0);
  await screenshot('archiv-desktop');
  for(const width of [390,360]){
   await page.setViewportSize({width,height:844});
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
   assert.equal(await page.locator('.archive-detail .details').isVisible(),true);
   await page.getByAltText('Artikelbild',{exact:true}).scrollIntoViewIfNeeded();
   await screenshot('archiv-mobile-'+width);
  }
  assert.deepEqual(errors,[]);
  console.log('PASS: Pflicht-Kundenname, Entfernen aus Inventar, Datei > Archiv mit Grund/Bild und mobile Ansicht ohne Überlauf');
  const restore=page.getByRole('button',{name:'Wiederherstellen',exact:true});
  const secondRow=page.getByRole('row').filter({has:page.getByRole('button',{name:'PC-003',exact:true})});
  await secondRow.getByRole('cell',{name:'Verloren',exact:true}).click();
  await page.getByRole('button',{name:'PC-003',exact:true,pressed:true}).waitFor();
  await page.getByRole('button',{name:mac,exact:true}).press('Space');
  await page.getByRole('button',{name:mac,exact:true,pressed:true}).waitFor();
  role='user';
  await page.reload();
  await restore.waitFor();
  assert.equal(await page.getByRole('button',{name:'Endgültig löschen',exact:true}).count(),0);
  page.once('dialog',prompt=>prompt.accept());
  await restore.click();
  await page.getByRole('status').filter({hasText:'wurde wiederhergestellt'}).waitFor();
  assert.equal(restores,1);assert.equal(rows.some(row=>row.id===2),true);
  await page.getByRole('button',{name:'PC-003',exact:true}).waitFor();
  role='viewer';
  await page.reload();
  await page.getByRole('button',{name:'PC-003',exact:true}).waitFor();
  assert.equal(await restore.count(),0);
  console.log('PASS: Ganze Archivzeile per Maus, Tastaturauswahl und Wiederherstellung für Bearbeiter');
  role='admin';
  await page.reload();
  const remove=page.getByRole('button',{name:'Endgültig löschen',exact:true});
  page.once('dialog',prompt=>prompt.dismiss());
  await remove.click();assert.equal(deletions,0);
  page.once('dialog',prompt=>prompt.accept());
  await remove.click();
  await page.getByText('Keine archivierten Artikel vorhanden.').waitFor();
  assert.equal(deletions,1);assert.equal(rows.some(row=>row.id===3),false);
  console.log('PASS: Löschen im Archiv verlangt Bestätigung und stellt keinen Artikel wieder her');
  await page.setViewportSize({width:1440,height:1000});
  form.product_models.push({id:101,name:'Fernbedienung',category_id:1,manufacturer_id:1,tracking_mode:'quantity',is_active:true,specifications:{}});
  form.storage_locations.push({id:12,name:'Ziel',site_id:1,department_id:10,is_active:true});
  await page.goto('http://127.0.0.1:5176/#/inventory/stock%3Atest/edit');
  await page.getByRole('status').filter({hasText:'Daten für den Inventareintrag werden geladen'}).waitFor();
  assert.equal(await page.locator('.asset-form-spinner').evaluate(el=>getComputedStyle(el).animationName),'asset-form-spin');
  finishEditLoad();
  await page.getByRole('heading',{name:'Inventareintrag bearbeiten',exact:true}).waitFor();
  await page.setViewportSize({width:390,height:844});
  assert.equal(await page.getByRole('button',{name:'Foto aufnehmen'}).isVisible(),true);
  await page.setViewportSize({width:1440,height:1000});
  await row(/^Lagerort \*:/).locator('select').selectOption('12');
  await page.getByRole('button',{name:/speichern/i}).click();
  await page.getByRole('cell',{name:longTag,exact:true}).waitFor();
  assert.deepEqual(stockPhoto,photo);assert.deepEqual(errors,[]);
  console.log('PASS: Vorhandenes Artikelbild bleibt bei Verschiebung eines Mengenbestands erhalten');
 }finally{await browser.close();await vite.close();}
})();run.catch(e=>{console.error(e);process.exitCode=1;});module.exports=run;
