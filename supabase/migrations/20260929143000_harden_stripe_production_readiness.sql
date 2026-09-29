begin;

/*
 * Eventflow Stripe production-readiness hardening.
 *
 * Existing bank details, bank-transfer orders and connected-account IDs are
 * preserved. New event payments are switched to Stripe, while every existing
 * Stripe account must be re-verified before it can be considered ready.
 */

alter table public.organizations
  add column if not exists stripe_account_type text,
  add column if not exists stripe_controller_fees_payer text,
  add column if not exists stripe_controller_losses_payments text,
  add column if not exists stripe_controller_requirement_collection text,
  add column if not exists stripe_controller_dashboard_type text,
  add column if not exists stripe_requirements_disabled_reason text,
  add column if not exists stripe_requirements_currently_due jsonb not null default '[]'::jsonb,
  add column if not exists stripe_legacy_account_ids jsonb not null default '[]'::jsonb,
  add column if not exists stripe_compliance_verified boolean not null default false,
  add column if not exists stripe_deauthorized_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'organizations_stripe_requirements_currently_due_array_check'
      and conrelid = 'public.organizations'::regclass
  ) then
    alter table public.organizations
      add constraint organizations_stripe_requirements_currently_due_array_check
      check (jsonb_typeof(stripe_requirements_currently_due) = 'array') not valid;
  end if;
end
$$;

alter table public.organizations
  validate constraint organizations_stripe_requirements_currently_due_array_check;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'organizations_stripe_legacy_account_ids_array_check'
      and conrelid = 'public.organizations'::regclass
  ) then
    alter table public.organizations
      add constraint organizations_stripe_legacy_account_ids_array_check
      check (jsonb_typeof(stripe_legacy_account_ids) = 'array') not valid;
  end if;
end
$$;

alter table public.organizations
  validate constraint organizations_stripe_legacy_account_ids_array_check;

alter table public.payments
  add column if not exists checkout_expires_at timestamptz;

create index if not exists payments_open_checkout_expiry_idx
  on public.payments (checkout_expires_at)
  where provider = 'stripe'
    and is_refund = false
    and status in ('open', 'pending');

alter table public.orders
  add column if not exists platform_terms_version text,
  add column if not exists organizer_sales_terms_version text,
  add column if not exists organizer_sales_terms_snapshot text,
  add column if not exists organizer_display_name_snapshot text,
  add column if not exists terms_accepted_at timestamptz,
  add column if not exists refunded_at timestamptz;

alter table public.organization_profile
  add column if not exists sales_terms text not null default $terms$# Conditions de réservation et de vente

## Identité du vendeur

Le vendeur des billets et l’organisateur de l’événement est l’organisation identifiée sur la page de l’événement. Eventflow fournit la plateforme technique et n’est pas le vendeur.

## Réservation et paiement

La réservation payante devient définitive après confirmation du paiement. Le paiement est encaissé directement par l’organisateur au moyen de son compte Stripe connecté.

## Annulation par le participant

Toute demande d’annulation ou de remboursement doit être adressée directement à l’organisateur au moyen des coordonnées affichées sur la page de l’événement. Un remboursement n’est accordé que lorsque l’organisateur l’accepte ou lorsque la législation applicable l’impose.

## Annulation ou modification par l’organisateur

Si l’événement est annulé ou substantiellement modifié, l’organisateur informe les participants et traite les remboursements conformément à la législation applicable et aux modalités communiquées pour l’événement.

## Billets

Le participant est responsable de la conservation de son billet et de son code d’accès. Un billet remboursé, annulé, déjà utilisé ou rendu invalide ne permet plus l’accès à l’événement.

## Contact

Les questions concernant l’événement, l’accès, une annulation ou un remboursement doivent être adressées à l’organisateur via ses coordonnées publiques.$terms$,
  add column if not exists sales_terms_version text not null default 'default-2026-09-29',
  add column if not exists sales_terms_accepted_version text,
  add column if not exists sales_terms_accepted_at timestamptz,
  add column if not exists sales_terms_accepted_by uuid references auth.users(id) on delete set null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'organization_profile_sales_terms_length_check'
      and conrelid = 'public.organization_profile'::regclass
  ) then
    alter table public.organization_profile
      add constraint organization_profile_sales_terms_length_check
      check (char_length(trim(sales_terms)) between 200 and 10000) not valid;
  end if;
end
$$;

alter table public.organization_profile
  validate constraint organization_profile_sales_terms_length_check;

create table if not exists private.organization_sales_terms_acceptances (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  accepted_by uuid references auth.users(id) on delete set null,
  terms_version text not null,
  terms_snapshot text not null,
  accepted_at timestamptz not null default now(),
  constraint organization_sales_terms_acceptances_version_check
    check (char_length(terms_version) between 3 and 100),
  constraint organization_sales_terms_acceptances_snapshot_check
    check (char_length(terms_snapshot) between 200 and 10000)
);

alter table private.organization_sales_terms_acceptances enable row level security;
revoke all on table private.organization_sales_terms_acceptances
  from public, anon, authenticated;
grant select, insert on table private.organization_sales_terms_acceptances
  to service_role;

create index if not exists organization_sales_terms_acceptances_org_idx
  on private.organization_sales_terms_acceptances (org_id, accepted_at desc);

create table if not exists private.payment_refund_notifications (
  provider text not null,
  refund_id text not null,
  order_id uuid not null references public.orders(id) on delete cascade,
  attempts integer not null default 1,
  lease_expires_at timestamptz not null default (now() + interval '5 minutes'),
  sent_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (provider, refund_id),
  constraint payment_refund_notifications_provider_check check (provider = 'stripe')
);

alter table private.payment_refund_notifications enable row level security;
revoke all on table private.payment_refund_notifications
  from public, anon, authenticated;
grant select, insert, update on table private.payment_refund_notifications
  to service_role;

alter table public.user_profile
  alter column stripe_connect_allowed set default true;

update public.user_profile
set stripe_connect_allowed = true,
    updated_at = now()
where stripe_connect_allowed is distinct from true;

update public.organizations
set payments_provider = 'stripe',
    stripe_compliance_verified = false,
    stripe_migration_required = stripe_connected_account_id is not null,
    payments_live_ready = false,
    payments_status = case
      when stripe_connected_account_id is null then 'not_connected'
      else 'pending'
    end,
    updated_at = now()
where payments_provider is distinct from 'stripe'
   or stripe_connected_account_id is not null;

create or replace function private.use_stripe_for_new_organizations()
returns trigger
language plpgsql
set search_path = pg_catalog, public, private
as $$
begin
  new.payments_provider := 'stripe';
  return new;
end;
$$;

create or replace function public.accept_organization_sales_terms(
  p_org_id uuid,
  p_sales_terms text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_user_id uuid := auth.uid();
  v_terms text := nullif(trim(coalesce(p_sales_terms, '')), '');
  v_profile public.organization_profile%rowtype;
  v_version text;
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
    'accept_org_terms:user:' || v_user_id::text || ':org:' || p_org_id::text,
    10,
    60
  );

  if v_terms is null or char_length(v_terms) not between 200 and 10000 then
    raise exception 'VALIDATION_ERROR: invalid organizer sales terms';
  end if;

  select *
  into v_profile
  from public.organization_profile
  where org_id = p_org_id
  for update;

  if not found then
    raise exception 'NOT_FOUND';
  end if;

  if nullif(trim(coalesce(v_profile.public_email, '')), '') is null
     or trim(v_profile.public_email) !~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'VALIDATION_ERROR: valid public organizer email is required';
  end if;

  v_version := case
    when v_terms = v_profile.sales_terms then v_profile.sales_terms_version
    else 'custom-' || gen_random_uuid()::text
  end;

  update public.organization_profile
  set sales_terms = v_terms,
      sales_terms_version = v_version,
      sales_terms_accepted_version = v_version,
      sales_terms_accepted_at = now(),
      sales_terms_accepted_by = v_user_id,
      updated_at = now()
  where org_id = p_org_id;

  insert into private.organization_sales_terms_acceptances (
    org_id,
    accepted_by,
    terms_version,
    terms_snapshot
  ) values (
    p_org_id,
    v_user_id,
    v_version,
    v_terms
  );

  select jsonb_build_object(
    'orgId', o.id,
    'paymentsProvider', o.payments_provider,
    'bankTransferBeneficiary', o.bank_transfer_beneficiary,
    'bankTransferIban', null,
    'bankTransferIbanMasked', case
      when o.bank_transfer_iban is null then null
      else private.mask_iban(o.bank_transfer_iban)
    end,
    'salesTerms', op.sales_terms,
    'salesTermsVersion', op.sales_terms_version,
    'salesTermsAcceptedVersion', op.sales_terms_accepted_version,
    'salesTermsAcceptedAt', op.sales_terms_accepted_at,
    'salesTermsAcceptedBy', op.sales_terms_accepted_by,
    'salesTermsCurrent', true
  )
  into v_result
  from public.organizations o
  join public.organization_profile op on op.org_id = o.id
  where o.id = p_org_id;

  return v_result;
end;
$$;

revoke all on function public.accept_organization_sales_terms(uuid, text)
  from public, anon, authenticated;
grant execute on function public.accept_organization_sales_terms(uuid, text)
  to authenticated;

create or replace function public.record_order_terms_acceptance(
  p_order_id uuid,
  p_platform_terms_version text
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_order public.orders%rowtype;
  v_profile public.organization_profile%rowtype;
begin
  if p_order_id is null
     or nullif(trim(coalesce(p_platform_terms_version, '')), '') is null then
    raise exception 'VALIDATION_ERROR: terms acceptance identity required';
  end if;

  select * into v_order
  from public.orders
  where id = p_order_id
  for update;

  if not found then raise exception 'ORDER_NOT_FOUND'; end if;

  select * into v_profile
  from public.organization_profile
  where org_id = v_order.org_id;

  if not found
     or nullif(trim(coalesce(v_profile.public_email, '')), '') is null
     or trim(v_profile.public_email) !~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
     or char_length(trim(coalesce(v_profile.sales_terms, ''))) < 200
     or v_profile.sales_terms_accepted_at is null
     or v_profile.sales_terms_accepted_version is distinct from v_profile.sales_terms_version then
    raise exception 'ORGANIZER_SALES_TERMS_REQUIRED';
  end if;

  update public.orders
  set platform_terms_version = trim(p_platform_terms_version),
      organizer_sales_terms_version = v_profile.sales_terms_version,
      organizer_sales_terms_snapshot = v_profile.sales_terms,
      organizer_display_name_snapshot = v_profile.display_name,
      terms_accepted_at = coalesce(terms_accepted_at, now()),
      updated_at = now()
  where id = p_order_id;
end;
$$;

revoke all on function public.record_order_terms_acceptance(uuid, text)
  from public, anon, authenticated;
grant execute on function public.record_order_terms_acceptance(uuid, text)
  to service_role;

create or replace function public.store_stripe_checkout_payment(
  p_order_id uuid,
  p_provider_payment_id text,
  p_provider_account_id text,
  p_checkout_session_id text,
  p_amount_cents integer,
  p_currency text,
  p_checkout_expires_at timestamptz,
  p_order_expires_at timestamptz,
  p_raw jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_order public.orders%rowtype;
  v_payment_id uuid;
begin
  if p_order_id is null
     or nullif(trim(coalesce(p_provider_payment_id, '')), '') is null
     or nullif(trim(coalesce(p_provider_account_id, '')), '') is null
     or nullif(trim(coalesce(p_checkout_session_id, '')), '') is null then
    raise exception 'VALIDATION_ERROR: Stripe checkout identity required';
  end if;

  if p_amount_cents is null or p_amount_cents <= 0
     or upper(trim(coalesce(p_currency, ''))) <> 'EUR' then
    raise exception 'VALIDATION_ERROR: invalid Stripe checkout amount';
  end if;

  if p_checkout_expires_at is null
     or p_order_expires_at is null
     or p_checkout_expires_at <= now()
     or p_order_expires_at < p_checkout_expires_at + interval '1 minute'
     or p_order_expires_at > p_checkout_expires_at + interval '10 minutes' then
    raise exception 'VALIDATION_ERROR: invalid Stripe checkout expiry';
  end if;

  select * into v_order
  from public.orders
  where id = p_order_id
  for update;

  if not found then raise exception 'ORDER_NOT_FOUND'; end if;
  if v_order.status <> 'awaiting_payment'
     or (v_order.expires_at is not null and v_order.expires_at <= now()) then
    raise exception 'ORDER_NOT_PAYABLE';
  end if;
  if v_order.terms_accepted_at is null then
    raise exception 'ORDER_TERMS_NOT_ACCEPTED';
  end if;

  insert into public.payments (
    order_id,
    provider,
    provider_payment_id,
    provider_account_id,
    provider_checkout_session_id,
    checkout_expires_at,
    amount_cents,
    currency,
    status,
    is_refund,
    processed_at,
    raw,
    type
  ) values (
    p_order_id,
    'stripe',
    trim(p_provider_payment_id),
    trim(p_provider_account_id),
    trim(p_checkout_session_id),
    p_checkout_expires_at,
    p_amount_cents,
    'EUR',
    'open',
    false,
    null,
    p_raw,
    'payment'
  )
  on conflict (provider, provider_checkout_session_id)
    where provider_checkout_session_id is not null
  do update set
    checkout_expires_at = excluded.checkout_expires_at,
    raw = excluded.raw,
    updated_at = now()
  returning id into v_payment_id;

  update public.orders
  set expires_at = p_order_expires_at,
      updated_at = now()
  where id = p_order_id;

  return jsonb_build_object(
    'ok', true,
    'payment_id', v_payment_id,
    'checkout_expires_at', p_checkout_expires_at,
    'order_expires_at', p_order_expires_at
  );
end;
$$;

revoke all on function public.store_stripe_checkout_payment(
  uuid, text, text, text, integer, text, timestamptz, timestamptz, jsonb
) from public, anon, authenticated;
grant execute on function public.store_stripe_checkout_payment(
  uuid, text, text, text, integer, text, timestamptz, timestamptz, jsonb
) to service_role;

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

create or replace function public.get_public_organization_sales_terms(
  p_org_slug text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_slug text := nullif(trim(coalesce(p_org_slug, '')), '');
  v_result jsonb;
begin
  if v_slug is null then
    raise exception 'VALIDATION_ERROR: org_slug is required';
  end if;

  perform public.assert_rate_limit(
    'anon:org_sales_terms:' || v_slug,
    240,
    60
  );

  select jsonb_build_object(
    'display_name', op.display_name,
    'public_email', op.public_email,
    'phone', op.phone,
    'website', op.website,
    'sales_terms', op.sales_terms,
    'sales_terms_version', op.sales_terms_version,
    'sales_terms_accepted',
      op.sales_terms_accepted_at is not null
      and op.sales_terms_accepted_version = op.sales_terms_version
      and nullif(trim(coalesce(op.public_email, '')), '') is not null
      and trim(op.public_email) ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  )
  into v_result
  from public.organization_profile op
  where op.slug = v_slug
  limit 1;

  if v_result is null then
    raise exception 'NOT_FOUND';
  end if;

  return v_result;
end;
$$;

revoke all on function public.get_public_organization_sales_terms(text)
  from public, anon, authenticated;
grant execute on function public.get_public_organization_sales_terms(text)
  to anon, authenticated;

create or replace function public.claim_payment_refund_notification(
  p_provider text,
  p_refund_id text,
  p_order_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_claimed boolean := false;
begin
  insert into private.payment_refund_notifications (
    provider, refund_id, order_id
  ) values (
    lower(trim(p_provider)), trim(p_refund_id), p_order_id
  )
  on conflict (provider, refund_id) do update
  set attempts = private.payment_refund_notifications.attempts + 1,
      lease_expires_at = now() + interval '5 minutes',
      last_error = null,
      updated_at = now()
  where private.payment_refund_notifications.sent_at is null
    and private.payment_refund_notifications.lease_expires_at <= now()
  returning true into v_claimed;

  return coalesce(v_claimed, false);
end;
$$;

create or replace function public.complete_payment_refund_notification(
  p_provider text,
  p_refund_id text,
  p_success boolean,
  p_error text default null
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, private
as $$
begin
  update private.payment_refund_notifications
  set sent_at = case when p_success then now() else null end,
      lease_expires_at = case when p_success then lease_expires_at else now() end,
      last_error = case
        when p_success then null
        else left(coalesce(p_error, 'REFUND_NOTIFICATION_FAILED'), 1000)
      end,
      updated_at = now()
  where provider = lower(trim(p_provider))
    and refund_id = trim(p_refund_id);
end;
$$;

revoke all on function public.claim_payment_refund_notification(text, text, uuid)
  from public, anon, authenticated;
revoke all on function public.complete_payment_refund_notification(text, text, boolean, text)
  from public, anon, authenticated;
grant execute on function public.claim_payment_refund_notification(text, text, uuid)
  to service_role;
grant execute on function public.complete_payment_refund_notification(text, text, boolean, text)
  to service_role;

alter table public.orders
  drop constraint if exists orders_status_allowed;

alter table public.orders
  add constraint orders_status_allowed
  check (status in (
    'pending', 'awaiting_payment', 'partially_paid', 'paid',
    'cancelled', 'canceled', 'expired', 'refunded'
  )) not valid;

alter table public.orders validate constraint orders_status_allowed;

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
      where ep.id = x.product_id;
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
  v_old_iban text;
  v_old_beneficiary text;
  v_result jsonb;
begin
  if v_user_id is null then raise exception 'NOT_AUTHENTICATED'; end if;
  if p_org_id is null then raise exception 'VALIDATION_ERROR: org_id is required'; end if;

  if not exists (
    select 1 from public.organization_members m
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

  if v_provider = 'bank_transfer' then
    raise exception 'BANK_TRANSFER_DISABLED';
  end if;
  if v_provider <> 'stripe' then
    raise exception 'VALIDATION_ERROR: invalid payment provider';
  end if;

  select bank_transfer_iban, bank_transfer_beneficiary
  into v_old_iban, v_old_beneficiary
  from public.organizations
  where id = p_org_id
  for update;
  if not found then raise exception 'NOT_FOUND'; end if;

  update public.organizations
  set payments_provider = 'stripe',
      updated_at = now()
  where id = p_org_id;

  select jsonb_build_object(
    'orgId', o.id,
    'paymentsProvider', o.payments_provider,
    'bankTransferBeneficiary', v_old_beneficiary,
    'bankTransferIban', null,
    'bankTransferIbanMasked', case
      when v_old_iban is null then null else private.mask_iban(v_old_iban)
    end,
    'bankTransferIbanChanged', false
  ) into v_result
  from public.organizations o
  where o.id = p_org_id;

  return v_result;
end;
$$;

revoke all on function public.update_organization_payment_settings(uuid, text, text, text)
  from public, anon, authenticated;
grant execute on function public.update_organization_payment_settings(uuid, text, text, text)
  to authenticated;

/* Existing open Stripe sessions already contain the provider expiry in raw. */
with stripe_expiries as (
  select
    p.order_id,
    max(to_timestamp((p.raw->>'expires_at')::double precision)) as checkout_expiry
  from public.payments p
  join public.orders o on o.id = p.order_id
  where p.provider = 'stripe'
    and p.is_refund = false
    and p.status in ('open', 'pending')
    and o.status = 'awaiting_payment'
    and coalesce(p.raw->>'expires_at', '') ~ '^[0-9]+$'
  group by p.order_id
)
update public.orders o
set expires_at = greatest(
      coalesce(o.expires_at, se.checkout_expiry + interval '2 minutes'),
      se.checkout_expiry + interval '2 minutes'
    ),
    updated_at = now()
from stripe_expiries se
where o.id = se.order_id;

update public.payments p
set checkout_expires_at = to_timestamp((p.raw->>'expires_at')::double precision),
    updated_at = now()
where p.provider = 'stripe'
  and p.is_refund = false
  and p.checkout_expires_at is null
  and coalesce(p.raw->>'expires_at', '') ~ '^[0-9]+$';

comment on column public.organization_profile.sales_terms is
  'Organizer-authored sales, cancellation and refund terms shown to ticket buyers.';
comment on column public.orders.organizer_sales_terms_snapshot is
  'Immutable organizer-terms snapshot accepted by the buyer for this order.';
comment on column public.payments.checkout_expires_at is
  'Provider-side Checkout expiry. The order expires later, after a safety grace period.';

commit;
