-- PHASE 3 ONLY: deploy organizations, then frontend, then this closure.
-- Keep out of active migrations: deployment applies SQL before frontend.
DO $$ DECLARE target record; column_acl record; BEGIN
  FOR target IN SELECT p.oid::regprocedure signature FROM pg_proc p
    JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public'
    AND p.proname IN ('get_dashboard_bootstrap','create_organization',
      'update_organization','update_organization_seller_identity',
      'accept_organization_platform_agreements')
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated',target.signature);
    -- Old functions depend on auth.uid and are retired, not used by an Edge.
  END LOOP;
  FOR target IN SELECT c.oid::regclass relation FROM pg_class c
    JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public'
    AND c.relname IN ('organizations','organization_members','organization_profile','user_profile')
  LOOP
    EXECUTE format('REVOKE ALL ON TABLE %s FROM PUBLIC, anon, authenticated',target.relation);
    FOR column_acl IN SELECT attname FROM pg_attribute
      WHERE attrelid=target.relation AND attnum>0 AND NOT attisdropped
    LOOP
      EXECUTE format('REVOKE ALL (%I) ON TABLE %s FROM PUBLIC, anon, authenticated',column_acl.attname,target.relation);
    END LOOP;
  END LOOP;
END $$;
-- Organization tables still participate in B3-B6/public RPCs. Keep their RLS
-- until those consumers are migrated; no Edge uses policies for authorization.
-- RLS retirement is a separate phase after direct-ACL denial has been proved.
