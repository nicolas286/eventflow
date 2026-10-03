-- PHASE 3 ONLY: publish B2 promo consumers before closing browser table access.
-- No historical promo CRUD RPC exists; retain checkout/orders/payment paths.
DO $$ DECLARE target record; BEGIN
 IF EXISTS(SELECT 1 FROM pg_depend d JOIN pg_rewrite r ON r.oid=d.objid
  JOIN pg_class c ON c.oid=r.ev_class JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE d.refobjid='public.promo_codes'::regclass AND n.nspname='public' AND c.relkind IN ('v','m')) THEN
  RAISE EXCEPTION 'Re-inventory promo views before browser closure'; END IF;
 REVOKE ALL ON TABLE public.promo_codes FROM PUBLIC,anon,authenticated;
 FOR target IN SELECT attname FROM pg_attribute WHERE attrelid='public.promo_codes'::regclass AND attnum>0 AND NOT attisdropped LOOP
  EXECUTE format('REVOKE ALL (%I) ON TABLE public.promo_codes FROM PUBLIC,anon,authenticated',target.attname);
 END LOOP;
 -- Defensive overload inventory for these service-only internal operations.
 FOR target IN SELECT p.oid::regprocedure signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname IN ('organizer_create_event_promo_code','organizer_update_event_promo_code','organizer_delete_event_promo_code') LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated',target.signature);
 END LOOP;
 GRANT SELECT,INSERT,UPDATE,DELETE ON TABLE public.promo_codes TO service_role;
 -- promo_code_redemptions is already server-only; preserve its grants/RLS/FKs.
END $$;
