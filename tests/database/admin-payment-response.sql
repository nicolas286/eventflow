-- Local synthetic fixtures only; all mutations roll back, no provider or email.
BEGIN;
UPDATE private.platform_settings SET registrations_open=true WHERE singleton;
INSERT INTO public.organizations(id,type,name,plan) VALUES
 ('a4000000-0000-4000-8000-000000000001','association','A4 fixture','pro');
INSERT INTO public.events(id,org_id,slug,title,is_published,starts_at,ends_at,deposit_cents) VALUES
 ('a4000000-0000-4000-8000-000000000002','a4000000-0000-4000-8000-000000000001','a4-full','A4 full',true,now()+interval '1 day',now()+interval '2 days',NULL),
 ('a4000000-0000-4000-8000-000000000003','a4000000-0000-4000-8000-000000000001','a4-deposit','A4 deposit',true,now()+interval '1 day',now()+interval '2 days',2000);
INSERT INTO public.event_products(id,event_id,name,price_cents,stock_qty,creates_attendees) VALUES
 ('a4000000-0000-4000-8000-000000000004','a4000000-0000-4000-8000-000000000002','A4 full ticket',10000,20,true),
 ('a4000000-0000-4000-8000-000000000005','a4000000-0000-4000-8000-000000000003','A4 deposit ticket',10000,20,true),
 ('a4000000-0000-4000-8000-000000000006','a4000000-0000-4000-8000-000000000002','A4 free ticket',0,20,true);
SET LOCAL ROLE service_role;
SET LOCAL "request.jwt.claim.role" = 'service_role';
DO $$ <<a4>>
DECLARE
 scenario record; intent jsonb; result jsonb; replay jsonb; order_id uuid;
 stock_before jsonb; stock_after jsonb; tickets_before integer; expected_status text;
BEGIN
 FOR scenario IN SELECT * FROM (VALUES
  ('custom','a4000000-0000-4000-8000-000000000002'::uuid,'a4000000-0000-4000-8000-000000000004'::uuid,1000,10000,9000),
  ('full','a4000000-0000-4000-8000-000000000002'::uuid,'a4000000-0000-4000-8000-000000000004'::uuid,10000,10000,0),
  ('deposit','a4000000-0000-4000-8000-000000000003'::uuid,'a4000000-0000-4000-8000-000000000005'::uuid,2000,2000,0),
  ('below-deposit','a4000000-0000-4000-8000-000000000003'::uuid,'a4000000-0000-4000-8000-000000000005'::uuid,1000,2000,1000)
 ) AS s(name,event_id,product_id,amount,due,remaining_due) LOOP
  intent := public.create_order_intent(scenario.event_id,
   jsonb_build_array(jsonb_build_object('event_product_id',scenario.product_id,'quantity',1)),
   jsonb_build_array(jsonb_build_object('event_product_id',scenario.product_id,'email','a4@example.test')),
   '{"email":"a4@example.test"}',NULL,NULL);
  order_id := (intent->>'order_id')::uuid;
  IF (intent->>'amount_due_now_cents')::integer <> scenario.due
    OR (SELECT deposit_due_cents_snapshot FROM public.orders WHERE id=a4.order_id) <> scenario.due
  THEN RAISE EXCEPTION 'Unexpected SQL requirement: %',intent; END IF;
  SELECT jsonb_build_array(reserved_qty,sold_qty) INTO stock_before FROM public.event_products WHERE id=scenario.product_id;
  SELECT count(*) INTO tickets_before FROM public.tickets WHERE tickets.order_id=a4.order_id;
  BEGIN
   PERFORM public.apply_order_payment(order_id,'offline',scenario.amount,'USD','a4-'||scenario.name,NULL,NULL);
   RAISE EXCEPTION 'Wrong currency accepted';
  EXCEPTION WHEN raise_exception THEN
   IF SQLERRM <> 'CURRENCY_MISMATCH' THEN RAISE; END IF;
  END;
  result := public.apply_order_payment(order_id,'offline',scenario.amount,'EUR','a4-'||scenario.name,NULL,'synthetic A4');
  expected_status := CASE WHEN scenario.amount=10000 THEN 'paid' ELSE 'partially_paid' END;
  IF result <> jsonb_build_object('ok',true,'order_id',order_id,'paid_cents',scenario.amount,
    'total_cents',10000,'discount_cents',0,'effective_total_cents',10000,'status',expected_status,'idempotent',false)
  THEN RAISE EXCEPTION 'Unexpected real payment JSON: %',result; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.orders o WHERE o.id=a4.order_id AND o.status=expected_status AND o.paid_cents=scenario.amount)
  THEN RAISE EXCEPTION 'Response disagrees with persisted order'; END IF;
  IF greatest(0,(intent->>'amount_due_now_cents')::integer-(result->>'paid_cents')::integer) <> scenario.remaining_due
  THEN RAISE EXCEPTION 'Wrong outstanding initial requirement'; END IF;
  SELECT jsonb_build_array(reserved_qty,sold_qty) INTO stock_after FROM public.event_products WHERE id=scenario.product_id;
  IF stock_after <> jsonb_build_array((stock_before->>0)::integer-1,(stock_before->>1)::integer+1)
  THEN RAISE EXCEPTION 'First payment stock lifecycle changed'; END IF;
  IF EXISTS (SELECT 1 FROM public.order_attendees a WHERE a.order_id=a4.order_id AND a.status<>'confirmed')
  THEN RAISE EXCEPTION 'First payment did not confirm attendees'; END IF;
  replay := public.apply_order_payment(order_id,'offline',scenario.amount,'EUR','a4-'||scenario.name,NULL,NULL);
  IF replay <> (result || '{"idempotent":true}'::jsonb)
  THEN RAISE EXCEPTION 'Replay changed payment JSON: %',replay; END IF;
  IF (SELECT count(*) FROM public.payments p WHERE p.order_id=a4.order_id) <> 1
    OR stock_after <> (SELECT jsonb_build_array(reserved_qty,sold_qty) FROM public.event_products WHERE id=scenario.product_id)
  THEN RAISE EXCEPTION 'Replay duplicated payment or stock'; END IF;
  -- apply_order_payment itself does not issue tickets; preserve this boundary.
  IF (SELECT count(*) FROM public.tickets t WHERE t.order_id=a4.order_id) <> tickets_before
  THEN RAISE EXCEPTION 'Payment unexpectedly issued tickets'; END IF;
  RAISE NOTICE 'A4 %: %, requirement remaining %',scenario.name,result,scenario.remaining_due;
 END LOOP;
 intent := public.create_order_intent('a4000000-0000-4000-8000-000000000002',
  '[{"event_product_id":"a4000000-0000-4000-8000-000000000006","quantity":1}]',
  '[{"event_product_id":"a4000000-0000-4000-8000-000000000006","email":"a4@example.test"}]',
  '{"email":"a4@example.test"}',NULL,NULL);
 IF intent->>'status'<>'paid' OR (intent->>'payment_required')::boolean OR (intent->>'amount_due_now_cents')::integer<>0
 THEN RAISE EXCEPTION 'Free intent changed: %',intent; END IF;
END $$;
ROLLBACK;
