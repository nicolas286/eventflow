BEGIN;
-- Open registrations only for these rolled-back stock lifecycle fixtures.
UPDATE private.platform_settings SET registrations_open=true WHERE singleton;
INSERT INTO auth.users(id,aud,role,email,encrypted_password,created_at,updated_at)
VALUES ('a3000000-0000-4000-8000-000000000001','authenticated','authenticated','product-a@example.test','',now(),now());
INSERT INTO public.organizations(id,type,name,plan) VALUES
 ('a3000000-0000-4000-8000-000000000002','association','Product organization A','pro'),
 ('a3000000-0000-4000-8000-000000000003','association','Product organization B','pro');
INSERT INTO public.organization_members(org_id,user_id,role)
VALUES ('a3000000-0000-4000-8000-000000000002','a3000000-0000-4000-8000-000000000001','owner');
INSERT INTO public.events(id,org_id,slug,title,is_published) VALUES
 ('a3000000-0000-4000-8000-000000000004','a3000000-0000-4000-8000-000000000002','product-a','Product event A',true),
 ('a3000000-0000-4000-8000-000000000005','a3000000-0000-4000-8000-000000000003','product-b','Product event B',true);
UPDATE public.events SET starts_at=now()+interval '1 day',ends_at=now()+interval '2 days'
 WHERE id IN ('a3000000-0000-4000-8000-000000000004','a3000000-0000-4000-8000-000000000005');
INSERT INTO public.event_products(id,event_id,name,price_cents,stock_qty,reserved_qty,sold_qty,creates_attendees) VALUES
 ('a3000000-0000-4000-8000-000000000006','a3000000-0000-4000-8000-000000000004','Paid product',1000,20,2,3,true),
 ('a3000000-0000-4000-8000-000000000007','a3000000-0000-4000-8000-000000000005','Foreign product',1000,20,2,3,true),
 ('a3000000-0000-4000-8000-000000000008','a3000000-0000-4000-8000-000000000004','Free product',0,20,0,0,true);

-- Effective ACLs include PUBLIC, role inheritance, and table grants.
DO $$
DECLARE role_name text; column_name text;
BEGIN
 FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
  IF has_table_privilege(role_name,'public.event_products','UPDATE')
   OR has_table_privilege(role_name,'public.event_products','INSERT')
   OR has_table_privilege(role_name,'public.event_products','TRUNCATE') THEN
   RAISE EXCEPTION 'Broad product mutation privilege remains for %',role_name; END IF;
  FOREACH column_name IN ARRAY ARRAY['id','created_at','updated_at','reserved_qty','sold_qty'] LOOP
   IF has_column_privilege(role_name,'public.event_products',column_name,'UPDATE')
    OR has_column_privilege(role_name,'public.event_products',column_name,'INSERT') THEN
    RAISE EXCEPTION 'System column % is writable by %',column_name,role_name; END IF;
  END LOOP;
  IF has_column_privilege(role_name,'public.event_products','event_id','UPDATE') THEN
   RAISE EXCEPTION 'Product event is directly reassignable by %',role_name; END IF;
 END LOOP;
END $$;
CREATE FUNCTION pg_temp.assert_product_system_writes_denied() RETURNS void LANGUAGE plpgsql AS $$
DECLARE column_name text; expression text;
BEGIN
 FOR column_name,expression IN SELECT * FROM (VALUES
  ('reserved_qty','0'),('sold_qty','0'),('created_at','now()'),('updated_at','now()'),
  ('id','''a3000000-0000-4000-8000-000000000099''::uuid'),
  ('event_id','''a3000000-0000-4000-8000-000000000005''::uuid')) AS assignments(col,expr)
 LOOP
  BEGIN
   EXECUTE format('UPDATE public.event_products SET %I=%s WHERE id=''a3000000-0000-4000-8000-000000000006''',column_name,expression);
   RAISE EXCEPTION 'Direct system UPDATE accepted for % by %',column_name,current_user;
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  IF column_name <> 'event_id' THEN
   BEGIN
    EXECUTE format('INSERT INTO public.event_products(event_id,name,price_cents,%I) VALUES (''a3000000-0000-4000-8000-000000000004'',''Injected product'',0,%s)',column_name,expression);
    RAISE EXCEPTION 'Direct system INSERT accepted for % by %',column_name,current_user;
   EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  END IF;
 END LOOP;
 BEGIN
  TRUNCATE public.event_products;
  RAISE EXCEPTION 'Product TRUNCATE accepted for %',current_user;
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
-- Temporary test helper only; B6 closes implicit PUBLIC EXECUTE defaults.
GRANT EXECUTE ON FUNCTION pg_temp.assert_product_system_writes_denied() TO anon,authenticated,service_role;
SET LOCAL ROLE anon;
SET LOCAL "request.jwt.claim.role" = 'anon';
SELECT pg_temp.assert_product_system_writes_denied();
RESET ROLE;
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.role" = 'authenticated';
SET LOCAL "request.jwt.claim.sub" = 'a3000000-0000-4000-8000-000000000001';
SELECT pg_temp.assert_product_system_writes_denied();
DO $$
DECLARE product_id uuid; affected integer;
BEGIN
 -- Direct business-column UPDATE remains available during the Edge transition.
 UPDATE public.event_products SET name='Organizer edit',description='Synthetic description',sort_order=2
  WHERE id='a3000000-0000-4000-8000-000000000006';
 GET DIAGNOSTICS affected=ROW_COUNT;
 IF affected <> 1 THEN RAISE EXCEPTION 'Legitimate product edit was blocked'; END IF;
 UPDATE public.event_products SET name='Foreign edit' WHERE id='a3000000-0000-4000-8000-000000000007';
 GET DIAGNOSTICS affected=ROW_COUNT;
 IF affected <> 0 THEN RAISE EXCEPTION 'Foreign tenant product changed'; END IF;
 -- Current frontend create/update/read/delete contract, under the user role.
 product_id := public.create_event_product(jsonb_build_object('event_id','a3000000-0000-4000-8000-000000000004',
   'name','Frontend product','price_cents',0,'currency','EUR','stock_qty',10,'creates_attendees',false));
 PERFORM public.update_event_product(jsonb_build_object('product_id',product_id,'name','Frontend edited','stock_qty',12));
 IF NOT EXISTS (SELECT 1 FROM public.event_products WHERE id=product_id AND name='Frontend edited'
  AND stock_qty=12 AND reserved_qty=0 AND sold_qty=0) THEN RAISE EXCEPTION 'Frontend RPC contract regressed'; END IF;
 DELETE FROM public.event_products WHERE id=product_id;
 GET DIAGNOSTICS affected=ROW_COUNT;
 IF affected <> 1 THEN RAISE EXCEPTION 'Frontend product deletion regressed'; END IF;
END $$;
RESET ROLE;
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM public.event_products WHERE id='a3000000-0000-4000-8000-000000000006'
  AND reserved_qty=2 AND sold_qty=3) THEN RAISE EXCEPTION 'Counters changed through browser edits'; END IF;
END $$;

SET LOCAL ROLE service_role;
SET LOCAL "request.jwt.claim.role" = 'service_role';
SET LOCAL "request.jwt.claim.sub" = '';
DO $$
DECLARE paid_order uuid; expired_order uuid; result jsonb;
BEGIN
 result := public.create_order_intent('a3000000-0000-4000-8000-000000000004',
  '[{"event_product_id":"a3000000-0000-4000-8000-000000000006","quantity":1}]',
  '[{"event_product_id":"a3000000-0000-4000-8000-000000000006","email":"attendee@example.test"}]',
  '{"email":"purchase@example.test"}',NULL,NULL);
 paid_order := (result->>'order_id')::uuid;
 IF paid_order IS NULL OR (SELECT reserved_qty FROM public.event_products WHERE id='a3000000-0000-4000-8000-000000000006') <> 3
 THEN RAISE EXCEPTION 'Purchase did not reserve stock'; END IF;
 PERFORM public.apply_order_payment(paid_order,'offline',1000,'EUR','a3-paid','{"method":"bank_transfer"}','synthetic payment');
 IF NOT EXISTS (SELECT 1 FROM public.event_products WHERE id='a3000000-0000-4000-8000-000000000006'
  AND reserved_qty=2 AND sold_qty=4) THEN RAISE EXCEPTION 'Purchase did not convert reserved to sold stock'; END IF;
 PERFORM public.apply_order_refund(paid_order,'offline','a3-refund','a3-paid',1000,'EUR','succeeded','{}');
 PERFORM public.apply_order_refund(paid_order,'offline','a3-refund','a3-paid',1000,'EUR','succeeded','{}');
 IF NOT EXISTS (SELECT 1 FROM public.event_products WHERE id='a3000000-0000-4000-8000-000000000006'
  AND reserved_qty=2 AND sold_qty=3) THEN RAISE EXCEPTION 'Refund did not release sold stock exactly once'; END IF;
 result := public.create_order_intent('a3000000-0000-4000-8000-000000000004',
  '[{"event_product_id":"a3000000-0000-4000-8000-000000000006","quantity":1}]',
  '[{"event_product_id":"a3000000-0000-4000-8000-000000000006","email":"attendee@example.test"}]',
  '{"email":"expiry@example.test"}',NULL,NULL);
 expired_order := (result->>'order_id')::uuid;
 IF expired_order IS NULL OR (SELECT reserved_qty FROM public.event_products WHERE id='a3000000-0000-4000-8000-000000000006') <> 3
 THEN RAISE EXCEPTION 'Expiring purchase did not reserve stock'; END IF;
 UPDATE public.orders SET expires_at=now()-interval '1 minute' WHERE id=expired_order;
 PERFORM public.expire_orders();
 PERFORM public.expire_orders();
 IF (SELECT status FROM public.orders WHERE id=expired_order) <> 'expired'
  OR NOT EXISTS (SELECT 1 FROM public.event_products WHERE id='a3000000-0000-4000-8000-000000000006'
   AND reserved_qty=2 AND sold_qty=3) THEN RAISE EXCEPTION 'Expiration did not release reserved stock exactly once'; END IF;
 PERFORM public.create_order_intent('a3000000-0000-4000-8000-000000000004',
  '[{"event_product_id":"a3000000-0000-4000-8000-000000000008","quantity":1}]',
  '[{"event_product_id":"a3000000-0000-4000-8000-000000000008","email":"attendee@example.test"}]',
  '{"email":"free@example.test"}',NULL,NULL);
 IF NOT EXISTS (SELECT 1 FROM public.event_products WHERE id='a3000000-0000-4000-8000-000000000008'
  AND reserved_qty=0 AND sold_qty=1) THEN RAISE EXCEPTION 'Free purchase did not increment sold stock'; END IF;
END $$;
RESET ROLE;
ROLLBACK;
