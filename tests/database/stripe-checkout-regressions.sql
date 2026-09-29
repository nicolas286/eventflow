-- A1/A2: exercise the actual functions with disposable fixtures and real roles.
begin;
insert into auth.users (id,aud,role,email,encrypted_password,created_at,updated_at)
values ('91000000-0000-4000-8000-000000000001','authenticated','authenticated','stripe-audit@example.test','',now(),now());
insert into public.organizations(id,type,name,created_by,stripe_connected_account_id)
values ('91000000-0000-4000-8000-000000000002','association','Stripe fixture',
  '91000000-0000-4000-8000-000000000001','acct_fixture_checkout');
insert into public.events(id,org_id,slug,title,is_published)
values ('91000000-0000-4000-8000-000000000003','91000000-0000-4000-8000-000000000002','stripe-fix','Stripe fixture',true);
insert into public.event_products(id,event_id,name,price_cents,currency,stock_qty,reserved_qty,sold_qty)
values ('91000000-0000-4000-8000-000000000004','91000000-0000-4000-8000-000000000003','Ticket',1000,'EUR',10,3,0);
insert into public.orders(id,org_id,event_id,currency,total_cents,paid_cents,buyer_email,booking_token,status,expires_at)
select ('91000000-0000-4000-8000-00000000000' || n)::uuid,
  '91000000-0000-4000-8000-000000000002','91000000-0000-4000-8000-000000000003',
  'EUR',1000,0,'stripe-fixture@example.test','synthetic-checkout-booking-token-'||n,'awaiting_payment',now()+interval '20 minutes'
from generate_series(5,7) n;
insert into public.order_items(order_id,product_id,product_name_snapshot,unit_price_cents_snapshot,quantity)
select ('91000000-0000-4000-8000-00000000000' || n)::uuid,
  '91000000-0000-4000-8000-000000000004','Ticket',1000,1 from generate_series(5,7) n;

set local role service_role;
set local "request.jwt.claim.role" = 'service_role';
do $$
declare
  v_order constant uuid := '91000000-0000-4000-8000-000000000005';
  v_expiry bigint;
  v_result jsonb;
  n integer;
begin
  v_expiry := public.prepare_stripe_checkout(v_order);
  if v_expiry < extract(epoch from now()+interval '34 minutes') then raise exception 'Stripe reservation is too short'; end if;
  -- A retry must retain its first deadline and its Stripe idempotency parameters.
  update public.orders set stripe_checkout_expires_at = date_trunc('second',now())+interval '31 minutes',
    expires_at = date_trunc('second',now())+interval '31 minutes' where id=v_order;
  v_expiry := public.prepare_stripe_checkout(v_order);
  if v_expiry <> extract(epoch from date_trunc('second',now())+interval '31 minutes') then
    raise exception 'Preparing a retry changed the checkout deadline'; end if;
  for n in 5..7 loop
    perform public.register_stripe_checkout_payment(('91000000-0000-4000-8000-00000000000'||n)::uuid,
      'acct_fixture_checkout','cs_fixture_'||n,'cs_fixture_'||n,500,'EUR',v_expiry,'{}');
  end loop;

  update public.orders set expires_at=now()-interval '1 minute'
    where id in (v_order,'91000000-0000-4000-8000-000000000006');
  perform public.expire_orders();
  if (select status from public.orders where id=v_order) <> 'awaiting_payment'
     or (select reserved_qty from public.event_products where id='91000000-0000-4000-8000-000000000004') <> 3 then
    raise exception 'The SQL cron released a still-payable Stripe reservation'; end if;

  v_result := public.apply_stripe_checkout_payment(v_order,'acct_fixture_checkout','cs_fixture_5','pi_fixture_5',500,'EUR','{}');
  if v_result->>'action' <> 'paid' then raise exception 'Payment was not applied'; end if;
  v_result := public.apply_stripe_checkout_payment(v_order,'acct_fixture_checkout','cs_fixture_5','pi_fixture_5',500,'EUR','{}');
  if not (v_result->>'idempotent')::boolean
     or (select paid_cents from public.orders where id=v_order) <> 500 then
    raise exception 'Repeated Stripe deposit was counted twice'; end if;
  -- A terminal event arriving after success cannot downgrade the durable receipt.
  perform public.close_stripe_checkout(v_order,'acct_fixture_checkout','cs_fixture_5','expired','{}');
  if (select status from public.payments where provider_payment_id='pi_fixture_5') <> 'paid' then
    raise exception 'Out-of-order expiry downgraded a successful payment'; end if;
  -- Even an old transport downgrade cannot cause another addition.
  update public.payments set status='pending' where provider_payment_id='pi_fixture_5';
  perform public.apply_stripe_checkout_payment(v_order,'acct_fixture_checkout','cs_fixture_5','pi_fixture_5',500,'EUR','{}');
  if (select paid_cents from public.orders where id=v_order) <> 500 then raise exception 'Receipt was applied twice'; end if;
  begin
    perform public.apply_stripe_checkout_payment(v_order,'acct_other','cs_fixture_5','pi_fixture_5',500,'EUR','{}');
    raise exception 'Cross-account payment accepted';
  exception when raise_exception then if sqlerrm <> 'STRIPE_CONNECTED_ACCOUNT_MISMATCH' then raise; end if; end;
  begin
    perform public.apply_stripe_checkout_payment(v_order,'acct_fixture_checkout','cs_fixture_5','pi_other',500,'EUR','{}');
    raise exception 'Different PaymentIntent accepted';
  exception when raise_exception then if sqlerrm <> 'STRIPE_PAYMENT_INTENT_MISMATCH' then raise; end if; end;
  begin
    perform public.apply_stripe_checkout_payment(v_order,'acct_fixture_checkout','cs_fixture_5','pi_fixture_5',1000,'EUR','{}');
    raise exception 'Tampered amount accepted';
  exception when raise_exception then if sqlerrm <> 'STRIPE_PAYMENT_AMOUNT_MISMATCH' then raise; end if; end;

  perform public.close_stripe_checkout('91000000-0000-4000-8000-000000000006','acct_fixture_checkout','cs_fixture_6','expired','{}');
  perform public.close_stripe_checkout('91000000-0000-4000-8000-000000000006','acct_fixture_checkout','cs_fixture_6','expired','{}');
  if (select status from public.orders where id='91000000-0000-4000-8000-000000000006') <> 'expired'
    or (select reserved_qty from public.event_products where id='91000000-0000-4000-8000-000000000004') <> 1 then
    raise exception 'Confirmed expiry must release stock exactly once'; end if;
  v_result := public.apply_stripe_checkout_payment('91000000-0000-4000-8000-000000000006',
    'acct_fixture_checkout','cs_fixture_6','pi_fixture_6',500,'EUR','{}');
  if v_result->>'action' <> 'refund'
    or (select status from public.orders where id='91000000-0000-4000-8000-000000000006') <> 'expired'
    or (select paid_cents from public.orders where id='91000000-0000-4000-8000-000000000006') <> 500 then
    raise exception 'A late receipt must request a refund without resurrecting the reservation'; end if;
  perform public.record_stripe_late_refund('acct_fixture_checkout','pi_fixture_6','re_fixture_6');
  v_result := public.apply_stripe_checkout_payment('91000000-0000-4000-8000-000000000006',
    'acct_fixture_checkout','cs_fixture_6','pi_fixture_6',500,'EUR','{}');
  if v_result->>'refund_id' <> 're_fixture_6' then raise exception 'Refund identity was lost on retry'; end if;
  -- A known refund ID is not a completed ledger entry. Reconciliation must retry it.
  if not exists (select 1 from public.get_stripe_checkouts_to_reconcile(20)
    where order_id='91000000-0000-4000-8000-000000000006') then
    raise exception 'Pending late refund was dropped from reconciliation'; end if;
  perform public.record_stripe_late_refund('acct_fixture_checkout','pi_fixture_6','re_unrelated',true);
  update public.payments set stripe_reconciled_at = null where provider_payment_id='pi_fixture_6';
  if not exists (select 1 from public.get_stripe_checkouts_to_reconcile(20)
    where order_id='91000000-0000-4000-8000-000000000006') then
    raise exception 'An unrelated refund finalized the late receipt'; end if;
  perform public.apply_stripe_order_refund('91000000-0000-4000-8000-000000000006',
    'acct_fixture_checkout','re_fixture_6','pi_fixture_6',500,'EUR','succeeded','{}');
  perform public.record_stripe_late_refund('acct_fixture_checkout','pi_fixture_6','re_fixture_6',true);
  if (select paid_cents from public.orders where id='91000000-0000-4000-8000-000000000006') <> 0 then
    raise exception 'The late receipt and its refund must balance to zero'; end if;
  update public.orders set status='cancelled' where id=v_order;
  v_result := public.apply_stripe_checkout_payment(v_order,'acct_fixture_checkout','cs_fixture_5','pi_fixture_5',500,'EUR','{}');
  if v_result->>'action' <> 'ignored' then
    raise exception 'A retry after cancellation must not issue tickets'; end if;
end;
$$;
reset role;
set local role authenticated;
do $$
begin
  begin
    perform public.prepare_stripe_checkout('91000000-0000-4000-8000-000000000007');
    raise exception 'User prepared checkout directly';
  exception when insufficient_privilege then null; end;
  begin
    perform public.apply_stripe_checkout_payment('91000000-0000-4000-8000-000000000007',
      'acct_fixture_checkout','cs_fixture_7','pi_fixture_7',500,'EUR','{}');
    raise exception 'User marked own payment paid';
  exception when insufficient_privilege then null; end;
end;
$$;
reset role;
do $$
declare f text;
begin
  foreach f in array array[
    'public.prepare_stripe_checkout(uuid)',
    'public.register_stripe_checkout_payment(uuid,text,text,text,integer,text,bigint,jsonb)',
    'public.apply_stripe_checkout_payment(uuid,text,text,text,integer,text,jsonb)',
    'public.close_stripe_checkout(uuid,text,text,text,jsonb)',
    'public.get_stripe_checkouts_to_reconcile(integer)',
    'public.apply_stripe_order_refund(uuid,text,text,text,integer,text,text,jsonb)',
    'public.record_stripe_late_refund(text,text,text,boolean)'
  ] loop
    if has_function_privilege('anon',f,'EXECUTE') or has_function_privilege('authenticated',f,'EXECUTE') then
      raise exception 'Stripe lifecycle RPC is not service-only: %',f; end if;
  end loop;
  if has_table_privilege('anon','private.stripe_late_payment_refunds','SELECT')
     or has_table_privilege('authenticated','private.stripe_late_payment_refunds','SELECT') then
    raise exception 'Late refund receipts must remain private'; end if;
end;
$$;
rollback;
