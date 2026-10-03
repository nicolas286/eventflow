-- B2.4 real roles, checkout failures, exact partial patches and old FK semantics.
BEGIN;
UPDATE private.platform_settings SET registrations_open=true WHERE singleton;
INSERT INTO auth.users(id,aud,role,email,encrypted_password,created_at,updated_at,raw_user_meta_data)
VALUES('b2400000-0000-4000-8000-000000000001','authenticated','authenticated','b24@example.test','',now(),now(),'{"platform_terms_version":"2026-10-01","platform_terms_accepted":true}');
INSERT INTO public.organizations(id,type,name,plan) VALUES
 ('b2400000-0000-4000-8000-000000000011','association','B24 Free plan promo org','free'),
 ('b2400000-0000-4000-8000-000000000012','association','B24 Foreign promo org','free');
INSERT INTO public.organization_members(org_id,user_id,role) VALUES('b2400000-0000-4000-8000-000000000011','b2400000-0000-4000-8000-000000000001','owner');
INSERT INTO public.events(id,org_id,slug,title,is_published,starts_at,ends_at) VALUES
 ('b2400000-0000-4000-8000-000000000021','b2400000-0000-4000-8000-000000000011','b24-promos','Promo event',true,now()+interval '1 day',now()+interval '2 days'),
 ('b2400000-0000-4000-8000-000000000022','b2400000-0000-4000-8000-000000000012','b24-foreign','Foreign event',true,now()+interval '1 day',now()+interval '2 days');
INSERT INTO public.event_products(id,event_id,name,price_cents,stock_qty,creates_attendees) VALUES
 ('b2400000-0000-4000-8000-000000000031','b2400000-0000-4000-8000-000000000021','Checkout product',1000,10,true);
CREATE FUNCTION pg_temp.assert_promo_error(statement text,expected text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
 BEGIN EXECUTE statement; EXCEPTION WHEN OTHERS THEN
  IF sqlerrm LIKE expected||'%' OR sqlstate=expected THEN RETURN; END IF; RAISE;
 END;
 RAISE EXCEPTION 'Expected promo error %, accepted: %',expected,statement;
END $$;
-- Temporary test helper only; B6 closes implicit PUBLIC EXECUTE defaults.
GRANT EXECUTE ON FUNCTION pg_temp.assert_promo_error(text,text) TO anon,authenticated,service_role;
DO $$ DECLARE p record; n int:=0; BEGIN
 FOR p IN SELECT proc.* FROM pg_proc proc JOIN pg_namespace ns ON ns.oid=proc.pronamespace
  WHERE ns.nspname='public' AND proc.proname IN ('organizer_create_event_promo_code','organizer_update_event_promo_code','organizer_delete_event_promo_code') LOOP
  n:=n+1;
  IF has_function_privilege('anon',p.oid,'EXECUTE') OR has_function_privilege('authenticated',p.oid,'EXECUTE')
   OR EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.grantee=0)
   OR NOT has_function_privilege('service_role',p.oid,'EXECUTE') THEN RAISE EXCEPTION 'Promo internal ACL leaked'; END IF;
 END LOOP;
 IF n<>3 THEN RAISE EXCEPTION 'Promo overload inventory changed: %',n; END IF;
END $$;
CREATE FUNCTION pg_temp.assert_promos_denied() RETURNS void LANGUAGE plpgsql AS $$ BEGIN
 PERFORM pg_temp.assert_promo_error('SELECT public.organizer_create_event_promo_code(NULL,NULL)','42501');
 PERFORM pg_temp.assert_promo_error('SELECT public.organizer_update_event_promo_code(NULL,NULL)','42501');
 PERFORM pg_temp.assert_promo_error('SELECT public.organizer_delete_event_promo_code(NULL,NULL,NULL,NULL)','42501');
END $$;
-- Temporary test helper only; B6 closes implicit PUBLIC EXECUTE defaults.
GRANT EXECUTE ON FUNCTION pg_temp.assert_promos_denied() TO anon,authenticated,service_role;
ALTER TABLE public.promo_codes DISABLE ROW LEVEL SECURITY;
SET LOCAL ROLE anon; SELECT pg_temp.assert_promos_denied(); RESET ROLE;
SET LOCAL ROLE authenticated; SELECT pg_temp.assert_promos_denied(); RESET ROLE;
SET LOCAL ROLE service_role;
SET LOCAL "request.jwt.claim.sub"='b2400000-0000-4000-8000-000000000099';
DO $$ DECLARE actor constant uuid:='b2400000-0000-4000-8000-000000000001'; org constant uuid:='b2400000-0000-4000-8000-000000000011'; event constant uuid:='b2400000-0000-4000-8000-000000000021';
 scope jsonb; input jsonb; patch jsonb; r jsonb; promo uuid; rules uuid; redeemed uuid; ord uuid; before_snapshot jsonb; before_time timestamptz;
 item record; checkout text;
BEGIN
 scope:=jsonb_build_object('org_id',org,'event_id',event);
 input:=scope||'{"code":"  case-code  ","discount_percent":25,"discount_cents":null}';
 r:=public.organizer_create_event_promo_code(actor,input); promo:=(r->>'id')::uuid;
 IF r->>'code'<>'CASE-CODE' OR r->>'used_count'<>'0' OR r->>'org_id'<>org::text OR r ? 'usedCount' THEN RAISE EXCEPTION 'Promo raw/create normalization contract changed'; END IF;
 PERFORM pg_temp.assert_promo_error(format('SELECT public.organizer_create_event_promo_code(%L,%L)',actor,input||'{"code":"CaSe-CoDe"}'),'DUPLICATE_PROMO_CODE');
 PERFORM pg_temp.assert_promo_error(format('SELECT public.organizer_create_event_promo_code(NULL,%L)',input),'NOT_AUTHENTICATED');
 PERFORM pg_temp.assert_promo_error(format('SELECT public.organizer_create_event_promo_code(%L,%L)',actor,input||'{"used_count":1}'),'VALIDATION_ERROR');
 PERFORM pg_temp.assert_promo_error(format('SELECT public.organizer_create_event_promo_code(%L,%L)',actor,input||'{"org_id":"b2400000-0000-4000-8000-000000000012"}'),'NOT_FOUND');
 r:=public.organizer_create_event_promo_code(actor,input||jsonb_build_object('code','RULES','max_uses',5,'starts_at',now()+interval '3 days','ends_at',now()+interval '4 days')); rules:=(r->>'id')::uuid;
 patch:=scope||jsonb_build_object('promo_code_id',rules);
 UPDATE public.promo_codes SET used_count=3,updated_at=now()-interval '5 days' WHERE id=rules;
 SELECT updated_at INTO before_time FROM public.promo_codes WHERE id=rules;
 r:=public.organizer_update_event_promo_code(actor,patch||'{"max_uses":1}');
 IF r->>'used_count'<>'3' OR r->>'max_uses'<>'1' OR (r->>'updated_at')::timestamptz<>before_time OR r->>'code'<>'RULES' THEN RAISE EXCEPTION 'Counter/timestamp/absent patch changed'; END IF;
 PERFORM pg_temp.assert_promo_error(format('SELECT public.organizer_update_event_promo_code(%L,%L)',actor,patch||jsonb_build_object('ends_at',now()+interval '2 days','code','Must rollback')),'VALIDATION_ERROR');
 IF (SELECT code FROM public.promo_codes WHERE id=rules)<>'RULES' THEN RAISE EXCEPTION 'Invalid merged dates partly persisted'; END IF;
 r:=public.organizer_update_event_promo_code(actor,patch||'{"max_uses":null,"starts_at":null,"ends_at":null}');
 IF r->'max_uses'<>'null'::jsonb OR r->'starts_at'<>'null'::jsonb OR r->'ends_at'<>'null'::jsonb THEN RAISE EXCEPTION 'Nullable promo patch did not clear'; END IF;
 PERFORM pg_temp.assert_promo_error(format('SELECT public.organizer_update_event_promo_code(%L,%L)',actor,patch||'{"discount_percent":50,"discount_cents":100}'),'VALIDATION_ERROR');
 PERFORM pg_temp.assert_promo_error(format('SELECT public.organizer_update_event_promo_code(%L,%L)',actor,patch||'{"used_count":0}'),'VALIDATION_ERROR');
 PERFORM pg_temp.assert_promo_error(format('SELECT public.organizer_update_event_promo_code(%L,%L)',actor,patch||'{"created_at":"2000-01-01"}'),'VALIDATION_ERROR');
 PERFORM pg_temp.assert_promo_error(format('SELECT public.organizer_update_event_promo_code(%L,%L)',actor,patch||'{"code":"case-code"}'),'DUPLICATE_PROMO_CODE');
 INSERT INTO public.promo_codes(id,org_id,event_id,code,discount_percent,max_uses,used_count,created_at,updated_at)
 VALUES('b2400000-0000-4000-8000-000000000040',org,event,' '||repeat('A',20)||' ',25,5,3,'2000-01-01','2000-01-02');
 r:=public.organizer_update_event_promo_code(actor,scope||'{"promo_code_id":"b2400000-0000-4000-8000-000000000040","is_active":false,"max_uses":1}');
 IF r->>'code'<>' '||repeat('A',20)||' ' OR r->>'used_count'<>'3' OR r->>'is_active'<>'false'
  OR (r->>'created_at')::timestamptz<>'2000-01-01'::timestamptz OR (r->>'updated_at')::timestamptz<>'2000-01-02'::timestamptz THEN RAISE EXCEPTION 'Padded legacy promo patch rewrote metadata or code'; END IF;
 -- Independent legacy FKs can be inconsistent; new mutations never repair/move them.
 INSERT INTO public.promo_codes(id,org_id,event_id,code,discount_percent) VALUES('b2400000-0000-4000-8000-000000000039','b2400000-0000-4000-8000-000000000012',event,'INCONSISTENT',25);
 PERFORM pg_temp.assert_promo_error(format('SELECT public.organizer_update_event_promo_code(%L,%L)',actor,scope||'{"promo_code_id":"b2400000-0000-4000-8000-000000000039","is_active":false}'),'NOT_FOUND');
 PERFORM pg_temp.assert_promo_error(format('SELECT public.organizer_delete_event_promo_code(%L,%L,%L,%L)',actor,org,event,'b2400000-0000-4000-8000-000000000039'),'NOT_FOUND');
 PERFORM pg_temp.assert_promo_error(format('SELECT public.organizer_delete_event(%L,%L,%L)',actor,org,event),'RELATIONSHIP_CONFLICT');
 IF NOT EXISTS(SELECT 1 FROM public.promo_codes WHERE id='b2400000-0000-4000-8000-000000000039' AND org_id='b2400000-0000-4000-8000-000000000012')
  OR NOT EXISTS(SELECT 1 FROM public.events WHERE id=event) OR NOT EXISTS(SELECT 1 FROM public.event_products WHERE id='b2400000-0000-4000-8000-000000000031' AND reserved_qty=0 AND sold_qty=0) THEN
  RAISE EXCEPTION 'Inconsistent promo event deletion partly mutated tenants'; END IF;
 DELETE FROM public.promo_codes WHERE id='b2400000-0000-4000-8000-000000000039';
 -- Real checkout refuses these codes before creating order/redemption/stock effects.
 PERFORM public.organizer_create_event_promo_code(actor,input||jsonb_build_object('code','EXPIRED','ends_at',now()-interval '1 day'));
 PERFORM public.organizer_create_event_promo_code(actor,input||jsonb_build_object('code','FUTURE','starts_at',now()+interval '1 day'));
 PERFORM public.organizer_create_event_promo_code(actor,input||'{"code":"INACTIVE","is_active":false}');
 r:=public.organizer_create_event_promo_code(actor,input||'{"code":"EXHAUSTED","max_uses":1}');
 UPDATE public.promo_codes SET used_count=1 WHERE id=(r->>'id')::uuid;
 PERFORM public.organizer_create_event_promo_code(actor,input||'{"org_id":"b2400000-0000-4000-8000-000000000012","event_id":"b2400000-0000-4000-8000-000000000022","code":"FOREIGN"}');
 checkout:='SELECT public.create_order_intent('||quote_literal(event)||','||quote_literal('[{"event_product_id":"b2400000-0000-4000-8000-000000000031","quantity":1}]')||','||quote_literal('[{"event_product_id":"b2400000-0000-4000-8000-000000000031","email":"promo-attendee@example.test"}]')||','||quote_literal('{"email":"promo-buyer@example.test"}')||',NULL,';
 FOR item IN SELECT * FROM (VALUES('EXPIRED','PROMO_CODE_EXPIRED'),('FUTURE','PROMO_CODE_NOT_STARTED'),('INACTIVE','PROMO_CODE_INACTIVE'),('EXHAUSTED','PROMO_CODE_USAGE_LIMIT_REACHED'),('FOREIGN','PROMO_CODE_NOT_FOUND')) t(code,error) LOOP
  PERFORM pg_temp.assert_promo_error(checkout||quote_literal(item.code)||')',item.error);
 END LOOP;
 IF EXISTS(SELECT 1 FROM public.orders WHERE event_id=event) OR EXISTS(SELECT 1 FROM public.promo_code_redemptions pcr JOIN public.orders o ON o.id=pcr.order_id WHERE o.event_id=event)
  OR NOT EXISTS(SELECT 1 FROM public.event_products WHERE id='b2400000-0000-4000-8000-000000000031' AND reserved_qty=0 AND sold_qty=0) THEN RAISE EXCEPTION 'Rejected checkout partly persisted'; END IF;
 EXECUTE checkout||quote_literal('case-code')||')' INTO r; ord:=(r->>'order_id')::uuid;
 IF r->>'discount_cents'<>'250' OR r->>'amount_due_now_cents'<>'750' THEN RAISE EXCEPTION 'Checkout discount changed'; END IF;
 SELECT to_jsonb(pcr) INTO before_snapshot FROM public.promo_code_redemptions pcr WHERE order_id=ord;
 IF before_snapshot->>'discount_cents'<>'250' THEN RAISE EXCEPTION 'Redemption snapshot changed'; END IF;
 r:=public.organizer_update_event_promo_code(actor,scope||jsonb_build_object('promo_code_id',promo,'code','RENAMED','discount_percent',null,'discount_cents',100));
 IF r->>'used_count'<>'1' OR (SELECT to_jsonb(pcr) FROM public.promo_code_redemptions pcr WHERE order_id=ord)<>before_snapshot THEN RAISE EXCEPTION 'Promo patch rewrote monetary snapshot/counter'; END IF;
 PERFORM pg_temp.assert_promo_error(format('SELECT public.organizer_delete_event_promo_code(%L,%L,%L,%L)',actor,org,event,promo),'23503');
 IF NOT EXISTS(SELECT 1 FROM public.promo_codes WHERE id=promo) THEN RAISE EXCEPTION 'FK-refused deletion removed promo'; END IF;
 -- Used count alone has never been a SQL delete rule (UI guard remains).
 r:=public.organizer_delete_event_promo_code(actor,org,event,rules);
 IF r<>'{"success":true}'::jsonb THEN RAISE EXCEPTION 'No-redemption delete changed'; END IF;
END $$;
RESET ROLE;
CREATE FUNCTION pg_temp.assert_promo_rename_view() RETURNS void LANGUAGE plpgsql AS $$ DECLARE r jsonb; BEGIN
 r:=public.get_event_admin_orders_view('b2400000-0000-4000-8000-000000000021','b2400000-0000-4000-8000-000000000011',NULL,200,0);
 IF r->'orders'->0->'meta'->'promoRedemption'->>'code'<>'RENAMED'
  OR r->'orders'->0->'meta'->'promoRedemption'->>'discountCents'<>'250' THEN RAISE EXCEPTION 'Existing admin view current-code/snapshot semantics changed'; END IF;
END $$;
-- Temporary test helper only; B6 closes implicit PUBLIC EXECUTE defaults.
GRANT EXECUTE ON FUNCTION pg_temp.assert_promo_rename_view() TO anon,authenticated,service_role;
SET LOCAL "request.jwt.claim.sub"='b2400000-0000-4000-8000-000000000001';
SET LOCAL ROLE authenticated; SELECT pg_temp.assert_promo_rename_view(); RESET ROLE;
SET LOCAL ROLE service_role;
SELECT public.organizer_delete_event('b2400000-0000-4000-8000-000000000001','b2400000-0000-4000-8000-000000000011','b2400000-0000-4000-8000-000000000021');
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM public.orders WHERE event_id='b2400000-0000-4000-8000-000000000021')
  OR EXISTS(SELECT 1 FROM public.promo_codes WHERE event_id='b2400000-0000-4000-8000-000000000021')
  OR EXISTS(SELECT 1 FROM public.event_products WHERE event_id='b2400000-0000-4000-8000-000000000021')
  OR NOT EXISTS(SELECT 1 FROM public.promo_codes WHERE event_id='b2400000-0000-4000-8000-000000000022' AND code='FOREIGN') THEN RAISE EXCEPTION 'Consistent event deletion cascades/cross-tenant preservation changed'; END IF;
END $$;
RESET ROLE;
ROLLBACK;
