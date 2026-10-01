-- Read-only production guard: preserve the existing Stripe Connect pilot.
-- The rollout migration must have run already; running it now would reset the pilot flag.
DO $$
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

  -- Operators may authorize more users progressively. Do not cap their count.
  IF NOT EXISTS (
    SELECT 1 FROM public.organizations
    WHERE id = '64ee721d-3806-49f1-a351-feb0807c73da'
      AND stripe_connected_account_id = 'acct_1UL0dkAV8X2nondC'
      AND payments_provider = 'stripe'
  ) THEN
    RAISE EXCEPTION 'Existing production Stripe account mapping changed';
  END IF;
END $$;
