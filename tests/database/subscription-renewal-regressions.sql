-- Run on a disposable database after all migrations. All fixtures roll back.
BEGIN;

INSERT INTO auth.users (id, aud, role, email, encrypted_password, created_at, updated_at)
VALUES
  ('90000000-0000-4000-8000-000000000101', 'authenticated', 'authenticated', 'renewal-owner-a@example.test', '', now(), now()),
  ('90000000-0000-4000-8000-000000000102', 'authenticated', 'authenticated', 'renewal-owner-b@example.test', '', now(), now()),
  ('90000000-0000-4000-8000-000000000103', 'authenticated', 'authenticated', 'renewal-no-org@example.test', '', now(), now());

INSERT INTO public.organizations (id, type, name, created_by, bank_transfer_iban, bank_transfer_beneficiary)
VALUES
  ('90000000-0000-4000-8000-000000000001', 'association', 'Renewal A', '90000000-0000-4000-8000-000000000101', 'BE51732081025262', 'Synthetic A'),
  ('90000000-0000-4000-8000-000000000002', 'association', 'Renewal B', '90000000-0000-4000-8000-000000000102', null, null);

INSERT INTO public.organization_members (org_id, user_id, role)
VALUES
  ('90000000-0000-4000-8000-000000000001', '90000000-0000-4000-8000-000000000101', 'owner'),
  ('90000000-0000-4000-8000-000000000002', '90000000-0000-4000-8000-000000000102', 'owner');

INSERT INTO public.organization_billing (org_id, legal_name, address_line1, postal_code, city, country_code, billing_email)
VALUES
  ('90000000-0000-4000-8000-000000000001', 'Synthetic A', 'Test Street 1', '1000', 'Brussels', 'BE', 'renewal-a@example.test'),
  ('90000000-0000-4000-8000-000000000002', 'Synthetic B', 'Test Street 2', '1000', 'Brussels', 'BE', 'renewal-b@example.test');

SET LOCAL ROLE service_role;
SET LOCAL "request.jwt.claim.role" = 'service_role';

DO $$
DECLARE
  v_first jsonb;
  v_retry jsonb;
BEGIN
  v_first := public.create_manual_subscription_invoice(
    '90000000-0000-4000-8000-000000000001', 'starter', 1279, 'EUR', 'FOUNDER', 20
  );
  v_retry := public.create_manual_subscription_invoice(
    '90000000-0000-4000-8000-000000000001', 'starter', 1279, 'EUR', 'FOUNDER', 20
  );
  IF (v_first->>'reused')::boolean OR NOT (v_retry->>'reused')::boolean
     OR v_first->>'invoice_id' IS DISTINCT FROM v_retry->>'invoice_id' THEN
    RAISE EXCEPTION 'A repeated subscription must reuse the same invoice';
  END IF;
  PERFORM public.create_manual_subscription_invoice(
    '90000000-0000-4000-8000-000000000002', 'pro', 2599
  );
END $$;

RESET ROLE;
SET LOCAL "request.jwt.claim.role" = '';
SET LOCAL "request.jwt.claim.sub" = '';
SET LOCAL "request.jwt.claims" = '{}';

DO $$
DECLARE
  v_org_id constant uuid := '90000000-0000-4000-8000-000000000001';
  v_case record;
  v_end timestamptz;
  v_result jsonb;
  v_invoice public.invoices%ROWTYPE;
BEGIN
  IF current_user <> 'postgres' OR nullif(auth.role(), '') IS NOT NULL THEN
    RAISE EXCEPTION 'This test must exercise the real postgres cron role without a JWT';
  END IF;

  v_result := public.renew_manual_subscriptions();
  IF (v_result->>'renewed')::integer <> 0 OR (v_result->>'failed')::integer <> 0 THEN
    RAISE EXCEPTION 'Renewal must not invoice before the current period expires';
  END IF;

  -- The technical grace has an explicit finite boundary, including equality.
  FOR v_case IN
    SELECT * FROM (VALUES
      (interval '0 seconds', 'starter'),
      (interval '59 minutes 59 seconds', 'starter'),
      (interval '1 hour', 'starter'),
      (interval '1 hour 1 second', 'free')
    ) AS cases(overdue, expected_plan)
  LOOP
    v_end := now() - v_case.overdue;
    UPDATE public.subscriptions
      SET current_period_start = v_end - interval '1 month', current_period_end = v_end
      WHERE org_id = v_org_id;
    UPDATE public.organizations SET plan_expires_at = v_end WHERE id = v_org_id;
    IF public.get_org_plan(v_org_id) IS DISTINCT FROM v_case.expected_plan THEN
      RAISE EXCEPTION 'Unexpected effective plan at grace boundary %', v_case.overdue;
    END IF;
  END LOOP;

  v_end := now() - interval '2 minutes';
  UPDATE public.subscriptions SET current_period_end = v_end WHERE org_id = v_org_id;
  UPDATE public.organizations SET plan_expires_at = v_end WHERE id = v_org_id;

  UPDATE public.subscriptions SET status = 'canceled' WHERE org_id = v_org_id;
  IF public.get_org_plan(v_org_id) <> 'free' THEN
    RAISE EXCEPTION 'Canceled subscriptions must not receive renewal grace';
  END IF;
  v_result := public.renew_manual_subscriptions();
  IF (v_result->>'renewed')::integer <> 0 THEN
    RAISE EXCEPTION 'Canceled subscriptions must not renew';
  END IF;

  UPDATE public.subscriptions SET status = 'expired' WHERE org_id = v_org_id;
  IF public.get_org_plan(v_org_id) <> 'free' THEN
    RAISE EXCEPTION 'Expired subscriptions must not receive renewal grace';
  END IF;
  UPDATE public.subscriptions SET status = 'active', provider = 'mollie' WHERE org_id = v_org_id;
  IF public.get_org_plan(v_org_id) <> 'free' THEN
    RAISE EXCEPTION 'Legacy Mollie subscriptions must not receive manual renewal grace';
  END IF;
  v_result := public.renew_manual_subscriptions();
  IF (v_result->>'renewed')::integer <> 0 THEN
    RAISE EXCEPTION 'The manual worker must not renew Mollie subscriptions';
  END IF;

  UPDATE public.subscriptions SET provider = 'manual' WHERE org_id = v_org_id;
  UPDATE public.organizations SET plan = 'pro' WHERE id = v_org_id;
  IF public.get_org_plan(v_org_id) <> 'free' THEN
    RAISE EXCEPTION 'Mismatched plans must not receive renewal grace';
  END IF;
  v_result := public.renew_manual_subscriptions();
  IF (v_result->>'renewed')::integer <> 0 THEN
    RAISE EXCEPTION 'A stale subscription must not restore a different organization plan';
  END IF;

  UPDATE public.organizations SET plan = 'starter', plan_expires_at = v_end - interval '1 second' WHERE id = v_org_id;
  IF public.get_org_plan(v_org_id) <> 'free' THEN
    RAISE EXCEPTION 'Mismatched periods must not receive renewal grace';
  END IF;
  v_result := public.renew_manual_subscriptions();
  IF (v_result->>'renewed')::integer <> 0 THEN
    RAISE EXCEPTION 'A stale subscription must not overwrite a different organization period';
  END IF;

  UPDATE public.organizations SET plan_expires_at = v_end WHERE id = v_org_id;
  v_result := public.renew_manual_subscriptions();
  IF (v_result->>'renewed')::integer <> 1 OR (v_result->>'failed')::integer <> 0 THEN
    RAISE EXCEPTION 'Cron without a service JWT failed to renew: %', v_result;
  END IF;
  SELECT * INTO v_invoice FROM public.invoices
    WHERE org_id = v_org_id AND period_start = v_end;
  IF NOT FOUND OR v_invoice.period_end IS DISTINCT FROM v_end + interval '1 month'
     OR v_invoice.total_cents <> 1279
     OR v_invoice.billing_snapshot #>> '{subscription,promoCode}' IS DISTINCT FROM 'FOUNDER'
     OR v_invoice.billing_snapshot #>> '{subscription,discountPercent}' IS DISTINCT FROM '20'
     OR v_invoice.due_at IS DISTINCT FROM v_invoice.issued_at + interval '14 days' THEN
    RAISE EXCEPTION 'Renewal must preserve period boundaries, price, discount and payment terms';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.invoice_peppol
    WHERE invoice_id = v_invoice.id AND provider = 'billit' AND status = 'not_sent'
      AND attempt_count = 0 AND sent_at IS NULL AND last_status_at IS NULL
      AND error_code IS NULL AND error_message IS NULL AND payload_hash IS NULL
  ) THEN
    RAISE EXCEPTION 'The internal invoice must initialize the same Peppol state as the service helper';
  END IF;
  IF public.get_org_plan(v_org_id) <> 'starter' THEN
    RAISE EXCEPTION 'The renewed plan must remain effective';
  END IF;
  v_result := public.renew_manual_subscriptions();
  IF (v_result->>'renewed')::integer <> 0
     OR (SELECT count(*) FROM public.invoices WHERE org_id = v_org_id) <> 2 THEN
    RAISE EXCEPTION 'A repeated cron must not create a second invoice for the same period';
  END IF;

  -- A long outage ends grace but does not permanently block recovery or charge
  -- several historic months: one new period starts when the job succeeds.
  v_end := now() - interval '2 months';
  UPDATE public.subscriptions
    SET current_period_start = v_end - interval '1 month', current_period_end = v_end
    WHERE org_id = v_org_id;
  UPDATE public.organizations SET plan_expires_at = v_end WHERE id = v_org_id;
  IF public.get_org_plan(v_org_id) <> 'free' THEN
    RAISE EXCEPTION 'A long outage must not grant unlimited access';
  END IF;
  v_result := public.renew_manual_subscriptions();
  IF (v_result->>'renewed')::integer <> 1 OR (v_result->>'failed')::integer <> 0
     OR (SELECT count(*) FROM public.invoices WHERE org_id = v_org_id) <> 3
     OR (SELECT current_period_start FROM public.subscriptions WHERE org_id = v_org_id) IS DISTINCT FROM now()
     OR (SELECT current_period_end FROM public.subscriptions WHERE org_id = v_org_id) IS DISTINCT FROM now() + interval '1 month' THEN
    RAISE EXCEPTION 'Late recovery must restart at now without retroactive invoices: %', v_result;
  END IF;
END $$;

SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.role" = 'authenticated';
SET LOCAL "request.jwt.claim.sub" = '90000000-0000-4000-8000-000000000101';

DO $$
DECLARE
  v_bootstrap jsonb := public.get_dashboard_bootstrap();
BEGIN
  IF v_bootstrap #>> '{organization,id}' IS DISTINCT FROM '90000000-0000-4000-8000-000000000001'
     OR v_bootstrap->'latestOpenInvoice' IS NULL
     OR v_bootstrap->'latestOpenInvoice' = 'null'::jsonb
     OR v_bootstrap #>> '{latestOpenInvoice,total_cents}' IS DISTINCT FROM '1279'
     OR v_bootstrap #>> '{latestOpenInvoice,due_at}' IS NULL
     OR v_bootstrap #>> '{latestOpenInvoice,payment_reference}' IS NULL
     OR v_bootstrap #>> '{subscription,current_period_start}' IS NULL
     OR v_bootstrap #>> '{subscription,promo_code}' IS DISTINCT FROM 'FOUNDER'
     OR v_bootstrap #>> '{subscription,discount_percent}' IS DISTINCT FROM '20'
     OR v_bootstrap #>> '{subscription,billing_price_value}' IS DISTINCT FROM '12.79'
     OR v_bootstrap #>> '{subscription,billing_currency}' IS DISTINCT FROM 'EUR' THEN
    RAISE EXCEPTION 'The restored dashboard must contain its own invoice and complete subscription';
  END IF;
  IF v_bootstrap #>> '{organization,bank_transfer_iban}' LIKE '%5173208102%'
     OR v_bootstrap #>> '{organization,bank_transfer_iban}' NOT LIKE 'BE%5262' THEN
    RAISE EXCEPTION 'Restoring invoice fields must preserve IBAN masking';
  END IF;
  BEGIN
    PERFORM public.renew_manual_subscriptions();
    RAISE EXCEPTION 'Authenticated clients must not invoke the renewal worker';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM public.create_manual_subscription_invoice('90000000-0000-4000-8000-000000000001', 'pro', 1);
    RAISE EXCEPTION 'Authenticated clients must not create arbitrary subscription invoices';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;

SET LOCAL "request.jwt.claim.sub" = '90000000-0000-4000-8000-000000000102';
DO $$
DECLARE
  v_bootstrap jsonb := public.get_dashboard_bootstrap();
BEGIN
  IF v_bootstrap #>> '{organization,id}' IS DISTINCT FROM '90000000-0000-4000-8000-000000000002'
     OR v_bootstrap #>> '{latestOpenInvoice,total_cents}' IS DISTINCT FROM '2599' THEN
    RAISE EXCEPTION 'The other organization must receive only its own invoice';
  END IF;
END $$;

SET LOCAL "request.jwt.claim.sub" = '90000000-0000-4000-8000-000000000103';
DO $$
DECLARE
  v_bootstrap jsonb := public.get_dashboard_bootstrap();
BEGIN
  IF NOT (v_bootstrap ? 'latestOpenInvoice')
     OR v_bootstrap->'latestOpenInvoice' IS DISTINCT FROM 'null'::jsonb
     OR v_bootstrap->'organization' IS DISTINCT FROM 'null'::jsonb THEN
    RAISE EXCEPTION 'A user without an organization must not see any invoice';
  END IF;
END $$;

RESET ROLE;
SET LOCAL ROLE anon;
SET LOCAL "request.jwt.claim.role" = 'anon';
SET LOCAL "request.jwt.claim.sub" = '';
DO $$
BEGIN
  BEGIN
    PERFORM public.renew_manual_subscriptions();
    RAISE EXCEPTION 'Anonymous clients must not invoke the renewal worker';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM public.create_manual_subscription_invoice('90000000-0000-4000-8000-000000000001', 'pro', 1);
    RAISE EXCEPTION 'Anonymous clients must not create subscription invoices';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM public.get_dashboard_bootstrap();
    RAISE EXCEPTION 'Anonymous clients must not read dashboard invoices';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;

RESET ROLE;
SET LOCAL "request.jwt.claim.role" = '';
DO $$
DECLARE
  v_result jsonb;
BEGIN
  -- This matches cancellation's first write and must prevent a concurrent cron
  -- from reviving the plan before the subscription status is updated.
  UPDATE public.organizations SET plan = 'free', plan_expires_at = null
    WHERE id = '90000000-0000-4000-8000-000000000001';
  UPDATE public.subscriptions SET current_period_end = now() - interval '1 minute'
    WHERE org_id = '90000000-0000-4000-8000-000000000001';
  v_result := public.renew_manual_subscriptions();
  IF (v_result->>'renewed')::integer <> 0
     OR public.get_org_plan('90000000-0000-4000-8000-000000000001') <> 'free' THEN
    RAISE EXCEPTION 'A cancellation already reflected on the organization must not be undone';
  END IF;
  UPDATE public.subscriptions SET status = 'canceled'
    WHERE org_id = '90000000-0000-4000-8000-000000000001';
  v_result := public.renew_manual_subscriptions();
  IF (v_result->>'renewed')::integer <> 0 THEN
    RAISE EXCEPTION 'Completed cancellations must not create another invoice';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM cron.job
    WHERE jobname = 'eventflow-manual-subscription-renewals'
      AND schedule = '*/5 * * * *'
      AND command = 'select public.renew_manual_subscriptions();'
  ) THEN
    RAISE EXCEPTION 'The five-minute renewal job is missing';
  END IF;
END $$;

ROLLBACK;
