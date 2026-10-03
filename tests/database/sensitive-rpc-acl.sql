-- Synthetic fixtures only. Tests EXECUTE as real SQL roles, not mocked clients.
BEGIN;
INSERT INTO auth.users(id,aud,role,email,encrypted_password,created_at,updated_at)
VALUES ('a1000000-0000-4000-8000-000000000001','authenticated','authenticated','acl-a@example.test','',now(),now());
INSERT INTO public.organizations(id,type,name) VALUES
 ('a1000000-0000-4000-8000-000000000002','association','ACL organization A'),
 ('a1000000-0000-4000-8000-000000000003','association','ACL organization B');
INSERT INTO public.organization_members(org_id,user_id,role)
VALUES ('a1000000-0000-4000-8000-000000000002','a1000000-0000-4000-8000-000000000001','owner');
INSERT INTO public.events(id,org_id,slug,title) VALUES
 ('a1000000-0000-4000-8000-000000000004','a1000000-0000-4000-8000-000000000003','acl-b','ACL event B');
INSERT INTO public.orders(id,org_id,event_id,currency,total_cents,buyer_email,booking_token,status)
VALUES ('a1000000-0000-4000-8000-000000000005','a1000000-0000-4000-8000-000000000003',
 'a1000000-0000-4000-8000-000000000004','EUR',1000,'acl-b@example.test','synthetic-acl-booking-token-0123456789','awaiting_payment');

DO $$
DECLARE p record; n integer := 0;
BEGIN
 FOR p IN SELECT proc.* FROM pg_proc proc JOIN pg_namespace ns ON ns.oid=proc.pronamespace
  WHERE ns.nspname='public' AND proc.proname IN ('admin_grant_subscription','claim_order_confirmation_email',
   'log_email_once','mark_order_confirmation_email_error','mark_order_confirmation_email_sent')
 LOOP
  n := n+1;
  IF has_function_privilege('anon',p.oid,'EXECUTE') OR has_function_privilege('authenticated',p.oid,'EXECUTE')
   OR EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
              WHERE a.grantee=0 AND a.privilege_type='EXECUTE')
   OR NOT has_function_privilege('service_role',p.oid,'EXECUTE') THEN
   RAISE EXCEPTION 'Unexpected effective ACL on %',p.oid::regprocedure;
  END IF;
 END LOOP;
 IF n <> 5 THEN RAISE EXCEPTION 'Re-inventory sensitive RPC overloads: expected 5, found %',n; END IF;
END $$;

CREATE FUNCTION pg_temp.assert_sensitive_calls_denied() RETURNS void LANGUAGE plpgsql AS $$
DECLARE call_sql text;
BEGIN
 FOR call_sql IN SELECT unnest(ARRAY[
  'SELECT public.admin_grant_subscription(''a1000000-0000-4000-8000-000000000003'',''pro'',30,NULL)',
  'SELECT public.claim_order_confirmation_email(''a1000000-0000-4000-8000-000000000005'')',
  'SELECT public.log_email_once(''a1000000-0000-4000-8000-000000000005'',''confirmation_v1'')',
  'SELECT public.mark_order_confirmation_email_error(''a1000000-0000-4000-8000-000000000005'',''unauthorized'')',
  'SELECT public.mark_order_confirmation_email_sent(''a1000000-0000-4000-8000-000000000005'')'])
 LOOP
  BEGIN
   EXECUTE call_sql;
   RAISE EXCEPTION 'Unauthorized RPC executed by %: %',current_user,call_sql;
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
 END LOOP;
END $$;
-- Temporary test helper only; B6 closes implicit PUBLIC EXECUTE defaults.
GRANT EXECUTE ON FUNCTION pg_temp.assert_sensitive_calls_denied() TO anon,authenticated,service_role;

SET LOCAL ROLE anon;
SET LOCAL "request.jwt.claim.role" = 'anon';
SELECT pg_temp.assert_sensitive_calls_denied();
RESET ROLE;
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.role" = 'authenticated';
SET LOCAL "request.jwt.claim.sub" = 'a1000000-0000-4000-8000-000000000001';
SELECT pg_temp.assert_sensitive_calls_denied();
RESET ROLE;
DO $$ BEGIN
 IF (SELECT plan FROM public.organizations WHERE id='a1000000-0000-4000-8000-000000000003') <> 'free'
  OR EXISTS (SELECT 1 FROM public.subscriptions WHERE org_id='a1000000-0000-4000-8000-000000000003')
  OR EXISTS (SELECT 1 FROM public.order_email_logs WHERE order_id='a1000000-0000-4000-8000-000000000005')
  OR EXISTS (SELECT 1 FROM public.orders WHERE id='a1000000-0000-4000-8000-000000000005'
    AND (confirmation_email_claimed_at IS NOT NULL OR confirmation_email_sent_at IS NOT NULL OR confirmation_email_error IS NOT NULL))
 THEN RAISE EXCEPTION 'Denied calls changed subscription or email state'; END IF;
END $$;

SET LOCAL ROLE service_role;
SET LOCAL "request.jwt.claim.role" = 'service_role';
SET LOCAL "request.jwt.claim.sub" = '';
DO $$
DECLARE claim record;
BEGIN
 PERFORM public.admin_grant_subscription('a1000000-0000-4000-8000-000000000003','pro',30,NULL);
 SELECT * INTO claim FROM public.claim_order_confirmation_email('a1000000-0000-4000-8000-000000000005');
 IF claim.ok IS DISTINCT FROM true OR claim.booking_token <> 'synthetic-acl-booking-token-0123456789'
  OR claim.buyer_email <> 'acl-b@example.test' THEN RAISE EXCEPTION 'Server confirmation claim failed'; END IF;
 SELECT * INTO claim FROM public.claim_order_confirmation_email('a1000000-0000-4000-8000-000000000005');
 IF claim.ok IS DISTINCT FROM false OR claim.booking_token IS NOT NULL THEN RAISE EXCEPTION 'Email claim was not idempotent'; END IF;
 IF NOT public.log_email_once('a1000000-0000-4000-8000-000000000005','confirmation_v1')
  OR public.log_email_once('a1000000-0000-4000-8000-000000000005','confirmation_v1') THEN
  RAISE EXCEPTION 'Server email logging failed idempotence'; END IF;
 PERFORM public.mark_order_confirmation_email_error('a1000000-0000-4000-8000-000000000005','synthetic failure');
 IF (SELECT confirmation_email_error FROM public.orders WHERE id='a1000000-0000-4000-8000-000000000005') <> 'LEGACY_CONFIRMATION_OUTCOME_UNKNOWN'
 THEN RAISE EXCEPTION 'Server email error not stored'; END IF;
 PERFORM public.mark_order_confirmation_email_sent('a1000000-0000-4000-8000-000000000005');
END $$;
RESET ROLE;
DO $$ BEGIN
 IF (SELECT plan FROM public.organizations WHERE id='a1000000-0000-4000-8000-000000000003') <> 'pro'
  OR (SELECT status FROM public.subscriptions WHERE org_id='a1000000-0000-4000-8000-000000000003') <> 'active'
  OR NOT EXISTS (SELECT 1 FROM public.orders WHERE id='a1000000-0000-4000-8000-000000000005'
    AND confirmation_email_sent_at IS NOT NULL AND confirmation_email_error IS NULL)
 THEN RAISE EXCEPTION 'Legitimate server mutations did not persist'; END IF;
END $$;
ROLLBACK;
