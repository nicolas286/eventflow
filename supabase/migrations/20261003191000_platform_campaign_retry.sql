-- D5: bounded replay using the campaign's existing immutable idempotency key.
begin;
alter table private.platform_email_deliveries
  add column claim_token uuid,
  add column claimed_at timestamptz,
  add column first_attempt_at timestamptz,
  add column retry_after timestamptz,
  add column organization_name text;
-- Historical attempts have no exact dispatch timestamp. The campaign creation
-- is a conservative bound; never renew an already expired provider key window.
update private.platform_email_deliveries set first_attempt_at=created_at where attempts > 0;

create or replace function public.platform_admin_email_campaign_deliveries(p_campaign_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_campaign private.platform_email_campaigns%rowtype; v_deliveries jsonb;
begin
  select * into v_campaign from private.platform_email_campaigns where id = p_campaign_id for update;
  if not found then raise exception 'PLATFORM_EMAIL_CAMPAIGN_NOT_FOUND'; end if;
  update private.platform_email_deliveries set status='failed', error_code='RETRY_EXHAUSTED', claim_token=null, claimed_at=null
  where campaign_id=p_campaign_id and status='pending'
    and (attempts >= 3 or first_attempt_at <= now()-interval '23 hours')
    and (claim_token is null or claimed_at < now()-interval '10 minutes');
  with eligible as (
    select d.id from private.platform_email_deliveries d
    where d.campaign_id = p_campaign_id and d.status in ('pending', 'failed')
      and d.attempts < 3
      and (d.first_attempt_at is null or d.first_attempt_at > now() - interval '23 hours')
      and (d.retry_after is null or d.retry_after <= now())
      and (d.claim_token is null or d.claimed_at < now() - interval '10 minutes')
    order by d.created_at, d.id limit 100 for update skip locked
  ), claimed as (
    update private.platform_email_deliveries d
    set claim_token = gen_random_uuid(), claimed_at = now(), status = 'pending',
        first_attempt_at = coalesce(d.first_attempt_at, now()), attempts = d.attempts + 1,
        organization_name = coalesce(d.organization_name, o.name)
    from eligible e, public.organizations o where d.id = e.id and o.id = d.organization_id
    returning d.*
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', id, 'email', recipient_email, 'organizationId', organization_id,
    'organizationName', organization_name, 'claimToken', claim_token
  ) order by created_at, id), '[]'::jsonb) into v_deliveries from claimed;
  if jsonb_array_length(v_deliveries) > 0 then
    update private.platform_email_campaigns set status='sending', completed_at=null where id=p_campaign_id;
    perform private.platform_write_audit(v_campaign.actor_user_id, v_campaign.actor_session_id,
      'communications.email.claim', 'email_campaign', p_campaign_id::text, 'success', v_campaign.reason,
      jsonb_build_object('deliveryCount', jsonb_array_length(v_deliveries)));
  end if;
  return jsonb_build_object('id', v_campaign.id, 'subject', v_campaign.subject,
    'body', v_campaign.body, 'deliveries', v_deliveries);
end;
$$;

create or replace function public.platform_admin_complete_email_delivery(
  p_campaign_id uuid, p_delivery_id uuid, p_claim_token uuid, p_success boolean,
  p_provider text default null, p_provider_message_id text default null, p_error_code text default null
) returns boolean language plpgsql security definer set search_path = '' as $$
declare v_campaign private.platform_email_campaigns%rowtype;
begin
  select * into v_campaign from private.platform_email_campaigns where id=p_campaign_id for update;
  update private.platform_email_deliveries set
    status=case when p_success then 'sent' else 'failed' end,
    provider=case when p_success then left(nullif(trim(p_provider), ''), 40) else null end,
    provider_message_id=case when p_success then left(nullif(trim(p_provider_message_id), ''), 320) else null end,
    error_code=case when p_success then null else left(coalesce(nullif(trim(p_error_code), ''), 'MAIL_SERVICE_FAILED'),120) end,
    sent_at=case when p_success then now() else null end,
    retry_after=case when p_success then null else now()+interval '1 minute' end,
    claim_token=null, claimed_at=null
  where campaign_id=p_campaign_id and id=p_delivery_id and claim_token=p_claim_token and status='pending';
  if not found then return false; end if;
  perform private.platform_write_audit(v_campaign.actor_user_id, v_campaign.actor_session_id,
    'communications.email.delivery', 'email_delivery', p_delivery_id::text,
    case when p_success then 'success' else 'failure' end, v_campaign.reason,
    jsonb_build_object('campaignId',p_campaign_id,'errorCode',case when p_success then null else 'MAIL_SERVICE_FAILED' end));
  return true;
end;
$$;
revoke all on function public.platform_admin_email_campaign_deliveries(uuid) from public, anon, authenticated;
revoke all on function public.platform_admin_complete_email_delivery(uuid, uuid, uuid, boolean, text, text, text) from public, anon, authenticated;
grant execute on function public.platform_admin_email_campaign_deliveries(uuid) to service_role;
grant execute on function public.platform_admin_complete_email_delivery(uuid, uuid, uuid, boolean, text, text, text) to service_role;
-- The unfenced writer must never finish a newly leased delivery.
revoke execute on function public.platform_admin_record_email_delivery(uuid, uuid, boolean, text, text, text) from service_role;
-- B6's deferred broad service grant must not reactivate this obsolete writer.
create or replace function public.platform_admin_record_email_delivery(
  p_campaign_id uuid, p_delivery_id uuid, p_success boolean,
  p_provider text default null, p_provider_message_id text default null, p_error_code text default null
) returns void language plpgsql security definer set search_path = '' as $$
begin
  raise exception 'PLATFORM_EMAIL_DELIVERY_CLAIM_REQUIRED';
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
  where id = p_campaign_id for update;

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

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_idempotency_key::text, 0));
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


commit;
