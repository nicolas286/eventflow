begin;

/*
 * Stripe Connect is introduced for event ticket payments. Mollie identifiers
 * remain intact as read-only historical references. Platform subscriptions
 * are invoiced internally and never use Stripe Billing.
 */

alter table public.organizations
  add column if not exists stripe_connected_account_id text,
  add column if not exists stripe_details_submitted boolean not null default false,
  add column if not exists stripe_charges_enabled boolean not null default false,
  add column if not exists stripe_payouts_enabled boolean not null default false,
  add column if not exists stripe_migration_required boolean not null default false,
  add column if not exists payments_details_submitted boolean not null default false,
  add column if not exists payments_account_updated_at timestamptz;

update public.organizations o
set stripe_migration_required = true
where o.stripe_connected_account_id is null
  and (
    (
      o.payments_provider = 'mollie'
      and o.payments_status in ('pending', 'connected', 'revoked')
    )
    or exists (
      select 1
      from private.organization_mollie_connect mc
      where mc.org_id = o.id
        and mc.mode in ('test', 'live')
    )
  );

alter table public.organizations
  drop constraint if exists organizations_payments_provider_check;

alter table public.organizations
  add constraint organizations_payments_provider_check
  check (payments_provider in ('mollie', 'stripe')) not valid;

alter table public.organizations
  validate constraint organizations_payments_provider_check;

alter table public.organizations
  alter column payments_provider set default 'stripe';

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

drop trigger if exists trg_use_stripe_for_new_organizations on public.organizations;
create trigger trg_use_stripe_for_new_organizations
before insert on public.organizations
for each row execute function private.use_stripe_for_new_organizations();

alter table public.organizations
  add constraint organizations_stripe_connected_account_id_check
  check (
    stripe_connected_account_id is null
    or (
      char_length(stripe_connected_account_id) between 8 and 100
      and stripe_connected_account_id like 'acct\_%' escape '\'
    )
  ) not valid;

alter table public.organizations
  validate constraint organizations_stripe_connected_account_id_check;

create unique index if not exists organizations_stripe_connected_account_id_uidx
  on public.organizations (stripe_connected_account_id)
  where stripe_connected_account_id is not null;

alter table public.payments
  add column if not exists provider_account_id text,
  add column if not exists provider_checkout_session_id text;

alter table public.payments
  drop constraint if exists payments_provider_check;

alter table public.payments
  add constraint payments_provider_check
  check (provider in ('mollie', 'stripe', 'offline')) not valid;

alter table public.payments
  validate constraint payments_provider_check;

alter table public.payments
  add constraint payments_provider_account_id_check
  check (
    provider_account_id is null
    or char_length(provider_account_id) between 3 and 100
  ) not valid;

alter table public.payments
  validate constraint payments_provider_account_id_check;

alter table public.payments
  add constraint payments_provider_checkout_session_id_check
  check (
    provider_checkout_session_id is null
    or char_length(provider_checkout_session_id) between 3 and 100
  ) not valid;

alter table public.payments
  validate constraint payments_provider_checkout_session_id_check;

create unique index if not exists payments_provider_checkout_session_uidx
  on public.payments (provider, provider_checkout_session_id)
  where provider_checkout_session_id is not null;

create index if not exists payments_provider_account_idx
  on public.payments (provider, provider_account_id);

alter table public.subscriptions
  add column if not exists current_period_start timestamptz,
  add column if not exists mollie_legacy_snapshot jsonb;

alter table public.subscriptions
  drop constraint if exists subscriptions_provider_check;

alter table public.subscriptions
  add constraint subscriptions_provider_check
  check (provider in ('mollie', 'manual')) not valid;

alter table public.subscriptions
  validate constraint subscriptions_provider_check;

alter table public.subscriptions
  drop constraint if exists subscriptions_status_check;

alter table public.subscriptions
  add constraint subscriptions_status_check
  check (
    status in (
      'inactive', 'pending', 'active', 'suspended', 'canceled', 'cancelled',
      'completed', 'expired'
    )
  ) not valid;

alter table public.subscriptions
  validate constraint subscriptions_status_check;

alter table public.invoices
  add column if not exists provider_invoice_id text;

create unique index if not exists invoices_provider_invoice_id_uidx
  on public.invoices (provider, provider_invoice_id)
  where provider is not null and provider_invoice_id is not null;

create table if not exists private.payment_webhook_events (
  provider text not null,
  event_id text not null,
  scope text not null,
  account_id text,
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  attempts integer not null default 1,
  processing_started_at timestamptz not null default now(),
  lease_expires_at timestamptz not null default (now() + interval '5 minutes'),
  processed_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (provider, event_id),
  constraint payment_webhook_events_provider_check check (provider = 'stripe'),
  constraint payment_webhook_events_scope_check check (scope = 'connect'),
  constraint payment_webhook_events_event_id_check check (char_length(event_id) between 3 and 255),
  constraint payment_webhook_events_event_type_check check (char_length(event_type) between 3 and 255),
  constraint payment_webhook_events_payload_object_check check (jsonb_typeof(payload) = 'object')
);

alter table private.payment_webhook_events enable row level security;

revoke all on table private.payment_webhook_events from public, anon, authenticated;
grant select, insert, update on table private.payment_webhook_events to service_role;

create index if not exists payment_webhook_events_unprocessed_idx
  on private.payment_webhook_events (lease_expires_at)
  where processed_at is null;

create or replace function public.claim_payment_webhook_event(
  p_provider text,
  p_event_id text,
  p_scope text,
  p_account_id text,
  p_event_type text,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_row private.payment_webhook_events%rowtype;
begin
  if lower(trim(coalesce(p_provider, ''))) <> 'stripe' then
    raise exception 'VALIDATION_ERROR: unsupported webhook provider';
  end if;

  if lower(trim(coalesce(p_scope, ''))) <> 'connect' then
    raise exception 'VALIDATION_ERROR: unsupported webhook scope';
  end if;

  if nullif(trim(coalesce(p_event_id, '')), '') is null
     or nullif(trim(coalesce(p_event_type, '')), '') is null then
    raise exception 'VALIDATION_ERROR: webhook identity required';
  end if;

  insert into private.payment_webhook_events (
    provider,
    event_id,
    scope,
    account_id,
    event_type,
    payload
  )
  values (
    lower(trim(p_provider)),
    trim(p_event_id),
    lower(trim(p_scope)),
    nullif(trim(coalesce(p_account_id, '')), ''),
    trim(p_event_type),
    coalesce(p_payload, '{}'::jsonb)
  )
  on conflict (provider, event_id) do update
  set
    attempts = private.payment_webhook_events.attempts + 1,
    processing_started_at = now(),
    lease_expires_at = now() + interval '5 minutes',
    last_error = null,
    updated_at = now()
  where private.payment_webhook_events.processed_at is null
    and private.payment_webhook_events.lease_expires_at <= now()
  returning * into v_row;

  return jsonb_build_object(
    'should_process', found,
    'attempts', case when found then v_row.attempts else null end
  );
end;
$$;

revoke all on function public.claim_payment_webhook_event(text, text, text, text, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.claim_payment_webhook_event(text, text, text, text, text, jsonb)
  to service_role;

create or replace function public.complete_payment_webhook_event(
  p_provider text,
  p_event_id text,
  p_success boolean,
  p_error text default null
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
begin
  update private.payment_webhook_events
  set
    processed_at = case when p_success then now() else null end,
    processing_started_at = case when p_success then processing_started_at else null end,
    lease_expires_at = case when p_success then lease_expires_at else now() end,
    last_error = case when p_success then null else left(coalesce(p_error, 'WEBHOOK_PROCESSING_FAILED'), 1000) end,
    updated_at = now()
  where provider = lower(trim(p_provider))
    and event_id = trim(p_event_id);
end;
$$;

revoke all on function public.complete_payment_webhook_event(text, text, boolean, text)
  from public, anon, authenticated;
grant execute on function public.complete_payment_webhook_event(text, text, boolean, text)
  to service_role;

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
  v_refunded integer;
  v_status text := lower(trim(coalesce(p_status, '')));
begin
  if p_order_id is null or nullif(trim(coalesce(p_refund_id, '')), '') is null then
    raise exception 'VALIDATION_ERROR: refund identity required';
  end if;

  if p_amount_cents is null or p_amount_cents <= 0 then
    raise exception 'VALIDATION_ERROR: refund amount must be > 0';
  end if;

  select *
  into v_existing
  from public.payments
  where provider = lower(trim(p_provider))
    and provider_payment_id = trim(p_refund_id)
  for update;

  if found then
    return jsonb_build_object('ok', true, 'idempotent', true, 'refund_id', v_existing.id);
  end if;

  select *
  into v_parent
  from public.payments
  where order_id = p_order_id
    and provider = lower(trim(p_provider))
    and provider_payment_id = trim(p_original_payment_id)
    and type = 'payment'
  for update;

  if not found then
    raise exception 'ORIGINAL_PAYMENT_NOT_FOUND';
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
    order_id,
    provider,
    provider_payment_id,
    provider_account_id,
    amount_cents,
    currency,
    status,
    is_refund,
    processed_at,
    raw,
    type,
    parent_payment_id
  ) values (
    p_order_id,
    lower(trim(p_provider)),
    trim(p_refund_id),
    v_parent.provider_account_id,
    p_amount_cents,
    upper(trim(p_currency)),
    case when v_status in ('succeeded', 'paid') then 'paid' else 'failed' end,
    true,
    case when v_status in ('succeeded', 'paid') then now() else null end,
    p_raw,
    'refund',
    v_parent.id
  );

  return jsonb_build_object('ok', true, 'idempotent', false);
end;
$$;

revoke all on function public.apply_order_refund(uuid, text, text, text, integer, text, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.apply_order_refund(uuid, text, text, text, integer, text, text, jsonb)
  to service_role;

commit;
