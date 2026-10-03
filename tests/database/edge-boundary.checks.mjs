import { readFileSync } from 'node:fs';
import { closureSql } from './business-closure.mjs';
import { spawnSync } from 'node:child_process';
import { assertDisposableOrganizerContainer } from './disposable-container.mjs';

const container = process.argv[2];
assertDisposableOrganizerContainer(container);
function run(input) {
  const result = spawnSync('docker', ['exec', '-i', container, 'sh', '-c', 'PGPASSWORD="$POSTGRES_PASSWORD" exec psql -X -qAt -U supabase_admin -d postgres -v ON_ERROR_STOP=1'], { input, encoding: 'utf8', windowsHide: true });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout);
}
const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const retire = read('../../supabase/deferred-migrations/b6/20261003180000_retire_business_rls.sql').replace(/^\s*(?:BEGIN|COMMIT);\s*$/gmi, '');
run(`BEGIN;DO $negative$ BEGIN
 BEGIN EXECUTE $script$${retire}$script$; RAISE EXCEPTION 'retirement accepted before closure';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM NOT LIKE 'Close %' THEN RAISE; END IF; END;
END $negative$;ROLLBACK;`);
let sql = 'BEGIN;\n';
// Simulate drift: inherited PUBLIC/column rights, an owner-bypassing view,
// a forgotten SECURITY DEFINER, sequence and future-object default privileges.
for (const creator of ['postgres', 'supabase_admin']) {
  sql += `ALTER DEFAULT PRIVILEGES FOR ROLE ${creator} GRANT EXECUTE ON FUNCTIONS TO PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE ${creator} IN SCHEMA public GRANT ALL ON TABLES TO anon,authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE ${creator} IN SCHEMA public GRANT ALL ON SEQUENCES TO anon,authenticated;`;
}
sql += read('../../supabase/migrations/20261003122216_edge_boundary_defaults.sql');
sql += read('../../supabase/deferred-migrations/b6/managed-creator-defaults.sql').replace(/^\s*(?:BEGIN|COMMIT);\s*$/gmi, '');
for (const creator of ['postgres', 'supabase_admin']) {
  const tag = creator.replaceAll('_', '');
  sql += `SET LOCAL ROLE ${creator};
CREATE TABLE public.b6_future_${tag}(id int);
CREATE SEQUENCE public.b6_future_seq_${tag};
CREATE FUNCTION public.b6_future_fn_${tag}() RETURNS int LANGUAGE sql AS 'select 1'; RESET ROLE;`;
}
sql += `DO $defaults$ DECLARE obj record; browser text; BEGIN
 FOR obj IN SELECT c.oid,c.relkind FROM pg_class c WHERE c.relname LIKE 'b6_future_%' AND c.relnamespace='public'::regnamespace LOOP
  FOREACH browser IN ARRAY ARRAY['anon','authenticated'] LOOP
   IF obj.relkind='S' THEN
    IF has_sequence_privilege(browser,obj.oid,'USAGE,SELECT,UPDATE') THEN RAISE EXCEPTION 'future sequence open'; END IF;
   ELSE
    IF has_table_privilege(browser,obj.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') THEN RAISE EXCEPTION 'future table open'; END IF;
   END IF;
  END LOOP;
 END LOOP;
 FOR obj IN SELECT oid FROM pg_proc WHERE proname LIKE 'b6_future_%' LOOP
  FOREACH browser IN ARRAY ARRAY['anon','authenticated'] LOOP
   IF has_function_privilege(browser,obj.oid,'EXECUTE') THEN RAISE EXCEPTION 'future function open'; END IF;
  END LOOP;
 END LOOP;
END $defaults$;
CREATE VIEW public.b6_owner_view AS SELECT id FROM public.organizations;
CREATE PUBLICATION b6_fixture_publication FOR TABLE public.organizations;
CREATE FUNCTION public.b6_forgotten_rpc() RETURNS SETOF uuid LANGUAGE sql SECURITY DEFINER AS 'select id from public.organizations';
GRANT SELECT ON public.b6_owner_view TO PUBLIC;
GRANT SELECT(name) ON public.organizations TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.b6_forgotten_rpc() TO PUBLIC;
GRANT ALL ON SEQUENCE public.invoice_number_seq TO PUBLIC;
`;
sql += closureSql();
sql += retire;
sql += `DO $proof$ DECLARE obj record; browser text; args text; stmt text; BEGIN
 FOREACH browser IN ARRAY ARRAY['anon','authenticated'] LOOP
  FOR obj IN SELECT c.oid,c.oid::regclass AS name,c.relkind FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
   WHERE n.nspname IN ('public','private','graphql_public') AND c.relkind IN ('r','p','v','m','S') LOOP
   IF obj.relkind='S' THEN
    IF has_sequence_privilege(browser,obj.oid,'USAGE,SELECT,UPDATE') THEN RAISE EXCEPTION 'sequence open %',obj.name; END IF;
    stmt:=format('SELECT nextval(%L)',obj.name);
   ELSE
    IF has_table_privilege(browser,obj.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
      OR has_any_column_privilege(browser,obj.oid,'SELECT,INSERT,UPDATE,REFERENCES') THEN RAISE EXCEPTION 'relation open %',obj.name; END IF;
    stmt:=format('SELECT * FROM %s LIMIT 1',obj.name);
   END IF;
   EXECUTE format('SET LOCAL ROLE %I',browser);
   BEGIN EXECUTE stmt; RAISE EXCEPTION 'direct relation access accepted %',obj.name;
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
   RESET ROLE;
  END LOOP;
  FOR obj IN SELECT p.*,n.nspname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname IN ('public','private','graphql_public') LOOP
   IF has_function_privilege(browser,obj.oid,'EXECUTE') THEN RAISE EXCEPTION 'routine open %',obj.oid::regprocedure; END IF;
   -- Trigger/pseudo/internal argument types cannot be called directly in SQL.
   -- STRICT functions may be folded to NULL without execution/ACL checking;
   -- their ACL is asserted above, and unaccent is invoked with non-null below.
   IF obj.proisstrict OR obj.prorettype IN ('trigger'::regtype,'event_trigger'::regtype) OR EXISTS(
    SELECT 1 FROM unnest(obj.proargtypes::oid[]) t JOIN pg_type ty ON ty.oid=t WHERE ty.typtype='p') THEN CONTINUE; END IF;
   SELECT string_agg(CASE WHEN obj.provariadic<>0 AND ord=obj.pronargs THEN 'VARIADIC ' ELSE '' END || format('NULL::%s',t::regtype),',' ORDER BY ord)
    INTO args FROM unnest(obj.proargtypes::oid[]) WITH ORDINALITY types(t,ord);
   stmt:=format('%s %I.%I(%s)',CASE WHEN obj.prokind='p' THEN 'CALL' ELSE 'SELECT' END,obj.nspname,obj.proname,coalesce(args,''));
   EXECUTE format('SET LOCAL ROLE %I',browser);
   BEGIN EXECUTE stmt; RAISE EXCEPTION 'direct routine access accepted %',obj.oid::regprocedure;
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
   RESET ROLE;
  END LOOP;
 END LOOP;
 IF EXISTS(SELECT 1 FROM pg_publication_tables WHERE schemaname IN ('public','private')) THEN RAISE EXCEPTION 'business realtime remains'; END IF;
 IF EXISTS(SELECT 1 FROM pg_class WHERE relnamespace='public'::regnamespace AND relkind IN ('r','p') AND relrowsecurity) THEN RAISE EXCEPTION 'phase4 not applied'; END IF;
END $proof$;
SET LOCAL ROLE anon;
DO $strict$ BEGIN
 BEGIN PERFORM public.unaccent('synthetic'); RAISE EXCEPTION 'unaccent accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $strict$;
RESET ROLE;
-- Server remains operational and preserved acceptance/update SQL checks actor.
SET LOCAL ROLE service_role;
SELECT 1 FROM public.organizations LIMIT 1;
DO $actor$ BEGIN
 BEGIN PERFORM public.organizer_update_organization_payment_settings(gen_random_uuid(),gen_random_uuid(),'stripe');
  RAISE EXCEPTION 'foreign actor accepted'; EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'FORBIDDEN' THEN RAISE; END IF; END;
END $actor$;
RESET ROLE;
ROLLBACK;`;
run(sql);
console.log('PASS B6: all relations/columns/sequences/routines, real anon/authenticated denied without RLS; future creators/default ACL; owner view, GraphQL and Realtime closed');
