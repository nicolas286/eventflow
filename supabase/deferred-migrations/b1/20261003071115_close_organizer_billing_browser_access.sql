-- PHASE 3 ONLY: organizations billing routes and frontend must be published.
-- Keep outside active migrations because SQL deployment precedes the frontend.
DO $$ DECLARE target record; BEGIN
 -- Fail when a new equivalent reader appears rather than closing it blindly.
 IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.prosrc ~ '\morganization_billing\M'
   AND p.proname NOT IN ('rpc_get_organization_billing','rpc_upsert_organization_billing',
     'organizer_upsert_organization_billing','rpc_create_invoice_from_mollie_payment',
     'create_manual_subscription_invoice'))
  THEN RAISE EXCEPTION 'Re-inventory equivalent organization billing functions'; END IF;
 IF EXISTS (SELECT 1 FROM pg_depend d JOIN pg_rewrite r ON r.oid=d.objid
   JOIN pg_class c ON c.oid=r.ev_class JOIN pg_namespace n ON n.oid=c.relnamespace
   WHERE d.refobjid='public.organization_billing'::regclass
     AND n.nspname='public' AND c.relkind IN ('v','m'))
  THEN RAISE EXCEPTION 'Re-inventory equivalent organization billing views'; END IF;

 -- All signatures are covered, including overloads on the target catalogue.
 FOR target IN SELECT p.oid::regprocedure signature, p.proname FROM pg_proc p
   JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public'
   AND (p.proname IN ('rpc_get_organization_billing','rpc_upsert_organization_billing')
     OR p.prosrc ~ '\morganization_billing\M')
 LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated',target.signature);
  IF target.proname NOT IN ('rpc_get_organization_billing','rpc_upsert_organization_billing') THEN
   EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role',target.signature);
  END IF;
 END LOOP;
 REVOKE ALL ON TABLE public.organization_billing FROM PUBLIC, anon, authenticated;
 FOR target IN SELECT attname FROM pg_attribute
   WHERE attrelid='public.organization_billing'::regclass AND attnum>0 AND NOT attisdropped
 LOOP
  EXECUTE format('REVOKE ALL (%I) ON TABLE public.organization_billing FROM PUBLIC, anon, authenticated',target.attname);
 END LOOP;
 GRANT SELECT, INSERT, UPDATE ON TABLE public.organization_billing TO service_role;
END $$;
-- No owned sequence exists: the key is the organization's UUID.
-- This table is shared with billing/payment-settings and B6 invoice snapshots.
-- Preserve its policies and RLS until those consumers have been migrated.
