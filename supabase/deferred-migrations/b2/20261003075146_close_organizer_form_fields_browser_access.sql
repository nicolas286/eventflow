-- PHASE 3 ONLY: publish all B2 forms consumers before these browser closures.
-- Keep shared order/public policies and SECURITY DEFINER paths through B3-B5.
DO $$ DECLARE target record; relation regclass; BEGIN
 FOR target IN SELECT p.oid::regprocedure signature FROM pg_proc p
  JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public'
   AND p.proname IN ('create_event_form_field','create_event_form_field_group')
 LOOP EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated',target.signature); END LOOP;
 FOREACH relation IN ARRAY ARRAY['public.event_form_fields'::regclass,'public.event_form_field_groups'::regclass] LOOP
  IF EXISTS(SELECT 1 FROM pg_depend d JOIN pg_rewrite r ON r.oid=d.objid
   JOIN pg_class c ON c.oid=r.ev_class JOIN pg_namespace n ON n.oid=c.relnamespace
   WHERE d.refobjid=relation AND n.nspname='public' AND c.relkind IN ('v','m')) THEN
   RAISE EXCEPTION 'Re-inventory form views before browser closure: %',relation; END IF;
  EXECUTE format('REVOKE ALL ON TABLE %s FROM PUBLIC,anon,authenticated',relation);
  FOR target IN SELECT attname FROM pg_attribute WHERE attrelid=relation AND attnum>0 AND NOT attisdropped LOOP
   EXECUTE format('REVOKE ALL (%I) ON TABLE %s FROM PUBLIC,anon,authenticated',target.attname,relation);
  END LOOP;
  EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON TABLE %s TO service_role',relation);
 END LOOP;
END $$;
