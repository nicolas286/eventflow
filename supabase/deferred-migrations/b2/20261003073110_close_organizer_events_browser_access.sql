-- PHASE 3 ONLY: publish events Edge + frontend, and finish the B2 product/form
-- consumers first: their current RLS SELECT policies read the events table.
-- Preserve B3-B5/public RPCs and policies; no global RLS removal in this phase.
DO $$ DECLARE target record; BEGIN
 FOR target IN SELECT p.oid::regprocedure signature FROM pg_proc p
   JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public'
   AND p.proname IN ('get_events_overview','get_event_detail_admin_core',
     'create_event','update_event','duplicate_event','get_event_by_slug')
 LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated',target.signature);
 END LOOP;
 IF EXISTS(SELECT 1 FROM pg_depend d JOIN pg_rewrite r ON r.oid=d.objid
   JOIN pg_class c ON c.oid=r.ev_class JOIN pg_namespace n ON n.oid=c.relnamespace
   WHERE d.refobjid='public.events'::regclass AND n.nspname='public' AND c.relkind IN ('v','m'))
  THEN RAISE EXCEPTION 'Re-inventory event views before browser closure'; END IF;
 REVOKE ALL ON TABLE public.events FROM PUBLIC,anon,authenticated;
 FOR target IN SELECT attname FROM pg_attribute WHERE attrelid='public.events'::regclass AND attnum>0 AND NOT attisdropped LOOP
  EXECUTE format('REVOKE ALL (%I) ON TABLE public.events FROM PUBLIC,anon,authenticated',target.attname);
 END LOOP;
 -- Server reads/mutations, anonymous public RPCs and Netlify share use their
 -- existing server/SECURITY DEFINER paths. The UUID PK owns no sequence.
 GRANT SELECT,INSERT,UPDATE,DELETE ON TABLE public.events TO service_role;
END $$;
