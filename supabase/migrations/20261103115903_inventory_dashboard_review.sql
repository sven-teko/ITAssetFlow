CREATE OR REPLACE FUNCTION public.inventory_dashboard()
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = pg_catalog AS $fn$
  WITH settings AS (
    SELECT 180 AS review_days
  ), asset_positions AS MATERIALIZED (
    SELECT a.id, l.site_id, l.name AS location_name,
      coalesce(m.name, 'Einzelartikel')::text AS item_name,
      a.asset_tag, a.new_price, a.status, a.condition,
      greatest(a.created_at, a.updated_at) AS changed_at
    FROM public.assets a
    LEFT JOIN public.storage_locations l ON l.id = a.last_storage_location_id
    LEFT JOIN public.product_models m ON m.id = a.product_model_id
    WHERE a.archived_at IS NULL
  ), asset_summary AS (
    SELECT site_id, count(*) AS assets,
      count(*) FILTER (WHERE status = 'in_use') AS in_use,
      count(*) FILTER (WHERE condition = 'defective' OR status IN ('defective','in_repair')) AS attention,
      sum(new_price) AS known_value,
      count(*) FILTER (WHERE new_price IS NULL) AS missing_prices
    FROM asset_positions GROUP BY site_id
  ), balances AS MATERIALIZED (
    SELECT b.*, l.site_id, l.name AS location_name, coalesce(m.name, 'Mengenartikel')::text AS item_name
    FROM public.stock_levels b
    JOIN public.storage_locations l ON l.id = b.storage_location_id
    LEFT JOIN public.product_models m ON m.id = b.product_model_id
  ), stock_summary AS (
    SELECT b.site_id,
      count(*) FILTER (WHERE b.quantity > 0) AS stock_positions,
      count(*) FILTER (WHERE b.quantity > 0 AND b.condition = 'defective') AS attention,
      sum(b.quantity * p.unit_price) FILTER (WHERE b.quantity > 0) AS known_value,
      count(*) FILTER (WHERE b.quantity > 0 AND p.unit_price IS NULL) AS missing_prices
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
  ), events AS (
    SELECT site_id, changed_at, concat_ws(' · ', item_name, nullif(asset_tag, '')) AS item, 2 AS priority
    FROM asset_positions
    UNION ALL SELECT site_id, updated_at, item_name, 1 FROM balances
    UNION ALL SELECT site_id, archived_at, label, 4 FROM public.inventory_archive
    UNION ALL
      SELECT l.site_id, greatest(c.counted_at, c.created_at), coalesce(m.name, 'Mengenartikel'), 3
      FROM public.stock_counts c JOIN public.storage_locations l ON l.id = c.storage_location_id
      LEFT JOIN public.product_models m ON m.id = c.product_model_id
    UNION ALL
      SELECT l.site_id, greatest(al.valid_from, al.valid_to),
        concat_ws(' · ', coalesce(m.name, 'Einzelartikel'), nullif(a.asset_tag, '')), 3
      FROM public.asset_locations al JOIN public.storage_locations l ON l.id = al.storage_location_id
      JOIN public.assets a ON a.id = al.asset_id
      LEFT JOIN public.product_models m ON m.id = a.product_model_id
    -- Keep the timestamp when the asset itself is no longer visible at that site.
    UNION ALL SELECT site_id, changed_at, NULL::text, 0 FROM private.dashboard_location_activity()
  ), latest AS (
    SELECT DISTINCT ON (site_id) site_id, changed_at, item
    FROM events WHERE changed_at IS NOT NULL
    ORDER BY site_id, changed_at DESC, priority DESC, item
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
      e.changed_at, e.item AS latest_item
    FROM sites s
    LEFT JOIN asset_summary a ON a.site_id IS NOT DISTINCT FROM s.id
    LEFT JOIN stock_summary b ON b.site_id = s.id
    LEFT JOIN thresholds t ON t.site_id = s.id
    LEFT JOIN latest e ON e.site_id IS NOT DISTINCT FROM s.id
  ), positions AS (
    SELECT 'asset:'||id AS key, site_id, item_name, nullif(asset_tag, '') AS asset_tag,
      location_name, changed_at,
      CASE WHEN status = 'in_repair' THEN 'in_repair'
           WHEN status = 'defective' OR condition = 'defective' THEN 'defective' END AS issue
    FROM asset_positions
    UNION ALL
    SELECT concat('stock:', product_model_id, ':', storage_location_id, ':', condition),
      site_id, item_name, NULL, location_name, updated_at,
      CASE WHEN condition = 'defective' THEN 'defective' END
    FROM balances WHERE quantity > 0
  ), flagged AS (
    SELECT p.key, p.item_name, p.asset_tag, s.name AS site_name, p.location_name, p.changed_at, p.issue,
      coalesce(p.changed_at <= now() - make_interval(days => settings.review_days), false) AS stale
    FROM positions p JOIN sites s ON s.id IS NOT DISTINCT FROM p.site_id CROSS JOIN settings
  )
  SELECT jsonb_build_object(
    'sites', (SELECT coalesce(jsonb_agg(to_jsonb(summary) ORDER BY name, site_id), '[]'::jsonb) FROM summary),
    'review_after_days', (SELECT review_days FROM settings),
    'review_items', (SELECT coalesce(jsonb_agg(to_jsonb(flagged) ORDER BY (issue IS NOT NULL) DESC, changed_at ASC NULLS LAST, key), '[]'::jsonb)
                     FROM flagged WHERE issue IS NOT NULL OR stale)
  );
$fn$;
