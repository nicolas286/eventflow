-- B1.1 additive server-only operations. Membership/role authorization lives in
-- the organizations Edge; p_actor_id is its verified Auth user, never browser input.
-- Keep legacy RPCs and table permissions until the migrated frontend is published
-- and the separate deferred closure is applied. No existing rows are rewritten.
BEGIN;

create or replace function public.organizer_create_organization(
  p_actor_id uuid,
  p_input jsonb
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_user_id uuid := p_actor_id;
  v_org_id uuid;

  v_type text;
  v_name text;
  v_slug text;
begin
  -- ---------------------------------------------------------------------------
  -- Auth
  -- ---------------------------------------------------------------------------

  if v_user_id is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  if p_input is null or jsonb_typeof(p_input) <> 'object' then
    raise exception 'VALIDATION_ERROR: invalid organization fields';
  end if;
  if exists (
    select 1 from jsonb_object_keys(p_input) key where key not in ('type', 'name')
  ) then
    raise exception 'VALIDATION_ERROR: invalid organization fields';
  end if;

  -- ---------------------------------------------------------------------------
  -- Rate limit
  -- ---------------------------------------------------------------------------

  perform public.assert_rate_limit(
    'create_org:user:' || v_user_id::text,
    3,
    3600
  );

  -- ---------------------------------------------------------------------------
  -- Input parsing
  -- ---------------------------------------------------------------------------

  v_type := nullif(trim(p_input->>'type'), '');
  v_name := nullif(trim(p_input->>'name'), '');

  -- ---------------------------------------------------------------------------
  -- Validation
  -- ---------------------------------------------------------------------------

  if v_type is null then
    raise exception 'VALIDATION_ERROR: type is required';
  end if;

  if v_type not in ('association', 'person') then
    raise exception 'VALIDATION_ERROR: invalid type';
  end if;

  if v_name is null then
    raise exception 'VALIDATION_ERROR: name is required';
  end if;

  if length(v_name) < 3 or length(v_name) > 120 then
    raise exception 'VALIDATION_ERROR: name must be between 3 and 120 characters';
  end if;

  -- ---------------------------------------------------------------------------
  -- Slug
  -- ---------------------------------------------------------------------------

  v_slug := private.generate_unique_org_slug(v_name);

  -- ---------------------------------------------------------------------------
  -- Organization
  -- ---------------------------------------------------------------------------

  insert into public.organizations (
    type,
    name,
    created_by
  )
  values (
    v_type,
    v_name,
    v_user_id
  )
  returning id into v_org_id;

  -- ---------------------------------------------------------------------------
  -- Owner membership
  -- ---------------------------------------------------------------------------

  insert into public.organization_members (
    org_id,
    user_id,
    role
  )
  values (
    v_org_id,
    v_user_id,
    'owner'
  );

  -- ---------------------------------------------------------------------------
  -- Public profile
  -- ---------------------------------------------------------------------------

  insert into public.organization_profile (
    org_id,
    slug,
    display_name
  )
  values (
    v_org_id,
    v_slug,
    v_name
  );

  return v_org_id;

exception
  when unique_violation then
    raise exception 'CONFLICT';
end;
$$;

REVOKE ALL ON FUNCTION public.organizer_create_organization(uuid,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.organizer_create_organization(uuid,jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.organizer_update_organization(p_actor_id uuid, p_input jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, private
AS $$
declare
  v_user_id uuid := p_actor_id;

  v_org_id uuid;

  -- current
  v_cur_name text;

  -- patch values
  v_type text;
  v_name text;
  v_status text;

  v_description text;
  v_public_email text;
  v_phone text;
  v_website text;
  v_email_reminder_days_before int;

  -- flags presence
  has_type boolean := false;
  has_name boolean := false;
  has_status boolean := false;

  has_description boolean := false;
  has_public_email boolean := false;
  has_phone boolean := false;
  has_website boolean := false;

  has_email_reminder_days_before boolean := false;

  v_new_slug text;

  v_result jsonb;
begin
  -- 1) Auth
  if v_user_id is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  if p_input is null or jsonb_typeof(p_input) <> 'object' then
    raise exception 'VALIDATION_ERROR: invalid organization fields';
  end if;
  if exists (
    select 1 from jsonb_object_keys(p_input) key
    where key not in ('org_id', 'type', 'name', 'status', 'description', 'public_email', 'phone', 'website', 'email_reminder_days_before')
  ) then
    raise exception 'VALIDATION_ERROR: invalid organization fields';
  end if;

  -- 2) org_id
  v_org_id := nullif(trim(p_input->>'org_id'), '')::uuid;

  if v_org_id is null then
    raise exception 'VALIDATION_ERROR: org_id is required';
  end if;

  -- Membership and role authorization are performed by the Edge.

  -- 4) Rate limit
  perform private.assert_rate_limit(
    'update_org:user:' || v_user_id::text || ':org:' || v_org_id::text,
    60,
    60
  );

  -- 5) Load current
  select o.name into v_cur_name
  from public.organizations o
  where o.id = v_org_id
  limit 1;

  if v_cur_name is null then
    raise exception 'NOT_FOUND';
  end if;

  -- 6) Parse patch + mark present
  if p_input ? 'type' then
    has_type := true;
    v_type := nullif(trim(p_input->>'type'), '');
  end if;

  if p_input ? 'name' then
    has_name := true;
    v_name := nullif(trim(p_input->>'name'), '');
  end if;

  if p_input ? 'status' then
    has_status := true;
    v_status := nullif(trim(p_input->>'status'), '');
  end if;

  if p_input ? 'description' then
    has_description := true;
    v_description := nullif(trim(p_input->>'description'), '');
  end if;

  if p_input ? 'public_email' then
    has_public_email := true;
    v_public_email := nullif(trim(p_input->>'public_email'), '');
  end if;

  if p_input ? 'phone' then
    has_phone := true;
    v_phone := nullif(trim(p_input->>'phone'), '');
  end if;

  if p_input ? 'website' then
    has_website := true;
    v_website := nullif(trim(p_input->>'website'), '');
  end if;

  if p_input ? 'email_reminder_days_before' then
    has_email_reminder_days_before := true;

    if nullif(trim(p_input->>'email_reminder_days_before'), '') is null then
      v_email_reminder_days_before := null;
    else
      v_email_reminder_days_before := (p_input->>'email_reminder_days_before')::int;
    end if;
  end if;

  -- 7) Validations
  if has_type then
    if v_type is null then
      raise exception 'VALIDATION_ERROR: type cannot be empty';
    end if;

    if v_type not in ('association', 'person') then
      raise exception 'VALIDATION_ERROR: invalid type';
    end if;
  end if;

  if has_name then
    if v_name is null then
      raise exception 'VALIDATION_ERROR: name cannot be empty';
    end if;

    if length(v_name) < 3 then
      raise exception 'VALIDATION_ERROR: name too short';
    end if;

    if length(v_name) > 120 then
      raise exception 'VALIDATION_ERROR: name too long';
    end if;
  end if;

  if has_status then
    if v_status is null then
      raise exception 'VALIDATION_ERROR: status cannot be empty';
    end if;

    if v_status not in ('active', 'suspended') then
      raise exception 'VALIDATION_ERROR: invalid status';
    end if;
  end if;

  if has_description and v_description is not null and length(v_description) > 1000 then
    raise exception 'VALIDATION_ERROR: description too long';
  end if;

  if has_public_email and v_public_email is not null and length(v_public_email) > 254 then
    raise exception 'VALIDATION_ERROR: public_email too long';
  end if;

  if has_phone and v_phone is not null then
    if length(v_phone) < 3 then
      raise exception 'VALIDATION_ERROR: phone too short';
    end if;

    if length(v_phone) > 32 then
      raise exception 'VALIDATION_ERROR: phone too long';
    end if;
  end if;

  if has_website and v_website is not null then
    if length(v_website) < 5 then
      raise exception 'VALIDATION_ERROR: website too short';
    end if;

    if length(v_website) > 2048 then
      raise exception 'VALIDATION_ERROR: website too long';
    end if;
  end if;

  if has_email_reminder_days_before
    and v_email_reminder_days_before is not null
    and v_email_reminder_days_before < 0 then
    raise exception 'VALIDATION_ERROR: email_reminder_days_before must be >= 0';
  end if;

  -- 8) Update organizations
  if has_type or has_name or has_status then
    update public.organizations o
    set
      type = case when has_type then v_type else o.type end,
      name = case when has_name then v_name else o.name end,
      status = case when has_status then v_status else o.status end,
      updated_at = now()
    where o.id = v_org_id;
  end if;

  -- 9) Slug recalculation
  if has_name and v_name is distinct from v_cur_name then
    v_new_slug := private.generate_unique_org_slug(v_name);
    perform set_config('app.allow_org_profile_slug_change', 'on', true);
  end if;

  -- 10) Update organization_profile
  if has_name
    or has_description
    or has_public_email
    or has_phone
    or has_website
    or has_email_reminder_days_before then

    update public.organization_profile op
    set
      slug = case
        when has_name and v_name is distinct from v_cur_name then v_new_slug
        else op.slug
      end,

      display_name = case
        when has_name then v_name
        else op.display_name
      end,

      description = case
        when has_description then v_description
        else op.description
      end,

      public_email = case
        when has_public_email then v_public_email
        else op.public_email
      end,

      phone = case
        when has_phone then v_phone
        else op.phone
      end,

      website = case
        when has_website then v_website
        else op.website
      end,

      email_reminder_days_before = case
        when has_email_reminder_days_before then v_email_reminder_days_before
        else op.email_reminder_days_before
      end,

      updated_at = now()
    where op.org_id = v_org_id;
  end if;

  -- 11) Return payload
  select jsonb_build_object(
    'orgId', o.id,
    'type', o.type,
    'name', o.name,
    'status', o.status,
    'paymentStatus', o.payments_status,
    'paymentsLiveReady', o.payments_live_ready,
    'profile', jsonb_build_object(
      'slug', op.slug,
      'displayName', op.display_name,
      'description', op.description,
      'publicEmail', op.public_email,
      'phone', op.phone,
      'website', op.website,
      'emailReminderDaysBefore', op.email_reminder_days_before
    )
  )
  into v_result
  from public.organizations o
  join public.organization_profile op on op.org_id = o.id
  where o.id = v_org_id;

  return v_result;

exception
  when unique_violation then
    raise exception 'CONFLICT';

  when invalid_text_representation then
    raise exception 'VALIDATION_ERROR: invalid input format';

  when invalid_parameter_value then
    raise exception 'VALIDATION_ERROR: invalid input value';
end;
$$;

REVOKE ALL ON FUNCTION public.organizer_update_organization(uuid,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.organizer_update_organization(uuid,jsonb) TO service_role;

create or replace function public.organizer_update_seller_identity(
 p_actor_id uuid, p_org_id uuid, p_legal_name text, p_address text, p_business_number text,
 p_seller_type text, p_phone text
) returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_profile public.organization_profile%rowtype;
begin
 if p_actor_id is null then raise exception 'NOT_AUTHENTICATED'; end if;
 if char_length(trim(coalesce(p_legal_name,''))) not between 2 and 200
 or char_length(trim(coalesce(p_address,''))) not between 8 and 500
 or char_length(trim(coalesce(p_phone,''))) not between 6 and 32
 or p_seller_type is null or p_seller_type not in ('professional','non_professional')
 or char_length(coalesce(p_business_number,'')) > 100 then raise exception 'SELLER_IDENTITY_INVALID'; end if;
 update public.organization_profile set seller_legal_name=trim(p_legal_name), seller_address=trim(p_address),
 seller_business_number=nullif(trim(p_business_number),''), seller_type=p_seller_type, phone=trim(p_phone),
 sales_terms_version=case when (seller_legal_name,seller_address,seller_business_number,seller_type,phone) is distinct from (trim(p_legal_name),trim(p_address),nullif(trim(p_business_number),''),p_seller_type,trim(p_phone)) then 'custom-'||gen_random_uuid()::text else sales_terms_version end,
 updated_at=now() where org_id=p_org_id returning * into v_profile;
 if not found then raise exception 'NOT_FOUND'; end if;
 return to_jsonb(v_profile);
end; $$;
REVOKE ALL ON FUNCTION public.organizer_update_seller_identity(uuid,uuid,text,text,text,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.organizer_update_seller_identity(uuid,uuid,text,text,text,text,text) TO service_role;

create or replace function public.organizer_accept_platform_agreements(p_actor_id uuid,p_org_id uuid,p_connect_version text,p_dpa_version text,p_platform_terms_version text,p_privacy_version text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,private as $$
declare v_connect text; v_dpa text; v_terms text; v_privacy text; v_signer_email text; v_identity jsonb;
begin
 if p_actor_id is null then raise exception 'NOT_AUTHENTICATED'; end if;
 if p_connect_version is distinct from '2026-10-01' or p_dpa_version is distinct from '2026-10-01' or p_platform_terms_version is distinct from '2026-10-01' or p_privacy_version is distinct from '2026-10-01' then raise exception 'PLATFORM_AGREEMENTS_CHANGED'; end if;
 select body into v_connect from private.legal_document_versions where document_key='connect' and version=p_connect_version;
 select body into v_dpa from private.legal_document_versions where document_key='dpa' and version=p_dpa_version;
 select body into v_terms from private.legal_document_versions where document_key='platform_terms' and version=p_platform_terms_version;
 select body into v_privacy from private.legal_document_versions where document_key='privacy' and version=p_privacy_version;
 if v_connect is null or v_dpa is null or v_terms is null or v_privacy is null then raise exception 'PLATFORM_AGREEMENTS_UNAVAILABLE'; end if;
 perform private.assert_rate_limit('platform_terms:'||p_actor_id::text,10,60);
 update public.organization_profile set connect_terms_accepted_version=p_connect_version,dpa_accepted_version=p_dpa_version,platform_terms_accepted_version=p_platform_terms_version,privacy_accepted_version=p_privacy_version,
 platform_agreements_accepted_at=now(),platform_agreements_accepted_by=p_actor_id,updated_at=now() where org_id=p_org_id;
 if not found then raise exception 'NOT_FOUND'; end if;
 select email into v_signer_email from auth.users where id=p_actor_id;
 select jsonb_build_object('display_name',display_name,'legal_name',seller_legal_name,'business_number',seller_business_number,'public_email',public_email) into v_identity from public.organization_profile where org_id=p_org_id;
 insert into private.organization_platform_acceptances(org_id,accepted_by,signer_email,organization_identity_snapshot,connect_version,dpa_version,platform_terms_version,privacy_version,connect_snapshot,dpa_snapshot,platform_terms_snapshot,privacy_snapshot) values(p_org_id,p_actor_id,v_signer_email,v_identity,p_connect_version,p_dpa_version,p_platform_terms_version,p_privacy_version,v_connect,v_dpa,v_terms,v_privacy);
 return jsonb_build_object('connectTermsAcceptedVersion',p_connect_version,'dpaAcceptedVersion',p_dpa_version,'platformTermsAcceptedVersion',p_platform_terms_version,'privacyAcceptedVersion',p_privacy_version,'platformAgreementsAcceptedAt',now());
end; $$;
REVOKE ALL ON FUNCTION public.organizer_accept_platform_agreements(uuid,uuid,text,text,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.organizer_accept_platform_agreements(uuid,uuid,text,text,text,text) TO service_role;

COMMIT;
