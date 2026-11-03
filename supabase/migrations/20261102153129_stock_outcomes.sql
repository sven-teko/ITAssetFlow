-- Wiederholte Anfragen nach einem Verbindungsabbruch buchen nicht doppelt.
CREATE TABLE public.inventory_stock_requests (
  id uuid PRIMARY KEY,
  actor_id uuid NOT NULL DEFAULT auth.uid(),
  site_id bigint NOT NULL REFERENCES public.sites(id),
  target_site_id bigint REFERENCES public.sites(id),
  payload jsonb NOT NULL,
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX inventory_stock_requests_actor_idx ON public.inventory_stock_requests(actor_id,created_at);
CREATE INDEX inventory_stock_requests_site_idx ON public.inventory_stock_requests(site_id);
CREATE INDEX inventory_stock_requests_target_idx ON public.inventory_stock_requests(target_site_id) WHERE target_site_id IS NOT NULL;
ALTER TABLE public.inventory_stock_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.inventory_stock_requests FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT ON public.inventory_stock_requests TO authenticated;
CREATE POLICY stock_requests_read ON public.inventory_stock_requests FOR SELECT TO authenticated
 USING (actor_id=(SELECT auth.uid()) AND private.site_access_allowed(site_id)
   AND (target_site_id IS NULL OR private.site_access_allowed(target_site_id)));
CREATE POLICY stock_requests_insert ON public.inventory_stock_requests FOR INSERT TO authenticated
 WITH CHECK ((SELECT private.can_edit_inventory()) AND actor_id=(SELECT auth.uid()) AND private.site_access_allowed(site_id)
   AND (target_site_id IS NULL OR private.site_access_allowed(target_site_id)));

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
 SELECT * INTO v_model FROM public.product_models WHERE id=p_model FOR UPDATE;
 IF v_model.id IS NULL OR NOT v_model.is_active OR v_model.tracking_mode NOT IN ('quantity','hybrid') THEN RAISE EXCEPTION 'Das Produktmodell führt keinen aktiven Mengenbestand.'; END IF;
 SELECT id,concat_ws(' ',first_name,last_name) INTO v_actor,v_actor_name FROM public.employees
  WHERE auth_user_id=(SELECT auth.uid()) AND is_active LIMIT 1;
 IF v_actor IS NULL THEN RAISE EXCEPTION 'Kein aktiver Mitarbeiter zur Anmeldung gefunden.' USING ERRCODE='42501'; END IF;
 v_key:='stock:'||p_model::text||':'||p_location::text||':'||p_condition;
 PERFORM pg_advisory_xact_lock(hashtextextended('inventory-item:'||v_key,0));
 PERFORM pg_advisory_xact_lock(hashtextextended(p_model::text||':'||p_location::text||':'||p_condition,0));
 SELECT coalesce(quantity,0) INTO v_balance FROM public.stock_levels WHERE product_model_id=p_model AND storage_location_id=p_location AND condition=p_condition;
 v_balance:=coalesce(v_balance,0);
 IF p_direction='remove' AND (v_balance<p_quantity OR (p_expected_quantity IS NOT NULL AND p_expected_quantity<>v_balance)) THEN
  RAISE EXCEPTION 'Der Lagerbestand wurde inzwischen geändert oder reicht nicht aus. Bitte erneut prüfen.' USING ERRCODE='40001';
 END IF;
 SELECT to_jsonb(sm) INTO v_metadata FROM public.stock_movements sm WHERE sm.product_model_id=p_model AND sm.purchase_date IS NOT NULL
  AND ((sm.to_storage_location_id=p_location AND sm.to_condition=p_condition) OR (sm.from_storage_location_id=p_location AND sm.from_condition=p_condition))
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
       coalesce(v_metadata->>'status','available'),v_asset,'STOCK:'||p_request_id::text,'Aus Mengenbestand als Einzelartikel übernommen.');
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
     coalesce(v_metadata->>'status','available'),'STOCK:'||p_request_id::text,coalesce(v_note,CASE WHEN p_direction='add' THEN 'Scanner-Zugang.' ELSE 'Entnahme ins Archiv.' END)) RETURNING id INTO v_movement;
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
