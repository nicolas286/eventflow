-- B2.1 additive operations. The Edge authorizes each organization/resource.
-- Organization NO KEY UPDATE locks serialize organizer quota transitions while
-- allowing checkout order FKs to obtain their KEY SHARE organization locks.
-- Legacy calls remain compatible until the separate deferred closure is applied.
BEGIN;


CREATE OR REPLACE FUNCTION private.organizer_assert_paid_event_capacity(p_org_id uuid)
RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE v_max integer; v_count integer;
BEGIN
 SELECT max_events_per_year INTO v_max FROM public.plan_limits WHERE plan=public.get_org_plan(p_org_id);
 IF NOT FOUND THEN RAISE EXCEPTION 'PLAN_LIMIT: unknown plan'; END IF;
 IF v_max IS NULL THEN RETURN; END IF;
 -- Preserve the current quota: paid events created in the current calendar year.
 SELECT count(*) INTO v_count FROM public.events e WHERE e.org_id=p_org_id
  AND date_part('year',e.created_at)=date_part('year',now()) AND public.is_event_paid(e.id);
 IF v_count>=v_max THEN RAISE EXCEPTION 'PLAN_LIMIT: paid_events_per_year exceeded'; END IF;
END $$;
REVOKE ALL ON FUNCTION private.organizer_assert_paid_event_capacity(uuid) FROM PUBLIC,anon,authenticated,service_role;


CREATE OR REPLACE FUNCTION public.organizer_get_events_overview(p_org_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$declare
  v_result jsonb;
begin
  if p_org_id is null then raise exception 'VALIDATION_ERROR: org_id is required'; end if;

  with ev as (
    select
      e.id,
      e.org_id,
      e.title,
      e.slug,
      e.location,
      e.starts_at,
      e.ends_at,
      e.is_published,
      e.created_at,
      e.updated_at
    from public.events e
    where e.org_id = p_org_id
    order by e.created_at desc
    limit 200
  ),
  orders_agg as (
    select
      o.event_id,
      count(*)::int as orders_count,
      coalesce(sum(o.paid_cents), 0)::bigint as paid_cents
    from public.orders o
    join ev on ev.id = o.event_id
    where o.org_id = p_org_id
    group by o.event_id
  )
  select jsonb_build_object(
    'orgId', p_org_id,
    'events', coalesce(
      jsonb_agg(
        jsonb_build_object(
          'event', to_jsonb(ev),
          'ordersCount', coalesce(oa.orders_count, 0),
          'paidCents', coalesce(oa.paid_cents, 0)
        )
        order by ev.created_at desc
      ),
      '[]'::jsonb
    )
  )
  into v_result
  from ev
  left join orders_agg oa on oa.event_id = ev.id;

  return v_result;
end;$function$;

REVOKE ALL ON FUNCTION public.organizer_get_events_overview(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.organizer_get_events_overview(uuid) TO service_role;


CREATE OR REPLACE FUNCTION public.organizer_get_event_detail_admin_core(p_org_id uuid, p_event_id uuid DEFAULT NULL::uuid, p_event_slug text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
declare
  v_result jsonb;

  v_event jsonb;
  v_products jsonb;
  v_form_fields_groups jsonb;
  v_form_fields jsonb;

  v_org_id uuid;
  v_org_logo_url text;
  v_org_default_banner_url text;

  v_default_logo_url text := public.default_asset_url('defaults/default_logo.webp');
  v_default_banner_url text := public.default_asset_url('defaults/default_banner.webp');

  v_slug text := nullif(trim(p_event_slug), '');
begin
  if p_org_id is null then raise exception 'VALIDATION_ERROR: org_id is required'; end if;

  if p_event_id is null then
    if p_org_id is null or v_slug is null then
      raise exception 'VALIDATION_ERROR: org_id + event_slug required';
    end if;

    select e.id
    into p_event_id
    from public.events e
    where e.org_id = p_org_id
      and e.slug = v_slug
    limit 1;

    if p_event_id is null then
      raise exception 'NOT_FOUND';
    end if;
  end if;


  select
    e.org_id,
    jsonb_build_object(
      'id', e.id,
      'orgId', e.org_id,
      'slug', e.slug,
      'title', e.title,
      'description', e.description,
      'location', e.location,
      'isPublished', e.is_published,
      'bannerUrlRaw', e.banner_url,
      'charterText', e.charter_text,
      'depositCents', e.deposit_cents,
      'maxAttendees', e.max_attendees,
      'createdAt', e.created_at::text,
      'updatedAt', e.updated_at::text,
      'startsAt', to_jsonb(e.starts_at::text),
      'endsAt', to_jsonb(e.ends_at::text),
      'registrationDeadline', to_jsonb(e.registration_deadline::text),
      'bannerUrlEffective',
        coalesce(
          nullif(trim(e.banner_url), ''),
          nullif(trim(op.default_event_banner_url), ''),
          v_default_banner_url
        )
    ),
    nullif(trim(op.logo_url), ''),
    nullif(trim(op.default_event_banner_url), '')
  into
    v_org_id,
    v_event,
    v_org_logo_url,
    v_org_default_banner_url
  from public.events e
  join public.organization_profile op
    on op.org_id = e.org_id
  where e.id = p_event_id and e.org_id=p_org_id;

  if v_event is null then
    raise exception 'NOT_FOUND';
  end if;

  select coalesce(
    jsonb_agg(to_jsonb(ep) order by ep.sort_order asc, ep.created_at asc),
    '[]'::jsonb
  )
  into v_products
  from public.event_products ep
  where ep.event_id = p_event_id;

  select coalesce(
    jsonb_agg(to_jsonb(ffg) order by ffg.sort_order asc, ffg.created_at asc),
    '[]'::jsonb
  )
  into v_form_fields_groups
  from public.event_form_field_groups ffg
  where ffg.event_id = p_event_id;

  select coalesce(
    jsonb_agg(to_jsonb(ff) order by ff.sort_order asc, ff.created_at asc),
    '[]'::jsonb
  )
  into v_form_fields
  from public.event_form_fields ff
  where ff.event_id = p_event_id;

  v_result := jsonb_build_object(
    'event', v_event,
    'orgBranding', jsonb_build_object(
      'logoUrl', coalesce(v_org_logo_url, v_default_logo_url),
      'defaultEventBannerUrl', coalesce(v_org_default_banner_url, v_default_banner_url)
    ),
    'products', v_products,
    'formFields', v_form_fields,
    'formFieldsGroups', v_form_fields_groups
  );

  return v_result;
end;
$function$;

REVOKE ALL ON FUNCTION public.organizer_get_event_detail_admin_core(uuid,uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.organizer_get_event_detail_admin_core(uuid,uuid,text) TO service_role;


CREATE OR REPLACE FUNCTION public.organizer_create_event(p_actor_id uuid, p_input jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
declare
  v_user_id uuid := p_actor_id;
  v_event_id uuid;

  v_org_id uuid;
  v_title text;
  v_description text;
  v_location text;
  v_banner_url text;
  v_charter_text text;
  v_deposit_cents int4;
  v_max_attendees int4;
  v_starts_at timestamptz;
  v_ends_at timestamptz;
  v_registration_deadline timestamptz;

  v_slug text;

  v_now timestamptz := now();
  v_identity_group_id uuid;
  v_limits public.plan_limits%rowtype;
begin
  if v_user_id is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  if p_input is null or jsonb_typeof(p_input)<>'object' then raise exception 'VALIDATION_ERROR: invalid event fields'; end if;
  if exists(select 1 from jsonb_object_keys(p_input) k where k not in ('org_id','title','description','location','banner_url','charter_text','deposit_cents','max_attendees','starts_at','ends_at','registration_deadline')) then raise exception 'VALIDATION_ERROR: invalid event fields'; end if;


  v_org_id := nullif(trim(p_input->>'org_id'), '')::uuid;
  v_title := nullif(trim(p_input->>'title'), '');
  v_description := nullif(trim(p_input->>'description'), '');
  v_location := nullif(trim(p_input->>'location'), '');
  v_banner_url := nullif(trim(p_input->>'banner_url'), '');
  v_charter_text := nullif(trim(p_input->>'charter_text'), '');
  v_deposit_cents := nullif(trim(p_input->>'deposit_cents'), '')::int4;
  v_max_attendees := nullif(trim(p_input->>'max_attendees'), '')::int4;
  v_starts_at := nullif(trim(p_input->>'starts_at'), '')::timestamptz;
  v_ends_at := nullif(trim(p_input->>'ends_at'), '')::timestamptz;
  v_registration_deadline := nullif(trim(p_input->>'registration_deadline'), '')::timestamptz;

  if v_org_id is null then
    raise exception 'VALIDATION_ERROR: org_id is required';
  end if;

  perform 1 from public.organizations where id=v_org_id for no key update;
  if not found then raise exception 'NOT_FOUND'; end if;

  if v_title is null then
    raise exception 'VALIDATION_ERROR: title is required';
  end if;

  if length(v_title) > 120 then
    raise exception 'VALIDATION_ERROR: title too long';
  end if;

  if v_location is not null and length(v_location) > 180 then
    raise exception 'VALIDATION_ERROR: location too long';
  end if;

  if v_description is not null and length(v_description) > 5000 then
    raise exception 'VALIDATION_ERROR: description too long';
  end if;

  if v_banner_url is not null and length(v_banner_url) > 500 then
    raise exception 'VALIDATION_ERROR: banner_url too long';
  end if;

  if v_charter_text is not null and length(v_charter_text) > 10000 then
    raise exception 'VALIDATION_ERROR: charter_text too long';
  end if;

  if v_deposit_cents is not null and v_deposit_cents < 0 then
    raise exception 'VALIDATION_ERROR: deposit_cents must be >= 0';
  end if;

  if v_max_attendees is not null and v_max_attendees < 0 then
    raise exception 'VALIDATION_ERROR: max_attendees must be >= 0';
  end if;

  if v_starts_at is not null and v_ends_at is not null and v_ends_at < v_starts_at then
    raise exception 'VALIDATION_ERROR: ends_at must be after starts_at';
  end if;

  if v_registration_deadline is not null
     and v_starts_at is not null
     and v_registration_deadline > v_starts_at then
    raise exception 'VALIDATION_ERROR: registration_deadline must be before or equal to starts_at';
  end if;

  perform public.assert_rate_limit('create_event:org:' || v_org_id::text, 20, 3600);

  select * into v_limits from public.plan_limits where plan=public.get_org_plan(v_org_id);
  if not found then raise exception 'PLAN_LIMIT: unknown plan'; end if;
  if v_limits.max_products_per_event is not null and v_limits.max_products_per_event<1 then raise exception 'PLAN_LIMIT: max_products_per_event exceeded'; end if;
  if v_limits.max_form_fields is not null and v_limits.max_form_fields<10 then raise exception 'PLAN_LIMIT: max_form_fields exceeded'; end if;
  if coalesce(v_deposit_cents,0)>0 then perform private.organizer_assert_paid_event_capacity(v_org_id); end if;

  v_slug := private.generate_unique_event_slug(v_org_id, v_title);

  insert into public.events (
    id,
    org_id,
    slug,
    title,
    description,
    location,
    banner_url,
    charter_text,
    deposit_cents,
    max_attendees,
    starts_at,
    ends_at,
    registration_deadline,
    is_published,
    created_at,
    updated_at
  )
  values (
    gen_random_uuid(),
    v_org_id,
    v_slug,
    v_title,
    v_description,
    v_location,
    v_banner_url,
    v_charter_text,
    v_deposit_cents,
    v_max_attendees,
    v_starts_at,
    v_ends_at,
    v_registration_deadline,
    false,
    v_now,
    v_now
  )
  returning id into v_event_id;


  insert into public.event_form_field_groups (
    id,
    event_id,
    label,
    sort_order,
    is_active,
    created_at,
    updated_at
  )
  values (
    gen_random_uuid(),
    v_event_id,
    'Identité',
    1,
    true,
    v_now,
    v_now
  )
  returning id into v_identity_group_id;

  insert into public.event_form_fields (
    event_id,
    label,
    field_key,
    field_type,
    is_required,
    sort_order,
    is_active,
    created_at,
    updated_at,
    group_id
  ) values
    (v_event_id, 'Nom', 'last_name', 'text', true, 1, true, v_now, v_now, v_identity_group_id),
    (v_event_id, 'Prénom', 'first_name', 'text', true, 2, true, v_now, v_now, v_identity_group_id),
    (v_event_id, 'Date de naissance', 'birth_date', 'date', false, 3, true, v_now, v_now, v_identity_group_id),
    (v_event_id, 'Adresse', 'address_line1', 'text', false, 4, true, v_now, v_now, v_identity_group_id),
    (v_event_id, 'Complément d’adresse', 'address_line2', 'text', false, 5, true, v_now, v_now, v_identity_group_id),
    (v_event_id, 'Code postal', 'postal_code', 'text', false, 6, true, v_now, v_now, v_identity_group_id),
    (v_event_id, 'Ville', 'city', 'text', false, 7, true, v_now, v_now, v_identity_group_id),
    (v_event_id, 'Pays', 'country_code', 'country', false, 8, true, v_now, v_now, v_identity_group_id),
    (v_event_id, 'Téléphone', 'phone', 'phone', false, 9, true, v_now, v_now, v_identity_group_id),
    (v_event_id, 'Email', 'email', 'email', true, 10, true, v_now, v_now, v_identity_group_id);

  insert into public.event_products (
    id,
    event_id,
    name,
    description,
    price_cents,
    currency,
    stock_qty,
    creates_attendees,
    attendees_per_unit,
    is_active,
    sort_order,
    created_at,
    updated_at
  )
  values (
    gen_random_uuid(),
    v_event_id,
    'Ticket gratuit',
    'Accès à l’événement',
    0,
    'EUR',
    null,
    true,
    1,
    true,
    1,
    v_now,
    v_now
  );

  return jsonb_build_object(
    'id', v_event_id,
    'orgId', v_org_id,
    'slug', v_slug,
    'title', v_title,
    'description', v_description,
    'location', v_location,
    'bannerUrl', v_banner_url,
    'charterText', v_charter_text,
    'depositCents', v_deposit_cents,
    'maxAttendees', v_max_attendees,
    'startsAt', v_starts_at,
    'endsAt', v_ends_at,
    'registrationDeadline', v_registration_deadline,
    'isPublished', false,
    'createdAt', v_now,
    'updatedAt', v_now
  );
exception
  when unique_violation then
    raise exception 'CONFLICT';
end;
$function$;

REVOKE ALL ON FUNCTION public.organizer_create_event(uuid,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.organizer_create_event(uuid,jsonb) TO service_role;


CREATE OR REPLACE FUNCTION public.organizer_update_event(p_actor_id uuid, p_input jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
declare
  v_user_id uuid := p_actor_id;
  v_event_id uuid;
  v_org_id uuid;

  v_cur_title text;
  v_cur_location text;
  v_cur_description text;
  v_cur_charter_text text;
  v_cur_banner_url text;
  v_cur_starts_at timestamptz;
  v_cur_ends_at timestamptz;
  v_cur_registration_deadline timestamptz;
  v_cur_is_published boolean;
  v_cur_deposit_cents int;
  v_cur_max_attendees int;

  v_title text;
  v_location text;
  v_description text;
  v_charter_text text;
  v_banner_url text;
  v_starts_at timestamptz;
  v_ends_at timestamptz;
  v_registration_deadline timestamptz;
  v_is_published boolean;
  v_deposit_cents int;
  v_max_attendees int;

  v_has_title boolean := false;
  v_has_location boolean := false;
  v_has_description boolean := false;
  v_has_charter_text boolean := false;
  v_has_banner boolean := false;
  v_has_starts boolean := false;
  v_has_ends boolean := false;
  v_has_registration_deadline boolean := false;
  v_has_published boolean := false;
  v_has_deposit boolean := false;
  v_has_max_attendees boolean := false;

  v_now timestamptz := now();
  v_row public.events%rowtype;

  v_cur_slug text;
  v_new_slug text;

  v_event_paid_before boolean;
  v_event_paid_after boolean;
  v_new_deposit int;
begin
  if v_user_id is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  if p_input is null or jsonb_typeof(p_input)<>'object' then raise exception 'VALIDATION_ERROR: invalid event fields'; end if;
  if exists(select 1 from jsonb_object_keys(p_input) k where k not in ('org_id','event_id','title','description','location','banner_url','charter_text','deposit_cents','max_attendees','starts_at','ends_at','registration_deadline','is_published')) then raise exception 'VALIDATION_ERROR: invalid event fields'; end if;


  v_org_id := (p_input->>'org_id')::uuid;
  if v_org_id is null then raise exception 'VALIDATION_ERROR: org_id is required'; end if;
  perform 1 from public.organizations where id=v_org_id for no key update;
  if not found then raise exception 'NOT_FOUND'; end if;
  v_event_id := (p_input->>'event_id')::uuid;
  if v_event_id is null then
    raise exception 'VALIDATION_ERROR: event_id is required';
  end if;

  select
    e.org_id,
    e.slug,
    e.title,
    e.location,
    e.description,
    e.charter_text,
    e.banner_url,
    e.starts_at,
    e.ends_at,
    e.registration_deadline,
    e.is_published,
    e.deposit_cents,
    e.max_attendees
  into
    v_org_id,
    v_cur_slug,
    v_cur_title,
    v_cur_location,
    v_cur_description,
    v_cur_charter_text,
    v_cur_banner_url,
    v_cur_starts_at,
    v_cur_ends_at,
    v_cur_registration_deadline,
    v_cur_is_published,
    v_cur_deposit_cents,
    v_cur_max_attendees
  from public.events e
  where e.id = v_event_id and e.org_id=v_org_id
  for update;

  if not found then
    raise exception 'NOT_FOUND';
  end if;


  perform public.assert_rate_limit(
    'update_event:' || v_event_id::text,
    120,
    3600
  );

  if p_input ? 'title' then
    v_has_title := true;
    v_title := nullif(trim(p_input->>'title'), '');
    if v_title is null then
      raise exception 'VALIDATION_ERROR: title is required';
    end if;
    if length(v_title) > 120 then
      raise exception 'VALIDATION_ERROR: title too long';
    end if;
  end if;

  if v_has_title and v_title is distinct from v_cur_title then
    v_new_slug := private.generate_unique_event_slug(v_org_id, v_title);
  end if;

  if p_input ? 'location' then
    v_has_location := true;
    v_location := nullif(trim(p_input->>'location'), '');
    if v_location is not null and length(v_location) > 180 then
      raise exception 'VALIDATION_ERROR: location too long';
    end if;
  end if;

  if p_input ? 'description' then
    v_has_description := true;
    v_description := nullif(trim(p_input->>'description'), '');
    if v_description is not null and length(v_description) > 5000 then
      raise exception 'VALIDATION_ERROR: description too long';
    end if;
  end if;

  if p_input ? 'charter_text' then
    v_has_charter_text := true;
    v_charter_text := nullif(trim(p_input->>'charter_text'), '');
    if v_charter_text is not null and length(v_charter_text) > 10000 then
      raise exception 'VALIDATION_ERROR: charter_text too long';
    end if;
  end if;

  if p_input ? 'banner_url' then
    v_has_banner := true;
    v_banner_url := nullif(trim(p_input->>'banner_url'), '');
    if v_banner_url is not null and length(v_banner_url) > 500 then
      raise exception 'VALIDATION_ERROR: banner_url too long';
    end if;
  end if;

  if p_input ? 'starts_at' then
    v_has_starts := true;
    v_starts_at := nullif(trim(p_input->>'starts_at'), '')::timestamptz;
  end if;

  if p_input ? 'ends_at' then
    v_has_ends := true;
    v_ends_at := nullif(trim(p_input->>'ends_at'), '')::timestamptz;
  end if;

  if p_input ? 'registration_deadline' then
    v_has_registration_deadline := true;
    v_registration_deadline := nullif(trim(p_input->>'registration_deadline'), '')::timestamptz;
  end if;

  if p_input ? 'is_published' then
    v_has_published := true;
    v_is_published := (p_input->>'is_published')::boolean;
  end if;

  if p_input ? 'deposit_cents' then
    v_has_deposit := true;
    v_deposit_cents := greatest(0, (p_input->>'deposit_cents')::int);
  end if;

  if p_input ? 'max_attendees' then
    v_has_max_attendees := true;
    v_max_attendees := nullif(trim(p_input->>'max_attendees'), '')::int;
    if v_max_attendees is not null and v_max_attendees < 0 then
      raise exception 'VALIDATION_ERROR: max_attendees must be >= 0';
    end if;
  end if;

  if
    coalesce(case when v_has_ends then v_ends_at else v_cur_ends_at end, null) is not null
    and coalesce(case when v_has_starts then v_starts_at else v_cur_starts_at end, null) is not null
    and (case when v_has_ends then v_ends_at else v_cur_ends_at end)
        < (case when v_has_starts then v_starts_at else v_cur_starts_at end)
  then
    raise exception 'VALIDATION_ERROR: ends_at must be after starts_at';
  end if;

  if
    (case when v_has_registration_deadline then v_registration_deadline else v_cur_registration_deadline end) is not null
    and (case when v_has_starts then v_starts_at else v_cur_starts_at end) is not null
    and (case when v_has_registration_deadline then v_registration_deadline else v_cur_registration_deadline end)
        > (case when v_has_starts then v_starts_at else v_cur_starts_at end)
  then
    raise exception 'VALIDATION_ERROR: registration_deadline must be before or equal to starts_at';
  end if;


  v_event_paid_before := public.is_event_paid(v_event_id);

  v_new_deposit := case
    when v_has_deposit then coalesce(v_deposit_cents, 0)
    else coalesce(v_cur_deposit_cents, 0)
  end;

  v_event_paid_after :=
    (v_new_deposit > 0)
    or exists (
      select 1
      from public.event_products ep
      where ep.event_id = v_event_id
        and coalesce(ep.price_cents, 0) > 0
    );

  if coalesce(v_event_paid_before,false) = false
     and coalesce(v_event_paid_after,false) = true
  then
    perform private.organizer_assert_paid_event_capacity(v_org_id);
  end if;

  update public.events
  set
    slug = case when v_has_title and v_title is distinct from v_cur_title then v_new_slug else slug end,
    title = coalesce(v_title, title),
    location = case when v_has_location then v_location else location end,
    description = case when v_has_description then v_description else description end,
    charter_text = case when v_has_charter_text then v_charter_text else charter_text end,
    banner_url = case when v_has_banner then v_banner_url else banner_url end,
    starts_at = case when v_has_starts then v_starts_at else starts_at end,
    ends_at = case when v_has_ends then v_ends_at else ends_at end,
    registration_deadline = case when v_has_registration_deadline then v_registration_deadline else registration_deadline end,
    is_published = case when v_has_published then v_is_published else is_published end,
    deposit_cents = case when v_has_deposit then v_deposit_cents else deposit_cents end,
    max_attendees = case when v_has_max_attendees then v_max_attendees else max_attendees end,
    updated_at = v_now
  where id = v_event_id and org_id=v_org_id;

  select *
  into v_row
  from public.events
  where id = v_event_id and org_id=v_org_id;

  return jsonb_build_object(
    'id', v_row.id,
    'orgId', v_row.org_id,
    'slug', v_row.slug,
    'title', v_row.title,
    'description', v_row.description,
    'charterText', v_row.charter_text,
    'location', v_row.location,
    'bannerUrl', v_row.banner_url,
    'depositCents', v_row.deposit_cents,
    'maxAttendees', v_row.max_attendees,
    'startsAt', v_row.starts_at,
    'endsAt', v_row.ends_at,
    'registrationDeadline', v_row.registration_deadline,
    'isPublished', v_row.is_published,
    'createdAt', v_row.created_at,
    'updatedAt', v_row.updated_at
  );
end;
$function$;

REVOKE ALL ON FUNCTION public.organizer_update_event(uuid,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.organizer_update_event(uuid,jsonb) TO service_role;


CREATE OR REPLACE FUNCTION public.organizer_duplicate_event(p_actor_id uuid, p_input jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
declare
  v_user_id uuid := p_actor_id;

  v_source_event_id uuid;
  v_org_id uuid;
  v_limits public.plan_limits%rowtype;
  v_active_fields_count integer;
  v_group_map jsonb:='{}'::jsonb;
  v_group record;
  v_group_id uuid;
  v_source_event public.events%rowtype;

  v_new_event_id uuid;
  v_new_slug text;
  v_title text;

  v_now timestamptz := now();

  v_form_fields_count int := 0;
  v_products_count int := 0;
  v_form_field_groups_count int := 0;
begin

  /* 1) Auth */
  if v_user_id is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  if p_input is null or jsonb_typeof(p_input)<>'object' then raise exception 'VALIDATION_ERROR: invalid event fields'; end if;
  if exists(select 1 from jsonb_object_keys(p_input) k where k not in ('org_id','source_event_id','title')) then raise exception 'VALIDATION_ERROR: invalid event fields'; end if;


  v_org_id := (p_input->>'org_id')::uuid;
  if v_org_id is null then raise exception 'VALIDATION_ERROR: org_id is required'; end if;
  perform 1 from public.organizations where id=v_org_id for no key update;
  if not found then raise exception 'NOT_FOUND'; end if;

  /* 2) Parse input */
  v_source_event_id := nullif(trim(p_input->>'source_event_id'), '')::uuid;
  v_title := nullif(trim(p_input->>'title'), '');

  if v_source_event_id is null then
    raise exception 'VALIDATION_ERROR: source_event_id is required';
  end if;

  if v_title is not null and length(v_title) > 120 then
    raise exception 'VALIDATION_ERROR: title too long';
  end if;

  /* 3) Load source event */
  select e.*
    into v_source_event
  from public.events e
  where e.id = v_source_event_id and e.org_id=v_org_id
  for share;

  if v_source_event.id is null then
    raise exception 'NOT_FOUND';
  end if;

  -- The Edge authorizes this source organization/event.

  /* 5) Derived values */
  v_title := coalesce(v_title, v_source_event.title || ' (copie)');

  /* 6) Validations */
  if v_title is null then
    raise exception 'VALIDATION_ERROR: title is required';
  end if;

  if length(v_title) > 120 then
    raise exception 'VALIDATION_ERROR: title too long';
  end if;

  if v_source_event.location is not null and length(v_source_event.location) > 180 then
    raise exception 'VALIDATION_ERROR: location too long';
  end if;

  if v_source_event.description is not null and length(v_source_event.description) > 5000 then
    raise exception 'VALIDATION_ERROR: description too long';
  end if;

  if v_source_event.banner_url is not null and length(v_source_event.banner_url) > 500 then
    raise exception 'VALIDATION_ERROR: banner_url too long';
  end if;

  if v_source_event.charter_text is not null and length(v_source_event.charter_text) > 10000 then
    raise exception 'VALIDATION_ERROR: charter_text too long';
  end if;

  if v_source_event.deposit_cents is not null and v_source_event.deposit_cents < 0 then
    raise exception 'VALIDATION_ERROR: deposit_cents must be >= 0';
  end if;

  if v_source_event.max_attendees is not null and v_source_event.max_attendees < 0 then
    raise exception 'VALIDATION_ERROR: max_attendees must be >= 0';
  end if;

  if v_source_event.starts_at is not null
     and v_source_event.ends_at is not null
     and v_source_event.ends_at < v_source_event.starts_at then
    raise exception 'VALIDATION_ERROR: ends_at must be after starts_at';
  end if;

  /* 7) Rate limit */
  perform public.assert_rate_limit(
    'duplicate_event:org:' || v_source_event.org_id::text,
    20,
    3600
  );

  /* 8) Count children for plan checks */
  select count(*)
    into v_form_fields_count
  from public.event_form_fields f
  where f.event_id = v_source_event_id;

  select count(*)
    into v_products_count
  from public.event_products p
  where p.event_id = v_source_event_id;

  select count(*)
    into v_form_field_groups_count
  from public.event_form_field_groups g
  where g.event_id = v_source_event_id;

  select count(*) into v_active_fields_count from public.event_form_fields where event_id=v_source_event_id and is_active is true;
  select * into v_limits from public.plan_limits where plan=public.get_org_plan(v_org_id);
  if not found then raise exception 'PLAN_LIMIT: unknown plan'; end if;
  if v_limits.max_products_per_event is not null and v_products_count>v_limits.max_products_per_event then raise exception 'PLAN_LIMIT: max_products_per_event exceeded'; end if;
  if v_limits.max_form_fields is not null and v_active_fields_count>v_limits.max_form_fields then raise exception 'PLAN_LIMIT: max_form_fields exceeded'; end if;
  if public.is_event_paid(v_source_event_id) then perform private.organizer_assert_paid_event_capacity(v_org_id); end if;

  /* 9) Create target event */
  v_new_slug := private.generate_unique_event_slug(v_source_event.org_id, v_title);

  insert into public.events (
    id,
    org_id,
    slug,
    title,
    description,
    banner_url,
    charter_text,
    starts_at,
    ends_at,
    registration_deadline,
    is_published,
    created_at,
    updated_at,
    deposit_cents,
    max_attendees,
    location
  )
  values (
    gen_random_uuid(),
    v_source_event.org_id,
    v_new_slug,
    v_title,
    v_source_event.description,
    v_source_event.banner_url,
    v_source_event.charter_text,
    v_source_event.starts_at,
    v_source_event.ends_at,
    v_source_event.registration_deadline,
    false,
    v_now,
    v_now,
    v_source_event.deposit_cents,
    v_source_event.max_attendees,
    v_source_event.location
  )
  returning id into v_new_event_id;

  -- A local JSON UUID map supports multiple duplications in the same transaction.
  -- No temporary relation or reference to a source group remains in the clone.
  for v_group in select * from public.event_form_field_groups
    where event_id=v_source_event_id order by sort_order,created_at
  loop
    v_group_id:=gen_random_uuid();
    v_group_map:=v_group_map||jsonb_build_object(v_group.id::text,v_group_id::text);
    insert into public.event_form_field_groups(id,event_id,label,description,sort_order,is_active,created_at,updated_at)
    values(v_group_id,v_new_event_id,v_group.label,v_group.description,v_group.sort_order,v_group.is_active,v_now,v_now);
  end loop;

  /* 12) Clone form fields */
  insert into public.event_form_fields (
    id,
    event_id,
    label,
    field_key,
    field_type,
    is_required,
    options,
    sort_order,
    is_active,
    created_at,
    updated_at,
    group_id
  )
  select
    gen_random_uuid(),
    v_new_event_id,
    f.label,
    f.field_key,
    f.field_type,
    f.is_required,
    f.options,
    f.sort_order,
    f.is_active,
    v_now,
    v_now,
    (v_group_map->>f.group_id::text)::uuid
  from public.event_form_fields f
  where f.event_id = v_source_event_id
  order by f.sort_order asc, f.created_at asc;

  /* 13) Clone products */
  insert into public.event_products (
    id,
    event_id,
    name,
    description,
    price_cents,
    currency,
    stock_qty,
    is_active,
    sort_order,
    creates_attendees,
    attendees_per_unit,
    created_at,
    updated_at,
    reserved_qty,
    sold_qty,
    is_gatekeeper,
    close_event_when_sold_out
  )
  select
    gen_random_uuid(),
    v_new_event_id,
    p.name,
    p.description,
    p.price_cents,
    p.currency,
    p.stock_qty,
    p.is_active,
    p.sort_order,
    p.creates_attendees,
    p.attendees_per_unit,
    v_now,
    v_now,
    0,
    0,
    coalesce(p.is_gatekeeper, false),
    coalesce(p.close_event_when_sold_out, false)
  from public.event_products p
  where p.event_id = v_source_event_id
  order by p.sort_order asc, p.created_at asc;

  /* 14) Response */
  return jsonb_build_object(
    'id', v_new_event_id,
    'orgId', v_source_event.org_id,
    'slug', v_new_slug,
    'title', v_title,
    'description', v_source_event.description,
    'location', v_source_event.location,
    'bannerUrl', v_source_event.banner_url,
    'charterText', v_source_event.charter_text,
    'depositCents', v_source_event.deposit_cents,
    'maxAttendees', v_source_event.max_attendees,
    'startsAt', v_source_event.starts_at,
    'endsAt', v_source_event.ends_at,
    'registrationDeadline', v_source_event.registration_deadline,
    'isPublished', false,
    'createdAt', v_now,
    'updatedAt', v_now,
    'sourceEventId', v_source_event_id,
    'clonedFormFieldGroupsCount', v_form_field_groups_count,
    'clonedFormFieldsCount', v_form_fields_count,
    'clonedProductsCount', v_products_count
  );

exception
  when unique_violation then
    raise exception 'CONFLICT';
end;
$function$;

REVOKE ALL ON FUNCTION public.organizer_duplicate_event(uuid,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.organizer_duplicate_event(uuid,jsonb) TO service_role;


CREATE OR REPLACE FUNCTION public.organizer_delete_event(p_actor_id uuid,p_org_id uuid,p_event_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,private AS $$
BEGIN
 IF p_actor_id IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
 IF p_org_id IS NULL OR p_event_id IS NULL THEN RAISE EXCEPTION 'VALIDATION_ERROR: org_id and event_id are required'; END IF;
 PERFORM 1 FROM public.organizations WHERE id=p_org_id FOR NO KEY UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
 PERFORM 1 FROM public.events WHERE id=p_event_id AND org_id=p_org_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
 -- Legacy independent FKs permit inconsistent tenant links. Refuse their
 -- destructive cascade into another organization's order or promotion.
 IF EXISTS(SELECT 1 FROM public.orders WHERE event_id=p_event_id AND org_id<>p_org_id)
  OR EXISTS(SELECT 1 FROM public.promo_codes WHERE event_id=p_event_id AND org_id<>p_org_id) THEN
  RAISE EXCEPTION 'RELATIONSHIP_CONFLICT'; END IF;
 -- Existing payment/expiry workers take order -> product. Acquire both sets
 -- without waiting before the event DELETE/cascades, retaining that ordering.
 PERFORM 1 FROM public.orders WHERE event_id=p_event_id AND org_id=p_org_id ORDER BY id FOR UPDATE NOWAIT;
 -- Checkout locks products before its event row. Do not hold the event row
 -- while waiting for those products: a busy reservation can be retried.
 PERFORM 1 FROM public.event_products WHERE event_id=p_event_id ORDER BY id FOR UPDATE NOWAIT;
 -- Block new FK references before the final relationship check. Do not wait
 -- on an event while retaining its children: concurrent legacy flows retry.
 PERFORM 1 FROM public.events WHERE id=p_event_id AND org_id=p_org_id FOR UPDATE NOWAIT;
 IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
 IF EXISTS(SELECT 1 FROM public.orders WHERE event_id=p_event_id AND org_id<>p_org_id)
  OR EXISTS(SELECT 1 FROM public.promo_codes WHERE event_id=p_event_id AND org_id<>p_org_id) THEN
  RAISE EXCEPTION 'RELATIONSHIP_CONFLICT'; END IF;
 -- Keep the historical DELETE cascades and FK refusal; add no new deletion rule.
 DELETE FROM public.events WHERE id=p_event_id AND org_id=p_org_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
 RETURN jsonb_build_object('success',true);
EXCEPTION WHEN lock_not_available THEN RAISE EXCEPTION 'RESOURCE_BUSY';
END $$;

REVOKE ALL ON FUNCTION public.organizer_delete_event(uuid,uuid,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.organizer_delete_event(uuid,uuid,uuid) TO service_role;


COMMIT;
