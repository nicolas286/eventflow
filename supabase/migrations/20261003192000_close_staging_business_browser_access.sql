-- Staging rollout only: deployed Edge/frontend consumers precede this closure.
-- Production keeps its transition window; local replay keeps the old baseline.
-- Managed extension ACLs/defaults are deliberately untouched. Schema USAGE is
-- the additional boundary for current/future managed objects in public.
DO $closure$
DECLARE
  assets_url text;
  obj record;
  col record;
  browser text;
  creator oid := 'postgres'::regrole;
BEGIN
  SELECT public_assets_base_url INTO assets_url
  FROM private.app_environment WHERE singleton;
  IF assets_url = 'https://dixirvllhfkvqoahhfqh.supabase.co/storage/v1/object/public/public-assets'
     OR assets_url IS NULL
     OR assets_url ~ '^https?://(localhost|127\.0\.0\.1|\[::1\])(:[0-9]+)?(/|$)' THEN
    RAISE NOTICE 'Browser closure skipped outside the attested staging environment';
    RETURN;
  END IF;
  IF assets_url <> 'https://cpcmcxerrsnnjncrhldr.supabase.co/storage/v1/object/public/public-assets' THEN
    RAISE EXCEPTION 'Browser closure refused: unknown environment';
  END IF;

  -- Only the known unaccent extension routines may have a managed owner in
  -- public. Never silently skip an unknown SECURITY DEFINER or app relation.
  IF EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname IN ('public','private') AND c.relkind IN ('r','p','v','m','S')
      AND NOT pg_has_role(current_user,c.relowner,'USAGE')
  ) OR EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname IN ('public','private')
      AND NOT pg_has_role(current_user,p.proowner,'USAGE')
      AND NOT (n.nspname='public' AND NOT p.prosecdef AND EXISTS (
        SELECT 1 FROM pg_depend d JOIN pg_extension e ON e.oid=d.refobjid
        WHERE d.classid='pg_proc'::regclass AND d.objid=p.oid
          AND d.refclassid='pg_extension'::regclass AND d.deptype='e'
          AND e.extname='unaccent'
      ))
  ) THEN
    RAISE EXCEPTION 'Browser closure refused: unreviewed managed business object';
  END IF;
  -- Hosted staging has no pg_graphql extension. Its managed invoker wrapper
  -- reports that disabled state and exposes no business data. Do not change
  -- managed ACLs to turn this harmless stub into a release privilege problem.
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname='pg_graphql')
     OR EXISTS (
       SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
       WHERE n.nspname='graphql_public'
         AND (p.oid <> 'graphql_public.graphql(text,text,jsonb,jsonb)'::regprocedure
           OR p.prosecdef
           OR position('pg_graphql extension is not enabled.' IN pg_get_functiondef(p.oid))=0)
     ) THEN
    RAISE EXCEPTION 'Browser closure refused: GraphQL configuration changed';
  END IF;

  FOR obj IN
    SELECT c.oid,c.oid::regclass AS name,c.relkind FROM pg_class c
    JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname IN ('public','private') AND c.relkind IN ('r','p','v','m','S')
      AND pg_has_role(current_user,c.relowner,'USAGE')
  LOOP
    IF obj.relkind='S' THEN
      EXECUTE format('REVOKE ALL ON SEQUENCE %s FROM PUBLIC,anon,authenticated',obj.name);
    ELSE
      EXECUTE format('REVOKE ALL ON TABLE %s FROM PUBLIC,anon,authenticated',obj.name);
      FOR col IN SELECT attname FROM pg_attribute
        WHERE attrelid=obj.oid AND attnum>0 AND NOT attisdropped LOOP
        EXECUTE format('REVOKE ALL (%I) ON TABLE %s FROM PUBLIC,anon,authenticated',col.attname,obj.name);
      END LOOP;
    END IF;
  END LOOP;
  FOR obj IN
    SELECT p.oid::regprocedure AS name FROM pg_proc p
    JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname IN ('public','private') AND p.prokind IN ('f','p')
      AND pg_has_role(current_user,p.proowner,'USAGE')
  LOOP
    EXECUTE format('REVOKE ALL ON ROUTINE %s FROM PUBLIC,anon,authenticated',obj.name);
    EXECUTE format('GRANT EXECUTE ON ROUTINE %s TO service_role',obj.name);
  END LOOP;
  REVOKE ALL ON SCHEMA public,private FROM PUBLIC,anon,authenticated;
  GRANT USAGE ON SCHEMA public TO service_role;
  DROP POLICY IF EXISTS invoices_read_auth_org_member ON storage.objects;
  DROP POLICY IF EXISTS "org members can upload their assets" ON storage.objects;
  DROP POLICY IF EXISTS "org members can update their assets" ON storage.objects;
  DROP POLICY IF EXISTS "org members can delete their assets" ON storage.objects;
  -- The public display policy and managed Auth/Storage RLS remain intact.
  FOR obj IN SELECT p.pubname,t.schemaname,t.tablename,p.pubowner
    FROM pg_publication p JOIN pg_publication_tables t ON t.pubname=p.pubname
    WHERE t.schemaname IN ('public','private') LOOP
    IF NOT pg_has_role(current_user,obj.pubowner,'USAGE') THEN
      RAISE EXCEPTION 'Browser closure refused: unreviewed managed publication';
    END IF;
    EXECUTE format('ALTER PUBLICATION %I DROP TABLE %I.%I',obj.pubname,obj.schemaname,obj.tablename);
  END LOOP;

  FOREACH browser IN ARRAY ARRAY['anon','authenticated'] LOOP
    IF has_schema_privilege(browser,'public','USAGE') OR has_schema_privilege(browser,'private','USAGE') THEN
      RAISE EXCEPTION 'Browser closure failed: schema USAGE remains for %',browser;
    END IF;
    IF EXISTS (
      SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname IN ('public','private') AND pg_has_role(current_user,p.proowner,'USAGE')
        AND has_function_privilege(browser,p.oid,'EXECUTE')
    ) THEN
      RAISE EXCEPTION 'Browser closure failed: application routine ACL remains for %',browser;
    END IF;
    IF EXISTS (
      SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname IN ('public','private') AND c.relkind IN ('r','p','v','m')
        AND CASE WHEN c.relkind IN ('r','p','v','m') THEN
          has_table_privilege(browser,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
          OR has_any_column_privilege(browser,c.oid,'SELECT,INSERT,UPDATE,REFERENCES') ELSE false END
    ) OR EXISTS (
      SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname IN ('public','private') AND c.relkind='S'
        AND CASE WHEN c.relkind='S' THEN has_sequence_privilege(browser,c.oid,'USAGE,SELECT,UPDATE') ELSE false END
    ) THEN
      RAISE EXCEPTION 'Browser closure failed: relation ACL remains for %',browser;
    END IF;
  END LOOP;
  IF NOT has_schema_privilege('service_role','public','USAGE') THEN
    RAISE EXCEPTION 'Browser closure failed: service schema access missing';
  END IF;
  -- Ensure the previously deployed postgres default boundary still holds.
  IF EXISTS (
    SELECT 1 FROM aclexplode(coalesce((SELECT defaclacl FROM pg_default_acl
      WHERE defaclrole=creator AND defaclnamespace=0 AND defaclobjtype='f'),acldefault('f',creator))) a
    WHERE a.grantee=0 OR a.grantee IN ('anon'::regrole,'authenticated'::regrole)
  ) OR EXISTS (
    SELECT 1 FROM pg_default_acl d CROSS JOIN LATERAL aclexplode(d.defaclacl) a
    WHERE d.defaclrole=creator AND d.defaclnamespace IN ('public'::regnamespace,'private'::regnamespace)
      AND a.grantee IN (0,'anon'::regrole,'authenticated'::regrole)
  ) THEN
    RAISE EXCEPTION 'Browser closure refused: postgres default privileges drifted';
  END IF;
  PERFORM pg_notify('pgrst','reload schema');
END $closure$;
