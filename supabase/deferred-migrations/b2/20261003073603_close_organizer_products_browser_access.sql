-- PHASE 3 ONLY: publish all B2 product/forms consumers before the B2 closures.
-- Keep stock/order/public SECURITY DEFINER paths and their shared RLS policies.
DO $$ DECLARE target record; BEGIN
 FOR target IN SELECT p.oid::regprocedure signature FROM pg_proc p
  JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public'
   AND p.proname IN ('create_event_product','update_event_product')
 LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated',target.signature);
 END LOOP;
 IF EXISTS(SELECT 1 FROM pg_depend d JOIN pg_rewrite r ON r.oid=d.objid
  JOIN pg_class c ON c.oid=r.ev_class JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE d.refobjid='public.event_products'::regclass AND n.nspname='public' AND c.relkind IN ('v','m'))
  THEN RAISE EXCEPTION 'Re-inventory product views before browser closure'; END IF;
 REVOKE ALL ON TABLE public.event_products FROM PUBLIC,anon,authenticated;
 FOR target IN SELECT attname FROM pg_attribute WHERE attrelid='public.event_products'::regclass AND attnum>0 AND NOT attisdropped LOOP
  EXECUTE format('REVOKE ALL (%I) ON TABLE public.event_products FROM PUBLIC,anon,authenticated',target.attname);
 END LOOP;
 GRANT SELECT,INSERT,UPDATE,DELETE ON TABLE public.event_products TO service_role;
END $$;
