import { readFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { assertDisposableOrganizerContainer } from './disposable-container.mjs';

const container = process.argv[2];
assertDisposableOrganizerContainer(container);
const lot = process.argv[3] ?? 'b1';
if (!container?.startsWith('supabase_db_') || !/^[a-zA-Z0-9_-]+$/.test(container) || !['b1','b2'].includes(lot)) {
  throw new Error('Pass the disposable Supabase DB container and b1/b2');
}
const stage = process.argv[4] === '--ci' ? undefined : process.argv[4];
let tables = lot === 'b1'
  ? ['organizations','organization_members','organization_profile','user_profile','organization_billing']
  : ['events','event_products','event_form_fields','event_form_field_groups','promo_codes'];
let functions = lot === 'b1'
  ? ['get_dashboard_bootstrap','create_organization','update_organization','update_organization_seller_identity','accept_organization_platform_agreements','rpc_get_organization_billing','rpc_upsert_organization_billing']
  : ['get_events_overview','get_event_detail_admin_core','get_event_by_slug','create_event','update_event','duplicate_event','create_event_product','update_event_product','create_event_form_field','create_event_form_field_group'];
const directory = new URL(`../../supabase/deferred-migrations/${lot}/`, import.meta.url);
if (stage === 'profiles' && lot === 'b1') {
  tables = tables.filter(t => t !== 'organization_billing');
  functions = functions.filter(f => !f.includes('billing'));
} else if (stage === 'events' && lot === 'b2') {
  tables = ['events'];
  functions = ['get_events_overview','get_event_detail_admin_core','get_event_by_slug','create_event','update_event','duplicate_event'];
} else if (stage === 'products' && lot === 'b2') {
  tables = ['event_products'];
  functions = ['create_event_product','update_event_product'];
} else if (stage === 'form' && lot === 'b2') {
  tables = ['event_form_fields','event_form_field_groups'];
  functions = ['create_event_form_field','create_event_form_field_group'];
} else if (stage === 'promos' && lot === 'b2') {
  tables = ['promo_codes'];
  functions = [];
} else if (stage !== undefined) throw new Error('Unknown SQL verification stage');
const closure = readdirSync(directory).filter(name => name.endsWith('.sql') && (!stage || name.includes(stage))).sort().map(name => readFileSync(new URL(name, directory),'utf8')).join('\n');
const names = values => values.length ? values.map(v => `'${v}'`).join(',') : 'NULL';
const input = `BEGIN;
${tables.map(table => `GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE ON public.${table} TO PUBLIC; GRANT SELECT ON public.${table} TO anon;`).join('\n')}
DO $$ DECLARE t record; BEGIN
 FOR t IN SELECT attrelid::regclass relation,attname FROM pg_attribute
 WHERE attrelid IN (${tables.map(t => `'public.${t}'::regclass`).join(',')}) AND attnum>0 AND NOT attisdropped
 LOOP EXECUTE format('GRANT SELECT (%I), UPDATE (%I) ON %s TO authenticated',t.attname,t.attname,t.relation); END LOOP;
END $$;
${closure}
CREATE FUNCTION pg_temp.assert_organizer_browser_denied() RETURNS void LANGUAGE plpgsql AS $$
DECLARE target record; statement text; column_acl record; permission text;
BEGIN
 FOR target IN SELECT c.oid relation,c.oid::regclass relation_name FROM pg_class c
 JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname IN (${names(tables)}) LOOP
  FOREACH permission IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] LOOP
   IF has_table_privilege(current_user,target.relation,permission) THEN RAISE EXCEPTION 'Leaked % table ACL: % %',current_user,target.relation_name,permission; END IF;
  END LOOP;
  FOR column_acl IN SELECT attname FROM pg_attribute WHERE attrelid=target.relation AND attnum>0 AND NOT attisdropped LOOP
   FOREACH permission IN ARRAY ARRAY['SELECT','INSERT','UPDATE','REFERENCES'] LOOP
    IF has_column_privilege(current_user,target.relation,column_acl.attname,permission) THEN RAISE EXCEPTION 'Leaked column ACL: %.%',target.relation_name,column_acl.attname; END IF;
   END LOOP;
  END LOOP;
  FOREACH statement IN ARRAY ARRAY[format('SELECT * FROM %s LIMIT 0',target.relation_name),format('DELETE FROM %s WHERE false',target.relation_name),format('INSERT INTO %s DEFAULT VALUES',target.relation_name)] LOOP
   BEGIN EXECUTE statement; RAISE EXCEPTION 'Accepted browser operation: %',statement; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  END LOOP;
 END LOOP;
 FOR target IN SELECT p.oid,p.oid::regprocedure signature,p.proname,
  (SELECT string_agg('NULL::'||a::regtype::text,',') FROM unnest(p.proargtypes::oid[]) a) arguments
 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND (p.proname IN (${names(functions)}) OR p.proname LIKE 'organizer_%') LOOP
  IF has_function_privilege(current_user,target.oid,'EXECUTE') THEN RAISE EXCEPTION 'Leaked function ACL: %',target.signature; END IF;
  statement:=format('SELECT public.%I(%s)',target.proname,coalesce(target.arguments,''));
  BEGIN EXECUTE statement; RAISE EXCEPTION 'Accepted browser RPC: %',target.signature; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 END LOOP;
END $$;
GRANT EXECUTE ON FUNCTION pg_temp.assert_organizer_browser_denied() TO anon,authenticated;
SET LOCAL ROLE anon; SELECT pg_temp.assert_organizer_browser_denied(); RESET ROLE;
SET LOCAL ROLE authenticated; SELECT pg_temp.assert_organizer_browser_denied(); RESET ROLE;
${tables.map(table => `ALTER TABLE public.${table} DISABLE ROW LEVEL SECURITY;`).join('\n')}
SET LOCAL ROLE anon; SELECT pg_temp.assert_organizer_browser_denied(); RESET ROLE;
SET LOCAL ROLE authenticated; SELECT pg_temp.assert_organizer_browser_denied(); RESET ROLE;
SET LOCAL ROLE service_role;
${tables.map(table => `SELECT * FROM public.${table} LIMIT 0;`).join('\n')}
RESET ROLE;
-- An accessible view depending on a closed table is an equivalent path.
DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_class v JOIN pg_depend d ON d.objid IN (SELECT oid FROM pg_rewrite WHERE ev_class=v.oid)
 WHERE v.relkind IN ('v','m') AND d.refobjid IN (${tables.map(t => `'public.${t}'::regclass`).join(',')})
 AND (has_table_privilege('anon',v.oid,'SELECT') OR has_table_privilege('authenticated',v.oid,'SELECT'))) THEN RAISE EXCEPTION 'Re-inventory accessible equivalent view'; END IF; END $$;
ROLLBACK;`;
const result = spawnSync('docker',['exec','-i',container,'psql','-X','-q','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1'], {input,encoding:'utf8'});
if (result.error) throw result.error;
if (result.status !== 0) throw new Error(result.stderr || result.stdout);
console.log(`${lot.toUpperCase()}: actual browser table/RPC/column ACL denial with/without RLS; server reads preserved; closure rolled back.`);
