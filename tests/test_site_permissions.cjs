/* Isolated PostgreSQL/RLS integration test. Install @electric-sql/pglite for tests,
   or set PGLITE_MODULE to an existing installation. No external database is used. */
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {PGlite}=require(process.env.PGLITE_MODULE || require.resolve('@electric-sql/pglite',{paths:[path.resolve(__dirname,'../web')]}));
const users={admin:'00000000-0000-0000-0000-000000000001',editor:'00000000-0000-0000-0000-000000000002',viewer:'00000000-0000-0000-0000-000000000003'};
const run=(async()=>{
 const db=await PGlite.create();
 const query=async(sql,args)=>{try{return (await db.query(sql,args)).rows;}catch(e){e.testSql=sql;throw e;}};
 const ids=async sql=>(await query(sql)).map(r=>Number(r.id));
 const rejected=async(sql,code='42501')=>{await assert.rejects(db.query(sql),e=>e.code===code);};
 const asUser=async(role,work)=>{
   await db.query("SELECT set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:users[role],role:'authenticated'})]);
   await db.exec('SET ROLE authenticated');
   try{assert.equal((await query('SELECT current_user'))[0].current_user,'authenticated');await work();}
   finally{await db.exec('RESET ROLE');await db.query("SELECT set_config('request.jwt.claims','',false)");}
 };
 try {
  await db.exec(fs.readFileSync(path.join(__dirname,'fixtures/site_scope_base.sql'),'utf8'));
  await db.exec(`
   INSERT INTO auth.users(id,email) VALUES ('${users.admin}','admin@example.test'),('${users.editor}','editor@example.test'),('${users.viewer}','viewer@example.test');
   INSERT INTO public.organizations(id,name) VALUES(1,'Test organization');
   INSERT INTO public.sites(id,name,organization_id) VALUES(1,'Basel',1),(2,'Büro Allschwil',1);
   INSERT INTO public.departments(id,name,organization_id,site_id) VALUES(10,'IT Basel',1,1),(20,'IT Allschwil',1,2);
   INSERT INTO public.storage_locations(id,name,site_id,department_id) VALUES(11,'Lager Basel',1,10),(22,'Lager Allschwil',2,20);
   INSERT INTO public.employees(id,first_name,last_name,email,department_id,auth_user_id,app_role) VALUES
    (1,'Test','Admin','admin@example.test',10,'${users.admin}','admin'),(2,'Test','Editor','editor@example.test',10,'${users.editor}','user'),(3,'Test','Viewer','viewer@example.test',20,'${users.viewer}','viewer');
   INSERT INTO public.manufacturers(id,name) VALUES(1,'Test');
   INSERT INTO public.product_categories(id,name,code,inventory_group) VALUES(1,'Test category','test','device');
   INSERT INTO public.product_models(id,name,category_id,manufacturer_id,tracking_mode) VALUES(100,'Test device',1,1,'serialized'),(101,'Test material',1,1,'quantity');
   INSERT INTO public.assets(id,product_model_id,asset_tag,purchase_date) VALUES(10,100,'BASEL-10','2026-01-01'),(20,100,'ALLSCHWIL-20','2026-01-01');
   INSERT INTO public.asset_locations(id,asset_id,storage_location_id) VALUES(10,10,11),(20,20,22);
   INSERT INTO public.stock_movements(id,product_model_id,to_storage_location_id,to_condition,quantity,movement_type,department_id) VALUES(1,101,22,'new',10,'receipt',20);
   INSERT INTO public.stock_movements(id,product_model_id,from_storage_location_id,to_storage_location_id,from_condition,to_condition,quantity,movement_type,department_id) VALUES(2,101,22,11,'new','new',3,'transfer',10);
  `);
  const migrations=path.join(__dirname,'../supabase/migrations');
  const migration=fs.readFileSync(path.join(migrations,fs.readdirSync(migrations).find(f=>f.endsWith('_site_permissions.sql'))),'utf8');
  await db.exec(migration);
  assert.equal(Number((await query('SELECT count(*) n FROM public.employee_site_access'))[0].n),6);
  await asUser('admin',async()=>{
    await query('SELECT public.set_employee_site_access(2,ARRAY[1]::bigint[])');
    await query('SELECT public.set_employee_site_access(3,ARRAY[]::bigint[])');
    await rejected('SELECT public.set_employee_site_access(2,ARRAY[999]::bigint[])','P0001');
    assert.deepEqual(await ids('SELECT site_id AS id FROM public.employee_site_access WHERE employee_id=2'),[1]);
  });
  console.log('PASS: Existing rights seeded once; permission replacement is atomic; invalid sites rejected');
  await db.exec("INSERT INTO public.sites(id,name,organization_id) VALUES(3,'New site',1)");
  await asUser('editor',async()=>{
    assert.deepEqual(await ids('SELECT id FROM public.sites ORDER BY id'),[1]);
    assert.deepEqual(await ids('SELECT id FROM public.departments ORDER BY id'),[10]);
    assert.deepEqual(await ids('SELECT id FROM public.storage_locations ORDER BY id'),[11]);
    assert.deepEqual(await ids('SELECT id FROM public.assets ORDER BY id'),[10]);
    assert.deepEqual(await ids('SELECT id FROM public.asset_locations ORDER BY id'),[10]);
    assert.equal((await query('SELECT app_role FROM public.employees WHERE auth_user_id=auth.uid()'))[0].app_role,'user');
    assert.deepEqual(await ids('UPDATE public.assets SET note=\'forbidden\' WHERE id=20 RETURNING id'),[]);
    await rejected('SELECT public.delete_scoped_asset(20)');
    await rejected('SELECT public.set_employee_site_access(2,ARRAY[1,2]::bigint[])');
    await rejected('INSERT INTO public.employee_site_access(employee_id,site_id) VALUES(2,2)');
    assert.deepEqual(await ids("UPDATE public.employees SET app_role='admin' WHERE id=2 RETURNING id"),[]);
    const balance=await query('SELECT * FROM public.stock_levels');
    assert.equal(balance.length,1);assert.equal(Number(balance[0].storage_location_id),11);assert.equal(Number(balance[0].quantity),3);
    assert.equal((await query('SELECT * FROM public.stock_movements')).length,0);
    await query("INSERT INTO public.stock_movements(id,product_model_id,from_storage_location_id,from_condition,quantity,movement_type,department_id) VALUES(3,101,11,'new',2,'issue',10)");
    assert.equal(Number((await query('SELECT quantity FROM public.stock_levels WHERE storage_location_id=11'))[0].quantity),1);
    await rejected("INSERT INTO public.stock_movements(id,product_model_id,from_storage_location_id,from_condition,quantity,movement_type,department_id) VALUES(4,101,11,'new',2,'issue',10)",'P0001');
    await rejected("INSERT INTO public.stock_movements(id,product_model_id,to_storage_location_id,to_condition,quantity,movement_type,department_id) VALUES(5,101,22,'new',1,'receipt',20)");
    assert.deepEqual(await ids("INSERT INTO public.assets(id,product_model_id,asset_tag,purchase_date) VALUES(30,100,'NEW-30','2026-01-01') RETURNING id"),[30]);
    await query('INSERT INTO public.asset_locations(id,asset_id,storage_location_id) VALUES(30,30,11)');
    await rejected('UPDATE public.assets SET last_storage_location_id=22 WHERE id=30');
    await rejected(`UPDATE public.assets SET created_by_auth_user_id='${users.viewer}' WHERE id=30`);
    await rejected('INSERT INTO public.asset_locations(id,asset_id,storage_location_id) VALUES(31,30,22)');
    assert.equal((await query('SELECT public.delete_scoped_asset(10) deleted'))[0].deleted,true);
    assert.equal((await query('SELECT public.delete_scoped_asset(30) deleted'))[0].deleted,true);
  });
  console.log('PASS: RLS hides sites/devices/relations, denies forged IDs and self-grants, preserves transfer balances, prevents negative stock, supports create/delete');
  await db.exec("INSERT INTO public.departments(id,name,organization_id,site_id) VALUES(30,'New department',1,3); INSERT INTO public.storage_locations(id,name,site_id,department_id) VALUES(33,'New storage',3,30)");
  await asUser('admin',async()=>{await query('SELECT public.set_employee_site_access(2,ARRAY[1,3]::bigint[])');});
  await asUser('editor',async()=>{
    await query("INSERT INTO public.assets(id,product_model_id,asset_tag,purchase_date) VALUES(50,100,'MOVE-50','2026-01-01')");
    await query('INSERT INTO public.asset_locations(id,asset_id,storage_location_id) VALUES(50,50,11)');
    await query('UPDATE public.asset_locations SET valid_to=clock_timestamp() WHERE id=50');
    await query('INSERT INTO public.asset_locations(id,asset_id,storage_location_id) VALUES(51,50,33) RETURNING id');
    assert.equal(Number((await query('SELECT last_storage_location_id FROM public.assets WHERE id=50'))[0].last_storage_location_id),33);
  });
  await asUser('admin',async()=>{await query('SELECT public.set_employee_site_access(2,ARRAY[3]::bigint[])');});
  await asUser('editor',async()=>{
    assert.deepEqual(await ids('SELECT id FROM public.assets ORDER BY id'),[50]);
    assert.equal((await query('SELECT public.delete_scoped_asset(50) deleted'))[0].deleted,true);
  });
  await asUser('admin',async()=>{await query('SELECT public.set_employee_site_access(2,ARRAY[1]::bigint[])');});
  console.log('PASS: Device moves remain possible; site anchor tracks location; access changes apply without JWT refresh');
  await asUser('viewer',async()=>{
    for(const table of ['sites','departments','storage_locations','assets','asset_locations','stock_levels','stock_movements'])assert.equal((await query('SELECT * FROM public.'+table)).length,0,table);
    assert.equal((await query('SELECT app_role FROM public.employees WHERE auth_user_id=auth.uid()'))[0].app_role,'viewer');
    await rejected('SELECT public.set_employee_site_access(3,ARRAY[1]::bigint[])');
    await rejected('SELECT public.delete_scoped_asset(20)');
    await rejected("INSERT INTO public.assets(id,product_model_id,asset_tag) VALUES(40,100,'NO-ACCESS')");
  });
  console.log('PASS: Empty selection reveals no site inventory; own login remains valid; viewer cannot write');
  await asUser('admin',async()=>{
    await query('SELECT public.set_employee_site_access(1,ARRAY[]::bigint[])');
    assert.deepEqual(await ids('SELECT id FROM public.sites ORDER BY id'),[1,2,3]);
    assert.deepEqual(await ids('SELECT id FROM public.assets ORDER BY id'),[20]);
  });
  for(const fn of ['public.set_employee_site_access(bigint,bigint[])','public.delete_scoped_asset(bigint)','private.scoped_stock_levels()'])
    assert.equal((await query('SELECT has_function_privilege(\'anon\',$1,\'EXECUTE\') granted',[fn]))[0].granted,false);
  await db.exec(migration);
  assert.deepEqual(await ids('SELECT site_id AS id FROM public.employee_site_access WHERE employee_id=2'),[1]);
  assert.equal((await query('SELECT * FROM public.employee_site_access WHERE employee_id=3')).length,0);
  console.log('PASS: Administrator access retained, anonymous RPC blocked, rerun does not re-grant excluded sites');
 }finally{await db.close();}
})();
run.catch(e=>{console.error({message:e.message,code:e.code,detail:e.detail,where:e.where,testSql:e.testSql,stack:e.stack?.split('\n').slice(0,5).join('\n')});process.exitCode=1;});
module.exports=run;
