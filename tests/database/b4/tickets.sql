BEGIN;
INSERT INTO auth.users(id,aud,role,email,created_at,updated_at) VALUES
 ('b4000000-0000-4000-8000-000000000001','authenticated','authenticated','b4-owner@example.test',now(),now());
INSERT INTO public.organizations(id,type,name,plan) VALUES
 ('b4000000-0000-4000-8000-000000000011','association','B4 A','pro'),
 ('b4000000-0000-4000-8000-000000000012','association','B4 B','pro');
INSERT INTO public.organization_members(org_id,user_id,role) VALUES
 ('b4000000-0000-4000-8000-000000000011','b4000000-0000-4000-8000-000000000001','owner');
INSERT INTO public.events(id,org_id,slug,title) VALUES
 ('b4000000-0000-4000-8000-000000000021','b4000000-0000-4000-8000-000000000011','b4-a','B4 A'),
 ('b4000000-0000-4000-8000-000000000022','b4000000-0000-4000-8000-000000000012','b4-b','B4 B');
INSERT INTO public.event_products(id,event_id,name,price_cents,stock_qty,reserved_qty,sold_qty) VALUES
 ('b4000000-0000-4000-8000-000000000031','b4000000-0000-4000-8000-000000000021','B4 Ticket',100,5000,2,1);
INSERT INTO public.orders(id,org_id,event_id,currency,total_cents,paid_cents,buyer_email,booking_token,status) VALUES
 ('b4000000-0000-4000-8000-000000000041','b4000000-0000-4000-8000-000000000011','b4000000-0000-4000-8000-000000000021','EUR',100,0,'pending@example.test',repeat('a',40),'awaiting_payment'),
 ('b4000000-0000-4000-8000-000000000042','b4000000-0000-4000-8000-000000000011','b4000000-0000-4000-8000-000000000021','EUR',100,100,'paid@example.test',repeat('b',40),'paid'),
 ('b4000000-0000-4000-8000-000000000043','b4000000-0000-4000-8000-000000000011','b4000000-0000-4000-8000-000000000021','EUR',100,0,'bank@example.test',repeat('c',40),'awaiting_payment');
INSERT INTO public.order_items(id,order_id,product_id,product_name_snapshot,unit_price_cents_snapshot,quantity)
 SELECT ('b4000000-0000-4000-8000-00000000005'||n)::uuid,('b4000000-0000-4000-8000-00000000004'||n)::uuid,
 'b4000000-0000-4000-8000-000000000031','B4 Ticket',100,1 FROM generate_series(1,3) n;
INSERT INTO public.order_attendees(id,order_id,product_id,product_name_snapshot,attendee_index,status) VALUES
 ('b4000000-0000-4000-8000-000000000061','b4000000-0000-4000-8000-000000000041','b4000000-0000-4000-8000-000000000031','B4 Ticket',1,'reserved'),
 ('b4000000-0000-4000-8000-000000000062','b4000000-0000-4000-8000-000000000042','b4000000-0000-4000-8000-000000000031','B4 Ticket',1,'confirmed');
INSERT INTO public.event_form_fields(id,event_id,field_key,label,field_type,is_active) VALUES
 ('b4000000-0000-4000-8000-000000000071','b4000000-0000-4000-8000-000000000021','identity','Identity','text',true),
 ('b4000000-0000-4000-8000-000000000072','b4000000-0000-4000-8000-000000000022','foreign','Foreign','text',true);
INSERT INTO public.tickets(id,order_id,order_item_id,event_id,product_id,ticket_index,qr_token,status)
SELECT ('b4000000-0000-4000-8000-00000000008'||n)::uuid,
'b4000000-0000-4000-8000-000000000042','b4000000-0000-4000-8000-000000000052',
'b4000000-0000-4000-8000-000000000021','b4000000-0000-4000-8000-000000000031',n,'B4-token-'||n,'valid' FROM generate_series(1,3)n;
CREATE FUNCTION pg_temp.expect_error(statement text,expected text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
 BEGIN EXECUTE statement; EXCEPTION WHEN OTHERS THEN
  IF sqlerrm LIKE expected||'%' OR sqlstate=expected THEN RETURN; END IF; RAISE;
 END; RAISE EXCEPTION 'Expected %, accepted %',expected,statement;
END $$;
-- Temporary test helper only; B6 closes implicit PUBLIC EXECUTE defaults.
GRANT EXECUTE ON FUNCTION pg_temp.expect_error(text,text) TO anon,authenticated,service_role;
ALTER TABLE public.tickets DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_members DISABLE ROW LEVEL SECURITY;
SET LOCAL ROLE service_role;
DO $$ DECLARE
 actor uuid:='b4000000-0000-4000-8000-000000000001'; org uuid:='b4000000-0000-4000-8000-000000000011'; event uuid:='b4000000-0000-4000-8000-000000000021';
 ticket uuid:='b4000000-0000-4000-8000-000000000081'; r jsonb; first jsonb;
BEGIN
 r:=public.organizer_get_event_tickets_admin(org,event,1,0);
 IF r->'tickets'->>'total'<>'3' OR r->'tickets'->'rows'->0->>'id'<>'b4000000-0000-4000-8000-000000000083' THEN RAISE EXCEPTION 'Stable list tie order'; END IF;
 r:=public.organizer_get_event_tickets_admin(org,event,1,1);
 IF r->'tickets'->'rows'->0->>'id'<>'b4000000-0000-4000-8000-000000000082' THEN RAISE EXCEPTION 'Stable page'; END IF;
 PERFORM pg_temp.expect_error(format('select public.organizer_get_event_tickets_admin(%L,%L)',org,'b4000000-0000-4000-8000-000000000022'),'FORBIDDEN');
 PERFORM pg_temp.expect_error(format('select public.organizer_check_in_ticket(%L,%L,%L,%L)',actor,org,ticket,'b4000000-0000-4000-8000-000000000022'),'EVENT_MISMATCH');
 PERFORM pg_temp.expect_error(format('select public.organizer_check_in_ticket(%L,%L,%L,%L)',actor,'b4000000-0000-4000-8000-000000000012',ticket,event),'FORBIDDEN');
 PERFORM pg_temp.expect_error(format('select public.organizer_check_in_ticket_by_qr(%L,%L,%L,%L)',actor,org,'forged',event),'TICKET_NOT_FOUND');
 UPDATE public.tickets SET status='cancelled' WHERE id=ticket;
 PERFORM pg_temp.expect_error(format('select public.organizer_check_in_ticket(%L,%L,%L,%L)',actor,org,ticket,event),'TICKET_CANCELLED');
 UPDATE public.tickets SET status='blocked' WHERE id='b4000000-0000-4000-8000-000000000083';
 r:=public.organizer_check_in_ticket(actor,org,'b4000000-0000-4000-8000-000000000083',event);
 IF r->>'outcome'<>'validated' THEN RAISE EXCEPTION 'Historical blocked rule changed'; END IF;
 PERFORM pg_temp.expect_error(format('select public.organizer_get_event_tickets_admin(%L,%L,null,0)',org,event),'VALIDATION_ERROR');
 PERFORM pg_temp.expect_error(format('select public.organizer_check_in_ticket(null,%L,%L,%L)',org,ticket,event),'NOT_AUTHENTICATED');
 UPDATE public.tickets SET status='refunded' WHERE id=ticket;
 -- Historical debt: refunded/blocked are accepted. No new financial rule inferred.
 first:=public.organizer_check_in_ticket(actor,org,ticket,event);
 IF first->>'outcome'<>'validated' OR first->>'checkedInBy'<>actor::text THEN RAISE EXCEPTION 'Reliable actor'; END IF;
 r:=public.organizer_check_in_ticket_by_qr(actor,org,' B4-token-1 ',event);
 IF r->>'outcome'<>'already_checked' OR r->>'checkedInAt'<>first->>'checkedInAt' OR r->>'checkedInBy'<>first->>'checkedInBy' THEN RAISE EXCEPTION 'Repeat overwrote actor/time'; END IF;
 IF (SELECT reserved_qty||':'||sold_qty FROM public.event_products WHERE id='b4000000-0000-4000-8000-000000000031')<>'2:1'
    OR (SELECT status FROM public.orders WHERE id='b4000000-0000-4000-8000-000000000042')<>'paid'
    OR (SELECT count(*) FROM public.order_attendees WHERE order_id='b4000000-0000-4000-8000-000000000042')<>1
    OR EXISTS(SELECT 1 FROM public.payments WHERE order_id='b4000000-0000-4000-8000-000000000042') THEN RAISE EXCEPTION 'Scan changed financial/participant state'; END IF;
 UPDATE public.orders SET org_id='b4000000-0000-4000-8000-000000000012' WHERE id='b4000000-0000-4000-8000-000000000042';
 PERFORM pg_temp.expect_error(format('select public.organizer_check_in_ticket(%L,%L,%L,%L)',actor,org,ticket,event),'FORBIDDEN');
 r:=public.organizer_get_event_tickets_admin(org,event);
 IF r->'tickets'->>'total'<>'0' THEN RAISE EXCEPTION 'Leaked foreign order'; END IF;
END $$;
RESET ROLE;
UPDATE public.orders SET org_id='b4000000-0000-4000-8000-000000000011' WHERE id='b4000000-0000-4000-8000-000000000042';
CREATE FUNCTION pg_temp.fail_scan() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'B4_INJECTED_FAILURE'; END $$;
CREATE TRIGGER b4_fail_scan AFTER UPDATE ON public.tickets FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_scan();
SET LOCAL ROLE service_role;
SELECT pg_temp.expect_error('select public.organizer_check_in_ticket(''b4000000-0000-4000-8000-000000000001'',''b4000000-0000-4000-8000-000000000011'',''b4000000-0000-4000-8000-000000000082'',''b4000000-0000-4000-8000-000000000021'')','B4_INJECTED_FAILURE');
DO $$ BEGIN IF EXISTS(SELECT 1 FROM public.tickets WHERE id='b4000000-0000-4000-8000-000000000082' AND (status<>'valid' OR checked_in_at IS NOT NULL OR checked_in_by IS NOT NULL)) THEN RAISE EXCEPTION 'Non-atomic scan'; END IF; END $$;
RESET ROLE;
ROLLBACK;
