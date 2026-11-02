/* Isolierte PostgreSQL-Tests: Archiv, Gründe, Bilder und Standortschutz. */
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {PGlite}=require(process.env.PGLITE_MODULE || '@electric-sql/pglite');
const users={admin:'00000000-0000-0000-0000-000000000001',editor:'00000000-0000-0000-0000-000000000002',viewer:'00000000-0000-0000-0000-000000000003'};
const run=(async()=>{
 const db=await PGlite.create();
 const q=async(sql,args)=>(await db.query(sql,args)).rows;
 const rejected=async(sql,args,code)=>assert.rejects(db.query(sql,args),e=>!code||e.code===code);
 const asUser=async(role,work)=>{
  await db.query("SELECT set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:users[role],role:'authenticated'})]);
  await db.exec('SET ROLE authenticated');try{await work();}finally{await db.exec('RESET ROLE');}
 };
 try{
  await db.exec(fs.readFileSync(path.join(__dirname,'fixtures/site_scope_base.sql'),'utf8'));
  await db.exec(fs.readFileSync(path.join(__dirname,'../database/scanner_codes.sql'),'utf8'));
  await db.exec(`INSERT INTO auth.users(id,email) VALUES('${users.admin}','admin@example.test'),('${users.editor}','editor@example.test'),('${users.viewer}','viewer@example.test');
   INSERT INTO public.organizations(id,name) VALUES(1,'Test');
   INSERT INTO public.sites(id,name,organization_id) VALUES(1,'Basel',1),(2,'Verborgen',1);
   INSERT INTO public.departments(id,name,site_id,organization_id) VALUES(10,'IT',1,1),(20,'Verborgen',2,1);
   INSERT INTO public.storage_locations(id,name,site_id,department_id) VALUES(11,'Lager',1,10),(22,'Verborgen',2,20);
   INSERT INTO public.employees(id,first_name,last_name,email,department_id,auth_user_id,app_role) VALUES
    (1,'Test','Admin','admin@example.test',10,'${users.admin}','admin'),(2,'Test','Editor','editor@example.test',10,'${users.editor}','user'),(3,'Test','Viewer','viewer@example.test',10,'${users.viewer}','viewer');
   INSERT INTO public.manufacturers(id,name) VALUES(1,'Test');INSERT INTO public.product_categories(id,name,code,inventory_group) VALUES(1,'Gerät','device','device');
   INSERT INTO public.product_models(id,name,category_id,manufacturer_id,tracking_mode) VALUES(100,'Notebook',1,1,'serialized'),(101,'Fernbedienung',1,1,'quantity');
   INSERT INTO public.assets(id,product_model_id,asset_tag,serial_number,purchase_date) VALUES(10,100,'PC-10','SER-42','2026-01-01'),(11,100,'PC-11',NULL,'2026-01-01'),(20,100,'VERBORGEN',NULL,'2026-01-01');
   INSERT INTO public.asset_locations(asset_id,storage_location_id) VALUES(10,11),(11,11),(20,22);
   INSERT INTO public.stock_movements(product_model_id,to_storage_location_id,to_condition,quantity,movement_type,department_id,purchase_date) VALUES(101,11,'used',5,'receipt',10,'2026-01-01');`);
  await db.exec(fs.readFileSync(path.join(__dirname,'../supabase/migrations/20261029093456_site_permissions.sql'),'utf8'));
  await db.exec(fs.readFileSync(path.join(__dirname,'../supabase/migrations/20261102145032_inventory_archive_images.sql'),'utf8'));
  await asUser('admin',async()=>{await q('SELECT public.set_employee_site_access(2,ARRAY[1]::bigint[])');await q('SELECT public.set_employee_site_access(3,ARRAY[1]::bigint[])');});
  let archivedImage,hiddenImage;
  await asUser('admin',async()=>{hiddenImage=(await q('SELECT public.set_inventory_image($1,$2) id',['asset:20','aGlkZGVu']))[0].id;});
  await asUser('editor',async()=>{
   const first=(await q('SELECT public.set_inventory_image($1,$2) id',['asset:10',Buffer.from('image-a').toString('base64')]))[0].id;
   archivedImage=(await q('SELECT public.set_inventory_image($1,$2) id',['asset:10',Buffer.from('image-b').toString('base64')]))[0].id;
   assert.notEqual(first,archivedImage);assert.equal((await q('SELECT count(*) n FROM public.inventory_images WHERE is_current'))[0].n,1);
   await rejected('UPDATE public.inventory_images SET image_data=$1 WHERE id=$2',['changed',first],'42501');
   await rejected('SELECT public.set_inventory_image($1,$2)',['asset:20','aW1hZ2U='],'42501');
   await rejected("INSERT INTO public.inventory_archive(source_key,record_type,label,site_id,snapshot,image_id,reason,archived_by_name) VALUES('asset:11','asset','Gefälscht',1,'{}',$1,'lost','Editor')",[hiddenImage],'42501');
   await rejected('SELECT public.archive_inventory_items($1,$2)',[['asset:10'],{reason:'customer'}]);
   await rejected('SELECT public.archive_inventory_items($1,$2)',[['asset:10'],{reason:'defective'}]);
   await rejected('SELECT public.archive_inventory_items($1,$2)',[['asset:10'],{reason:'other',note:'   '}]);
   await rejected('SELECT public.archive_inventory_items($1,$2)',[['asset:11','asset:20'],{reason:'lost'}],'42501');
   assert.equal((await q('SELECT archived_at FROM public.assets WHERE id=11'))[0].archived_at,null);
   assert.equal(Number((await q('SELECT count(*) n FROM public.inventory_archive'))[0].n),0);
   const result=(await q('SELECT public.archive_inventory_items($1,$2) result',[['asset:10'],{reason:'customer',customer_name:'Kunde Beispiel',note:'Übergeben'}]))[0].result;
   assert.equal(result.deleted_count,1);
   const item=(await q('SELECT * FROM public.inventory_archive'))[0];
   assert.equal(item.customer_name,'Kunde Beispiel');assert.equal(item.snapshot.serial_number,'SER-42');assert.equal(item.image_id,archivedImage);
   assert.ok((await q('SELECT archived_at FROM public.assets WHERE id=10'))[0].archived_at);
   assert.equal((await q('SELECT is_current FROM public.inventory_images WHERE id=$1',[archivedImage]))[0].is_current,false);
   await rejected("UPDATE public.assets SET note='ändern' WHERE id=10",[],'42501');
   await rejected('SELECT public.set_inventory_image($1,$2)',['asset:10','aW1hZ2U='],'42501');
   await q('SELECT public.archive_inventory_items($1,$2)',[['stock:101:11:used'],{reason:'defective',destroyed:true,note:'Vernichtet'}]);
   assert.equal(Number((await q('SELECT quantity FROM public.stock_levels WHERE product_model_id=101'))[0].quantity),0);
   const stock=(await q("SELECT snapshot FROM public.inventory_archive WHERE record_type='stock'"))[0].snapshot;
   assert.equal(Number(stock.stock_quantity),5);
  });
  let movedImage;
  await asUser('admin',async()=>{
   movedImage=(await q('SELECT public.set_inventory_image($1,$2) id',['asset:11','bW92ZWQ=']))[0].id;
   await q('UPDATE public.asset_locations SET storage_location_id=22 WHERE asset_id=11');
  });
  await asUser('editor',async()=>{
   assert.equal((await q('SELECT id FROM public.inventory_images WHERE id=$1',[movedImage])).length,0);
   await rejected('SELECT public.set_inventory_image($1,$2)',['asset:11','aW1hZ2U='],'42501');
  });
  await asUser('admin',async()=>{await q('SELECT public.archive_inventory_items($1,$2)',[['asset:20'],{reason:'other',note:'Altbestand'}]);});
  await asUser('viewer',async()=>{
   assert.equal(Number((await q('SELECT count(*) n FROM public.inventory_archive'))[0].n),2);
   assert.equal((await q('SELECT image_data FROM public.inventory_images WHERE id=$1',[archivedImage]))[0].image_data,Buffer.from('image-b').toString('base64'));
   await rejected('SELECT public.archive_inventory_items($1,$2)',[['asset:11'],{reason:'lost'}],'42501');
   await rejected('SELECT public.set_inventory_image($1,$2)',['asset:11','aW1hZ2U='],'42501');
   await rejected('DELETE FROM public.inventory_archive',[],'42501');
  });
  console.log('PASS: Archivgründe, Kundenname, Vernichtung, atomare Stapel, Geräte/Mengen, unveränderte Historie, dauerhafte Bilder und echte Standort-RLS');
 }finally{await db.close();}
})();run.catch(error=>{console.error({message:error.message,code:error.code,stack:error.stack});process.exitCode=1;});module.exports=run;
