-- Reuse the dashboard's site-scoped unit price in the inventory read path.
-- Booking RPCs still use stock_levels without evaluating the price lookup.
CREATE OR REPLACE VIEW public.inventory_stock_levels WITH (security_invoker = true) AS
SELECT b.product_model_id, b.storage_location_id, b.quantity, b.condition, b.updated_at,
       p.unit_price AS new_price
FROM public.stock_levels b
LEFT JOIN private.dashboard_stock_prices() p USING (product_model_id, storage_location_id, condition)
WHERE b.quantity > 0;

REVOKE ALL ON public.inventory_stock_levels FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.inventory_stock_levels TO authenticated;
NOTIFY pgrst, 'reload schema';
