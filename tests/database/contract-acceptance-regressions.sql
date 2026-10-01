-- Disposable fixtures only; run on the rebuilt local database.
begin;
insert into auth.users(id,aud,role,email,encrypted_password,created_at,updated_at,raw_user_meta_data)
select ('94000000-0000-4000-8000-00000000000'||n)::uuid,'authenticated','authenticated','contract-'||n||'@example.test','',now(),now(),'{"platform_terms_version":"2026-10-01","platform_terms_accepted":true}'::jsonb from generate_series(1,2)n;
insert into public.organizations(id,type,name,created_by,plan)
select ('94000000-0000-4000-8000-00000000001'||n)::uuid,'association','Contract fixture '||n,('94000000-0000-4000-8000-00000000000'||n)::uuid,'pro' from generate_series(1,2)n;
insert into public.organization_members(org_id,user_id,role)
select ('94000000-0000-4000-8000-00000000001'||n)::uuid,('94000000-0000-4000-8000-00000000000'||n)::uuid,'owner' from generate_series(1,2)n;
insert into public.organization_profile(org_id,slug,display_name,public_email)
select ('94000000-0000-4000-8000-00000000001'||n)::uuid,'contract-fixture-'||n,'Contract fixture '||n,'contract-'||n||'@example.test' from generate_series(1,2)n;
insert into public.events(id,org_id,slug,title,is_published,starts_at,ends_at)
values('94000000-0000-4000-8000-000000000021','94000000-0000-4000-8000-000000000011','contract-fixture','Contract fixture',true,now()+interval '7 days',now()+interval '8 days');
insert into public.event_products(id,event_id,name,price_cents,currency,stock_qty,creates_attendees)
values('94000000-0000-4000-8000-000000000031','94000000-0000-4000-8000-000000000021','Free',0,'EUR',100,true),
('94000000-0000-4000-8000-000000000032','94000000-0000-4000-8000-000000000021','Paid',1000,'EUR',100,true);

insert into public.promo_codes(org_id,event_id,code,discount_percent) values('94000000-0000-4000-8000-000000000011','94000000-0000-4000-8000-000000000021','FREEFIXTURE',100);

set local role authenticated;
set local "request.jwt.claim.role"='authenticated';
set local "request.jwt.claim.sub"='94000000-0000-4000-8000-000000000001';
do $$ begin
 begin
 perform public.accept_organization_platform_agreements('94000000-0000-4000-8000-000000000012','2026-10-01','2026-10-01','2026-10-01','2026-10-01');
 raise exception 'Cross-organization acceptance allowed';
 exception when raise_exception then if sqlerrm <> 'FORBIDDEN' then raise; end if; end;
 begin
 perform public.update_organization_seller_identity('94000000-0000-4000-8000-000000000012','Fixture seller','Rue Example 10, 5000 Namur',null,'non_professional','+3200000000');
 raise exception 'Cross-organization identity mutation allowed';
 exception when raise_exception then if sqlerrm <> 'FORBIDDEN' then raise; end if; end;
 begin
 perform public.accept_organization_platform_agreements('94000000-0000-4000-8000-000000000011','old','2026-10-01','2026-10-01','2026-10-01');
 raise exception 'Stale agreement accepted';
 exception when raise_exception then if sqlerrm <> 'PLATFORM_AGREEMENTS_CHANGED' then raise; end if; end;
 begin
 update public.organization_profile set connect_terms_accepted_version='2026-10-01' where org_id='94000000-0000-4000-8000-000000000011';
 raise exception 'Direct forged agreement accepted';
 exception when raise_exception then if sqlerrm <> 'FORBIDDEN' then raise; end if; end;
end $$;
reset role;
set local role service_role;
set local "request.jwt.claim.role"='service_role';
do $$ declare r jsonb; n integer; begin
 -- Free orders need only the participant conditions, not a Connect account.
 r:=public.create_order_intent_with_terms('94000000-0000-4000-8000-000000000021','[{"event_product_id":"94000000-0000-4000-8000-000000000031","quantity":1}]','[{"event_product_id":"94000000-0000-4000-8000-000000000031"}]','{"email":"buyer@example.test"}',null,null,'2026-10-01',repeat('Fixture participant conditions. ',10),null);
 if not exists(select 1 from public.orders where id=(r->>'order_id')::uuid and terms_accepted_at is not null and platform_terms_snapshot is not null and organizer_sales_terms_snapshot is null) then raise exception 'Free-order acceptance missing'; end if;
 r:=public.create_order_intent_with_terms('94000000-0000-4000-8000-000000000021','[{"event_product_id":"94000000-0000-4000-8000-000000000032","quantity":1}]','[{"event_product_id":"94000000-0000-4000-8000-000000000032"}]','{"email":"buyer@example.test"}',null,'FREEFIXTURE','2026-10-01',repeat('Fixture participant conditions. ',10),null);
 if not exists(select 1 from public.orders where id=(r->>'order_id')::uuid and terms_accepted_at is not null and platform_terms_snapshot is not null) or (r->>'payment_required')::boolean then raise exception 'Fully discounted order acceptance missing'; end if;
 select count(*) into n from public.orders where event_id='94000000-0000-4000-8000-000000000021';
 begin
 perform public.create_order_intent_with_terms('94000000-0000-4000-8000-000000000021','[{"event_product_id":"94000000-0000-4000-8000-000000000032","quantity":1}]','[{"event_product_id":"94000000-0000-4000-8000-000000000032"}]','{"email":"buyer@example.test"}',null,null,'2026-10-01',repeat('Fixture participant conditions. ',10),null);
 raise exception 'Paid order with missing identity accepted';
 exception when raise_exception then if sqlerrm <> 'ORGANIZER_SELLER_IDENTITY_REQUIRED' then raise; end if; end;
 if (select count(*) from public.orders where event_id='94000000-0000-4000-8000-000000000021') <> n then raise exception 'Rejected checkout left an orphan order'; end if;
end $$;
reset role;
set local role authenticated;
set local "request.jwt.claim.role"='authenticated';
select public.update_organization_seller_identity('94000000-0000-4000-8000-000000000011','Fixture seller','Rue Example 10, 5000 Namur',null,'non_professional','+3200000000');
select public.accept_organization_sales_terms('94000000-0000-4000-8000-000000000011',(select sales_terms from public.organization_profile where org_id='94000000-0000-4000-8000-000000000011'));
reset role;
set local role service_role;
set local "request.jwt.claim.role"='service_role';
do $$ begin
 begin
 perform public.assert_organization_contract_ready('94000000-0000-4000-8000-000000000011');
 raise exception 'Missing annex acceptance allowed';
 exception when raise_exception then if sqlerrm <> 'ORGANIZER_PLATFORM_AGREEMENTS_REQUIRED' then raise; end if; end;
end $$;
reset role;
set local role authenticated;
set local "request.jwt.claim.role"='authenticated';
select public.accept_organization_platform_agreements('94000000-0000-4000-8000-000000000011','2026-10-01','2026-10-01','2026-10-01','2026-10-01');
reset role;
set local role service_role;
set local "request.jwt.claim.role"='service_role';
do $$ declare r jsonb; v text; t text; begin
 update public.user_profile set stripe_connect_allowed=true where user_id='94000000-0000-4000-8000-000000000001';
 update public.organizations set stripe_connected_account_id='acct_contract_fixture',stripe_compliance_verified=true,stripe_details_submitted=true,stripe_charges_enabled=true,stripe_payouts_enabled=true where id='94000000-0000-4000-8000-000000000011';
 select sales_terms_version,sales_terms into v,t from public.organization_profile where org_id='94000000-0000-4000-8000-000000000011';
 begin
 perform public.create_order_intent_with_terms('94000000-0000-4000-8000-000000000021','[{"event_product_id":"94000000-0000-4000-8000-000000000032","quantity":1}]','[{"event_product_id":"94000000-0000-4000-8000-000000000032"}]','{"email":"buyer@example.test"}',null,null,'2026-10-01',repeat('Fixture participant conditions. ',10),'stale');
 raise exception 'Stale buyer version accepted';
 exception when raise_exception then if sqlerrm <> 'TERMS_CHANGED_RELOAD' then raise; end if; end;
 r:=public.create_order_intent_with_terms('94000000-0000-4000-8000-000000000021','[{"event_product_id":"94000000-0000-4000-8000-000000000032","quantity":1}]','[{"event_product_id":"94000000-0000-4000-8000-000000000032"}]','{"email":"buyer@example.test"}',null,null,'2026-10-01',repeat('Fixture participant conditions. ',10),v);
 update public.orders set stripe_checkout_expires_at=now()+interval '35 minutes' where id=(r->>'order_id')::uuid;
 if public.expire_unstarted_checkout((r->>'order_id')::uuid) then raise exception 'A started checkout reservation was released'; end if;
 update public.orders set stripe_checkout_expires_at=null where id=(r->>'order_id')::uuid;
 if not public.expire_unstarted_checkout((r->>'order_id')::uuid) or public.expire_unstarted_checkout((r->>'order_id')::uuid) then raise exception 'Unstarted reservation cleanup is not idempotent'; end if;
 if (select reserved_qty from public.event_products where id='94000000-0000-4000-8000-000000000032')<>0 then raise exception 'Unstarted checkout retained stock'; end if;
 update public.organization_profile set display_name='Changed after purchase' where org_id='94000000-0000-4000-8000-000000000011';
 if not exists(select 1 from public.orders where id=(r->>'order_id')::uuid and organizer_sales_terms_version=v and organizer_sales_terms_snapshot=t and organizer_identity_snapshot->>'legal_name'='Fixture seller' and organizer_identity_snapshot->>'display_name'='Contract fixture 1') then raise exception 'Accepted contract snapshot changed'; end if;
 begin
 perform public.assert_organization_contract_ready('94000000-0000-4000-8000-000000000011');
 raise exception 'Changed seller identity did not require revalidation';
 exception when raise_exception then if sqlerrm <> 'ORGANIZER_SALES_TERMS_REQUIRED' then raise; end if; end;
end $$;
reset role;
do $$ begin
 if (select count(*) from private.user_platform_terms_acceptances where user_id in ('94000000-0000-4000-8000-000000000001','94000000-0000-4000-8000-000000000002'))<>2 then raise exception 'Signup proof missing'; end if;
 if not exists(select 1 from private.organization_platform_acceptances where org_id='94000000-0000-4000-8000-000000000011'
   and accepted_by='94000000-0000-4000-8000-000000000001' and signer_email='contract-1@example.test'
   and organization_identity_snapshot->>'display_name'='Contract fixture 1'
   and platform_terms_version='2026-10-01' and privacy_version='2026-10-01'
   and char_length(connect_snapshot)>100 and char_length(dpa_snapshot)>100
   and char_length(platform_terms_snapshot)>100 and char_length(privacy_snapshot)>100) then raise exception 'Four-document acceptance evidence is incomplete'; end if;
 if has_function_privilege('authenticated','public.create_order_intent_with_terms(uuid,jsonb,jsonb,jsonb,text,text,text,text,text)','execute') then raise exception 'Buyer proof RPC exposed'; end if;
 if has_table_privilege('authenticated','private.organization_platform_acceptances','insert') then raise exception 'Acceptance audit exposed'; end if;
end $$;
rollback;
