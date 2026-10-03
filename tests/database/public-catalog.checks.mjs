import { assertDisposableOrganizerContainer } from './disposable-container.mjs';
import { readFileSync } from 'node:fs';import { spawnSync } from 'node:child_process';
const container=process.argv[2];assertDisposableOrganizerContainer(container);
function run(input){const r=spawnSync('docker',['exec','-i',container,'psql','-X','-qAt','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1'],{input,encoding:'utf8',windowsHide:true});if(r.status!==0)throw new Error(r.stderr);}
run(readFileSync(new URL('./b5/catalog.sql',import.meta.url),'utf8'));
const closure=readFileSync(new URL('../../supabase/deferred-migrations/b5/20261003160000_close_public_catalog_browser_access.sql',import.meta.url),'utf8').replace(/^begin;$/mi,'').replace(/^commit;$/mi,'');
let checks=`BEGIN;GRANT SELECT(title) ON public.events TO PUBLIC,anon,authenticated;
DO $drift$ DECLARE f record; BEGIN FOR f IN SELECT oid::regprocedure signature FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN ('get_public_org_by_slug','get_public_org_events_overview','get_public_event_detail','get_public_organization_sales_terms','is_event_sold_out','is_event_registration_open') LOOP EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO PUBLIC',f.signature);END LOOP;END $drift$;`+closure;
for(const rls of [true,false]){
 if(!rls)for(const t of ['organizations','organization_profile','events','event_products','event_form_fields','event_form_field_groups'])checks+=`ALTER TABLE public.${t} DISABLE ROW LEVEL SECURITY;`;
 for(const role of ['anon','authenticated'])for(const statement of [
  "select public.is_event_sold_out(gen_random_uuid())","select public.is_event_registration_open(gen_random_uuid())",
  "select public.get_public_org_by_slug('b5-a')","select public.get_public_org_events_overview('b5-a')","select public.get_public_event_detail('b5-a','event-101')","select public.get_public_organization_sales_terms('b5-a')",
  "select public.catalog_get_public_org_by_slug(gen_random_uuid(),'b5-a')","select public.catalog_get_public_org_events_overview(gen_random_uuid(),'b5-a',null)","select public.catalog_get_public_event_detail(gen_random_uuid(),'b5-a','event-101',null,null)","select public.catalog_get_public_organization_sales_terms(gen_random_uuid(),'b5-a')","select public.catalog_event_share(gen_random_uuid(),gen_random_uuid(),null)",
  ...['organizations','organization_profile','events','event_products','event_form_fields','event_form_field_groups'].map(t=>`select * from public.${t} limit 1`)
 ])checks+=`SET LOCAL ROLE ${role};DO $test$ BEGIN BEGIN ${statement};EXCEPTION WHEN insufficient_privilege THEN RETURN;END;RAISE EXCEPTION 'access accepted';END $test$;RESET ROLE;`;
}
run(checks+"SET LOCAL ROLE service_role;SELECT public.is_event_registration_open(gen_random_uuid());SELECT public.is_event_sold_out(gen_random_uuid());RESET ROLE;ROLLBACK;");console.log('PASS B5 SQL: 205 events/keyset ties+NULLs, publication/scope, public fields, real ACL closure with/without RLS');
