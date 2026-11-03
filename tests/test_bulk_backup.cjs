/* Echte PostgreSQL-Regeln, getrennte In-Memory-Quell- und Zieldatenbank. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require(process.env.PGLITE_MODULE || '@electric-sql/pglite');

const root = path.resolve(__dirname, '..');
const sql = file => fs.readFileSync(path.join(root, file), 'utf8');
const admin = '00000000-0000-0000-0000-000000000001';
const editor = '00000000-0000-0000-0000-000000000002';
const viewer = '00000000-0000-0000-0000-000000000003';
const asset = id => ({type:'asset',id});
const stock = (condition,quantity) => ({type:'stock',product_model_id:2,storage_location_id:1,condition,quantity});

async function build(db) {
  await db.exec(sql('tests/fixtures/site_scope_base.sql'));
  await db.exec(sql('database/scanner_codes.sql'));
  for (const file of fs.readdirSync(path.join(root,'supabase/migrations')).sort()) {
    await db.exec(sql('supabase/migrations/'+file));
  }
}
async function as(db,id,fn) {
  await db.query("SELECT set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:id,role:'authenticated'})]);
  await db.exec('SET ROLE authenticated');
  try { return await fn(); }
  finally {
    await db.exec('RESET ROLE');
    await db.query("SELECT set_config('request.jwt.claims','',false)");
  }
}
(async () => {
  const source=await PGlite.create(), target=await PGlite.create();
  const changes=(entries,update)=>source.query('SELECT public.bulk_edit_inventory($1,$2) AS changed',[entries,update]);
  const conditions=async()=> (await source.query('SELECT id,condition,status,note FROM public.assets ORDER BY id')).rows;
  try {
    await build(source); await build(target);
    await source.exec(`
      INSERT INTO auth.users(id,email) VALUES ('${admin}','a@example.test'),('${editor}','e@example.test'),('${viewer}','v@example.test');
      INSERT INTO public.organizations(id,name) VALUES (1,'Test');
      INSERT INTO public.sites(id,organization_id,name) VALUES (1,1,'Basel'),(2,1,'Versteckt');
      INSERT INTO public.departments(id,site_id,organization_id,name) VALUES (1,1,1,'IT'),(2,2,1,'IT');
      INSERT INTO public.storage_locations(id,site_id,department_id,name) VALUES (1,1,1,'Lager'),(2,2,2,'Lager');
      INSERT INTO public.employees(id,first_name,last_name,email,department_id,auth_user_id,app_role) VALUES
        (1,'A','Test','a@example.test',1,'${admin}','admin'),(2,'E','Test','e@example.test',1,'${editor}','user'),(3,'V','Test','v@example.test',1,'${viewer}','viewer');
      INSERT INTO public.manufacturers(id,name) VALUES (1,'Test');
      INSERT INTO public.product_categories(id,code,name,inventory_group) VALUES (1,'test','Test','device');
      INSERT INTO public.product_models(id,manufacturer_id,category_id,name,tracking_mode) VALUES
        (1,1,1,'Gerät','serialized'),(2,1,1,'Material','quantity');
      INSERT INTO public.assets(id,product_model_id,asset_tag,condition,status,note,purchase_date) VALUES
        (1,1,'A-1','used','available','Erste Notiz','2026-01-01'),(2,1,'A-2','new','in_use','Zweite Notiz','2026-01-01'),
        (3,1,'A-3','new','available',NULL,'2026-01-01');
      INSERT INTO public.asset_locations(asset_id,storage_location_id) VALUES (1,1),(2,1),(3,2);
      INSERT INTO public.stock_movements(product_model_id,to_storage_location_id,to_condition,quantity,movement_type,department_id)
      VALUES (2,1,'used',5,'receipt',1),(2,1,'new',2,'receipt',1);
    `);
    await as(source,admin,async()=>{
      await source.query('SELECT public.set_employee_site_access(2,ARRAY[1]::bigint[])');
      await source.query('SELECT public.set_employee_site_access(3,ARRAY[1]::bigint[])');
      await source.query('SELECT public.set_inventory_image($1,$2)',['asset:3','aW1hZ2U=']);
      await source.query('SELECT public.archive_inventory_items($1,$2)',[['asset:3'],{reason:'lost'}]);
    });
    await as(source,editor,async()=>{
      await assert.rejects(()=>source.query('SELECT public.create_inventory_backup()'),/Administrator/);
      await assert.rejects(()=>source.query('SELECT private.inventory_backup_data()'),/permission denied/);
      await assert.rejects(()=>changes([asset(1),asset(3)],{condition:'worn'}),/nicht mehr verfügbar/);
      await assert.rejects(()=>changes([asset(1),stock('used',4)],{condition:'worn'}),/inzwischen geändert/);
      assert.deepEqual((await conditions()).map(x=>x.condition),['used','new']);
      assert.equal((await changes([asset(1),asset(2)],{status:'defective'})).rows[0].changed,2);
      assert.deepEqual((await conditions()).map(x=>x.note),['Erste Notiz','Zweite Notiz']);
      assert.equal((await changes([asset(1),stock('used',5),stock('new',2)],{condition:'new'})).rows[0].changed,2);
      const amounts=(await source.query('SELECT condition,quantity FROM public.stock_levels WHERE product_model_id=2 ORDER BY condition')).rows;
      assert.deepEqual(amounts.map(x=>[x.condition,Number(x.quantity)]),[['new',7],['used',0]]);
      const movement=(await source.query("SELECT quantity,from_condition,to_condition FROM public.stock_movements WHERE movement_type='condition_change'")).rows[0];
      assert.deepEqual([Number(movement.quantity),movement.from_condition,movement.to_condition],[5,'used','new']);
    });
    await as(source,viewer,async()=>{await assert.rejects(()=>changes([asset(1),asset(2)],{condition:'worn'}),/Bearbeitungsberechtigung/);});
    const snapshot=await as(source,admin,async()=>(await source.query('SELECT public.create_inventory_backup() AS backup')).rows[0].backup);
    assert.equal(snapshot.format,'ITAssetFlow-Backup');
    assert.equal(snapshot.tables.assets.length,3);
    assert.equal(snapshot.tables.inventory_archive.length,1);
    assert.equal(snapshot.tables.inventory_images.length,1);
    assert.ok(snapshot.tables.audit_log.length>0);
    await as(source,admin,async()=>{await assert.rejects(()=>source.query('SELECT private.restore_inventory_backup($1,false)',[snapshot]),/permission denied/);});
    const bad=structuredClone(snapshot);
    bad.tables.assets[0].product_model_id=9999;
    await assert.rejects(()=>target.query('SELECT private.restore_inventory_backup($1,false)',[bad]),/foreign key constraint/);
    assert.equal((await target.query('SELECT id FROM public.organizations')).rows.length,0);
    await target.query('SELECT private.restore_inventory_backup($1,false)',[snapshot]);
    const recovered=(await target.query('SELECT private.inventory_backup_data() AS backup')).rows[0].backup;
    for (const table of Object.keys(snapshot.tables)) {
      const expected=structuredClone(snapshot.tables[table]);
      if (table==='employees') expected.forEach(row=>row.auth_user_id=null);
      const normalize=rows=>rows.map(row=>JSON.stringify(row)).sort();
      assert.deepEqual(normalize(recovered.tables[table]),normalize(expected),table);
    }
    await assert.rejects(()=>target.query('SELECT private.restore_inventory_backup($1,false)',[snapshot]),/ist nicht leer/);
    assert.equal((await target.query('INSERT INTO public.manufacturers(name) VALUES ($1) RETURNING id',['Neu'])).rows[0].id,2);
    console.log('PASS: Sammeländerung, Lagerbuchung und Standortgrenzen; Backup inklusive Archiv, Bildern und Historie wiederhergestellt; Rollback bei Fehlern.');
  } finally { await source.close(); await target.close(); }
})().catch(error=>{ console.error(error); process.exitCode=1; });
