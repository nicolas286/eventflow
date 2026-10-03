-- B2.2 real roles, disposable stock/quota/FK fixtures; no persistent settings.
BEGIN;
INSERT INTO public.organizations(id,type,name,plan,plan_expires_at) VALUES
 ('b2200000-0000-4000-8000-000000000011','association','B22 Products','pro',now()+interval '30 days'),
 ('b2200000-0000-4000-8000-000000000012','association','B22 Free','free',null);
INSERT INTO public.events(id,org_id,slug,title) VALUES
 ('b2200000-0000-4000-8000-000000000021','b2200000-0000-4000-8000-000000000011','b22-pro','Products'),
 ('b2200000-0000-4000-8000-000000000022','b2200000-0000-4000-8000-000000000012','b22-free-first','Free first'),
 ('b2200000-0000-4000-8000-000000000023','b2200000-0000-4000-8000-000000000012','b22-free-second','Free second');
CREATE FUNCTION pg_temp.assert_product_error(statement text,expected text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 BEGIN EXECUTE statement;
 EXCEPTION WHEN OTHERS THEN
  IF sqlerrm LIKE expected||'%' OR sqlstate=expected THEN RETURN; END IF;
  RAISE;
 END;
 RAISE EXCEPTION 'Expected product error %, accepted: %',expected,statement;
END $$;
-- Temporary test helper only; B6 closes implicit PUBLIC EXECUTE defaults.
GRANT EXECUTE ON FUNCTION pg_temp.assert_product_error(text,text) TO anon,authenticated,service_role;
DO $$ DECLARE p record; n int:=0; BEGIN
 FOR p IN SELECT proc.* FROM pg_proc proc JOIN pg_namespace ns ON ns.oid=proc.pronamespace
  WHERE ns.nspname='public' AND proc.proname IN ('organizer_create_event_product','organizer_update_event_product','organizer_delete_event_product') LOOP
  n:=n+1;
  IF has_function_privilege('anon',p.oid,'EXECUTE') OR has_function_privilege('authenticated',p.oid,'EXECUTE')
   OR EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.grantee=0)
   OR NOT has_function_privilege('service_role',p.oid,'EXECUTE') THEN RAISE EXCEPTION 'Product internal ACL leak'; END IF;
 END LOOP;
 IF n<>3 THEN RAISE EXCEPTION 'Product overload inventory changed: %',n; END IF;
END $$;
CREATE FUNCTION pg_temp.assert_products_denied() RETURNS void LANGUAGE plpgsql AS $$ BEGIN
 PERFORM pg_temp.assert_product_error('SELECT public.organizer_create_event_product(NULL,NULL)','42501');
 PERFORM pg_temp.assert_product_error('SELECT public.organizer_update_event_product(NULL,NULL)','42501');
 PERFORM pg_temp.assert_product_error('SELECT public.organizer_delete_event_product(NULL,NULL,NULL,NULL)','42501');
END $$;
-- Temporary test helper only; B6 closes implicit PUBLIC EXECUTE defaults.
GRANT EXECUTE ON FUNCTION pg_temp.assert_products_denied() TO anon,authenticated,service_role;
ALTER TABLE public.events DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_products DISABLE ROW LEVEL SECURITY;
SET LOCAL ROLE anon;
SELECT pg_temp.assert_products_denied();
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT pg_temp.assert_products_denied();
RESET ROLE;
SET LOCAL ROLE service_role;
SET LOCAL "request.jwt.claim.sub"='b2200000-0000-4000-8000-000000000099';
DO $$ DECLARE actor constant uuid:='b2200000-0000-4000-8000-000000000001';
 org constant uuid:='b2200000-0000-4000-8000-000000000011';
 event constant uuid:='b2200000-0000-4000-8000-000000000021';
 freeorg constant uuid:='b2200000-0000-4000-8000-000000000012';
 freefirst constant uuid:='b2200000-0000-4000-8000-000000000022';
 freesecond constant uuid:='b2200000-0000-4000-8000-000000000023';
 r jsonb; input jsonb; patch jsonb; product uuid; snapshot uuid; ord uuid; item uuid; attendee uuid; paid uuid; before_row jsonb; before_count int; n int;
BEGIN
 input:=jsonb_build_object('org_id',org,'event_id',event,'name','Zero finite','price_cents',0,'stock_qty',0,
  'description','  Original  ','currency','eur','creates_attendees',true,'attendees_per_unit',3);
 r:=public.organizer_create_event_product(actor,input); product:=(r->>'id')::uuid;
 IF r->>'stock_qty'<>'0' OR r->>'reserved_qty'<>'0' OR r->>'sold_qty'<>'0' OR r->>'currency'<>'EUR'
  OR r->>'description'<>'Original' OR r->>'attendees_per_unit'<>'3' OR r ? 'eventId' THEN RAISE EXCEPTION 'Create finite/raw/normalization contract changed'; END IF;
 patch:=jsonb_build_object('org_id',org,'event_id',event,'product_id',product);
 r:=public.organizer_update_event_product(actor,patch||'{"name":"Renamed finite","creates_attendees":false}');
 IF r->>'stock_qty'<>'0' OR r->>'description'<>'Original' OR r->>'attendees_per_unit'<>'3' OR r->>'creates_attendees'<>'false' THEN RAISE EXCEPTION 'Absent patch fields were reset'; END IF;
 r:=public.organizer_update_event_product(actor,patch||'{"description":null,"stock_qty":null}');
 IF r->'stock_qty'<>'null'::jsonb OR r->'description'<>'null'::jsonb THEN RAISE EXCEPTION 'Explicit nullable fields did not clear'; END IF;
 UPDATE public.event_products SET reserved_qty=2,sold_qty=3 WHERE id=product;
 SELECT to_jsonb(ep) INTO before_row FROM public.event_products ep WHERE id=product;
 PERFORM pg_temp.assert_product_error(format('SELECT public.organizer_update_event_product(%L,%L)',actor,patch||'{"stock_qty":4,"name":"Must rollback"}'),'STOCK_BELOW_ALLOCATED');
 IF (SELECT to_jsonb(ep) FROM public.event_products ep WHERE id=product)<>before_row THEN RAISE EXCEPTION 'Rejected stock patch partly changed product'; END IF;
 r:=public.organizer_update_event_product(actor,patch||'{"stock_qty":5,"name":"Allocated exact"}');
 IF r->>'stock_qty'<>'5' OR r->>'reserved_qty'<>'2' OR r->>'sold_qty'<>'3' THEN RAISE EXCEPTION 'Counters changed or exact allocated stock rejected'; END IF;
 PERFORM pg_temp.assert_product_error(format('SELECT public.organizer_update_event_product(%L,%L)',actor,patch||'{"reserved_qty":0}'),'VALIDATION_ERROR');
 PERFORM pg_temp.assert_product_error(format('SELECT public.organizer_create_event_product(%L,%L)',actor,input||'{"sold_qty":1}'),'VALIDATION_ERROR');
 PERFORM pg_temp.assert_product_error(format('SELECT public.organizer_create_event_product(NULL,%L)',input),'NOT_AUTHENTICATED');
 PERFORM pg_temp.assert_product_error(format('SELECT public.organizer_create_event_product(%L,%L)',actor,input||'{"currency":"USD"}'),'VALIDATION_ERROR');
 PERFORM pg_temp.assert_product_error(format('SELECT public.organizer_update_event_product(%L,%L)',actor,patch||'{"close_event_when_sold_out":true}'),'VALIDATION_ERROR');
 PERFORM pg_temp.assert_product_error(format('SELECT public.organizer_update_event_product(%L,%L)',actor,patch||jsonb_build_object('event_id',freefirst)),'NOT_FOUND');
 PERFORM pg_temp.assert_product_error(format('SELECT public.organizer_create_event_product(%L,%L)',actor,input||jsonb_build_object('org_id',freeorg)),'NOT_FOUND');
 PERFORM pg_temp.assert_product_error(format('SELECT public.organizer_delete_event_product(%L,%L,%L,%L)',actor,freeorg,event,product),'NOT_FOUND');
 -- Rate quota actor comes from the verified explicit argument, not JWT metadata.
 IF NOT EXISTS(SELECT 1 FROM public.event_products WHERE id=product) THEN RAISE EXCEPTION 'Actor/service mutation missing'; END IF;
 input:=jsonb_build_object('org_id',freeorg,'event_id',freefirst,'name','First paid','price_cents',100);
 r:=public.organizer_create_event_product(actor,input); paid:=(r->>'id')::uuid;
 r:=public.organizer_create_event_product(actor,input||'{"name":"Same paid event","is_active":false}');
 input:=input||jsonb_build_object('event_id',freesecond,'name','Other paid');
 PERFORM pg_temp.assert_product_error(format('SELECT public.organizer_create_event_product(%L,%L)',actor,input),'PLAN_LIMIT: paid_events_per_year exceeded');
 IF EXISTS(SELECT 1 FROM public.event_products WHERE event_id=freesecond) THEN RAISE EXCEPTION 'Paid create left partial row'; END IF;
 r:=public.organizer_create_event_product(actor,input||'{"price_cents":0}');
 patch:=jsonb_build_object('org_id',freeorg,'event_id',freesecond,'product_id',r->>'id','price_cents',10,'description','Must rollback');
 PERFORM pg_temp.assert_product_error(format('SELECT public.organizer_update_event_product(%L,%L)',actor,patch),'PLAN_LIMIT: paid_events_per_year exceeded');
 IF EXISTS(SELECT 1 FROM public.event_products WHERE event_id=freesecond AND (price_cents<>0 OR description IS NOT NULL)) THEN RAISE EXCEPTION 'Paid update partly persisted'; END IF;
 FOR n IN 1..9 LOOP
  PERFORM public.organizer_create_event_product(actor,input||jsonb_build_object('price_cents',0,'name','Limit product '||n));
 END LOOP;
 PERFORM pg_temp.assert_product_error(format('SELECT public.organizer_create_event_product(%L,%L)',actor,input||'{"price_cents":0,"name":"Limit overflow"}'),'PLAN_LIMIT');
 IF (SELECT count(*) FROM public.event_products WHERE event_id=freesecond)<>10 THEN RAISE EXCEPTION 'Product capacity failure partly persisted'; END IF;
 -- Preserve snapshot SET NULL and issued-ticket RESTRICT behavior atomically.
 r:=public.organizer_create_event_product(actor,jsonb_build_object('org_id',org,'event_id',event,'name','Snapshot product','price_cents',0)); snapshot:=(r->>'id')::uuid;
 INSERT INTO public.orders(org_id,event_id,total_cents,booking_token) VALUES(org,event,0,gen_random_uuid()::text) RETURNING id INTO ord;
 INSERT INTO public.order_items(order_id,product_id,product_name_snapshot,unit_price_cents_snapshot,quantity) VALUES(ord,snapshot,'Snapshot product',0,1) RETURNING id INTO item;
 INSERT INTO public.order_attendees(order_id,product_id,product_name_snapshot,attendee_index) VALUES(ord,snapshot,'Snapshot product',1) RETURNING id INTO attendee;
 INSERT INTO public.tickets(order_id,order_item_id,event_id,product_id,ticket_index,qr_token) VALUES(ord,item,event,snapshot,1,gen_random_uuid()::text);
 PERFORM pg_temp.assert_product_error(format('SELECT public.organizer_delete_event_product(%L,%L,%L,%L)',actor,org,event,snapshot),'23503');
 IF NOT EXISTS(SELECT 1 FROM public.event_products WHERE id=snapshot) OR NOT EXISTS(SELECT 1 FROM public.order_items WHERE id=item AND product_id=snapshot) THEN RAISE EXCEPTION 'Ticket restriction left partial FK deletion'; END IF;
 DELETE FROM public.tickets WHERE order_id=ord;
 r:=public.organizer_delete_event_product(actor,org,event,snapshot);
 IF r<>'{"success":true}'::jsonb OR EXISTS(SELECT 1 FROM public.event_products WHERE id=snapshot)
  OR NOT EXISTS(SELECT 1 FROM public.order_items WHERE id=item AND product_id IS NULL AND product_name_snapshot='Snapshot product')
  OR NOT EXISTS(SELECT 1 FROM public.order_attendees WHERE id=attendee AND product_id IS NULL AND product_name_snapshot='Snapshot product') THEN RAISE EXCEPTION 'Snapshot delete behavior changed'; END IF;
END $$;
RESET ROLE;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM private.rate_limit_hits WHERE key='create_product:org:b2200000-0000-4000-8000-000000000011:user:b2200000-0000-4000-8000-000000000001')
 OR EXISTS(SELECT 1 FROM private.rate_limit_hits WHERE key LIKE '%b2200000-0000-4000-8000-000000000099%') THEN RAISE EXCEPTION 'Rate actor came from JWT rather than server parameter'; END IF;
END $$;
ROLLBACK;
