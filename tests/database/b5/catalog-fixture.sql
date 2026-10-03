BEGIN;
INSERT INTO public.organizations(id,type,name,status,plan) VALUES
 ('b5000000-0000-4000-8000-000000000011','association','B5 Public A','active','pro'),
 ('b5000000-0000-4000-8000-000000000012','association','B5 Public B','active','pro'),
 ('b5000000-0000-4000-8000-000000000013','association','B5 Suspended','suspended','pro');
INSERT INTO public.organization_profile(org_id,slug,display_name,description,public_email,sales_terms,sales_terms_version)
 SELECT id,CASE right(id::text,1) WHEN '1' THEN 'b5-a' WHEN '2' THEN 'b5-b' ELSE 'b5-hidden' END,name,'Public description','public@example.test',repeat('Synthetic legal terms. ',12),'b5-v1'
 FROM public.organizations WHERE id in ('b5000000-0000-4000-8000-000000000011','b5000000-0000-4000-8000-000000000012','b5000000-0000-4000-8000-000000000013');
INSERT INTO public.events(id,org_id,slug,title,is_published,starts_at,created_at)
 SELECT ('b5000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'b5000000-0000-4000-8000-000000000011','event-'||n,'B5 Event '||n,true,
 CASE WHEN n%2=0 THEN null ELSE '2030-01-02'::timestamptz END,'2026-10-03'::timestamptz FROM generate_series(101,305)n;
INSERT INTO public.events(id,org_id,slug,title,is_published) VALUES
 ('b5000000-0000-4000-8000-000000000401','b5000000-0000-4000-8000-000000000011','b5-draft','Never disclose draft',false),
 ('b5000000-0000-4000-8000-000000000402','b5000000-0000-4000-8000-000000000012','b5-foreign','Foreign event',true),
 ('b5000000-0000-4000-8000-000000000403','b5000000-0000-4000-8000-000000000013','b5-hidden','Inactive organization event',true);
INSERT INTO public.event_form_fields(id,event_id,label,field_key,field_type,options,is_active)
VALUES ('b5000000-0000-4000-8000-000000000501','b5000000-0000-4000-8000-000000000101','Choose option','choose_option','select','[{"label":"Preserved","value":"Mixed_Case_Key"}]',true);
