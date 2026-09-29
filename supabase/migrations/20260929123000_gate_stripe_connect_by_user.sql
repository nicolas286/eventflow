begin;

alter table public.user_profile
  add column if not exists stripe_connect_allowed boolean not null default false;

comment on column public.user_profile.stripe_connect_allowed is
  'Server-managed allowlist for Stripe Connect onboarding and ticket payments.';

-- Preserve the already-onboarded pilot accounts. Every other user starts on
-- bank transfer and can only be enabled by a trusted server/database operator.
update public.user_profile up
set stripe_connect_allowed = true,
    updated_at = now()
where exists (
  select 1
  from public.organizations o
  where o.created_by = up.user_id
    and o.stripe_connected_account_id is not null
);

update public.organizations o
set payments_provider = 'bank_transfer',
    stripe_migration_required = false,
    updated_at = now()
where not exists (
  select 1
  from public.user_profile up
  where up.user_id = o.created_by
    and up.stripe_connect_allowed = true
);

create or replace function private.protect_stripe_connect_allowlist()
returns trigger
language plpgsql
set search_path = pg_catalog, public, auth
as $$
begin
  if new.stripe_connect_allowed = true
     and (
       tg_op = 'INSERT'
       or old.stripe_connect_allowed is distinct from new.stripe_connect_allowed
     )
     and coalesce(auth.role(), '') <> 'service_role'
     and current_user not in ('postgres', 'service_role') then
    raise exception 'FORBIDDEN';
  end if;

  if tg_op = 'UPDATE'
     and old.stripe_connect_allowed = true
     and new.stripe_connect_allowed = false
     and coalesce(auth.role(), '') <> 'service_role'
     and current_user not in ('postgres', 'service_role') then
    raise exception 'FORBIDDEN';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_protect_stripe_connect_allowlist on public.user_profile;
create trigger trg_protect_stripe_connect_allowlist
before insert or update of stripe_connect_allowed on public.user_profile
for each row execute function private.protect_stripe_connect_allowlist();

create or replace function private.use_stripe_for_new_organizations()
returns trigger
language plpgsql
set search_path = pg_catalog, public, private
as $$
begin
  new.payments_provider := case
    when exists (
      select 1
      from public.user_profile up
      where up.user_id = new.created_by
        and up.stripe_connect_allowed = true
    ) then 'stripe'
    else 'bank_transfer'
  end;
  return new;
end;
$$;

create or replace function public.update_organization_payment_settings(
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
  v_user_id uuid := auth.uid();
  v_provider text := lower(nullif(trim(coalesce(p_provider, '')), ''));
  v_beneficiary text := nullif(
    trim(regexp_replace(coalesce(p_bank_transfer_beneficiary, ''), '\s+', ' ', 'g')),
    ''
  );
  v_iban text := nullif(
    upper(regexp_replace(coalesce(p_bank_transfer_iban, ''), '\s+', '', 'g')),
    ''
  );
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
    'update_org_payment:user:' || v_user_id::text || ':org:' || p_org_id::text,
    30,
    60
  );

  if v_provider is null or v_provider not in ('stripe', 'bank_transfer') then
    raise exception 'VALIDATION_ERROR: invalid payment provider';
  end if;

  if v_provider = 'stripe'
     and (
       not exists (
         select 1
         from public.user_profile up
         where up.user_id = v_user_id
           and up.stripe_connect_allowed = true
       )
       or not exists (
         select 1
         from public.organizations o
         join public.user_profile owner_profile
           on owner_profile.user_id = o.created_by
         where o.id = p_org_id
           and owner_profile.stripe_connect_allowed = true
       )
     ) then
    raise exception 'STRIPE_CONNECT_NOT_ALLOWED';
  end if;

  if v_beneficiary is not null
     and char_length(v_beneficiary) not between 2 and 160 then
    raise exception 'VALIDATION_ERROR: invalid bank transfer beneficiary';
  end if;

  if v_iban is not null
     and (
       char_length(v_iban) not between 15 and 34
       or v_iban !~ '^[A-Z]{2}[0-9A-Z]+$'
     ) then
    raise exception 'VALIDATION_ERROR: invalid IBAN';
  end if;

  if v_provider = 'bank_transfer'
     and (v_beneficiary is null or v_iban is null) then
    raise exception 'VALIDATION_ERROR: bank transfer details are required';
  end if;

  update public.organizations o
  set
    payments_provider = v_provider,
    bank_transfer_beneficiary = v_beneficiary,
    bank_transfer_iban = v_iban,
    stripe_migration_required = case
      when v_provider = 'bank_transfer' then false
      else o.stripe_migration_required
    end,
    updated_at = now()
  where o.id = p_org_id;

  if not found then
    raise exception 'NOT_FOUND';
  end if;

  select jsonb_build_object(
    'orgId', o.id,
    'paymentsProvider', o.payments_provider,
    'bankTransferBeneficiary', o.bank_transfer_beneficiary,
    'bankTransferIban', o.bank_transfer_iban
  )
  into v_result
  from public.organizations o
  where o.id = p_org_id;

  return v_result;
end;
$$;

revoke all on function public.update_organization_payment_settings(uuid, text, text, text)
  from public, anon, authenticated;
grant execute on function public.update_organization_payment_settings(uuid, text, text, text)
  to authenticated;

commit;
