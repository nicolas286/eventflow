-- Run AFTER the deferred closure in the SAME rollback-only transaction.
INSERT INTO auth.users(id,aud,role,email,encrypted_password,created_at,updated_at)
VALUES ('b0000000-0000-4000-8000-000000000001','authenticated','authenticated','b0-sql@example.test','',now(),now());
INSERT INTO public.organizations(id,type,name) VALUES
 ('b0000000-0000-4000-8000-000000000002','association','B0 SQL A'),
 ('b0000000-0000-4000-8000-000000000003','association','B0 SQL B');
INSERT INTO public.organization_members(org_id,user_id,role)
VALUES ('b0000000-0000-4000-8000-000000000002','b0000000-0000-4000-8000-000000000001','owner');
INSERT INTO public.invoices(id,org_id,number,status,issued_at,total_cents,subtotal_cents) VALUES
 ('b0000000-0000-4000-8000-000000000004','b0000000-0000-4000-8000-000000000002','B0-SQL-A','issued',now(),100,100),
 ('b0000000-0000-4000-8000-000000000005','b0000000-0000-4000-8000-000000000003','B0-SQL-B','issued',now(),200,200);

CREATE FUNCTION pg_temp.assert_history_denied() RETURNS void LANGUAGE plpgsql AS $$
DECLARE statement text;
BEGIN
 FOR statement IN SELECT unnest(ARRAY[
  'SELECT public.rpc_list_invoices(''b0000000-0000-4000-8000-000000000002'')',
  'SELECT public.rpc_list_invoices(''b0000000-0000-4000-8000-000000000003'',1,NULL,NULL)',
  'SELECT * FROM public.invoices',
  'SELECT number FROM public.invoices',
  'UPDATE public.invoices SET number=''B0-LEAK'' RETURNING *',
  'DELETE FROM public.invoices RETURNING *',
  'TRUNCATE public.invoices CASCADE'])
 LOOP
  BEGIN
   EXECUTE statement;
   RAISE EXCEPTION 'Browser operation accepted for %: %',current_user,statement;
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
 END LOOP;
END $$;
-- Temporary test helper only; B6 closes implicit PUBLIC EXECUTE defaults.
GRANT EXECUTE ON FUNCTION pg_temp.assert_history_denied() TO anon,authenticated,service_role;

DO $$
DECLARE p record; role_name text; col record; n integer := 0;
BEGIN
 FOR p IN SELECT proc.* FROM pg_proc proc JOIN pg_namespace ns ON ns.oid=proc.pronamespace
  WHERE ns.nspname='public' AND proc.proname='rpc_list_invoices'
 LOOP
  n := n+1;
  IF has_function_privilege('anon',p.oid,'EXECUTE')
   OR has_function_privilege('authenticated',p.oid,'EXECUTE')
   OR EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.grantee=0)
   OR NOT has_function_privilege('service_role',p.oid,'EXECUTE') THEN
   RAISE EXCEPTION 'Bad history function ACL: %',p.oid::regprocedure;
  END IF;
 END LOOP;
 IF n <> 1 THEN RAISE EXCEPTION 'Re-inventory history overloads, found %',n; END IF;
 -- Every other versioned public function reading invoices is server-only,
 -- except the separate current-invoice bootstrap summary (tested below).
 FOR p IN SELECT proc.* FROM pg_proc proc JOIN pg_namespace ns ON ns.oid=proc.pronamespace
  WHERE ns.nspname='public' AND proc.prosrc ~ '\m(invoices|invoice_peppol)\M'
    AND proc.proname NOT IN ('get_dashboard_bootstrap','rpc_list_invoices')
 LOOP
  IF has_function_privilege('anon',p.oid,'EXECUTE') OR has_function_privilege('authenticated',p.oid,'EXECUTE')
   THEN RAISE EXCEPTION 'Equivalent invoice RPC accessible: %',p.oid::regprocedure; END IF;
 END LOOP;
 FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
  IF has_table_privilege(role_name,'public.invoices','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
   THEN RAISE EXCEPTION 'Browser table grant survives: %',role_name; END IF;
  FOR col IN SELECT attname FROM pg_attribute WHERE attrelid='public.invoices'::regclass AND attnum>0 AND NOT attisdropped LOOP
   IF has_column_privilege(role_name,'public.invoices',col.attname,'SELECT,INSERT,UPDATE,REFERENCES')
    THEN RAISE EXCEPTION 'Browser column grant survives: %.%',role_name,col.attname; END IF;
  END LOOP;
 END LOOP;
 IF EXISTS (SELECT 1 FROM aclexplode((SELECT relacl FROM pg_class WHERE oid='public.invoices'::regclass)) a WHERE grantee=0)
  OR EXISTS (SELECT 1 FROM pg_attribute, LATERAL aclexplode(attacl) a WHERE attrelid='public.invoices'::regclass AND grantee=0)
  THEN RAISE EXCEPTION 'PUBLIC invoice grants survive'; END IF;

 -- Fail on new equivalent views rather than silently accepting a stale inventory.
 IF EXISTS (SELECT 1 FROM pg_depend d JOIN pg_rewrite r ON r.oid=d.objid
  JOIN pg_class c ON c.oid=r.ev_class JOIN pg_namespace ns ON ns.oid=c.relnamespace
  WHERE d.refobjid='public.invoices'::regclass AND c.relkind IN ('v','m') AND ns.nspname='public')
  THEN RAISE EXCEPTION 'Invoice view added: review equivalent access'; END IF;
 IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname='invoices_read_auth_org_member')
  THEN RAISE EXCEPTION 'Browser Storage history policy survives'; END IF;
END $$;

SET LOCAL ROLE anon;
SELECT pg_temp.assert_history_denied();
RESET ROLE;
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = 'b0000000-0000-4000-8000-000000000001';
SELECT pg_temp.assert_history_denied();
RESET ROLE;

-- Proof independent of row visibility: the exact same real roles still fail.
ALTER TABLE public.invoices DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_members DISABLE ROW LEVEL SECURITY;
SET LOCAL ROLE anon;
SELECT pg_temp.assert_history_denied();
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT pg_temp.assert_history_denied();
DO $$ DECLARE summary jsonb; BEGIN
 summary := public.get_dashboard_bootstrap()->'latestOpenInvoice';
 IF summary->>'id' = 'b0000000-0000-4000-8000-000000000005'
  THEN RAISE EXCEPTION 'Separate bootstrap summary leaks invoice B without RLS'; END IF;
END $$;
RESET ROLE;
SET LOCAL ROLE service_role;
DO $$ BEGIN
 IF (SELECT count(*) FROM public.invoices WHERE id IN (
  'b0000000-0000-4000-8000-000000000004','b0000000-0000-4000-8000-000000000005')) <> 2
  THEN RAISE EXCEPTION 'Server invoice read broken'; END IF;
 IF NOT EXISTS (SELECT 1 FROM public.organization_members WHERE org_id='b0000000-0000-4000-8000-000000000002'
  AND user_id='b0000000-0000-4000-8000-000000000001' AND role='owner')
  THEN RAISE EXCEPTION 'Server membership read broken'; END IF;
END $$;
RESET ROLE;
