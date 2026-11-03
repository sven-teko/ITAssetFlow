const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require(process.env.PGLITE_MODULE || '@electric-sql/pglite');

const root = path.resolve(__dirname, '..');
const admin = '00000000-0000-0000-0000-000000000001';
const editor = '00000000-0000-0000-0000-000000000002';
const viewer = '00000000-0000-0000-0000-000000000003';
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

(async () => {
  const db = await PGlite.create();
  const get = async sub => {
    await db.query("SELECT set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub, role: 'authenticated' })]);
    await db.exec('SET ROLE authenticated');
    try { return (await db.query('SELECT public.inventory_dashboard() AS result')).rows[0].result; }
    finally {
      await db.exec('RESET ROLE');
      await db.query("SELECT set_config('request.jwt.claims','',false)");
    }
  };
  try {
    await db.exec(read('tests/fixtures/site_scope_base.sql'));
    await db.exec(read('database/scanner_codes.sql'));
    for (const file of fs.readdirSync(path.join(root, 'supabase/migrations')).sort()) {
      await db.exec(read('supabase/migrations/' + file));
    }
    await db.exec(`
      INSERT INTO auth.users(id,email) VALUES ('${admin}','a@example.test'),('${editor}','e@example.test'),('${viewer}','v@example.test');
      INSERT INTO public.organizations(id,name) VALUES (1,'Test');
      INSERT INTO public.sites(id,organization_id,name) VALUES (1,1,'Basel'),(2,1,'Versteckt'),(3,1,'Leer');
      INSERT INTO public.departments(id,site_id,organization_id,name) VALUES (1,1,1,'IT'),(2,2,1,'IT');
      INSERT INTO public.storage_locations(id,site_id,department_id,name) VALUES (1,1,1,'Lager'),(2,2,2,'Lager');
      INSERT INTO public.employees(id,first_name,last_name,email,auth_user_id,app_role) VALUES
        (1,'Test','Admin','a@example.test','${admin}','admin'),(2,'Test','Editor','e@example.test','${editor}','user'),
        (3,'Test','Viewer','v@example.test','${viewer}','viewer');
      INSERT INTO public.employee_site_access(employee_id,site_id) VALUES (2,1);
      INSERT INTO public.manufacturers(id,name) VALUES (1,'Test');
      INSERT INTO public.product_categories(id,name,code,inventory_group) VALUES (1,'Hardware','hardware','device');
      INSERT INTO public.product_models(id,name,category_id,manufacturer_id,tracking_mode)
        VALUES (1,'Laptop',1,1,'serialized'),(2,'Kabel',1,1,'quantity'),(3,'Adapter',1,1,'quantity');
      INSERT INTO public.assets(id,product_model_id,asset_tag,new_price,purchase_date,status)
        VALUES (1,1,'A-1',320,'2026-01-01','in_use'),(2,1,'A-2',NULL,'2026-01-01','in_repair'),
               (3,1,'A-3',9999,'2026-01-01','available'),(4,1,'A-4',10,'2026-01-01','available');
      INSERT INTO public.asset_locations(asset_id,storage_location_id,valid_from,valid_to) VALUES
        (1,1,'2026-01-01',NULL),(2,1,'2026-01-01',NULL),(3,2,'2026-01-01',NULL),
        (4,1,'2026-01-01','2090-01-10T10:00Z'),(4,2,'2090-01-10T10:00Z',NULL);
      INSERT INTO public.stock_movements(product_model_id,to_storage_location_id,to_condition,quantity,movement_type,purchase_date,new_price,recorded_at)
        VALUES (2,2,'new',9,'receipt','2026-01-01',11,'2090-01-01T10:00Z'),
               (3,1,'new',1,'receipt',NULL,0,'2090-01-02T10:00Z');
      INSERT INTO public.stock_movements(product_model_id,from_storage_location_id,from_condition,to_storage_location_id,to_condition,
                                         quantity,movement_type,purchase_date,new_price,recorded_at)
        VALUES (2,2,'new',1,'new',4,'transfer','2026-01-01',11,'2090-01-03T10:00Z'),
               (3,1,'new',NULL,NULL,1,'issue',NULL,0,'2090-01-09T10:00Z');
      INSERT INTO public.stock_targets(product_model_id,storage_location_id,minimum_quantity) VALUES (3,1,2),(2,2,8);
      INSERT INTO public.inventory_archive(source_key,record_type,label,site_id,snapshot,reason,archived_at,archived_by_name)
        VALUES ('asset:99','asset','Test',2,'{}','lost','2090-01-12T11:00Z','Test');
    `);
    const { sites: all } = await get(admin);
    const { sites: limited, review_items: review, review_after_days: days } = await get(editor);
    assert.equal(limited.length, 1);
    const basel = limited[0];
    assert.equal(basel.name, 'Basel');
    assert.equal(basel.assets, 2);
    assert.equal(basel.in_use, 1);
    assert.equal(basel.attention, 1);
    assert.equal(basel.stock_positions, 1);
    assert.equal(basel.known_value, 364);
    assert.equal(basel.missing_prices, 1);
    assert.equal(basel.low_stock, 1);
    assert.equal(new Date(basel.changed_at).toISOString(), '2090-01-10T10:00:00.000Z');
    assert.equal(basel.latest_item, null); // The asset has moved to an inaccessible site.
    assert.deepEqual(all.find(row => row.site_id === '1'), { ...basel, latest_item: 'Laptop · A-4' });
    assert.equal(all.find(row => row.site_id === '2').known_value, 10064);
    assert.equal(new Date(all.find(row => row.site_id === '2').changed_at).toISOString(), '2090-01-12T11:00:00.000Z');
    assert.equal(all.find(row => row.site_id === '2').latest_item, 'Test');
    assert.equal(all.find(row => row.site_id === '3').changed_at, null);
    assert.equal(days, 180);
    assert.deepEqual(review.map(item => [item.asset_tag, item.issue, item.stale]), [['A-2', 'in_repair', false]]);
    const denied = await get(viewer);
    assert.deepEqual(denied.sites, []);
    assert.deepEqual(denied.review_items, []);

    // A subsequent withdrawal can empty a bucket and still advance the site's date.
    await db.exec(`INSERT INTO public.stock_movements(product_model_id,from_storage_location_id,from_condition,quantity,movement_type,recorded_at)
      VALUES (2,1,'new',4,'issue','2090-01-13T12:00Z');`);
    const { sites: [after] } = await get(editor);
    assert.equal(after.stock_positions, 0);
    assert.equal(after.known_value, 320);
    assert.equal(new Date(after.changed_at).toISOString(), '2090-01-13T12:00:00.000Z');
    assert.equal(after.latest_item, 'Kabel');
    await db.exec(`INSERT INTO public.stock_counts(product_model_id,storage_location_id,condition,expected_quantity,counted_quantity,counted_by_employee_id,counted_at)
      VALUES (2,1,'new',0,0,2,'2090-01-14T12:00Z');`);
    assert.equal(new Date((await get(editor)).sites[0].changed_at).toISOString(), '2090-01-14T12:00:00.000Z');
    await db.exec(`INSERT INTO public.stock_movements(product_model_id,to_storage_location_id,to_condition,quantity,movement_type,purchase_date,new_price,recorded_at)
      VALUES (3,1,'used',1,'receipt','2000-01-01',0,'2000-01-01T12:00Z'),
             (3,1,'defective',1,'receipt','2000-01-01',0,'2000-01-02T12:00Z'),
             (3,2,'defective',1,'receipt','2000-01-01',0,'2000-01-02T12:00Z');`);
    const { sites: [afterFreeStock], review_items: flagged } = await get(editor);
    assert.equal(afterFreeStock.known_value, 320);
    assert.equal(afterFreeStock.missing_prices, 1); // Only the actual null asset price.
    assert.deepEqual(flagged.map(item => [item.key, item.issue, item.stale]), [
      ['stock:3:1:defective', 'defective', true], ['asset:2', 'in_repair', false], ['stock:3:1:used', null, true],
    ]);
    await db.exec('SET ROLE anon');
    await assert.rejects(db.query('SELECT public.inventory_dashboard()'), error => error.code === '42501');
    console.log('PASS: Dashboard prices, empty and depleted sites, transfers, archived activity, thresholds and site permissions.');
  } finally { await db.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
