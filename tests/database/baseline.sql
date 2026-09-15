DO $$
BEGIN
  IF (SELECT count(*) FROM public.plan_limits WHERE plan IN ('free', 'starter', 'pro')) <> 3 THEN
    RAISE EXCEPTION 'Missing business reference plans';
  END IF;
  IF has_function_privilege('anon', 'public.expire_orders(integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Anonymous callers must not expire orders';
  END IF;
  IF has_function_privilege('authenticated', 'public.expire_orders(integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Ordinary users must not expire orders';
  END IF;
  IF NOT has_function_privilege('service_role', 'public.expire_orders(integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Server must be able to expire orders';
  END IF;
  IF has_table_privilege('anon', 'private.app_environment', 'SELECT') THEN
    RAISE EXCEPTION 'Environment configuration must remain private';
  END IF;
  IF (SELECT public FROM storage.buckets WHERE id = 'invoices') IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'Invoice bucket must exist and be private';
  END IF;
  IF (SELECT public FROM storage.buckets WHERE id = 'public-assets') IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Public assets bucket is missing';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
             WHERE n.nspname = 'public' AND p.prosrc LIKE '%dixirvllhfkvqoahhfqh.supabase.co%') THEN
    RAISE EXCEPTION 'An RPC still embeds the production assets URL';
  END IF;
END $$;
