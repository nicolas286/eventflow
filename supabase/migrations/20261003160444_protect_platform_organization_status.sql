-- Organization lifecycle status belongs to platform administration. Keep this
-- guard during the rollout while legacy browser RPCs can still be called.
begin;
create or replace function private.protect_platform_organization_status()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  -- SECURITY DEFINER changes current_user, but preserves the verified JWT role.
  -- Service operations and migrations remain able to suspend/reactivate an org.
  if new.status is distinct from old.status
     and coalesce(auth.role(), '') in ('anon', 'authenticated') then
    raise exception 'FORBIDDEN: organization status is platform-managed'
      using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function private.protect_platform_organization_status() from public, anon, authenticated;
create trigger protect_platform_organization_status
before update of status on public.organizations
for each row execute function private.protect_platform_organization_status();
commit;
