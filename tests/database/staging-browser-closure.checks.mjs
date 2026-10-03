import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { assertDisposableOrganizerContainer } from './disposable-container.mjs';

const container = process.argv[2];
assertDisposableOrganizerContainer(container);
const migration = readFileSync(new URL('../../supabase/migrations/20261003192000_close_staging_business_browser_access.sql', import.meta.url), 'utf8');
function run(input, label) {
  const result = spawnSync('docker', ['exec', '-i', container, 'sh', '-c', 'PGPASSWORD="$POSTGRES_PASSWORD" exec psql -X -qAt -U supabase_admin -d postgres -v ON_ERROR_STOP=1'], { input, encoding: 'utf8', windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${label}: ${result.stderr || result.stdout}`);
  console.log(`PASS staging closure: ${label}; fixtures rolled back`);
}
const staging = 'https://cpcmcxerrsnnjncrhldr.supabase.co/storage/v1/object/public/public-assets';
for (const url of ['https://dixirvllhfkvqoahhfqh.supabase.co/storage/v1/object/public/public-assets', 'http://127.0.0.1:58621/storage/v1/object/public/public-assets']) {
  run(`BEGIN;
SET LOCAL ROLE postgres;
CREATE TABLE public.b6_staging_environment_probe(id integer);
GRANT SELECT ON public.b6_staging_environment_probe TO anon;
UPDATE private.app_environment SET public_assets_base_url='${url}' WHERE singleton;
${migration}
DO $proof$ BEGIN
 IF NOT has_table_privilege('anon','public.b6_staging_environment_probe','SELECT') THEN RAISE EXCEPTION 'non-staging permissions changed'; END IF;
END $proof$;
ROLLBACK;`, 'production/local skip');
}
run(`BEGIN;
SET LOCAL ROLE postgres;
UPDATE private.app_environment SET public_assets_base_url='https://unknown.example.test/storage/v1/object/public/public-assets' WHERE singleton;
DO $negative$ BEGIN
 BEGIN EXECUTE $migration$${migration}$migration$; RAISE EXCEPTION 'unknown environment accepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM <> 'Browser closure refused: unknown environment' THEN RAISE; END IF; END;
END $negative$;
ROLLBACK;`, 'unknown environment refused');

run(`BEGIN;
DROP EXTENSION IF EXISTS pg_graphql;
CREATE FUNCTION public.b6_staging_unknown_managed() RETURNS integer LANGUAGE sql SECURITY DEFINER AS 'select 1';
SET LOCAL ROLE postgres;
UPDATE private.app_environment SET public_assets_base_url='${staging}' WHERE singleton;
DO $negative$ BEGIN
 BEGIN EXECUTE $migration$${migration}$migration$; RAISE EXCEPTION 'unknown managed function accepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM <> 'Browser closure refused: unreviewed managed business object' THEN RAISE; END IF; END;
END $negative$;
ROLLBACK;`, 'unknown managed function refused');

run(`BEGIN;
-- Match the attested hosted staging GraphQL configuration. Supabase's managed
-- extension hook restores the disabled wrapper when this extension is dropped.
DROP EXTENSION IF EXISTS pg_graphql;
DO $role$ BEGIN
 IF (SELECT rolsuper FROM pg_roles WHERE rolname='postgres') THEN RAISE EXCEPTION 'test requires non-superuser postgres'; END IF;
END $role$;
SET LOCAL ROLE postgres;
UPDATE private.app_environment SET public_assets_base_url='${staging}' WHERE singleton;
CREATE VIEW public.b6_staging_owner_view AS SELECT id FROM public.organizations;
CREATE FUNCTION public.b6_staging_forgotten_rpc() RETURNS SETOF uuid LANGUAGE sql SECURITY DEFINER AS 'select id from public.organizations';
GRANT SELECT ON public.b6_staging_owner_view TO PUBLIC;
GRANT SELECT(name) ON public.organizations TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.b6_staging_forgotten_rpc() TO PUBLIC;
GRANT ALL ON SEQUENCE public.invoice_number_seq TO PUBLIC;
${migration}
-- Repeated application is safe and keeps the same owner-limited boundary.
${migration}
CREATE TABLE public.b6_staging_future_postgres(id integer);
CREATE FUNCTION public.b6_staging_future_postgres_fn() RETURNS integer LANGUAGE sql AS 'select 1';
RESET ROLE;
-- Managed defaults may remain permissive, but public schema USAGE must block
-- future managed objects too. No managed default ACL changes are necessary.
CREATE TABLE public.b6_staging_future_managed(id integer);
GRANT SELECT ON public.b6_staging_future_managed TO PUBLIC,anon,authenticated;
CREATE FUNCTION public.b6_staging_future_managed_fn() RETURNS integer LANGUAGE sql AS 'select 1';
GRANT EXECUTE ON FUNCTION public.b6_staging_future_managed_fn() TO PUBLIC,anon,authenticated;
DO $proof$ DECLARE browser text; stmt text; BEGIN
 FOREACH browser IN ARRAY ARRAY['anon','authenticated'] LOOP
  IF has_schema_privilege(browser,'public','USAGE') OR has_schema_privilege(browser,'private','USAGE') THEN RAISE EXCEPTION 'browser schema remains accessible'; END IF;
  IF has_table_privilege(browser,'public.b6_staging_future_postgres','SELECT') OR has_function_privilege(browser,'public.b6_staging_future_postgres_fn()','EXECUTE') THEN RAISE EXCEPTION 'postgres future defaults are open'; END IF;
  EXECUTE format('SET LOCAL ROLE %I',browser);
  FOREACH stmt IN ARRAY ARRAY[
   'SELECT * FROM public.organizations LIMIT 1',
   'SELECT * FROM public.b6_staging_owner_view LIMIT 1',
   'SELECT * FROM public.b6_staging_future_managed LIMIT 1',
   'SELECT public.b6_staging_forgotten_rpc()',
   'SELECT public.b6_staging_future_managed_fn()',
   'SELECT public.unaccent(''synthetic'')',
   'SELECT nextval(''public.invoice_number_seq'')'
  ] LOOP
   BEGIN EXECUTE stmt; RAISE EXCEPTION 'direct access accepted: %',stmt; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  END LOOP;
  -- The managed GraphQL wrapper remains its disabled, non-business stub.
  IF position('pg_graphql extension is not enabled.' IN graphql_public.graphql(query:='{ __typename }')::text)=0 THEN RAISE EXCEPTION 'GraphQL is unexpectedly enabled'; END IF;
  RESET ROLE;
 END LOOP;
 IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='storage' AND policyname='public read public-assets') THEN RAISE EXCEPTION 'public asset read policy removed'; END IF;
 IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='storage' AND policyname IN ('invoices_read_auth_org_member','org members can upload their assets','org members can update their assets','org members can delete their assets')) THEN RAISE EXCEPTION 'browser storage policy remains'; END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_class WHERE oid='public.organizations'::regclass AND relrowsecurity) THEN RAISE EXCEPTION 'closure unexpectedly retired business RLS'; END IF;
 IF EXISTS (SELECT 1 FROM pg_publication_tables WHERE schemaname IN ('public','private')) THEN RAISE EXCEPTION 'business realtime remains'; END IF;
END $proof$;
SET LOCAL ROLE service_role;
SELECT 1 FROM public.organizations LIMIT 1;
DO $actor$ BEGIN
 BEGIN PERFORM public.organizer_update_organization_payment_settings(gen_random_uuid(),gen_random_uuid(),'stripe');
  RAISE EXCEPTION 'foreign actor accepted'; EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'FORBIDDEN' THEN RAISE; END IF; END;
END $actor$;
RESET ROLE;
ROLLBACK;`, 'real postgres release, anon/authenticated denial, future creators, preserved service and Storage');
