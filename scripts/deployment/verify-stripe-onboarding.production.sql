-- Read-only production guard: preserve the existing Stripe Connect pilot.
-- The rollout migration must have run already; running it now would reset the pilot flag.
DO $$
DECLARE
  allowed_count bigint;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM supabase_migrations.schema_migrations
    WHERE version = '20260929150000'
  ) THEN
    RAISE EXCEPTION 'Controlled Stripe rollout migration is pending; existing allowlist would be reset';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'user_profile'
      AND column_name = 'stripe_connect_allowed'
      AND column_default = 'false'
  ) THEN
    RAISE EXCEPTION 'Stripe Connect must be disabled by default';
  END IF;

  SELECT count(*) INTO allowed_count
  FROM public.user_profile
  WHERE stripe_connect_allowed IS TRUE;

  IF allowed_count <> 1 THEN
    RAISE EXCEPTION 'Expected one existing Stripe Connect pilot, found %', allowed_count;
  END IF;
END $$;
