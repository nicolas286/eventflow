-- Secure platform communications: organization email campaigns are private,
-- auditable and can only be orchestrated by the platform-admin Edge Function.

create table private.platform_email_campaigns (
  id uuid primary key default gen_random_uuid(),
  idempotency_key uuid not null unique,
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  actor_session_id uuid not null,
  target_type text not null,
  organization_id uuid references public.organizations(id) on delete restrict,
  subject text not null,
  body text not null,
  reason text not null,
  status text not null default 'sending',
  recipient_count integer not null default 0,
  sent_count integer not null default 0,
  failed_count integer not null default 0,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint platform_email_campaign_target_check check (
    (target_type = 'all' and organization_id is null)
    or (target_type = 'organization' and organization_id is not null)
  ),
  constraint platform_email_campaign_subject_length check (
    char_length(subject) between 1 and 160
    and position(E'\n' in subject) = 0
    and position(E'\r' in subject) = 0
  ),
  constraint platform_email_campaign_body_length check (char_length(body) between 1 and 10000),
  constraint platform_email_campaign_reason_length check (char_length(reason) between 3 and 1000),
  constraint platform_email_campaign_status_check check (status in ('sending', 'completed', 'partial', 'failed')),
  constraint platform_email_campaign_counts_check check (
    recipient_count between 0 and 100
    and sent_count between 0 and recipient_count
    and failed_count between 0 and recipient_count
  )
);

create table private.platform_email_deliveries (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references private.platform_email_campaigns(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete restrict,
  recipient_user_id uuid references auth.users(id) on delete set null,
  recipient_email text not null,
  status text not null default 'pending',
  provider text,
  provider_message_id text,
  error_code text,
  attempts integer not null default 0,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  constraint platform_email_delivery_email_length check (char_length(recipient_email) between 3 and 320),
  constraint platform_email_delivery_status_check check (status in ('pending', 'sent', 'failed')),
  constraint platform_email_delivery_provider_length check (provider is null or char_length(provider) <= 40),
  constraint platform_email_delivery_message_id_length check (provider_message_id is null or char_length(provider_message_id) <= 320),
  constraint platform_email_delivery_error_length check (error_code is null or char_length(error_code) <= 120),
  constraint platform_email_delivery_attempts_check check (attempts between 0 and 10),
  unique (campaign_id, recipient_email)
);

alter table private.platform_email_campaigns enable row level security;
alter table private.platform_email_campaigns force row level security;
alter table private.platform_email_deliveries enable row level security;
alter table private.platform_email_deliveries force row level security;

revoke all on table private.platform_email_campaigns from public, anon, authenticated;
revoke all on table private.platform_email_deliveries from public, anon, authenticated;

create index platform_email_campaigns_created_idx
  on private.platform_email_campaigns (created_at desc);
create index platform_email_deliveries_campaign_status_idx
  on private.platform_email_deliveries (campaign_id, status, created_at);

create or replace function public.platform_admin_create_email_campaign(
  p_user_id uuid,
  p_session_id uuid,
  p_aal text,
  p_payload jsonb,
  p_step_up_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_idempotency_key uuid;
  v_target_type text := lower(trim(coalesce(p_payload->>'target', '')));
  v_org_id uuid;
  v_target_id text;
  v_subject text := nullif(trim(p_payload->>'subject'), '');
  v_body text := nullif(trim(p_payload->>'body'), '');
  v_reason text := nullif(trim(p_payload->>'reason'), '');
  v_campaign private.platform_email_campaigns%rowtype;
  v_recipient_count integer;
begin
  perform private.platform_assert_admin(p_user_id, p_session_id, p_aal);

  begin
    v_idempotency_key := nullif(p_payload->>'idempotencyKey', '')::uuid;
    v_org_id := nullif(p_payload->>'organizationId', '')::uuid;
  exception when invalid_text_representation then
    raise exception 'PLATFORM_INVALID_EMAIL_CAMPAIGN';
  end;

  if v_target_type not in ('all', 'organization')
     or (v_target_type = 'all' and v_org_id is not null)
     or (v_target_type = 'organization' and v_org_id is null)
     or v_idempotency_key is null
     or v_subject is null or char_length(v_subject) > 160
     or position(E'\n' in v_subject) > 0 or position(E'\r' in v_subject) > 0
     or v_body is null or char_length(v_body) > 10000
     or v_reason is null or char_length(v_reason) > 1000 then
    raise exception 'PLATFORM_INVALID_EMAIL_CAMPAIGN';
  end if;

  v_target_id := case when v_target_type = 'all' then 'all-organizations' else v_org_id::text end;

  perform private.platform_consume_step_up(
    p_user_id,
    p_session_id,
    'communications.email.send',
    v_target_id,
    lower(p_step_up_hash)
  );

  select * into v_campaign
  from private.platform_email_campaigns
  where idempotency_key = v_idempotency_key;

  if found then
    if v_campaign.actor_user_id <> p_user_id
       or v_campaign.target_type <> v_target_type
       or v_campaign.organization_id is distinct from v_org_id
       or v_campaign.subject <> v_subject
       or v_campaign.body <> v_body
       or v_campaign.reason <> v_reason then
      raise exception 'PLATFORM_IDEMPOTENCY_CONFLICT';
    end if;

    return jsonb_build_object(
      'id', v_campaign.id,
      'status', v_campaign.status,
      'recipientCount', v_campaign.recipient_count,
      'sentCount', v_campaign.sent_count,
      'failedCount', v_campaign.failed_count,
      'createdAt', v_campaign.created_at,
      'completedAt', v_campaign.completed_at
    );
  end if;

  if v_org_id is not null and not exists (
    select 1 from public.organizations where id = v_org_id
  ) then
    raise exception 'PLATFORM_ORGANIZATION_NOT_FOUND';
  end if;

  with recipients as (
    select distinct on (lower(owner.email))
      organization.id as org_id,
      owner.user_id,
      lower(owner.email) as email
    from public.organizations organization
    join lateral (
      select u.id as user_id, u.email
      from public.organization_members om
      join auth.users u on u.id = om.user_id
      where om.org_id = organization.id
        and om.role = 'owner'
        and u.email is not null
        and u.email_confirmed_at is not null
        and u.deleted_at is null
        and (u.banned_until is null or u.banned_until < now())
      order by om.created_at, u.id
      limit 1
    ) owner on true
    where v_org_id is null or organization.id = v_org_id
    order by lower(owner.email), organization.created_at, organization.id
  )
  select count(*)::integer into v_recipient_count from recipients;

  if v_recipient_count = 0 then
    raise exception 'PLATFORM_EMAIL_NO_RECIPIENTS';
  end if;
  if v_recipient_count > 100 then
    raise exception 'PLATFORM_EMAIL_RECIPIENT_LIMIT';
  end if;

  insert into private.platform_email_campaigns (
    idempotency_key,
    actor_user_id,
    actor_session_id,
    target_type,
    organization_id,
    subject,
    body,
    reason,
    recipient_count
  ) values (
    v_idempotency_key,
    p_user_id,
    p_session_id,
    v_target_type,
    v_org_id,
    v_subject,
    v_body,
    v_reason,
    v_recipient_count
  ) returning * into v_campaign;

  insert into private.platform_email_deliveries (
    campaign_id,
    organization_id,
    recipient_user_id,
    recipient_email
  )
  select
    v_campaign.id,
    recipient.org_id,
    recipient.user_id,
    recipient.email
  from (
    select distinct on (lower(owner.email))
      organization.id as org_id,
      owner.user_id,
      lower(owner.email) as email
    from public.organizations organization
    join lateral (
      select u.id as user_id, u.email
      from public.organization_members om
      join auth.users u on u.id = om.user_id
      where om.org_id = organization.id
        and om.role = 'owner'
        and u.email is not null
        and u.email_confirmed_at is not null
        and u.deleted_at is null
        and (u.banned_until is null or u.banned_until < now())
      order by om.created_at, u.id
      limit 1
    ) owner on true
    where v_org_id is null or organization.id = v_org_id
    order by lower(owner.email), organization.created_at, organization.id
  ) recipient;

  perform private.platform_write_audit(
    p_user_id,
    p_session_id,
    'communications.email.queue',
    'email_campaign',
    v_campaign.id::text,
    'success',
    v_reason,
    jsonb_build_object(
      'target', v_target_type,
      'organizationId', v_org_id,
      'recipientCount', v_recipient_count,
      'phase', 'queued'
    )
  );

  return jsonb_build_object(
    'id', v_campaign.id,
    'status', v_campaign.status,
    'recipientCount', v_campaign.recipient_count,
    'sentCount', v_campaign.sent_count,
    'failedCount', v_campaign.failed_count,
    'createdAt', v_campaign.created_at,
    'completedAt', v_campaign.completed_at
  );
end;
$$;

create or replace function public.platform_admin_read_email_campaigns(
  p_user_id uuid,
  p_session_id uuid,
  p_aal text,
  p_limit integer default 30
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
  v_limit integer := least(greatest(coalesce(p_limit, 30), 1), 100);
begin
  perform private.platform_assert_admin(p_user_id, p_session_id, p_aal);

  select jsonb_build_object(
    'items', coalesce(jsonb_agg(jsonb_build_object(
      'id', campaign.id,
      'target', campaign.target_type,
      'organizationId', campaign.organization_id,
      'organizationName', organization.name,
      'subject', campaign.subject,
      'status', campaign.status,
      'recipientCount', campaign.recipient_count,
      'sentCount', campaign.sent_count,
      'failedCount', campaign.failed_count,
      'reason', campaign.reason,
      'actorEmail', actor.email,
      'createdAt', campaign.created_at,
      'completedAt', campaign.completed_at
    ) order by campaign.created_at desc), '[]'::jsonb)
  ) into v_result
  from (
    select *
    from private.platform_email_campaigns
    order by created_at desc
    limit v_limit
  ) campaign
  left join public.organizations organization on organization.id = campaign.organization_id
  join auth.users actor on actor.id = campaign.actor_user_id;

  return v_result;
end;
$$;

create or replace function public.platform_admin_email_campaign_deliveries(
  p_campaign_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', campaign.id,
    'subject', campaign.subject,
    'body', campaign.body,
    'deliveries', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', delivery.id,
        'email', delivery.recipient_email,
        'organizationId', delivery.organization_id,
        'organizationName', organization.name
      ) order by delivery.created_at, delivery.id)
      from private.platform_email_deliveries delivery
      join public.organizations organization on organization.id = delivery.organization_id
      where delivery.campaign_id = campaign.id
        and delivery.status = 'pending'
    ), '[]'::jsonb)
  )
  from private.platform_email_campaigns campaign
  where campaign.id = p_campaign_id;
$$;

create or replace function public.platform_admin_record_email_delivery(
  p_campaign_id uuid,
  p_delivery_id uuid,
  p_success boolean,
  p_provider text default null,
  p_provider_message_id text default null,
  p_error_code text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update private.platform_email_deliveries
  set
    status = case when p_success then 'sent' else 'failed' end,
    provider = case when p_success then left(nullif(trim(p_provider), ''), 40) else null end,
    provider_message_id = case when p_success then left(nullif(trim(p_provider_message_id), ''), 320) else null end,
    error_code = case when p_success then null else left(coalesce(nullif(trim(p_error_code), ''), 'MAIL_SERVICE_FAILED'), 120) end,
    attempts = attempts + 1,
    sent_at = case when p_success then now() else null end
  where id = p_delivery_id
    and campaign_id = p_campaign_id
    and status = 'pending';

  if not found then
    raise exception 'PLATFORM_EMAIL_DELIVERY_NOT_FOUND';
  end if;
end;
$$;

create or replace function public.platform_admin_finish_email_campaign(
  p_campaign_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_campaign private.platform_email_campaigns%rowtype;
  v_previous_status text;
  v_sent integer;
  v_failed integer;
  v_pending integer;
  v_status text;
begin
  select status into v_previous_status
  from private.platform_email_campaigns
  where id = p_campaign_id;

  if v_previous_status is null then
    raise exception 'PLATFORM_EMAIL_CAMPAIGN_NOT_FOUND';
  end if;

  select
    count(*) filter (where status = 'sent')::integer,
    count(*) filter (where status = 'failed')::integer,
    count(*) filter (where status = 'pending')::integer
  into v_sent, v_failed, v_pending
  from private.platform_email_deliveries
  where campaign_id = p_campaign_id;

  if v_sent + v_failed + v_pending = 0 then
    raise exception 'PLATFORM_EMAIL_CAMPAIGN_NOT_FOUND';
  end if;

  v_status := case
    when v_pending > 0 then 'sending'
    when v_sent > 0 and v_failed = 0 then 'completed'
    when v_sent > 0 and v_failed > 0 then 'partial'
    else 'failed'
  end;

  update private.platform_email_campaigns
  set
    status = v_status,
    sent_count = v_sent,
    failed_count = v_failed,
    completed_at = case when v_pending = 0 then now() else null end
  where id = p_campaign_id
  returning * into v_campaign;

  if v_previous_status = 'sending' and v_pending = 0 then
    perform private.platform_write_audit(
      v_campaign.actor_user_id,
      v_campaign.actor_session_id,
      'communications.email.send',
      'email_campaign',
      v_campaign.id::text,
      case when v_failed = 0 then 'success' else 'failure' end,
      v_campaign.reason,
      jsonb_build_object(
        'status', v_status,
        'recipientCount', v_campaign.recipient_count,
        'sentCount', v_sent,
        'failedCount', v_failed
      )
    );
  end if;

  return jsonb_build_object(
    'id', v_campaign.id,
    'status', v_campaign.status,
    'recipientCount', v_campaign.recipient_count,
    'sentCount', v_campaign.sent_count,
    'failedCount', v_campaign.failed_count,
    'createdAt', v_campaign.created_at,
    'completedAt', v_campaign.completed_at
  );
end;
$$;

revoke all on function public.platform_admin_create_email_campaign(uuid, uuid, text, jsonb, text) from public, anon, authenticated;
revoke all on function public.platform_admin_read_email_campaigns(uuid, uuid, text, integer) from public, anon, authenticated;
revoke all on function public.platform_admin_email_campaign_deliveries(uuid) from public, anon, authenticated;
revoke all on function public.platform_admin_record_email_delivery(uuid, uuid, boolean, text, text, text) from public, anon, authenticated;
revoke all on function public.platform_admin_finish_email_campaign(uuid) from public, anon, authenticated;

grant execute on function public.platform_admin_create_email_campaign(uuid, uuid, text, jsonb, text) to service_role;
grant execute on function public.platform_admin_read_email_campaigns(uuid, uuid, text, integer) to service_role;
grant execute on function public.platform_admin_email_campaign_deliveries(uuid) to service_role;
grant execute on function public.platform_admin_record_email_delivery(uuid, uuid, boolean, text, text, text) to service_role;
grant execute on function public.platform_admin_finish_email_campaign(uuid) to service_role;
