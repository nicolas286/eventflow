-- D3: serialize replay before checking completion and owner membership.
-- Original actor/session, step-up, payload hash and uniqueness checks retained.
begin;
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
    where idempotency_key = v_idempotency_key
    for update;

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

  insert into private.platform_onboarding_operations (
    idempotency_key, actor_user_id, owner_email, payload_hash
  ) values (p_idempotency_key, p_user_id, v_email, lower(p_payload_hash))
  on conflict (idempotency_key) do nothing;

  select * into v_existing from private.platform_onboarding_operations
  where idempotency_key = p_idempotency_key for update;
  if v_existing.actor_user_id <> p_user_id
     or v_existing.owner_email <> v_email
     or v_existing.payload_hash <> lower(p_payload_hash) then
    raise exception 'PLATFORM_IDEMPOTENCY_CONFLICT';
  end if;

  return jsonb_build_object('authorized', true, 'completed', v_existing.completed_at is not null);
end;
$$;

revoke all on function public.platform_admin_authorize_onboarding(uuid, uuid, text, uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.platform_admin_authorize_onboarding(uuid, uuid, text, uuid, text, text, text) to service_role;


commit;
