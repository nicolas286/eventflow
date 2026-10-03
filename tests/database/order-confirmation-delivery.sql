-- Delivery effects only, synthetic fixtures, transaction rolled back.
begin;
insert into public.organizations(id,type,name) values
 ('a5000000-0000-4000-8000-000000000001','association','Confirmation fixture');
insert into public.events(id,org_id,slug,title) values
 ('a5000000-0000-4000-8000-000000000002','a5000000-0000-4000-8000-000000000001','confirmation-a5','Confirmation fixture');
insert into public.event_products(id,event_id,name,price_cents,currency,stock_qty,reserved_qty,sold_qty) values
 ('a5000000-0000-4000-8000-000000000003','a5000000-0000-4000-8000-000000000002','Ticket',1000,'EUR',200,0,0);
insert into public.orders(id,org_id,event_id,total_cents,paid_cents,buyer_email,booking_token,status,confirmed_at)
select ('a5000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
 'a5000000-0000-4000-8000-000000000001','a5000000-0000-4000-8000-000000000002',
 1000,1000,'confirmation@example.test','synthetic-confirmation-a5-booking-token-'||n,'paid',now()
from generate_series(10,130) n;
insert into public.order_items(order_id,product_id,product_name_snapshot,unit_price_cents_snapshot,quantity)
select id,'a5000000-0000-4000-8000-000000000003','Ticket',1000,1
from public.orders where org_id='a5000000-0000-4000-8000-000000000001';
insert into public.tickets(order_id,order_item_id,event_id,product_id,ticket_index,qr_token)
select i.order_id,i.id,'a5000000-0000-4000-8000-000000000002',i.product_id,1,
 'synthetic-confirmation-qr-'||i.order_id from public.order_items i
where i.order_id in (select id from public.orders where org_id='a5000000-0000-4000-8000-000000000001');

-- Payment validated, tickets issued and delivery accepted remain separate states.
set local role service_role;
do $$
declare c jsonb; p jsonb; o constant uuid := 'a5000000-0000-4000-8000-000000000010';
begin
 c := public.claim_order_confirmation_delivery(o);
 if (c->>'claimed')::boolean is distinct from true then raise exception 'Nominal claim denied'; end if;
 p := public.prepare_order_confirmation_dispatch(o,(c->>'claimToken')::uuid,
  '{"from":"fixture@example.test","to":["confirmation@example.test"],"attachments":[{"filename":"tickets.pdf","content":"cGRm"},{"filename":"conditions.pdf","content":"cHJvb2Y="}]}'::jsonb,'resend');
 if p->'payload'->'attachments'->1->>'content' <> 'cHJvb2Y=' then raise exception 'Contract attachment lost'; end if;
 if not public.complete_order_confirmation_delivery(o,(c->>'claimToken')::uuid,true,'synthetic-message') then
  raise exception 'Nominal mark rejected'; end if;
 if (public.claim_order_confirmation_delivery(o)->>'claimed')::boolean then raise exception 'Sent order reclaimed'; end if;
end $$;
reset role;

do $$
declare c jsonb; newer jsonb; p jsonb; o constant uuid := 'a5000000-0000-4000-8000-000000000011';
begin
 c := public.claim_order_confirmation_delivery(o);
 perform public.prepare_order_confirmation_dispatch(o,(c->>'claimToken')::uuid,'{"attachments":[{"content":"original"}]}'::jsonb,'resend');
 if not public.complete_order_confirmation_delivery(o,(c->>'claimToken')::uuid,false,null,'PROVIDER_FAILED') then
  raise exception 'Failed send could not be recorded'; end if;
 if not exists(select 1 from private.order_confirmation_deliveries where order_id=o and status='failed'
  and attempt_count=1 and next_attempt_at=now()+interval '5 minutes' and error_code='PROVIDER_FAILED') then
  raise exception 'Failed send has no bounded backoff'; end if;
 if public.claim_order_confirmation_delivery(o)->>'reason' <> 'backoff' then raise exception 'Backoff bypassed'; end if;
 if exists(select 1 from public.list_pending_order_confirmations(100) where order_id=o) then raise exception 'Backoff selected'; end if;
 update private.order_confirmation_deliveries set next_attempt_at=now()-interval '1 second' where order_id=o;
 newer := public.claim_order_confirmation_delivery(o);
 p := public.prepare_order_confirmation_dispatch(o,(newer->>'claimToken')::uuid,'{"attachments":[{"content":"changed"}]}'::jsonb,'resend');
 if p->'payload'->'attachments'->0->>'content' <> 'original' then raise exception 'Retry envelope changed'; end if;
 if public.prepare_order_confirmation_dispatch(o,(newer->>'claimToken')::uuid,'{}','capture') is not null then
  raise exception 'Provider changed during logical delivery'; end if;
 -- Simulate provider acceptance followed by DB mark failure: leave the claim active.
 update private.order_confirmation_deliveries set claimed_at=now()-interval '6 minutes' where order_id=o;
 if public.complete_order_confirmation_delivery(o,(newer->>'claimToken')::uuid,true,'accepted-but-late') then
  raise exception 'Expired claim marked sent'; end if;
 c := newer;
 newer := public.claim_order_confirmation_delivery(o);
 if (newer->>'claimed')::boolean is distinct from true or newer->>'claimToken'=c->>'claimToken' then
  raise exception 'Crashed claim not fenced and reclaimed'; end if;
 if newer->'payload'->'attachments'->0->>'content' <> 'original' then raise exception 'Acceptance retry lost envelope'; end if;
 if public.complete_order_confirmation_delivery(o,(c->>'claimToken')::uuid,true,'obsolete')
  or public.complete_order_confirmation_delivery(o,(c->>'claimToken')::uuid,false,null,'OBSOLETE') then
  raise exception 'Stale worker changed newer claim'; end if;
 if public.prepare_order_confirmation_dispatch(o,(c->>'claimToken')::uuid,'{}','resend') is not null then
  raise exception 'Stale worker authorized dispatch'; end if;
 perform public.mark_order_confirmation_email_sent(o);
 perform public.mark_order_confirmation_email_error(o,'obsolete legacy worker');
 if (select claim_token from private.order_confirmation_deliveries where order_id=o) <> (newer->>'claimToken')::uuid
  or (select confirmation_email_sent_at from public.orders where id=o) is not null
  or (select confirmation_email_error from public.orders where id=o) <> 'CONFIRMATION_DELIVERY_IN_PROGRESS' then
  raise exception 'Legacy RPC overwrote new claim'; end if;
 if not public.complete_order_confirmation_delivery(o,(newer->>'claimToken')::uuid,true,'same-provider-message') then
  raise exception 'Recovered claim could not complete'; end if;
end $$;

do $$
declare o uuid; c jsonb;
begin
 o := 'a5000000-0000-4000-8000-000000000012';
 c := public.claim_order_confirmation_delivery(o);
 update private.order_confirmation_deliveries set claimed_at=now()-interval '6 minutes' where order_id=o;
 if (public.claim_order_confirmation_delivery(o)->>'claimed')::boolean is distinct from true then
  raise exception 'Crash before dispatch permanently blocked'; end if;
 o := 'a5000000-0000-4000-8000-000000000013';
 update private.order_confirmation_deliveries set attempt_count=7 where order_id=o;
 c := public.claim_order_confirmation_delivery(o);
 perform public.complete_order_confirmation_delivery(o,(c->>'claimToken')::uuid,false,null,'PROVIDER_FAILED');
 if not exists(select 1 from private.order_confirmation_deliveries where order_id=o and attempt_count=8
  and status='review_required' and error_code='CONFIRMATION_ATTEMPTS_EXHAUSTED'
  and next_attempt_at=now()+interval '1 hour') then raise exception 'Attempt cap not visible/bounded'; end if;
 if (public.claim_order_confirmation_delivery(o)->>'claimed')::boolean then raise exception 'Attempt cap bypassed'; end if;
 o := 'a5000000-0000-4000-8000-000000000014';
 update private.order_confirmation_deliveries set attempt_count=8 where order_id=o;
 if public.claim_order_confirmation_delivery(o)->>'reason' <> 'review_required' then raise exception 'Crash at cap looped'; end if;
 o := 'a5000000-0000-4000-8000-000000000015';
 update private.order_confirmation_deliveries set first_dispatch_at=now()-interval '23 hours' where order_id=o;
 if public.claim_order_confirmation_delivery(o)->>'reason' <> 'review_required'
  or (select confirmation_email_error from public.orders where id=o) <> 'CONFIRMATION_IDEMPOTENCY_WINDOW_EXPIRED' then
  raise exception 'Expired provider idempotency retried'; end if;
 o := 'a5000000-0000-4000-8000-000000000016';
 c := public.claim_order_confirmation_delivery(o);
 update private.order_confirmation_deliveries set first_dispatch_at=now()-interval '23 hours' where order_id=o;
 if public.prepare_order_confirmation_dispatch(o,(c->>'claimToken')::uuid,'{}','resend') is not null then
  raise exception 'Dispatch authorized outside provider window'; end if;
end $$;

do $$
declare o uuid; reason text;
begin
 foreach o in array array['a5000000-0000-4000-8000-000000000017'::uuid,
  'a5000000-0000-4000-8000-000000000018'::uuid,'a5000000-0000-4000-8000-000000000019'::uuid,
  'a5000000-0000-4000-8000-000000000020'::uuid] loop
  if o::text like '%017' then update public.orders set confirmed_at=null where id=o;
  elsif o::text like '%018' then update public.orders set status='awaiting_payment' where id=o;
  elsif o::text like '%019' then update public.orders set buyer_email=null where id=o;
  else delete from public.tickets where order_id=o; end if;
  reason := public.claim_order_confirmation_delivery(o)->>'reason';
  if reason <> 'not_eligible' then raise exception 'Ineligible order claimed: % %',o,reason; end if;
  if exists(select 1 from public.list_pending_order_confirmations(100) where order_id=o) then
   raise exception 'Ineligible order selected: %',o; end if;
 end loop;
 update public.orders set status='partially_paid',paid_cents=500 where id='a5000000-0000-4000-8000-000000000021';
 if (public.claim_order_confirmation_delivery('a5000000-0000-4000-8000-000000000021')->>'claimed')::boolean is distinct from true then
  raise exception 'Validated partial payment excluded'; end if;
 if (select count(*) from public.list_pending_order_confirmations(9999)) <> 100
  or (select count(*) from public.list_pending_order_confirmations(2)) <> 2 then raise exception 'Retry batch unbounded'; end if;
 if (select count(*) from public.payments where order_id in (select id from public.orders where org_id='a5000000-0000-4000-8000-000000000001')) <> 0
  or (select sold_qty from public.event_products where id='a5000000-0000-4000-8000-000000000003') <> 0
  or (select count(*) from public.tickets where event_id='a5000000-0000-4000-8000-000000000002') <> 120 then
  raise exception 'Delivery touched payments, stock or ticket issuance'; end if;
end $$;

-- Historical rows without delivery records are not scanned by the retry worker.
alter table public.orders disable trigger enqueue_order_confirmation;
insert into public.orders(id,org_id,event_id,total_cents,paid_cents,buyer_email,booking_token,status,confirmed_at,confirmation_email_claimed_at)
select ('a5000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
 'a5000000-0000-4000-8000-000000000001','a5000000-0000-4000-8000-000000000002',
 1000,1000,'history@example.test','synthetic-confirmation-history-'||n,'paid',now(),
 case when n=201 then now()-interval '1 day' else null end from generate_series(200,201) n;
alter table public.orders enable trigger enqueue_order_confirmation;
do $$
begin
 if exists(select 1 from public.list_pending_order_confirmations(100) where order_id in
  ('a5000000-0000-4000-8000-000000000200','a5000000-0000-4000-8000-000000000201')) then
  raise exception 'Historical orders implicitly backfilled'; end if;
 if public.claim_order_confirmation_delivery('a5000000-0000-4000-8000-000000000201')->>'reason' <> 'legacy_unknown' then
  raise exception 'Historical unknown provider outcome retried'; end if;
 if not (select ok from public.claim_order_confirmation_email('a5000000-0000-4000-8000-000000000200')) then
  raise exception 'Old backend bridge stopped nominal claim'; end if;
 if public.claim_order_confirmation_delivery('a5000000-0000-4000-8000-000000000200')->>'reason' <> 'legacy_unknown' then
  raise exception 'Legacy claim retried automatically'; end if;
 perform public.mark_order_confirmation_email_sent('a5000000-0000-4000-8000-000000000200');
 if (select confirmation_email_sent_at from public.orders where id='a5000000-0000-4000-8000-000000000200') is null then
  raise exception 'Old backend could not mark its isolated claim'; end if;
end $$;

-- An old function already entered before schema publication can finish a
-- column-only claim after the migration. Isolate that outcome, never resend it.
do $$
declare o uuid; c jsonb; before_state jsonb; after_state jsonb;
begin
 o := 'a5000000-0000-4000-8000-000000000022';
 update public.orders set confirmation_email_claimed_at=now() where id=o;
 if public.claim_order_confirmation_delivery(o)->>'reason' <> 'legacy_unknown' then
  raise exception 'Late legacy claim on pending row was dispatched'; end if;
 o := 'a5000000-0000-4000-8000-000000000023';
 update public.orders set confirmation_email_claimed_at=now() where id=o;
 perform public.mark_order_confirmation_email_sent(o);
 if (select status from private.order_confirmation_deliveries where order_id=o) <> 'sent'
  or (select confirmation_email_sent_at from public.orders where id=o) is null then
  raise exception 'Late legacy mark on pending row lost'; end if;
 o := 'a5000000-0000-4000-8000-000000000024';
 update public.orders set confirmation_email_claimed_at=now() where id=o;
 perform public.mark_order_confirmation_email_error(o,'synthetic legacy failure');
 if (select status from private.order_confirmation_deliveries where order_id=o) <> 'legacy_unknown'
  or (select confirmation_email_error from public.orders where id=o) <> 'LEGACY_CONFIRMATION_OUTCOME_UNKNOWN' then
  raise exception 'Late legacy failure on pending row retried'; end if;
 o := 'a5000000-0000-4000-8000-000000000025';
 delete from private.order_confirmation_deliveries where order_id=o;
 update public.orders set confirmation_email_claimed_at=now() where id=o;
 perform public.mark_order_confirmation_email_sent(o);
 if (select status from private.order_confirmation_deliveries where order_id=o) <> 'sent'
  or (select confirmation_email_sent_at from public.orders where id=o) is null then
  raise exception 'Column-only late legacy acceptance lost'; end if;
 o := 'a5000000-0000-4000-8000-000000000026';
 delete from private.order_confirmation_deliveries where order_id=o;
 update public.orders set confirmation_email_claimed_at=now() where id=o;
 perform public.mark_order_confirmation_email_error(o,'synthetic legacy failure');
 if public.claim_order_confirmation_delivery(o)->>'reason' <> 'legacy_unknown' then
  raise exception 'Column-only late legacy failure retried'; end if;
 o := 'a5000000-0000-4000-8000-000000000027';
 c := public.claim_order_confirmation_delivery(o);
 perform public.prepare_order_confirmation_dispatch(o,(c->>'claimToken')::uuid,'{}','resend');
 perform public.complete_order_confirmation_delivery(o,(c->>'claimToken')::uuid,false,null,'NEW_PROVIDER_FAILURE');
 -- Legacy finishers cannot mutate failed or completed deliveries owned by the
 -- new protocol, just as they cannot mutate its active claim above.
 foreach o in array array[o,'a5000000-0000-4000-8000-000000000010'::uuid] loop
  select jsonb_build_object('delivery',to_jsonb(d),'sentAt',r.confirmation_email_sent_at,
   'error',r.confirmation_email_error) into before_state
  from private.order_confirmation_deliveries d join public.orders r on r.id=d.order_id where r.id=o;
  perform public.mark_order_confirmation_email_sent(o);
  perform public.mark_order_confirmation_email_error(o,'stale legacy failure');
  select jsonb_build_object('delivery',to_jsonb(d),'sentAt',r.confirmation_email_sent_at,
   'error',r.confirmation_email_error) into after_state
  from private.order_confirmation_deliveries d join public.orders r on r.id=d.order_id where r.id=o;
  if before_state is distinct from after_state then raise exception 'Legacy marker overwrote new protocol state: %',o; end if;
 end loop;
end $$;

create function pg_temp.assert_confirmation_acl() returns void language plpgsql as $$
declare q text;
begin
 foreach q in array array[
  'select public.claim_order_confirmation_delivery(null)',
  'select public.prepare_order_confirmation_dispatch(null,null,''{}'',''resend'')',
  'select public.complete_order_confirmation_delivery(null,null,false)',
  'select public.list_pending_order_confirmations(1)',
  'select public.claim_order_confirmation_email(null)',
  'select public.mark_order_confirmation_email_sent(null)',
  'select public.mark_order_confirmation_email_error(null,''fixture'')'] loop
  begin execute q; raise exception 'Browser role called coordination RPC: %',q;
  exception when insufficient_privilege then null; end;
 end loop;
end $$;
-- Test helper only: global PUBLIC EXECUTE defaults are intentionally closed by B6.
grant execute on function pg_temp.assert_confirmation_acl() to anon,authenticated;
set local role anon;
select pg_temp.assert_confirmation_acl();
reset role;
set local role authenticated;
select pg_temp.assert_confirmation_acl();
reset role;
rollback;
