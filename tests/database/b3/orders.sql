BEGIN;
INSERT INTO auth.users(id,aud,role,email,created_at,updated_at) VALUES
 ('b3000000-0000-4000-8000-000000000001','authenticated','authenticated','b3-owner@example.test',now(),now());
INSERT INTO public.organizations(id,type,name,plan) VALUES
 ('b3000000-0000-4000-8000-000000000011','association','B3 A','pro'),
 ('b3000000-0000-4000-8000-000000000012','association','B3 B','pro');
INSERT INTO public.organization_members(org_id,user_id,role) VALUES
 ('b3000000-0000-4000-8000-000000000011','b3000000-0000-4000-8000-000000000001','owner');
INSERT INTO public.events(id,org_id,slug,title) VALUES
 ('b3000000-0000-4000-8000-000000000021','b3000000-0000-4000-8000-000000000011','b3-a','B3 A'),
 ('b3000000-0000-4000-8000-000000000022','b3000000-0000-4000-8000-000000000012','b3-b','B3 B');
INSERT INTO public.event_products(id,event_id,name,price_cents,stock_qty,reserved_qty,sold_qty) VALUES
 ('b3000000-0000-4000-8000-000000000031','b3000000-0000-4000-8000-000000000021','B3 Ticket',100,5000,2,1);
INSERT INTO public.orders(id,org_id,event_id,currency,total_cents,paid_cents,buyer_email,booking_token,status) VALUES
 ('b3000000-0000-4000-8000-000000000041','b3000000-0000-4000-8000-000000000011','b3000000-0000-4000-8000-000000000021','EUR',100,0,'pending@example.test',repeat('a',40),'awaiting_payment'),
 ('b3000000-0000-4000-8000-000000000042','b3000000-0000-4000-8000-000000000011','b3000000-0000-4000-8000-000000000021','EUR',100,100,'paid@example.test',repeat('b',40),'paid'),
 ('b3000000-0000-4000-8000-000000000043','b3000000-0000-4000-8000-000000000011','b3000000-0000-4000-8000-000000000021','EUR',100,0,'bank@example.test',repeat('c',40),'awaiting_payment');
INSERT INTO public.order_items(id,order_id,product_id,product_name_snapshot,unit_price_cents_snapshot,quantity)
 SELECT ('b3000000-0000-4000-8000-00000000005'||n)::uuid,('b3000000-0000-4000-8000-00000000004'||n)::uuid,
 'b3000000-0000-4000-8000-000000000031','B3 Ticket',100,1 FROM generate_series(1,3) n;
INSERT INTO public.order_attendees(id,order_id,product_id,product_name_snapshot,attendee_index,status) VALUES
 ('b3000000-0000-4000-8000-000000000061','b3000000-0000-4000-8000-000000000041','b3000000-0000-4000-8000-000000000031','B3 Ticket',1,'reserved'),
 ('b3000000-0000-4000-8000-000000000062','b3000000-0000-4000-8000-000000000042','b3000000-0000-4000-8000-000000000031','B3 Ticket',1,'confirmed');
INSERT INTO public.event_form_fields(id,event_id,field_key,label,field_type,is_active) VALUES
 ('b3000000-0000-4000-8000-000000000071','b3000000-0000-4000-8000-000000000021','identity','Identity','text',true),
 ('b3000000-0000-4000-8000-000000000072','b3000000-0000-4000-8000-000000000022','foreign','Foreign','text',true);
CREATE FUNCTION pg_temp.expect_error(statement text,expected text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
 BEGIN EXECUTE statement; EXCEPTION WHEN OTHERS THEN
  IF sqlerrm LIKE expected||'%' OR sqlstate=expected THEN RETURN; END IF; RAISE;
 END; RAISE EXCEPTION 'Expected %, accepted %',expected,statement;
END $$;
-- Temporary test helper only; B6 closes implicit PUBLIC EXECUTE defaults.
GRANT EXECUTE ON FUNCTION pg_temp.expect_error(text,text) TO anon,authenticated,service_role;
-- Deliberately remove business RLS: service SQL must still scope every read/write.
ALTER TABLE public.orders DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_attendees DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_members DISABLE ROW LEVEL SECURITY;
SET LOCAL ROLE service_role;
SELECT public.create_bank_transfer_payment('b3000000-0000-4000-8000-000000000043',100,'EUR','B3 Synthetic','BE51732081025262','B3 ONLY','B3-REF');
UPDATE public.orders SET confirmed_at=now() WHERE id='b3000000-0000-4000-8000-000000000042';
SELECT public.issue_order_tickets('b3000000-0000-4000-8000-000000000042');
UPDATE public.orders SET paid_cents=0 WHERE id='b3000000-0000-4000-8000-000000000042';
INSERT INTO public.payments(order_id,provider,provider_payment_id,amount_cents,currency,status,type,is_refund)
 VALUES('b3000000-0000-4000-8000-000000000042','offline','b3-paid-synthetic',100,'EUR','paid','payment',false);
SELECT public.log_email_once('b3000000-0000-4000-8000-000000000042','confirmation_v1');
DO $$ DECLARE
 actor uuid:='b3000000-0000-4000-8000-000000000001'; org uuid:='b3000000-0000-4000-8000-000000000011'; event uuid:='b3000000-0000-4000-8000-000000000021';
 r jsonb; payload jsonb; count_rows int:=0; cursor jsonb:=null; ids uuid[]:='{}';
BEGIN
 r:=public.organizer_get_event_admin_orders_view(event,org,null,1,0);
 IF jsonb_array_length(r->'orders'->'rows')<>1 OR r->'orders'->>'total'<>'3' THEN RAISE EXCEPTION 'List pagination'; END IF;
 r:=public.organizer_search_event_admin_orders_view(org,null,event,'paid@example.test','order',1,0);
 IF r->'orders'->>'total'<>'1' THEN RAISE EXCEPTION 'Search filters'; END IF;
 PERFORM pg_temp.expect_error(format('select public.organizer_get_event_admin_orders_view(%L,%L)',event,'b3000000-0000-4000-8000-000000000012'),'FORBIDDEN');
 -- All pages from SQL JSON, unaffected by PostgREST's row limit.
 LOOP
  r:=public.organizer_get_event_admin_participants_export_data(event,org,null,false,1,(cursor->>'after')::uuid,(cursor->>'through')::uuid,(cursor->>'snapshot')::timestamptz);
  IF (r->'orders'->'rows'->0->>'id')::uuid=ANY(ids) THEN RAISE EXCEPTION 'Duplicate export page'; END IF;
  ids:=array_append(ids,(r->'orders'->'rows'->0->>'id')::uuid); count_rows:=count_rows+jsonb_array_length(r->'orders'->'rows');
  cursor:=nullif(r->'nextCursor','null'::jsonb); EXIT WHEN cursor IS NULL;
 END LOOP;
 IF count_rows<>3 THEN RAISE EXCEPTION 'Incomplete export'; END IF;
 payload:='{"answers":[{"event_form_field_id":"b3000000-0000-4000-8000-000000000071","value":{"value_text":"  untouched  ","Nested_Key":{"CamelKey":1,"snake_key":false}}}]}';
 r:=public.organizer_admin_update_order_attendee(actor,org,event,'b3000000-0000-4000-8000-000000000061',payload);
 IF (SELECT value FROM public.order_attendee_answers WHERE attendee_id='b3000000-0000-4000-8000-000000000061') IS DISTINCT FROM payload->'answers'->0->'value' THEN RAISE EXCEPTION 'JSON changed'; END IF;
 PERFORM pg_temp.expect_error(format('select public.organizer_admin_update_order_attendee(%L,%L,%L,%L,%L)',actor,org,event,'b3000000-0000-4000-8000-000000000061','{"answers":[{"event_form_field_id":"b3000000-0000-4000-8000-000000000072","field_key":"identity","value_text":"foreign"}]}'),'VALIDATION_ERROR');
 PERFORM pg_temp.expect_error(format('select public.organizer_admin_delete_order(%L,%L,%L,%L)',actor,'b3000000-0000-4000-8000-000000000012',event,'b3000000-0000-4000-8000-000000000041'),'FORBIDDEN');
 r:=public.organizer_search_event_admin_tickets_view(org,event,'',1,0);
 IF r->'tickets'->>'total'<>'1' THEN RAISE EXCEPTION 'Ticket search'; END IF;
 r:=public.organizer_get_bank_transfer_admin_summaries(org,event,1,null);
 IF jsonb_array_length(r)<>1 THEN RAISE EXCEPTION 'Bank summaries'; END IF;
 r:=public.organizer_expire_bank_transfer_order(actor,org,event,'b3000000-0000-4000-8000-000000000043');
 IF r->>'releasedUnits'<>'1' OR r->>'idempotent'<>'false' THEN RAISE EXCEPTION 'Expire result'; END IF;
 r:=public.organizer_expire_bank_transfer_order(actor,org,event,'b3000000-0000-4000-8000-000000000043');
 IF r->>'releasedUnits'<>'0' OR r->>'idempotent'<>'true' THEN RAISE EXCEPTION 'Expire repetition'; END IF;
 r:=public.organizer_admin_delete_order(actor,org,event,'b3000000-0000-4000-8000-000000000042');
 IF r->'released'->>'sold_units'<>'1' OR EXISTS(SELECT 1 FROM public.tickets WHERE order_id='b3000000-0000-4000-8000-000000000042') THEN RAISE EXCEPTION 'Delete ticket/stock'; END IF;
 IF EXISTS(SELECT 1 FROM public.payments WHERE order_id='b3000000-0000-4000-8000-000000000042') OR EXISTS(SELECT 1 FROM public.order_email_logs WHERE order_id='b3000000-0000-4000-8000-000000000042') OR EXISTS(SELECT 1 FROM public.order_attendees WHERE order_id='b3000000-0000-4000-8000-000000000042') THEN RAISE EXCEPTION 'Delete cascades/history changed'; END IF;
 PERFORM pg_temp.expect_error(format('select public.organizer_admin_delete_order(%L,%L,%L,%L)',actor,org,event,'b3000000-0000-4000-8000-000000000042'),'NOT_FOUND');
 IF (SELECT reserved_qty||':'||sold_qty FROM public.event_products WHERE id='b3000000-0000-4000-8000-000000000031')<>'1:0' THEN RAISE EXCEPTION 'Double stock release'; END IF;
END $$;
RESET ROLE;
CREATE FUNCTION pg_temp.fail_delete() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'B3_INJECTED_FAILURE'; END $$;
CREATE TRIGGER b3_fail_delete BEFORE DELETE ON public.orders FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_delete();
SET LOCAL ROLE service_role;
SELECT pg_temp.expect_error('select public.organizer_admin_delete_order(''b3000000-0000-4000-8000-000000000001'',''b3000000-0000-4000-8000-000000000011'',''b3000000-0000-4000-8000-000000000021'',''b3000000-0000-4000-8000-000000000041'')','B3_INJECTED_FAILURE');
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.orders WHERE id='b3000000-0000-4000-8000-000000000041') OR
 (SELECT reserved_qty FROM public.event_products WHERE id='b3000000-0000-4000-8000-000000000031')<>1 OR
 NOT EXISTS(SELECT 1 FROM public.order_attendee_answers WHERE attendee_id='b3000000-0000-4000-8000-000000000061') THEN RAISE EXCEPTION 'Delete not atomic'; END IF;
END $$;
RESET ROLE;
ROLLBACK;
