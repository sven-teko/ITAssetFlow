/* Echter PostgreSQL-Test in PGlite, ausschliesslich mit lokalen Testdaten. */
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
const {PGlite}=require(process.env.PGLITE_MODULE || '@electric-sql/pglite');
const root=path.resolve(__dirname,'..'),python=process.env.PYTHON_EXECUTABLE || 'python3';
const env={...process.env,PYTHONPATH:path.join(root,'src')};
const tables=JSON.parse(execFileSync(python,['-c','import json; from infrastructure.data_transfer_service import TABLE_ORDER; print(json.dumps(TABLE_ORDER))'],{env,encoding:'utf8'}));
const admin='00000000-0000-0000-0000-000000000001',editor='00000000-0000-0000-0000-000000000002';
const claims=id=>JSON.stringify({sub:id,role:'authenticated'});
const run=(async()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'itassetflow-export-test-'));
 const source=await PGlite.create(),target=await PGlite.create();
 try{
  for(const db of [source,target]){
   await db.exec(fs.readFileSync(path.join(__dirname,'fixtures/site_scope_base.sql'),'utf8'));
   await db.exec(fs.readFileSync(path.join(root,'database/scanner_codes.sql'),'utf8'));
   await db.exec(fs.readFileSync(path.join(root,'supabase/migrations/20261029093456_site_permissions.sql'),'utf8'));
   await db.exec(`INSERT INTO auth.users(id,email) VALUES('${admin}','admin@example.test'),('${editor}','editor@example.test');`);
  }
  await source.exec(`
   INSERT INTO public.organizations(id,name) VALUES(1,'Testbetrieb');
   INSERT INTO public.sites(id,name,organization_id) VALUES(1,'Sichtbar',1),(2,'VERBORGENER-STANDORT',1);
   INSERT INTO public.departments(id,name,organization_id,site_id) VALUES(10,'IT',1,1),(20,'VERBORGENE-ABTEILUNG',1,2);
   INSERT INTO public.storage_locations(id,name,site_id,department_id) VALUES(22,'Übergeordnet',1,10),(33,'VERBORGENES-LAGER',2,20);
   INSERT INTO public.storage_locations(id,name,site_id,department_id,parent_location_id) VALUES(11,'Untergeordnet',1,10,22);
   INSERT INTO public.employees(id,first_name,last_name,email,department_id,auth_user_id,app_role) VALUES
    (1,'Test','Admin','admin@example.test',10,'${admin}','admin'),(2,'Test','Editor','editor@example.test',10,'${editor}','user');
   INSERT INTO public.manufacturers(id,name) VALUES(1,'Test');
   INSERT INTO public.product_categories(id,name,code,inventory_group) VALUES(1,'Test','test','device');
   INSERT INTO public.product_models(id,name,category_id,manufacturer_id,tracking_mode,specifications) VALUES(100,'Gerät',1,1,'serialized','{"ram":32}'),(101,'Material',1,1,'quantity','{}');
   INSERT INTO public.assets(id,product_model_id,asset_tag,purchase_date,qr_code,ean) VALUES(10,100,'PC-001','2026-10-29','SER-0001','0012345678905'),(20,100,'VERBORGENES-GERAET','2026-10-29',NULL,NULL);
   INSERT INTO public.asset_locations(asset_id,storage_location_id) VALUES(10,11),(20,33);
   INSERT INTO public.asset_assignments(asset_id,employee_id,department_id) VALUES(10,2,NULL);
   INSERT INTO public.stock_movements(product_model_id,to_storage_location_id,to_condition,quantity,movement_type,department_id) VALUES(101,11,'used',5,'receipt',10);
   INSERT INTO public.stock_counts(product_model_id,storage_location_id,counted_quantity,counted_by_employee_id,condition,expected_quantity) VALUES(101,11,4,1,'used',5);
  `);
  await source.query('UPDATE public.assets SET note=$1 WHERE id=10',["ÄÖÜ; O'Reilly \\ Netzwerk\nNeue Zeile"]);
  await source.query("SELECT set_config('request.jwt.claims',$1,false)",[claims(admin)]);
  await source.exec('SELECT public.set_employee_site_access(2,ARRAY[1]::bigint[])');
  await source.query("SELECT set_config('request.jwt.claims','',false)");

  async function snapshot(db){const result={};for(const table of tables)result[table]=(await db.query(`SELECT * FROM public.${table}`)).rows;return result;}
  function exportFiles(data,prefix){
   const input=path.join(directory,prefix+'.json'),output=path.join(directory,prefix);
   fs.writeFileSync(input,JSON.stringify(data));
   execFileSync(python,['-c',`import json,sys; from pathlib import Path
sys.path.insert(0,${JSON.stringify(path.join(root,'tests'))})
from test_data_transfer import ExportClient
from infrastructure.data_transfer_service import DataTransferService
service=DataTransferService(ExportClient(json.loads(Path(sys.argv[1]).read_text())))
service.export_csv(sys.argv[2]+'.csv'); service.export_postgresql(sys.argv[2]+'.sql')`,input,output],{env});
   return output;
  }
  const all=await snapshot(source),full=exportFiles(all,'full');
  const sql=fs.readFileSync(full+'.sql','utf8');
  await target.exec(sql);
  await target.exec(sql);
  assert.equal(Number((await target.query('SELECT count(*) n FROM public.assets')).rows[0].n),2);
  assert.equal((await target.query('SELECT parent_location_id FROM public.storage_locations WHERE id=11')).rows[0].parent_location_id,22);
  assert.equal((await target.query('SELECT note,ean FROM public.assets WHERE id=10')).rows[0].note,all.assets.find(row=>row.id===10).note);
  assert.equal((await target.query('SELECT ean FROM public.assets WHERE id=10')).rows[0].ean,'0012345678905');
  const count=(await target.query('SELECT expected_quantity,counted_quantity,difference_quantity,adjustment_movement_id FROM public.stock_counts')).rows[0];
  assert.equal(Number(count.expected_quantity),5);assert.equal(Number(count.counted_quantity),4);assert.equal(Number(count.difference_quantity),-1);
  assert.equal(Number((await target.query('SELECT quantity FROM public.stock_levels WHERE product_model_id=101 AND storage_location_id=11')).rows[0].quantity),4);
  assert.equal(Number((await target.query('SELECT count(*) n FROM public.stock_movements')).rows[0].n),2);
  assert.equal((await target.query("SELECT tgenabled FROM pg_trigger WHERE tgname='stock_counts_prepare_trg'")).rows[0].tgenabled,'O');
  console.log('PASS: SQL in leerer Datenbank ausführbar und wiederholbar; Hierarchie, JSON, Texte, EAN und historische Lagerzählung bleiben korrekt');

  await source.query("SELECT set_config('request.jwt.claims',$1,false)",[claims(editor)]);
  await source.exec('SET ROLE authenticated');
  const scoped=await snapshot(source);
  await source.exec('RESET ROLE');
  const limited=exportFiles(scoped,'limited');
  for(const format of ['csv','sql'])assert.ok(!fs.readFileSync(limited+'.'+format,'utf8').includes('VERBORGEN'));
  assert.deepEqual(scoped.assets.map(row=>row.id),[10]);assert.deepEqual(scoped.sites.map(row=>row.id),[1]);
  console.log('PASS: Beide Exportformate enthalten ausschliesslich die durch echte Standort-RLS sichtbaren Datensätze');
 }finally{await source.close();await target.close();fs.rmSync(directory,{recursive:true,force:true});}
})();
run.catch(error=>{console.error(error.message);process.exitCode=1;});
module.exports=run;
