-- The entire import runs as the caller in one database transaction.
CREATE FUNCTION public.import_inventory_snapshot(p_tables jsonb)
RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $fn$
DECLARE
  v_tables text[] := ARRAY['organizations','manufacturers','product_categories','sites','departments',
    'site_departments','storage_locations','employees','employee_site_access','product_models','software_products',
    'software_licenses','assets','inventory_images','inventory_archive','asset_locations','asset_assignments',
    'asset_component_assignments','stock_movements','stock_counts','stock_targets','software_installations','connection_test'];
  v_table text;
  v_keys text[];
  v_columns text[];
  v_input jsonb;
  v_row jsonb;
  v_existing jsonb;
  v_new jsonb;
  v_column_list text;
  v_update_list text;
  v_match text;
  v_total integer := 0;
  v_pass integer;
  v_affected integer;
BEGIN
  IF NOT coalesce(private.is_admin(),false) THEN
    RAISE EXCEPTION 'Nur Administratoren dürfen Inventardaten importieren.' USING ERRCODE='42501';
  END IF;
  IF jsonb_typeof(p_tables) IS DISTINCT FROM 'object' OR (p_tables-v_tables)<>'{}'::jsonb THEN
    RAISE EXCEPTION 'Ungültige Tabellen im ITAssetFlow-Import.';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('inventory-snapshot-import',0));
  FOREACH v_table IN ARRAY v_tables LOOP
    IF NOT (p_tables ? v_table) THEN CONTINUE; END IF;
    IF jsonb_typeof(p_tables->v_table) IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION 'Ungültige Zeilen für Tabelle %.',v_table;
    END IF;
    IF jsonb_array_length(p_tables->v_table)=0 THEN CONTINUE; END IF;
    v_keys := CASE v_table WHEN 'site_departments' THEN ARRAY['site_id','department_id']
      WHEN 'employee_site_access' THEN ARRAY['employee_id','site_id']
      WHEN 'stock_targets' THEN ARRAY['product_model_id','storage_location_id'] ELSE ARRAY['id'] END;
    SELECT array_agg(attname::text ORDER BY attnum) INTO v_columns FROM pg_attribute
      WHERE attrelid=to_regclass(format('public.%I',v_table)) AND attnum>0 AND NOT attisdropped AND attgenerated='';
    SELECT string_agg(format('t.%1$I=i.%1$I',k),' AND ') INTO v_match FROM unnest(v_keys) k;
    FOR v_pass IN 1..(CASE WHEN v_table='storage_locations' THEN 2 ELSE 1 END) LOOP
      FOR v_input IN SELECT value FROM jsonb_array_elements(p_tables->v_table) LOOP
        IF jsonb_typeof(v_input) IS DISTINCT FROM 'object'
          OR EXISTS (SELECT 1 FROM unnest(v_keys) k WHERE v_input->>k IS NULL) THEN
          RAISE EXCEPTION 'Ein Datensatz in % hat keinen gültigen Schlüssel.',v_table;
        END IF;
        v_row := v_input;
        IF v_table='stock_counts' THEN v_row:=v_row-'difference_quantity'; END IF;
        IF v_table='assets' THEN v_row:=v_row-'last_storage_location_id'; END IF;
        IF v_columns IS NULL OR v_row-v_columns<>'{}'::jsonb THEN
          RAISE EXCEPTION 'Unbekannte Spalten in Tabelle %.',v_table;
        END IF;
        IF v_table='storage_locations' AND v_pass=1 THEN v_row:=v_row-'parent_location_id'; END IF;
        -- Compare after coercing SQL types (numeric, timestamp, UUID, etc.).
        EXECUTE format('SELECT to_jsonb(t),to_jsonb(i) FROM jsonb_populate_record(NULL::public.%1$I,$1) i
          LEFT JOIN public.%1$I t ON %2$s',v_table,v_match) INTO v_existing,v_new USING v_row;
        IF v_existing IS NOT NULL AND NOT EXISTS (
          SELECT 1 FROM jsonb_object_keys(v_row) k WHERE v_existing->k IS DISTINCT FROM v_new->k
        ) THEN
          CONTINUE;
        END IF;
        IF v_table IN ('stock_movements','stock_counts') AND v_existing IS NOT NULL THEN
          RAISE EXCEPTION 'Eine vorhandene Lagerbuchung oder Inventurzählung weicht von der Importdatei ab. Der Import wurde vollständig zurückgerollt.';
        END IF;
        IF v_table='stock_counts' AND (v_row->>'adjustment_movement_id' IS NOT NULL
          OR (v_row->>'expected_quantity')::numeric IS DISTINCT FROM (v_row->>'counted_quantity')::numeric) THEN
          RAISE EXCEPTION 'Historische Inventurzählungen mit Bestandskorrektur bitte über eine Wiederherstellung einspielen.';
        END IF;
        IF v_table='stock_counts' THEN
          PERFORM pg_advisory_xact_lock(hashtextextended(
            concat_ws(':',v_row->>'product_model_id',v_row->>'storage_location_id',v_row->>'condition'),0));
          IF coalesce((SELECT quantity FROM public.stock_levels b
            WHERE b.product_model_id=(v_row->>'product_model_id')::bigint
              AND b.storage_location_id=(v_row->>'storage_location_id')::bigint
              AND b.condition=v_row->>'condition'),0) IS DISTINCT FROM (v_row->>'counted_quantity')::numeric THEN
            RAISE EXCEPTION 'Der importierte Zählstand stimmt nicht mit dem aktuellen Bestand überein.';
          END IF;
        END IF;
        SELECT string_agg(format('%I',k),',' ORDER BY k),
          string_agg(format('%1$I=i.%1$I',k),',' ORDER BY k) FILTER (WHERE NOT (k=ANY(v_keys)))
        INTO v_column_list,v_update_list FROM jsonb_object_keys(v_row) k;
        IF v_existing IS NULL THEN
          EXECUTE format('INSERT INTO public.%1$I (%2$s) OVERRIDING SYSTEM VALUE
            SELECT %2$s FROM jsonb_populate_record(NULL::public.%1$I,$1)',v_table,v_column_list) USING v_row;
        ELSIF v_update_list IS NOT NULL THEN
          EXECUTE format('UPDATE public.%1$I t SET %2$s FROM jsonb_populate_record(NULL::public.%1$I,$1) i
            WHERE %3$s',v_table,v_update_list,v_match) USING v_row;
          GET DIAGNOSTICS v_affected=ROW_COUNT;
          IF v_affected<>1 THEN RAISE EXCEPTION 'Ein Datensatz in % konnte nicht aktualisiert werden.',v_table; END IF;
        END IF;
      END LOOP;
    END LOOP;
    v_total:=v_total+jsonb_array_length(p_tables->v_table);
  END LOOP;
  IF v_total=0 THEN RAISE EXCEPTION 'Die Importdatei enthält keine ITAssetFlow-Datensätze.'; END IF;
  RETURN v_total;
END;
$fn$;
REVOKE ALL ON FUNCTION public.import_inventory_snapshot(jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.import_inventory_snapshot(jsonb) TO authenticated;

-- Preserve connection history, but free accessories as soon as an endpoint
-- goes to the archive. The archive guard already authorizes the asset change.
CREATE FUNCTION private.end_connections_on_asset_archive()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('inventory-component-graph',0));
  UPDATE public.asset_component_assignments
    SET removed_at=greatest(NEW.archived_at,installed_at)
    WHERE removed_at IS NULL AND (parent_asset_id=NEW.id OR child_asset_id=NEW.id);
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION private.end_connections_on_asset_archive() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER assets_end_archived_connections AFTER UPDATE OF archived_at ON public.assets
  FOR EACH ROW WHEN (OLD.archived_at IS NULL AND NEW.archived_at IS NOT NULL)
  EXECUTE FUNCTION private.end_connections_on_asset_archive();

UPDATE public.asset_component_assignments r
SET removed_at=greatest(now(),r.installed_at)
WHERE r.removed_at IS NULL AND EXISTS (
  SELECT 1 FROM public.assets a WHERE a.id IN (r.parent_asset_id,r.child_asset_id) AND a.archived_at IS NOT NULL
);

CREATE OR REPLACE FUNCTION public.prevent_asset_component_cycle()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('inventory-component-graph',0));
  IF NEW.removed_at IS NOT NULL THEN RETURN NEW; END IF;
  IF EXISTS (SELECT 1 FROM public.assets WHERE id IN (NEW.parent_asset_id,NEW.child_asset_id) AND archived_at IS NOT NULL) THEN
    RAISE EXCEPTION 'Archivierte Artikel können nicht verbunden werden.';
  END IF;
  IF NEW.parent_asset_id=NEW.child_asset_id THEN
    RAISE EXCEPTION 'Ein Artikel kann nicht mit sich selbst verbunden werden.';
  END IF;
  IF EXISTS (
    WITH RECURSIVE descendants(id) AS (
      SELECT NEW.child_asset_id
      UNION
      SELECT r.child_asset_id FROM public.asset_component_assignments r JOIN descendants d ON r.parent_asset_id=d.id
      WHERE r.removed_at IS NULL AND r.id IS DISTINCT FROM NEW.id
    )
    SELECT 1 FROM descendants WHERE id=NEW.parent_asset_id
  ) THEN
    RAISE EXCEPTION 'Diese Verbindung würde einen Kreis zwischen den Artikeln bilden.';
  END IF;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.prevent_asset_component_cycle() FROM PUBLIC, anon, authenticated;

NOTIFY pgrst,'reload schema';
