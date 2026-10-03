-- PHASE 4 ONLY, separate high review after all closure releases and real-role
-- SQL/API proofs. Do not promote until deployed schemas/consumers are attested.
-- This intentionally changes production policy behavior; no historic rows drop.
BEGIN;
DO $retire$ DECLARE obj record; policy record; browser text; BEGIN
 FOR obj IN SELECT c.oid,c.oid::regclass AS name FROM pg_class c
   WHERE c.relnamespace='public'::regnamespace AND c.relkind IN ('r','p') LOOP
  FOREACH browser IN ARRAY ARRAY['anon','authenticated'] LOOP
   IF has_table_privilege(browser,obj.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
      OR has_any_column_privilege(browser,obj.oid,'SELECT,INSERT,UPDATE,REFERENCES') THEN
    RAISE EXCEPTION 'Close all table/column browser ACLs before retiring RLS: %',obj.name;
   END IF;
  END LOOP;
 END LOOP;
 IF EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace='public'::regnamespace
   AND (has_function_privilege('anon',p.oid,'EXECUTE') OR has_function_privilege('authenticated',p.oid,'EXECUTE'))) THEN
  RAISE EXCEPTION 'Close all public RPCs before retiring RLS';
 END IF;
 FOR obj IN SELECT c.oid,c.oid::regclass AS name FROM pg_class c
   WHERE c.relnamespace='public'::regnamespace AND c.relkind IN ('r','p') LOOP
  FOR policy IN SELECT polname FROM pg_policy WHERE polrelid=obj.oid LOOP
   EXECUTE format('DROP POLICY %I ON %s',policy.polname,obj.name);
  END LOOP;
  EXECUTE format('ALTER TABLE %s DISABLE ROW LEVEL SECURITY',obj.name);
 END LOOP;
END $retire$;
COMMIT;
