BEGIN;
INSERT INTO auth.users(id,aud,role,email,encrypted_password,created_at,updated_at)
VALUES ('a2000000-0000-4000-8000-000000000001','authenticated','authenticated','form-a@example.test','',now(),now());
INSERT INTO public.organizations(id,type,name) VALUES
 ('a2000000-0000-4000-8000-000000000002','association','Form organization A'),
 ('a2000000-0000-4000-8000-000000000003','association','Form organization B');
INSERT INTO public.organization_members(org_id,user_id,role)
VALUES ('a2000000-0000-4000-8000-000000000002','a2000000-0000-4000-8000-000000000001','owner');
INSERT INTO public.events(id,org_id,slug,title) VALUES
 ('a2000000-0000-4000-8000-000000000004','a2000000-0000-4000-8000-000000000002','form-a1','Form event A1'),
 ('a2000000-0000-4000-8000-000000000005','a2000000-0000-4000-8000-000000000002','form-a2','Form event A2'),
 ('a2000000-0000-4000-8000-000000000006','a2000000-0000-4000-8000-000000000003','form-b','Form event B');
INSERT INTO public.event_form_field_groups(id,event_id,label) VALUES
 ('a2000000-0000-4000-8000-000000000007','a2000000-0000-4000-8000-000000000004','Group A1'),
 ('a2000000-0000-4000-8000-000000000008','a2000000-0000-4000-8000-000000000005','Group A2'),
 ('a2000000-0000-4000-8000-000000000009','a2000000-0000-4000-8000-000000000006','Group B');

SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.role" = 'authenticated';
SET LOCAL "request.jwt.claim.sub" = 'a2000000-0000-4000-8000-000000000001';
INSERT INTO public.event_form_fields(id,event_id,group_id,label,field_key,field_type)
VALUES ('a2000000-0000-4000-8000-000000000010','a2000000-0000-4000-8000-000000000004',
 'a2000000-0000-4000-8000-000000000007','Valid field','valid_field','text');
UPDATE public.event_form_fields SET group_id=NULL WHERE id='a2000000-0000-4000-8000-000000000010';
UPDATE public.event_form_fields SET group_id='a2000000-0000-4000-8000-000000000007',label='Updated valid field'
 WHERE id='a2000000-0000-4000-8000-000000000010';
DO $$
DECLARE foreign_group uuid; affected integer;
BEGIN
 IF NOT EXISTS (SELECT 1 FROM public.event_form_fields WHERE id='a2000000-0000-4000-8000-000000000010'
  AND group_id='a2000000-0000-4000-8000-000000000007' AND label='Updated valid field')
 THEN RAISE EXCEPTION 'Same-event INSERT/UPDATE failed'; END IF;
 FOREACH foreign_group IN ARRAY ARRAY['a2000000-0000-4000-8000-000000000008'::uuid,'a2000000-0000-4000-8000-000000000009'::uuid]
 LOOP
  BEGIN
   INSERT INTO public.event_form_fields(event_id,group_id,label,field_key,field_type)
   VALUES ('a2000000-0000-4000-8000-000000000004',foreign_group,'Invalid field','invalid_field','text');
   RAISE EXCEPTION 'Cross-event INSERT accepted';
  EXCEPTION WHEN foreign_key_violation THEN NULL; END;
  BEGIN
   UPDATE public.event_form_fields SET group_id=foreign_group WHERE id='a2000000-0000-4000-8000-000000000010';
   GET DIAGNOSTICS affected=ROW_COUNT;
   RAISE EXCEPTION 'Cross-event UPDATE accepted (% rows)',affected;
  EXCEPTION WHEN foreign_key_violation THEN NULL; END;
 END LOOP;
 -- Both events are owned by A: RLS permits this move, integrity must refuse it.
 BEGIN
  UPDATE public.event_form_fields SET event_id='a2000000-0000-4000-8000-000000000005'
   WHERE id='a2000000-0000-4000-8000-000000000010';
  RAISE EXCEPTION 'Changing field event bypassed the group invariant';
 EXCEPTION WHEN foreign_key_violation THEN NULL; END;
 BEGIN
  UPDATE public.event_form_field_groups SET event_id='a2000000-0000-4000-8000-000000000005'
   WHERE id='a2000000-0000-4000-8000-000000000007';
  RAISE EXCEPTION 'Moving a referenced group bypassed the invariant';
 EXCEPTION WHEN foreign_key_violation THEN NULL; END;
END $$;
DELETE FROM public.event_form_field_groups WHERE id='a2000000-0000-4000-8000-000000000007';
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM public.event_form_fields WHERE id='a2000000-0000-4000-8000-000000000010'
  AND event_id='a2000000-0000-4000-8000-000000000004' AND group_id IS NULL AND label='Updated valid field')
 THEN RAISE EXCEPTION 'Deleting a group removed the field or its event'; END IF;
END $$;
RESET ROLE;
-- The invariant also applies to the server, independently of row policies.
SET LOCAL ROLE service_role;
DO $$ BEGIN
 BEGIN
  INSERT INTO public.event_form_fields(event_id,group_id,label,field_key,field_type)
  VALUES ('a2000000-0000-4000-8000-000000000004','a2000000-0000-4000-8000-000000000009','Invalid server field','server_invalid','text');
  RAISE EXCEPTION 'Server bypassed relational integrity';
 EXCEPTION WHEN foreign_key_violation THEN NULL; END;
END $$;
RESET ROLE;
ROLLBACK;
