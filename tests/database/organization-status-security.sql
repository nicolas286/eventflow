-- Disposable database only; exercise the legacy SECURITY DEFINER path with a
-- real authenticated owner, before the deferred browser ACL closure.
begin;
update private.platform_settings set registrations_open=true where singleton;
insert into auth.users(id,aud,role,email,raw_user_meta_data)
values ('d6000000-0000-4000-8000-000000000001','authenticated','authenticated',
 'status-owner@example.test','{"platform_terms_version":"2026-10-01","platform_terms_accepted":true}');
insert into public.organizations(id,type,name,status,created_by)
values ('d6000000-0000-4000-8000-000000000011','association','Status fixture','suspended',
 'd6000000-0000-4000-8000-000000000001');
insert into public.organization_profile(org_id,slug,display_name)
values ('d6000000-0000-4000-8000-000000000011','status-fixture','Status fixture');
insert into public.organization_members(org_id,user_id,role)
values ('d6000000-0000-4000-8000-000000000011','d6000000-0000-4000-8000-000000000001','owner');
set local role authenticated;
set local "request.jwt.claim.sub"='d6000000-0000-4000-8000-000000000001';
set local "request.jwt.claim.role"='authenticated';
do $$ begin
  begin
    perform public.update_organization('{"org_id":"d6000000-0000-4000-8000-000000000011","status":"active"}');
    raise exception 'Owner reactivated a platform-suspended organization';
  exception when insufficient_privilege then
    if sqlerrm <> 'FORBIDDEN: organization status is platform-managed' then raise; end if;
  end;
  -- Unrelated profile editing remains possible while suspended.
  perform public.update_organization('{"org_id":"d6000000-0000-4000-8000-000000000011","name":"Status renamed"}');
end $$;
reset role;
do $$ begin
  if not exists(select 1 from public.organizations where id='d6000000-0000-4000-8000-000000000011'
    and status='suspended' and name='Status renamed') then
    raise exception 'Suspension changed or ordinary profile update failed';
  end if;
end $$;
set local role service_role;
set local "request.jwt.claim.role"='service_role';
update public.organizations set status='active' where id='d6000000-0000-4000-8000-000000000011';
do $$ begin
  if not exists(select 1 from public.organizations where id='d6000000-0000-4000-8000-000000000011' and status='active') then
    raise exception 'Platform service cannot reactivate organization';
  end if;
end $$;
rollback;
