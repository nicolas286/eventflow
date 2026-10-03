-- B2.1 additive internal operations, disposable fixtures and rolled-back limits.
BEGIN;
UPDATE private.platform_settings SET registrations_open=true WHERE singleton;
INSERT INTO auth.users(id,aud,role,email,encrypted_password,created_at,updated_at,raw_user_meta_data)
SELECT ('b2100000-0000-4000-8000-00000000000'||n)::uuid,'authenticated','authenticated',
 'b21-'||n||'@example.test','',now(),now(),'{"platform_terms_version":"2026-10-01","platform_terms_accepted":true}'::jsonb
FROM generate_series(1,2)n;
INSERT INTO public.organizations(id,type,name,created_by,plan,plan_expires_at)
SELECT ('b2100000-0000-4000-8000-00000000001'||n)::uuid,'association','B21 Organization '||n,
 ('b2100000-0000-4000-8000-00000000000'||n)::uuid,'pro',now()+interval '30 days'
FROM generate_series(1,2)n;
INSERT INTO public.organization_profile(org_id,slug,display_name)
SELECT ('b2100000-0000-4000-8000-00000000001'||n)::uuid,'b21-org-'||n,'B21 Organization '||n FROM generate_series(1,2)n;
INSERT INTO public.events(id,org_id,slug,title,charter_text,starts_at,ends_at,registration_deadline,is_published)
VALUES ('b2100000-0000-4000-8000-000000000021','b2100000-0000-4000-8000-000000000011','b21-source','B21 Source','Fixture charter',now()+interval '10 days',now()+interval '11 days',now()+interval '9 days',true),
 ('b2100000-0000-4000-8000-000000000022','b2100000-0000-4000-8000-000000000012','b21-foreign','B21 Foreign',null,null,null,null,false);
INSERT INTO public.event_form_field_groups(id,event_id,label,description)
VALUES ('b2100000-0000-4000-8000-000000000031','b2100000-0000-4000-8000-000000000021','First group','Preserved description'),
 ('b2100000-0000-4000-8000-000000000032','b2100000-0000-4000-8000-000000000021','Second group',null);
INSERT INTO public.event_form_fields(event_id,group_id,field_key,label,field_type,is_active,options)
VALUES ('b2100000-0000-4000-8000-000000000021','b2100000-0000-4000-8000-000000000031','grouped','Grouped','text',true,'[{"businessCamelKey":{"snake_key":"unchanged"}}]'),
 ('b2100000-0000-4000-8000-000000000021','b2100000-0000-4000-8000-000000000032','inactive','Inactive','text',false,null),
 ('b2100000-0000-4000-8000-000000000021',null,'ungrouped','Ungrouped','text',true,null);
INSERT INTO public.event_products(event_id,name,price_cents,currency,stock_qty,reserved_qty,sold_qty,creates_attendees,is_gatekeeper,close_event_when_sold_out)
VALUES ('b2100000-0000-4000-8000-000000000021','Paid product',1000,'EUR',10,2,3,true,true,true),
 ('b2100000-0000-4000-8000-000000000021','Zero stock',0,'EUR',0,0,0,false,false,false);
-- Independent legacy FK columns can contain inconsistent rows. The new
-- privileged overview must filter both the event and the organization.
INSERT INTO public.orders(org_id,event_id,total_cents,paid_cents,booking_token) VALUES
 ('b2100000-0000-4000-8000-000000000011','b2100000-0000-4000-8000-000000000021',123,123,gen_random_uuid()::text),
 ('b2100000-0000-4000-8000-000000000012','b2100000-0000-4000-8000-000000000021',999,999,gen_random_uuid()::text);
DO $$ DECLARE proc_row record; n integer:=0; BEGIN
 FOR proc_row IN SELECT proc.* FROM pg_proc proc JOIN pg_namespace ns ON ns.oid=proc.pronamespace
  WHERE ns.nspname='public' AND proc.proname IN ('organizer_get_events_overview','organizer_get_event_detail_admin_core',
   'organizer_create_event','organizer_update_event','organizer_duplicate_event','organizer_delete_event')
 LOOP
  n:=n+1;
  IF has_function_privilege('anon',proc_row.oid,'EXECUTE') OR has_function_privilege('authenticated',proc_row.oid,'EXECUTE')
   OR EXISTS(SELECT 1 FROM aclexplode(coalesce(proc_row.proacl,acldefault('f',proc_row.proowner))) a WHERE a.grantee=0)
   OR NOT has_function_privilege('service_role',proc_row.oid,'EXECUTE')
   THEN RAISE EXCEPTION 'Bad internal event ACL: %',proc_row.oid::regprocedure; END IF;
 END LOOP;
 IF n<>6 THEN RAISE EXCEPTION 'Re-inventory event internal overloads: %',n; END IF;
END $$;
CREATE FUNCTION pg_temp.assert_events_internal_denied() RETURNS void LANGUAGE plpgsql AS $$
DECLARE statement text;
BEGIN
 FOR statement IN SELECT unnest(ARRAY[
  'SELECT public.organizer_get_events_overview(''b2100000-0000-4000-8000-000000000011'')',
  'SELECT public.organizer_get_event_detail_admin_core(''b2100000-0000-4000-8000-000000000011'',''b2100000-0000-4000-8000-000000000021'')',
  'SELECT public.organizer_create_event(''b2100000-0000-4000-8000-000000000001'',''{"org_id":"b2100000-0000-4000-8000-000000000011","title":"Forbidden"}'')',
  'SELECT public.organizer_update_event(''b2100000-0000-4000-8000-000000000001'',''{"org_id":"b2100000-0000-4000-8000-000000000011","event_id":"b2100000-0000-4000-8000-000000000021","title":"Forbidden"}'')',
  'SELECT public.organizer_duplicate_event(''b2100000-0000-4000-8000-000000000001'',''{"org_id":"b2100000-0000-4000-8000-000000000011","source_event_id":"b2100000-0000-4000-8000-000000000021"}'')',
  'SELECT public.organizer_delete_event(''b2100000-0000-4000-8000-000000000001'',''b2100000-0000-4000-8000-000000000011'',''b2100000-0000-4000-8000-000000000021'')'])
 LOOP
  BEGIN EXECUTE statement; RAISE EXCEPTION 'Browser event internal call accepted: %',current_user;
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 END LOOP;
END $$;
-- Temporary test helper only; B6 closes implicit PUBLIC EXECUTE defaults.
GRANT EXECUTE ON FUNCTION pg_temp.assert_events_internal_denied() TO anon,authenticated,service_role;
ALTER TABLE public.events DISABLE ROW LEVEL SECURITY;
SET LOCAL ROLE anon;
SELECT pg_temp.assert_events_internal_denied();
RESET ROLE;
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub"='b2100000-0000-4000-8000-000000000002';
SELECT pg_temp.assert_events_internal_denied();
RESET ROLE;
SET LOCAL ROLE service_role;
SET LOCAL "request.jwt.claim.role"='service_role';
DO $$
DECLARE actor constant uuid:='b2100000-0000-4000-8000-000000000001';
 org constant uuid:='b2100000-0000-4000-8000-000000000011';
 source constant uuid:='b2100000-0000-4000-8000-000000000021';
 r jsonb; cloned uuid; created uuid; before_count integer;
BEGIN
 r:=public.organizer_get_events_overview(org);
 IF jsonb_array_length(r->'events')<>1 OR r->'events'->0->'event'->>'org_id'<>org::text
  THEN RAISE EXCEPTION 'Overview crossed organization scope'; END IF;
 IF r->'events'->0->>'ordersCount'<>'1' OR r->'events'->0->>'paidCents'<>'123'
  THEN RAISE EXCEPTION 'Overview aggregated an inconsistent foreign organization order'; END IF;
 BEGIN
  PERFORM public.organizer_delete_event(actor,org,source);
  RAISE EXCEPTION 'Deletion accepted inconsistent foreign organization orders';
 EXCEPTION WHEN raise_exception THEN IF sqlerrm<>'RELATIONSHIP_CONFLICT' THEN RAISE; END IF; END;
 IF (SELECT count(*) FROM public.orders WHERE event_id=source)<>2
  OR (SELECT count(*) FROM public.event_products WHERE event_id=source)<>2
  OR NOT EXISTS(SELECT 1 FROM public.events WHERE id=source) THEN RAISE EXCEPTION 'Relationship conflict partly deleted fixtures'; END IF;
 DELETE FROM public.orders WHERE event_id=source AND org_id<>org;
 r:=public.organizer_get_event_detail_admin_core(org,source);
 IF r->'event'->>'charterText'<>'Fixture charter'
  OR r->'event'->>'bannerUrlEffective' IS DISTINCT FROM public.default_asset_url('defaults/default_banner.webp')
  OR r->'products'->0->>'event_id'<>source::text
  THEN RAISE EXCEPTION 'Detail contract or environment branding changed'; END IF;
 BEGIN
  PERFORM public.organizer_get_event_detail_admin_core('b2100000-0000-4000-8000-000000000012',source);
  RAISE EXCEPTION 'Detail crossed resource relation';
 EXCEPTION WHEN raise_exception THEN IF sqlerrm<>'NOT_FOUND' THEN RAISE; END IF; END;
 r:=public.organizer_duplicate_event(actor,jsonb_build_object('org_id',org,'source_event_id',source,'title','B21 Clone'));
 cloned:=(r->>'id')::uuid;
 IF r->>'orgId'<>org::text OR (r->>'isPublished')::boolean OR (r->>'clonedFormFieldsCount')::integer<>3
  OR (r->>'clonedProductsCount')::integer<>2 OR (r->>'clonedFormFieldGroupsCount')::integer<>2
  THEN RAISE EXCEPTION 'Duplicate metadata/counts changed'; END IF;
 IF EXISTS(SELECT 1 FROM public.event_form_fields f LEFT JOIN public.event_form_field_groups g ON g.id=f.group_id
   WHERE f.event_id=cloned AND f.group_id IS NOT NULL AND (g.id IS NULL OR g.event_id<>cloned))
  OR NOT EXISTS(SELECT 1 FROM public.event_form_fields WHERE event_id=cloned AND field_key='ungrouped' AND group_id IS NULL)
  OR NOT EXISTS(SELECT 1 FROM public.event_form_fields WHERE event_id=cloned AND field_key='grouped' AND options='[{"businessCamelKey":{"snake_key":"unchanged"}}]'::jsonb)
  OR EXISTS(SELECT 1 FROM public.event_products WHERE event_id=cloned AND (reserved_qty<>0 OR sold_qty<>0))
  OR NOT EXISTS(SELECT 1 FROM public.event_products WHERE event_id=cloned AND name='Zero stock' AND stock_qty=0)
  THEN RAISE EXCEPTION 'Duplicate links/JSON/stock counters changed'; END IF;
 -- A second call in the same SQL transaction must not collide with a temp map.
 PERFORM public.organizer_duplicate_event(actor,jsonb_build_object('org_id',org,'source_event_id',source,'title','B21 Clone Second'));
 -- No physical 30-field trigger remains. Only active fields consume the plan
 -- quota: 31 active plus 91 inactive fields must duplicate as one valid batch.
 INSERT INTO public.events(id,org_id,slug,title) VALUES('b2100000-0000-4000-8000-000000000061',org,'b21-many-fields','Many valid fields');
 INSERT INTO public.event_form_fields(event_id,label,field_key,field_type,is_active)
 SELECT 'b2100000-0000-4000-8000-000000000061','Many field '||n,'many_'||n,'text',n<=31 FROM generate_series(1,122)n;
 r:=public.organizer_duplicate_event(actor,jsonb_build_object('org_id',org,'source_event_id','b2100000-0000-4000-8000-000000000061','title','B21 Many Fields Clone'));
 IF r->>'clonedFormFieldsCount'<>'122' OR (SELECT count(*) FROM public.event_form_fields WHERE event_id=(r->>'id')::uuid)<>122
  OR (SELECT count(*) FROM public.event_form_fields WHERE event_id=(r->>'id')::uuid AND is_active)<>31 THEN RAISE EXCEPTION 'Duplication reinstated obsolete total-field cap'; END IF;
 r:=public.organizer_create_event(actor,jsonb_build_object('org_id',org,'title','B21 Created','charter_text','New charter','starts_at',now()+interval '20 days','registration_deadline',now()+interval '19 days'));
 created:=(r->>'id')::uuid;
 IF (SELECT count(*) FROM public.event_form_fields WHERE event_id=created)<>10
  OR (SELECT count(*) FROM public.event_products WHERE event_id=created)<>1
  OR (r->>'isPublished')::boolean THEN RAISE EXCEPTION 'Atomic default event children changed'; END IF;
 r:=public.organizer_update_event(actor,jsonb_build_object('org_id',org,'event_id',created,'charter_text',NULL,'title','B21 Renamed','is_published',true));
 IF r->>'charterText' IS NOT NULL OR r->>'title'<>'B21 Renamed' OR NOT (r->>'isPublished')::boolean
  THEN RAISE EXCEPTION 'Event patch clear/rename/publication changed'; END IF;
 BEGIN
  PERFORM public.organizer_update_event(actor,jsonb_build_object('org_id',org,'event_id',created,'title','Partial','registration_deadline',now()+interval '30 days'));
  RAISE EXCEPTION 'Inconsistent registration deadline accepted';
 EXCEPTION WHEN raise_exception THEN IF sqlerrm<>'VALIDATION_ERROR: registration_deadline must be before or equal to starts_at' THEN RAISE; END IF; END;
 IF (SELECT title FROM public.events WHERE id=created)<>'B21 Renamed' THEN RAISE EXCEPTION 'Rejected patch left partial event update'; END IF;
 BEGIN
  PERFORM public.organizer_update_event(actor,jsonb_build_object('org_id',org,'event_id','b2100000-0000-4000-8000-000000000022','title','Foreign'));
  RAISE EXCEPTION 'Foreign event update accepted';
 EXCEPTION WHEN raise_exception THEN IF sqlerrm<>'NOT_FOUND' THEN RAISE; END IF; END;
 BEGIN
  PERFORM public.organizer_create_event(NULL,jsonb_build_object('org_id',org,'title','No Actor'));
  RAISE EXCEPTION 'Missing actor accepted';
 EXCEPTION WHEN raise_exception THEN IF sqlerrm<>'NOT_AUTHENTICATED' THEN RAISE; END IF; END;
 BEGIN
  PERFORM public.organizer_update_event(actor,jsonb_build_object('org_id',org,'event_id',created,'reserved_qty',999));
  RAISE EXCEPTION 'Event sensitive field accepted';
 EXCEPTION WHEN raise_exception THEN IF sqlerrm<>'VALIDATION_ERROR: invalid event fields' THEN RAISE; END IF; END;

 UPDATE public.organizations SET plan='free' WHERE id=org;
 SELECT count(*) INTO before_count FROM public.events WHERE org_id=org;
 BEGIN
  PERFORM public.organizer_create_event(actor,jsonb_build_object('org_id',org,'title','Paid Over Quota','deposit_cents',100));
  RAISE EXCEPTION 'Paid create bypassed annual quota';
 EXCEPTION WHEN raise_exception THEN IF sqlerrm<>'PLAN_LIMIT: paid_events_per_year exceeded' THEN RAISE; END IF; END;
 BEGIN
  PERFORM public.organizer_duplicate_event(actor,jsonb_build_object('org_id',org,'source_event_id',source,'title','Paid Duplicate Over Quota'));
  RAISE EXCEPTION 'Paid product duplication bypassed annual quota';
 EXCEPTION WHEN raise_exception THEN IF sqlerrm<>'PLAN_LIMIT: paid_events_per_year exceeded' THEN RAISE; END IF; END;
 BEGIN
  PERFORM public.organizer_update_event(actor,jsonb_build_object('org_id',org,'event_id',created,'deposit_cents',100));
  RAISE EXCEPTION 'Paid transition bypassed annual quota';
 EXCEPTION WHEN raise_exception THEN IF sqlerrm<>'PLAN_LIMIT: paid_events_per_year exceeded' THEN RAISE; END IF; END;
 IF (SELECT count(*) FROM public.events WHERE org_id=org)<>before_count
  OR coalesce((SELECT deposit_cents FROM public.events WHERE id=created),0)<>0
  THEN RAISE EXCEPTION 'Quota failure left partial event state'; END IF;
 -- Limits changes stay inside this fixture transaction, never a business seed.
 UPDATE public.plan_limits SET max_products_per_event=1 WHERE plan='free';
 BEGIN
  PERFORM public.organizer_duplicate_event(actor,jsonb_build_object('org_id',org,'source_event_id',source,'title','Product Batch Over Quota'));
  RAISE EXCEPTION 'Clone product batch bypassed quota';
 EXCEPTION WHEN raise_exception THEN IF sqlerrm<>'PLAN_LIMIT: max_products_per_event exceeded' THEN RAISE; END IF; END;
 UPDATE public.plan_limits SET max_products_per_event=10,max_form_fields=1 WHERE plan='free';
 BEGIN
  PERFORM public.organizer_duplicate_event(actor,jsonb_build_object('org_id',org,'source_event_id',source,'title','Field Batch Over Quota'));
  RAISE EXCEPTION 'Clone active field batch bypassed quota';
 EXCEPTION WHEN raise_exception THEN IF sqlerrm<>'PLAN_LIMIT: max_form_fields exceeded' THEN RAISE; END IF; END;
 BEGIN
  PERFORM public.organizer_create_event(actor,jsonb_build_object('org_id',org,'title','Default Fields Over Quota'));
  RAISE EXCEPTION 'Default field batch bypassed quota';
 EXCEPTION WHEN raise_exception THEN IF sqlerrm<>'PLAN_LIMIT: max_form_fields exceeded' THEN RAISE; END IF; END;
 PERFORM public.organizer_delete_event(actor,org,cloned);
 IF EXISTS(SELECT 1 FROM public.events WHERE id=cloned)
  OR EXISTS(SELECT 1 FROM public.event_products WHERE event_id=cloned)
  OR EXISTS(SELECT 1 FROM public.event_form_fields WHERE event_id=cloned)
  OR EXISTS(SELECT 1 FROM public.event_form_field_groups WHERE event_id=cloned)
  OR NOT EXISTS(SELECT 1 FROM public.events WHERE id=source)
  THEN RAISE EXCEPTION 'Delete cascades/source preservation changed'; END IF;
END $$;
RESET ROLE;
ROLLBACK;
