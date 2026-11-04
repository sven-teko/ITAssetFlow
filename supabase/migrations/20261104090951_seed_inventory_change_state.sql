-- Restore the singleton used by inventory change notifications and paging.
-- Seed above normal revision values so an older cached version cannot match.
INSERT INTO public.inventory_change_state (id, revision)
VALUES (1, floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint)
ON CONFLICT (id) DO NOTHING;
