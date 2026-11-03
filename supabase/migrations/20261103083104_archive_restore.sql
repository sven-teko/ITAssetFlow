-- Restore the original record or reverse one archived stock withdrawal atomically.
CREATE OR REPLACE FUNCTION private.protect_archived_asset()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $fn$
BEGIN
  IF (SELECT auth.uid()) IS NOT NULL THEN
    IF OLD.archived_at IS NOT NULL AND NEW IS DISTINCT FROM OLD AND NOT (
      NEW.archived_at IS NULL AND (SELECT private.is_admin())
      AND (to_jsonb(NEW)-ARRAY['archived_at','updated_at'])=(to_jsonb(OLD)-ARRAY['archived_at','updated_at'])
      AND EXISTS (
        SELECT 1 FROM public.inventory_archive ar
        WHERE ar.source_key='asset:'||OLD.id::text AND ar.record_type='asset' AND ar.archived_at=OLD.archived_at
      )
    ) THEN
      RAISE EXCEPTION 'Archivierte Artikel können nicht bearbeitet werden.' USING ERRCODE='42501';
    END IF;
    IF OLD.archived_at IS NULL AND NEW.archived_at IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.inventory_archive WHERE source_key='asset:'||OLD.id::text AND archived_by=(SELECT auth.uid())
    ) THEN RAISE EXCEPTION 'Bitte den Artikel mit einem Löschgrund archivieren.'; END IF;
  END IF;
  RETURN NEW;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.restore_inventory_archive(p_archive_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $fn$
DECLARE
  v_archive public.inventory_archive%ROWTYPE;
  v_location public.storage_locations%ROWTYPE;
  v_key text;
  v_model bigint;
  v_asset bigint;
  v_location_id bigint;
  v_condition text;
  v_quantity numeric := 1;
  v_actor bigint;
  v_withdrawal bigint;
  v_reference text;
BEGIN
  IF (SELECT auth.uid()) IS NULL OR NOT (SELECT private.is_admin()) THEN
    RAISE EXCEPTION 'Nur Administratoren können Artikel wiederaufnehmen.' USING ERRCODE='42501';
  END IF;
  SELECT source_key INTO v_key FROM public.inventory_archive WHERE id=p_archive_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Dieser Archiveintrag ist nicht mehr vorhanden.' USING ERRCODE='P0002'; END IF;

  -- Same lock order as book_inventory_stock: model, item, stock balance.
  IF v_key ~ '^stock:[0-9]+:[0-9]+:[a-z_]+$' THEN
    v_model:=split_part(v_key,':',2)::bigint;
    v_location_id:=split_part(v_key,':',3)::bigint;
    v_condition:=split_part(v_key,':',4);
    PERFORM 1 FROM public.product_models
      WHERE id=v_model AND is_active AND tracking_mode IN ('quantity','hybrid') FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Das ursprüngliche Produktmodell führt keinen aktiven Mengenbestand.'; END IF;
  ELSIF v_key ~ '^asset:[0-9]+$' THEN
    v_asset:=split_part(v_key,':',2)::bigint;
  ELSE
    RAISE EXCEPTION 'Der Archiveintrag enthält keine gültige Artikelkennung.';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('inventory-item:'||v_key,0));
  IF v_model IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(v_model::text||':'||v_location_id::text||':'||v_condition,0));
  END IF;
  -- A concurrent hard delete makes the final DELETE fail and rolls back the restore.
  SELECT * INTO v_archive FROM public.inventory_archive WHERE id=p_archive_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Dieser Archiveintrag ist nicht mehr vorhanden.' USING ERRCODE='P0002'; END IF;

  IF v_asset IS NOT NULL THEN
    SELECT coalesce(al.storage_location_id,a.last_storage_location_id) INTO v_location_id
    FROM public.assets a
    LEFT JOIN LATERAL (SELECT storage_location_id FROM public.asset_locations
      WHERE asset_id=a.id ORDER BY (valid_to IS NULL) DESC,valid_from DESC,id DESC LIMIT 1) al ON true
    WHERE a.id=v_asset AND a.archived_at=v_archive.archived_at FOR UPDATE OF a;
    IF NOT FOUND OR v_archive.record_type<>'asset' THEN
      RAISE EXCEPTION 'Der ursprüngliche Einzelartikel ist nicht mehr archiviert.';
    END IF;
  ELSIF v_archive.record_type<>'stock' THEN
    RAISE EXCEPTION 'Der Archiveintrag enthält keinen gültigen Mengenbestand.';
  END IF;
  SELECT * INTO v_location FROM public.storage_locations
    WHERE id=v_location_id AND site_id=v_archive.site_id AND is_active FOR SHARE;
  IF NOT FOUND OR NOT private.site_access_allowed(v_location.site_id) THEN
    RAISE EXCEPTION 'Der ursprüngliche Lagerort ist nicht mehr aktiv oder freigegeben.';
  END IF;

  IF v_asset IS NOT NULL THEN
    UPDATE public.assets SET archived_at=NULL,updated_at=now()
      WHERE id=v_asset AND archived_at=v_archive.archived_at;
    IF NOT FOUND THEN RAISE EXCEPTION 'Der ursprüngliche Einzelartikel ist nicht mehr archiviert.'; END IF;
  ELSE
    IF v_location.department_id IS NULL THEN RAISE EXCEPTION 'Dem ursprünglichen Lagerort fehlt eine Abteilung.'; END IF;
    v_quantity:=(v_archive.snapshot->>'stock_quantity')::numeric;
    -- Both archival paths write the outgoing movement in the same transaction.
    SELECT sm.id INTO v_withdrawal FROM public.stock_movements sm
    WHERE sm.product_model_id=v_model AND sm.from_storage_location_id=v_location_id
      AND sm.from_condition=v_condition AND sm.to_storage_location_id IS NULL
      AND sm.quantity=v_quantity AND sm.moved_at=v_archive.archived_at
      AND (sm.movement_type='issue' AND sm.reference LIKE 'STOCK:%'
        OR sm.movement_type='adjustment' AND sm.note='Ins Archiv verschoben.')
    ORDER BY sm.id DESC LIMIT 1;
    IF NOT FOUND THEN RAISE EXCEPTION 'Die ursprüngliche Lagerentnahme zu diesem Archiveintrag wurde nicht gefunden.'; END IF;
    v_reference:='ARCHIVE-RESTORE:'||v_withdrawal::text;
    IF EXISTS (SELECT 1 FROM public.stock_movements WHERE reference=v_reference) THEN
      RAISE EXCEPTION 'Diese Lagerentnahme wurde bereits zurückgebucht.';
    END IF;
    SELECT id INTO v_actor FROM public.employees WHERE auth_user_id=(SELECT auth.uid()) AND is_active LIMIT 1;
    IF v_actor IS NULL THEN RAISE EXCEPTION 'Kein aktiver Mitarbeiter zur Anmeldung gefunden.' USING ERRCODE='42501'; END IF;
    INSERT INTO public.stock_movements(product_model_id,to_storage_location_id,to_condition,quantity,movement_type,
      department_id,performed_by_employee_id,reference,note)
    VALUES(v_model,v_location_id,v_condition,v_quantity,'return',v_location.department_id,v_actor,v_reference,'Aus dem Archiv zurückgebucht.');
  END IF;

  IF v_archive.image_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.inventory_images WHERE item_key=v_key AND is_current
  ) THEN
    UPDATE public.inventory_images SET is_current=true
      WHERE id=v_archive.image_id AND item_key=v_key AND NOT is_current;
  END IF;
  DELETE FROM public.inventory_archive WHERE id=p_archive_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Dieser Archiveintrag ist nicht mehr vorhanden.' USING ERRCODE='P0002'; END IF;
  RETURN jsonb_build_object('restored',true,'quantity',v_quantity,'key',v_key);
END;
$fn$;
REVOKE ALL ON FUNCTION public.restore_inventory_archive(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.restore_inventory_archive(uuid) TO authenticated;
NOTIFY pgrst,'reload schema';
