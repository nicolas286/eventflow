-- Internal Eventflow platform back-office.
-- This migration intentionally creates no initial administrator. The first
-- staging administrator must be inserted manually into private.platform_admins
-- after their Supabase Auth user id has been verified.

create schema if not exists private;

create table private.platform_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  granted_at timestamptz not null default now(),
  granted_by uuid references auth.users(id) on delete set null,
  revoked_at timestamptz,
  note text,
  constraint platform_admins_note_length check (note is null or char_length(note) <= 1000)
);

create table private.platform_audit_log (
  id bigint generated always as identity primary key,
  actor_user_id uuid references auth.users(id) on delete set null,
  actor_session_id uuid,
  action text not null,
  target_type text not null,
  target_id text,
  outcome text not null,
  reason text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint platform_audit_action_length check (char_length(action) between 1 and 120),
  constraint platform_audit_target_type_length check (char_length(target_type) between 1 and 80),
  constraint platform_audit_target_id_length check (target_id is null or char_length(target_id) <= 320),
  constraint platform_audit_outcome_check check (outcome in ('success', 'failure')),
  constraint platform_audit_reason_length check (reason is null or char_length(reason) <= 1000),
  constraint platform_audit_metadata_object check (jsonb_typeof(metadata) = 'object')
);

create table private.platform_step_up_grants (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique,
  admin_user_id uuid not null references auth.users(id) on delete cascade,
  session_id uuid not null,
  action text not null,
  target_id text not null,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint platform_step_up_token_hash_length check (char_length(token_hash) = 64),
  constraint platform_step_up_action_length check (char_length(action) between 1 and 120),
  constraint platform_step_up_target_length check (char_length(target_id) between 1 and 320),
  constraint platform_step_up_expiry_check check (expires_at > created_at)
);

create table private.platform_settings (
  singleton boolean primary key default true,
  registrations_open boolean not null default false,
  registration_public_message text not null default 'Les inscriptions sont temporairement indisponibles pendant la refonte de la plateforme.',
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null,
  constraint platform_settings_singleton check (singleton),
  constraint platform_settings_message_length check (char_length(registration_public_message) between 1 and 500)
);

insert into private.platform_settings (singleton, registrations_open)
values (true, false)
on conflict (singleton) do nothing;

create table private.platform_announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  body text not null,
  level text not null default 'information',
  audience text not null default 'both',
  status text not null default 'draft',
  starts_at timestamptz,
  ends_at timestamptz,
  created_by uuid not null references auth.users(id) on delete restrict,
  updated_by uuid not null references auth.users(id) on delete restrict,
  published_by uuid references auth.users(id) on delete set null,
  published_at timestamptz,
  retired_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint platform_announcement_title_length check (char_length(title) between 1 and 120),
  constraint platform_announcement_body_length check (char_length(body) between 1 and 2000),
  constraint platform_announcement_level_check check (level in ('information', 'warning', 'maintenance')),
  constraint platform_announcement_audience_check check (audience in ('organizer', 'public', 'both')),
  constraint platform_announcement_status_check check (status in ('draft', 'published', 'retired')),
  constraint platform_announcement_window_check check (ends_at is null or starts_at is null or ends_at > starts_at)
);

create table private.platform_onboarding_operations (
  idempotency_key uuid primary key,
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  owner_user_id uuid references auth.users(id) on delete restrict,
  owner_email text not null,
  payload_hash text not null,
  organization_id uuid references public.organizations(id) on delete set null,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint platform_onboarding_email_length check (char_length(owner_email) between 3 and 320),
  constraint platform_onboarding_hash_length check (char_length(payload_hash) = 64)
);

alter table private.platform_admins enable row level security;
alter table private.platform_admins force row level security;
alter table private.platform_audit_log enable row level security;
alter table private.platform_audit_log force row level security;
alter table private.platform_step_up_grants enable row level security;
alter table private.platform_step_up_grants force row level security;
alter table private.platform_settings enable row level security;
alter table private.platform_settings force row level security;
alter table private.platform_announcements enable row level security;
alter table private.platform_announcements force row level security;
alter table private.platform_onboarding_operations enable row level security;
alter table private.platform_onboarding_operations force row level security;

revoke all on table private.platform_admins from public, anon, authenticated;
revoke all on table private.platform_audit_log from public, anon, authenticated;
revoke all on table private.platform_step_up_grants from public, anon, authenticated;
revoke all on table private.platform_settings from public, anon, authenticated;
revoke all on table private.platform_announcements from public, anon, authenticated;
revoke all on table private.platform_onboarding_operations from public, anon, authenticated;

create index platform_admins_active_idx
  on private.platform_admins (user_id)
  where revoked_at is null;
create index platform_audit_created_idx
  on private.platform_audit_log (created_at desc, id desc);
create index platform_audit_actor_created_idx
  on private.platform_audit_log (actor_user_id, created_at desc, id desc);
create index platform_step_up_lookup_idx
  on private.platform_step_up_grants (admin_user_id, session_id, action, target_id, expires_at)
  where consumed_at is null;
create index platform_step_up_expiry_idx
  on private.platform_step_up_grants (expires_at)
  where consumed_at is null;
create index platform_announcements_active_idx
  on private.platform_announcements (status, starts_at, ends_at)
  where status = 'published';

create index if not exists platform_organizations_created_idx
  on public.organizations (created_at desc, id desc);
create index if not exists platform_organizations_status_created_idx
  on public.organizations (status, created_at desc, id desc);
create index if not exists platform_organizations_plan_created_idx
  on public.organizations (plan, created_at desc, id desc);
create index if not exists platform_events_created_idx
  on public.events (created_at desc);
create index if not exists platform_events_org_created_idx
  on public.events (org_id, created_at desc);
create index if not exists platform_orders_created_idx
  on public.orders (created_at desc);
create index if not exists platform_payments_status_processed_idx
  on public.payments (status, processed_at desc)
  where status in ('paid', 'failed');
create index if not exists platform_invoices_status_paid_idx
  on public.invoices (status, paid_at desc)
  where status = 'paid';

create or replace function private.platform_assert_admin(
  p_user_id uuid,
  p_session_id uuid,
  p_aal text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_user_id is null or p_session_id is null then
    raise exception 'PLATFORM_UNAUTHORIZED';
  end if;

  if p_aal <> 'aal2' then
    raise exception 'PLATFORM_MFA_REQUIRED';
  end if;

  if not exists (
    select 1
    from private.platform_admins pa
    where pa.user_id = p_user_id
      and pa.revoked_at is null
  ) then
    raise exception 'PLATFORM_FORBIDDEN';
  end if;

  if not exists (
    select 1
    from auth.sessions s
    where s.id = p_session_id
      and s.user_id = p_user_id
  ) then
    raise exception 'PLATFORM_SESSION_REVOKED';
  end if;
end;
$$;

create or replace function private.platform_write_audit(
  p_actor_user_id uuid,
  p_actor_session_id uuid,
  p_action text,
  p_target_type text,
  p_target_id text,
  p_outcome text,
  p_reason text,
  p_metadata jsonb default '{}'::jsonb
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into private.platform_audit_log (
    actor_user_id,
    actor_session_id,
    action,
    target_type,
    target_id,
    outcome,
    reason,
    metadata
  ) values (
    p_actor_user_id,
    p_actor_session_id,
    p_action,
    p_target_type,
    p_target_id,
    p_outcome,
    nullif(trim(p_reason), ''),
    coalesce(p_metadata, '{}'::jsonb)
  );
$$;

create or replace function private.platform_consume_step_up(
  p_user_id uuid,
  p_session_id uuid,
  p_action text,
  p_target_id text,
  p_token_hash text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_grant_id uuid;
begin
  update private.platform_step_up_grants
  set consumed_at = now()
  where token_hash = p_token_hash
    and admin_user_id = p_user_id
    and session_id = p_session_id
    and action = p_action
    and target_id = p_target_id
    and consumed_at is null
    and expires_at > now()
  returning id into v_grant_id;

  if v_grant_id is null then
    raise exception 'PLATFORM_STEP_UP_REQUIRED';
  end if;
end;
$$;

revoke all on function private.platform_assert_admin(uuid, uuid, text) from public, anon, authenticated, service_role;
revoke all on function private.platform_write_audit(uuid, uuid, text, text, text, text, text, jsonb) from public, anon, authenticated, service_role;
revoke all on function private.platform_consume_step_up(uuid, uuid, text, text, text) from public, anon, authenticated, service_role;

create or replace function public.platform_admin_access_state(
  p_user_id uuid,
  p_session_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'isPlatformAdmin', exists (
      select 1
      from private.platform_admins pa
      where pa.user_id = p_user_id
        and pa.revoked_at is null
    ),
    'sessionActive', exists (
      select 1
      from auth.sessions s
      where s.id = p_session_id
        and s.user_id = p_user_id
    )
  );
$$;

create or replace function public.platform_admin_issue_step_up(
  p_user_id uuid,
  p_session_id uuid,
  p_aal text,
  p_token_hash text,
  p_action text,
  p_target_id text,
  p_expires_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.platform_assert_admin(p_user_id, p_session_id, p_aal);

  if p_token_hash is null or char_length(p_token_hash) <> 64 then
    raise exception 'PLATFORM_INVALID_STEP_UP';
  end if;
  if nullif(trim(p_action), '') is null or char_length(p_action) > 120 then
    raise exception 'PLATFORM_INVALID_STEP_UP';
  end if;
  if nullif(trim(p_target_id), '') is null or char_length(p_target_id) > 320 then
    raise exception 'PLATFORM_INVALID_STEP_UP';
  end if;
  if p_expires_at <= now() or p_expires_at > now() + interval '5 minutes' then
    raise exception 'PLATFORM_INVALID_STEP_UP';
  end if;

  delete from private.platform_step_up_grants
  where expires_at < now() - interval '1 day';

  insert into private.platform_step_up_grants (
    token_hash,
    admin_user_id,
    session_id,
    action,
    target_id,
    expires_at
  ) values (
    lower(p_token_hash),
    p_user_id,
    p_session_id,
    p_action,
    p_target_id,
    p_expires_at
  );

  return jsonb_build_object('expiresAt', p_expires_at);
end;
$$;

revoke all on function public.platform_admin_access_state(uuid, uuid) from public, anon, authenticated;
grant execute on function public.platform_admin_access_state(uuid, uuid) to service_role;
revoke all on function public.platform_admin_issue_step_up(uuid, uuid, text, text, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.platform_admin_issue_step_up(uuid, uuid, text, text, text, text, timestamptz) to service_role;

create or replace function public.platform_admin_authorize_onboarding(
  p_user_id uuid,
  p_session_id uuid,
  p_aal text,
  p_idempotency_key uuid,
  p_owner_email text,
  p_payload_hash text,
  p_step_up_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing private.platform_onboarding_operations%rowtype;
  v_email text := nullif(lower(trim(p_owner_email)), '');
begin
  perform private.platform_assert_admin(p_user_id, p_session_id, p_aal);
  perform private.platform_consume_step_up(
    p_user_id,
    p_session_id,
    'organizations.onboard',
    v_email,
    lower(p_step_up_hash)
  );

  if p_idempotency_key is null
     or v_email is null
     or char_length(v_email) > 320
     or char_length(coalesce(p_payload_hash, '')) <> 64 then
    raise exception 'PLATFORM_INVALID_ONBOARDING';
  end if;

  select * into v_existing
  from private.platform_onboarding_operations
  where idempotency_key = p_idempotency_key;

  if found then
    if v_existing.actor_user_id <> p_user_id
       or v_existing.owner_email <> v_email
       or v_existing.payload_hash <> lower(p_payload_hash) then
      raise exception 'PLATFORM_IDEMPOTENCY_CONFLICT';
    end if;
  else
    insert into private.platform_onboarding_operations (
      idempotency_key, actor_user_id, owner_email, payload_hash
    ) values (
      p_idempotency_key, p_user_id, v_email, lower(p_payload_hash)
    );
  end if;

  return jsonb_build_object('authorized', true, 'completed', v_existing.completed_at is not null);
end;
$$;

revoke all on function public.platform_admin_authorize_onboarding(uuid, uuid, text, uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.platform_admin_authorize_onboarding(uuid, uuid, text, uuid, text, text, text) to service_role;

create or replace function public.platform_admin_read(
  p_user_id uuid,
  p_session_id uuid,
  p_aal text,
  p_resource text,
  p_params jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
  v_period_days integer;
  v_since timestamptz;
  v_limit integer;
  v_search text;
  v_status text;
  v_plan text;
  v_payments_provider text;
  v_payments_status text;
  v_cursor_created_at timestamptz;
  v_cursor_id uuid;
  v_org_id uuid;
begin
  perform private.platform_assert_admin(p_user_id, p_session_id, p_aal);

  if p_resource = 'overview' then
    v_period_days := least(greatest(coalesce((p_params->>'periodDays')::integer, 30), 7), 365);
    v_since := now() - make_interval(days => v_period_days);

    with organization_metrics as (
      select
        count(*)::integer as total,
        count(*) filter (where created_at >= now() - interval '7 days')::integer as new_7,
        count(*) filter (where created_at >= now() - interval '30 days')::integer as new_30,
        count(*) filter (where created_at >= now() - interval '90 days')::integer as new_90,
        count(*) filter (where status = 'trial')::integer as trial,
        count(*) filter (where status = 'active')::integer as active,
        count(*) filter (where status = 'suspended')::integer as suspended,
        count(*) filter (where plan = 'free')::integer as free,
        count(*) filter (where plan = 'starter')::integer as starter,
        count(*) filter (where plan = 'pro')::integer as pro,
        count(*) filter (
          where payments_status <> 'connected'
             or not exists (
               select 1
               from public.organization_profile op
               where op.org_id = organizations.id
                 and nullif(trim(op.description), '') is not null
                 and nullif(trim(op.slug), '') is not null
             )
        )::integer as incomplete
      from public.organizations
    ), activity_metrics as (
      select
        (select count(*)::integer from public.events) as events_total,
        (select count(*)::integer from public.events where is_published) as events_published,
        (select count(*)::integer from public.events where starts_at > now()) as events_upcoming,
        (select count(*)::integer from public.events where created_at >= v_since) as events_created_period,
        (select count(*)::integer from public.orders where created_at >= v_since) as orders_period,
        (
          select count(*)::integer
          from public.order_attendees oa
          join public.orders o on o.id = oa.order_id
          where o.created_at >= v_since
        ) as participants_period,
        (select count(*)::integer from public.tickets where created_at >= v_since) as tickets_period,
        (
          select count(distinct active.org_id)::integer
          from (
            select e.org_id from public.events e where e.created_at >= v_since
            union
            select o.org_id from public.orders o where o.created_at >= v_since
          ) active
        ) as active_organizations
    ), order_metrics as (
      select
        count(*) filter (where status = 'paid')::integer as paid,
        count(*) filter (where status in ('pending', 'awaiting_payment', 'partially_paid'))::integer as pending,
        count(*) filter (where status = 'expired')::integer as expired,
        count(*) filter (where status in ('cancelled', 'refunded'))::integer as cancelled_or_refunded
      from public.orders
      where created_at >= v_since
    ), revenue_metrics as (
      select
        coalesce((
          select sum(i.total_cents)
          from public.invoices i
          where i.status = 'paid'
            and i.paid_at >= v_since
        ), 0)::bigint as eventflow_revenue_cents,
        coalesce((
          select sum(case when p.is_refund or p.type = 'refund' then 0 else p.amount_cents end)
          from public.payments p
          where p.status = 'paid'
            and coalesce(p.processed_at, p.created_at) >= v_since
        ), 0)::bigint as gmv_cents,
        coalesce((
          select sum(case when p.is_refund or p.type = 'refund' then p.amount_cents else 0 end)
          from public.payments p
          where p.status = 'paid'
            and coalesce(p.processed_at, p.created_at) >= v_since
        ), 0)::bigint as refunds_cents
    ), health_metrics as (
      select
        (select count(*)::integer from public.organizations where payments_status <> 'connected') as payment_issues,
        (
          select count(*)::integer
          from public.orders
          where status in ('pending', 'awaiting_payment', 'partially_paid')
            and created_at < now() - interval '24 hours'
        ) as stale_orders,
        (
          select count(*)::integer
          from public.orders
          where confirmation_email_error is not null
        ) as email_failures,
        (
          select count(*)::integer
          from public.invoice_peppol
          where status in ('failed', 'rejected')
        ) as invoice_failures
    )
    select jsonb_build_object(
      'periodDays', v_period_days,
      'updatedAt', now(),
      'organizations', jsonb_build_object(
        'total', om.total,
        'new7Days', om.new_7,
        'new30Days', om.new_30,
        'new90Days', om.new_90,
        'byStatus', jsonb_build_object('trial', om.trial, 'active', om.active, 'suspended', om.suspended),
        'byPlan', jsonb_build_object('free', om.free, 'starter', om.starter, 'pro', om.pro),
        'incomplete', om.incomplete
      ),
      'activity', jsonb_build_object(
        'eventsTotal', am.events_total,
        'eventsPublished', am.events_published,
        'eventsUpcoming', am.events_upcoming,
        'eventsCreatedPeriod', am.events_created_period,
        'ordersPeriod', am.orders_period,
        'participantsPeriod', am.participants_period,
        'ticketsPeriod', am.tickets_period,
        'activeOrganizations', am.active_organizations,
        'activeOrganizationsDefinition', 'Organisation ayant créé un événement ou reçu une commande pendant la période.'
      ),
      'orders', jsonb_build_object(
        'paid', odm.paid,
        'pending', odm.pending,
        'expired', odm.expired,
        'cancelledOrRefunded', odm.cancelled_or_refunded
      ),
      'revenue', jsonb_build_object(
        'eventflowRevenueCents', rm.eventflow_revenue_cents,
        'gmvCents', rm.gmv_cents,
        'refundsCents', rm.refunds_cents,
        'currency', 'EUR'
      ),
      'health', jsonb_build_object(
        'paymentIssues', hm.payment_issues,
        'staleOrders', hm.stale_orders,
        'emailFailures', hm.email_failures,
        'invoiceFailures', hm.invoice_failures
      )
    ) into v_result
    from organization_metrics om
    cross join activity_metrics am
    cross join order_metrics odm
    cross join revenue_metrics rm
    cross join health_metrics hm;

    return v_result;
  end if;

  if p_resource = 'organizations' then
    v_limit := least(greatest(coalesce((p_params->>'limit')::integer, 25), 1), 100);
    v_search := nullif(lower(trim(p_params->>'search')), '');
    v_status := nullif(lower(trim(p_params->>'status')), '');
    v_plan := nullif(lower(trim(p_params->>'plan')), '');
    v_payments_provider := nullif(lower(trim(p_params->>'paymentsProvider')), '');
    v_payments_status := nullif(lower(trim(p_params->>'paymentsStatus')), '');
    v_cursor_created_at := nullif(p_params->>'cursorCreatedAt', '')::timestamptz;
    v_cursor_id := nullif(p_params->>'cursorId', '')::uuid;

    with filtered as (
      select
        o.id,
        o.name,
        o.type,
        o.status,
        o.plan,
        o.plan_expires_at,
        o.payments_provider,
        o.payments_status,
        o.created_at,
        op.slug,
        owner_user.email as owner_email,
        coalesce(event_counts.total, 0)::integer as events_count,
        coalesce(order_counts.total, 0)::integer as orders_count,
        coalesce(order_counts.paid_cents, 0)::bigint as paid_cents
      from public.organizations o
      left join public.organization_profile op on op.org_id = o.id
      left join lateral (
        select u.email
        from public.organization_members om
        join auth.users u on u.id = om.user_id
        where om.org_id = o.id and om.role = 'owner'
        order by om.created_at asc
        limit 1
      ) owner_user on true
      left join lateral (
        select count(*) as total
        from public.events e
        where e.org_id = o.id
      ) event_counts on true
      left join lateral (
        select count(*) as total, coalesce(sum(ord.paid_cents), 0) as paid_cents
        from public.orders ord
        where ord.org_id = o.id
      ) order_counts on true
      where (v_status is null or o.status = v_status)
        and (v_plan is null or o.plan = v_plan)
        and (v_payments_provider is null or o.payments_provider = v_payments_provider)
        and (v_payments_status is null or o.payments_status = v_payments_status)
        and (
          v_search is null
          or lower(o.name) like '%' || v_search || '%'
          or lower(coalesce(op.slug, '')) like '%' || v_search || '%'
          or lower(coalesce(owner_user.email, '')) like '%' || v_search || '%'
        )
        and (
          v_cursor_created_at is null
          or (o.created_at, o.id) < (v_cursor_created_at, v_cursor_id)
        )
      order by o.created_at desc, o.id desc
      limit v_limit + 1
    ), page as (
      select * from filtered
      order by created_at desc, id desc
      limit v_limit
    ), last_row as (
      select created_at, id
      from page
      order by created_at asc, id asc
      limit 1
    )
    select jsonb_build_object(
      'items', coalesce((select jsonb_agg(to_jsonb(page) order by created_at desc, id desc) from page), '[]'::jsonb),
      'nextCursor', case
        when (select count(*) from filtered) > v_limit then (
          select jsonb_build_object('createdAt', created_at, 'id', id) from last_row
        )
        else null
      end
    ) into v_result;

    return v_result;
  end if;

  if p_resource = 'organization' then
    v_org_id := nullif(p_params->>'orgId', '')::uuid;
    if v_org_id is null then raise exception 'PLATFORM_INVALID_ORGANIZATION'; end if;

    select jsonb_build_object(
      'organization', jsonb_build_object(
        'id', o.id,
        'name', o.name,
        'type', o.type,
        'status', o.status,
        'plan', o.plan,
        'planStartedAt', o.plan_started_at,
        'planExpiresAt', o.plan_expires_at,
        'paymentsProvider', o.payments_provider,
        'paymentsStatus', o.payments_status,
        'paymentsLiveReady', o.payments_live_ready,
        'createdAt', o.created_at,
        'updatedAt', o.updated_at
      ),
      'profile', case when op.org_id is null then null else jsonb_build_object(
        'slug', op.slug,
        'displayName', op.display_name,
        'description', op.description,
        'publicEmail', op.public_email,
        'website', op.website
      ) end,
      'members', coalesce((
        select jsonb_agg(jsonb_build_object(
          'userId', om.user_id,
          'role', om.role,
          'email', u.email,
          'firstName', up.first_name,
          'lastName', up.last_name,
          'createdAt', om.created_at
        ) order by case when om.role = 'owner' then 0 else 1 end, om.created_at)
        from public.organization_members om
        join auth.users u on u.id = om.user_id
        left join public.user_profile up on up.user_id = om.user_id
        where om.org_id = o.id
      ), '[]'::jsonb),
      'subscription', (
        select jsonb_build_object(
          'provider', s.provider,
          'status', s.status,
          'plan', s.plan,
          'currentPeriodStart', s.current_period_start,
          'currentPeriodEnd', s.current_period_end,
          'billingDeferredUntil', s.billing_deferred_until
        )
        from public.subscriptions s
        where s.org_id = o.id
      ),
      'metrics', jsonb_build_object(
        'events', (select count(*)::integer from public.events e where e.org_id = o.id),
        'orders', (select count(*)::integer from public.orders ord where ord.org_id = o.id),
        'participants', (
          select count(*)::integer
          from public.order_attendees oa
          join public.orders ord on ord.id = oa.order_id
          where ord.org_id = o.id
        ),
        'paidCents', (select coalesce(sum(ord.paid_cents), 0)::bigint from public.orders ord where ord.org_id = o.id)
      ),
      'recentEvents', coalesce((
        select jsonb_agg(event_row order by event_row.created_at desc)
        from (
          select e.id, e.slug, e.title, e.is_published, e.starts_at, e.created_at
          from public.events e
          where e.org_id = o.id
          order by e.created_at desc
          limit 10
        ) event_row
      ), '[]'::jsonb)
    ) into v_result
    from public.organizations o
    left join public.organization_profile op on op.org_id = o.id
    where o.id = v_org_id;

    if v_result is null then raise exception 'PLATFORM_ORGANIZATION_NOT_FOUND'; end if;
    return v_result;
  end if;

  if p_resource = 'finance' then
    v_limit := least(greatest(coalesce((p_params->>'limit')::integer, 50), 1), 100);
    select jsonb_build_object(
      'subscriptions', coalesce((
        select jsonb_agg(row_data order by row_data.updated_at desc)
        from (
          select
            s.org_id,
            o.name as organization_name,
            s.provider,
            s.plan,
            s.status,
            s.current_period_start,
            s.current_period_end,
            s.updated_at
          from public.subscriptions s
          join public.organizations o on o.id = s.org_id
          order by s.updated_at desc
          limit v_limit
        ) row_data
      ), '[]'::jsonb),
      'invoices', coalesce((
        select jsonb_agg(row_data order by row_data.created_at desc)
        from (
          select i.id, i.org_id, o.name as organization_name, i.number, i.status,
                 i.total_cents, i.currency, i.issued_at, i.due_at, i.paid_at, i.created_at
          from public.invoices i
          join public.organizations o on o.id = i.org_id
          order by i.created_at desc
          limit v_limit
        ) row_data
      ), '[]'::jsonb),
      'paymentTotals', (
        select jsonb_build_object(
          'paidCents', coalesce(sum(amount_cents) filter (where status = 'paid' and not is_refund and type <> 'refund'), 0)::bigint,
          'refundedCents', coalesce(sum(amount_cents) filter (where status = 'paid' and (is_refund or type = 'refund')), 0)::bigint,
          'failedCount', count(*) filter (where status = 'failed')::integer,
          'pendingCount', count(*) filter (where status in ('created', 'pending', 'open', 'authorized'))::integer
        )
        from public.payments
      )
    ) into v_result;
    return v_result;
  end if;

  if p_resource = 'operations' then
    select jsonb_build_object(
      'staleOrders', coalesce((
        select jsonb_agg(row_data order by row_data.created_at)
        from (
          select ord.id, ord.org_id, o.name as organization_name, ord.status, ord.total_cents, ord.created_at
          from public.orders ord
          join public.organizations o on o.id = ord.org_id
          where ord.status in ('pending', 'awaiting_payment', 'partially_paid')
            and ord.created_at < now() - interval '24 hours'
          order by ord.created_at
          limit 50
        ) row_data
      ), '[]'::jsonb),
      'emailFailures', coalesce((
        select jsonb_agg(row_data order by row_data.updated_at desc)
        from (
          select ord.id, ord.org_id, o.name as organization_name,
                 ord.confirmation_email_error as error, ord.updated_at
          from public.orders ord
          join public.organizations o on o.id = ord.org_id
          where ord.confirmation_email_error is not null
          order by ord.updated_at desc
          limit 50
        ) row_data
      ), '[]'::jsonb),
      'invoiceFailures', coalesce((
        select jsonb_agg(row_data order by row_data.updated_at desc)
        from (
          select ip.invoice_id, i.org_id, o.name as organization_name,
                 ip.status, ip.error_code, ip.error_message, ip.updated_at
          from public.invoice_peppol ip
          join public.invoices i on i.id = ip.invoice_id
          join public.organizations o on o.id = i.org_id
          where ip.status in ('failed', 'rejected')
          order by ip.updated_at desc
          limit 50
        ) row_data
      ), '[]'::jsonb),
      'paymentConnections', coalesce((
        select jsonb_agg(row_data order by row_data.updated_at desc)
        from (
          select id, name, payments_provider, payments_status,
                 payments_live_ready, payments_account_updated_at, updated_at
          from public.organizations
          where payments_status <> 'connected' or not payments_live_ready
          order by updated_at desc
          limit 50
        ) row_data
      ), '[]'::jsonb)
    ) into v_result;
    return v_result;
  end if;

  if p_resource = 'configuration' then
    select jsonb_build_object(
      'registrationsOpen', ps.registrations_open,
      'registrationPublicMessage', ps.registration_public_message,
      'updatedAt', ps.updated_at,
      'updatedBy', ps.updated_by,
      'announcements', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', pa.id,
          'title', pa.title,
          'body', pa.body,
          'level', pa.level,
          'audience', pa.audience,
          'status', pa.status,
          'startsAt', pa.starts_at,
          'endsAt', pa.ends_at,
          'publishedAt', pa.published_at,
          'retiredAt', pa.retired_at,
          'createdBy', pa.created_by,
          'updatedBy', pa.updated_by,
          'publishedBy', pa.published_by,
          'createdAt', pa.created_at,
          'updatedAt', pa.updated_at
        ) order by pa.updated_at desc)
        from (
          select *
          from private.platform_announcements
          order by updated_at desc
          limit 50
        ) pa
      ), '[]'::jsonb)
    ) into v_result
    from private.platform_settings ps
    where ps.singleton;
    return v_result;
  end if;

  if p_resource = 'audit' then
    v_limit := least(greatest(coalesce((p_params->>'limit')::integer, 50), 1), 100);
    v_cursor_created_at := nullif(p_params->>'cursorCreatedAt', '')::timestamptz;
    with rows as (
      select
        pal.id,
        pal.actor_user_id,
        au.email as actor_email,
        pal.action,
        pal.target_type,
        pal.target_id,
        pal.outcome,
        pal.reason,
        pal.metadata,
        pal.created_at
      from private.platform_audit_log pal
      left join auth.users au on au.id = pal.actor_user_id
      where v_cursor_created_at is null or pal.created_at < v_cursor_created_at
      order by pal.created_at desc, pal.id desc
      limit v_limit
    )
    select jsonb_build_object(
      'items', coalesce(jsonb_agg(to_jsonb(rows) order by created_at desc, id desc), '[]'::jsonb),
      'nextCursorCreatedAt', min(created_at)
    ) into v_result
    from rows;
    return v_result;
  end if;

  if p_resource = 'admins' then
    select jsonb_build_object(
      'items', coalesce(jsonb_agg(jsonb_build_object(
        'userId', pa.user_id,
        'email', au.email,
        'firstName', up.first_name,
        'lastName', up.last_name,
        'grantedAt', pa.granted_at,
        'grantedBy', pa.granted_by,
        'revokedAt', pa.revoked_at,
        'note', pa.note
      ) order by pa.granted_at desc), '[]'::jsonb)
    ) into v_result
    from private.platform_admins pa
    join auth.users au on au.id = pa.user_id
    left join public.user_profile up on up.user_id = pa.user_id;
    return v_result;
  end if;

  raise exception 'PLATFORM_RESOURCE_NOT_FOUND';
end;
$$;

revoke all on function public.platform_admin_read(uuid, uuid, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.platform_admin_read(uuid, uuid, text, text, jsonb) to service_role;

create or replace function public.platform_public_config(
  p_audience text default 'public'
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_audience text := lower(trim(coalesce(p_audience, 'public')));
  v_result jsonb;
begin
  if v_audience not in ('public', 'organizer') then
    raise exception 'PLATFORM_INVALID_AUDIENCE';
  end if;

  select jsonb_build_object(
    'registrationsOpen', ps.registrations_open,
    'registrationPublicMessage', ps.registration_public_message,
    'announcement', (
      select jsonb_build_object(
        'id', pa.id,
        'title', pa.title,
        'body', pa.body,
        'level', pa.level,
        'audience', pa.audience,
        'startsAt', pa.starts_at,
        'endsAt', pa.ends_at
      )
      from private.platform_announcements pa
      where pa.status = 'published'
        and pa.audience in (v_audience, 'both')
        and (pa.starts_at is null or pa.starts_at <= now())
        and (pa.ends_at is null or pa.ends_at > now())
      order by pa.published_at desc nulls last, pa.updated_at desc
      limit 1
    )
  ) into v_result
  from private.platform_settings ps
  where ps.singleton;

  return v_result;
end;
$$;

revoke all on function public.platform_public_config(text) from public, anon, authenticated;
grant execute on function public.platform_public_config(text) to service_role;

create or replace function public.platform_find_auth_user_by_email(
  p_email text
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case when u.id is null then null else jsonb_build_object(
    'id', u.id,
    'email', u.email,
    'emailConfirmedAt', u.email_confirmed_at,
    'invitedAt', u.invited_at
  ) end
  from (select nullif(lower(trim(p_email)), '') as email) input
  left join auth.users u on lower(u.email) = input.email
  limit 1;
$$;

revoke all on function public.platform_find_auth_user_by_email(text) from public, anon, authenticated;
grant execute on function public.platform_find_auth_user_by_email(text) to service_role;

create or replace function public.platform_admin_mutate(
  p_user_id uuid,
  p_session_id uuid,
  p_aal text,
  p_action text,
  p_payload jsonb,
  p_step_up_hash text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reason text := nullif(trim(p_payload->>'reason'), '');
  v_target text;
  v_org_id uuid;
  v_user_id uuid;
  v_owner_user_id uuid;
  v_owner_email text;
  v_org_name text;
  v_org_type text;
  v_plan text;
  v_status text;
  v_slug text;
  v_trial_days integer;
  v_period_end timestamptz;
  v_idempotency_key uuid;
  v_payload_hash text;
  v_existing_operation private.platform_onboarding_operations%rowtype;
  v_announcement_id uuid;
  v_registration_open boolean;
  v_registration_message text;
  v_active_admin_count integer;
begin
  perform private.platform_assert_admin(p_user_id, p_session_id, p_aal);

  if p_action = 'settings.registrations.set' then
    v_target := 'global';
    perform private.platform_consume_step_up(
      p_user_id, p_session_id, p_action, v_target, lower(p_step_up_hash)
    );
    if v_reason is null then raise exception 'PLATFORM_REASON_REQUIRED'; end if;
    if not (p_payload ? 'registrationsOpen') then raise exception 'PLATFORM_INVALID_PAYLOAD'; end if;
    v_registration_open := (p_payload->>'registrationsOpen')::boolean;
    v_registration_message := nullif(trim(p_payload->>'registrationPublicMessage'), '');
    if v_registration_message is null or char_length(v_registration_message) > 500 then
      raise exception 'PLATFORM_INVALID_PUBLIC_MESSAGE';
    end if;

    update private.platform_settings
    set registrations_open = v_registration_open,
        registration_public_message = v_registration_message,
        updated_at = now(),
        updated_by = p_user_id
    where singleton;

    perform private.platform_write_audit(
      p_user_id, p_session_id, p_action, 'platform_settings', v_target,
      'success', v_reason,
      jsonb_build_object('registrationsOpen', v_registration_open)
    );
    return jsonb_build_object(
      'registrationsOpen', v_registration_open,
      'registrationPublicMessage', v_registration_message,
      'updatedAt', now()
    );
  end if;

  if p_action = 'announcements.save' then
    v_announcement_id := nullif(p_payload->>'id', '')::uuid;
    if nullif(trim(p_payload->>'title'), '') is null
       or char_length(trim(p_payload->>'title')) > 120
       or nullif(trim(p_payload->>'body'), '') is null
       or char_length(trim(p_payload->>'body')) > 2000
       or lower(p_payload->>'level') not in ('information', 'warning', 'maintenance')
       or lower(p_payload->>'audience') not in ('organizer', 'public', 'both') then
      raise exception 'PLATFORM_INVALID_ANNOUNCEMENT';
    end if;

    if v_announcement_id is null then
      insert into private.platform_announcements (
        title, body, level, audience, starts_at, ends_at, created_by, updated_by
      ) values (
        trim(p_payload->>'title'),
        trim(p_payload->>'body'),
        lower(p_payload->>'level'),
        lower(p_payload->>'audience'),
        nullif(p_payload->>'startsAt', '')::timestamptz,
        nullif(p_payload->>'endsAt', '')::timestamptz,
        p_user_id,
        p_user_id
      ) returning id into v_announcement_id;
    else
      update private.platform_announcements
      set title = trim(p_payload->>'title'),
          body = trim(p_payload->>'body'),
          level = lower(p_payload->>'level'),
          audience = lower(p_payload->>'audience'),
          starts_at = nullif(p_payload->>'startsAt', '')::timestamptz,
          ends_at = nullif(p_payload->>'endsAt', '')::timestamptz,
          updated_by = p_user_id,
          updated_at = now()
      where id = v_announcement_id
        and status = 'draft';
      if not found then raise exception 'PLATFORM_ANNOUNCEMENT_NOT_EDITABLE'; end if;
    end if;

    perform private.platform_write_audit(
      p_user_id, p_session_id, p_action, 'platform_announcement', v_announcement_id::text,
      'success', v_reason, '{}'::jsonb
    );
    return jsonb_build_object('id', v_announcement_id, 'status', 'draft');
  end if;

  if p_action in ('announcements.publish', 'announcements.retire') then
    v_announcement_id := nullif(p_payload->>'id', '')::uuid;
    v_target := v_announcement_id::text;
    if v_target is null then raise exception 'PLATFORM_INVALID_ANNOUNCEMENT'; end if;
    perform private.platform_consume_step_up(
      p_user_id, p_session_id, p_action, v_target, lower(p_step_up_hash)
    );
    if v_reason is null then raise exception 'PLATFORM_REASON_REQUIRED'; end if;

    if p_action = 'announcements.publish' then
      update private.platform_announcements
      set status = 'retired', retired_at = now(), updated_at = now(), updated_by = p_user_id
      where status = 'published' and id <> v_announcement_id;

      update private.platform_announcements
      set status = 'published',
          published_at = now(),
          published_by = p_user_id,
          retired_at = null,
          updated_at = now(),
          updated_by = p_user_id
      where id = v_announcement_id and status in ('draft', 'retired');
    else
      update private.platform_announcements
      set status = 'retired', retired_at = now(), updated_at = now(), updated_by = p_user_id
      where id = v_announcement_id and status = 'published';
    end if;
    if not found then raise exception 'PLATFORM_ANNOUNCEMENT_STATE_CONFLICT'; end if;

    perform private.platform_write_audit(
      p_user_id, p_session_id, p_action, 'platform_announcement', v_target,
      'success', v_reason, '{}'::jsonb
    );
    return jsonb_build_object(
      'id', v_announcement_id,
      'status', case when p_action = 'announcements.publish' then 'published' else 'retired' end
    );
  end if;

  if p_action = 'organizations.onboard' then
    v_owner_user_id := nullif(p_payload->>'ownerUserId', '')::uuid;
    v_owner_email := nullif(lower(trim(p_payload->>'ownerEmail')), '');
    v_org_name := nullif(trim(p_payload->>'organizationName'), '');
    v_org_type := lower(trim(coalesce(p_payload->>'organizationType', '')));
    v_plan := lower(trim(coalesce(p_payload->>'plan', 'free')));
    v_status := lower(trim(coalesce(p_payload->>'status', 'trial')));
    v_trial_days := least(greatest(coalesce((p_payload->>'trialDays')::integer, 30), 1), 365);
    v_idempotency_key := nullif(p_payload->>'idempotencyKey', '')::uuid;
    v_payload_hash := lower(nullif(p_payload->>'payloadHash', ''));
    v_target := v_owner_email;

    if v_reason is null then raise exception 'PLATFORM_REASON_REQUIRED'; end if;
    if v_owner_user_id is null or v_owner_email is null or v_org_name is null
       or char_length(v_org_name) not between 3 and 120
       or v_org_type not in ('association', 'person')
       or v_plan not in ('free', 'starter', 'pro')
       or v_status not in ('trial', 'active', 'suspended')
       or v_idempotency_key is null
       or char_length(v_payload_hash) <> 64 then
      raise exception 'PLATFORM_INVALID_ONBOARDING';
    end if;

    select * into v_existing_operation
    from private.platform_onboarding_operations
    where idempotency_key = v_idempotency_key;

    if not found then
      raise exception 'PLATFORM_STEP_UP_REQUIRED';
    end if;

    if v_existing_operation.payload_hash <> v_payload_hash
       or v_existing_operation.actor_user_id <> p_user_id
       or v_existing_operation.owner_email <> v_owner_email then
        raise exception 'PLATFORM_IDEMPOTENCY_CONFLICT';
    end if;

    if v_existing_operation.completed_at is not null then
      return jsonb_build_object(
        'organizationId', v_existing_operation.organization_id,
        'replayed', true
      );
    end if;

    if exists (
      select 1 from public.organization_members
      where user_id = v_owner_user_id
    ) then
      raise exception 'PLATFORM_OWNER_ALREADY_MEMBER';
    end if;

    update private.platform_onboarding_operations
    set owner_user_id = v_owner_user_id
    where idempotency_key = v_idempotency_key;

    v_slug := private.generate_unique_org_slug(v_org_name);
    v_period_end := now() + make_interval(days => v_trial_days);

    insert into public.user_profile (user_id, first_name, last_name)
    values (
      v_owner_user_id,
      nullif(trim(p_payload->>'ownerFirstName'), ''),
      nullif(trim(p_payload->>'ownerLastName'), '')
    )
    on conflict (user_id) do update
      set first_name = coalesce(public.user_profile.first_name, excluded.first_name),
          last_name = coalesce(public.user_profile.last_name, excluded.last_name),
          updated_at = now();

    insert into public.organizations (
      type, name, status, created_by, plan, plan_started_at, plan_expires_at
    ) values (
      v_org_type,
      v_org_name,
      v_status,
      v_owner_user_id,
      v_plan,
      now(),
      case when v_plan = 'free' then null else v_period_end end
    ) returning id into v_org_id;

    insert into public.organization_members (org_id, user_id, role)
    values (v_org_id, v_owner_user_id, 'owner');

    insert into public.organization_profile (org_id, slug, display_name)
    values (v_org_id, v_slug, v_org_name);

    if v_plan <> 'free' then
      insert into public.subscriptions (
        org_id, provider, status, current_period_start, current_period_end,
        plan, created_at, updated_at
      ) values (
        v_org_id, 'manual', 'active', now(), v_period_end,
        v_plan, now(), now()
      );
    end if;

    update private.platform_onboarding_operations
    set organization_id = v_org_id, completed_at = now()
    where idempotency_key = v_idempotency_key;

    perform private.platform_write_audit(
      p_user_id, p_session_id, p_action, 'organization', v_org_id::text,
      'success', v_reason,
      jsonb_build_object('ownerUserId', v_owner_user_id, 'plan', v_plan, 'status', v_status)
    );
    return jsonb_build_object('organizationId', v_org_id, 'slug', v_slug, 'replayed', false);
  end if;

  if p_action = 'organizations.status' then
    v_org_id := nullif(p_payload->>'orgId', '')::uuid;
    v_status := lower(trim(coalesce(p_payload->>'status', '')));
    v_target := v_org_id::text;
    perform private.platform_consume_step_up(
      p_user_id, p_session_id, p_action, v_target, lower(p_step_up_hash)
    );
    if v_reason is null then raise exception 'PLATFORM_REASON_REQUIRED'; end if;
    if v_org_id is null or v_status not in ('trial', 'active', 'suspended') then
      raise exception 'PLATFORM_INVALID_ORGANIZATION_STATUS';
    end if;
    update public.organizations
    set status = v_status, updated_at = now()
    where id = v_org_id;
    if not found then raise exception 'PLATFORM_ORGANIZATION_NOT_FOUND'; end if;
    perform private.platform_write_audit(
      p_user_id, p_session_id, p_action, 'organization', v_target,
      'success', v_reason, jsonb_build_object('status', v_status)
    );
    return jsonb_build_object('organizationId', v_org_id, 'status', v_status);
  end if;

  if p_action = 'organizations.plan' then
    v_org_id := nullif(p_payload->>'orgId', '')::uuid;
    v_plan := lower(trim(coalesce(p_payload->>'plan', '')));
    v_trial_days := least(greatest(coalesce((p_payload->>'days')::integer, 30), 1), 3650);
    v_target := v_org_id::text;
    perform private.platform_consume_step_up(
      p_user_id, p_session_id, p_action, v_target, lower(p_step_up_hash)
    );
    if v_reason is null then raise exception 'PLATFORM_REASON_REQUIRED'; end if;
    if v_org_id is null or v_plan not in ('free', 'starter', 'pro') then
      raise exception 'PLATFORM_INVALID_PLAN';
    end if;
    if not exists (select 1 from public.organizations where id = v_org_id) then
      raise exception 'PLATFORM_ORGANIZATION_NOT_FOUND';
    end if;
    if exists (
      select 1 from public.subscriptions
      where org_id = v_org_id and provider <> 'manual'
    ) then
      raise exception 'PLATFORM_PROVIDER_MANAGED_SUBSCRIPTION';
    end if;

    if v_plan = 'free' then
      update public.organizations
      set plan = 'free', plan_started_at = now(), plan_expires_at = null, updated_at = now()
      where id = v_org_id;
      update public.subscriptions
      set provider = 'manual', plan = 'free', status = 'inactive',
          current_period_end = now(), updated_at = now()
      where org_id = v_org_id;
      v_period_end := null;
    else
      v_period_end := now() + make_interval(days => v_trial_days);
      insert into public.subscriptions (
        org_id, provider, status, current_period_start, current_period_end,
        plan, created_at, updated_at
      ) values (
        v_org_id, 'manual', 'active', now(), v_period_end,
        v_plan, now(), now()
      )
      on conflict (org_id) do update
        set provider = 'manual',
            status = 'active',
            current_period_start = now(),
            current_period_end = excluded.current_period_end,
            plan = excluded.plan,
            updated_at = now();
      update public.organizations
      set plan = v_plan, plan_started_at = now(), plan_expires_at = v_period_end, updated_at = now()
      where id = v_org_id;
    end if;

    perform private.platform_write_audit(
      p_user_id, p_session_id, p_action, 'organization', v_target,
      'success', v_reason, jsonb_build_object('plan', v_plan, 'periodEnd', v_period_end)
    );
    return jsonb_build_object('organizationId', v_org_id, 'plan', v_plan, 'periodEnd', v_period_end);
  end if;

  if p_action = 'organizations.owner' then
    v_org_id := nullif(p_payload->>'orgId', '')::uuid;
    v_owner_user_id := nullif(p_payload->>'ownerUserId', '')::uuid;
    v_target := v_org_id::text;
    perform private.platform_consume_step_up(
      p_user_id, p_session_id, p_action, v_target, lower(p_step_up_hash)
    );
    if v_reason is null then raise exception 'PLATFORM_REASON_REQUIRED'; end if;
    if v_org_id is null or v_owner_user_id is null
       or not exists (select 1 from auth.users where id = v_owner_user_id) then
      raise exception 'PLATFORM_INVALID_OWNER';
    end if;
    if not exists (select 1 from public.organizations where id = v_org_id) then
      raise exception 'PLATFORM_ORGANIZATION_NOT_FOUND';
    end if;

    update public.organization_members
    set role = 'admin'
    where org_id = v_org_id and role = 'owner' and user_id <> v_owner_user_id;

    insert into public.organization_members (org_id, user_id, role)
    values (v_org_id, v_owner_user_id, 'owner')
    on conflict (org_id, user_id) do update set role = 'owner';

    update public.organizations
    set created_by = v_owner_user_id, updated_at = now()
    where id = v_org_id;
    if not found then raise exception 'PLATFORM_ORGANIZATION_NOT_FOUND'; end if;

    perform private.platform_write_audit(
      p_user_id, p_session_id, p_action, 'organization', v_target,
      'success', v_reason, jsonb_build_object('ownerUserId', v_owner_user_id)
    );
    return jsonb_build_object('organizationId', v_org_id, 'ownerUserId', v_owner_user_id);
  end if;

  if p_action in ('admins.grant', 'admins.revoke') then
    v_user_id := nullif(p_payload->>'userId', '')::uuid;
    v_target := case
      when p_action = 'admins.grant' then nullif(lower(trim(p_payload->>'email')), '')
      else v_user_id::text
    end;
    perform private.platform_consume_step_up(
      p_user_id, p_session_id, p_action, v_target, lower(p_step_up_hash)
    );
    if v_reason is null then raise exception 'PLATFORM_REASON_REQUIRED'; end if;
    if v_user_id is null or not exists (select 1 from auth.users where id = v_user_id) then
      raise exception 'PLATFORM_INVALID_ADMIN';
    end if;

    if p_action = 'admins.grant' then
      insert into private.platform_admins (user_id, granted_at, granted_by, revoked_at, note)
      values (v_user_id, now(), p_user_id, null, nullif(trim(p_payload->>'note'), ''))
      on conflict (user_id) do update
        set granted_at = now(),
            granted_by = p_user_id,
            revoked_at = null,
            note = excluded.note;
    else
      if v_user_id = p_user_id then raise exception 'PLATFORM_CANNOT_REVOKE_SELF'; end if;
      perform pg_advisory_xact_lock(hashtext('eventflow:platform-admin-revoke'));
      select count(*)::integer into v_active_admin_count
      from private.platform_admins where revoked_at is null;
      if v_active_admin_count <= 1 then raise exception 'PLATFORM_LAST_ADMIN'; end if;
      update private.platform_admins
      set revoked_at = now(), note = coalesce(nullif(trim(p_payload->>'note'), ''), note)
      where user_id = v_user_id and revoked_at is null;
      if not found then raise exception 'PLATFORM_ADMIN_NOT_ACTIVE'; end if;
    end if;

    perform private.platform_write_audit(
      p_user_id, p_session_id, p_action, 'platform_admin', v_target,
      'success', v_reason, '{}'::jsonb
    );
    return jsonb_build_object(
      'userId', v_user_id,
      'active', p_action = 'admins.grant'
    );
  end if;

  if p_action = 'invitations.authorize' then
    v_target := nullif(lower(trim(p_payload->>'email')), '');
    perform private.platform_consume_step_up(
      p_user_id, p_session_id, p_action, v_target, lower(p_step_up_hash)
    );
    if v_reason is null then raise exception 'PLATFORM_REASON_REQUIRED'; end if;
    perform private.platform_write_audit(
      p_user_id, p_session_id, p_action, 'auth_user', v_target,
      'success', v_reason, jsonb_build_object('authorized', true)
    );
    return jsonb_build_object('authorized', true);
  end if;

  if p_action = 'external.audit' then
    perform private.platform_write_audit(
      p_user_id,
      p_session_id,
      coalesce(nullif(p_payload->>'externalAction', ''), 'external.unknown'),
      coalesce(nullif(p_payload->>'targetType', ''), 'external'),
      nullif(p_payload->>'targetId', ''),
      case when (p_payload->>'success')::boolean then 'success' else 'failure' end,
      v_reason,
      coalesce(p_payload->'metadata', '{}'::jsonb)
    );
    return jsonb_build_object('logged', true);
  end if;

  raise exception 'PLATFORM_ACTION_NOT_FOUND';
end;
$$;

revoke all on function public.platform_admin_mutate(uuid, uuid, text, text, jsonb, text) from public, anon, authenticated;
grant execute on function public.platform_admin_mutate(uuid, uuid, text, text, jsonb, text) to service_role;

-- Global registration closure is authoritative in both display logic and the
-- order Edge Function. Keeping it here also makes existing public event RPCs
-- report a closed state while the platform is in maintenance.
create or replace function public.is_event_registration_open(p_event_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    coalesce((
      select ps.registrations_open
      from private.platform_settings ps
      where ps.singleton
    ), false)
    and exists (
      select 1
      from public.events e
      join public.organizations o on o.id = e.org_id
      where e.id = p_event_id
        and e.is_published = true
        and o.status in ('trial', 'active')
        and e.starts_at > now()
        and (
          e.registration_deadline is null
          or e.registration_deadline > now()
        )
    )
    and not public.is_event_sold_out(p_event_id);
$$;

revoke all on function public.is_event_registration_open(uuid) from public;
grant execute on function public.is_event_registration_open(uuid) to anon, authenticated, service_role;
