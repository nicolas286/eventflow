-- Disposable fixtures only. New orders stop; existing financial operations continue.
begin;
update private.platform_settings set registrations_open=true where singleton;
insert into public.organizations(id,type,name,status,plan) values
 ('d7000000-0000-4000-8000-000000000001','association','Suspension fixture','active','pro');
insert into public.events(id,org_id,slug,title,is_published,starts_at,ends_at) values
 ('d7000000-0000-4000-8000-000000000002','d7000000-0000-4000-8000-000000000001',
 'suspension-fixture','Suspension fixture',true,now()+interval '1 day',now()+interval '2 days');
insert into public.event_products(id,event_id,name,price_cents,stock_qty,creates_attendees) values
 ('d7000000-0000-4000-8000-000000000003','d7000000-0000-4000-8000-000000000002','Fixture ticket',1000,10,true);
set local role service_role;
set local "request.jwt.claim.role"='service_role';
do $$ declare r jsonb; existing_order uuid; before_reserved integer; before_orders integer;
begin
 r:=public.create_order_intent('d7000000-0000-4000-8000-000000000002',
 '[{"event_product_id":"d7000000-0000-4000-8000-000000000003","quantity":1}]',
 '[{"event_product_id":"d7000000-0000-4000-8000-000000000003","email":"attendee@example.test"}]',
 '{"email":"buyer@example.test"}');
 existing_order:=(r->>'order_id')::uuid;
 update public.organizations set status='trial' where id='d7000000-0000-4000-8000-000000000001';
 perform public.create_order_intent('d7000000-0000-4000-8000-000000000002',
 '[{"event_product_id":"d7000000-0000-4000-8000-000000000003","quantity":1}]',
 '[{"event_product_id":"d7000000-0000-4000-8000-000000000003","email":"trial@example.test"}]',
 '{"email":"trial@example.test"}');
 update public.organizations set status='suspended' where id='d7000000-0000-4000-8000-000000000001';
 select reserved_qty into before_reserved from public.event_products where id='d7000000-0000-4000-8000-000000000003';
 select count(*) into before_orders from public.orders where org_id='d7000000-0000-4000-8000-000000000001';
 begin
  perform public.create_order_intent('d7000000-0000-4000-8000-000000000002',
   '[{"event_product_id":"d7000000-0000-4000-8000-000000000003","quantity":1}]',
   '[{"event_product_id":"d7000000-0000-4000-8000-000000000003"}]','{"email":"blocked@example.test"}');
  raise exception 'Suspended organization accepted a new order';
 exception when insufficient_privilege then if sqlerrm <> 'ORGANIZATION_SUSPENDED' then raise; end if; end;
 -- Direct service inserts are also guarded, before any defaults/constraints matter.
 begin
  insert into public.orders(org_id,event_id) values ('d7000000-0000-4000-8000-000000000001','d7000000-0000-4000-8000-000000000002');
  raise exception 'Direct order insertion bypassed suspension';
 exception when insufficient_privilege then if sqlerrm <> 'ORGANIZATION_SUSPENDED' then raise; end if; end;
 if (select count(*) from public.orders where org_id='d7000000-0000-4000-8000-000000000001')<>before_orders
 or (select reserved_qty from public.event_products where id='d7000000-0000-4000-8000-000000000003')<>before_reserved then
  raise exception 'Rejected order left stock or rows';
 end if;
 perform public.apply_order_payment(existing_order,'offline',1000,'EUR','suspended-existing-payment','{"method":"bank_transfer"}','fixture');
 if (select status from public.orders where id=existing_order)<>'paid' then raise exception 'Existing payment blocked'; end if;
 perform public.apply_order_refund(existing_order,'offline','suspended-existing-refund','suspended-existing-payment',1000,'EUR','succeeded','{}');
end $$;
reset role;
do $$ begin
 if has_function_privilege('anon','public.create_order_intent(uuid,jsonb,jsonb,jsonb,text,text)','EXECUTE')
 or has_function_privilege('authenticated','public.create_order_intent(uuid,jsonb,jsonb,jsonb,text,text)','EXECUTE')
 or has_function_privilege('service_role','private.create_order_intent_internal(uuid,jsonb,jsonb,jsonb,text,text)','EXECUTE') then
  raise exception 'Order implementation privileges widened';
 end if;
end $$;
set local role anon;
do $$ begin
 begin
  perform public.create_order_intent('d7000000-0000-4000-8000-000000000002','[]','[]');
  raise exception 'Anonymous caller can bypass the order Edge';
 exception when insufficient_privilege then null; end;
end $$;
reset role;
set local role authenticated;
do $$ begin
 begin
  perform public.create_order_intent('d7000000-0000-4000-8000-000000000002','[]','[]');
  raise exception 'Authenticated caller can bypass the order Edge';
 exception when insufficient_privilege then null; end;
end $$;
reset role;
rollback;
