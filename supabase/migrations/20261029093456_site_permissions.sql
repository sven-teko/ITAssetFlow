-- Per-user site access. Existing linked users retain their current sites once.
DO $seed$
BEGIN
  IF to_regclass('public.employee_site_access') IS NULL THEN
    CREATE TABLE public.employee_site_access (
      employee_id bigint NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
      site_id bigint NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
      PRIMARY KEY (employee_id, site_id)
    );
    INSERT INTO public.employee_site_access (employee_id, site_id)
      SELECT e.id, s.id FROM public.employees e CROSS JOIN public.sites s
      WHERE e.auth_user_id IS NOT NULL;
  END IF;
END;
$seed$;
ALTER TABLE public.employee_site_access ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS employee_site_access_site_idx ON public.employee_site_access (site_id);
REVOKE ALL ON public.employee_site_access FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.employee_site_access TO authenticated;
DROP POLICY IF EXISTS site_access_read ON public.employee_site_access;
CREATE POLICY site_access_read ON public.employee_site_access FOR SELECT TO authenticated
  USING ((SELECT private.is_admin()) OR employee_id IN (SELECT id FROM public.employees WHERE auth_user_id = (SELECT auth.uid())));
DROP POLICY IF EXISTS site_access_admin ON public.employee_site_access;
CREATE POLICY site_access_admin ON public.employee_site_access FOR ALL TO authenticated
  USING ((SELECT private.is_admin())) WITH CHECK ((SELECT private.is_admin()));

CREATE OR REPLACE FUNCTION private.site_access_allowed(p_site_id bigint)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $fn$
  SELECT (SELECT auth.uid()) IS NOT NULL AND (SELECT private.can_read_inventory()) AND (
    (SELECT private.is_admin()) OR EXISTS (
      SELECT 1 FROM public.employee_site_access a JOIN public.employees e ON e.id = a.employee_id
      WHERE e.auth_user_id = (SELECT auth.uid()) AND e.is_active AND a.site_id = p_site_id
    )
  );
$fn$;
CREATE OR REPLACE FUNCTION private.location_access_allowed(p_location_id bigint)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $fn$
  SELECT (SELECT auth.uid()) IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.storage_locations l WHERE l.id = p_location_id AND private.site_access_allowed(l.site_id)
  );
$fn$;
CREATE OR REPLACE FUNCTION private.department_access_allowed(p_department_id bigint)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $fn$
  SELECT (SELECT auth.uid()) IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.departments d WHERE d.id = p_department_id AND private.site_access_allowed(d.site_id)
  );
$fn$;
CREATE OR REPLACE FUNCTION private.employee_access_allowed(p_employee_id bigint)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $fn$
  SELECT (SELECT auth.uid()) IS NOT NULL AND (SELECT private.can_read_inventory()) AND EXISTS (
    SELECT 1 FROM public.employees e WHERE e.id = p_employee_id AND (
      (SELECT private.is_admin()) OR e.auth_user_id = (SELECT auth.uid()) OR private.department_access_allowed(e.department_id)
    )
  );
$fn$;

-- INSERT RETURNING must work before the first location has been attached.
-- Only the creator can see their own as-yet-unlocated asset; established assets
-- remain tied to their current / last known location, never their creator.
ALTER TABLE public.assets ADD COLUMN IF NOT EXISTS created_by_auth_user_id uuid DEFAULT auth.uid();
ALTER TABLE public.assets ADD COLUMN IF NOT EXISTS last_storage_location_id bigint REFERENCES public.storage_locations(id) ON DELETE SET NULL;
UPDATE public.assets a SET last_storage_location_id = (
  SELECT al.storage_location_id FROM public.asset_locations al WHERE al.asset_id = a.id
  ORDER BY (al.valid_to IS NULL) DESC, al.valid_from DESC, al.id DESC LIMIT 1
) WHERE last_storage_location_id IS NULL;
CREATE OR REPLACE FUNCTION private.protect_asset_creator()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog AS $fn$
BEGIN
  IF (SELECT auth.uid()) IS NOT NULL AND NOT (SELECT private.is_admin()) THEN
    IF TG_OP = 'INSERT' THEN
      NEW.created_by_auth_user_id := (SELECT auth.uid());
      NEW.last_storage_location_id := NULL;
    ELSIF NEW.created_by_auth_user_id IS DISTINCT FROM OLD.created_by_auth_user_id THEN
      RAISE EXCEPTION 'Die Erstellerkennung kann nicht geändert werden.' USING ERRCODE = '42501';
    END IF;
    IF TG_OP = 'UPDATE' AND current_user = 'authenticated' AND NEW.last_storage_location_id IS DISTINCT FROM OLD.last_storage_location_id THEN
      RAISE EXCEPTION 'Der Standortanker kann nur durch eine Lagerortzuordnung geändert werden.' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$fn$;
DROP TRIGGER IF EXISTS assets_protect_creator ON public.assets;
CREATE TRIGGER assets_protect_creator BEFORE INSERT OR UPDATE ON public.assets
  FOR EACH ROW EXECUTE FUNCTION private.protect_asset_creator();
CREATE OR REPLACE FUNCTION private.remember_asset_location()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $fn$
BEGIN
  UPDATE public.assets a SET last_storage_location_id = (
    SELECT al.storage_location_id FROM public.asset_locations al WHERE al.asset_id = NEW.asset_id
    ORDER BY (al.valid_to IS NULL) DESC, al.valid_from DESC, al.id DESC LIMIT 1
  ) WHERE a.id = NEW.asset_id;
  RETURN NEW;
END;
$fn$;
DROP TRIGGER IF EXISTS remember_asset_site ON public.asset_locations;
CREATE TRIGGER remember_asset_site AFTER INSERT OR UPDATE ON public.asset_locations
  FOR EACH ROW EXECUTE FUNCTION private.remember_asset_location();
CREATE INDEX IF NOT EXISTS asset_locations_site_scope_idx ON public.asset_locations (asset_id, valid_from DESC, id DESC);

CREATE OR REPLACE FUNCTION private.asset_access_allowed(p_asset_id bigint)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $fn$
  SELECT (SELECT auth.uid()) IS NOT NULL AND (SELECT private.can_read_inventory()) AND (
    (SELECT private.is_admin()) OR EXISTS (
      SELECT 1 FROM public.assets a
      LEFT JOIN LATERAL (
        SELECT l.site_id FROM public.asset_locations al JOIN public.storage_locations l ON l.id = al.storage_location_id
        WHERE al.asset_id = a.id
        ORDER BY (al.valid_to IS NULL) DESC, al.valid_from DESC, al.id DESC LIMIT 1
      ) located ON true
      WHERE a.id = p_asset_id AND CASE WHEN coalesce(located.site_id, (SELECT l.site_id FROM public.storage_locations l WHERE l.id = a.last_storage_location_id)) IS NOT NULL
        THEN private.site_access_allowed(coalesce(located.site_id, (SELECT l.site_id FROM public.storage_locations l WHERE l.id = a.last_storage_location_id)))
        ELSE a.created_by_auth_user_id = (SELECT auth.uid()) AND EXISTS (
          SELECT 1 FROM public.employee_site_access sa JOIN public.employees e ON e.id = sa.employee_id
          WHERE e.auth_user_id = (SELECT auth.uid()) AND e.is_active
        ) END
    )
  );
$fn$;

-- Restrictive policies are ANDed with the existing role policies.
DROP POLICY IF EXISTS site_scope ON public.sites;
CREATE POLICY site_scope ON public.sites AS RESTRICTIVE FOR ALL TO authenticated
  USING (private.site_access_allowed(id)) WITH CHECK ((SELECT private.is_admin()));
DROP POLICY IF EXISTS site_scope ON public.departments;
CREATE POLICY site_scope ON public.departments AS RESTRICTIVE FOR ALL TO authenticated
  USING (private.site_access_allowed(site_id)) WITH CHECK ((SELECT private.is_admin()));
DROP POLICY IF EXISTS site_scope ON public.storage_locations;
CREATE POLICY site_scope ON public.storage_locations AS RESTRICTIVE FOR ALL TO authenticated
  USING (private.site_access_allowed(site_id)) WITH CHECK ((SELECT private.is_admin()));
DROP POLICY IF EXISTS site_scope ON public.site_departments;
CREATE POLICY site_scope ON public.site_departments AS RESTRICTIVE FOR ALL TO authenticated
  USING (private.site_access_allowed(site_id)) WITH CHECK ((SELECT private.is_admin()));
DROP POLICY IF EXISTS site_scope ON public.employees;
CREATE POLICY site_scope ON public.employees AS RESTRICTIVE FOR SELECT TO authenticated
  USING (private.employee_access_allowed(id));

DROP POLICY IF EXISTS site_scope_read ON public.assets;
CREATE POLICY site_scope_read ON public.assets AS RESTRICTIVE FOR SELECT TO authenticated USING (
  private.asset_access_allowed(id) OR (
    created_by_auth_user_id = (SELECT auth.uid()) AND last_storage_location_id IS NULL AND EXISTS (
      SELECT 1 FROM public.employee_site_access sa JOIN public.employees e ON e.id = sa.employee_id
      WHERE e.auth_user_id = (SELECT auth.uid()) AND e.is_active
    )
  )
);
DROP POLICY IF EXISTS site_scope_update ON public.assets;
CREATE POLICY site_scope_update ON public.assets AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (private.asset_access_allowed(id)) WITH CHECK (private.asset_access_allowed(id));
DROP POLICY IF EXISTS site_scope_delete ON public.assets;
CREATE POLICY site_scope_delete ON public.assets AS RESTRICTIVE FOR DELETE TO authenticated USING (private.asset_access_allowed(id));
DROP POLICY IF EXISTS site_scope_insert ON public.assets;
CREATE POLICY site_scope_insert ON public.assets AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (
  (SELECT private.is_admin()) OR (created_by_auth_user_id = (SELECT auth.uid()) AND EXISTS (
    SELECT 1 FROM public.employee_site_access a JOIN public.employees e ON e.id = a.employee_id
    WHERE e.auth_user_id = (SELECT auth.uid()) AND e.is_active
  ))
);
DROP POLICY IF EXISTS site_scope ON public.asset_locations;
CREATE POLICY site_scope ON public.asset_locations AS RESTRICTIVE FOR ALL TO authenticated
  USING (private.asset_access_allowed(asset_id) AND private.location_access_allowed(storage_location_id))
  WITH CHECK (private.asset_access_allowed(asset_id) AND private.location_access_allowed(storage_location_id));
DROP POLICY IF EXISTS site_scope ON public.asset_assignments;
CREATE POLICY site_scope ON public.asset_assignments AS RESTRICTIVE FOR ALL TO authenticated
  USING (private.asset_access_allowed(asset_id) AND (department_id IS NULL OR private.department_access_allowed(department_id)) AND (employee_id IS NULL OR private.employee_access_allowed(employee_id)))
  WITH CHECK (private.asset_access_allowed(asset_id) AND (department_id IS NULL OR private.department_access_allowed(department_id)) AND (employee_id IS NULL OR private.employee_access_allowed(employee_id)));
DROP POLICY IF EXISTS site_scope ON public.asset_component_assignments;
CREATE POLICY site_scope ON public.asset_component_assignments AS RESTRICTIVE FOR ALL TO authenticated
  USING (private.asset_access_allowed(parent_asset_id) AND private.asset_access_allowed(child_asset_id))
  WITH CHECK (private.asset_access_allowed(parent_asset_id) AND private.asset_access_allowed(child_asset_id));
DROP POLICY IF EXISTS site_scope ON public.software_installations;
CREATE POLICY site_scope ON public.software_installations AS RESTRICTIVE FOR ALL TO authenticated
  USING (private.asset_access_allowed(asset_id)) WITH CHECK (private.asset_access_allowed(asset_id));
DROP POLICY IF EXISTS site_scope ON public.stock_counts;
CREATE POLICY site_scope ON public.stock_counts AS RESTRICTIVE FOR ALL TO authenticated
  USING (private.location_access_allowed(storage_location_id)) WITH CHECK (private.location_access_allowed(storage_location_id));
DROP POLICY IF EXISTS site_scope ON public.stock_targets;
CREATE POLICY site_scope ON public.stock_targets AS RESTRICTIVE FOR ALL TO authenticated
  USING (private.location_access_allowed(storage_location_id)) WITH CHECK (private.location_access_allowed(storage_location_id));
DROP POLICY IF EXISTS site_scope ON public.stock_movements;
CREATE POLICY site_scope ON public.stock_movements AS RESTRICTIVE FOR ALL TO authenticated
  USING ((from_storage_location_id IS NULL OR private.location_access_allowed(from_storage_location_id))
    AND (to_storage_location_id IS NULL OR private.location_access_allowed(to_storage_location_id))
    AND (department_id IS NULL OR private.department_access_allowed(department_id))
    AND (related_asset_id IS NULL OR private.asset_access_allowed(related_asset_id)))
  WITH CHECK ((from_storage_location_id IS NULL OR private.location_access_allowed(from_storage_location_id))
    AND (to_storage_location_id IS NULL OR private.location_access_allowed(to_storage_location_id))
    AND (department_id IS NULL OR private.department_access_allowed(department_id))
    AND (related_asset_id IS NULL OR private.asset_access_allowed(related_asset_id)));

-- Balances must include cross-site transfers even when their raw movement rows
-- are hidden. This narrow private function returns ONLY permitted aggregates.
CREATE OR REPLACE FUNCTION private.scoped_stock_levels()
RETURNS TABLE (product_model_id bigint, storage_location_id bigint, quantity numeric, condition varchar)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $fn$
  SELECT m.product_model_id, leg.location_id, sum(leg.delta), leg.state
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
CREATE OR REPLACE VIEW public.stock_levels WITH (security_invoker = true) AS SELECT product_model_id, storage_location_id, quantity, condition::varchar(30) AS condition FROM private.scoped_stock_levels();
ALTER VIEW public.stock_levels_total SET (security_invoker = true);
REVOKE ALL ON public.stock_levels, public.stock_levels_total FROM PUBLIC, anon;
GRANT SELECT ON public.stock_levels, public.stock_levels_total TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.set_employee_site_access(p_employee_id bigint, p_site_ids bigint[])
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog AS $fn$
BEGIN
  IF (SELECT auth.uid()) IS NULL OR NOT (SELECT private.is_admin()) THEN
    RAISE EXCEPTION 'Nur Administratoren können Standortberechtigungen ändern.' USING ERRCODE = '42501';
  END IF;
  PERFORM 1 FROM public.employees WHERE id = p_employee_id AND auth_user_id IS NOT NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Verknüpftes Benutzerkonto nicht gefunden.'; END IF;
  IF p_site_ids IS NULL OR EXISTS (SELECT 1 FROM unnest(p_site_ids) AS requested(site_id) WHERE requested.site_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.sites s WHERE s.id = requested.site_id)) THEN
    RAISE EXCEPTION 'Ungültige Standortfreigabe.';
  END IF;
  DELETE FROM public.employee_site_access WHERE employee_id = p_employee_id AND NOT (site_id = ANY(p_site_ids));
  INSERT INTO public.employee_site_access (employee_id, site_id)
    SELECT p_employee_id, requested.site_id FROM unnest(p_site_ids) AS requested(site_id) ON CONFLICT DO NOTHING;
  RETURN true;
END;
$fn$;

-- Deleting the relations first would otherwise remove the location needed to
-- authorize the asset deletion. Validate once and delete atomically instead.
CREATE OR REPLACE FUNCTION private.delete_scoped_asset(p_asset_id bigint)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $fn$
BEGIN
  IF (SELECT auth.uid()) IS NULL OR NOT (SELECT private.can_edit_inventory()) OR NOT private.asset_access_allowed(p_asset_id) THEN
    RAISE EXCEPTION 'Keine Berechtigung für dieses Gerät.' USING ERRCODE = '42501';
  END IF;
  PERFORM 1 FROM public.assets WHERE id = p_asset_id FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  DELETE FROM public.asset_component_assignments WHERE parent_asset_id = p_asset_id OR child_asset_id = p_asset_id;
  DELETE FROM public.software_installations WHERE asset_id = p_asset_id;
  DELETE FROM public.asset_assignments WHERE asset_id = p_asset_id;
  DELETE FROM public.asset_locations WHERE asset_id = p_asset_id;
  DELETE FROM public.assets WHERE id = p_asset_id;
  RETURN true;
END;
$fn$;
CREATE OR REPLACE FUNCTION public.delete_scoped_asset(p_asset_id bigint)
RETURNS boolean LANGUAGE sql SECURITY INVOKER SET search_path = pg_catalog AS $fn$
  SELECT private.delete_scoped_asset(p_asset_id);
$fn$;

REVOKE ALL ON FUNCTION private.site_access_allowed(bigint), private.location_access_allowed(bigint),
  private.department_access_allowed(bigint), private.employee_access_allowed(bigint), private.asset_access_allowed(bigint),
  private.scoped_stock_levels(), private.delete_scoped_asset(bigint), private.protect_asset_creator(), private.remember_asset_location() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.site_access_allowed(bigint), private.location_access_allowed(bigint),
  private.department_access_allowed(bigint), private.employee_access_allowed(bigint), private.asset_access_allowed(bigint),
  private.scoped_stock_levels(), private.delete_scoped_asset(bigint), private.protect_asset_creator() TO authenticated;
REVOKE ALL ON FUNCTION public.set_employee_site_access(bigint, bigint[]), public.delete_scoped_asset(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_employee_site_access(bigint, bigint[]), public.delete_scoped_asset(bigint) TO authenticated;
DROP TRIGGER IF EXISTS itassetflow_inventory_revision ON public.employee_site_access;
CREATE TRIGGER itassetflow_inventory_revision AFTER INSERT OR UPDATE OR DELETE ON public.employee_site_access
  FOR EACH STATEMENT EXECUTE FUNCTION public.bump_inventory_change_revision();
NOTIFY pgrst, 'reload schema';
