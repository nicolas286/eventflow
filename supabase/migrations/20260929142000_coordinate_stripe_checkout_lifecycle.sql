begin;

-- A1/A2: keep the stock until Stripe has reached a terminal state. The receipt
-- and association of a PaymentIntent are serialized with the order mutation.
alter table public.orders add column stripe_checkout_expires_at timestamptz;
alter table public.payments add column stripe_reconciled_at timestamptz;
create table private.stripe_late_payment_refunds (
  payment_id uuid primary key references public.payments(id) on delete cascade,
  refund_id text,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);
alter table private.stripe_late_payment_refunds enable row level security;
revoke all on private.stripe_late_payment_refunds from public, anon, authenticated;

create or replace function public.prepare_stripe_checkout(p_order_id uuid)
returns bigint
language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare
  v_order public.orders%rowtype;
  v_expires_at timestamptz;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'ORDER_NOT_FOUND'; end if;
  if v_order.status <> 'awaiting_payment' or coalesce(v_order.paid_cents, 0) <> 0
     or v_order.expires_at is null or v_order.expires_at <= now() then
    raise exception 'ORDER_NOT_PAYABLE';
  end if;
  -- Five minutes of margin above Stripe's minimum thirty-minute session.
  v_expires_at := coalesce(v_order.stripe_checkout_expires_at,
    greatest(v_order.expires_at, date_trunc('second', now()) + interval '35 minutes'));
  update public.orders set expires_at = v_expires_at, stripe_checkout_expires_at = v_expires_at
    where id = p_order_id;
  return extract(epoch from v_expires_at)::bigint;
end;
$$;
revoke all on function public.prepare_stripe_checkout(uuid) from public, anon, authenticated;
grant execute on function public.prepare_stripe_checkout(uuid) to service_role;

create or replace function public.register_stripe_checkout_payment(
  p_order_id uuid, p_account_id text, p_session_id text, p_payment_id text,
  p_amount_cents integer, p_currency text, p_expires_at bigint, p_raw jsonb
)
returns void
language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare
  v_order public.orders%rowtype;
  v_payment public.payments%rowtype;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'ORDER_NOT_FOUND'; end if;
  if v_order.status <> 'awaiting_payment' or coalesce(v_order.paid_cents, 0) <> 0 then
    raise exception 'ORDER_NOT_PAYABLE';
  end if;
  if p_session_id is null or p_session_id not like 'cs\_%' escape '\'
     or nullif(trim(p_payment_id), '') is null or p_amount_cents is null or p_amount_cents <= 0
     or upper(p_currency) is distinct from upper(v_order.currency)
     or p_expires_at is null or to_timestamp(p_expires_at) <= now() then
    raise exception 'STRIPE_CHECKOUT_INVALID';
  end if;
  if not exists (select 1 from public.organizations
    where id = v_order.org_id and stripe_connected_account_id = p_account_id) then
    raise exception 'STRIPE_CONNECTED_ACCOUNT_MISMATCH';
  end if;
  select * into v_payment from public.payments
  where provider = 'stripe' and provider_checkout_session_id = p_session_id for update;
  if found then
    if v_payment.order_id is distinct from p_order_id
       or v_payment.provider_account_id is distinct from p_account_id
       or v_payment.amount_cents is distinct from p_amount_cents
       or upper(v_payment.currency) is distinct from upper(p_currency) then
      raise exception 'STRIPE_PAYMENT_MISMATCH';
    end if;
    return;
  end if;
  insert into public.payments (
    order_id, provider, provider_payment_id, provider_account_id,
    provider_checkout_session_id, amount_cents, currency, status, is_refund, raw, type
  ) values (
    p_order_id, 'stripe', p_payment_id, p_account_id,
    p_session_id, p_amount_cents, upper(p_currency), 'open', false, p_raw, 'payment'
  );
  update public.orders set expires_at = to_timestamp(p_expires_at) where id = p_order_id;
end;
$$;
revoke all on function public.register_stripe_checkout_payment(uuid,text,text,text,integer,text,bigint,jsonb)
  from public, anon, authenticated;
grant execute on function public.register_stripe_checkout_payment(uuid,text,text,text,integer,text,bigint,jsonb)
  to service_role;

create or replace function public.apply_stripe_checkout_payment(
  p_order_id uuid, p_account_id text, p_session_id text, p_payment_intent_id text,
  p_amount_cents integer, p_currency text, p_raw jsonb
)
returns jsonb
language plpgsql security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_order public.orders%rowtype;
  v_payment public.payments%rowtype;
  v_refund_id text;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'ORDER_NOT_FOUND'; end if;
  if not exists (select 1 from public.organizations
    where id = v_order.org_id and stripe_connected_account_id = p_account_id) then
    raise exception 'STRIPE_CONNECTED_ACCOUNT_MISMATCH';
  end if;
  select * into v_payment from public.payments
  where provider = 'stripe' and order_id = p_order_id
    and provider_account_id = p_account_id and provider_checkout_session_id = p_session_id
    and is_refund = false and type = 'payment'
  for update;
  if not found then raise exception 'STRIPE_PAYMENT_ROW_NOT_FOUND'; end if;
  if p_amount_cents is distinct from v_payment.amount_cents or p_amount_cents <= 0 then
    raise exception 'STRIPE_PAYMENT_AMOUNT_MISMATCH';
  end if;
  if upper(p_currency) is distinct from upper(v_payment.currency) then
    raise exception 'STRIPE_PAYMENT_CURRENCY_MISMATCH';
  end if;
  if p_payment_intent_id is null or p_payment_intent_id not like 'pi\_%' escape '\'
     or v_payment.provider_payment_id not in (p_session_id, p_payment_intent_id) then
    raise exception 'STRIPE_PAYMENT_INTENT_MISMATCH';
  end if;

  select refund_id into v_refund_id from private.stripe_late_payment_refunds
  where payment_id = v_payment.id;
  if found then
    return jsonb_build_object('action', 'refund', 'refund_id', v_refund_id);
  end if;
  -- processed_at is the durable receipt, independent of transport event order.
  if v_payment.processed_at is not null then
    if v_order.status in ('cancelled', 'expired') then
      return jsonb_build_object('action', 'ignored');
    end if;
    return jsonb_build_object('action', 'paid', 'idempotent', true);
  end if;

  update public.payments set provider_payment_id = p_payment_intent_id,
    raw = p_raw, updated_at = now() where id = v_payment.id;
  if v_order.status in ('expired', 'cancelled') then
    -- A legacy/late checkout must never reacquire or oversell released stock.
    update public.payments set status = 'paid', processed_at = now() where id = v_payment.id;
    -- The historical ledger trigger only runs on INSERT. Record this receipt
    -- explicitly before its refund INSERT subtracts the same amount.
    update public.orders set paid_cents = coalesce(paid_cents, 0) + p_amount_cents,
      updated_at = now() where id = p_order_id;
    insert into private.stripe_late_payment_refunds(payment_id) values (v_payment.id);
    return jsonb_build_object('action', 'refund', 'refund_id', null);
  end if;

  perform public.apply_order_payment(p_order_id, 'stripe', p_amount_cents,
    p_currency, p_payment_intent_id, p_raw, null);
  return jsonb_build_object('action', 'paid', 'idempotent', false);
end;
$$;
revoke all on function public.apply_stripe_checkout_payment(uuid,text,text,text,integer,text,jsonb)
  from public, anon, authenticated;
grant execute on function public.apply_stripe_checkout_payment(uuid,text,text,text,integer,text,jsonb)
  to service_role;

-- Use the same order -> payment lock order as checkout application/expiry.
create or replace function public.apply_stripe_order_refund(
  p_order_id uuid, p_account_id text, p_refund_id text, p_original_payment_id text,
  p_amount_cents integer, p_currency text, p_status text, p_raw jsonb default null
)
returns jsonb
language plpgsql security definer
set search_path = pg_catalog, public
as $$
begin
  perform 1 from public.orders where id = p_order_id for update;
  if not exists (select 1 from public.payments where order_id = p_order_id
    and provider = 'stripe' and provider_account_id = p_account_id
    and provider_payment_id = p_original_payment_id and type = 'payment'
    and upper(currency) = upper(p_currency)) then
    raise exception 'STRIPE_REFUND_PAYMENT_MISMATCH';
  end if;
  return public.apply_order_refund(p_order_id, 'stripe', p_refund_id,
    p_original_payment_id, p_amount_cents, p_currency, p_status, p_raw);
end;
$$;
revoke all on function public.apply_stripe_order_refund(uuid,text,text,text,integer,text,text,jsonb)
  from public, anon, authenticated;
grant execute on function public.apply_stripe_order_refund(uuid,text,text,text,integer,text,text,jsonb)
  to service_role;

create or replace function public.record_stripe_late_refund(
  p_account_id text, p_payment_intent_id text, p_refund_id text, p_succeeded boolean default false
)
returns void
language plpgsql security definer
set search_path = pg_catalog, public, private
as $$
begin
  if p_refund_id is null or p_refund_id not like 're\_%' escape '\' then
    raise exception 'STRIPE_REFUND_ID_INVALID';
  end if;
  update private.stripe_late_payment_refunds r set refund_id = coalesce(r.refund_id, p_refund_id),
    completed_at = case when p_succeeded then coalesce(r.completed_at, now()) else r.completed_at end
  from public.payments p where p.id = r.payment_id
    and p.provider = 'stripe' and p.provider_payment_id = p_payment_intent_id
    and p.provider_account_id = p_account_id
    and (r.refund_id is null or r.refund_id = p_refund_id)
    -- A partial or unrelated refund webhook cannot finish the late receipt.
    and (not p_succeeded or exists (select 1 from public.payments refunded
      where refunded.parent_payment_id = p.id and refunded.provider = 'stripe'
        and refunded.provider_payment_id = p_refund_id and refunded.type = 'refund'
        and refunded.status = 'paid' and refunded.amount_cents = p.amount_cents
        and upper(refunded.currency) = upper(p.currency)));
end;
$$;
revoke all on function public.record_stripe_late_refund(text,text,text,boolean) from public, anon, authenticated;
grant execute on function public.record_stripe_late_refund(text,text,text,boolean) to service_role;

create or replace function private.expire_unpaid_order_reservation(p_order_id uuid)
returns boolean
language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare
  v_order public.orders%rowtype;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found or v_order.status <> 'awaiting_payment'
     or v_order.expires_at is null or v_order.expires_at >= now()
     or coalesce(v_order.paid_cents, 0) > 0 then return false; end if;
  if exists (select 1 from public.payments where order_id = p_order_id
      and provider = 'stripe' and is_refund = false and processed_at is null
      and status in ('open', 'pending')) then
    return false;
  end if;
  update public.orders set status = 'expired', updated_at = now() where id = p_order_id;
  update public.order_attendees set status = 'expired'
    where order_id = p_order_id and status = 'reserved';
  update public.event_products ep set reserved_qty = greatest(0, ep.reserved_qty - x.qty)
  from (select product_id, sum(quantity)::integer as qty from public.order_items
    where order_id = p_order_id group by product_id) x where ep.id = x.product_id;
  return true;
end;
$$;
revoke all on function private.expire_unpaid_order_reservation(uuid) from public, anon, authenticated;

create or replace function public.expire_orders(p_limit integer default 100)
returns jsonb
language plpgsql security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_order_id uuid;
  v_count integer := 0;
begin
  if p_limit is null or p_limit <= 0 or p_limit > 500 then
    raise exception 'VALIDATION_ERROR: p_limit must be between 1 and 500';
  end if;
  for v_order_id in
    select o.id from public.orders o where o.status = 'awaiting_payment'
      and o.expires_at < now()
      and not exists (select 1 from public.payments p where p.order_id = o.id
        and p.provider = 'stripe' and p.is_refund = false and p.processed_at is null
        and p.status in ('open', 'pending'))
    order by o.expires_at limit p_limit for update of o skip locked
  loop
    if private.expire_unpaid_order_reservation(v_order_id) then v_count := v_count + 1; end if;
  end loop;
  return jsonb_build_object('expired_orders', v_count);
end;
$$;
revoke all on function public.expire_orders(integer) from public, anon, authenticated;
grant execute on function public.expire_orders(integer) to service_role;

create or replace function public.close_stripe_checkout(
  p_order_id uuid, p_account_id text, p_session_id text, p_status text, p_raw jsonb
)
returns void
language plpgsql security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_payment public.payments%rowtype;
begin
  if p_status is null or p_status not in ('failed', 'expired') then
    raise exception 'STRIPE_CHECKOUT_STATUS_INVALID';
  end if;
  perform 1 from public.orders where id = p_order_id for update;
  select * into v_payment from public.payments where order_id = p_order_id
    and provider = 'stripe' and provider_account_id = p_account_id
    and provider_checkout_session_id = p_session_id and is_refund = false for update;
  if not found then raise exception 'STRIPE_PAYMENT_ROW_NOT_FOUND'; end if;
  if v_payment.processed_at is not null then return; end if;
  update public.payments set status = p_status, raw = p_raw, updated_at = now()
    where id = v_payment.id;
  update public.orders set expires_at = now() - interval '1 second'
    where id = p_order_id and status = 'awaiting_payment';
  perform private.expire_unpaid_order_reservation(p_order_id);
end;
$$;
revoke all on function public.close_stripe_checkout(uuid,text,text,text,jsonb) from public, anon, authenticated;
grant execute on function public.close_stripe_checkout(uuid,text,text,text,jsonb) to service_role;

create or replace function public.get_stripe_checkouts_to_reconcile(p_limit integer default 20)
returns table(order_id uuid, account_id text, session_id text)
language plpgsql security definer
set search_path = pg_catalog, public, private
as $$
begin
  return query
    with candidates as (
      select p.id from public.payments p join public.orders o on o.id = p.order_id
      where p.provider = 'stripe' and p.is_refund = false
        and p.provider_checkout_session_id is not null
        and (p.stripe_reconciled_at is null or p.stripe_reconciled_at < now() - interval '30 seconds')
        and ((o.status = 'awaiting_payment' and o.expires_at < now()
          and p.processed_at is null and p.status in ('open', 'pending'))
          or exists (select 1 from private.stripe_late_payment_refunds r
            where r.payment_id = p.id and r.completed_at is null))
      order by p.stripe_reconciled_at nulls first, p.created_at, p.id
      limit least(greatest(coalesce(p_limit, 20), 1), 100) for update of p skip locked
    )
    update public.payments p set stripe_reconciled_at = now()
    from candidates c where p.id = c.id
    returning p.order_id, p.provider_account_id, p.provider_checkout_session_id;
end;
$$;
revoke all on function public.get_stripe_checkouts_to_reconcile(integer) from public, anon, authenticated;
grant execute on function public.get_stripe_checkouts_to_reconcile(integer) to service_role;

commit;
