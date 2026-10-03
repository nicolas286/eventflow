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
