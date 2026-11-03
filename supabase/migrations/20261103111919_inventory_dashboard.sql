-- Transfers can hide a raw row through RLS even from a user who can see one
-- side. Return only the recorded unit price for each permitted stock bucket.
CREATE OR REPLACE FUNCTION private.dashboard_stock_prices()
RETURNS TABLE (product_model_id bigint, storage_location_id bigint, condition varchar, unit_price numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $fn$
  WITH locations AS MATERIALIZED (
    SELECT id FROM public.storage_locations WHERE private.site_access_allowed(site_id)
  )
  SELECT DISTINCT ON (m.product_model_id, leg.location_id, leg.state)
    m.product_model_id, leg.location_id, leg.state, m.new_price
  FROM public.stock_movements m
  CROSS JOIN LATERAL (VALUES
    (m.to_storage_location_id, m.to_condition, true),
    (m.from_storage_location_id, m.from_condition, m.movement_type NOT IN ('transfer','condition_change'))
  ) leg(location_id, state, include_price)
  JOIN locations l ON l.id = leg.location_id
  WHERE m.purchase_date IS NOT NULL AND leg.state IS NOT NULL AND leg.include_price
  ORDER BY m.product_model_id, leg.location_id, leg.state, m.moved_at DESC, m.id DESC;
$fn$;

-- An asset can have since left a site. Show that site's latest recorded
-- location change without returning asset identifiers or the other site.
CREATE OR REPLACE FUNCTION private.dashboard_location_activity()
RETURNS TABLE (site_id bigint, changed_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $fn$
  WITH locations AS MATERIALIZED (
    SELECT id, site_id FROM public.storage_locations WHERE private.site_access_allowed(site_id)
  )
  SELECT l.site_id, max(greatest(al.valid_from, al.valid_to))
  FROM public.asset_locations al JOIN locations l ON l.id = al.storage_location_id
  GROUP BY l.site_id;
$fn$;

REVOKE ALL ON FUNCTION private.dashboard_stock_prices(), private.dashboard_location_activity() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.dashboard_stock_prices(), private.dashboard_location_activity() TO authenticated;

CREATE OR REPLACE FUNCTION public.inventory_dashboard()
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = pg_catalog AS $fn$
  WITH asset_summary AS (
    SELECT l.site_id,
      count(*) AS assets,
      count(*) FILTER (WHERE a.status = 'in_use') AS in_use,
      count(*) FILTER (WHERE a.condition = 'defective' OR a.status IN ('defective','in_repair')) AS attention,
      sum(a.new_price) FILTER (WHERE a.new_price > 0) AS known_value,
      count(*) FILTER (WHERE a.new_price IS NULL OR a.new_price <= 0) AS missing_prices,
      max(greatest(a.created_at, a.updated_at)) AS changed_at
    FROM public.assets a
    LEFT JOIN public.storage_locations l ON l.id = a.last_storage_location_id
    WHERE a.archived_at IS NULL
    GROUP BY l.site_id
  ), balances AS MATERIALIZED (
    SELECT b.*, l.site_id FROM public.stock_levels b
    JOIN public.storage_locations l ON l.id = b.storage_location_id
  ), stock_summary AS (
    SELECT b.site_id,
      count(*) FILTER (WHERE b.quantity > 0) AS stock_positions,
      count(*) FILTER (WHERE b.quantity > 0 AND b.condition = 'defective') AS attention,
      sum(b.quantity * p.unit_price) FILTER (WHERE b.quantity > 0 AND p.unit_price > 0) AS known_value,
      count(*) FILTER (WHERE b.quantity > 0 AND (p.unit_price IS NULL OR p.unit_price <= 0)) AS missing_prices,
      max(b.updated_at) AS changed_at
    FROM balances b
    LEFT JOIN private.dashboard_stock_prices() p USING (product_model_id, storage_location_id, condition)
    GROUP BY b.site_id
  ), balance_totals AS (
    SELECT product_model_id, storage_location_id, sum(quantity) AS quantity
    FROM balances GROUP BY product_model_id, storage_location_id
  ), thresholds AS (
    SELECT l.site_id, count(*) AS configured,
      count(*) FILTER (WHERE coalesce(b.quantity, 0) < t.minimum_quantity) AS low_stock
    FROM public.stock_targets t
    JOIN public.storage_locations l ON l.id = t.storage_location_id
    LEFT JOIN balance_totals b USING (product_model_id, storage_location_id)
    WHERE t.minimum_quantity > 0 AND l.is_active
    GROUP BY l.site_id
  ), archive_activity AS (
    SELECT site_id, max(archived_at) AS changed_at FROM public.inventory_archive GROUP BY site_id
  ), count_activity AS (
    SELECT l.site_id, max(greatest(c.counted_at, c.created_at)) AS changed_at
    FROM public.stock_counts c JOIN public.storage_locations l ON l.id = c.storage_location_id
    GROUP BY l.site_id
  ), sites AS (
    SELECT id, name::text AS name FROM public.sites
    UNION ALL
    SELECT NULL::bigint, 'Ohne Standort'::text
    WHERE EXISTS (SELECT 1 FROM asset_summary WHERE site_id IS NULL)
  ), summary AS (
    SELECT s.id::text AS site_id, s.name,
      coalesce(a.assets, 0) AS assets, coalesce(a.in_use, 0) AS in_use,
      coalesce(b.stock_positions, 0) AS stock_positions,
      coalesce(a.attention, 0) + coalesce(b.attention, 0) AS attention,
      coalesce(a.known_value, 0) + coalesce(b.known_value, 0) AS known_value,
      coalesce(a.missing_prices, 0) + coalesce(b.missing_prices, 0) AS missing_prices,
      coalesce(t.configured, 0) AS configured_thresholds, coalesce(t.low_stock, 0) AS low_stock,
      greatest(a.changed_at, b.changed_at, l.changed_at, ar.changed_at, c.changed_at) AS changed_at
    FROM sites s
    LEFT JOIN asset_summary a ON a.site_id IS NOT DISTINCT FROM s.id
    LEFT JOIN stock_summary b ON b.site_id = s.id
    LEFT JOIN thresholds t ON t.site_id = s.id
    LEFT JOIN private.dashboard_location_activity() l ON l.site_id = s.id
    LEFT JOIN archive_activity ar ON ar.site_id = s.id
    LEFT JOIN count_activity c ON c.site_id = s.id
  )
  SELECT jsonb_build_object('sites', coalesce(jsonb_agg(to_jsonb(summary) ORDER BY name, site_id), '[]'::jsonb))
  FROM summary;
$fn$;

REVOKE ALL ON FUNCTION public.inventory_dashboard() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.inventory_dashboard() TO authenticated;
