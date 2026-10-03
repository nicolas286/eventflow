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
CREATE FUNCTION pg_temp.expect_error(statement text,expected text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
 BEGIN EXECUTE statement; EXCEPTION WHEN OTHERS THEN
  IF sqlerrm LIKE expected||'%' OR sqlstate=expected THEN RETURN; END IF; RAISE;
 END; RAISE EXCEPTION 'Expected %, accepted %',expected,statement;
END $$;
-- Temporary test helper only; B6 closes implicit PUBLIC EXECUTE defaults.
GRANT EXECUTE ON FUNCTION pg_temp.expect_error(text,text) TO anon,authenticated,service_role;
ALTER TABLE public.events DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.organizations DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_profile DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_products DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_form_fields DISABLE ROW LEVEL SECURITY;
SET LOCAL ROLE service_role;
DO $$ DECLARE org uuid:='b5000000-0000-4000-8000-000000000011'; r jsonb; cursor uuid:=null; ids uuid[]:='{}'; n integer:=0; v uuid; BEGIN
 LOOP
  r:=public.catalog_get_public_org_events_overview(org,'b5-a','https://fixture.invalid/banner',37,cursor);
  FOR v IN SELECT (item->>'id')::uuid FROM jsonb_array_elements(r->'events')item LOOP
   IF v=ANY(ids) THEN RAISE EXCEPTION 'Duplicate catalog page'; END IF;
   ids:=array_append(ids,v);n:=n+1;
  END LOOP;
  cursor:=(r->>'nextCursor')::uuid;EXIT WHEN cursor IS NULL;
 END LOOP;
 IF n<>205 THEN RAISE EXCEPTION 'Incomplete catalog: %',n;END IF;
 PERFORM pg_temp.expect_error(format('select public.catalog_get_public_org_events_overview(%L,%L,%L,101)',org,'b5-a','https://fixture.invalid/banner'),'VALIDATION_ERROR');
 PERFORM pg_temp.expect_error(format('select public.catalog_get_public_org_events_overview(%L,%L,%L,37,%L)',org,'b5-a','https://fixture.invalid/banner','b5000000-0000-4000-8000-000000000402'),'FORBIDDEN');
 PERFORM pg_temp.expect_error(format('select public.catalog_get_public_event_detail(%L,%L,%L,null,null)',org,'b5-a','b5-draft'),'NOT_FOUND');
 PERFORM pg_temp.expect_error(format('select public.catalog_get_public_event_detail(%L,%L,%L,null,null)',org,'b5-a','b5-foreign'),'NOT_FOUND');
 PERFORM pg_temp.expect_error(format('select public.catalog_get_public_org_by_slug(%L,%L)',org,'b5-b'),'NOT_FOUND');
 PERFORM pg_temp.expect_error('select public.catalog_get_public_organization_sales_terms(''b5000000-0000-4000-8000-000000000013'',''b5-hidden'')','NOT_FOUND');
 r:=public.catalog_get_public_event_detail(org,'b5-a','event-101','https://fixture.invalid/banner','https://fixture.invalid/logo');
 IF r->'formFields'->0->'options'->0->>'value'<>'Mixed_Case_Key' OR r->'event'->>'bannerUrl'<>'https://fixture.invalid/banner' THEN RAISE EXCEPTION 'Business JSON/defaults changed'; END IF;
 r:=public.catalog_get_public_organization_sales_terms(org,'b5-a');
 IF r->>'paidSalesAvailable'<>'false' OR r ? 'connectTermsAcceptedVersion' OR r ? 'dpaAcceptedVersion' THEN RAISE EXCEPTION 'Terms leaked admin agreements/financial rule changed'; END IF;
 r:=public.catalog_event_share(org,'b5000000-0000-4000-8000-000000000101','https://fixture.invalid/banner');
 IF r->>'orgName'<>'B5 Public A' OR r ? 'products' THEN RAISE EXCEPTION 'Share metadata contract'; END IF;
END $$;
-- Synthetic oversized legacy fixture: bypass only insert triggers inside rollback.
RESET ROLE;
SET LOCAL session_replication_role=replica;
INSERT INTO public.event_products(event_id,name,price_cents,is_active) SELECT 'b5000000-0000-4000-8000-000000000101','B5 Product '||n,100,true FROM generate_series(1,1001)n;
SET LOCAL session_replication_role=origin;
SET LOCAL ROLE service_role;
SELECT pg_temp.expect_error('select public.catalog_get_public_event_detail(''b5000000-0000-4000-8000-000000000011'',''b5-a'',''event-101'',null,null)','CATALOG_LIMIT_EXCEEDED');
RESET ROLE;
ROLLBACK;
