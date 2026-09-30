begin;

-- An open direct charge belongs to the account on which its Checkout Session
-- was created. Keep that account attached until Stripe reaches a terminal state.
-- The shared organization lock serializes checkout registration with rotation.
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
  perform 1 from public.organizations
  where id = v_order.org_id and stripe_connected_account_id = p_account_id
  for share;
  if not found then raise exception 'STRIPE_CONNECTED_ACCOUNT_MISMATCH'; end if;

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

create or replace function public.replace_stripe_account_for_standard_migration(
  p_org_id uuid,
  p_expected_old_account_id text,
  p_new_account_id text
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_org public.organizations%rowtype;
begin
  if p_org_id is null
     or nullif(trim(coalesce(p_expected_old_account_id, '')), '') is null
     or nullif(trim(coalesce(p_new_account_id, '')), '') is null
     or trim(p_expected_old_account_id) = trim(p_new_account_id) then
    raise exception 'VALIDATION_ERROR: invalid Stripe account migration';
  end if;

  select * into v_org
  from public.organizations
  where id = p_org_id
  for update;
  if not found then raise exception 'NOT_FOUND'; end if;

  if v_org.stripe_connected_account_id is distinct from trim(p_expected_old_account_id)
     and v_org.stripe_connected_account_id is distinct from trim(p_new_account_id) then
    raise exception 'STRIPE_ACCOUNT_MIGRATION_CONFLICT';
  end if;

  if v_org.stripe_connected_account_id = trim(p_expected_old_account_id)
     and exists (
       select 1
       from public.payments p
       join public.orders o on o.id = p.order_id
       where o.org_id = p_org_id
         and p.provider = 'stripe'
         and p.provider_account_id = trim(p_expected_old_account_id)
         and p.type = 'payment'
         and p.is_refund = false
         and p.processed_at is null
         and p.status in ('open', 'pending')
     ) then
    raise exception 'STRIPE_ACCOUNT_OPEN_CHECKOUTS';
  end if;

  update public.organizations
  set stripe_connected_account_id = trim(p_new_account_id),
      stripe_legacy_account_ids = case
        when stripe_legacy_account_ids ? trim(p_expected_old_account_id)
          then stripe_legacy_account_ids
        else stripe_legacy_account_ids || jsonb_build_array(trim(p_expected_old_account_id))
      end,
      stripe_migration_required = false,
      stripe_compliance_verified = false,
      payments_live_ready = false,
      payments_status = 'pending',
      updated_at = now()
  where id = p_org_id;
end;
$$;

revoke all on function public.replace_stripe_account_for_standard_migration(
  uuid, text, text
) from public, anon, authenticated;
grant execute on function public.replace_stripe_account_for_standard_migration(
  uuid, text, text
) to service_role;

commit;
