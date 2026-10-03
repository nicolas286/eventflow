-- PHASE 3 ONLY: B0–B5 Edge, frontend AND Netlify published; external clients
-- inventoried; B0 24h adoption window ended. Separate reviewed closure release.
-- Include B0/B1 Storage closures first. Never deploy this with the old frontend.
BEGIN;
-- GraphQL wrapper and extension routines are owned by supabase_admin locally.
-- A plain postgres release may silently warn rather than revoke their ACLs.
-- Fail before any change; apply via the managed operator, not routine db push.
DO $owner$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=current_user AND rolsuper)
 AND EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname IN ('public','private','graphql_public')
   AND NOT pg_has_role(current_user,p.proowner,'USAGE')) THEN
  RAISE EXCEPTION 'B6 closure requires the managed object owner; never escalate postgres membership';
 END IF;
END $owner$;
DO $closure$ DECLARE obj record; col record; target text; BEGIN
 FOREACH target IN ARRAY ARRAY['public','private','graphql_public'] LOOP
  FOR obj IN SELECT c.oid,c.oid::regclass AS name,c.relkind FROM pg_class c
    JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname=target AND c.relkind IN ('r','p','v','m','S') LOOP
   IF obj.relkind='S' THEN
    EXECUTE format('REVOKE ALL ON SEQUENCE %s FROM PUBLIC,anon,authenticated',obj.name);
   ELSE
    EXECUTE format('REVOKE ALL ON TABLE %s FROM PUBLIC,anon,authenticated',obj.name);
    FOR col IN SELECT attname FROM pg_attribute WHERE attrelid=obj.oid AND attnum>0 AND NOT attisdropped LOOP
     EXECUTE format('REVOKE ALL (%I) ON TABLE %s FROM PUBLIC,anon,authenticated',col.attname,obj.name);
    END LOOP;
   END IF;
  END LOOP;
  FOR obj IN SELECT p.oid::regprocedure AS name FROM pg_proc p
    JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname=target AND p.prokind IN ('f','p') LOOP
   EXECUTE format('REVOKE ALL ON ROUTINE %s FROM PUBLIC,anon,authenticated',obj.name);
   -- Internal callers retain the SQL owner's privileges. Edge uses service_role.
   EXECUTE format('GRANT EXECUTE ON ROUTINE %s TO service_role',obj.name);
  END LOOP;
 END LOOP;
END $closure$;
REVOKE CREATE ON SCHEMA public FROM PUBLIC,anon,authenticated;
REVOKE ALL ON SCHEMA private,graphql_public FROM PUBLIC,anon,authenticated;
GRANT USAGE ON SCHEMA graphql_public TO service_role;
-- No Realtime business consumers exist. Remove only our public relations;
-- managed Auth/Storage/Realtime schemas and publication itself remain intact.
DO $realtime$ DECLARE obj record; BEGIN
 FOR obj IN SELECT pubname,schemaname,tablename FROM pg_publication_tables
   WHERE schemaname IN ('public','private') LOOP
  EXECUTE format('ALTER PUBLICATION %I DROP TABLE %I.%I',obj.pubname,obj.schemaname,obj.tablename);
 END LOOP;
END $realtime$;
NOTIFY pgrst, 'reload schema';
COMMIT;
