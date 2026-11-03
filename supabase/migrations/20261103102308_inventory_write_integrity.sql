-- All authenticated clients must archive an inventory asset before it disappears.
REVOKE EXECUTE ON FUNCTION public.delete_scoped_asset(bigint), private.delete_scoped_asset(bigint) FROM PUBLIC,anon,authenticated;
REVOKE DELETE ON public.assets FROM authenticated;
DROP POLICY IF EXISTS site_scope_delete ON public.assets;
CREATE POLICY site_scope_delete ON public.assets AS RESTRICTIVE FOR DELETE TO authenticated USING (false);

CREATE FUNCTION private.inventory_writer()
RETURNS bigint LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=pg_catalog AS $fn$
DECLARE v_actor bigint;
BEGIN
  IF (SELECT auth.uid()) IS NULL OR NOT coalesce((SELECT private.can_edit_inventory()),false) THEN
    RAISE EXCEPTION 'Keine Bearbeitungsberechtigung.' USING ERRCODE='42501';
  END IF;
  SELECT id INTO v_actor FROM public.employees WHERE auth_user_id=(SELECT auth.uid()) AND is_active LIMIT 1;
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Kein aktiver Mitarbeiter zur Anmeldung gefunden.' USING ERRCODE='42501'; END IF;
  RETURN v_actor;
END;
$fn$;

CREATE FUNCTION private.write_asset_relations(p_asset bigint,p_location bigint,p_department bigint,p_employee bigint,p_actor bigint,p_note text)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $fn$
DECLARE v_location bigint; v_employee bigint; v_department bigint;
BEGIN
  SELECT storage_location_id INTO v_location FROM public.asset_locations
    WHERE asset_id=p_asset AND valid_to IS NULL ORDER BY valid_from DESC,id DESC LIMIT 1;
  IF v_location IS DISTINCT FROM p_location THEN
    UPDATE public.asset_locations SET valid_to=now() WHERE asset_id=p_asset AND valid_to IS NULL;
    INSERT INTO public.asset_locations(asset_id,storage_location_id,changed_by_employee_id,note)
      VALUES(p_asset,p_location,p_actor,p_note);
  END IF;
  SELECT employee_id,department_id INTO v_employee,v_department FROM public.asset_assignments
    WHERE asset_id=p_asset AND valid_to IS NULL ORDER BY valid_from DESC,id DESC LIMIT 1;
  IF (v_employee,v_department) IS DISTINCT FROM (p_employee,CASE WHEN p_employee IS NULL THEN p_department END) THEN
    UPDATE public.asset_assignments SET valid_to=now() WHERE asset_id=p_asset AND valid_to IS NULL;
    INSERT INTO public.asset_assignments(asset_id,employee_id,department_id,changed_by_employee_id)
      VALUES(p_asset,p_employee,CASE WHEN p_employee IS NULL THEN p_department END,p_actor);
  END IF;
END;
$fn$;

CREATE FUNCTION private.lock_inventory_stock_keys(p_source text,p_target text)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $fn$
DECLARE v_key text; v_lock bigint;
BEGIN
  FOR v_key IN SELECT DISTINCT k FROM unnest(ARRAY[p_source,p_target]) k WHERE k IS NOT NULL ORDER BY k LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended('inventory-item:stock:'||v_key,0));
  END LOOP;
  FOR v_lock IN SELECT DISTINCT hashtextextended(k,0) FROM unnest(ARRAY[p_source,p_target]) k WHERE k IS NOT NULL ORDER BY 1 LOOP
    PERFORM pg_advisory_xact_lock(v_lock);
  END LOOP;
END;
$fn$;

CREATE FUNCTION public.save_inventory_entry(p_payload jsonb,p_editing boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $fn$
DECLARE
  v_actor bigint := private.inventory_writer();
  v_edit jsonb := p_payload->'edit';
  v_model jsonb := p_payload->'model';
  v_asset jsonb := p_payload->'asset';
  v_stock jsonb := p_payload->'stock';
  v_codes jsonb := coalesce(p_payload->'scanner_codes','{}'::jsonb);
  v_assignment jsonb := p_payload->'assignment';
  v_type text;
  v_tracking text;
  v_model_id bigint;
  v_old_model bigint;
  v_old_location bigint;
  v_old_condition text;
  v_manufacturer bigint;
  v_name text;
  v_location public.storage_locations%ROWTYPE;
  v_old public.assets%ROWTYPE;
  v_asset_data public.assets%ROWTYPE;
  v_employee bigint;
  v_parent bigint;
  v_previous_parent bigint;
  v_location_id bigint := (p_payload->>'storage_location_id')::bigint;
  v_condition text := coalesce(nullif(p_payload->>'condition',''),'used');
  v_qr text := nullif(btrim(p_payload->>'qr_code'),'');
  v_balance numeric;
  v_desired numeric;
  v_expected numeric;
  v_purchase date;
  v_price numeric;
  v_status text;
  v_note text;
  v_metadata public.stock_movements%ROWTYPE;
  v_source_key text;
  v_target_key text;
  v_request uuid := (p_payload->>'request_id')::uuid;
  v_previous public.inventory_stock_requests%ROWTYPE;
  v_signature jsonb := jsonb_build_object('operation','save_inventory_entry','editing',p_editing,
    'digest',encode(sha256(convert_to(p_payload::text,'UTF8')),'hex'));
  v_result jsonb;
BEGIN
  IF jsonb_typeof(v_model) IS DISTINCT FROM 'object' OR p_editing IS NULL THEN RAISE EXCEPTION 'Produktmodell fehlt.'; END IF;
  SELECT * INTO v_location FROM public.storage_locations WHERE id=v_location_id AND is_active AND department_id IS NOT NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Bitte einen aktiven, freigegebenen Lagerort wählen.' USING ERRCODE='42501'; END IF;
  IF v_request IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('stock-request:'||v_request::text,0));
    SELECT * INTO v_previous FROM public.inventory_stock_requests WHERE id=v_request;
    IF FOUND THEN
      IF v_previous.payload IS DISTINCT FROM v_signature THEN RAISE EXCEPTION 'Die Buchungskennung wurde bereits für andere Daten verwendet.'; END IF;
      RETURN v_previous.result;
    END IF;
  END IF;
  IF v_model->>'mode'='existing' THEN
    v_model_id:=(v_model->>'id')::bigint;
    SELECT tracking_mode INTO v_tracking FROM public.product_models WHERE id=v_model_id AND is_active;
    IF NOT FOUND THEN RAISE EXCEPTION 'Das Produktmodell ist nicht mehr verfügbar.'; END IF;
  ELSIF NOT p_editing AND v_model->>'mode'='new' THEN
    v_tracking:=coalesce(v_model->>'tracking_mode','serialized');
    v_name:=nullif(btrim(v_model->>'name'),'');
    IF v_name IS NULL OR v_tracking NOT IN ('serialized','quantity','hybrid') THEN RAISE EXCEPTION 'Bitte Modellbezeichnung und Verwaltungsart prüfen.'; END IF;
    v_manufacturer:=(v_model->>'manufacturer_id')::bigint;
    IF v_manufacturer IS NULL THEN
      PERFORM pg_advisory_xact_lock(hashtextextended('inventory-manufacturer:'||lower(coalesce(nullif(btrim(v_model->>'manufacturer_name'),''),'Keiner')),0));
      SELECT id INTO v_manufacturer FROM public.manufacturers
        WHERE lower(name)=lower(coalesce(nullif(btrim(v_model->>'manufacturer_name'),''),'Keiner')) ORDER BY id LIMIT 1;
      IF NOT FOUND THEN
        INSERT INTO public.manufacturers(name) VALUES(coalesce(nullif(btrim(v_model->>'manufacturer_name'),''),'Keiner')) RETURNING id INTO v_manufacturer;
      END IF;
    END IF;
    INSERT INTO public.product_models(manufacturer_id,category_id,name,part_number,sku,tracking_mode,unit_code,specifications,is_active)
    VALUES(v_manufacturer,(v_model->>'category_id')::bigint,v_name,nullif(btrim(v_model->>'part_number'),''),
      nullif(btrim(v_model->>'sku'),''),v_tracking,coalesce(v_model->>'unit_code','piece'),coalesce(v_model->'specifications','{}'::jsonb),true)
    RETURNING id INTO v_model_id;
  ELSE RAISE EXCEPTION 'Bitte ein bestehendes Produktmodell wählen.';
  END IF;
  v_type:=CASE WHEN p_editing THEN v_edit->>'record_type'
    WHEN v_tracking='serialized' THEN 'asset' WHEN v_tracking='quantity' THEN 'stock' ELSE p_payload->>'entry_type' END;
  IF v_type='asset' AND v_tracking IN ('serialized','hybrid') THEN
    IF (v_assignment->>'department_id')::bigint IS DISTINCT FROM v_location.department_id THEN
      RAISE EXCEPTION 'Die Abteilung muss zum Lagerort passen.';
    END IF;
    v_employee:=(v_assignment->>'employee_id')::bigint;
    IF v_employee IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.employees WHERE id=v_employee AND is_active AND department_id=v_location.department_id
    ) THEN RAISE EXCEPTION 'Der Mitarbeiter muss zur Abteilung des Lagerorts gehören.'; END IF;
    v_parent:=(p_payload->>'parent_asset_id')::bigint;
    IF v_parent IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.assets WHERE id=v_parent AND archived_at IS NULL) THEN
      RAISE EXCEPTION 'Der verbundene Artikel ist nicht mehr verfügbar oder nicht freigegeben.' USING ERRCODE='42501';
    END IF;
    IF jsonb_typeof(v_asset) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Artikeldaten fehlen.'; END IF;
    v_asset_data:=jsonb_populate_record(NULL::public.assets,v_asset||v_codes);
    v_asset_data.asset_tag:=nullif(btrim(coalesce(CASE WHEN NOT p_editing THEN v_qr END,v_asset_data.asset_tag)),'');
    IF v_asset_data.asset_tag IS NULL OR v_asset_data.purchase_date IS NULL OR v_asset_data.purchase_date>current_date THEN
      RAISE EXCEPTION 'Bitte Produkterkennung und ein gültiges Kaufdatum eingeben.';
    END IF;
    IF p_editing THEN
      PERFORM pg_advisory_xact_lock(hashtextextended('inventory-item:asset:'||(v_edit->>'id'),0));
      SELECT * INTO v_old FROM public.assets WHERE id=(v_edit->>'id')::bigint AND archived_at IS NULL FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'Der Artikel ist nicht mehr verfügbar oder nicht freigegeben.' USING ERRCODE='42501'; END IF;
      IF v_edit->>'updated_at' IS NOT NULL AND v_old.updated_at IS DISTINCT FROM (v_edit->>'updated_at')::timestamptz THEN
        RAISE EXCEPTION 'Der Artikel wurde inzwischen geändert. Bitte erneut öffnen.' USING ERRCODE='40001';
      END IF;
      IF v_parent=v_old.id THEN RAISE EXCEPTION 'Ein Artikel kann nicht mit sich selbst verbunden werden.'; END IF;
      UPDATE public.assets SET product_model_id=v_model_id,asset_tag=v_asset_data.asset_tag,serial_number=v_asset_data.serial_number,
        mac_address=v_asset_data.mac_address,
        qr_code=CASE WHEN (v_asset||v_codes)?'qr_code' THEN v_asset_data.qr_code ELSE v_old.qr_code END,
        ean=CASE WHEN (v_asset||v_codes)?'ean' THEN v_asset_data.ean ELSE v_old.ean END,
        purchase_date=v_asset_data.purchase_date,new_price=coalesce(v_asset_data.new_price,0),warranty_until=v_asset_data.warranty_until,
        note=v_asset_data.note,status=coalesce(v_asset_data.status,'available'),condition=v_condition,
        specifications=coalesce(v_asset_data.specifications,'{}'::jsonb),updated_at=now()
      WHERE id=v_old.id;
    ELSE
      INSERT INTO public.assets(product_model_id,asset_tag,serial_number,mac_address,qr_code,ean,purchase_date,new_price,warranty_until,retired_at,note,status,condition,specifications)
      VALUES(v_model_id,v_asset_data.asset_tag,v_asset_data.serial_number,v_asset_data.mac_address,v_asset_data.qr_code,v_asset_data.ean,
        v_asset_data.purchase_date,coalesce(v_asset_data.new_price,0),v_asset_data.warranty_until,v_asset_data.retired_at,
        v_asset_data.note,coalesce(v_asset_data.status,'available'),v_condition,coalesce(v_asset_data.specifications,'{}'::jsonb))
      RETURNING id INTO v_old.id;
    END IF;
    PERFORM private.write_asset_relations(v_old.id,v_location.id,v_location.department_id,v_employee,v_actor,NULL);
    SELECT parent_asset_id INTO v_previous_parent FROM public.asset_component_assignments
      WHERE child_asset_id=v_old.id AND removed_at IS NULL ORDER BY installed_at DESC,id DESC LIMIT 1;
    IF v_previous_parent IS DISTINCT FROM v_parent THEN
      UPDATE public.asset_component_assignments SET removed_at=now() WHERE child_asset_id=v_old.id AND removed_at IS NULL;
      IF v_parent IS NOT NULL THEN INSERT INTO public.asset_component_assignments(parent_asset_id,child_asset_id) VALUES(v_parent,v_old.id); END IF;
    END IF;
    v_result:=jsonb_build_object('entry_type','asset','id',v_old.id,'asset_tag',v_asset_data.asset_tag,'product_model_id',v_model_id);
  ELSIF v_type='stock' AND v_tracking IN ('quantity','hybrid') THEN
    IF (v_stock->>'department_id')::bigint IS DISTINCT FROM v_location.department_id THEN RAISE EXCEPTION 'Die Abteilung muss zum Lagerort passen.'; END IF;
    v_desired:=(v_stock->>'quantity')::numeric;
    v_purchase:=(v_stock->>'purchase_date')::date;
    v_price:=coalesce((v_stock->>'new_price')::numeric,0);
    v_status:=coalesce(v_stock->>'status','available');
    v_note:=nullif(btrim(v_stock->>'note'),'');
    IF v_desired IS NULL OR v_desired<0 OR v_desired>1000000 OR v_desired<>trunc(v_desired) OR v_desired::text IN ('NaN','Infinity','-Infinity')
      OR v_purchase IS NULL OR v_purchase>current_date OR v_price<0 OR v_price::text IN ('NaN','Infinity','-Infinity')
      OR (NOT p_editing AND v_desired=0) OR v_condition NOT IN ('new','like_new','used','worn','defective') THEN
      RAISE EXCEPTION 'Bitte Menge, Zustand, Kaufdatum und Preis prüfen.';
    END IF;
    IF p_editing THEN
      v_old_model:=(v_edit->>'product_model_id')::bigint;
      v_old_location:=(v_edit->>'storage_location_id')::bigint;
      v_old_condition:=v_edit->>'condition';
      v_expected:=(v_edit->>'stock_quantity')::numeric;
      IF v_old_model IS NULL OR v_old_condition IS NULL OR NOT private.location_access_allowed(v_old_location) THEN
        RAISE EXCEPTION 'Quellbestand nicht verfügbar oder nicht freigegeben.' USING ERRCODE='42501';
      END IF;
      v_source_key:=v_old_model::text||':'||v_old_location::text||':'||v_old_condition;
    END IF;
    PERFORM 1 FROM public.product_models WHERE id IN (v_old_model,v_model_id) ORDER BY id FOR NO KEY UPDATE;
    v_target_key:=v_model_id::text||':'||v_location.id::text||':'||v_condition;
    PERFORM private.lock_inventory_stock_keys(v_source_key,v_target_key);
    IF p_editing THEN
      SELECT quantity INTO v_balance FROM public.stock_levels
        WHERE product_model_id=v_old_model AND storage_location_id=v_old_location AND condition=v_old_condition;
      v_balance:=coalesce(v_balance,0);
      IF v_expected IS NOT NULL AND v_balance<>v_expected THEN
        RAISE EXCEPTION 'Der Lagerbestand wurde inzwischen geändert. Bitte erneut prüfen.' USING ERRCODE='40001',DETAIL=v_balance::text;
      END IF;
      IF v_balance<=0 THEN RAISE EXCEPTION 'Der ursprüngliche Mengenbestand ist bereits leer.'; END IF;
      IF v_desired<v_balance THEN
        RAISE EXCEPTION 'Für die Entnahme bitte Archivierung oder Einzelartikel wählen.' USING ERRCODE='P0041',DETAIL=v_balance::text;
      END IF;
    END IF;
    IF NOT p_editing AND EXISTS (
      SELECT 1 FROM public.product_models m WHERE m.id=v_model_id AND (
        (nullif(v_codes->>'qr_code','') IS NOT NULL AND nullif(m.qr_code,'') IS NOT NULL AND m.qr_code<>v_codes->>'qr_code')
        OR (nullif(v_codes->>'ean','') IS NOT NULL AND nullif(m.ean,'') IS NOT NULL AND m.ean<>v_codes->>'ean')
        OR (v_qr IS NOT NULL AND nullif(m.sku,'') IS NOT NULL AND lower(m.sku)<>lower(v_qr)))
    ) THEN RAISE EXCEPTION 'Dieses Produktmodell hat bereits eine andere Kennung. Bitte die Kennungen beim Produktmodell prüfen.'; END IF;
    IF v_codes<>'{}'::jsonb OR (NOT p_editing AND v_qr IS NOT NULL) THEN
      UPDATE public.product_models SET
        qr_code=CASE WHEN v_codes?'qr_code' AND (p_editing OR qr_code IS NULL) THEN v_codes->>'qr_code' ELSE qr_code END,
        ean=CASE WHEN v_codes?'ean' AND (p_editing OR ean IS NULL) THEN v_codes->>'ean' ELSE ean END,
        sku=CASE WHEN NOT p_editing AND v_qr IS NOT NULL THEN coalesce(nullif(sku,''),v_qr) ELSE sku END,
        updated_at=now()
      WHERE id=v_model_id AND (
        (v_codes?'qr_code' AND (p_editing OR qr_code IS NULL) AND qr_code IS DISTINCT FROM v_codes->>'qr_code')
        OR (v_codes?'ean' AND (p_editing OR ean IS NULL) AND ean IS DISTINCT FROM v_codes->>'ean')
        OR (NOT p_editing AND v_qr IS NOT NULL AND nullif(sku,'') IS NULL));
    END IF;
    IF p_editing AND v_source_key=v_target_key AND v_desired=v_balance THEN
      SELECT * INTO v_metadata FROM public.stock_movements m WHERE m.product_model_id=v_model_id AND m.purchase_date IS NOT NULL
        AND ((m.from_storage_location_id=v_location.id AND m.from_condition=v_condition AND m.movement_type<>'transfer') OR (m.to_storage_location_id=v_location.id AND m.to_condition=v_condition))
        ORDER BY m.moved_at DESC,m.id DESC LIMIT 1;
      IF (v_metadata.department_id,v_metadata.purchase_date,v_metadata.new_price,v_metadata.status,v_metadata.note)
        IS NOT DISTINCT FROM (v_location.department_id,v_purchase,v_price,v_status,v_note) THEN
        RETURN jsonb_build_object('entry_type','stock','product_model_id',v_model_id,'quantity',v_desired);
      END IF;
    END IF;
    IF p_editing AND (v_source_key<>v_target_key OR v_desired=v_balance) THEN
      INSERT INTO public.stock_movements(product_model_id,from_storage_location_id,from_condition,quantity,movement_type,performed_by_employee_id,note)
        VALUES(v_old_model,v_old_location,v_old_condition,v_balance,'adjustment',v_actor,'Bestand vor Änderung ausgebucht.');
    ELSIF p_editing THEN
      v_desired:=v_desired-v_balance;
    END IF;
    INSERT INTO public.stock_movements(product_model_id,to_storage_location_id,to_condition,quantity,movement_type,
      department_id,purchase_date,new_price,status,note,performed_by_employee_id)
    VALUES(v_model_id,v_location.id,v_condition,v_desired,
      CASE WHEN p_editing AND v_source_key=v_target_key AND (v_stock->>'quantity')::numeric<>v_balance THEN 'adjustment' ELSE 'receipt' END,
      v_location.department_id,v_purchase,v_price,v_status,v_note,v_actor)
    RETURNING id INTO v_metadata.id;
    v_result:=jsonb_build_object('entry_type','stock','id',v_metadata.id,'product_model_id',v_model_id,'quantity',(v_stock->>'quantity')::numeric);
  ELSE RAISE EXCEPTION 'Eintragsart und Produktmodell passen nicht zusammen.';
  END IF;
  IF v_request IS NOT NULL THEN
    INSERT INTO public.inventory_stock_requests(id,site_id,payload,result) VALUES(v_request,v_location.site_id,v_signature,v_result);
  END IF;
  RETURN v_result;
END;
$fn$;

CREATE FUNCTION public.move_inventory_entry(p_key text,p_destination bigint,p_request_id uuid,p_quantity numeric DEFAULT NULL,
  p_expected_quantity numeric DEFAULT NULL,p_expected_location bigint DEFAULT NULL,p_note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $fn$
DECLARE
  v_actor bigint := private.inventory_writer();
  v_source public.storage_locations%ROWTYPE;
  v_target public.storage_locations%ROWTYPE;
  v_metadata public.stock_movements%ROWTYPE;
  v_image public.inventory_images%ROWTYPE;
  v_previous public.inventory_stock_requests%ROWTYPE;
  v_asset bigint;
  v_employee bigint;
  v_model bigint;
  v_source_id bigint;
  v_condition text;
  v_balance numeric;
  v_source_key text;
  v_target_key text;
  v_movement bigint;
  v_signature jsonb := jsonb_build_object('operation','move_inventory_entry','key',p_key,'destination',p_destination,
    'quantity',p_quantity,'expected_quantity',p_expected_quantity,'expected_location',p_expected_location,'note',p_note);
  v_result jsonb;
BEGIN
  IF p_request_id IS NULL OR length(p_note)>2000 THEN RAISE EXCEPTION 'Bitte die Buchungsdaten prüfen.'; END IF;
  SELECT * INTO v_target FROM public.storage_locations WHERE id=p_destination AND is_active AND department_id IS NOT NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Ziellagerort nicht verfügbar oder nicht freigegeben.' USING ERRCODE='42501'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('stock-request:'||p_request_id::text,0));
  SELECT * INTO v_previous FROM public.inventory_stock_requests WHERE id=p_request_id;
  IF FOUND THEN
    IF v_previous.payload IS DISTINCT FROM v_signature THEN RAISE EXCEPTION 'Die Buchungskennung wurde bereits für andere Daten verwendet.'; END IF;
    RETURN v_previous.result;
  END IF;
  IF p_key ~ '^asset:[0-9]+$' THEN
    v_asset:=split_part(p_key,':',2)::bigint;
    PERFORM pg_advisory_xact_lock(hashtextextended('inventory-item:'||p_key,0));
    PERFORM 1 FROM public.assets WHERE id=v_asset AND archived_at IS NULL FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Der Artikel ist nicht verfügbar oder nicht freigegeben.' USING ERRCODE='42501'; END IF;
    SELECT storage_location_id INTO v_source_id FROM public.asset_locations WHERE asset_id=v_asset AND valid_to IS NULL
      ORDER BY valid_from DESC,id DESC LIMIT 1;
    IF p_expected_location IS NOT NULL AND v_source_id IS DISTINCT FROM p_expected_location THEN
      RAISE EXCEPTION 'Der Artikel wurde inzwischen verschoben. Bitte erneut auswählen.' USING ERRCODE='40001';
    END IF;
  ELSIF p_key ~ '^stock:[0-9]+:[0-9]+:(new|like_new|used|worn|defective)$' THEN
    v_model:=split_part(p_key,':',2)::bigint;
    v_source_id:=split_part(p_key,':',3)::bigint;
    v_condition:=split_part(p_key,':',4);
  ELSE RAISE EXCEPTION 'Ungültige Artikelkennung.'; END IF;
  SELECT * INTO v_source FROM public.storage_locations WHERE id=v_source_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Quelllagerort nicht verfügbar oder nicht freigegeben.' USING ERRCODE='42501'; END IF;
  IF v_source.id=v_target.id THEN RAISE EXCEPTION 'Bitte einen anderen Lagerort wählen.'; END IF;

  IF v_asset IS NOT NULL THEN
    SELECT a.employee_id INTO v_employee FROM public.asset_assignments a
      JOIN public.employees e ON e.id=a.employee_id AND e.is_active AND e.department_id=v_target.department_id
      WHERE a.asset_id=v_asset AND a.valid_to IS NULL ORDER BY a.valid_from DESC,a.id DESC LIMIT 1;
    PERFORM private.write_asset_relations(v_asset,v_target.id,v_target.department_id,v_employee,v_actor,nullif(btrim(p_note),''));
    v_result:=jsonb_build_object('saved',true,'quantity',1);
  ELSE
    IF p_quantity IS NULL OR p_quantity<=0 OR p_quantity>1000000 OR p_quantity<>trunc(p_quantity)
      OR p_quantity::text IN ('NaN','Infinity','-Infinity') THEN RAISE EXCEPTION 'Bitte eine gültige ganze Stückzahl angeben.'; END IF;
    PERFORM 1 FROM public.product_models WHERE id=v_model AND is_active AND tracking_mode IN ('quantity','hybrid') FOR NO KEY UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Der Mengenartikel ist nicht mehr verfügbar.'; END IF;
    v_source_key:=v_model::text||':'||v_source.id::text||':'||v_condition;
    v_target_key:=v_model::text||':'||v_target.id::text||':'||v_condition;
    PERFORM private.lock_inventory_stock_keys(v_source_key,v_target_key);
    SELECT quantity INTO v_balance FROM public.stock_levels WHERE product_model_id=v_model AND storage_location_id=v_source.id AND condition=v_condition;
    v_balance:=coalesce(v_balance,0);
    IF v_balance<p_quantity OR (p_expected_quantity IS NOT NULL AND v_balance<>p_expected_quantity) THEN
      RAISE EXCEPTION 'Der Lagerbestand wurde inzwischen geändert oder reicht nicht aus.' USING ERRCODE='40001',DETAIL=v_balance::text;
    END IF;
    SELECT * INTO v_image FROM public.inventory_images WHERE item_key=p_key AND is_current;
    IF NOT EXISTS (SELECT 1 FROM public.stock_levels WHERE product_model_id=v_model AND storage_location_id=v_target.id AND condition=v_condition AND quantity>0) THEN
      SELECT * INTO v_metadata FROM public.stock_movements m WHERE m.product_model_id=v_model AND m.purchase_date IS NOT NULL
        AND ((m.from_storage_location_id=v_source.id AND m.from_condition=v_condition AND m.movement_type<>'transfer') OR (m.to_storage_location_id=v_source.id AND m.to_condition=v_condition))
        ORDER BY m.moved_at DESC,m.id DESC LIMIT 1;
    END IF;
    INSERT INTO public.stock_movements(product_model_id,from_storage_location_id,from_condition,to_storage_location_id,to_condition,
      quantity,movement_type,department_id,performed_by_employee_id,reference,purchase_date,new_price,status,note)
    VALUES(v_model,v_source.id,v_condition,v_target.id,v_condition,p_quantity,'transfer',v_target.department_id,v_actor,
      'MOVE:'||p_request_id::text,v_metadata.purchase_date,coalesce(v_metadata.new_price,0),coalesce(v_metadata.status,'available'),nullif(btrim(p_note),''))
    RETURNING id INTO v_movement;
    IF v_image.id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.inventory_images WHERE item_key='stock:'||v_target_key AND is_current) THEN
      INSERT INTO public.inventory_images(item_key,site_id,image_data) VALUES('stock:'||v_target_key,v_target.site_id,v_image.image_data);
    END IF;
    v_result:=jsonb_build_object('saved',true,'quantity',p_quantity,'remaining',v_balance-p_quantity,'movement_id',v_movement);
  END IF;
  INSERT INTO public.inventory_stock_requests(id,site_id,target_site_id,payload,result)
    VALUES(p_request_id,v_source.site_id,v_target.site_id,v_signature,v_result);
  RETURN v_result;
END;
$fn$;

REVOKE ALL ON FUNCTION private.inventory_writer(), private.write_asset_relations(bigint,bigint,bigint,bigint,bigint,text),
  private.lock_inventory_stock_keys(text,text), public.save_inventory_entry(jsonb,boolean),
  public.move_inventory_entry(text,bigint,uuid,numeric,numeric,bigint,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION private.inventory_writer(), private.write_asset_relations(bigint,bigint,bigint,bigint,bigint,text),
  private.lock_inventory_stock_keys(text,text), public.save_inventory_entry(jsonb,boolean),
  public.move_inventory_entry(text,bigint,uuid,numeric,numeric,bigint,text) TO authenticated;

-- Check the submitted balance under the same lock on both additions and withdrawals.
CREATE OR REPLACE FUNCTION public.book_inventory_stock(
 p_request_id uuid,p_model bigint,p_location bigint,p_condition text,p_quantity numeric,
 p_direction text,p_details jsonb DEFAULT '{}'::jsonb,p_expected_quantity numeric DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $fn$
DECLARE
 v_source public.storage_locations%ROWTYPE; v_target public.storage_locations%ROWTYPE;
 v_model public.product_models%ROWTYPE; v_metadata jsonb; v_payload jsonb; v_previous public.inventory_stock_requests%ROWTYPE;
 v_actor bigint; v_actor_name text; v_balance numeric; v_key text; v_action text; v_reason jsonb;
 v_image public.inventory_images%ROWTYPE; v_snapshot jsonb; v_archive uuid; v_movement bigint; v_asset bigint;
 v_unit jsonb; v_ids jsonb:='[]'::jsonb; v_result jsonb; v_condition text; v_status text;
 v_mac text; v_compact text; v_tag text; v_serial text; v_note text; v_price numeric; v_purchase date;
BEGIN
 IF (SELECT auth.uid()) IS NULL OR NOT coalesce((SELECT private.can_edit_inventory()),false) THEN
  RAISE EXCEPTION 'Keine Bearbeitungsberechtigung.' USING ERRCODE='42501';
 END IF;
 IF p_request_id IS NULL OR p_quantity IS NULL OR p_quantity<=0 OR p_quantity>1000000 OR p_quantity<>trunc(p_quantity)
   OR p_quantity::text IN ('NaN','Infinity','-Infinity') THEN RAISE EXCEPTION 'Bitte eine ganze Menge zwischen 1 und 1000000 angeben.'; END IF;
 IF p_direction IS NULL OR p_direction NOT IN ('add','remove') OR p_condition IS NULL
   OR p_condition NOT IN ('new','like_new','used','worn','defective') THEN RAISE EXCEPTION 'Ungültige Lagerbuchung.'; END IF;
 IF jsonb_typeof(p_details) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Ungültige Entnahmedaten.'; END IF;
 SELECT * INTO v_source FROM public.storage_locations WHERE id=p_location;
 IF v_source.id IS NULL OR NOT private.site_access_allowed(v_source.site_id) THEN
  RAISE EXCEPTION 'Quellstandort nicht freigegeben.' USING ERRCODE='42501';
 END IF;
 v_action:=p_details->>'action';
 IF p_direction='remove' AND v_action='assets' THEN
  SELECT * INTO v_target FROM public.storage_locations WHERE id=(p_details->>'target_location_id')::bigint;
  IF v_target.id IS NULL OR NOT private.site_access_allowed(v_target.site_id) THEN
   RAISE EXCEPTION 'Zielstandort nicht freigegeben.' USING ERRCODE='42501';
  END IF;
 END IF;
 v_payload:=jsonb_build_object('model',p_model,'location',p_location,'condition',p_condition,'quantity',p_quantity,
   'direction',p_direction,'details',p_details,'expected',p_expected_quantity);
 PERFORM pg_advisory_xact_lock(hashtextextended('stock-request:'||p_request_id::text,0));
 SELECT * INTO v_previous FROM public.inventory_stock_requests WHERE id=p_request_id;
 IF v_previous.id IS NOT NULL THEN
  IF v_previous.payload IS DISTINCT FROM v_payload THEN RAISE EXCEPTION 'Die Buchungskennung wurde bereits für andere Daten verwendet.'; END IF;
  RETURN v_previous.result;
 END IF;
 IF NOT v_source.is_active OR v_source.department_id IS NULL THEN RAISE EXCEPTION 'Bitte einen aktiven Lagerort mit Abteilung wählen.'; END IF;
 SELECT * INTO v_model FROM public.product_models WHERE id=p_model FOR NO KEY UPDATE;
 IF v_model.id IS NULL OR NOT v_model.is_active OR v_model.tracking_mode NOT IN ('quantity','hybrid') THEN RAISE EXCEPTION 'Das Produktmodell führt keinen aktiven Mengenbestand.'; END IF;
 SELECT id,concat_ws(' ',first_name,last_name) INTO v_actor,v_actor_name FROM public.employees
  WHERE auth_user_id=(SELECT auth.uid()) AND is_active LIMIT 1;
 IF v_actor IS NULL THEN RAISE EXCEPTION 'Kein aktiver Mitarbeiter zur Anmeldung gefunden.' USING ERRCODE='42501'; END IF;
 v_key:='stock:'||p_model::text||':'||p_location::text||':'||p_condition;
 PERFORM pg_advisory_xact_lock(hashtextextended('inventory-item:'||v_key,0));
 PERFORM pg_advisory_xact_lock(hashtextextended(p_model::text||':'||p_location::text||':'||p_condition,0));
 SELECT coalesce(quantity,0) INTO v_balance FROM public.stock_levels WHERE product_model_id=p_model AND storage_location_id=p_location AND condition=p_condition;
 v_balance:=coalesce(v_balance,0);
 IF (p_direction='remove' AND v_balance<p_quantity) OR (p_expected_quantity IS NOT NULL AND p_expected_quantity<>v_balance) THEN
  RAISE EXCEPTION 'Der Lagerbestand wurde inzwischen geändert oder reicht nicht aus. Bitte erneut prüfen.' USING ERRCODE='40001',DETAIL=v_balance::text;
 END IF;
 SELECT to_jsonb(sm) INTO v_metadata FROM public.stock_movements sm WHERE sm.product_model_id=p_model AND sm.purchase_date IS NOT NULL
  AND ((sm.to_storage_location_id=p_location AND sm.to_condition=p_condition) OR (sm.from_storage_location_id=p_location AND sm.from_condition=p_condition AND sm.movement_type<>'transfer'))
  ORDER BY sm.moved_at DESC,sm.id DESC LIMIT 1;
 v_metadata:=coalesce(v_metadata,'{}'::jsonb)||coalesce(p_details->'metadata','{}'::jsonb);
 v_purchase:=coalesce((v_metadata->>'purchase_date')::date,current_date); v_price:=coalesce((v_metadata->>'new_price')::numeric,0);
 v_status:=coalesce(v_metadata->>'status','available');v_note:=v_metadata->>'note';
 IF v_purchase>current_date OR v_price<0 OR v_price::text IN ('NaN','Infinity','-Infinity') OR v_status NOT IN ('available','in_use','defective','in_repair') THEN
  RAISE EXCEPTION 'Ungültiges Kaufdatum, Preis oder Status.';
 END IF;
 SELECT * INTO v_image FROM public.inventory_images WHERE item_key=v_key AND is_current;
 IF p_direction='remove' THEN
  IF v_action='archive' THEN
   v_reason:=p_details->'reason';
   IF v_reason->>'reason' IS NULL OR v_reason->>'reason' NOT IN ('customer','defective','retired','lost','other') THEN RAISE EXCEPTION 'Bitte einen Archivgrund angeben.'; END IF;
   IF v_reason->>'reason'='customer' AND coalesce(length(btrim(v_reason->>'customer_name')),0)=0 THEN RAISE EXCEPTION 'Bitte den Kundennamen angeben.'; END IF;
   IF v_reason->>'reason'='defective' AND jsonb_typeof(v_reason->'destroyed') IS DISTINCT FROM 'boolean' THEN RAISE EXCEPTION 'Bitte angeben, ob der Artikel vernichtet wurde.'; END IF;
   IF v_reason->>'reason'='other' AND coalesce(length(btrim(v_reason->>'note')),0)=0 THEN RAISE EXCEPTION 'Bitte den Archivgrund beschreiben.'; END IF;
   SELECT jsonb_build_object('id',v_key,'_record_type','stock','product_model_id',p_model,'product_model_name',v_model.name,
    'product_category_name',c.name,'manufacturer_name',mf.name,'condition',p_condition,'stock_quantity',p_quantity,
    'storage_location_id',p_location,'storage_location',v_source.name,'site_id',v_source.site_id,'site_name',s.name,
    'department_name',d.name,'image_id',v_image.id,'purchase_date',v_purchase,'new_price',v_price,'status',v_status,'note',v_note,
    'qr_code',v_model.qr_code,'ean',v_model.ean,'specifications',v_model.specifications)
   INTO v_snapshot FROM public.sites s LEFT JOIN public.departments d ON d.id=v_source.department_id
    LEFT JOIN public.product_categories c ON c.id=v_model.category_id LEFT JOIN public.manufacturers mf ON mf.id=v_model.manufacturer_id WHERE s.id=v_source.site_id;
   INSERT INTO public.inventory_archive(source_key,record_type,label,site_id,snapshot,image_id,reason,customer_name,destroyed,note,archived_by_name)
    VALUES(v_key,'stock',v_model.name,v_source.site_id,v_snapshot,v_image.id,v_reason->>'reason',nullif(btrim(v_reason->>'customer_name'),''),
     (v_reason->>'destroyed')::boolean,nullif(btrim(v_reason->>'note'),''),v_actor_name) RETURNING id INTO v_archive;
   IF p_quantity=v_balance THEN UPDATE public.inventory_images SET is_current=false WHERE item_key=v_key AND is_current; END IF;
  ELSIF v_action='assets' THEN
   IF NOT v_target.is_active OR v_target.department_id IS NULL THEN RAISE EXCEPTION 'Bitte einen aktiven Ziel-Lagerort mit Abteilung wählen.'; END IF;
   IF p_quantity>100 OR jsonb_typeof(p_details->'units') IS DISTINCT FROM 'array' OR jsonb_array_length(p_details->'units')<>p_quantity THEN
    RAISE EXCEPTION 'Bitte für jedes entnommene Stück einen Einzelartikel erfassen (höchstens 100 pro Buchung).';
   END IF;
   v_condition:=p_details->>'target_condition';v_status:=p_details->>'target_status';
   IF v_condition IS NULL OR v_condition NOT IN ('new','like_new','used','worn','defective') OR v_status IS NULL OR v_status NOT IN ('available','in_use','defective','in_repair') THEN RAISE EXCEPTION 'Bitte Zustand und Status der Einzelartikel angeben.'; END IF;
   IF v_model.tracking_mode='quantity' THEN UPDATE public.product_models SET tracking_mode='hybrid',updated_at=now() WHERE id=p_model; END IF;
   IF p_quantity=v_balance THEN UPDATE public.inventory_images SET is_current=false WHERE item_key=v_key AND is_current; END IF;
   FOR v_unit IN SELECT value FROM jsonb_array_elements(p_details->'units') LOOP
    v_tag:=nullif(btrim(v_unit->>'asset_tag'),'');v_serial:=nullif(btrim(v_unit->>'serial_number'),'');v_mac:=nullif(btrim(v_unit->>'mac_address'),'');
    IF v_tag IS NULL OR length(v_tag)>50 OR v_tag ~ '[[:cntrl:]]' OR length(v_serial)>100 OR v_serial ~ '[[:cntrl:]]' THEN RAISE EXCEPTION 'Bitte gültige Produkterkennungen und Seriennummern eingeben.'; END IF;
    IF EXISTS (SELECT 1 FROM public.assets WHERE asset_tag=v_tag) THEN RAISE EXCEPTION 'Die Produkterkennung wird bereits verwendet.' USING ERRCODE='23505'; END IF;
    IF v_mac IS NOT NULL THEN
     IF v_mac !~* '^(?:[a-f0-9]{12}|(?:[a-f0-9]{2}:){5}[a-f0-9]{2}|(?:[a-f0-9]{2}-){5}[a-f0-9]{2}|(?:[a-f0-9]{4}\.){2}[a-f0-9]{4})$' THEN RAISE EXCEPTION 'Ungültige MAC-Adresse.'; END IF;
     v_compact:=upper(regexp_replace(v_mac,'[:.\-]','','g'));
     v_mac:=substring(v_compact,1,2)||':'||substring(v_compact,3,2)||':'||substring(v_compact,5,2)||':'||substring(v_compact,7,2)||':'||substring(v_compact,9,2)||':'||substring(v_compact,11,2);
    END IF;
    INSERT INTO public.assets(product_model_id,asset_tag,serial_number,mac_address,purchase_date,new_price,status,condition,note,specifications,ean)
     VALUES(p_model,v_tag,v_serial,v_mac,v_purchase,v_price,v_status,v_condition,nullif(btrim(p_details->>'note'),''),v_model.specifications,v_model.ean) RETURNING id INTO v_asset;
    INSERT INTO public.asset_locations(asset_id,storage_location_id,changed_by_employee_id) VALUES(v_asset,v_target.id,v_actor);
    INSERT INTO public.asset_assignments(asset_id,department_id,changed_by_employee_id) VALUES(v_asset,v_target.department_id,v_actor);
    IF v_image.id IS NOT NULL THEN
     INSERT INTO public.inventory_images(item_key,site_id,image_data) VALUES('asset:'||v_asset::text,v_target.site_id,v_image.image_data);
    END IF;
    INSERT INTO public.stock_movements(product_model_id,from_storage_location_id,from_condition,quantity,movement_type,performed_by_employee_id,
      department_id,purchase_date,new_price,status,related_asset_id,reference,note)
     VALUES(p_model,p_location,p_condition,1,'installation',v_actor,v_source.department_id,v_purchase,v_price,
       coalesce(v_metadata->>'status','available'),v_asset,'STOCK:'||p_request_id::text,v_note);
    v_ids:=v_ids||jsonb_build_array(v_asset);
   END LOOP;
  ELSE RAISE EXCEPTION 'Bitte Archivierung oder Einzelartikel als Verwendung wählen.';
  END IF;
 END IF;
 IF p_direction='add' OR v_action='archive' THEN
  INSERT INTO public.stock_movements(product_model_id,from_storage_location_id,from_condition,to_storage_location_id,to_condition,quantity,
    movement_type,performed_by_employee_id,department_id,purchase_date,new_price,status,reference,note)
   VALUES(p_model,CASE WHEN p_direction='remove' THEN p_location END,CASE WHEN p_direction='remove' THEN p_condition END,
     CASE WHEN p_direction='add' THEN p_location END,CASE WHEN p_direction='add' THEN p_condition END,p_quantity,
     CASE WHEN p_direction='add' THEN 'receipt' ELSE 'issue' END,v_actor,v_source.department_id,v_purchase,v_price,
     coalesce(v_metadata->>'status','available'),'STOCK:'||p_request_id::text,v_note) RETURNING id INTO v_movement;
 END IF;
 v_result:=jsonb_build_object('saved',true,'quantity',v_balance+CASE WHEN p_direction='add' THEN p_quantity ELSE -p_quantity END,
   'changed_quantity',p_quantity,'direction',p_direction,'movement_id',v_movement,'archive_id',v_archive,'asset_ids',v_ids,'asset_count',jsonb_array_length(v_ids));
 INSERT INTO public.inventory_stock_requests(id,site_id,target_site_id,payload,result) VALUES(p_request_id,v_source.site_id,v_target.site_id,v_payload,v_result);
 RETURN v_result;
END;
$fn$;
REVOKE ALL ON FUNCTION public.book_inventory_stock(uuid,bigint,bigint,text,numeric,text,jsonb,numeric) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.book_inventory_stock(uuid,bigint,bigint,text,numeric,text,jsonb,numeric) TO authenticated;
NOTIFY pgrst,'reload schema';

CREATE FUNCTION public.search_inventory_archive(p_offset int,p_query text,p_site text,p_reason text,p_from date,p_until date)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog AS $fn$
  WITH filtered AS MATERIALIZED (
    SELECT ar.*
    FROM public.inventory_archive ar
    WHERE (coalesce(p_reason,'')='' OR ar.reason=p_reason)
      AND (p_from IS NULL OR ar.archived_at >= (p_from::timestamp AT TIME ZONE 'Europe/Zurich'))
      AND (p_until IS NULL OR ar.archived_at < ((p_until+1)::timestamp AT TIME ZONE 'Europe/Zurich'))
      AND (coalesce(p_site,'')='' OR strpos(lower(coalesce(ar.snapshot->>'site_name','')),lower(p_site))>0)
      AND (coalesce(p_query,'')='' OR strpos(lower(concat_ws(' ',ar.label,ar.snapshot->>'asset_tag',ar.snapshot->>'product_model_name',
        ar.snapshot->>'manufacturer_name',ar.snapshot->>'serial_number',ar.snapshot->>'mac_address',ar.snapshot->>'qr_code',ar.snapshot->>'ean')),lower(p_query))>0
        OR (p_query ~ '^[0-9A-Fa-f:. -]+$' AND length(regexp_replace(p_query,'[^0-9A-Fa-f]','','g'))=12
          AND lower(regexp_replace(coalesce(ar.snapshot->>'mac_address',''),'[^0-9A-Fa-f]','','g'))=lower(regexp_replace(p_query,'[^0-9A-Fa-f]','','g'))))
  ), page AS (
    SELECT * FROM filtered ORDER BY archived_at DESC,id DESC LIMIT 50 OFFSET greatest(p_offset,0)
  )
  SELECT jsonb_build_object('items',coalesce((SELECT jsonb_agg(to_jsonb(page) ORDER BY archived_at DESC,id DESC) FROM page),'[]'::jsonb),
    'total',(SELECT count(*) FROM filtered));
$fn$;
REVOKE ALL ON FUNCTION public.search_inventory_archive(int,text,text,text,date,date) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.search_inventory_archive(int,text,text,text,date,date) TO authenticated;
NOTIFY pgrst,'reload schema';
