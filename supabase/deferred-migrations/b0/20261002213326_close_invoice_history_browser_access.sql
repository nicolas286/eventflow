-- PHASE 3 ONLY. Keep outside supabase/migrations until invoices/list and the
-- migrated frontend are published and the transition window is over.
-- See docs/audits/2026-10-02-backend-api-security-b0.md.
DO $$
DECLARE target record;
BEGIN
  -- Include every overload, including ones found during target preflight.
  FOR target IN
    SELECT p.oid::regprocedure AS signature
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'rpc_list_invoices'
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', target.signature);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', target.signature);
  END LOOP;

  -- Browser callers never write this server-owned table either. Removing ALL
  -- also closes UPDATE ... RETURNING and TRUNCATE; column ACLs are independent.
  REVOKE ALL ON TABLE public.invoices FROM PUBLIC, anon, authenticated;
  FOR target IN
    SELECT attname FROM pg_attribute
    WHERE attrelid = 'public.invoices'::regclass AND attnum > 0 AND NOT attisdropped
  LOOP
    EXECUTE format('REVOKE ALL (%I) ON TABLE public.invoices FROM PUBLIC, anon, authenticated', target.attname);
  END LOOP;
  GRANT SELECT ON TABLE public.invoices TO service_role;
END $$;

-- This application-owned policy is the equivalent browser PDF history path.
-- Do not change managed Storage grants/RLS or policies for organization assets.
DROP POLICY IF EXISTS invoices_read_auth_org_member ON storage.objects;
