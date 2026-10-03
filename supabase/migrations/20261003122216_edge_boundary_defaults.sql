-- Additive B6: explicit server actors; latest financial/acceptance rules preserved.

create or replace function public.organizer_accept_organization_sales_terms(
  p_actor_id uuid,
  p_org_id uuid,
  p_sales_terms text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_user_id uuid := p_actor_id;
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

REVOKE ALL ON FUNCTION public.organizer_accept_organization_sales_terms(uuid,uuid,text) FROM PUBLIC,anon,authenticated;

GRANT EXECUTE ON FUNCTION public.organizer_accept_organization_sales_terms(uuid,uuid,text) TO service_role;

create or replace function public.organizer_update_organization_payment_settings(
  p_actor_id uuid,
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
  v_user_id uuid := p_actor_id;
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

REVOKE ALL ON FUNCTION public.organizer_update_organization_payment_settings(uuid,uuid,text,text,text) FROM PUBLIC,anon,authenticated;

GRANT EXECUTE ON FUNCTION public.organizer_update_organization_payment_settings(uuid,uuid,text,text,text) TO service_role;

-- Existing objects remain compatible until the separate deferred closure.
-- Supabase creators observed on replay: postgres and supabase_admin.
-- PostgreSQL implicit PUBLIC EXECUTE is global: a schema-local REVOKE alone
-- cannot remove it. Auth/Storage existing grants and RLS are untouched.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
DO $defaults$ DECLARE creator text; target text; BEGIN
 FOREACH creator IN ARRAY ARRAY['postgres'] LOOP
  FOREACH target IN ARRAY ARRAY['public','private','graphql_public'] LOOP
   EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA %I REVOKE ALL ON TABLES FROM PUBLIC,anon,authenticated',creator,target);
   EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA %I REVOKE ALL ON SEQUENCES FROM PUBLIC,anon,authenticated',creator,target);
   EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA %I REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC,anon,authenticated',creator,target);
  END LOOP;
 END LOOP;
END $defaults$;
