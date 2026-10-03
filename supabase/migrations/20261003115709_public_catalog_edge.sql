-- B5 public reads: additive service-only SQL; browser closure deferred.
begin;
CREATE OR REPLACE FUNCTION public.catalog_get_public_org_by_slug(p_org_id uuid, p_slug text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$declare
  v_slug text := nullif(trim(p_slug), '');
  v_result jsonb;
begin
  if v_slug is null then
    raise exception 'VALIDATION_ERROR: slug is required';
  end if;


  select jsonb_build_object(
    'org', jsonb_build_object(
      'id', o.id,
      'type', o.type,
      'name', o.name
    ),
    'profile', jsonb_build_object(
      'slug', op.slug,
      'displayName', op.display_name,
      'description', op.description,
      'publicEmail', op.public_email,
      'phone', op.phone,
      'website', op.website,
      'logoUrl', op.logo_url,
      'primaryColor', op.primary_color,
      'defaultEventBannerUrl', op.default_event_banner_url
    )
  )
  into v_result
  from public.organization_profile op
  join public.organizations o on o.id = op.org_id
where op.org_id = p_org_id and op.slug = v_slug
  and o.status = 'active'
limit 1;

  if v_result is null then
    raise exception 'NOT_FOUND';
  end if;

  return v_result;
end;$function$
;
create or replace function public.catalog_get_public_org_events_overview(p_org_id uuid, p_org_slug text, p_default_banner_url text, p_limit integer default 100, p_after uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_slug text := nullif(trim(p_org_slug), '');
  v_org_id uuid;
  v_result jsonb;
  v_cursor public.events%rowtype;

  -- defaults globaux (storage public)
  v_default_banner_url text := p_default_banner_url;

  -- org branding
  v_org_default_banner_url text;
begin
  if p_limit is null or p_limit < 1 or p_limit > 100 then raise exception 'VALIDATION_ERROR'; end if;
  if p_after is not null then
    select * into v_cursor from public.events where id=p_after and org_id=p_org_id and is_published=true;
    if not found then raise exception 'FORBIDDEN'; end if;
  end if;
  if v_slug is null then
    raise exception 'VALIDATION_ERROR: org_slug is required';
  end if;


  -- org id + default banner
  select
    op.org_id,
    case when op.default_event_banner_url like '%/public-assets/defaults/default_banner.webp' then null else nullif(trim(op.default_event_banner_url), '') end
  into
    v_org_id,
    v_org_default_banner_url
  from public.organization_profile op
  join public.organizations o on o.id = op.org_id
  where op.org_id = p_org_id and op.slug = v_slug
    and o.status = 'active';

  if v_org_id is null then
    raise exception 'NOT_FOUND';
  end if;

  select jsonb_build_object(
    'orgSlug', v_slug,
    'events', coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', e.id,
          'slug', e.slug,
          'title', e.title,
          'location', e.location,

          -- banner résolue (event -> org default -> global default)
          'bannerUrl', coalesce(
            case when e.banner_url like '%/public-assets/defaults/default_banner.webp' then null else nullif(trim(e.banner_url), '') end,
            v_org_default_banner_url,
            v_default_banner_url
          ),

          'startsAt', e.starts_at,
          'endsAt', e.ends_at,
          'registrationDeadline', e.registration_deadline,

          'isSoldOut', public.is_event_sold_out(e.id),
          'isRegistrationOpen', public.is_event_registration_open(e.id)
        )
        order by e.starts_at asc nulls last, e.created_at desc, e.id desc
      ),
      '[]'::jsonb
    )
  )
  into v_result
  from (
    select * from public.events e where e.org_id=v_org_id and e.is_published=true
    and (p_after is null or
      (v_cursor.starts_at is not null and (e.starts_at>v_cursor.starts_at or e.starts_at is null)) or
      (e.starts_at is not distinct from v_cursor.starts_at and
        (e.created_at<v_cursor.created_at or (e.created_at=v_cursor.created_at and e.id<v_cursor.id))))
    order by e.starts_at asc nulls last, e.created_at desc, e.id desc limit p_limit
  ) e;

  return v_result || jsonb_build_object('nextCursor', case when jsonb_array_length(v_result->'events')=p_limit
    then v_result->'events'->-1->>'id' else null end);
end;
$$;
create or replace function public.catalog_get_public_event_detail(p_org_id uuid,
  p_org_slug text,
  p_event_slug text, p_default_banner_url text, p_default_logo_url text
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $function$
declare
  v_org_slug text := nullif(trim(p_org_slug), '');
  v_event_slug text := nullif(trim(p_event_slug), '');
  v_org_id uuid;
  v_event_id uuid;

  v_org_profile jsonb;
  v_event jsonb;
  v_products jsonb;
  v_fields jsonb;
  v_field_groups jsonb;

  v_org_display_name text;
  v_org_primary_color text;
  v_default_primary_color text := '#e49d21';

  v_default_logo_url text := p_default_logo_url;
  v_default_banner_url text := p_default_banner_url;

  v_org_logo_url text;
  v_org_default_banner_url text;
begin
  perform set_config('search_path', 'pg_temp, public, extensions, private', true);

  if v_org_slug is null or v_event_slug is null then
    raise exception 'VALIDATION_ERROR: org_slug and event_slug are required';
  end if;


  select
    op.org_id,
    case when op.logo_url like '%/public-assets/defaults/default_logo.webp' then null else nullif(trim(op.logo_url), '') end,
    case when op.default_event_banner_url like '%/public-assets/defaults/default_banner.webp' then null else nullif(trim(op.default_event_banner_url), '') end,
    nullif(trim(op.display_name), ''),
    nullif(trim(op.primary_color), '')
  into
    v_org_id,
    v_org_logo_url,
    v_org_default_banner_url,
    v_org_display_name,
    v_org_primary_color
  from public.organization_profile op join public.organizations o on o.id=op.org_id
  where op.org_id = p_org_id and op.slug = v_org_slug and o.status='active'
  limit 1;

  if v_org_id is null then
    raise exception 'NOT_FOUND';
  end if;

  select e.id
  into v_event_id
  from public.events e
  where e.org_id = v_org_id
    and e.slug = v_event_slug
    and e.is_published = true
  limit 1;

  if v_event_id is null then
    raise exception 'NOT_FOUND';
  end if;

  select jsonb_build_object(
    'slug', v_org_slug,
    'displayName', v_org_display_name,
    'primaryColor', coalesce(v_org_primary_color, v_default_primary_color),
    'logoUrl', coalesce(v_org_logo_url, v_default_logo_url),
    'defaultEventBannerUrl', coalesce(v_org_default_banner_url, v_default_banner_url)
  )
  into v_org_profile;

  select jsonb_build_object(
    'id', e.id,
    'slug', e.slug,
    'title', e.title,
    'description', e.description,
    'charterText', e.charter_text,
    'location', e.location,
    'bannerUrl', coalesce(
      case when e.banner_url like '%/public-assets/defaults/default_banner.webp' then null else nullif(trim(e.banner_url), '') end,
      v_org_default_banner_url,
      v_default_banner_url
    ),
    'startsAt', e.starts_at,
    'endsAt', e.ends_at,
    'depositCents', e.deposit_cents,
    'maxAttendees', e.max_attendees,
    'registrationDeadline', e.registration_deadline,
    'isSoldOut', public.is_event_sold_out(e.id),
    'isRegistrationOpen', public.is_event_registration_open(e.id)
  )
  into v_event
  from public.events e
  where e.id = v_event_id;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', ep.id,
        'name', ep.name,
        'description', ep.description,
        'priceCents', ep.price_cents,
        'currency', ep.currency,
        'stockQty', ep.stock_qty,
        'soldQty', ep.sold_qty,
        'reservedQty', ep.reserved_qty,
        'createsAttendees', ep.creates_attendees,
        'attendeesPerUnit', ep.attendees_per_unit,
        'sortOrder', ep.sort_order
      )
      order by ep.sort_order asc, ep.created_at asc
    ),
    '[]'::jsonb
  )
  into v_products
  from (select * from public.event_products where event_id=v_event_id and is_active=true order by sort_order,created_at,id limit 1001) ep;
  if jsonb_array_length(v_products)>1000 then raise exception 'CATALOG_LIMIT_EXCEEDED'; end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', ffg.id,
        'label', ffg.label,
        'description', ffg.description,
        'sortOrder', ffg.sort_order
      )
      order by ffg.sort_order asc, ffg.created_at asc
    ),
    '[]'::jsonb
  )
  into v_field_groups
  from (select * from public.event_form_field_groups where event_id=v_event_id and is_active=true order by sort_order,created_at,id limit 1001) ffg;
  if jsonb_array_length(v_field_groups)>1000 then raise exception 'CATALOG_LIMIT_EXCEEDED'; end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', ff.id,
        'label', ff.label,
        'fieldKey', ff.field_key,
        'fieldType', ff.field_type,
        'isRequired', ff.is_required,
        'options', ff.options,
        'sortOrder', ff.sort_order,
        'groupId', ff.group_id
      )
      order by ff.sort_order asc, ff.created_at asc
    ),
    '[]'::jsonb
  )
  into v_fields
  from (select * from public.event_form_fields where event_id=v_event_id and is_active=true order by sort_order,created_at,id limit 1001) ff;
  if jsonb_array_length(v_fields)>1000 then raise exception 'CATALOG_LIMIT_EXCEEDED'; end if;

  return jsonb_build_object(
    'org', v_org_profile,
    'event', v_event,
    'products', v_products,
    'formFields', v_fields,
    'formFieldsGroups', v_field_groups
  );
end;
$function$;
create or replace function public.catalog_get_public_organization_sales_terms(p_org_id uuid,
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


  select jsonb_build_object(
    'sellerLegalName', op.seller_legal_name,
    'sellerAddress', op.seller_address,
    'sellerBusinessNumber', op.seller_business_number,
    'sellerType', op.seller_type,
    'displayName', op.display_name,
    'publicEmail', op.public_email,
    'phone', op.phone,
    'website', op.website,
    'salesTerms', op.sales_terms,
    'salesTermsVersion', op.sales_terms_version,
    'salesTermsAccepted', coalesce(op.sales_terms_accepted_at is not null and op.sales_terms_accepted_version=op.sales_terms_version, false),
    'salesTermsAvailable', coalesce(char_length(trim(op.sales_terms)) >= 200 and trim(coalesce(op.public_email,'')) ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$', false),
    'paidSalesAvailable', coalesce(
      o.status = 'active'
      and o.payments_provider = 'stripe'
      and owner_profile.stripe_connect_allowed = true
      and o.stripe_connected_account_id is not null
      and o.stripe_compliance_verified = true
      and o.stripe_details_submitted = true
      and o.stripe_charges_enabled = true
      and o.stripe_payouts_enabled = true
      and o.stripe_requirements_disabled_reason is null
      and jsonb_array_length(o.stripe_requirements_currently_due) = 0, false)
  )
  into v_result
  from public.organization_profile op
  join public.organizations o on o.id = op.org_id
  left join public.user_profile owner_profile on owner_profile.user_id = o.created_by
  where op.org_id = p_org_id and op.slug = v_slug and o.status='active'
  limit 1;

  if v_result is null then
    raise exception 'NOT_FOUND';
  end if;

  return v_result;
end;
$$;
create or replace function public.catalog_event_share(p_org_id uuid,p_event_id uuid,p_default_banner_url text)
returns jsonb language sql security definer set search_path=public,pg_temp as $$
select jsonb_build_object('orgName',o.name,'orgDescription',op.description,
 'eventTitle',e.title,'eventDescription',e.description,'bannerUrl',coalesce(case when e.banner_url like '%/public-assets/defaults/default_banner.webp' then null else nullif(trim(e.banner_url),'') end,case when op.default_event_banner_url like '%/public-assets/defaults/default_banner.webp' then null else nullif(trim(op.default_event_banner_url),'') end,p_default_banner_url))
from public.events e join public.organizations o on o.id=e.org_id join public.organization_profile op on op.org_id=o.id
where o.id=p_org_id and o.status='active' and e.id=p_event_id and e.is_published=true;
$$;
revoke all on function public.catalog_get_public_org_by_slug(uuid,text) from PUBLIC,anon,authenticated;
grant execute on function public.catalog_get_public_org_by_slug(uuid,text) to service_role;
revoke all on function public.catalog_get_public_org_events_overview(uuid,text,text,integer,uuid) from PUBLIC,anon,authenticated;
grant execute on function public.catalog_get_public_org_events_overview(uuid,text,text,integer,uuid) to service_role;
revoke all on function public.catalog_get_public_event_detail(uuid,text,text,text,text) from PUBLIC,anon,authenticated;
grant execute on function public.catalog_get_public_event_detail(uuid,text,text,text,text) to service_role;
revoke all on function public.catalog_get_public_organization_sales_terms(uuid,text) from PUBLIC,anon,authenticated;
grant execute on function public.catalog_get_public_organization_sales_terms(uuid,text) to service_role;
revoke all on function public.catalog_event_share(uuid,uuid,text) from PUBLIC,anon,authenticated;
grant execute on function public.catalog_event_share(uuid,uuid,text) to service_role;
commit;
