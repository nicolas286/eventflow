DO $$
DECLARE
  v_allowed boolean;
  v_count integer;
  v_retry integer;
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
  IF has_function_privilege('anon', 'public.consume_rate_limit(text,text,integer,integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Anonymous callers must not consume rate limits directly';
  END IF;
  IF has_function_privilege('authenticated', 'public.consume_rate_limit(text,text,integer,integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Ordinary users must not consume rate limits directly';
  END IF;
  IF NOT has_function_privilege('service_role', 'public.consume_rate_limit(text,text,integer,integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Server must be able to consume rate limits';
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

  DELETE FROM private.rate_limit_hits
  WHERE key = 'database-baseline:synthetic-key-hash';

  SELECT allowed, request_count, retry_after_seconds
  INTO v_allowed, v_count, v_retry
  FROM public.consume_rate_limit('synthetic-key-hash', 'database-baseline', 1, 3600);

  IF v_allowed IS DISTINCT FROM true OR v_count <> 1 OR v_retry <> 0 THEN
    RAISE EXCEPTION 'First rate-limit consumption must be allowed';
  END IF;

  SELECT allowed, request_count, retry_after_seconds
  INTO v_allowed, v_count, v_retry
  FROM public.consume_rate_limit('synthetic-key-hash', 'database-baseline', 1, 3600);

  IF v_allowed IS DISTINCT FROM false OR v_count <> 2 OR v_retry <= 0 THEN
    RAISE EXCEPTION 'Second rate-limit consumption must be rejected';
  END IF;

  DELETE FROM private.rate_limit_hits
  WHERE key = 'database-baseline:synthetic-key-hash';
END $$;
