ALTER TABLE public.assets ADD COLUMN IF NOT EXISTS mac_address varchar(17);
ALTER TABLE public.assets ADD COLUMN IF NOT EXISTS archived_at timestamptz;
CREATE INDEX IF NOT EXISTS assets_mac_address_idx ON public.assets(mac_address) WHERE mac_address IS NOT NULL;
CREATE INDEX IF NOT EXISTS assets_active_idx ON public.assets(id) WHERE archived_at IS NULL;

CREATE TABLE public.inventory_images (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_key text NOT NULL CHECK (length(item_key) BETWEEN 1 AND 100),
  site_id bigint NOT NULL REFERENCES public.sites(id),
  image_data text NOT NULL CHECK (length(image_data) BETWEEN 1 AND 1400000),
  content_type text NOT NULL DEFAULT 'image/webp' CHECK (content_type = 'image/webp'),
  is_current boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid DEFAULT auth.uid()
);
CREATE UNIQUE INDEX inventory_images_current_idx ON public.inventory_images(item_key) WHERE is_current;
CREATE INDEX inventory_images_site_idx ON public.inventory_images(site_id);

CREATE TABLE public.inventory_archive (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_key text NOT NULL,
  record_type text NOT NULL CHECK (record_type IN ('asset','stock')),
  label text NOT NULL,
  site_id bigint NOT NULL REFERENCES public.sites(id),
  snapshot jsonb NOT NULL CHECK (jsonb_typeof(snapshot) = 'object'),
  image_id uuid REFERENCES public.inventory_images(id),
  reason text NOT NULL CHECK (reason IN ('customer','defective','retired','lost','other')),
  customer_name text CHECK (length(customer_name) <= 200),
  destroyed boolean,
  note text CHECK (length(note) <= 2000),
  archived_at timestamptz NOT NULL DEFAULT now(),
  archived_by uuid DEFAULT auth.uid(),
  archived_by_name text NOT NULL,
  CHECK (reason <> 'customer' OR coalesce(length(btrim(customer_name)),0) > 0),
  CHECK (reason <> 'defective' OR destroyed IS NOT NULL),
  CHECK (reason <> 'other' OR coalesce(length(btrim(note)),0) > 0)
);
CREATE INDEX inventory_archive_site_time_idx ON public.inventory_archive(site_id,archived_at DESC);
CREATE INDEX inventory_archive_source_idx ON public.inventory_archive(source_key);
CREATE INDEX inventory_archive_image_idx ON public.inventory_archive(image_id) WHERE image_id IS NOT NULL;

CREATE OR REPLACE FUNCTION private.inventory_item_site(p_key text)
RETURNS bigint LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = pg_catalog AS $fn$
DECLARE v_site bigint;
BEGIN
  IF p_key ~ '^asset:[0-9]+$' THEN
    SELECT l.site_id INTO v_site FROM public.assets a
    LEFT JOIN LATERAL (SELECT storage_location_id FROM public.asset_locations
      WHERE asset_id=a.id ORDER BY (valid_to IS NULL) DESC, valid_from DESC, id DESC LIMIT 1) al ON true
    JOIN public.storage_locations l ON l.id=coalesce(al.storage_location_id,a.last_storage_location_id)
    WHERE a.id=split_part(p_key,':',2)::bigint AND a.archived_at IS NULL;
  ELSIF p_key ~ '^stock:[0-9]+:[0-9]+:[a-z_]+$' THEN
    SELECT l.site_id INTO v_site FROM public.stock_levels s
    JOIN public.storage_locations l ON l.id=s.storage_location_id
    WHERE s.product_model_id=split_part(p_key,':',2)::bigint
      AND s.storage_location_id=split_part(p_key,':',3)::bigint
      AND s.condition=split_part(p_key,':',4) AND s.quantity>0;
  END IF;
  RETURN v_site;
END;
$fn$;
REVOKE ALL ON FUNCTION private.inventory_item_site(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION private.inventory_item_site(text) TO authenticated;

-- Separate, eng begrenzte Prüfung vermeidet gegenseitige RLS-Rekursion von Bild und Archiv.
CREATE OR REPLACE FUNCTION private.inventory_image_matches_item(p_image uuid,p_key text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $fn$
  SELECT coalesce((SELECT private.can_edit_inventory()),false)
    AND private.site_access_allowed(private.inventory_item_site(p_key))
    AND EXISTS (SELECT 1 FROM public.inventory_images WHERE id=p_image AND item_key=p_key AND is_current);
$fn$;
REVOKE ALL ON FUNCTION private.inventory_image_matches_item(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION private.inventory_image_matches_item(uuid,text) TO authenticated;

ALTER TABLE public.inventory_images ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_archive ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.inventory_images,public.inventory_archive FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON public.inventory_images TO authenticated;
GRANT SELECT,INSERT ON public.inventory_archive TO authenticated;
CREATE POLICY images_read ON public.inventory_images FOR SELECT TO authenticated
  USING ((SELECT private.can_read_inventory()) AND (
    private.site_access_allowed(private.inventory_item_site(item_key))
    OR (NOT is_current AND EXISTS (SELECT 1 FROM public.inventory_archive ar WHERE ar.image_id=inventory_images.id))));
CREATE POLICY images_insert ON public.inventory_images FOR INSERT TO authenticated
  WITH CHECK ((SELECT private.can_edit_inventory()) AND created_by=(SELECT auth.uid())
    AND private.site_access_allowed(site_id) AND site_id=private.inventory_item_site(item_key));
CREATE POLICY images_update ON public.inventory_images FOR UPDATE TO authenticated
  USING ((SELECT private.can_edit_inventory()) AND (
    private.site_access_allowed(private.inventory_item_site(item_key))
    OR EXISTS (SELECT 1 FROM public.inventory_archive ar WHERE ar.image_id=inventory_images.id)))
  WITH CHECK ((SELECT private.can_edit_inventory()) AND (
    private.site_access_allowed(private.inventory_item_site(item_key))
    OR (NOT is_current AND EXISTS (SELECT 1 FROM public.inventory_archive ar WHERE ar.image_id=inventory_images.id))));
CREATE POLICY archive_read ON public.inventory_archive FOR SELECT TO authenticated
  USING ((SELECT private.can_read_inventory()) AND private.site_access_allowed(site_id));
CREATE POLICY archive_insert ON public.inventory_archive FOR INSERT TO authenticated
  WITH CHECK ((SELECT private.can_edit_inventory()) AND archived_by=(SELECT auth.uid()) AND private.site_access_allowed(site_id)
    AND site_id=private.inventory_item_site(source_key)
    AND (image_id IS NULL OR private.inventory_image_matches_item(image_id,source_key)));

CREATE OR REPLACE FUNCTION private.protect_inventory_image()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $fn$
BEGIN
  IF (NEW.id,NEW.item_key,NEW.site_id,NEW.image_data,NEW.content_type,NEW.created_at,NEW.created_by)
    IS DISTINCT FROM (OLD.id,OLD.item_key,OLD.site_id,OLD.image_data,OLD.content_type,OLD.created_at,OLD.created_by) THEN
    RAISE EXCEPTION 'Gespeicherte Bilder werden durch ein neues Bild ersetzt.' USING ERRCODE='42501';
  END IF;
  RETURN NEW;
END;
$fn$;
CREATE TRIGGER inventory_image_immutable BEFORE UPDATE ON public.inventory_images
 FOR EACH ROW EXECUTE FUNCTION private.protect_inventory_image();

CREATE OR REPLACE FUNCTION public.set_inventory_image(p_key text,p_image_data text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $fn$
DECLARE v_site bigint; v_id uuid;
BEGIN
  IF NOT coalesce((SELECT private.can_edit_inventory()),false) THEN RAISE EXCEPTION 'Keine Bearbeitungsberechtigung.' USING ERRCODE='42501'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('inventory-item:'||p_key,0));
  v_site:=private.inventory_item_site(p_key);
  IF v_site IS NULL OR NOT private.site_access_allowed(v_site) THEN RAISE EXCEPTION 'Artikel nicht gefunden oder nicht freigegeben.' USING ERRCODE='42501'; END IF;
  IF p_image_data IS NOT NULL AND (length(p_image_data)>1400000 OR octet_length(decode(p_image_data,'base64'))>1048576) THEN
    RAISE EXCEPTION 'Das Artikelbild ist zu gross.';
  END IF;
  UPDATE public.inventory_images SET is_current=false WHERE item_key=p_key AND is_current;
  IF p_image_data IS NOT NULL THEN
    INSERT INTO public.inventory_images(item_key,site_id,image_data) VALUES(p_key,v_site,p_image_data) RETURNING id INTO v_id;
  END IF;
  RETURN v_id;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.archive_inventory_items(p_keys text[],p_reason jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $fn$
DECLARE v_key text; v_site bigint; v_snapshot jsonb; v_image uuid; v_id uuid;
 v_model bigint; v_location bigint; v_condition text; v_qty numeric;
 v_actor bigint; v_actor_name text; v_assets integer:=0; v_stock integer:=0;
 v_reason text:=p_reason->>'reason'; v_customer text:=nullif(btrim(p_reason->>'customer_name'),'');
 v_note text:=nullif(btrim(p_reason->>'note'),''); v_destroyed boolean;
BEGIN
  IF NOT coalesce((SELECT private.can_edit_inventory()),false) THEN RAISE EXCEPTION 'Keine Bearbeitungsberechtigung.' USING ERRCODE='42501'; END IF;
  IF coalesce(cardinality(p_keys),0) NOT BETWEEN 1 AND 1000 THEN RAISE EXCEPTION 'Bitte 1 bis 1000 Artikel auswählen.'; END IF;
  IF v_reason NOT IN ('customer','defective','retired','lost','other') OR v_reason IS NULL THEN RAISE EXCEPTION 'Ein Löschgrund ist erforderlich.'; END IF;
  IF v_reason='customer' AND v_customer IS NULL THEN RAISE EXCEPTION 'Bitte den Kundennamen angeben.'; END IF;
  IF v_reason='other' AND v_note IS NULL THEN RAISE EXCEPTION 'Bitte den Löschgrund beschreiben.'; END IF;
  IF v_reason='defective' THEN
    IF jsonb_typeof(p_reason->'destroyed') <> 'boolean' OR p_reason->'destroyed' IS NULL THEN RAISE EXCEPTION 'Bitte angeben, ob der Artikel vernichtet wurde.'; END IF;
    v_destroyed:=(p_reason->>'destroyed')::boolean;
  END IF;
  SELECT id,concat_ws(' ',first_name,last_name) INTO v_actor,v_actor_name FROM public.employees WHERE auth_user_id=(SELECT auth.uid()) AND is_active LIMIT 1;
  FOR v_key IN SELECT DISTINCT unnest(p_keys) ORDER BY 1 LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended('inventory-item:'||v_key,0));
    v_site:=private.inventory_item_site(v_key);
    IF v_site IS NULL OR NOT private.site_access_allowed(v_site) THEN RAISE EXCEPTION 'Artikel nicht gefunden oder nicht freigegeben.' USING ERRCODE='42501'; END IF;
    SELECT id INTO v_image FROM public.inventory_images WHERE item_key=v_key AND is_current;
    IF v_key LIKE 'asset:%' THEN
      PERFORM 1 FROM public.assets WHERE id=split_part(v_key,':',2)::bigint FOR UPDATE;
      v_site:=private.inventory_item_site(v_key);
      IF v_site IS NULL OR NOT private.site_access_allowed(v_site) THEN RAISE EXCEPTION 'Artikel nicht gefunden oder nicht freigegeben.' USING ERRCODE='42501'; END IF;
      SELECT to_jsonb(a)||jsonb_build_object('_record_type','asset','product_model_name',m.name,
        'product_category_name',c.name,'manufacturer_name',mf.name,'site_id',v_site,'site_name',s.name,
        'storage_location_id',l.id,'storage_location',l.name,'department_name',d.name,'image_id',v_image,
        'assigned_employee_id',aa.employee_id,'assigned_to',coalesce(nullif(concat_ws(' ',e.first_name,e.last_name),''),ad.name),
        'assigned_department_name',ad.name,'model_specifications',m.specifications)
      INTO v_snapshot FROM public.assets a JOIN public.product_models m ON m.id=a.product_model_id
      LEFT JOIN public.product_categories c ON c.id=m.category_id LEFT JOIN public.manufacturers mf ON mf.id=m.manufacturer_id
      JOIN public.sites s ON s.id=v_site
      LEFT JOIN LATERAL (SELECT storage_location_id FROM public.asset_locations WHERE asset_id=a.id
        ORDER BY (valid_to IS NULL) DESC,valid_from DESC,id DESC LIMIT 1) al ON true
      LEFT JOIN public.storage_locations l ON l.id=coalesce(al.storage_location_id,a.last_storage_location_id)
      LEFT JOIN public.departments d ON d.id=l.department_id
      LEFT JOIN LATERAL (SELECT employee_id,department_id FROM public.asset_assignments WHERE asset_id=a.id AND valid_to IS NULL
        ORDER BY valid_from DESC,id DESC LIMIT 1) aa ON true
      LEFT JOIN public.employees e ON e.id=aa.employee_id LEFT JOIN public.departments ad ON ad.id=aa.department_id
      WHERE a.id=split_part(v_key,':',2)::bigint AND a.archived_at IS NULL;
      IF v_snapshot IS NULL THEN RAISE EXCEPTION 'Der Artikel wurde inzwischen archiviert.'; END IF;
      v_assets:=v_assets+1;
    ELSE
      v_model:=split_part(v_key,':',2)::bigint; v_location:=split_part(v_key,':',3)::bigint; v_condition:=split_part(v_key,':',4);
      PERFORM pg_advisory_xact_lock(hashtextextended(v_model::text||':'||v_location::text||':'||v_condition,0));
      SELECT quantity INTO v_qty FROM public.stock_levels WHERE product_model_id=v_model AND storage_location_id=v_location AND condition=v_condition;
      IF coalesce(v_qty,0)<=0 THEN RAISE EXCEPTION 'Der Mengenbestand ist bereits leer.'; END IF;
      SELECT jsonb_build_object('id',v_key,'_record_type','stock','product_model_id',m.id,'product_model_name',m.name,
        'product_category_name',c.name,'manufacturer_name',mf.name,'condition',v_condition,'stock_quantity',v_qty,
        'qr_code',m.qr_code,'ean',m.ean,'product_model_sku',m.sku,'product_model_part_number',m.part_number,'specifications',m.specifications,
        'storage_location_id',l.id,'storage_location',l.name,'site_id',v_site,'site_name',s.name,'department_name',d.name,'image_id',v_image)
        ||coalesce((SELECT jsonb_build_object('purchase_date',sm.purchase_date,'new_price',sm.new_price,'status',sm.status,'note',sm.note)
          FROM public.stock_movements sm WHERE sm.product_model_id=v_model AND sm.purchase_date IS NOT NULL
          AND ((sm.to_storage_location_id=v_location AND sm.to_condition=v_condition) OR (sm.from_storage_location_id=v_location AND sm.from_condition=v_condition))
          ORDER BY sm.moved_at DESC,sm.id DESC LIMIT 1),'{}'::jsonb)
      INTO v_snapshot FROM public.product_models m LEFT JOIN public.product_categories c ON c.id=m.category_id
      LEFT JOIN public.manufacturers mf ON mf.id=m.manufacturer_id JOIN public.storage_locations l ON l.id=v_location
      JOIN public.sites s ON s.id=v_site LEFT JOIN public.departments d ON d.id=l.department_id WHERE m.id=v_model;
      v_stock:=v_stock+1;
    END IF;
    INSERT INTO public.inventory_archive(source_key,record_type,label,site_id,snapshot,image_id,reason,customer_name,destroyed,note,archived_by_name)
    VALUES(v_key,CASE WHEN v_key LIKE 'asset:%' THEN 'asset' ELSE 'stock' END,
      coalesce(v_snapshot->>'asset_tag',v_snapshot->>'product_model_name',v_key),v_site,v_snapshot,v_image,
      v_reason,v_customer,v_destroyed,v_note,coalesce(nullif(v_actor_name,''),'Benutzer')) RETURNING id INTO v_id;
    UPDATE public.inventory_images SET is_current=false WHERE item_key=v_key AND is_current;
    IF v_key LIKE 'asset:%' THEN
      UPDATE public.assets SET archived_at=now(),updated_at=now() WHERE id=split_part(v_key,':',2)::bigint;
    ELSE
      INSERT INTO public.stock_movements(product_model_id,from_storage_location_id,from_condition,quantity,movement_type,performed_by_employee_id,department_id,note)
      SELECT v_model,v_location,v_condition,v_qty,'adjustment',v_actor,department_id,'Ins Archiv verschoben.' FROM public.storage_locations WHERE id=v_location;
    END IF;
  END LOOP;
  RETURN jsonb_build_object('deleted_count',v_assets+v_stock,'asset_count',v_assets,'stock_count',v_stock);
END;
$fn$;
REVOKE ALL ON FUNCTION public.set_inventory_image(text,text),public.archive_inventory_items(text[],jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.set_inventory_image(text,text),public.archive_inventory_items(text[],jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION private.protect_archived_asset()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $fn$
BEGIN
  IF (SELECT auth.uid()) IS NOT NULL THEN
    IF OLD.archived_at IS NOT NULL AND NEW IS DISTINCT FROM OLD THEN
      RAISE EXCEPTION 'Archivierte Artikel können nicht bearbeitet werden.' USING ERRCODE='42501';
    END IF;
    IF OLD.archived_at IS NULL AND NEW.archived_at IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.inventory_archive WHERE source_key='asset:'||OLD.id::text AND archived_by=(SELECT auth.uid())
    ) THEN RAISE EXCEPTION 'Bitte den Artikel mit einem Löschgrund archivieren.'; END IF;
  END IF;
  RETURN NEW;
END;
$fn$;
CREATE TRIGGER assets_archive_guard BEFORE UPDATE ON public.assets FOR EACH ROW EXECUTE FUNCTION private.protect_archived_asset();
CREATE TRIGGER inventory_images_revision AFTER INSERT OR UPDATE ON public.inventory_images FOR EACH STATEMENT EXECUTE FUNCTION public.bump_inventory_change_revision();
CREATE TRIGGER inventory_archive_revision AFTER INSERT ON public.inventory_archive FOR EACH STATEMENT EXECUTE FUNCTION public.bump_inventory_change_revision();
NOTIFY pgrst,'reload schema';
