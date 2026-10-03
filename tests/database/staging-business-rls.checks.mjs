import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { assertDisposableOrganizerContainer } from './disposable-container.mjs';
const container = process.argv[2];
assertDisposableOrganizerContainer(container);
const close = readFileSync(new URL('../../supabase/migrations/20261003192000_close_staging_business_browser_access.sql', import.meta.url), 'utf8');
const retire = readFileSync(new URL('../../supabase/migrations/20261003193000_retire_staging_business_rls.sql', import.meta.url), 'utf8');
const staging = 'https://cpcmcxerrsnnjncrhldr.supabase.co/storage/v1/object/public/public-assets';
function run(input, label) {
  const result = spawnSync('docker', ['exec', '-i', container, 'sh', '-c', 'PGPASSWORD="$POSTGRES_PASSWORD" exec psql -X -qAt -U supabase_admin -d postgres -v ON_ERROR_STOP=1'], { input, encoding: 'utf8', windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${label}: ${result.stderr || result.stdout}`);
  console.log(`PASS staging RLS retirement: ${label}; fixtures rolled back`);
}
for (const url of ['https://dixirvllhfkvqoahhfqh.supabase.co/storage/v1/object/public/public-assets', 'http://127.0.0.1:58621/storage/v1/object/public/public-assets']) {
  run(`BEGIN; SET LOCAL ROLE postgres;
UPDATE private.app_environment SET public_assets_base_url='${url}' WHERE singleton;
${retire}
DO $proof$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_class WHERE oid='public.organizations'::regclass AND relrowsecurity) THEN RAISE EXCEPTION 'non-staging RLS changed'; END IF; END $proof$;
ROLLBACK;`, 'production/local unchanged');
}
run(`BEGIN; SET LOCAL ROLE postgres;
UPDATE private.app_environment SET public_assets_base_url='${staging}' WHERE singleton;
DO $negative$ BEGIN
 BEGIN EXECUTE $migration$${retire}$migration$; RAISE EXCEPTION 'retirement accepted before closure';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM NOT LIKE 'Close browser %' THEN RAISE; END IF; END;
END $negative$;
ROLLBACK;`, 'refused before closure');
run(`BEGIN;
DROP EXTENSION IF EXISTS pg_graphql;
DO $role$ BEGIN
 IF (SELECT rolsuper FROM pg_roles WHERE rolname='postgres') THEN RAISE EXCEPTION 'test requires non-superuser postgres'; END IF;
END $role$;
SET LOCAL ROLE postgres;
UPDATE private.app_environment SET public_assets_base_url='${staging}' WHERE singleton;
CREATE TEMP TABLE b6_rls_preserved AS
 SELECT c.oid,c.relrowsecurity,(SELECT count(*) FROM pg_policy p WHERE p.polrelid=c.oid) policies
 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname IN ('auth','storage','private') AND c.relkind IN ('r','p');
${close}
-- Storage policy retirement is part of closure. Snapshot managed/private RLS
-- and all remaining policies after closure, immediately before phase 2.
UPDATE b6_rls_preserved s SET policies=(SELECT count(*) FROM pg_policy WHERE polrelid=s.oid);
GRANT SELECT(name) ON public.organizations TO authenticated;
DO $negative$ BEGIN
 BEGIN EXECUTE $migration$${retire}$migration$; RAISE EXCEPTION 'column drift accepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM NOT LIKE 'Close browser relation %' THEN RAISE; END IF; END;
END $negative$;
REVOKE SELECT(name) ON public.organizations FROM authenticated;
GRANT EXECUTE ON FUNCTION public.organizer_update_organization_payment_settings(uuid,uuid,text,text,text) TO anon;
DO $negative$ BEGIN
 BEGIN EXECUTE $migration$${retire}$migration$; RAISE EXCEPTION 'RPC drift accepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM <> 'Close browser application RPC access before retiring business RLS' THEN RAISE; END IF; END;
END $negative$;
REVOKE EXECUTE ON FUNCTION public.organizer_update_organization_payment_settings(uuid,uuid,text,text,text) FROM anon;
${retire}
${retire}
DO $proof$ DECLARE browser text; stmt text; BEGIN
 IF EXISTS(SELECT 1 FROM pg_class WHERE relnamespace='public'::regnamespace AND relkind IN ('r','p') AND relrowsecurity) THEN RAISE EXCEPTION 'public business RLS remains'; END IF;
 IF EXISTS(SELECT 1 FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid WHERE c.relnamespace='public'::regnamespace) THEN RAISE EXCEPTION 'public policy remains'; END IF;
 IF EXISTS(SELECT 1 FROM b6_rls_preserved s JOIN pg_class c ON c.oid=s.oid WHERE c.relrowsecurity<>s.relrowsecurity OR (SELECT count(*) FROM pg_policy WHERE polrelid=s.oid)<>s.policies) THEN RAISE EXCEPTION 'managed/private RLS or policies changed'; END IF;
 FOREACH browser IN ARRAY ARRAY['anon','authenticated'] LOOP
  EXECUTE format('SET LOCAL ROLE %I',browser);
  FOREACH stmt IN ARRAY ARRAY['SELECT * FROM public.organizations LIMIT 1','SELECT public.organizer_update_organization_payment_settings(gen_random_uuid(),gen_random_uuid(),''stripe'')','SELECT public.unaccent(''synthetic'')'] LOOP
   BEGIN EXECUTE stmt; RAISE EXCEPTION 'direct access accepted without RLS: %',stmt; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  END LOOP;
  IF position('pg_graphql extension is not enabled.' IN graphql_public.graphql(query:='{ __typename }')::text)=0 THEN RAISE EXCEPTION 'GraphQL changed'; END IF;
  RESET ROLE;
 END LOOP;
END $proof$;
SET LOCAL ROLE service_role;
SELECT 1 FROM public.organizations LIMIT 1;
DO $actor$ BEGIN
 BEGIN PERFORM public.organizer_update_organization_payment_settings(gen_random_uuid(),gen_random_uuid(),'stripe');
  RAISE EXCEPTION 'foreign actor accepted'; EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'FORBIDDEN' THEN RAISE; END IF; END;
END $actor$;
RESET ROLE;
ROLLBACK;`, 'closed ACL required, public RLS retired, managed/private preserved, real-role denials and service actor check');
