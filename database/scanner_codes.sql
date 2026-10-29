-- Optionale Scanner-Kennungen. Bestehende Kennungen und Bestände bleiben erhalten.
-- Kann für eine weitere ITAssetFlow-Datenbank erneut ausgeführt werden.
BEGIN;

ALTER TABLE public.assets
  ADD COLUMN IF NOT EXISTS qr_code varchar(100),
  ADD COLUMN IF NOT EXISTS ean varchar(13);
ALTER TABLE public.product_models
  ADD COLUMN IF NOT EXISTS qr_code varchar(100),
  ADD COLUMN IF NOT EXISTS ean varchar(13);

CREATE INDEX IF NOT EXISTS assets_scanner_qr_idx ON public.assets (qr_code) WHERE qr_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS assets_scanner_ean_idx ON public.assets (ean) WHERE ean IS NOT NULL;
CREATE INDEX IF NOT EXISTS models_scanner_qr_idx ON public.product_models (qr_code) WHERE qr_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS models_scanner_ean_idx ON public.product_models (ean) WHERE ean IS NOT NULL;

COMMENT ON COLUMN public.assets.qr_code IS 'Optionale QR-Kennung des Einzelgeräts, unabhängig von Asset-Tag und Seriennummer.';
COMMENT ON COLUMN public.assets.ean IS 'Optionale EAN-8 oder EAN-13 als Text mit führenden Nullen; mehrere Geräte dürfen dieselbe EAN besitzen.';
COMMENT ON COLUMN public.product_models.qr_code IS 'Optionale QR-Kennung des Produktmodells; für Mengenbestand an allen Lagerorten.';
COMMENT ON COLUMN public.product_models.ean IS 'Optionale EAN-8 oder EAN-13 des Produktmodells als Text mit führenden Nullen.';

NOTIFY pgrst, 'reload schema';
COMMIT;

-- Erwartet werden vier optionale Spalten: je qr_code und ean in beiden Tabellen.
SELECT table_name, column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN ('assets', 'product_models')
  AND column_name IN ('qr_code', 'ean')
ORDER BY table_name, column_name;
