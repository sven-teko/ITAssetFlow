CREATE UNIQUE INDEX IF NOT EXISTS asset_components_active_child_uq
  ON public.asset_component_assignments(child_asset_id) WHERE removed_at IS NULL;

-- A cycle can pass through a site the caller cannot see. The trigger checks
-- the whole graph and returns only a generic error, never hidden identifiers.
CREATE OR REPLACE FUNCTION public.prevent_asset_component_cycle()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('inventory-component-graph',0));
  IF NEW.removed_at IS NOT NULL THEN RETURN NEW; END IF;
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

CREATE OR REPLACE FUNCTION public.save_inventory_entry_with_connections(p_payload jsonb,p_editing boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $fn$
DECLARE
  v_changes jsonb := p_payload->'connection_changes';
  v_request uuid := (p_payload->>'request_id')::uuid;
  v_add bigint[];
  v_remove bigint[];
  v_asset bigint;
  v_result jsonb;
BEGIN
  PERFORM private.inventory_writer();
  IF jsonb_typeof(v_changes) IS DISTINCT FROM 'object'
    OR jsonb_typeof(v_changes->'add') IS DISTINCT FROM 'array'
    OR jsonb_typeof(v_changes->'remove') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Ungültige Produktverbindungen.';
  END IF;
  IF jsonb_array_length(v_changes->'add')>500 OR jsonb_array_length(v_changes->'remove')>500 THEN
    RAISE EXCEPTION 'Pro Speichervorgang sind höchstens 500 Verbindungen möglich.';
  END IF;
  IF v_request IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('stock-request:'||v_request::text,0));
    IF EXISTS (SELECT 1 FROM public.inventory_stock_requests WHERE id=v_request) THEN
      RETURN public.save_inventory_entry(p_payload,p_editing);
    END IF;
  END IF;
  SELECT ARRAY(SELECT DISTINCT value::bigint FROM jsonb_array_elements_text(v_changes->'add')) INTO v_add;
  SELECT ARRAY(SELECT DISTINCT value::bigint FROM jsonb_array_elements_text(v_changes->'remove')) INTO v_remove;
  IF array_position(v_add,NULL) IS NOT NULL OR array_position(v_remove,NULL) IS NOT NULL
    OR v_add && v_remove THEN RAISE EXCEPTION 'Ungültige Produktverbindungen.'; END IF;

  v_result := public.save_inventory_entry(p_payload,p_editing);
  IF v_result->>'entry_type' IS DISTINCT FROM 'asset' THEN
    RAISE EXCEPTION 'Nur Einzelartikel können verbunden werden.';
  END IF;
  v_asset := (v_result->>'id')::bigint;
  IF v_asset=ANY(v_add) OR v_asset=ANY(v_remove) THEN
    RAISE EXCEPTION 'Ein Artikel kann nicht mit sich selbst verbunden werden.';
  END IF;
  IF (SELECT count(*) FROM public.assets WHERE id=ANY(v_add) AND archived_at IS NULL AND status<>'retired') <> cardinality(v_add) THEN
    RAISE EXCEPTION 'Ein verbundener Artikel ist nicht verfügbar oder nicht freigegeben.' USING ERRCODE='42501';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('inventory-component-graph',0));
  UPDATE public.asset_component_assignments SET removed_at=now()
  WHERE parent_asset_id=v_asset AND child_asset_id=ANY(v_remove) AND removed_at IS NULL;
  BEGIN
    INSERT INTO public.asset_component_assignments(parent_asset_id,child_asset_id)
    SELECT v_asset, child FROM unnest(v_add) child
    WHERE NOT EXISTS (SELECT 1 FROM public.asset_component_assignments
      WHERE parent_asset_id=v_asset AND child_asset_id=child AND removed_at IS NULL);
  EXCEPTION WHEN unique_violation OR exclusion_violation THEN
    RAISE EXCEPTION 'Ein ausgewählter Artikel ist bereits mit einem anderen Hauptartikel verbunden. Bitte löse zuerst diese Verbindung.' USING ERRCODE='23505';
  END;
  RETURN v_result;
END;
$fn$;
REVOKE ALL ON FUNCTION public.save_inventory_entry_with_connections(jsonb,boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_inventory_entry_with_connections(jsonb,boolean) TO authenticated;
