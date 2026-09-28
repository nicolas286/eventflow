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

BEGIN;

INSERT INTO public.organizations (id, type, name)
VALUES ('10000000-0000-4000-8000-000000000001', 'association', 'Facturation Test');

INSERT INTO public.organization_billing (
  org_id,
  legal_name,
  address_line1,
  postal_code,
  city,
  country_code,
  billing_email
) VALUES (
  '10000000-0000-4000-8000-000000000001',
  'Facturation Test ASBL',
  'Rue du Test 1',
  '1000',
  'Bruxelles',
  'BE',
  'billing@example.test'
);

SET LOCAL ROLE service_role;
SET LOCAL "request.jwt.claim.role" = 'service_role';

DO $$
DECLARE
  first_result jsonb;
  second_result jsonb;
  renewal_result jsonb;
  invoice_row public.invoices%ROWTYPE;
BEGIN
  first_result := public.create_manual_subscription_invoice(
    '10000000-0000-4000-8000-000000000001',
    'starter',
    1599,
    'EUR',
    NULL,
    NULL
  );

  second_result := public.create_manual_subscription_invoice(
    '10000000-0000-4000-8000-000000000001',
    'starter',
    1599,
    'EUR',
    NULL,
    NULL
  );

  IF (first_result->>'reused')::boolean THEN
    RAISE EXCEPTION 'The first manual invoice must be newly created';
  END IF;

  IF NOT (second_result->>'reused')::boolean THEN
    RAISE EXCEPTION 'A repeated subscription request must reuse its invoice';
  END IF;

  IF first_result->>'invoice_id' IS DISTINCT FROM second_result->>'invoice_id' THEN
    RAISE EXCEPTION 'Idempotent subscription requests returned different invoices';
  END IF;

  SELECT * INTO invoice_row
  FROM public.invoices
  WHERE id = (first_result->>'invoice_id')::uuid;

  IF invoice_row.status IS DISTINCT FROM 'issued'::public.invoice_status
     OR invoice_row.total_cents <> 1599
     OR invoice_row.provider IS DISTINCT FROM 'manual'
     OR invoice_row.payment_reference IS DISTINCT FROM 'E-' || invoice_row.number
     OR invoice_row.due_at < invoice_row.issued_at + interval '13 days 23 hours'
     OR invoice_row.due_at > invoice_row.issued_at + interval '14 days 1 hour'
     OR invoice_row.billing_snapshot #>> '{payment,iban}' IS DISTINCT FROM 'BE51732081025262'
  THEN
    RAISE EXCEPTION 'The generated manual invoice has invalid payment terms';
  END IF;

  IF (SELECT plan FROM public.organizations WHERE id = invoice_row.org_id) IS DISTINCT FROM 'starter'
     OR (SELECT provider FROM public.subscriptions WHERE org_id = invoice_row.org_id) IS DISTINCT FROM 'manual'
  THEN
    RAISE EXCEPTION 'The subscription and organization plan were not activated atomically';
  END IF;

  UPDATE public.subscriptions
  SET current_period_end = now() - interval '1 minute'
  WHERE org_id = invoice_row.org_id;

  renewal_result := public.renew_manual_subscriptions();

  IF (renewal_result->>'renewed')::integer <> 1
     OR (renewal_result->>'failed')::integer <> 0
     OR (SELECT count(*) FROM public.invoices WHERE org_id = invoice_row.org_id) <> 2
  THEN
    RAISE EXCEPTION 'The scheduled manual renewal did not create exactly one invoice';
  END IF;

  renewal_result := public.renew_manual_subscriptions();

  IF (renewal_result->>'renewed')::integer <> 0
     OR (SELECT count(*) FROM public.invoices WHERE org_id = invoice_row.org_id) <> 2
  THEN
    RAISE EXCEPTION 'The scheduled manual renewal is not idempotent';
  END IF;
END $$;

ROLLBACK;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'organizations'
      AND column_name = 'stripe_connected_account_id'
  ) THEN
    RAISE EXCEPTION 'Stripe connected account mapping is missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'organizations'
      AND column_name = 'stripe_migration_required'
  ) THEN
    RAISE EXCEPTION 'Legacy organizer re-onboarding marker is missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'subscriptions'
      AND column_name = 'mollie_legacy_snapshot'
  ) THEN
    RAISE EXCEPTION 'Mollie subscription history snapshot is missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'subscriptions'
      AND column_name = 'mollie_subscription_id'
  ) THEN
    RAISE EXCEPTION 'Historical Mollie subscription identifiers must be preserved';
  END IF;

  IF has_table_privilege('anon', 'private.payment_webhook_events', 'SELECT')
     OR has_table_privilege('authenticated', 'private.payment_webhook_events', 'SELECT') THEN
    RAISE EXCEPTION 'Webhook idempotency records must remain private';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'invoices'
      AND column_name = 'due_at'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'invoices'
      AND column_name = 'payment_reference'
  ) THEN
    RAISE EXCEPTION 'Manual invoice payment terms are missing';
  END IF;

  IF has_function_privilege(
    'anon',
    'public.create_manual_subscription_invoice(uuid,text,integer,text,text,integer)',
    'EXECUTE'
  ) OR has_function_privilege(
    'authenticated',
    'public.create_manual_subscription_invoice(uuid,text,integer,text,text,integer)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'Clients must not create subscription invoices directly';
  END IF;

  IF NOT has_function_privilege(
    'service_role',
    'public.create_manual_subscription_invoice(uuid,text,integer,text,text,integer)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'The subscription endpoint must be able to create invoices';
  END IF;

  IF has_function_privilege('authenticated', 'public.renew_manual_subscriptions()', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.renew_manual_subscriptions()', 'EXECUTE') THEN
    RAISE EXCEPTION 'The renewal routine must remain service-only';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM cron.job
    WHERE jobname = 'eventflow-manual-subscription-renewals'
      AND schedule = '15 2 * * *'
  ) THEN
    RAISE EXCEPTION 'The daily manual subscription renewal job is missing';
  END IF;

  IF to_regprocedure(
    'public.apply_stripe_subscription_state(uuid,text,text,text,text,timestamptz,timestamptz,timestamptz,boolean,text,jsonb)'
  ) IS NOT NULL THEN
    RAISE EXCEPTION 'Stripe Billing synchronization must not be installed';
  END IF;
END $$;
