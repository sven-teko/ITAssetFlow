-- Optionale Scanner-Kennungen. Bestehende Kennungen und Bestände bleiben erhalten.
-- Kann für eine weitere ITAssetFlow-Datenbank erneut ausgeführt werden.
BEGIN;

ALTER TABLE public.assets
  ADD COLUMN IF NOT EXISTS qr_code varchar(100),
  ADD COLUMN IF NOT EXISTS ean varchar(13);
ALTER TABLE public.product_models
  ADD COLUMN IF NOT EXISTS qr_code varchar(100),
  ADD COLUMN IF NOT EXISTS ean varchar(13),
  ADD COLUMN IF NOT EXISTS upc varchar(12);

CREATE INDEX IF NOT EXISTS assets_scanner_qr_idx ON public.assets (qr_code) WHERE qr_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS assets_scanner_ean_idx ON public.assets (ean) WHERE ean IS NOT NULL;
CREATE INDEX IF NOT EXISTS models_scanner_qr_idx ON public.product_models (qr_code) WHERE qr_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS models_scanner_ean_idx ON public.product_models (ean) WHERE ean IS NOT NULL;
CREATE INDEX IF NOT EXISTS models_scanner_upc_idx ON public.product_models (upc) WHERE upc IS NOT NULL;

COMMENT ON COLUMN public.assets.qr_code IS 'Optionale QR-Kennung des Einzelgeräts, unabhängig von Asset-Tag und Seriennummer.';
COMMENT ON COLUMN public.assets.ean IS 'Historische EAN des Einzelgeräts. Die für das Produkt massgebliche EAN steht in product_models.ean.';
COMMENT ON COLUMN public.product_models.qr_code IS 'Optionale QR-Kennung des Produktmodells; für Mengenbestand an allen Lagerorten.';
COMMENT ON COLUMN public.product_models.ean IS 'Optionale EAN-8 oder EAN-13 des Produktmodells als Text mit führenden Nullen.';
COMMENT ON COLUMN public.product_models.upc IS 'Optionale UPC-A (GTIN-12) des Produktmodells; unabhängig von der EAN.';

-- Übernimm Altwerte nur, wenn alle erfassten Einzelgeräte des Modells übereinstimmen.
WITH legacy AS (
  SELECT product_model_id, min(ean) AS ean
    FROM public.assets WHERE nullif(ean, '') IS NOT NULL
   GROUP BY product_model_id
  HAVING count(DISTINCT ean) = 1
)
UPDATE public.product_models AS model
   SET ean = legacy.ean
  FROM legacy
 WHERE model.id = legacy.product_model_id
   AND nullif(model.ean, '') IS NULL
   AND legacy.ean ~ '^([0-9]{8}|[0-9]{13})$';

-- Die Verknüpfung erfolgt in derselben Transaktion wie die Artikelerfassung.
CREATE OR REPLACE FUNCTION private.link_asset_ean_to_model()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog AS $fn$
DECLARE
  model_ean text;
BEGIN
  IF nullif(NEW.ean, '') IS NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND NEW.ean IS NOT DISTINCT FROM OLD.ean THEN
    IF NEW.product_model_id IS DISTINCT FROM OLD.product_model_id THEN
      NEW.ean := NULL; -- Eine alte Kopie gehört nicht zum neuen Modell.
    END IF;
    RETURN NEW;
  END IF;
  SELECT nullif(ean, '') INTO model_ean FROM public.product_models
    WHERE id = NEW.product_model_id FOR NO KEY UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Das Produktmodell der EAN ist nicht verfügbar.' USING ERRCODE = '42501';
  END IF;
  IF model_ean IS NOT NULL AND model_ean <> NEW.ean THEN
    RAISE EXCEPTION 'Dieses Produktmodell hat bereits eine andere EAN. Bitte prüfe das Produktmodell.' USING ERRCODE = '23514';
  END IF;
  IF model_ean IS NULL THEN
    UPDATE public.product_models SET ean = NEW.ean WHERE id = NEW.product_model_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Die EAN kann bei diesem Produktmodell nicht gespeichert werden.' USING ERRCODE = '42501';
    END IF;
  END IF;
  -- Neue Eingaben werden nur am Modell gespeichert; unveränderte Altwerte bleiben lesbar.
  NEW.ean := NULL;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION private.link_asset_ean_to_model() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.link_asset_ean_to_model() TO authenticated;
DROP TRIGGER IF EXISTS assets_link_ean_to_model ON public.assets;
CREATE TRIGGER assets_link_ean_to_model BEFORE INSERT OR UPDATE OF ean, product_model_id
  ON public.assets FOR EACH ROW EXECUTE FUNCTION private.link_asset_ean_to_model();

-- Add UPC without splitting the existing article, stock and relation transaction.
CREATE OR REPLACE FUNCTION public.save_inventory_entry_with_upc(p_payload jsonb,p_editing boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog AS $fn$
DECLARE
  v_upc text := nullif(btrim(p_payload->'scanner_codes'->>'upc'),'');
  v_model_id bigint;
  v_current text;
  v_result jsonb;
BEGIN
  IF v_upc IS NULL OR v_upc !~ '^[0-9]{12}$' THEN
    RAISE EXCEPTION 'UPC-A muss 12 Ziffern enthalten.' USING ERRCODE='23514';
  END IF;
  IF (SELECT sum(substring(v_upc,i,1)::int * CASE WHEN i%2=1 THEN 3 ELSE 1 END)
      FROM generate_series(1,12) i) % 10 <> 0 THEN
    RAISE EXCEPTION 'Die UPC-A-Prüfziffer ist ungültig.' USING ERRCODE='23514';
  END IF;
  IF p_payload ? 'connection_changes' THEN
    v_result := public.save_inventory_entry_with_connections(p_payload,p_editing);
  ELSE
    v_result := public.save_inventory_entry(p_payload,p_editing);
  END IF;
  v_model_id := (v_result->>'product_model_id')::bigint;
  SELECT nullif(upc,'') INTO v_current FROM public.product_models WHERE id=v_model_id FOR NO KEY UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Produktmodell nicht verfügbar.' USING ERRCODE='42501'; END IF;
  IF v_current IS NOT NULL AND v_current <> v_upc THEN
    RAISE EXCEPTION 'Das Produktmodell hat bereits eine andere UPC. Bitte das Modell prüfen.' USING ERRCODE='23514';
  END IF;
  IF v_current IS NULL THEN
    UPDATE public.product_models SET upc=v_upc WHERE id=v_model_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Die UPC kann nicht gespeichert werden.' USING ERRCODE='42501'; END IF;
  END IF;
  RETURN v_result;
END;
$fn$;
REVOKE ALL ON FUNCTION public.save_inventory_entry_with_upc(jsonb,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.save_inventory_entry_with_upc(jsonb,boolean) TO authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;

-- Je QR-Code und EAN in beiden Tabellen, zusätzlich UPC am Produktmodell.
SELECT table_name, column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN ('assets', 'product_models')
  AND column_name IN ('qr_code', 'ean', 'upc')
ORDER BY table_name, column_name;
