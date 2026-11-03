/* Echte lokale PostgreSQL-Transaktionen und Rollen, keine Produktiv-Testdaten. */
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {PGlite}=require(process.env.PGLITE_MODULE||'@electric-sql/pglite');
const root=path.resolve(__dirname,'..');
const users={admin:'00000000-0000-0000-0000-000000000001',editor:'00000000-0000-0000-0000-000000000002',viewer:'00000000-0000-0000-0000-000000000003',limited:'00000000-0000-0000-0000-000000000004'};
const run=(async()=>{
 const db=await PGlite.create();
 const q=async(sql,args)=>(await db.query(sql,args)).rows;
 const asUser=async(role,work)=>{await q("SELECT set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:users[role],role:'authenticated'})]);await db.exec('SET ROLE authenticated');try{await work();}finally{await db.exec('RESET ROLE');}};
 const book=async(args={})=>(await q('SELECT public.book_inventory_stock($1,100,11,$2,$3,$4,$5,$6) result',
  [args.id||randomUUID(),args.condition||'new',args.qty??1,args.direction||'remove',args.details||{},args.expected??null]))[0].result;
 try{
  await db.exec(fs.readFileSync(path.join(__dirname,'fixtures/site_scope_base.sql'),'utf8'));
  await db.exec(fs.readFileSync(path.join(root,'database/scanner_codes.sql'),'utf8'));
  await db.exec('CREATE UNIQUE INDEX test_asset_tags ON public.assets(asset_tag);CREATE UNIQUE INDEX test_asset_serials ON public.assets(serial_number);');
  await db.exec(`INSERT INTO auth.users(id,email) VALUES ${Object.entries(users).map(([r,id])=>`('${id}','${r}@example.test')`).join(',')};
   INSERT INTO public.organizations(id,name) VALUES(1,'Test');
   INSERT INTO public.sites(id,name,organization_id) VALUES(1,'Lager',1),(2,'Einsatzort',1);
   INSERT INTO public.departments(id,name,site_id,organization_id) VALUES(10,'Lager',1,1),(20,'Büro',2,1);
   INSERT INTO public.storage_locations(id,name,site_id,department_id) VALUES(11,'Kiste',1,10),(22,'Büro',2,20);
   INSERT INTO public.employees(id,first_name,last_name,email,department_id,auth_user_id,app_role) VALUES
    (1,'Test','Admin','admin@example.test',10,'${users.admin}','admin'),(2,'Test','Editor','editor@example.test',10,'${users.editor}','user'),
    (3,'Test','Viewer','viewer@example.test',10,'${users.viewer}','viewer'),(4,'Test','Limited','limited@example.test',10,'${users.limited}','user');
   INSERT INTO public.manufacturers(id,name) VALUES(1,'Test');INSERT INTO public.product_categories(id,name,code,inventory_group) VALUES(1,'Router','router','device');
   INSERT INTO public.product_models(id,name,category_id,manufacturer_id,tracking_mode,qr_code) VALUES(100,'Router',1,1,'quantity','BOX-ROUTER');
   INSERT INTO public.stock_movements(product_model_id,to_storage_location_id,to_condition,quantity,movement_type,department_id,purchase_date,new_price,note) VALUES(100,11,'new',10,'receipt',10,'2026-01-01',49,'Ursprüngliche Notiz');`);
  for(const name of ['20261029093456_site_permissions.sql','20261102145032_inventory_archive_images.sql','20261102153129_stock_outcomes.sql','20261102154643_stock_metadata_notes.sql'])await db.exec(fs.readFileSync(path.join(root,'supabase/migrations',name),'utf8'));
  await asUser('admin',async()=>{for(const [id,sites] of [[2,[1,2]],[3,[1]],[4,[1]]])await q('SELECT public.set_employee_site_access($1,$2)',[id,sites]);});
  let archivedId,imageId,convertedId;
  await asUser('editor',async()=>{
   imageId=(await q('SELECT public.set_inventory_image($1,$2) id',['stock:100:11:new','cGhvdG8=']))[0].id;
   await assert.rejects(book(),/Verwendung/);
   await assert.rejects(book({details:{action:'archive',reason:{reason:'customer'}}}),/Kundennamen/);
   const id=randomUUID(),args={id,qty:2,expected:10,details:{action:'archive',reason:{reason:'customer',customer_name:'Kunde',note:'Übergabe'}}};
   const result=await book(args);assert.equal(Number(result.quantity),8);archivedId=result.archive_id;
   assert.deepEqual(await book(args),result);
   assert.equal(Number((await q('SELECT count(*) n FROM public.inventory_archive'))[0].n),1);
   assert.equal((await q('SELECT snapshot FROM public.inventory_archive WHERE id=$1',[archivedId]))[0].snapshot.stock_quantity,2);
   await assert.rejects(book({...args,qty:3}),/andere Daten/);
   await assert.rejects(book({qty:1,expected:10,details:args.details}),e=>e.code==='40001');
   const outcome={action:'assets',target_location_id:22,target_condition:'used',target_status:'in_use',units:[{asset_tag:'ROUTER-1',serial_number:'SN/001',mac_address:'aabbcc112233'}]};
   const converted=await book({qty:1,expected:8,details:outcome});assert.equal(Number(converted.quantity),7);assert.equal(converted.asset_count,1);convertedId=converted.asset_ids[0];
   assert.equal((await q('SELECT tracking_mode FROM public.product_models WHERE id=100'))[0].tracking_mode,'hybrid');
   const asset=(await q('SELECT * FROM public.assets WHERE id=$1',[convertedId]))[0];assert.equal(asset.mac_address,'AA:BB:CC:11:22:33');assert.equal(asset.serial_number,'SN/001');assert.equal(asset.last_storage_location_id,22);
   assert.equal(Number((await q('SELECT count(*) n FROM public.asset_assignments WHERE asset_id=$1 AND department_id=20 AND employee_id IS NULL',[convertedId]))[0].n),1);
   assert.equal((await q('SELECT image_data FROM public.inventory_images WHERE item_key=$1',[`asset:${convertedId}`]))[0].image_data,'cGhvdG8=');
   assert.equal((await q("SELECT note FROM public.stock_movements WHERE movement_type='installation' LIMIT 1"))[0].note,'Ursprüngliche Notiz');
   const count=Number((await q('SELECT count(*) n FROM public.assets'))[0].n);
   await assert.rejects(book({qty:2,details:{...outcome,units:[{asset_tag:'DUP'},{asset_tag:'DUP'}]}}),e=>e.code==='23505');
   assert.equal(Number((await q('SELECT count(*) n FROM public.assets'))[0].n),count);
   assert.equal(Number((await q("SELECT quantity FROM public.stock_levels WHERE condition='new'"))[0].quantity),7);
   await assert.rejects(book({qty:8,details:args.details}),e=>e.code==='40001');
   const full={id:randomUUID(),qty:7,expected:7,details:{...outcome,metadata:{note:null},units:Array.from({length:7},(_,i)=>({asset_tag:`REST-${i}`}))}};
   const zero=await book(full);assert.equal(Number(zero.quantity),0);assert.equal(zero.asset_count,7);assert.deepEqual(await book(full),zero);
   const add={id:randomUUID(),direction:'add',qty:4};assert.equal(Number((await book(add)).quantity),4);assert.equal(Number((await book(add)).quantity),4);
   await book({qty:4,details:{action:'archive',reason:{reason:'defective',destroyed:true}}});
   assert.equal(Number((await q("SELECT quantity FROM public.stock_levels WHERE condition='new'"))[0].quantity),0);
   assert.equal((await q('SELECT is_current FROM public.inventory_images WHERE id=$1',[imageId]))[0].is_current,false);
   assert.equal((await q('SELECT note FROM public.stock_movements ORDER BY id DESC LIMIT 1'))[0].note,null);
   assert.equal(Number((await q("SELECT count(*) n FROM public.stock_movements WHERE movement_type='installation' AND related_asset_id IS NOT NULL"))[0].n),8);
  });
  await asUser('limited',async()=>{await assert.rejects(book({details:{action:'assets',target_location_id:22,units:[{asset_tag:'DENIED'}]}}),e=>e.code==='42501');});
  await asUser('viewer',async()=>{
   assert.equal((await q('SELECT id FROM public.assets WHERE id=$1',[convertedId])).length,0);
   assert.equal((await q('SELECT image_data FROM public.inventory_images WHERE id=$1',[imageId]))[0].image_data,'cGhvdG8=');
   await assert.rejects(book({direction:'add'}),e=>e.code==='42501');
  });
  console.log('PASS: Teilarchivierung, Pflichtgründe, Einzelartikel/Ziel/Bilder, atomare Rückabwicklung, veraltete Mengen, vollständige Entnahme und wiederholbare Buchungen mit echter Standort-RLS');
 }finally{await db.close();}
})();run.catch(e=>{console.error({message:e.message,code:e.code,where:e.where,stack:e.stack});process.exitCode=1;});module.exports=run;
