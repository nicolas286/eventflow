-- B2.3 real-role, tenant, option, transaction, FK and snapshot contracts.
BEGIN;
INSERT INTO public.organizations(id,type,name,plan,plan_expires_at) VALUES
 ('b2300000-0000-4000-8000-000000000011','association','B23 Form org','pro',now()+interval '30 days'),
 ('b2300000-0000-4000-8000-000000000012','association','B23 Foreign org','pro',now()+interval '30 days');
INSERT INTO public.events(id,org_id,slug,title) VALUES
 ('b2300000-0000-4000-8000-000000000021','b2300000-0000-4000-8000-000000000011','b23-form','Form event'),
 ('b2300000-0000-4000-8000-000000000022','b2300000-0000-4000-8000-000000000012','b23-foreign','Foreign event'),
 ('b2300000-0000-4000-8000-000000000023','b2300000-0000-4000-8000-000000000011','b23-same-org-other-event','Other event');
INSERT INTO public.event_form_field_groups(id,event_id,label) VALUES
 ('b2300000-0000-4000-8000-000000000031','b2300000-0000-4000-8000-000000000023','Foreign same-org group');
INSERT INTO public.event_form_fields(id,event_id,label,field_key,field_type) VALUES
 ('b2300000-0000-4000-8000-000000000041','b2300000-0000-4000-8000-000000000022','Foreign field','foreign','text');
CREATE FUNCTION pg_temp.assert_form_error(statement text,expected text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
 BEGIN EXECUTE statement; EXCEPTION WHEN OTHERS THEN
  IF sqlerrm LIKE expected||'%' OR sqlstate=expected THEN RETURN; END IF; RAISE;
 END;
 RAISE EXCEPTION 'Expected form error %, accepted: %',expected,statement;
END $$;
-- Temporary test helper only; B6 closes implicit PUBLIC EXECUTE defaults.
GRANT EXECUTE ON FUNCTION pg_temp.assert_form_error(text,text) TO anon,authenticated,service_role;
DO $$ DECLARE p record; n int:=0; BEGIN
 FOR p IN SELECT proc.* FROM pg_proc proc JOIN pg_namespace ns ON ns.oid=proc.pronamespace
  WHERE ns.nspname='public' AND proc.proname IN ('organizer_create_event_form_field','organizer_update_event_form_field',
  'organizer_create_event_form_field_group','organizer_update_event_form_field_group',
  'organizer_delete_event_form_field','organizer_delete_event_form_field_group','organizer_reorder_event_form') LOOP
  n:=n+1;
  IF has_function_privilege('anon',p.oid,'EXECUTE') OR has_function_privilege('authenticated',p.oid,'EXECUTE')
   OR EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.grantee=0)
   OR NOT has_function_privilege('service_role',p.oid,'EXECUTE') THEN RAISE EXCEPTION 'Form internal ACL leaked'; END IF;
 END LOOP;
 IF n<>7 THEN RAISE EXCEPTION 'Form overload inventory changed: %',n; END IF;
END $$;
CREATE FUNCTION pg_temp.assert_forms_denied() RETURNS void LANGUAGE plpgsql AS $$ DECLARE call text; BEGIN
 FOREACH call IN ARRAY ARRAY['create_event_form_field','update_event_form_field','create_event_form_field_group','update_event_form_field_group','reorder_event_form'] LOOP
  PERFORM pg_temp.assert_form_error(format('SELECT public.organizer_%I(NULL,NULL)',call),'42501');
 END LOOP;
 PERFORM pg_temp.assert_form_error('SELECT public.organizer_delete_event_form_field(NULL,NULL,NULL,NULL)','42501');
 PERFORM pg_temp.assert_form_error('SELECT public.organizer_delete_event_form_field_group(NULL,NULL,NULL,NULL)','42501');
END $$;
-- Temporary test helper only; B6 closes implicit PUBLIC EXECUTE defaults.
GRANT EXECUTE ON FUNCTION pg_temp.assert_forms_denied() TO anon,authenticated,service_role;
ALTER TABLE public.events DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_form_fields DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_form_field_groups DISABLE ROW LEVEL SECURITY;
SET LOCAL ROLE anon; SELECT pg_temp.assert_forms_denied(); RESET ROLE;
SET LOCAL ROLE authenticated; SELECT pg_temp.assert_forms_denied(); RESET ROLE;
SET LOCAL ROLE service_role;
SET LOCAL "request.jwt.claim.sub"='b2300000-0000-4000-8000-000000000099';
DO $$ DECLARE actor constant uuid:='b2300000-0000-4000-8000-000000000001';
 org constant uuid:='b2300000-0000-4000-8000-000000000011'; event constant uuid:='b2300000-0000-4000-8000-000000000021';
 r jsonb; scope jsonb; patch jsonb; input jsonb; opts jsonb; field1 uuid; field2 uuid; group1 uuid; group2 uuid; ord uuid; att uuid; answer uuid; before_answer jsonb; n int;
BEGIN
 scope:=jsonb_build_object('org_id',org,'event_id',event);
 r:=public.organizer_create_event_form_field_group(actor,scope||'{"label":"  First group  ","description":"Description","sort_order":5}'); group1:=(r->>'id')::uuid;
 IF r->>'label'<>'First group' OR r->>'event_id'<>event::text OR r ? 'eventId' THEN RAISE EXCEPTION 'Group raw create contract changed'; END IF;
 r:=public.organizer_create_event_form_field_group(actor,scope||'{"label":"Second group","sort_order":8}'); group2:=(r->>'id')::uuid;
 patch:=scope||jsonb_build_object('group_id',group1);
 r:=public.organizer_update_event_form_field_group(actor,patch||'{"label":"Renamed group","is_active":false}');
 IF r->>'description'<>'Description' OR r->>'sort_order'<>'5' THEN RAISE EXCEPTION 'Group absent patch cleared fields'; END IF;
 r:=public.organizer_update_event_form_field_group(actor,patch||'{"description":null}');
 IF r->'description'<>'null'::jsonb THEN RAISE EXCEPTION 'Group null did not clear description'; END IF;
 opts:='[" snake_value ","businessCamelValue"]';
 input:=scope||jsonb_build_object('group_id',group1,'label','  Choice field  ','field_key','choice_key','field_type','select','options',opts,'sort_order',3);
 r:=public.organizer_create_event_form_field(actor,input); field1:=(r->>'id')::uuid;
 IF r->'options'<>opts OR r->>'field_key'<>'choice_key' OR r->>'label'<>'Choice field' OR r ? 'fieldKey' THEN RAISE EXCEPTION 'Field option/raw create changed'; END IF;
 opts:='[{"label":" First option ","value":" snake_value "},{"label":"Other option","value":"businessCamelValue"}]';
 r:=public.organizer_create_event_form_field(actor,input||jsonb_build_object('field_key','legacy_key','label','Legacy choice','options',opts,'sort_order',9)); field2:=(r->>'id')::uuid;
 IF r->'options'<>opts THEN RAISE EXCEPTION 'Legacy object options were rewritten'; END IF;
 patch:=scope||jsonb_build_object('field_id',field2);
 r:=public.organizer_update_event_form_field(actor,patch||'{"label":"Label-only update"}');
 IF r->'options'<>opts OR r->>'group_id'<>group1::text THEN RAISE EXCEPTION 'Label-only patch changed legacy options/group'; END IF;
 r:=public.organizer_update_event_form_field(actor,patch||'{"group_id":null,"is_required":true}');
 IF r->'group_id'<>'null'::jsonb OR r->'options'<>opts OR r->>'is_required'<>'true' THEN RAISE EXCEPTION 'Explicit group null or omitted options changed'; END IF;
 r:=public.organizer_update_event_form_field(actor,patch||'{"field_type":"textarea","options":null}');
 IF r->'options'<>'null'::jsonb OR r->>'field_type'<>'textarea' THEN RAISE EXCEPTION 'Non-choice explicit options null did not clear'; END IF;
 PERFORM pg_temp.assert_form_error(format('SELECT public.organizer_update_event_form_field(%L,%L)',actor,patch||'{"field_type":"select"}'),'VALIDATION_ERROR');
 IF (SELECT field_type FROM public.event_form_fields WHERE id=field2)<>'textarea' THEN RAISE EXCEPTION 'Invalid type transition partly persisted'; END IF;
 r:=public.organizer_update_event_form_field(actor,patch||jsonb_build_object('field_type','select','options',opts));
 IF r->'options'<>opts THEN RAISE EXCEPTION 'Explicit legacy options update was rewritten'; END IF;
 r:=public.organizer_update_event_form_field(actor,patch||jsonb_build_object('options',jsonb_build_array(chr(9)||repeat('x',80)||chr(9))));
 IF r->'options'<>jsonb_build_array(chr(9)||repeat('x',80)||chr(9)) THEN RAISE EXCEPTION 'JS whitespace validation rewrote raw option'; END IF;
 PERFORM pg_temp.assert_form_error(format('SELECT public.organizer_update_event_form_field(%L,%L)',actor,patch||jsonb_build_object('options',jsonb_build_array(chr(9)||chr(160)||chr(10)))),'VALIDATION_ERROR');
 PERFORM pg_temp.assert_form_error(format('SELECT public.organizer_update_event_form_field(%L,%L)',actor,patch||jsonb_build_object('options',jsonb_build_array(repeat(chr(128512),41)))),'VALIDATION_ERROR');
 r:=public.organizer_update_event_form_field(actor,patch||jsonb_build_object('options',opts));
 PERFORM pg_temp.assert_form_error(format('SELECT public.organizer_update_event_form_field(%L,%L)',actor,patch||'{"options":null}'),'VALIDATION_ERROR');
 PERFORM pg_temp.assert_form_error(format('SELECT public.organizer_update_event_form_field(%L,%L)',actor,patch||'{"field_type":"bogus"}'),'VALIDATION_ERROR');
 PERFORM pg_temp.assert_form_error(format('SELECT public.organizer_create_event_form_field(%L,%L)',actor,input||'{"options":[{"label":"Good","value":"good","nested_key":true}]}'),'VALIDATION_ERROR');
 PERFORM pg_temp.assert_form_error(format('SELECT public.organizer_create_event_form_field(%L,%L)',actor,input||'{"options":["string",{"label":"Good","value":"good"}]}'),'VALIDATION_ERROR');
 PERFORM pg_temp.assert_form_error(format('SELECT public.organizer_create_event_form_field(%L,%L)',actor,input||'{"group_id":"b2300000-0000-4000-8000-000000000031"}'),'VALIDATION_ERROR');
 PERFORM pg_temp.assert_form_error(format('SELECT public.organizer_create_event_form_field(%L,%L)',actor,input||'{"id":"b2300000-0000-4000-8000-000000000090"}'),'VALIDATION_ERROR');
 PERFORM pg_temp.assert_form_error(format('SELECT public.organizer_create_event_form_field(NULL,%L)',input),'NOT_AUTHENTICATED');
 PERFORM pg_temp.assert_form_error(format('SELECT public.organizer_create_event_form_field(%L,%L)',actor,input||'{"org_id":"b2300000-0000-4000-8000-000000000012"}'),'NOT_FOUND');
 PERFORM pg_temp.assert_form_error(format('SELECT public.organizer_update_event_form_field(%L,%L)',actor,patch||'{"field_id":"b2300000-0000-4000-8000-000000000041"}'),'NOT_FOUND');
 PERFORM pg_temp.assert_form_error(format('SELECT public.organizer_update_event_form_field(%L,%L)',actor,patch||'{"field_key":"choice_key"}'),'DUPLICATE_FIELD_KEY');
 PERFORM pg_temp.assert_form_error(format('SELECT public.organizer_create_event_form_field(%L,%L)',actor,input),'DUPLICATE_FIELD_KEY');
 -- One transaction updates both arrays; foreign members and duplicates leave neither reordered.
 input:=scope||jsonb_build_object('fields',jsonb_build_array(jsonb_build_object('id',field1,'sort_order',9),jsonb_build_object('id',field2,'sort_order',3)),
  'groups',jsonb_build_array(jsonb_build_object('id',group1,'sort_order',8),jsonb_build_object('id',group2,'sort_order',5)));
 r:=public.organizer_reorder_event_form(actor,input);
 IF r<>'{"success":true}'::jsonb OR (SELECT sort_order FROM public.event_form_fields WHERE id=field1)<>9
  OR (SELECT sort_order FROM public.event_form_fields WHERE id=field2)<>3 OR (SELECT sort_order FROM public.event_form_field_groups WHERE id=group1)<>8 THEN RAISE EXCEPTION 'Combined order swap failed'; END IF;
 patch:=scope||jsonb_build_object('fields',jsonb_build_array(jsonb_build_object('id',field1,'sort_order',1),jsonb_build_object('id','b2300000-0000-4000-8000-000000000041','sort_order',2)),
  'groups',jsonb_build_array(jsonb_build_object('id',group1,'sort_order',1)));
 PERFORM pg_temp.assert_form_error(format('SELECT public.organizer_reorder_event_form(%L,%L)',actor,patch),'NOT_FOUND');
 IF (SELECT sort_order FROM public.event_form_fields WHERE id=field1)<>9 OR (SELECT sort_order FROM public.event_form_field_groups WHERE id=group1)<>8 THEN RAISE EXCEPTION 'Foreign reorder left half written'; END IF;
 patch:=scope||jsonb_build_object('fields',jsonb_build_array(jsonb_build_object('id',field1,'sort_order',1)),
  'groups',jsonb_build_array(jsonb_build_object('id','b2300000-0000-4000-8000-000000000031','sort_order',1)));
 PERFORM pg_temp.assert_form_error(format('SELECT public.organizer_reorder_event_form(%L,%L)',actor,patch),'NOT_FOUND');
 IF (SELECT sort_order FROM public.event_form_fields WHERE id=field1)<>9 THEN RAISE EXCEPTION 'Foreign group reorder partly changed fields'; END IF;
 patch:=scope||jsonb_build_object('fields',jsonb_build_array(jsonb_build_object('id',field1,'sort_order',1),jsonb_build_object('id',upper(field1::text),'sort_order',2)));
 PERFORM pg_temp.assert_form_error(format('SELECT public.organizer_reorder_event_form(%L,%L)',actor,patch),'VALIDATION_ERROR: duplicate');
 PERFORM pg_temp.assert_form_error(format('SELECT public.organizer_reorder_event_form(%L,%L)',actor,scope||'{"fields":[],"groups":[]}'),'VALIDATION_ERROR');
 PERFORM pg_temp.assert_form_error(format('SELECT public.organizer_reorder_event_form(%L,%L)',actor,scope||'{"groups":[{"id":"b2300000-0000-4000-8000-000000000031","sort_order":0,"event_id":"forged"}]}'),'VALIDATION_ERROR');
 -- Snapshots remain independent when their defining group/field is removed.
 INSERT INTO public.orders(org_id,event_id,total_cents,booking_token) VALUES(org,event,0,gen_random_uuid()::text) RETURNING id INTO ord;
 INSERT INTO public.order_attendees(order_id,product_name_snapshot,attendee_index) VALUES(ord,'Fixture attendee',1) RETURNING id INTO att;
 INSERT INTO public.order_attendee_answers(attendee_id,field_key_snapshot,field_label_snapshot,field_type_snapshot,value)
  VALUES(att,'choice_key','Choice field','select','{"chosen_key":"snake_value"}') RETURNING id INTO answer;
 SELECT to_jsonb(a) INTO before_answer FROM public.order_attendee_answers a WHERE id=answer;
 PERFORM public.organizer_delete_event_form_field_group(actor,org,event,group1);
 IF NOT EXISTS(SELECT 1 FROM public.event_form_fields WHERE id=field1 AND event_id=event AND group_id IS NULL)
  OR NOT EXISTS(SELECT 1 FROM public.event_form_fields WHERE id=field2 AND event_id=event) THEN RAISE EXCEPTION 'Group deletion removed fields/event linkage'; END IF;
 PERFORM public.organizer_delete_event_form_field(actor,org,event,field1);
 IF (SELECT to_jsonb(a) FROM public.order_attendee_answers a WHERE id=answer)<>before_answer THEN RAISE EXCEPTION 'Field deletion changed answer snapshots'; END IF;
 PERFORM pg_temp.assert_form_error(format('SELECT public.organizer_delete_event_form_field(%L,%L,%L,%L)',actor,org,event,'b2300000-0000-4000-8000-000000000041'),'NOT_FOUND');
 -- The old 30-field trigger was removed. Inactive fields do not count toward
 -- the existing active-field plan limit; creating a 31st field stays valid.
 FOR n IN 1..30 LOOP
  INSERT INTO public.event_form_fields(event_id,label,field_key,field_type,is_active)
   VALUES('b2300000-0000-4000-8000-000000000023','Inactive '||n,'inactive_'||n,'text',false);
 END LOOP;
 PERFORM public.organizer_create_event_form_field(actor,scope||'{"event_id":"b2300000-0000-4000-8000-000000000023","label":"Valid 31st field","field_key":"valid_31st","field_type":"text","is_active":false}');
 IF (SELECT count(*) FROM public.event_form_fields WHERE event_id='b2300000-0000-4000-8000-000000000023')<>31 THEN RAISE EXCEPTION 'Removed 30-field cap regressed'; END IF;
 IF (SELECT max_form_fields FROM public.plan_limits WHERE plan='pro')<>100 THEN RAISE EXCEPTION 'Fixture requires seeded max100 active fields, never rewrites plan settings'; END IF;
 INSERT INTO public.event_form_fields(event_id,label,field_key,field_type,is_active)
 SELECT 'b2300000-0000-4000-8000-000000000023','Active '||seq.n,'active_'||seq.n,'text',true FROM generate_series(1,99)seq(n);
END $$;
RESET ROLE;
-- Actual seeded quota; no settings overwritten, not even temporarily.
SET LOCAL ROLE service_role;
DO $$ DECLARE actor constant uuid:='b2300000-0000-4000-8000-000000000001';
 org constant uuid:='b2300000-0000-4000-8000-000000000011'; event constant uuid:='b2300000-0000-4000-8000-000000000023'; patch jsonb; id uuid;
BEGIN
 SELECT f.id INTO id FROM public.event_form_fields f WHERE f.event_id=event AND field_key='inactive_1';
 patch:=jsonb_build_object('org_id',org,'event_id',event,'field_id',id,'is_active',true);
 PERFORM public.organizer_update_event_form_field(actor,patch);
 SELECT f.id INTO id FROM public.event_form_fields f WHERE f.event_id=event AND field_key='inactive_2';
 patch:=patch||jsonb_build_object('field_id',id,'label','Must rollback');
 PERFORM pg_temp.assert_form_error(format('SELECT public.organizer_update_event_form_field(%L,%L)',actor,patch),'PLAN_LIMIT');
 IF NOT EXISTS(SELECT 1 FROM public.event_form_fields WHERE event_id=event AND field_key='inactive_2' AND NOT is_active AND label='Inactive 2') THEN RAISE EXCEPTION 'Activation quota left partial field'; END IF;
 PERFORM pg_temp.assert_form_error(format('SELECT public.organizer_create_event_form_field(%L,%L)',actor,jsonb_build_object('org_id',org,'event_id',event,'label','Quota field','field_key','quota_field','field_type','text')),'PLAN_LIMIT');
 SELECT f.id INTO id FROM public.event_form_fields f WHERE f.event_id=event AND field_key='active_1';
 PERFORM public.organizer_update_event_form_field(actor,jsonb_build_object('org_id',org,'event_id',event,'field_id',id,'label','Existing active patch at cap','is_active',true));
 IF (SELECT count(*) FROM public.event_form_fields WHERE event_id=event AND is_active)<>100 THEN RAISE EXCEPTION 'Actual active quota count changed'; END IF;
END $$;
RESET ROLE;
ROLLBACK;
