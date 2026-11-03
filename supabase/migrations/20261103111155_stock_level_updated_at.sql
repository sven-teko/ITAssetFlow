-- Include the latest recorded booking for each permitted location and condition.
-- Both sides of a transfer count, without exposing the other location.
CREATE OR REPLACE FUNCTION private.scoped_stock_levels_with_dates()
RETURNS TABLE (
  product_model_id bigint, storage_location_id bigint, quantity numeric,
  condition varchar, updated_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $fn$
  SELECT m.product_model_id, leg.location_id, sum(leg.delta), leg.state, max(m.recorded_at)
  FROM public.stock_movements m
  CROSS JOIN LATERAL (VALUES
    (m.to_storage_location_id, m.quantity, m.to_condition),
    (m.from_storage_location_id, -m.quantity, m.from_condition)
  ) leg(location_id, delta, state)
  JOIN public.storage_locations l ON l.id = leg.location_id
  WHERE leg.state IS NOT NULL AND (
    ((SELECT auth.uid()) IS NOT NULL AND private.site_access_allowed(l.site_id))
    OR ((SELECT auth.uid()) IS NULL AND session_user IN ('postgres', 'supabase_admin'))
  )
  GROUP BY m.product_model_id, leg.location_id, leg.state;
$fn$;

REVOKE ALL ON FUNCTION private.scoped_stock_levels_with_dates() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.scoped_stock_levels_with_dates() TO authenticated;

CREATE OR REPLACE FUNCTION private.scoped_stock_levels()
RETURNS TABLE (product_model_id bigint, storage_location_id bigint, quantity numeric, condition varchar)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $fn$
  SELECT product_model_id, storage_location_id, quantity, condition
  FROM private.scoped_stock_levels_with_dates();
$fn$;

CREATE OR REPLACE VIEW public.stock_levels WITH (security_invoker = true) AS
SELECT product_model_id, storage_location_id, quantity, condition::varchar(30) AS condition, updated_at
FROM private.scoped_stock_levels_with_dates();
