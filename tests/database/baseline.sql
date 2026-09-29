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
  IF has_table_privilege('authenticated', 'public.organizations', 'UPDATE') THEN
    RAISE EXCEPTION 'Organization bank details must not be directly updatable';
  END IF;
  IF has_table_privilege(
    'anon', 'private.bank_transfer_payment_instructions', 'SELECT'
  ) OR has_table_privilege(
    'authenticated', 'private.bank_transfer_payment_instructions', 'SELECT'
  ) OR has_table_privilege(
    'anon', 'private.organization_bank_account_audit', 'SELECT'
  ) OR has_table_privilege(
    'authenticated', 'private.organization_bank_account_audit', 'SELECT'
  ) THEN
    RAISE EXCEPTION 'Bank details and their audit trail must remain private';
  END IF;
  IF has_table_privilege(
    'anon', 'private.organization_sales_terms_acceptances', 'SELECT'
  ) OR has_table_privilege(
    'authenticated', 'private.organization_sales_terms_acceptances', 'SELECT'
  ) OR has_table_privilege(
    'anon', 'private.payment_refund_notifications', 'SELECT'
  ) OR has_table_privilege(
    'authenticated', 'private.payment_refund_notifications', 'SELECT'
  ) THEN
    RAISE EXCEPTION 'Terms and refund audit data must remain private';
  END IF;
  IF has_function_privilege(
    'authenticated', 'public.get_bank_transfer_instructions(uuid)', 'EXECUTE'
  ) OR has_function_privilege(
    'authenticated',
    'public.create_bank_transfer_payment(uuid,integer,text,text,text,text,text)',
    'EXECUTE'
  ) OR has_function_privilege(
    'authenticated',
    'public.mark_bank_transfer_manually_confirmed(uuid,uuid)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'Full bank-transfer storage RPCs must remain service-only';
  END IF;
  IF NOT has_function_privilege(
    'authenticated', 'public.expire_bank_transfer_order(uuid)', 'EXECUTE'
  ) OR NOT has_function_privilege(
    'authenticated',
    'public.get_bank_transfer_admin_summaries(uuid)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'Organizer bank-transfer actions are not available';
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

BEGIN;

INSERT INTO auth.users (
  id, aud, role, email, encrypted_password, created_at, updated_at
) VALUES (
  '30000000-0000-4000-8000-000000000001',
  'authenticated',
  'authenticated',
  'bank-owner@example.test',
  '',
  now(),
  now()
);

INSERT INTO public.organizations (id, type, name, created_by)
VALUES (
  '30000000-0000-4000-8000-000000000002',
  'association',
  'Bank Transfer Test',
  '30000000-0000-4000-8000-000000000001'
);

INSERT INTO public.organization_members (org_id, user_id, role)
VALUES (
  '30000000-0000-4000-8000-000000000002',
  '30000000-0000-4000-8000-000000000001',
  'owner'
);

INSERT INTO public.events (id, org_id, slug, title, is_published)
VALUES (
  '30000000-0000-4000-8000-000000000003',
  '30000000-0000-4000-8000-000000000002',
  'bank-transfer-test',
  'Bank Transfer Test Event',
  true
);

INSERT INTO public.event_products (
  id, event_id, name, price_cents, currency, stock_qty, reserved_qty,
  creates_attendees, attendees_per_unit
) VALUES (
  '30000000-0000-4000-8000-000000000004',
  '30000000-0000-4000-8000-000000000003',
  'Ticket',
  2500,
  'EUR',
  10,
  3,
  true,
  1
);

INSERT INTO public.orders (
  id, org_id, event_id, currency, total_cents, paid_cents, buyer_email,
  booking_token, status, expires_at
) VALUES
  (
    '30000000-0000-4000-8000-000000000005',
    '30000000-0000-4000-8000-000000000002',
    '30000000-0000-4000-8000-000000000003',
    'EUR', 2500, 0, 'pending-one@example.test', 'bank-token-one-0123456789abcdefghijklmnop',
    'awaiting_payment', now() + interval '20 minutes'
  ),
  (
    '30000000-0000-4000-8000-000000000006',
    '30000000-0000-4000-8000-000000000002',
    '30000000-0000-4000-8000-000000000003',
    'EUR', 5000, 0, 'pending-two@example.test', 'bank-token-two-0123456789abcdefghijklmnop',
    'awaiting_payment', now() + interval '20 minutes'
  );

INSERT INTO public.order_items (
  id, order_id, product_id, product_name_snapshot,
  unit_price_cents_snapshot, quantity
) VALUES
  (
    '30000000-0000-4000-8000-000000000007',
    '30000000-0000-4000-8000-000000000005',
    '30000000-0000-4000-8000-000000000004',
    'Ticket', 2500, 1
  ),
  (
    '30000000-0000-4000-8000-000000000008',
    '30000000-0000-4000-8000-000000000006',
    '30000000-0000-4000-8000-000000000004',
    'Ticket', 2500, 2
  );

SET LOCAL ROLE service_role;
SET LOCAL "request.jwt.claim.role" = 'service_role';

DO $$
DECLARE
  v_first jsonb;
  v_second jsonb;
  v_repeat jsonb;
BEGIN
  v_first := public.create_bank_transfer_payment(
    '30000000-0000-4000-8000-000000000005', 2500, 'EUR',
    'Bank Transfer Test ASBL', 'BE51 7320 8102 5262',
    'EVENTFLOW | Event | pending-one@example.test | EF-ONE', 'EF-ONE'
  );
  v_second := public.create_bank_transfer_payment(
    '30000000-0000-4000-8000-000000000006', 5000, 'EUR',
    'Bank Transfer Test ASBL', 'BE51732081025262',
    'EVENTFLOW | Event | pending-two@example.test | EF-TWO', 'EF-TWO'
  );
  v_repeat := public.create_bank_transfer_payment(
    '30000000-0000-4000-8000-000000000005', 2500, 'EUR',
    'Changed Beneficiary', 'BE68539007547034',
    'CHANGED COMMUNICATION', 'EF-CHANGED'
  );

  IF v_first->>'iban' IS DISTINCT FROM 'BE51732081025262'
     OR v_first->>'internalReference' IS DISTINCT FROM 'EF-ONE'
     OR v_second->>'internalReference' IS DISTINCT FROM 'EF-TWO'
     OR v_repeat->>'internalReference' IS DISTINCT FROM 'EF-ONE'
     OR v_repeat->>'iban' IS DISTINCT FROM 'BE51732081025262' THEN
    RAISE EXCEPTION 'Bank-transfer instructions were not stored as expected';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.orders
    WHERE id IN (
      '30000000-0000-4000-8000-000000000005',
      '30000000-0000-4000-8000-000000000006'
    ) AND (expires_at IS NOT NULL OR status <> 'awaiting_payment')
  ) THEN
    RAISE EXCEPTION 'Bank-transfer orders must remain pending without automatic expiry';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.payments
    WHERE order_id IN (
      '30000000-0000-4000-8000-000000000005',
      '30000000-0000-4000-8000-000000000006'
    ) AND (raw ? 'iban' OR raw ? 'beneficiary')
  ) THEN
    RAISE EXCEPTION 'Full bank details leaked into the public payment payload';
  END IF;
END $$;

RESET ROLE;
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.role" = 'authenticated';
SET LOCAL "request.jwt.claim.sub" = '30000000-0000-4000-8000-000000000001';

DO $$
DECLARE
  v_result jsonb;
BEGIN
  v_result := public.expire_bank_transfer_order(
    '30000000-0000-4000-8000-000000000005'
  );
  IF v_result->>'status' IS DISTINCT FROM 'expired'
     OR (v_result->>'releasedUnits')::integer <> 1
     OR (v_result->>'idempotent')::boolean THEN
    RAISE EXCEPTION 'Manual bank-transfer expiration returned an invalid result';
  END IF;

  v_result := public.expire_bank_transfer_order(
    '30000000-0000-4000-8000-000000000005'
  );
  IF (v_result->>'idempotent')::boolean IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Manual bank-transfer expiration is not idempotent';
  END IF;
END $$;

RESET ROLE;
SET LOCAL ROLE service_role;
SET LOCAL "request.jwt.claim.role" = 'service_role';

DO $$
DECLARE
  v_payment jsonb;
  v_refund jsonb;
  v_ticket_count integer;
BEGIN
  v_payment := public.apply_order_payment(
    '30000000-0000-4000-8000-000000000006',
    'offline', 5000, 'EUR',
    'bank_transfer:30000000-0000-4000-8000-000000000006',
    jsonb_build_object(
      'method', 'bank_transfer',
      'communication', 'EVENTFLOW | Event | pending-two@example.test | EF-TWO',
      'internalReference', 'EF-TWO'
    ),
    'database baseline'
  );
  IF (v_payment->>'idempotent')::boolean THEN
    RAISE EXCEPTION 'The first manual payment confirmation was unexpectedly idempotent';
  END IF;

  v_payment := public.apply_order_payment(
    '30000000-0000-4000-8000-000000000006',
    'offline', 5000, 'EUR',
    'bank_transfer:30000000-0000-4000-8000-000000000006',
    jsonb_build_object('method', 'bank_transfer'),
    'database baseline duplicate'
  );
  IF (v_payment->>'idempotent')::boolean IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'A duplicate manual payment confirmation was not idempotent';
  END IF;

  SELECT inserted_count INTO v_ticket_count
  FROM public.issue_order_tickets('30000000-0000-4000-8000-000000000006');
  IF v_ticket_count <> 2 THEN
    RAISE EXCEPTION 'The first ticket issue did not create exactly two tickets';
  END IF;

  SELECT inserted_count INTO v_ticket_count
  FROM public.issue_order_tickets('30000000-0000-4000-8000-000000000006');
  IF v_ticket_count <> 0 OR (
    SELECT count(*) FROM public.tickets
    WHERE order_id = '30000000-0000-4000-8000-000000000006'
  ) <> 2 THEN
    RAISE EXCEPTION 'Duplicate confirmation created duplicate tickets';
  END IF;

  v_refund := public.apply_order_refund(
    '30000000-0000-4000-8000-000000000006',
    'offline',
    'refund-partial-test',
    'bank_transfer:30000000-0000-4000-8000-000000000006',
    2500,
    'EUR',
    'succeeded',
    '{}'::jsonb
  );
  IF (v_refund->>'fully_refunded')::boolean
     OR (v_refund->>'remaining_paid_cents')::integer <> 2500
     OR (
       SELECT status FROM public.orders
       WHERE id = '30000000-0000-4000-8000-000000000006'
     ) <> 'partially_paid'
     OR EXISTS (
       SELECT 1 FROM public.tickets
       WHERE order_id = '30000000-0000-4000-8000-000000000006'
         AND status <> 'valid'
     ) THEN
    RAISE EXCEPTION 'Partial refund incorrectly invalidated the reservation';
  END IF;

  v_refund := public.apply_order_refund(
    '30000000-0000-4000-8000-000000000006',
    'offline',
    'refund-partial-test',
    'bank_transfer:30000000-0000-4000-8000-000000000006',
    2500,
    'EUR',
    'succeeded',
    '{}'::jsonb
  );
  IF (v_refund->>'idempotent')::boolean IS DISTINCT FROM true
     OR (v_refund->>'remaining_paid_cents')::integer <> 2500 THEN
    RAISE EXCEPTION 'Duplicate refund was not idempotent';
  END IF;

  v_refund := public.apply_order_refund(
    '30000000-0000-4000-8000-000000000006',
    'offline',
    'refund-final-test',
    'bank_transfer:30000000-0000-4000-8000-000000000006',
    2500,
    'EUR',
    'succeeded',
    '{}'::jsonb
  );
  IF (v_refund->>'fully_refunded')::boolean IS DISTINCT FROM true
     OR (v_refund->>'remaining_paid_cents')::integer <> 0
     OR (
       SELECT status FROM public.orders
       WHERE id = '30000000-0000-4000-8000-000000000006'
     ) <> 'refunded'
     OR EXISTS (
       SELECT 1 FROM public.tickets
       WHERE order_id = '30000000-0000-4000-8000-000000000006'
         AND status <> 'refunded'
     ) THEN
    RAISE EXCEPTION 'Full refund did not invalidate the reservation exactly once';
  END IF;
END $$;

RESET ROLE;
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.role" = 'authenticated';
SET LOCAL "request.jwt.claim.sub" = '30000000-0000-4000-8000-000000000001';

DO $$
BEGIN
  BEGIN
    PERFORM public.expire_bank_transfer_order(
      '30000000-0000-4000-8000-000000000006'
    );
    RAISE EXCEPTION 'A paid bank-transfer order was expired';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT LIKE '%ORDER_NOT_EXPIRABLE%' THEN
        RAISE;
      END IF;
  END;
END $$;

RESET ROLE;

DO $$
BEGIN
  IF (
    SELECT status FROM public.orders
    WHERE id = '30000000-0000-4000-8000-000000000005'
  ) IS DISTINCT FROM 'expired'
     OR (
       SELECT status FROM public.orders
       WHERE id = '30000000-0000-4000-8000-000000000006'
     ) IS DISTINCT FROM 'refunded'
     OR (
       SELECT reserved_qty FROM public.event_products
       WHERE id = '30000000-0000-4000-8000-000000000004'
     ) <> 0
     OR (
       SELECT sold_qty FROM public.event_products
       WHERE id = '30000000-0000-4000-8000-000000000004'
     ) <> 0 THEN
    RAISE EXCEPTION 'Bank-transfer stock or final statuses are inconsistent';
  END IF;
END $$;

ROLLBACK;

BEGIN;

INSERT INTO auth.users (
  id,
  aud,
  role,
  email,
  encrypted_password,
  created_at,
  updated_at
) VALUES (
  '20000000-0000-4000-8000-000000000001',
  'authenticated',
  'authenticated',
  'stripe-gate@example.test',
  '',
  now(),
  now()
), (
  '20000000-0000-4000-8000-000000000003',
  'authenticated',
  'authenticated',
  'bank-attacker@example.test',
  '',
  now(),
  now()
);

INSERT INTO public.organizations (id, type, name, created_by)
VALUES (
  '20000000-0000-4000-8000-000000000002',
  'association',
  'Stripe Gate Test',
  '20000000-0000-4000-8000-000000000001'
);

INSERT INTO public.organization_members (org_id, user_id, role)
VALUES (
  '20000000-0000-4000-8000-000000000002',
  '20000000-0000-4000-8000-000000000001',
  'owner'
);

INSERT INTO public.organization_profile (
  org_id, slug, display_name, public_email
) VALUES (
  '20000000-0000-4000-8000-000000000002',
  'stripe-gate-test',
  'Stripe Gate Test',
  'stripe-gate@example.test'
);

INSERT INTO public.events (id, org_id, slug, title, is_published)
VALUES (
  '20000000-0000-4000-8000-000000000004',
  '20000000-0000-4000-8000-000000000002',
  'stripe-terms-test',
  'Stripe Terms Test Event',
  true
);

INSERT INTO public.orders (
  id, org_id, event_id, currency, total_cents, paid_cents, buyer_email,
  booking_token, status, expires_at
) VALUES (
  '20000000-0000-4000-8000-000000000005',
  '20000000-0000-4000-8000-000000000002',
  '20000000-0000-4000-8000-000000000004',
  'EUR', 2500, 0, 'buyer@example.test',
  'stripe-terms-token-0123456789abcdefghijklmnop',
  'awaiting_payment', now() + interval '20 minutes'
);

UPDATE public.organizations
SET stripe_connected_account_id = 'acct_express_legacy'
WHERE id = '20000000-0000-4000-8000-000000000002';

SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.role" = 'authenticated';
SET LOCAL "request.jwt.claim.sub" = '20000000-0000-4000-8000-000000000001';

DO $$
DECLARE
  v_result jsonb;
BEGIN
  IF (
    SELECT payments_provider
    FROM public.organizations
    WHERE id = '20000000-0000-4000-8000-000000000002'
  ) IS DISTINCT FROM 'stripe' THEN
    RAISE EXCEPTION 'Every organizer must start on Stripe';
  END IF;

  BEGIN
    UPDATE public.user_profile
    SET stripe_connect_allowed = false
    WHERE user_id = '20000000-0000-4000-8000-000000000001';
    RAISE EXCEPTION 'An authenticated user changed their own Stripe rollout flag';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT LIKE '%FORBIDDEN%' THEN
        RAISE;
      END IF;
  END;

  v_result := public.update_organization_payment_settings(
    '20000000-0000-4000-8000-000000000002',
    'stripe',
    NULL,
    NULL
  );

  IF v_result->>'paymentsProvider' IS DISTINCT FROM 'stripe' THEN
    RAISE EXCEPTION 'Stripe could not be selected';
  END IF;

  BEGIN
    PERFORM public.update_organization_payment_settings(
      '20000000-0000-4000-8000-000000000002',
      'bank_transfer',
      'Stripe Gate Test ASBL',
      'BE51732081025262'
    );
    RAISE EXCEPTION 'Bank transfer was enabled despite the global kill switch';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT LIKE '%BANK_TRANSFER_DISABLED%' THEN
        RAISE;
      END IF;
  END;

  v_result := public.accept_organization_sales_terms(
    '20000000-0000-4000-8000-000000000002',
    (
      SELECT sales_terms
      FROM public.organization_profile
      WHERE org_id = '20000000-0000-4000-8000-000000000002'
    )
  );
  IF (v_result->>'salesTermsCurrent')::boolean IS DISTINCT FROM true
     OR v_result->>'salesTermsAcceptedBy'
        IS DISTINCT FROM '20000000-0000-4000-8000-000000000001' THEN
    RAISE EXCEPTION 'Organizer terms acceptance was not recorded';
  END IF;

  PERFORM set_config(
    'request.jwt.claim.sub',
    '20000000-0000-4000-8000-000000000003',
    true
  );
  BEGIN
    PERFORM public.update_organization_payment_settings(
      '20000000-0000-4000-8000-000000000002',
      'stripe',
      NULL,
      NULL
    );
    RAISE EXCEPTION 'Another organization user changed payment settings';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT LIKE '%FORBIDDEN%' THEN
        RAISE;
      END IF;
  END;

  BEGIN
    PERFORM public.accept_organization_sales_terms(
      '20000000-0000-4000-8000-000000000002',
      (
        SELECT sales_terms
        FROM public.organization_profile
        WHERE org_id = '20000000-0000-4000-8000-000000000002'
      )
    );
    RAISE EXCEPTION 'Another organization user accepted organizer terms';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT LIKE '%FORBIDDEN%' THEN
        RAISE;
      END IF;
  END;
END $$;

RESET ROLE;
SET LOCAL ROLE service_role;
SET LOCAL "request.jwt.claim.role" = 'service_role';

SELECT public.record_order_terms_acceptance(
  '20000000-0000-4000-8000-000000000005',
  'database-baseline-v1'
);
SELECT public.replace_stripe_account_for_standard_migration(
  '20000000-0000-4000-8000-000000000002',
  'acct_express_legacy',
  'acct_standard_replacement'
);

RESET ROLE;

DO $$
BEGIN
  IF (
    SELECT count(*)
    FROM private.organization_sales_terms_acceptances
    WHERE org_id = '20000000-0000-4000-8000-000000000002'
      AND accepted_by = '20000000-0000-4000-8000-000000000001'
  ) <> 1 THEN
    RAISE EXCEPTION 'Organizer terms acceptance history is missing';
  END IF;
  IF (
    SELECT terms_accepted_at IS NOT NULL
       AND platform_terms_version = 'database-baseline-v1'
       AND organizer_sales_terms_version IS NOT NULL
       AND char_length(organizer_sales_terms_snapshot) >= 200
       AND organizer_display_name_snapshot IS NOT NULL
    FROM public.orders
    WHERE id = '20000000-0000-4000-8000-000000000005'
  ) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Buyer terms acceptance snapshot is missing';
  END IF;
  IF (
    SELECT stripe_connected_account_id = 'acct_standard_replacement'
       AND stripe_legacy_account_ids ? 'acct_express_legacy'
    FROM public.organizations
    WHERE id = '20000000-0000-4000-8000-000000000002'
  ) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Express-to-Standard migration did not preserve the legacy account id';
  END IF;
END $$;

ROLLBACK;

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
      AND table_name = 'user_profile'
      AND column_name = 'stripe_connect_allowed'
      AND data_type = 'boolean'
      AND column_default = 'true'
  ) THEN
    RAISE EXCEPTION 'The global Stripe Connect rollout default is missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'user_profile'
      AND t.tgname = 'trg_protect_stripe_connect_allowlist'
      AND NOT t.tgisinternal
  ) THEN
    RAISE EXCEPTION 'Stripe Connect rollout changes are not protected server-side';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'organizations'
      AND column_name = 'stripe_compliance_verified'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'organizations'
      AND column_name = 'stripe_legacy_account_ids'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'payments'
      AND column_name = 'checkout_expires_at'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'orders'
      AND column_name = 'organizer_sales_terms_snapshot'
  ) THEN
    RAISE EXCEPTION 'Stripe compliance columns are missing';
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
