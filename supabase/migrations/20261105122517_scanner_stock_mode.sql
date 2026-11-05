-- Enable a quantity receipt on an existing serialized model without splitting the save.
CREATE OR REPLACE FUNCTION public.save_inventory_entry_with_stock_mode(p_payload jsonb, p_editing boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $fn$
DECLARE
  v_model_id bigint := (p_payload->'model'->>'id')::bigint;
  v_location_id bigint := (p_payload->>'storage_location_id')::bigint;
  v_request uuid := (p_payload->>'request_id')::uuid;
BEGIN
  PERFORM private.inventory_writer();
  IF p_editing IS DISTINCT FROM false
     OR p_payload->'enable_stock_for_model' IS DISTINCT FROM 'true'::jsonb
     OR p_payload->'model'->>'mode' IS DISTINCT FROM 'existing'
     OR p_payload->>'entry_type' IS DISTINCT FROM 'stock'
     OR v_model_id IS NULL OR v_request IS NULL THEN
    RAISE EXCEPTION 'Mengenbestand kann hier nur für ein bestehendes Produktmodell eröffnet werden.' USING ERRCODE='23514';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.storage_locations WHERE id=v_location_id AND is_active AND department_id IS NOT NULL)
     OR NOT coalesce(private.location_access_allowed(v_location_id), false) THEN
    RAISE EXCEPTION 'Bitte einen aktiven, freigegebenen Lagerort wählen.' USING ERRCODE='42501';
  END IF;

  -- Same lock order as save_inventory_entry: request before model.
  PERFORM pg_advisory_xact_lock(hashtextextended('stock-request:'||v_request::text,0));
  IF NOT EXISTS (SELECT 1 FROM public.inventory_stock_requests WHERE id=v_request) THEN
    UPDATE public.product_models SET tracking_mode='hybrid', updated_at=now()
      WHERE id=v_model_id AND is_active AND tracking_mode='serialized';
  END IF;

  IF nullif(btrim(p_payload->'scanner_codes'->>'upc'), '') IS NOT NULL THEN
    RETURN public.save_inventory_entry_with_upc(p_payload, false);
  END IF;
  RETURN public.save_inventory_entry(p_payload, false);
END;
$fn$;

REVOKE ALL ON FUNCTION public.save_inventory_entry_with_stock_mode(jsonb, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_inventory_entry_with_stock_mode(jsonb, boolean) TO authenticated;
NOTIFY pgrst, 'reload schema';
