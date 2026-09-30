begin;

-- Accept receipts from an account retained in this organization's history.
-- The registered payment still binds order, account, session, amount and currency;
-- an old account cannot create a new Checkout or settle another organization's order.
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
    where id = v_order.org_id
      and (stripe_connected_account_id = p_account_id
        or stripe_legacy_account_ids ? p_account_id)) then
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


-- A late payment on an expired reservation must not subtract another order's sold stock.
create or replace function public.apply_order_refund(
  p_order_id uuid,
  p_provider text,
  p_refund_id text,
  p_original_payment_id text,
  p_amount_cents integer,
  p_currency text,
  p_status text,
  p_raw jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_parent public.payments%rowtype;
  v_existing public.payments%rowtype;
  v_order public.orders%rowtype;
  v_refunded integer;
  v_remaining integer;
  v_status text := lower(trim(coalesce(p_status, '')));
  v_fully_refunded boolean := false;
begin
  if p_order_id is null or nullif(trim(coalesce(p_refund_id, '')), '') is null then
    raise exception 'VALIDATION_ERROR: refund identity required';
  end if;
  if p_amount_cents is null or p_amount_cents <= 0 then
    raise exception 'VALIDATION_ERROR: refund amount must be > 0';
  end if;

  select * into v_existing
  from public.payments
  where provider = lower(trim(p_provider))
    and provider_payment_id = trim(p_refund_id)
  for update;

  if found then
    select * into v_order from public.orders where id = p_order_id;
    return jsonb_build_object(
      'ok', true,
      'idempotent', true,
      'refund_id', v_existing.id,
      'fully_refunded', v_order.status = 'refunded',
      'remaining_paid_cents', greatest(coalesce(v_order.paid_cents, 0), 0)
    );
  end if;

  select * into v_order
  from public.orders
  where id = p_order_id
  for update;
  if not found then raise exception 'ORDER_NOT_FOUND'; end if;

  select * into v_parent
  from public.payments
  where order_id = p_order_id
    and provider = lower(trim(p_provider))
    and provider_payment_id = trim(p_original_payment_id)
    and type = 'payment'
  for update;
  if not found then raise exception 'ORIGINAL_PAYMENT_NOT_FOUND'; end if;

  if upper(trim(p_currency)) <> upper(v_parent.currency) then
    raise exception 'REFUND_CURRENCY_MISMATCH';
  end if;

  select coalesce(sum(amount_cents), 0)::integer
  into v_refunded
  from public.payments
  where parent_payment_id = v_parent.id
    and type = 'refund'
    and status = 'paid';

  if v_status in ('succeeded', 'paid')
     and v_refunded + p_amount_cents > v_parent.amount_cents then
    raise exception 'REFUND_AMOUNT_EXCEEDS_PAYMENT';
  end if;

  insert into public.payments (
    order_id, provider, provider_payment_id, provider_account_id,
    amount_cents, currency, status, is_refund, processed_at, raw,
    type, parent_payment_id
  ) values (
    p_order_id, lower(trim(p_provider)), trim(p_refund_id),
    v_parent.provider_account_id, p_amount_cents, upper(trim(p_currency)),
    case when v_status in ('succeeded', 'paid') then 'paid' else 'failed' end,
    true,
    case when v_status in ('succeeded', 'paid') then now() else null end,
    p_raw, 'refund', v_parent.id
  );

  if v_status in ('succeeded', 'paid') then
    v_remaining := greatest(coalesce(v_order.paid_cents, 0) - p_amount_cents, 0);
    v_fully_refunded := v_remaining = 0;

    update public.orders
    set paid_cents = v_remaining,
        status = case when v_fully_refunded then 'refunded' else 'partially_paid' end,
        refunded_at = case when v_fully_refunded then coalesce(refunded_at, now()) else refunded_at end,
        updated_at = now()
    where id = p_order_id;

    if v_fully_refunded and v_order.status <> 'refunded' then
      update public.tickets
      set status = 'refunded'
      where order_id = p_order_id
        and status not in ('cancelled', 'refunded');

      update public.order_attendees
      set status = 'cancelled'
      where order_id = p_order_id
        and status = 'confirmed';

      update public.event_products ep
      set sold_qty = greatest(0, coalesce(ep.sold_qty, 0) - x.qty)
      from (
        select product_id, sum(quantity)::integer as qty
        from public.order_items
        where order_id = p_order_id
        group by product_id
      ) x
      where ep.id = x.product_id
        -- Expired unpaid reservations already released reserved stock and never sold it.
        and v_order.confirmed_at is not null;
    end if;
  else
    v_remaining := greatest(coalesce(v_order.paid_cents, 0), 0);
  end if;

  return jsonb_build_object(
    'ok', true,
    'idempotent', false,
    'fully_refunded', v_fully_refunded,
    'remaining_paid_cents', v_remaining
  );
end;
$$;

revoke all on function public.apply_order_refund(
  uuid, text, text, text, integer, text, text, jsonb
) from public, anon, authenticated;
grant execute on function public.apply_order_refund(
  uuid, text, text, text, integer, text, text, jsonb
) to service_role;

commit;
