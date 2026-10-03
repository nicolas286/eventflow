-- Run after the deferred B1.2 closure, on a disposable database only.
BEGIN;
CREATE FUNCTION pg_temp.assert_billing_browser_denied() RETURNS void LANGUAGE plpgsql AS $$
DECLARE statement text;
BEGIN
 FOR statement IN SELECT unnest(ARRAY[
  'SELECT * FROM public.organization_billing',
  'SELECT legal_name FROM public.organization_billing',
  'UPDATE public.organization_billing SET legal_name=''Forged'' RETURNING *',
  'DELETE FROM public.organization_billing RETURNING *',
  'TRUNCATE public.organization_billing',
  'SELECT public.rpc_get_organization_billing(''b1200000-0000-4000-8000-000000000011'')',
  'SELECT public.rpc_upsert_organization_billing(''{"org_id":"b1200000-0000-4000-8000-000000000011","legal_name":"Forged"}'')'])
 LOOP
  BEGIN
   EXECUTE statement;
   RAISE EXCEPTION 'Browser billing operation accepted for %: %',current_user,statement;
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 END LOOP;
END $$;
-- Temporary test helper only; B6 closes implicit PUBLIC EXECUTE defaults.
GRANT EXECUTE ON FUNCTION pg_temp.assert_billing_browser_denied() TO anon,authenticated,service_role;
DO $$ DECLARE role_name text; col record; p record; BEGIN
 FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
  IF has_table_privilege(role_name,'public.organization_billing','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
   THEN RAISE EXCEPTION 'Browser billing table grant survives: %',role_name; END IF;
  FOR col IN SELECT attname FROM pg_attribute WHERE attrelid='public.organization_billing'::regclass AND attnum>0 AND NOT attisdropped LOOP
   IF has_column_privilege(role_name,'public.organization_billing',col.attname,'SELECT,INSERT,UPDATE,REFERENCES')
    THEN RAISE EXCEPTION 'Browser billing column grant survives: %.%',role_name,col.attname; END IF;
  END LOOP;
  FOR p IN SELECT proc.* FROM pg_proc proc JOIN pg_namespace n ON n.oid=proc.pronamespace
    WHERE n.nspname='public' AND (proc.proname IN ('rpc_get_organization_billing','rpc_upsert_organization_billing') OR proc.prosrc ~ '\morganization_billing\M')
  LOOP
   IF has_function_privilege(role_name,p.oid,'EXECUTE') THEN RAISE EXCEPTION 'Equivalent billing RPC survives: %',p.oid::regprocedure; END IF;
  END LOOP;
 END LOOP;
END $$;
SET LOCAL ROLE anon;
SELECT pg_temp.assert_billing_browser_denied();
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT pg_temp.assert_billing_browser_denied();
RESET ROLE;
ALTER TABLE public.organization_billing DISABLE ROW LEVEL SECURITY;
SET LOCAL ROLE anon;
SELECT pg_temp.assert_billing_browser_denied();
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT pg_temp.assert_billing_browser_denied();
RESET ROLE;
SET LOCAL ROLE service_role;
SELECT org_id FROM public.organization_billing;
RESET ROLE;
ROLLBACK;
