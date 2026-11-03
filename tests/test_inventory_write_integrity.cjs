/* PostgreSQL integration: transaction boundaries, direct grants and site scope. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {randomUUID} = require("node:crypto");
const {PGlite} = require(process.env.PGLITE_MODULE || "@electric-sql/pglite");

(async () => {
  const db = await PGlite.create();
  const q = async (sql, args) => (await db.query(sql, args)).rows;
  const seed = async name => db.exec(fs.readFileSync(path.join(__dirname, "..", name), "utf8"));
  const users = {admin:randomUUID(), editor:randomUUID(), viewer:randomUUID()};
  const as = async (role, work) => {
    await q("SELECT set_config('request.jwt.claims',$1,false)", [JSON.stringify({sub:users[role],role:"authenticated"})]);
    await db.exec("SET ROLE authenticated");
    try { await work(); } finally { await db.exec("RESET ROLE"); }
  };
  const fails = (fn,code,detail) => assert.rejects(fn, e => e.code===code && (detail===undefined || Number(e.detail)===detail));
  const save = async (data, editing=false) => (await q("SELECT public.save_inventory_entry($1,$2) result",[data,editing]))[0].result;
  const move = async (key,destination,quantity,expected,location=null,id=randomUUID()) =>
    (await q("SELECT public.move_inventory_entry($1,$2,$3,$4,$5,$6,$7) result",[key,destination,id,quantity,expected,location,"Test-Umlagerung"]))[0].result;
  const level = async id => Number((await q("SELECT quantity FROM public.stock_levels WHERE product_model_id=101 AND storage_location_id=$1 AND condition='used'",[id]))[0]?.quantity||0);
  try {
    await seed("tests/fixtures/site_scope_base.sql");
    await seed("database/scanner_codes.sql");
    await db.exec(`INSERT INTO auth.users(id,email) VALUES ${Object.entries(users).map(([role,id])=>`('${id}','${role}@example.test')`).join(",")};
      INSERT INTO public.organizations(id,name) VALUES (1,'Test');
      INSERT INTO public.sites(id,name,organization_id) VALUES (1,'Basel',1),(2,'Allschwil',1),(3,'Verborgener Standort',1);
      INSERT INTO public.departments(id,name,site_id,organization_id) VALUES (10,'IT',1,1),(20,'IT',2,1),(30,'IT',3,1);
      INSERT INTO public.storage_locations(id,name,site_id,department_id) VALUES (11,'Lager',1,10),(12,'Regal',1,10),(22,'Lager',2,20),(33,'Lager',3,30);
      INSERT INTO public.employees(id,first_name,last_name,email,department_id,auth_user_id,app_role)
        VALUES (1,'Test','Admin','admin@example.test',10,'${users.admin}','admin'),(2,'Test','Editor','editor@example.test',10,'${users.editor}','user'),
        (3,'Test','Viewer','viewer@example.test',10,'${users.viewer}','viewer'),(4,'Test','Unzulässig',NULL,10,NULL,'viewer');
      INSERT INTO public.manufacturers(id,name) VALUES (20,'Test');
      INSERT INTO public.product_categories(id,name,code,inventory_group) VALUES (20,'Gerät','device','device');
      INSERT INTO public.product_models(id,name,category_id,manufacturer_id,tracking_mode) VALUES (100,'Notebook',20,20,'serialized'),(101,'Router',20,20,'quantity');
      INSERT INTO public.assets(id,product_model_id,asset_tag,purchase_date) VALUES (10,100,'PC-10','2026-01-01'),(30,100,'VERBORGEN','2026-01-01');
      INSERT INTO public.asset_locations(asset_id,storage_location_id) VALUES (10,11),(30,33);
      INSERT INTO public.asset_assignments(asset_id,department_id) VALUES (10,10);
      ALTER TABLE public.asset_assignments ADD CONSTRAINT test_refuse_employee CHECK(employee_id IS DISTINCT FROM 4);
      INSERT INTO public.stock_movements(product_model_id,to_storage_location_id,to_condition,quantity,movement_type,department_id,purchase_date)
        VALUES(101,11,'used',10,'receipt',10,'2026-01-01');`);
    for (const f of ["20261029093456_site_permissions","20261102145032_inventory_archive_images","20261102153129_stock_outcomes","20261102154643_stock_metadata_notes","20261103075158_archive_permanent_delete","20261103083104_archive_restore","20261103102308_inventory_write_integrity"])
      await seed(`supabase/migrations/${f}.sql`);
    await seed("supabase/migrations/20261103122054_inventory_connections.sql");
    await as("admin", async () => {
      await q("SELECT public.set_employee_site_access(2,ARRAY[1,2]::bigint[])");
      await q("SELECT public.set_employee_site_access(3,ARRAY[1]::bigint[])");
      await q("SELECT public.archive_inventory_items(ARRAY['asset:30'], '{\"reason\":\"lost\"}')");
    });
    const asset = {
      edit:{record_type:"asset",id:10}, model:{mode:"existing",id:100}, entry_type:"asset", condition:"used", storage_location_id:12,
      asset:{asset_tag:"PC-10",purchase_date:"2026-01-01",note:"Neu",mac_address:"AA:BB:CC:11:22:33"},
      assignment:{department_id:10,employee_id:4},
    };
    const stock = {
      edit:{record_type:"stock",product_model_id:101,storage_location_id:11,condition:"used",stock_quantity:10},
      model:{mode:"existing",id:101},condition:"used",storage_location_id:11,
      stock:{department_id:10,quantity:11,purchase_date:"2026-01-01"},
    };
    await as("editor", async () => {
      await fails(() => q("SELECT public.delete_scoped_asset(10)"),"42501");
      await fails(() => q("DELETE FROM public.assets WHERE id=10"),"42501");
      await fails(() => save(asset,true),"23514");
      assert.equal((await q("SELECT note FROM public.assets WHERE id=10"))[0].note,null);
      assert.equal((await q("SELECT storage_location_id FROM public.asset_locations WHERE asset_id=10 AND valid_to IS NULL"))[0].storage_location_id,11);
      const invalidNew={...asset,model:{mode:"new",category_id:20,name:"Roll back",manufacturer_name:"Roll back"},asset:{...asset.asset,asset_tag:"NEW"}};
      await fails(() => save(invalidNew),"23514");
      assert.equal((await q("SELECT id FROM public.product_models WHERE name='Roll back'")).length,0);
      assert.equal((await q("SELECT id FROM public.manufacturers WHERE name='Roll back'")).length,0);
      assert.equal((await q("SELECT id FROM public.assets WHERE asset_tag='NEW'")).length,0);
      const createdRequest=randomUUID();
      const createdPayload={...asset,request_id:createdRequest,asset:{...asset.asset,asset_tag:"NEU-10"},assignment:{department_id:10,employee_id:2}};
      const created=await save(createdPayload);
      assert.deepEqual(await save(createdPayload),created);
      assert.equal((await q("SELECT employee_id FROM public.asset_assignments WHERE asset_id=$1 AND valid_to IS NULL",[created.id]))[0].employee_id,2);
      const accessory = async tag => (await save({...createdPayload, request_id: randomUUID(), asset:{...createdPayload.asset, asset_tag:tag}})).id;
      const display = await accessory("MONITOR");
      const mouse = await accessory("MAUS");
      const connect = async (data, edit) =>
        (await q("SELECT public.save_inventory_entry_with_connections($1,$2) result",[data,edit]))[0].result;
      const connected = {...createdPayload, request_id:randomUUID(), asset:{...createdPayload.asset,asset_tag:"PC-KOMPLETT"},
        connection_changes:{add:[display,mouse],remove:[]}};
      const pc = (await connect(connected,false)).id;
      assert.equal((await connect(connected,false)).id,pc);
      const children = async () => (await q("SELECT child_asset_id FROM public.asset_component_assignments WHERE parent_asset_id=$1 AND removed_at IS NULL ORDER BY child_asset_id",[pc])).map(row=>row.child_asset_id);
      assert.deepEqual(await children(), [display, mouse]);
      await fails(() => connect({...connected, request_id:randomUUID(), edit:{record_type:"asset",id:display},
        asset:{...connected.asset,asset_tag:"MONITOR"}, parent_asset_id:pc, connection_changes:{add:[pc],remove:[]}},true),"P0001");
      await fails(() => connect({...connected, request_id:randomUUID(), edit:{record_type:"asset",id:pc},
        connection_changes:{add:[30],remove:[display]}},true),"42501");
      assert.deepEqual(await children(), [display, mouse]);
      await connect({...connected, request_id:randomUUID(), edit:{record_type:"asset",id:pc},connection_changes:{add:[],remove:[display]}},true);
      assert.deepEqual(await children(), [mouse]);
      assert.equal((await connect(connected,false)).id,pc);
      assert.deepEqual(await children(), [mouse]); // Retry cannot resurrect a removed link.
      const snapshot=(await q("SELECT updated_at::text FROM public.assets WHERE id=10"))[0].updated_at;
      await save({...asset,edit:{...asset.edit,updated_at:snapshot},assignment:{department_id:10,employee_id:2}},true);
      await fails(() => save({...asset,edit:{...asset.edit,updated_at:snapshot},assignment:{department_id:10,employee_id:2}},true),"40001");
      await fails(() => move("asset:10",33,null,null,12),"42501");
      await move("asset:10",22,null,null,12);
      assert.deepEqual((await q("SELECT employee_id,department_id FROM public.asset_assignments WHERE asset_id=10 AND valid_to IS NULL"))[0],{employee_id:null,department_id:20});
      assert.equal((await q("SELECT storage_location_id FROM public.asset_locations WHERE asset_id=10 AND valid_to IS NULL"))[0].storage_location_id,22);
      await save(stock,true);
      await fails(() => save({...stock,scanner_codes:{qr_code:"NICHT-AENDERN"}},true),"40001",11);
      assert.equal((await q("SELECT qr_code FROM public.product_models WHERE id=101"))[0].qr_code,null);
      assert.equal(await level(11),11);
      await fails(() => move("stock:101:11:used",33,3,11),"42501");
      await fails(() => move("stock:101:11:used",22,3,10),"40001",11);
      const id=randomUUID(), result=await move("stock:101:11:used",22,3,11,null,id);
      assert.deepEqual(await move("stock:101:11:used",22,3,11,null,id),result);
      assert.equal(await level(11),8);
      assert.equal(await level(22),3);
      assert.deepEqual((await q("SELECT movement_type,performed_by_employee_id FROM public.stock_movements WHERE id=$1",[result.movement_id]))[0],
        {movement_type:"transfer",performed_by_employee_id:2});
      await fails(() => q("SELECT public.book_inventory_stock($1,101,11,'used',1,'add','{}',11)",[randomUUID()]),"40001",8);
      await q("SELECT public.book_inventory_stock($1,101,11,'used',1,'add','{}',8)",[randomUUID()]);
      assert.equal(await level(11),9);
      await q("SELECT public.archive_inventory_items(ARRAY['asset:10'], '{\"reason\":\"lost\"}')");
      assert.equal((await q("SELECT public.search_inventory_archive(0,'aabbcc112233','Allschwil','lost',current_date,current_date) result"))[0].result.total,1);
      assert.equal((await q("SELECT public.search_inventory_archive(0,'','Verborgener','lost',NULL,NULL) result"))[0].result.total,0);
      assert.equal((await q("SELECT public.search_inventory_archive(0,'','Allschwil','customer',NULL,NULL) result"))[0].result.total,0);
    });
    await as("viewer", async () => {
      await fails(() => save(stock,true),"42501");
      await fails(() => move("stock:101:11:used",12,1,9),"42501");
      assert.equal((await q("SELECT public.search_inventory_archive(0,'','','',NULL,NULL) result"))[0].result.total,0);
    });
    console.log("PASS: Archivzwang, Rollback von Artikel/Stammdaten/Zuweisungen, veraltete Buchungen, Teilumlagerung, Wiederholung und standortgeschützte Suche.");
  } finally { await db.close(); }
})().catch(error => { console.error(error);process.exitCode=1; });
