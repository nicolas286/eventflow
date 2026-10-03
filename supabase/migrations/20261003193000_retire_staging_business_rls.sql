-- Staging phase 2 only, after hosted tests attest the closed-browser boundary.
-- Application authorization now resides in Edge. SQL integrity/transactions
-- remain; managed Auth/Storage and private platform security are unchanged.
DO $retire$
DECLARE assets_url text; obj record; policy record; browser text;
BEGIN
  SELECT public_assets_base_url INTO assets_url FROM private.app_environment WHERE singleton;
  IF assets_url = 'https://dixirvllhfkvqoahhfqh.supabase.co/storage/v1/object/public/public-assets'
     OR assets_url IS NULL
     OR assets_url ~ '^https?://(localhost|127\.0\.0\.1|\[::1\])(:[0-9]+)?(/|$)' THEN
    RAISE NOTICE 'Business RLS retirement skipped outside the attested staging environment';
    RETURN;
  END IF;
  IF assets_url <> 'https://cpcmcxerrsnnjncrhldr.supabase.co/storage/v1/object/public/public-assets' THEN
    RAISE EXCEPTION 'Business RLS retirement refused: unknown environment';
  END IF;
  FOREACH browser IN ARRAY ARRAY['anon','authenticated'] LOOP
    IF has_schema_privilege(browser,'public','USAGE') OR has_schema_privilege(browser,'private','USAGE') THEN
      RAISE EXCEPTION 'Close browser schema access before retiring business RLS';
    END IF;
    FOR obj IN SELECT c.oid,c.oid::regclass AS name,c.relkind FROM pg_class c
      JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname IN ('public','private') AND c.relkind IN ('r','p','v','m','S') LOOP
      IF obj.relkind='S' THEN
        IF has_sequence_privilege(browser,obj.oid,'USAGE,SELECT,UPDATE') THEN
          RAISE EXCEPTION 'Close browser sequence access before retiring business RLS: %',obj.name;
        END IF;
      ELSIF has_table_privilege(browser,obj.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
         OR has_any_column_privilege(browser,obj.oid,'SELECT,INSERT,UPDATE,REFERENCES') THEN
        RAISE EXCEPTION 'Close browser relation access before retiring business RLS: %',obj.name;
      END IF;
    END LOOP;
    IF EXISTS (
      SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname IN ('public','private') AND pg_has_role(current_user,p.proowner,'USAGE')
        AND has_function_privilege(browser,p.oid,'EXECUTE')
    ) THEN
      RAISE EXCEPTION 'Close browser application RPC access before retiring business RLS';
    END IF;
  END LOOP;
  -- Unknown managed relations must never be altered by a routine release.
  IF EXISTS (SELECT 1 FROM pg_class c WHERE c.relnamespace='public'::regnamespace
    AND c.relkind IN ('r','p') AND NOT pg_has_role(current_user,c.relowner,'USAGE')) THEN
    RAISE EXCEPTION 'Business RLS retirement refused: unreviewed managed relation';
  END IF;
  IF NOT has_schema_privilege('service_role','public','USAGE') THEN
    RAISE EXCEPTION 'Business RLS retirement refused: service schema access missing';
  END IF;
  FOR obj IN SELECT c.oid,c.oid::regclass AS name FROM pg_class c
    WHERE c.relnamespace='public'::regnamespace AND c.relkind IN ('r','p') LOOP
    FOR policy IN SELECT polname FROM pg_policy WHERE polrelid=obj.oid LOOP
      EXECUTE format('DROP POLICY %I ON %s',policy.polname,obj.name);
    END LOOP;
    EXECUTE format('ALTER TABLE %s DISABLE ROW LEVEL SECURITY',obj.name);
  END LOOP;
  PERFORM pg_notify('pgrst','reload schema');
END $retire$;
