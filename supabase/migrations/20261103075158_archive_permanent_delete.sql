-- Nur Administratoren dürfen den Archiveintrag löschen. Artikel und Lagerbuchungen bleiben unverändert.
GRANT DELETE ON public.inventory_archive TO authenticated;
CREATE POLICY archive_delete_admin ON public.inventory_archive FOR DELETE TO authenticated
  USING ((SELECT private.is_admin()) AND private.site_access_allowed(site_id));
