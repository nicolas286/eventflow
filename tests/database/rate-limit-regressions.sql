-- Disposable migrated database only. All synthetic fixtures are rolled back.
BEGIN;

DO $$
DECLARE
  v_result record;
  v_key text := 'a8-regressions:synthetic-user-a';
BEGIN
  IF has_function_privilege('anon', 'public.consume_rate_limit(text,text,integer,integer)', 'EXECUTE')
    OR has_function_privilege('authenticated', 'public.consume_rate_limit(text,text,integer,integer)', 'EXECUTE')
    OR NOT has_function_privilege('service_role', 'public.consume_rate_limit(text,text,integer,integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Rate-limit primitive must remain server-only';
  END IF;

  DELETE FROM private.rate_limit_hits WHERE key LIKE 'a8-regressions:%';
  SELECT * INTO v_result FROM public.consume_rate_limit('synthetic-user-a', 'a8-regressions', 2, 86400);
  IF NOT v_result.allowed OR v_result.request_count <> 1 OR v_result.retry_after_seconds <> 0 THEN
    RAISE EXCEPTION 'First request should be allowed with no retry delay';
  END IF;
  SELECT * INTO v_result FROM public.consume_rate_limit('synthetic-user-a', 'a8-regressions', 2, 86400);
  IF NOT v_result.allowed OR v_result.request_count <> 2 THEN
    RAISE EXCEPTION 'Request at the inclusive limit should be allowed';
  END IF;
  SELECT * INTO v_result FROM public.consume_rate_limit('synthetic-user-a', 'a8-regressions', 2, 86400);
  IF v_result.allowed OR v_result.request_count <> 3
    OR v_result.retry_after_seconds NOT BETWEEN 1 AND 86400 THEN
    RAISE EXCEPTION 'Excess request should be counted and receive a bounded positive retry delay';
  END IF;
  SELECT * INTO v_result FROM public.consume_rate_limit('synthetic-user-b', 'a8-regressions', 2, 86400);
  IF NOT v_result.allowed OR v_result.request_count <> 1 THEN
    RAISE EXCEPTION 'Different identity must have an independent counter';
  END IF;
  IF (SELECT hits FROM private.rate_limit_hits WHERE key = v_key) <> 3 THEN
    RAISE EXCEPTION 'User B must not consume user A counter';
  END IF;
  SELECT * INTO v_result FROM public.consume_rate_limit('synthetic-user-a', 'a8-regressions-other', 2, 86400);
  IF NOT v_result.allowed OR v_result.request_count <> 1 THEN
    RAISE EXCEPTION 'Different operation must have an independent counter';
  END IF;

  INSERT INTO private.rate_limit_hits(key, window_start, hits, updated_at)
  VALUES ('a8-regressions:expired-fixture', now() - interval '8 days', 1, now() - interval '8 days');
  PERFORM private.prune_rate_limits();
  IF EXISTS (SELECT 1 FROM private.rate_limit_hits WHERE key = 'a8-regressions:expired-fixture') THEN
    RAISE EXCEPTION 'Existing prune primitive must remove counters older than seven days';
  END IF;
  IF (SELECT hits FROM private.rate_limit_hits WHERE key = v_key) <> 3 THEN
    RAISE EXCEPTION 'Prune must retain recently updated counters';
  END IF;
END $$;

ROLLBACK;
