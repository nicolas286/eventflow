-- B1.2 additive service operation. The Edge supplies its verified actor and
-- authorizes the organization before calling this atomic billing patch.
-- Historical browser RPC grants are closed only after frontend publication.
BEGIN;

create or replace function public.organizer_upsert_organization_billing(
  p_actor_id uuid,
  p_input jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_user_id uuid := p_actor_id;
  v_org_id uuid;

  v_legal_name text;
  v_vat_country_code text;
  v_vat_number text;
  v_address_line1 text;
  v_address_line2 text;
  v_postal_code text;
  v_city text;
  v_country_code text;
  v_billing_email text;
  v_invoice_reference text;

  has_legal_name boolean := false;
  has_vat_country_code boolean := false;
  has_vat_number boolean := false;
  has_address_line1 boolean := false;
  has_address_line2 boolean := false;
  has_postal_code boolean := false;
  has_city boolean := false;
  has_country_code boolean := false;
  has_billing_email boolean := false;
  has_invoice_reference boolean := false;

  v_exists boolean := false;

  v_cur_vat_country_code text;
  v_cur_vat_number text;
  v_vat_identity_changed boolean := false;

  v_result jsonb;
begin
  if v_user_id is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  if p_input is null or jsonb_typeof(p_input) <> 'object' then
    raise exception 'VALIDATION_ERROR: invalid payload';
  end if;

  if p_input ? 'is_vat_validated'
    or p_input ? 'vat_validated_at'
    or p_input ? 'vat_validation_source'
  then
    raise exception 'VALIDATION_ERROR: forbidden billing validation fields';
  end if;

  if exists (select 1 from jsonb_object_keys(p_input) key where key not in (
    'org_id','legal_name','vat_country_code','vat_number','address_line1','address_line2',
    'postal_code','city','country_code','billing_email','invoice_reference'
  )) then
    raise exception 'VALIDATION_ERROR: invalid billing fields';
  end if;

  v_org_id := nullif(trim(p_input->>'org_id'), '')::uuid;

  if v_org_id is null then
    raise exception 'VALIDATION_ERROR: org_id is required';
  end if;

  -- Organization manager authorization is performed by the Edge.

  perform private.assert_rate_limit(
    'upsert_org_billing:user:' || v_user_id::text || ':org:' || v_org_id::text,
    60,
    60
  );

  perform 1
  from public.organizations o
  where o.id = v_org_id;

  if not found then
    raise exception 'NOT_FOUND';
  end if;

  if p_input ? 'legal_name' then
    has_legal_name := true;
    v_legal_name := nullif(trim(p_input->>'legal_name'), '');
  end if;

  if p_input ? 'vat_country_code' then
    has_vat_country_code := true;
    v_vat_country_code := nullif(trim(p_input->>'vat_country_code'), '');
    if v_vat_country_code is not null then
      v_vat_country_code := upper(v_vat_country_code);
    end if;
  end if;

  if p_input ? 'vat_number' then
    has_vat_number := true;
    v_vat_number := nullif(trim(p_input->>'vat_number'), '');
    if v_vat_number is not null then
      v_vat_number := upper(regexp_replace(v_vat_number, '\s+', '', 'g'));
    end if;
  end if;

  if p_input ? 'address_line1' then
    has_address_line1 := true;
    v_address_line1 := nullif(trim(p_input->>'address_line1'), '');
  end if;

  if p_input ? 'address_line2' then
    has_address_line2 := true;
    v_address_line2 := nullif(trim(p_input->>'address_line2'), '');
  end if;

  if p_input ? 'postal_code' then
    has_postal_code := true;
    v_postal_code := nullif(trim(p_input->>'postal_code'), '');
  end if;

  if p_input ? 'city' then
    has_city := true;
    v_city := nullif(trim(p_input->>'city'), '');
  end if;

  if p_input ? 'country_code' then
    has_country_code := true;
    v_country_code := nullif(trim(p_input->>'country_code'), '');
    if v_country_code is not null then
      v_country_code := upper(v_country_code);
    end if;
  end if;

  if p_input ? 'billing_email' then
    has_billing_email := true;
    v_billing_email := nullif(trim(p_input->>'billing_email'), '');
    if v_billing_email is not null then
      v_billing_email := lower(v_billing_email);
    end if;
  end if;

  if p_input ? 'invoice_reference' then
    has_invoice_reference := true;
    v_invoice_reference := nullif(trim(p_input->>'invoice_reference'), '');
  end if;

  if not (
    has_legal_name
    or has_vat_country_code
    or has_vat_number
    or has_address_line1
    or has_address_line2
    or has_postal_code
    or has_city
    or has_country_code
    or has_billing_email
    or has_invoice_reference
  ) then
    raise exception 'VALIDATION_ERROR: no fields to update';
  end if;

  if has_legal_name then
    if v_legal_name is null then
      raise exception 'VALIDATION_ERROR: legal_name cannot be empty';
    end if;
    if length(v_legal_name) < 3 then
      raise exception 'VALIDATION_ERROR: legal_name too short';
    end if;
    if length(v_legal_name) > 160 then
      raise exception 'VALIDATION_ERROR: legal_name too long';
    end if;
  end if;

  if has_address_line1 then
    if v_address_line1 is null then
      raise exception 'VALIDATION_ERROR: address_line1 cannot be empty';
    end if;
    if length(v_address_line1) < 2 then
      raise exception 'VALIDATION_ERROR: address_line1 too short';
    end if;
    if length(v_address_line1) > 200 then
      raise exception 'VALIDATION_ERROR: address_line1 too long';
    end if;
  end if;

  if has_address_line2 and v_address_line2 is not null and length(v_address_line2) > 200 then
    raise exception 'VALIDATION_ERROR: address_line2 too long';
  end if;

  if has_postal_code then
    if v_postal_code is null then
      raise exception 'VALIDATION_ERROR: postal_code cannot be empty';
    end if;
    if length(v_postal_code) < 2 then
      raise exception 'VALIDATION_ERROR: postal_code too short';
    end if;
    if length(v_postal_code) > 20 then
      raise exception 'VALIDATION_ERROR: postal_code too long';
    end if;
  end if;

  if has_city then
    if v_city is null then
      raise exception 'VALIDATION_ERROR: city cannot be empty';
    end if;
    if length(v_city) < 2 then
      raise exception 'VALIDATION_ERROR: city too short';
    end if;
    if length(v_city) > 120 then
      raise exception 'VALIDATION_ERROR: city too long';
    end if;
  end if;

  if has_country_code then
    if v_country_code is null then
      raise exception 'VALIDATION_ERROR: country_code cannot be empty';
    end if;
    if v_country_code !~ '^[A-Z]{2}$' then
      raise exception 'VALIDATION_ERROR: country_code must be ISO-2';
    end if;
  end if;

  if has_vat_country_code and v_vat_country_code is not null and v_vat_country_code !~ '^[A-Z]{2}$' then
    raise exception 'VALIDATION_ERROR: vat_country_code must be ISO-2';
  end if;

  if has_vat_number and v_vat_number is not null then
    if length(v_vat_number) < 6 then
      raise exception 'VALIDATION_ERROR: vat_number too short';
    end if;
    if length(v_vat_number) > 20 then
      raise exception 'VALIDATION_ERROR: vat_number too long';
    end if;
  end if;

  if has_billing_email and v_billing_email is not null then
    if length(v_billing_email) > 254 then
      raise exception 'VALIDATION_ERROR: billing_email too long';
    end if;
    if v_billing_email !~* '^[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}$' then
      raise exception 'VALIDATION_ERROR: billing_email invalid';
    end if;
  end if;

  if has_invoice_reference and v_invoice_reference is not null and length(v_invoice_reference) > 64 then
    raise exception 'VALIDATION_ERROR: invoice_reference too long';
  end if;

  if has_vat_country_code and has_vat_number then
    if v_vat_country_code is not null and v_vat_number is null then
      raise exception 'VALIDATION_ERROR: vat_number required when vat_country_code is set';
    end if;

    if v_vat_number is not null and v_vat_country_code is null then
      raise exception 'VALIDATION_ERROR: vat_country_code required when vat_number is set';
    end if;
  end if;

  select exists(
    select 1
    from public.organization_billing ob
    where ob.org_id = v_org_id
  )
  into v_exists;

  if v_exists = false then
    if not (
      has_legal_name
      and has_address_line1
      and has_postal_code
      and has_city
      and has_country_code
    ) then
      raise exception 'VALIDATION_ERROR: missing required fields for first billing setup';
    end if;

    insert into public.organization_billing (
      org_id,
      legal_name,
      vat_country_code,
      vat_number,
      address_line1,
      address_line2,
      postal_code,
      city,
      country_code,
      billing_email,
      invoice_reference,
      is_vat_validated,
      vat_validated_at,
      vat_validation_source
    )
    values (
      v_org_id,
      v_legal_name,
      v_vat_country_code,
      v_vat_number,
      v_address_line1,
      v_address_line2,
      v_postal_code,
      v_city,
      v_country_code,
      v_billing_email,
      v_invoice_reference,
      false,
      null,
      null
    );
  else
    select ob.vat_country_code, ob.vat_number
    into v_cur_vat_country_code, v_cur_vat_number
    from public.organization_billing ob
    where ob.org_id = v_org_id;

    if has_vat_country_code and v_vat_country_code is distinct from v_cur_vat_country_code then
      v_vat_identity_changed := true;
    end if;

    if has_vat_number and v_vat_number is distinct from v_cur_vat_number then
      v_vat_identity_changed := true;
    end if;

    update public.organization_billing ob
    set
      legal_name = case when has_legal_name then v_legal_name else ob.legal_name end,
      vat_country_code = case when has_vat_country_code then v_vat_country_code else ob.vat_country_code end,
      vat_number = case when has_vat_number then v_vat_number else ob.vat_number end,
      address_line1 = case when has_address_line1 then v_address_line1 else ob.address_line1 end,
      address_line2 = case when has_address_line2 then v_address_line2 else ob.address_line2 end,
      postal_code = case when has_postal_code then v_postal_code else ob.postal_code end,
      city = case when has_city then v_city else ob.city end,
      country_code = case when has_country_code then v_country_code else ob.country_code end,
      billing_email = case when has_billing_email then v_billing_email else ob.billing_email end,
      invoice_reference = case when has_invoice_reference then v_invoice_reference else ob.invoice_reference end,

      is_vat_validated = case when v_vat_identity_changed then false else ob.is_vat_validated end,
      vat_validated_at = case when v_vat_identity_changed then null else ob.vat_validated_at end,
      vat_validation_source = case when v_vat_identity_changed then null else ob.vat_validation_source end,
      updated_at = now()
    where ob.org_id = v_org_id;
  end if;

  select jsonb_build_object(
    'orgId', ob.org_id,
    'legalName', ob.legal_name,
    'vatCountryCode', ob.vat_country_code,
    'vatNumber', ob.vat_number,
    'addressLine1', ob.address_line1,
    'addressLine2', ob.address_line2,
    'postalCode', ob.postal_code,
    'city', ob.city,
    'countryCode', ob.country_code,
    'billingEmail', ob.billing_email,
    'invoiceReference', ob.invoice_reference,
    'isVatValidated', ob.is_vat_validated,
    'vatValidatedAt', ob.vat_validated_at,
    'vatValidationSource', ob.vat_validation_source,
    'createdAt', ob.created_at,
    'updatedAt', ob.updated_at
  )
  into v_result
  from public.organization_billing ob
  where ob.org_id = v_org_id;

  return v_result;

exception
  when invalid_text_representation then
    raise exception 'VALIDATION_ERROR: invalid uuid or value type';
  when unique_violation then
    raise exception 'CONFLICT';
  when others then
    raise;
end;
$$;

REVOKE ALL ON FUNCTION public.organizer_upsert_organization_billing(uuid,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.organizer_upsert_organization_billing(uuid,jsonb) TO service_role;
COMMIT;
