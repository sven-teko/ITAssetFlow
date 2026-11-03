-- Bulk edits keep the inventory and the movement history in one transaction.
CREATE FUNCTION public.bulk_edit_inventory(p_entries jsonb, p_changes jsonb)
RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $fn$
DECLARE
    v_actor bigint := private.inventory_writer();
    v_entry jsonb;
    v_condition text := p_changes->>'condition';
    v_key text;
    v_lock bigint;
    v_source_keys text[] := '{}';
    v_item_keys text[] := '{}';
    v_stock_keys text[] := '{}';
    v_models bigint[] := '{}';
    v_asset public.assets%ROWTYPE;
    v_location public.storage_locations%ROWTYPE;
    v_metadata public.stock_movements%ROWTYPE;
    v_image public.inventory_images%ROWTYPE;
    v_id bigint;
    v_model bigint;
    v_location_id bigint;
    v_source_condition text;
    v_expected numeric;
    v_balance numeric;
    v_target_key text;
    v_stock_count integer := 0;
    v_changed integer := 0;
BEGIN
    IF jsonb_typeof(p_entries) IS DISTINCT FROM 'array'
       OR jsonb_array_length(p_entries) NOT BETWEEN 2 AND 200
       OR jsonb_typeof(p_changes) IS DISTINCT FROM 'object'
       OR p_changes = '{}'::jsonb
       OR (p_changes - ARRAY['condition','status','purchase_date','warranty_until','new_price','note']) <> '{}'::jsonb THEN
        RAISE EXCEPTION 'Bitte 2 bis 200 Einträge und gültige Änderungen wählen.';
    END IF;
    IF (p_changes ? 'condition' AND (v_condition IS NULL OR v_condition NOT IN ('new','like_new','used','worn','defective')))
       OR (p_changes ? 'status' AND coalesce(p_changes->>'status','') NOT IN ('available','in_use','defective','in_repair','retired'))
       OR (p_changes ? 'purchase_date' AND (coalesce(p_changes->>'purchase_date','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' OR (p_changes->>'purchase_date')::date > current_date))
       OR ((p_changes->>'warranty_until') IS NOT NULL AND (p_changes->>'warranty_until') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$')
       OR (p_changes ? 'new_price' AND ((p_changes->>'new_price') IS NULL OR (p_changes->>'new_price')::numeric NOT BETWEEN 0 AND 9999999999.99))
       OR length(p_changes->>'note') > 2000 THEN
        RAISE EXCEPTION 'Mindestens ein neuer Wert ist ungültig.';
    END IF;

    FOR v_entry IN SELECT value FROM jsonb_array_elements(p_entries) LOOP
        IF v_entry->>'type' = 'asset' THEN
            v_id := (v_entry->>'id')::bigint;
            IF v_id IS NULL OR v_id <= 0 THEN RAISE EXCEPTION 'Ungültiger Einzelartikel.'; END IF;
            v_key := 'asset:' || v_id;
        ELSIF v_entry->>'type' = 'stock' THEN
            v_model := (v_entry->>'product_model_id')::bigint;
            v_location_id := (v_entry->>'storage_location_id')::bigint;
            v_source_condition := v_entry->>'condition';
            IF v_model IS NULL OR v_model <= 0 OR v_location_id IS NULL OR v_location_id <= 0
               OR coalesce(v_source_condition,'') NOT IN ('new','like_new','used','worn','defective') OR v_condition IS NULL THEN
                RAISE EXCEPTION 'Ungültiger Mengenartikel oder Zustand.';
            END IF;
            v_key := 'stock:' || v_model || ':' || v_location_id || ':' || v_source_condition;
            v_target_key := 'stock:' || v_model || ':' || v_location_id || ':' || v_condition;
            v_models := array_append(v_models,v_model);
            v_stock_keys := v_stock_keys || ARRAY[substr(v_key,7),substr(v_target_key,7)];
            v_item_keys := array_append(v_item_keys,v_target_key);
            v_stock_count := v_stock_count + 1;
        ELSE
            RAISE EXCEPTION 'Unbekannter Inventareintrag.';
        END IF;
        IF v_key = ANY(v_source_keys) THEN RAISE EXCEPTION 'Doppelte Einträge in der Auswahl.'; END IF;
        v_source_keys := array_append(v_source_keys,v_key);
        v_item_keys := array_append(v_item_keys,v_key);
    END LOOP;
    IF v_stock_count > 0 AND (p_changes - 'condition') <> '{}'::jsonb THEN
        RAISE EXCEPTION 'In einer Auswahl mit Mengenartikeln kann nur der Zustand gemeinsam geändert werden.';
    END IF;

    PERFORM 1 FROM public.product_models WHERE id=ANY(v_models) ORDER BY id FOR NO KEY UPDATE;
    FOR v_key IN SELECT DISTINCT k FROM unnest(v_item_keys) k ORDER BY k LOOP
        PERFORM pg_advisory_xact_lock(hashtextextended('inventory-item:'||v_key,0));
    END LOOP;
    FOR v_lock IN SELECT DISTINCT hashtextextended(k,0) FROM unnest(v_stock_keys) k ORDER BY 1 LOOP
        PERFORM pg_advisory_xact_lock(v_lock);
    END LOOP;

    -- Validate every source balance before any of them can become a destination.
    FOR v_entry IN SELECT value FROM jsonb_array_elements(p_entries) LOOP
        IF v_entry->>'type' = 'asset' THEN
            SELECT * INTO v_asset FROM public.assets WHERE id=(v_entry->>'id')::bigint AND archived_at IS NULL FOR UPDATE;
            IF NOT FOUND THEN RAISE EXCEPTION 'Ein Einzelartikel ist nicht mehr verfügbar oder freigegeben.' USING ERRCODE='42501'; END IF;
            IF v_entry->>'updated_at' IS NOT NULL AND v_asset.updated_at IS DISTINCT FROM (v_entry->>'updated_at')::timestamptz THEN
                RAISE EXCEPTION 'Ein Einzelartikel wurde inzwischen geändert. Bitte Auswahl neu laden.' USING ERRCODE='40001';
            END IF;
            IF (CASE WHEN p_changes?'warranty_until' THEN (p_changes->>'warranty_until')::date ELSE v_asset.warranty_until END)
              < (CASE WHEN p_changes?'purchase_date' THEN (p_changes->>'purchase_date')::date ELSE v_asset.purchase_date END) THEN
                RAISE EXCEPTION 'Bei mindestens einem Artikel liegt das Garantieende vor dem Kaufdatum.';
            END IF;
        ELSE
            v_model := (v_entry->>'product_model_id')::bigint;
            v_location_id := (v_entry->>'storage_location_id')::bigint;
            v_source_condition := v_entry->>'condition';
            v_expected := (v_entry->>'quantity')::numeric;
            SELECT * INTO v_location FROM public.storage_locations WHERE id=v_location_id AND is_active AND department_id IS NOT NULL;
            IF NOT FOUND OR NOT private.site_access_allowed(v_location.site_id) THEN
                RAISE EXCEPTION 'Ein Lagerort ist nicht mehr verfügbar oder freigegeben.' USING ERRCODE='42501';
            END IF;
            IF NOT EXISTS (SELECT 1 FROM public.product_models WHERE id=v_model AND is_active AND tracking_mode IN ('hybrid','quantity')) THEN
                RAISE EXCEPTION 'Ein Mengenartikel ist nicht mehr verfügbar.';
            END IF;
            SELECT quantity INTO v_balance FROM public.stock_levels
              WHERE product_model_id=v_model AND storage_location_id=v_location_id AND condition=v_source_condition;
            IF NOT FOUND OR v_expected IS NULL OR v_expected <= 0 OR v_balance IS DISTINCT FROM v_expected THEN
                RAISE EXCEPTION 'Ein Lagerbestand wurde inzwischen geändert. Bitte Auswahl neu laden.' USING ERRCODE='40001';
            END IF;
        END IF;
    END LOOP;

    FOR v_entry IN SELECT value FROM jsonb_array_elements(p_entries) LOOP
        IF v_entry->>'type' = 'asset' THEN
            SELECT * INTO STRICT v_asset FROM public.assets WHERE id=(v_entry->>'id')::bigint;
            UPDATE public.assets SET
                condition=coalesce(v_condition,v_asset.condition),
                status=coalesce(p_changes->>'status',v_asset.status),
                purchase_date=CASE WHEN p_changes?'purchase_date' THEN (p_changes->>'purchase_date')::date ELSE v_asset.purchase_date END,
                warranty_until=CASE WHEN p_changes?'warranty_until' THEN (p_changes->>'warranty_until')::date ELSE v_asset.warranty_until END,
                new_price=CASE WHEN p_changes?'new_price' THEN (p_changes->>'new_price')::numeric ELSE v_asset.new_price END,
                note=CASE WHEN p_changes?'note' THEN nullif(p_changes->>'note','') ELSE v_asset.note END,
                updated_at=now()
            WHERE id=v_asset.id;
            IF NOT FOUND THEN RAISE EXCEPTION 'Ein Artikel konnte nicht geändert werden.' USING ERRCODE='42501'; END IF;
            v_changed := v_changed + 1;
        ELSIF v_entry->>'condition' <> v_condition THEN
            v_model := (v_entry->>'product_model_id')::bigint;
            v_location_id := (v_entry->>'storage_location_id')::bigint;
            v_source_condition := v_entry->>'condition';
            SELECT * INTO STRICT v_location FROM public.storage_locations WHERE id=v_location_id;
            v_key := 'stock:' || v_model || ':' || v_location_id || ':' || v_source_condition;
            v_target_key := 'stock:' || v_model || ':' || v_location_id || ':' || v_condition;
            SELECT * INTO v_image FROM public.inventory_images WHERE item_key=v_key AND is_current;
            SELECT * INTO v_metadata FROM public.stock_movements m
              WHERE m.product_model_id=v_model AND m.purchase_date IS NOT NULL
                AND ((m.from_storage_location_id=v_location_id AND m.from_condition=v_source_condition AND m.movement_type NOT IN ('transfer','condition_change'))
                  OR (m.to_storage_location_id=v_location_id AND m.to_condition=v_source_condition))
              ORDER BY m.moved_at DESC,m.id DESC LIMIT 1;
            IF EXISTS (SELECT 1 FROM public.stock_levels WHERE product_model_id=v_model AND storage_location_id=v_location_id
                      AND condition=v_condition AND quantity>0) THEN
                v_metadata.purchase_date := NULL;
            END IF;
            INSERT INTO public.stock_movements(product_model_id,from_storage_location_id,from_condition,to_storage_location_id,to_condition,
                quantity,movement_type,department_id,performed_by_employee_id,reference,note,purchase_date,new_price,status)
            VALUES(v_model,v_location_id,v_source_condition,v_location_id,v_condition,(v_entry->>'quantity')::numeric,
                'condition_change',v_location.department_id,v_actor,'Sammelbearbeitung',v_metadata.note,v_metadata.purchase_date,
                coalesce(v_metadata.new_price,0),coalesce(v_metadata.status,'available'));
            IF v_image.id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.inventory_images WHERE item_key=v_target_key AND is_current) THEN
                INSERT INTO public.inventory_images(item_key,site_id,image_data) VALUES(v_target_key,v_location.site_id,v_image.image_data);
            END IF;
            v_changed := v_changed + 1;
        END IF;
    END LOOP;
    RETURN v_changed;
END;
$fn$;
REVOKE ALL ON FUNCTION public.bulk_edit_inventory(jsonb,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.bulk_edit_inventory(jsonb,jsonb) TO authenticated;

-- Backup scope is shared by creation and recovery, in foreign key order.
CREATE FUNCTION private.inventory_backup_tables()
RETURNS text[] LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path=pg_catalog AS $fn$
    SELECT ARRAY['organizations','manufacturers','product_categories','sites','departments','site_departments',
      'storage_locations','employees','employee_site_access','product_models','software_products','software_licenses',
      'assets','inventory_images','inventory_archive','asset_locations','asset_assignments','asset_component_assignments',
      'stock_movements','stock_counts','stock_targets','software_installations','connection_test','audit_log','inventory_stock_requests'];
$fn$;
REVOKE ALL ON FUNCTION private.inventory_backup_tables() FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION private.inventory_backup_data()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=pg_catalog AS $fn$
DECLARE v_table text; v_rows jsonb; v_data jsonb := '{}'::jsonb;
BEGIN
    FOREACH v_table IN ARRAY private.inventory_backup_tables() LOOP
        EXECUTE format('SELECT coalesce(jsonb_agg(to_jsonb(t)),''[]''::jsonb) FROM public.%I t',v_table) INTO v_rows;
        v_data := jsonb_set(v_data,ARRAY[v_table],v_rows);
    END LOOP;
    RETURN jsonb_build_object('format','ITAssetFlow-Backup','version',1,'created_at',now(),'tables',v_data);
END;
$fn$;
REVOKE ALL ON FUNCTION private.inventory_backup_data() FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION private.inventory_backup_for_admin()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $fn$
BEGIN
    IF (SELECT auth.uid()) IS NULL OR NOT coalesce((SELECT private.is_admin()),false) THEN
        RAISE EXCEPTION 'Backups sind Administratoren vorbehalten.' USING ERRCODE='42501';
    END IF;
    RETURN private.inventory_backup_data();
END;
$fn$;
REVOKE ALL ON FUNCTION private.inventory_backup_for_admin() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION private.inventory_backup_for_admin() TO authenticated;

CREATE FUNCTION public.create_inventory_backup()
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog AS $fn$
    SELECT private.inventory_backup_for_admin();
$fn$;
REVOKE ALL ON FUNCTION public.create_inventory_backup() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.create_inventory_backup() TO authenticated;

-- Only the DB owner can recover into an empty, initialized target. FK and CHECK
-- constraints remain enabled. User triggers must not synthesize extra history.
CREATE FUNCTION private.restore_inventory_backup(p_backup jsonb, p_keep_auth_links boolean DEFAULT false)
RETURNS bigint LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $fn$
DECLARE
    v_tables text[] := private.inventory_backup_tables();
    v_table text;
    v_data jsonb := p_backup->'tables';
    v_columns text;
    v_trigger record;
    v_restore_triggers text[] := '{}';
    v_statement text;
    v_exists boolean;
    v_rel regclass;
    v_sequence text;
    v_next bigint;
    v_count bigint;
    v_total bigint := 0;
    v_rows jsonb;
BEGIN
    IF p_backup->>'format' IS DISTINCT FROM 'ITAssetFlow-Backup'
        OR p_backup->>'version' IS DISTINCT FROM '1'
        OR jsonb_typeof(v_data) IS DISTINCT FROM 'object'
        OR (v_data-v_tables) <> '{}'::jsonb THEN
        RAISE EXCEPTION 'Ungültiges ITAssetFlow-Backup.';
    END IF;
    FOREACH v_table IN ARRAY v_tables LOOP
        IF jsonb_typeof(v_data->v_table) IS DISTINCT FROM 'array' THEN
            RAISE EXCEPTION 'Im Backup fehlt die Tabelle %.',v_table;
        END IF;
        EXECUTE format('LOCK TABLE public.%I IN ACCESS EXCLUSIVE MODE',v_table);
        EXECUTE format('SELECT EXISTS (SELECT 1 FROM public.%I)',v_table) INTO v_exists;
        IF v_exists THEN
            RAISE EXCEPTION 'Wiederherstellung abgebrochen: Zieltabelle % ist nicht leer.',v_table;
        END IF;
    END LOOP;
    FOREACH v_table IN ARRAY v_tables LOOP
        v_rel := to_regclass(format('public.%I',v_table));
        SELECT string_agg(format('%I',attname),',' ORDER BY attnum) INTO v_columns
          FROM pg_attribute WHERE attrelid=v_rel AND attnum>0 AND NOT attisdropped AND attgenerated='';
        FOR v_trigger IN SELECT tgname,tgenabled FROM pg_trigger WHERE tgrelid=v_rel AND NOT tgisinternal AND tgenabled<>'D' LOOP
            EXECUTE format('ALTER TABLE public.%I DISABLE TRIGGER %I',v_table,v_trigger.tgname);
            v_restore_triggers := array_append(v_restore_triggers,format('ALTER TABLE public.%I %s TRIGGER %I',v_table,
              CASE v_trigger.tgenabled WHEN 'A' THEN 'ENABLE ALWAYS' WHEN 'R' THEN 'ENABLE REPLICA' ELSE 'ENABLE' END,v_trigger.tgname));
        END LOOP;
        v_rows := v_data->v_table;
        IF v_table='employees' AND NOT coalesce(p_keep_auth_links,false) THEN
            SELECT coalesce(jsonb_agg(value - 'auth_user_id'),'[]'::jsonb) INTO v_rows FROM jsonb_array_elements(v_rows);
        END IF;
        EXECUTE format('INSERT INTO public.%1$I (%2$s) OVERRIDING SYSTEM VALUE SELECT %2$s FROM jsonb_populate_recordset(NULL::public.%1$I,$1)',
          v_table,v_columns) USING v_rows;
        GET DIAGNOSTICS v_count = ROW_COUNT;
        v_total := v_total + v_count;
        IF EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid=v_rel AND attname='id' AND NOT attisdropped) THEN
            v_sequence := pg_get_serial_sequence(format('public.%I',v_table),'id');
            IF v_sequence IS NULL THEN
                -- Some older tables use a sequence in their DEFAULT without OWNED BY.
                SELECT seq.oid::regclass::text INTO v_sequence
                  FROM pg_attrdef d
                  JOIN pg_attribute a ON a.attrelid=d.adrelid AND a.attnum=d.adnum
                  JOIN pg_depend dep ON dep.classid='pg_attrdef'::regclass AND dep.objid=d.oid
                    AND dep.refclassid='pg_class'::regclass
                  JOIN pg_class seq ON seq.oid=dep.refobjid AND seq.relkind='S'
                  WHERE d.adrelid=v_rel AND a.attname='id' LIMIT 1;
            END IF;
            IF v_sequence IS NOT NULL THEN
                EXECUTE format('SELECT greatest(coalesce(max(id),0)+1,1) FROM public.%I',v_table) INTO v_next;
                EXECUTE format('ALTER SEQUENCE %s RESTART WITH %s',v_sequence::regclass,v_next);
            END IF;
        END IF;
    END LOOP;
    FOREACH v_statement IN ARRAY v_restore_triggers LOOP
        EXECUTE v_statement;
    END LOOP;
    RETURN v_total;
END;
$fn$;
REVOKE ALL ON FUNCTION private.restore_inventory_backup(jsonb,boolean) FROM PUBLIC,anon,authenticated,service_role;
NOTIFY pgrst,'reload schema';
