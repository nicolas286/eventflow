begin;

create or replace function private.normalize_iban(p_iban text)
returns text
language sql
immutable
strict
set search_path = pg_catalog
as $$
  select upper(regexp_replace(p_iban, '[[:space:]]+', '', 'g'));
$$;

create or replace function private.is_valid_iban(p_iban text)
returns boolean
language plpgsql
immutable
strict
set search_path = pg_catalog, private
as $$
declare
  v_iban text := private.normalize_iban(p_iban);
  v_rearranged text;
  v_character text;
  v_digits text;
  v_digit text;
  v_remainder integer := 0;
begin
  if char_length(v_iban) not between 15 and 34
     or v_iban !~ '^[A-Z]{2}[0-9]{2}[0-9A-Z]+$' then
    return false;
  end if;

  v_rearranged := substr(v_iban, 5) || substr(v_iban, 1, 4);

  for v_index in 1..char_length(v_rearranged) loop
    v_character := substr(v_rearranged, v_index, 1);
    v_digits := case
      when v_character between '0' and '9' then v_character
      else (ascii(v_character) - ascii('A') + 10)::text
    end;

    for v_digit_index in 1..char_length(v_digits) loop
      v_digit := substr(v_digits, v_digit_index, 1);
      v_remainder := (v_remainder * 10 + v_digit::integer) % 97;
    end loop;
  end loop;

  return v_remainder = 1;
end;
$$;

create or replace function private.mask_iban(p_iban text)
returns text
language plpgsql
immutable
strict
set search_path = pg_catalog, private
as $$
declare
  v_iban text := private.normalize_iban(p_iban);
  v_masked text;
  v_result text := '';
begin
  if char_length(v_iban) < 6 then
    return repeat('•', char_length(v_iban));
  end if;

  v_masked := substr(v_iban, 1, 2)
    || repeat('•', char_length(v_iban) - 6)
    || right(v_iban, 4);

  for v_index in 1..char_length(v_masked) by 4 loop
    if v_result <> '' then
      v_result := v_result || ' ';
    end if;
    v_result := v_result || substr(v_masked, v_index, 4);
  end loop;

  return v_result;
end;
$$;

revoke all on function private.normalize_iban(text) from public, anon, authenticated;
revoke all on function private.is_valid_iban(text) from public, anon, authenticated;
revoke all on function private.mask_iban(text) from public, anon, authenticated;
grant execute on function private.normalize_iban(text) to service_role;
grant execute on function private.is_valid_iban(text) to service_role;
grant execute on function private.mask_iban(text) to service_role;

create or replace function private.validate_organization_bank_iban_change()
returns trigger
language plpgsql
set search_path = pg_catalog, private
as $$
begin
  if tg_op = 'UPDATE'
     and new.bank_transfer_iban is not distinct from old.bank_transfer_iban then
    return new;
  end if;

  if new.bank_transfer_iban is not null then
    if char_length(new.bank_transfer_iban) > 64 then
      raise exception 'VALIDATION_ERROR: invalid IBAN length';
    end if;
    new.bank_transfer_iban := private.normalize_iban(new.bank_transfer_iban);
    if not private.is_valid_iban(new.bank_transfer_iban) then
      raise exception 'VALIDATION_ERROR: invalid IBAN checksum';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function private.validate_organization_bank_iban_change()
  from public, anon, authenticated;
grant execute on function private.validate_organization_bank_iban_change()
  to service_role;

drop trigger if exists organizations_validate_bank_iban_change
  on public.organizations;
create trigger organizations_validate_bank_iban_change
before insert or update of bank_transfer_iban on public.organizations
for each row execute function private.validate_organization_bank_iban_change();

create table if not exists private.organization_bank_account_audit (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  -- Keep the actor UUID as an audit fact without blocking account deletion.
  changed_by uuid not null,
  changed_at timestamptz not null default now(),
  old_iban_masked text,
  new_iban_masked text
);

create index if not exists organization_bank_account_audit_org_changed_idx
  on private.organization_bank_account_audit (org_id, changed_at desc);

revoke all on table private.organization_bank_account_audit
  from public, anon, authenticated;
grant select, insert on table private.organization_bank_account_audit
  to service_role;

create table if not exists private.bank_transfer_payment_instructions (
  order_id uuid primary key references public.orders(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  payment_id uuid not null unique references public.payments(id) on delete cascade,
  internal_reference text not null unique,
  communication text not null unique,
  beneficiary text not null,
  iban text not null,
  amount_cents integer not null check (amount_cents > 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  confirmed_at timestamptz,
  confirmed_by uuid references auth.users(id) on delete set null,
  constraint bank_transfer_payment_instructions_iban_check
    check (private.is_valid_iban(iban))
);

create index if not exists bank_transfer_payment_instructions_org_created_idx
  on private.bank_transfer_payment_instructions (org_id, created_at desc);
create index if not exists bank_transfer_payment_instructions_confirmed_by_idx
  on private.bank_transfer_payment_instructions (confirmed_by)
  where confirmed_by is not null;

revoke all on table private.bank_transfer_payment_instructions
  from public, anon, authenticated;
grant select, insert, update on table private.bank_transfer_payment_instructions
  to service_role;

-- Preserve active legacy bank-transfer reservations during rollout. This is a
-- targeted, non-destructive backfill; paid, cancelled and expired orders are
-- not changed.
update public.orders o
set expires_at = null, updated_at = now()
where o.status = 'awaiting_payment'
  and o.expires_at is not null
  and exists (
    select 1
    from public.payments p
    where p.order_id = o.id
      and p.provider = 'offline'
      and p.provider_payment_id = 'bank_transfer:' || o.id::text
      and p.type = 'payment'
  );

alter table public.payments
  add column if not exists manual_confirmed_at timestamptz,
  add column if not exists manual_confirmed_by uuid references auth.users(id) on delete set null;

create index if not exists payments_manual_confirmed_by_idx
  on public.payments (manual_confirmed_by)
  where manual_confirmed_by is not null;

alter table public.orders
  add column if not exists expired_at timestamptz,
  add column if not exists expired_by uuid references auth.users(id) on delete set null;

create index if not exists orders_expired_by_idx
  on public.orders (expired_by)
  where expired_by is not null;

create or replace function public.update_organization_payment_settings(
  p_org_id uuid,
  p_provider text,
  p_bank_transfer_beneficiary text default null,
  p_bank_transfer_iban text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_user_id uuid := auth.uid();
  v_provider text := lower(nullif(trim(coalesce(p_provider, '')), ''));
  v_beneficiary text;
  v_iban text;
  v_old_iban text;
  v_old_beneficiary text;
  v_audit_id uuid;
  v_result jsonb;
begin
  if v_user_id is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  if p_org_id is null then
    raise exception 'VALIDATION_ERROR: org_id is required';
  end if;

  if not exists (
    select 1
    from public.organization_members m
    where m.org_id = p_org_id
      and m.user_id = v_user_id
      and m.role in ('owner', 'admin')
  ) then
    raise exception 'FORBIDDEN';
  end if;

  perform private.assert_rate_limit(
    'update_org_payment:user:' || v_user_id::text || ':org:' || p_org_id::text,
    30,
    60
  );

  if char_length(coalesce(p_provider, '')) > 32
     or char_length(coalesce(p_bank_transfer_beneficiary, '')) > 500
     or char_length(coalesce(p_bank_transfer_iban, '')) > 64 then
    raise exception 'VALIDATION_ERROR: payment settings are too long';
  end if;

  v_beneficiary := nullif(
    trim(regexp_replace(coalesce(p_bank_transfer_beneficiary, ''), '\s+', ' ', 'g')),
    ''
  );
  v_iban := nullif(private.normalize_iban(coalesce(p_bank_transfer_iban, '')), '');

  if v_provider is null or v_provider not in ('stripe', 'bank_transfer') then
    raise exception 'VALIDATION_ERROR: invalid payment provider';
  end if;

  if v_provider = 'stripe'
     and (
       not exists (
         select 1
         from public.user_profile up
         where up.user_id = v_user_id
           and up.stripe_connect_allowed = true
       )
       or not exists (
         select 1
         from public.organizations o
         join public.user_profile owner_profile
           on owner_profile.user_id = o.created_by
         where o.id = p_org_id
           and owner_profile.stripe_connect_allowed = true
       )
     ) then
    raise exception 'STRIPE_CONNECT_NOT_ALLOWED';
  end if;

  if v_provider = 'bank_transfer' then
    if v_beneficiary is null
       or char_length(v_beneficiary) not between 2 and 160 then
      raise exception 'VALIDATION_ERROR: invalid bank transfer beneficiary';
    end if;

    if v_iban is null or not private.is_valid_iban(v_iban) then
      raise exception 'VALIDATION_ERROR: invalid IBAN checksum';
    end if;
  end if;

  select o.bank_transfer_iban, o.bank_transfer_beneficiary
  into v_old_iban, v_old_beneficiary
  from public.organizations o
  where o.id = p_org_id
  for update;

  if not found then
    raise exception 'NOT_FOUND';
  end if;

  -- Selecting Stripe must not silently erase reusable bank details. Explicit
  -- bank-detail changes continue to go through the bank-transfer form.
  if v_provider = 'stripe' then
    v_iban := v_old_iban;
    v_beneficiary := v_old_beneficiary;
  end if;

  update public.organizations o
  set
    payments_provider = v_provider,
    bank_transfer_beneficiary = v_beneficiary,
    bank_transfer_iban = v_iban,
    stripe_migration_required = case
      when v_provider = 'bank_transfer' then false
      else o.stripe_migration_required
    end,
    updated_at = now()
  where o.id = p_org_id;

  if v_old_iban is distinct from v_iban then
    insert into private.organization_bank_account_audit (
      org_id,
      changed_by,
      old_iban_masked,
      new_iban_masked
    )
    values (
      p_org_id,
      v_user_id,
      case when v_old_iban is null then null else private.mask_iban(v_old_iban) end,
      case when v_iban is null then null else private.mask_iban(v_iban) end
    )
    returning id into v_audit_id;
  end if;

  select jsonb_build_object(
    'orgId', o.id,
    'paymentsProvider', o.payments_provider,
    'bankTransferBeneficiary', o.bank_transfer_beneficiary,
    'bankTransferIban', o.bank_transfer_iban,
    'bankTransferIbanMasked', case
      when o.bank_transfer_iban is null then null
      else private.mask_iban(o.bank_transfer_iban)
    end,
    'bankTransferIbanChanged', v_old_iban is distinct from v_iban,
    'auditId', v_audit_id,
    'oldBankTransferIbanMasked', case
      when v_old_iban is null then null
      else private.mask_iban(v_old_iban)
    end
  )
  into v_result
  from public.organizations o
  where o.id = p_org_id;

  return v_result;
end;
$$;

revoke all on function public.update_organization_payment_settings(uuid, text, text, text)
  from public, anon, authenticated;
grant execute on function public.update_organization_payment_settings(uuid, text, text, text)
  to authenticated;

create or replace function public.create_bank_transfer_payment(
  p_order_id uuid,
  p_amount_cents integer,
  p_currency text,
  p_beneficiary text,
  p_iban text,
  p_communication text,
  p_internal_reference text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_order public.orders%rowtype;
  v_payment public.payments%rowtype;
  v_instruction private.bank_transfer_payment_instructions%rowtype;
  v_provider_payment_id text := 'bank_transfer:' || p_order_id::text;
  v_currency text := upper(nullif(trim(coalesce(p_currency, '')), ''));
  v_beneficiary text := nullif(trim(regexp_replace(coalesce(p_beneficiary, ''), '\s+', ' ', 'g')), '');
  v_iban text := nullif(private.normalize_iban(coalesce(p_iban, '')), '');
  v_communication text := nullif(trim(regexp_replace(coalesce(p_communication, ''), '\s+', ' ', 'g')), '');
  v_internal_reference text := nullif(trim(coalesce(p_internal_reference, '')), '');
begin
  if p_order_id is null or p_amount_cents is null or p_amount_cents <= 0
     or v_currency is null or v_currency !~ '^[A-Z]{3}$'
     or v_beneficiary is null or v_iban is null
     or v_communication is null or v_internal_reference is null then
    raise exception 'VALIDATION_ERROR: invalid bank transfer payment';
  end if;

  if not private.is_valid_iban(v_iban) then
    raise exception 'VALIDATION_ERROR: invalid IBAN checksum';
  end if;

  select * into v_order
  from public.orders
  where id = p_order_id
  for update;

  if not found then
    raise exception 'ORDER_NOT_FOUND';
  end if;

  if v_order.status <> 'awaiting_payment' or coalesce(v_order.paid_cents, 0) > 0 then
    raise exception 'ORDER_NOT_PAYABLE';
  end if;

  select * into v_payment
  from public.payments
  where provider = 'offline'
    and provider_payment_id = v_provider_payment_id
    and type = 'payment'
  for update;

  if found then
    if v_payment.order_id is distinct from p_order_id then
      raise exception 'PAYMENT_ORDER_MISMATCH';
    end if;
    if v_payment.amount_cents is distinct from p_amount_cents
       or upper(v_payment.currency) is distinct from v_currency then
      raise exception 'PAYMENT_AMOUNT_MISMATCH';
    end if;
  else
    insert into public.payments (
      order_id,
      provider,
      provider_payment_id,
      provider_account_id,
      provider_checkout_session_id,
      amount_cents,
      currency,
      status,
      is_refund,
      created_at,
      updated_at,
      processed_at,
      raw,
      type,
      parent_payment_id
    ) values (
      p_order_id,
      'offline',
      v_provider_payment_id,
      null,
      null,
      p_amount_cents,
      v_currency,
      'open',
      false,
      now(),
      now(),
      null,
      jsonb_build_object(
        'method', 'bank_transfer',
        'communication', v_communication,
        'internalReference', v_internal_reference
      ),
      'payment',
      null
    )
    returning * into v_payment;
  end if;

  insert into private.bank_transfer_payment_instructions (
    order_id,
    org_id,
    payment_id,
    internal_reference,
    communication,
    beneficiary,
    iban,
    amount_cents,
    currency
  ) values (
    p_order_id,
    v_order.org_id,
    v_payment.id,
    v_internal_reference,
    v_communication,
    v_beneficiary,
    v_iban,
    p_amount_cents,
    v_currency
  )
  on conflict (order_id) do nothing;

  select * into v_instruction
  from private.bank_transfer_payment_instructions i
  where i.order_id = p_order_id;

  -- Bank transfers do not expire automatically. The organizer can expire the
  -- reservation manually with expire_bank_transfer_order.
  update public.orders
  set expires_at = null, updated_at = now()
  where id = p_order_id;

  return jsonb_build_object(
    'paymentId', v_payment.id,
    'providerPaymentId', v_provider_payment_id,
    'internalReference', v_instruction.internal_reference,
    'communication', v_instruction.communication,
    'beneficiary', v_instruction.beneficiary,
    'iban', v_instruction.iban,
    'amountCents', v_instruction.amount_cents,
    'currency', v_instruction.currency,
    'paymentDueAt', null
  );
end;
$$;

revoke all on function public.create_bank_transfer_payment(uuid, integer, text, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.create_bank_transfer_payment(uuid, integer, text, text, text, text, text)
  to service_role;

create or replace function public.get_bank_transfer_instructions(p_order_id uuid)
returns jsonb
language sql
security definer
set search_path = pg_catalog, public, private
as $$
  select jsonb_build_object(
    'orderId', i.order_id,
    'internalReference', i.internal_reference,
    'communication', i.communication,
    'beneficiary', i.beneficiary,
    'iban', i.iban,
    'amountCents', i.amount_cents,
    'currency', i.currency,
    'paymentDueAt', null
  )
  from private.bank_transfer_payment_instructions i
  where i.order_id = p_order_id;
$$;

revoke all on function public.get_bank_transfer_instructions(uuid)
  from public, anon, authenticated;
grant execute on function public.get_bank_transfer_instructions(uuid)
  to service_role;

create or replace function public.mark_bank_transfer_manually_confirmed(
  p_order_id uuid,
  p_confirmed_by uuid
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
begin
  update public.payments p
  set
    manual_confirmed_at = coalesce(p.manual_confirmed_at, now()),
    manual_confirmed_by = coalesce(p.manual_confirmed_by, p_confirmed_by),
    updated_at = now()
  where p.order_id = p_order_id
    and p.provider = 'offline'
    and p.provider_payment_id = 'bank_transfer:' || p_order_id::text
    and p.type = 'payment';

  if not found then
    raise exception 'BANK_TRANSFER_PAYMENT_NOT_FOUND';
  end if;

  update private.bank_transfer_payment_instructions i
  set
    confirmed_at = coalesce(i.confirmed_at, now()),
    confirmed_by = coalesce(i.confirmed_by, p_confirmed_by),
    updated_at = now()
  where i.order_id = p_order_id;
end;
$$;

revoke all on function public.mark_bank_transfer_manually_confirmed(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.mark_bank_transfer_manually_confirmed(uuid, uuid)
  to service_role;

create or replace function public.expire_bank_transfer_order(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_user_id uuid := auth.uid();
  v_order public.orders%rowtype;
  v_released integer := 0;
begin
  if v_user_id is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  select * into v_order
  from public.orders
  where id = p_order_id
  for update;

  if not found then
    raise exception 'ORDER_NOT_FOUND';
  end if;

  if not exists (
    select 1
    from public.organization_members m
    where m.org_id = v_order.org_id
      and m.user_id = v_user_id
      and m.role in ('owner', 'admin')
  ) then
    raise exception 'FORBIDDEN';
  end if;

  if not exists (
    select 1
    from public.payments p
    where p.order_id = p_order_id
      and p.provider = 'offline'
      and p.provider_payment_id = 'bank_transfer:' || p_order_id::text
      and p.type = 'payment'
  ) then
    raise exception 'ORDER_IS_NOT_A_BANK_TRANSFER';
  end if;

  if v_order.status = 'expired' then
    return jsonb_build_object(
      'ok', true,
      'orderId', p_order_id,
      'status', 'expired',
      'releasedUnits', 0,
      'idempotent', true
    );
  end if;

  if v_order.status not in ('open', 'pending', 'awaiting_payment')
     or coalesce(v_order.paid_cents, 0) > 0 then
    raise exception 'ORDER_NOT_EXPIRABLE';
  end if;

  select coalesce(sum(oi.quantity), 0)::integer
  into v_released
  from public.order_items oi
  where oi.order_id = p_order_id;

  update public.event_products ep
  set reserved_qty = greatest(0, coalesce(ep.reserved_qty, 0) - quantities.qty)
  from (
    select oi.product_id, sum(oi.quantity)::integer as qty
    from public.order_items oi
    where oi.order_id = p_order_id
    group by oi.product_id
  ) quantities
  where ep.id = quantities.product_id;

  update public.order_attendees
  set status = 'expired'
  where order_id = p_order_id
    and status = 'reserved';

  update public.payments
  set status = 'expired', updated_at = now()
  where order_id = p_order_id
    and provider = 'offline'
    and provider_payment_id = 'bank_transfer:' || p_order_id::text
    and type = 'payment'
    and status <> 'paid';

  update public.orders
  set
    status = 'expired',
    expires_at = null,
    expired_at = now(),
    expired_by = v_user_id,
    updated_at = now()
  where id = p_order_id;

  return jsonb_build_object(
    'ok', true,
    'orderId', p_order_id,
    'status', 'expired',
    'releasedUnits', v_released,
    'idempotent', false
  );
end;
$$;

revoke all on function public.expire_bank_transfer_order(uuid)
  from public, anon, authenticated;
grant execute on function public.expire_bank_transfer_order(uuid)
  to authenticated;

create or replace function public.get_bank_transfer_admin_summaries(p_event_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_user_id uuid := auth.uid();
  v_org_id uuid;
  v_result jsonb;
begin
  if v_user_id is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  select e.org_id into v_org_id
  from public.events e
  where e.id = p_event_id;

  if v_org_id is null then
    raise exception 'NOT_FOUND';
  end if;

  if not exists (
    select 1
    from public.organization_members m
    where m.org_id = v_org_id
      and m.user_id = v_user_id
      and m.role in ('owner', 'admin')
  ) then
    raise exception 'FORBIDDEN';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'orderId', o.id,
    'amountCents', p.amount_cents,
    'currency', p.currency,
    'internalReference', coalesce(i.internal_reference, o.id::text),
    'communication', coalesce(i.communication, p.raw->>'communication'),
    'createdAt', o.created_at,
    'paymentDueAt', null,
    'confirmedAt', coalesce(i.confirmed_at, p.manual_confirmed_at),
    'confirmedBy', coalesce(i.confirmed_by, p.manual_confirmed_by)
  ) order by o.created_at desc), '[]'::jsonb)
  into v_result
  from public.orders o
  join public.payments p
    on p.order_id = o.id
   and p.provider = 'offline'
   and p.provider_payment_id = 'bank_transfer:' || o.id::text
   and p.type = 'payment'
  left join private.bank_transfer_payment_instructions i
    on i.order_id = o.id
  where o.event_id = p_event_id;

  return v_result;
end;
$$;

revoke all on function public.get_bank_transfer_admin_summaries(uuid)
  from public, anon, authenticated;
grant execute on function public.get_bank_transfer_admin_summaries(uuid)
  to authenticated;

create or replace function public.get_dashboard_bootstrap()
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_user_id uuid := auth.uid();
  v_org_id uuid;
  v_result jsonb;
  v_plan_limits jsonb;
  v_profile jsonb;
begin
  if v_user_id is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  select to_jsonb(pl)
  into v_plan_limits
  from public.plan_limits pl
  where pl.plan = 'free'
  limit 1;

  if v_plan_limits is null then
    raise exception 'CONFIG_ERROR: missing plan_limits for plan=free';
  end if;

  select to_jsonb(up)
  into v_profile
  from public.user_profile up
  where up.user_id = v_user_id
  limit 1;

  select om.org_id
  into v_org_id
  from public.organization_members om
  where om.user_id = v_user_id
  order by om.created_at asc
  limit 1;

  if v_org_id is null then
    return jsonb_build_object(
      'profile', v_profile,
      'membership', null,
      'organization', null,
      'organizationProfile', null,
      'subscription', null,
      'planLimits', v_plan_limits
    );
  end if;

  select jsonb_build_object(
    'profile', v_profile,
    'membership', (
      select to_jsonb(om)
      from public.organization_members om
      where om.user_id = v_user_id and om.org_id = v_org_id
      limit 1
    ),
    'organization', (
      select to_jsonb(o) || jsonb_build_object(
        'bank_transfer_iban', case
          when o.bank_transfer_iban is null then null
          else private.mask_iban(o.bank_transfer_iban)
        end
      )
      from public.organizations o
      where o.id = v_org_id
    ),
    'organizationProfile', (
      select to_jsonb(op)
      from public.organization_profile op
      where op.org_id = v_org_id
    ),
    'subscription', (
      select jsonb_build_object(
        'org_id', s.org_id,
        'provider', s.provider,
        'plan', s.plan,
        'status', s.status,
        'current_period_end', s.current_period_end
      )
      from public.subscriptions s
      where s.org_id = v_org_id
      limit 1
    ),
    'planLimits', (
      select to_jsonb(pl)
      from public.plan_limits pl
      join public.organizations o on o.plan = pl.plan
      where o.id = v_org_id
      limit 1
    )
  ) into v_result;

  if (v_result->'planLimits') is null then
    v_result := jsonb_set(v_result, '{planLimits}', v_plan_limits, true);
  end if;

  return v_result;
end;
$$;

revoke all on function public.get_dashboard_bootstrap()
  from public, anon, authenticated;
grant execute on function public.get_dashboard_bootstrap()
  to authenticated;

comment on table private.bank_transfer_payment_instructions is
  'Booking-scoped bank transfer instructions. Full IBAN is intentionally kept outside exposed schemas and returned only after booking-token or organization authorization.';

comment on table private.organization_bank_account_audit is
  'Security audit of organization IBAN changes. Stores masked values only.';

commit;
