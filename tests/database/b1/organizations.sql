-- B1.1 additive operations, on a disposable rebuilt database only.
-- Legacy browser closure is verified separately after the deferred phase.
BEGIN;
UPDATE private.platform_settings SET registrations_open=true WHERE singleton;
INSERT INTO auth.users(id,aud,role,email,encrypted_password,created_at,updated_at,raw_user_meta_data)
SELECT ('b1100000-0000-4000-8000-00000000000'||n)::uuid,
 'authenticated','authenticated','b11-'||n||'@example.test','',now(),now(),
 '{"platform_terms_version":"2026-10-01","platform_terms_accepted":true}'::jsonb
FROM generate_series(1,2) n;

DO $$ DECLARE p record; n integer:=0; BEGIN
 FOR p IN SELECT proc.* FROM pg_proc proc JOIN pg_namespace ns ON ns.oid=proc.pronamespace
  WHERE ns.nspname='public' AND proc.proname IN (
   'organizer_create_organization','organizer_update_organization',
   'organizer_update_seller_identity','organizer_accept_platform_agreements')
 LOOP
  n:=n+1;
  IF has_function_privilege('anon',p.oid,'EXECUTE')
   OR has_function_privilege('authenticated',p.oid,'EXECUTE')
   OR EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.grantee=0)
   OR NOT has_function_privilege('service_role',p.oid,'EXECUTE')
   THEN RAISE EXCEPTION 'Bad internal organization function ACL: %',p.oid::regprocedure; END IF;
 END LOOP;
 IF n<>4 THEN RAISE EXCEPTION 'Re-inventory organization internal overloads: %',n; END IF;
END $$;

CREATE FUNCTION pg_temp.assert_internal_organizations_denied() RETURNS void LANGUAGE plpgsql AS $$
DECLARE statement text;
BEGIN
 FOR statement IN SELECT unnest(ARRAY[
  'SELECT public.organizer_create_organization(''b1100000-0000-4000-8000-000000000001'',''{"type":"association","name":"Forbidden"}'')',
  'SELECT public.organizer_update_organization(''b1100000-0000-4000-8000-000000000001'',''{"org_id":"b1100000-0000-4000-8000-000000000011","name":"Forbidden"}'')',
  'SELECT public.organizer_update_seller_identity(''b1100000-0000-4000-8000-000000000001'',''b1100000-0000-4000-8000-000000000011'',''Fixture seller'',''Rue Exemple 10'',NULL,''non_professional'',''+3200000000'')',
  'SELECT public.organizer_accept_platform_agreements(''b1100000-0000-4000-8000-000000000001'',''b1100000-0000-4000-8000-000000000011'',''2026-10-01'',''2026-10-01'',''2026-10-01'',''2026-10-01'')'])
 LOOP
  BEGIN
   EXECUTE statement;
   RAISE EXCEPTION 'Browser internal operation accepted for %: %',current_user,statement;
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
 END LOOP;
END $$;
-- Temporary test helper only; B6 closes implicit PUBLIC EXECUTE defaults.
GRANT EXECUTE ON FUNCTION pg_temp.assert_internal_organizations_denied() TO anon,authenticated,service_role;

SET LOCAL ROLE anon;
SELECT pg_temp.assert_internal_organizations_denied();
RESET ROLE;
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub"='b1100000-0000-4000-8000-000000000002';
SELECT pg_temp.assert_internal_organizations_denied();
RESET ROLE;

-- EXECUTE closure does not depend on RLS or on the JWT's actor claim.
ALTER TABLE public.organizations DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_profile DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_members DISABLE ROW LEVEL SECURITY;
SET LOCAL ROLE authenticated;
SELECT pg_temp.assert_internal_organizations_denied();
RESET ROLE;
SET LOCAL ROLE service_role;
SET LOCAL "request.jwt.claim.role"='service_role';
DO $$
DECLARE
 actor constant uuid:='b1100000-0000-4000-8000-000000000001';
 v_org_id uuid; result jsonb; before_count integer; sensitive text;
 old_slug text; terms_version text;
BEGIN
 v_org_id:=public.organizer_create_organization(actor,'{"type":"association","name":"B11 Organization"}');
 IF NOT EXISTS(SELECT 1 FROM public.organizations o WHERE o.id=v_org_id AND o.created_by=actor)
  OR NOT EXISTS(SELECT 1 FROM public.organization_members m WHERE m.org_id=v_org_id AND m.user_id=actor AND m.role='owner')
  OR NOT EXISTS(SELECT 1 FROM public.organization_profile p WHERE p.org_id=v_org_id AND p.display_name='B11 Organization')
  OR EXISTS(SELECT 1 FROM public.organization_members m WHERE m.org_id=v_org_id AND m.user_id<>actor)
  THEN RAISE EXCEPTION 'Atomic organization/profile/owner creation or actor propagation failed'; END IF;

 SELECT count(*) INTO before_count FROM public.organizations WHERE created_by=actor;
 BEGIN
  PERFORM public.organizer_create_organization(actor,'{"type":"association","name":"B11 Duplicate"}');
  RAISE EXCEPTION 'Second organization bypassed creator uniqueness';
 EXCEPTION WHEN raise_exception THEN IF sqlerrm<>'CONFLICT' THEN RAISE; END IF; END;
 IF (SELECT count(*) FROM public.organizations WHERE created_by=actor)<>before_count
  OR EXISTS(SELECT 1 FROM public.organization_profile WHERE display_name='B11 Duplicate')
  THEN RAISE EXCEPTION 'Rejected organization left partial data'; END IF;

 SELECT slug INTO old_slug FROM public.organization_profile WHERE organization_profile.org_id=v_org_id;
 result:=public.organizer_update_organization(actor,jsonb_build_object('org_id',v_org_id,'name','B11 Renamed','status','suspended','description','Description'));
 IF result->>'name'<>'B11 Renamed' OR result->>'status'<>'suspended'
  OR result->'profile'->>'slug'=old_slug OR result->'profile'->>'description'<>'Description'
  THEN RAISE EXCEPTION 'Organization rename/status/profile contract failed'; END IF;
 -- A failing profile write must also roll back the earlier organization write.
 BEGIN
  PERFORM public.organizer_update_organization(actor,jsonb_build_object('org_id',v_org_id,'name','B11 Must Roll Back','public_email','x'));
  RAISE EXCEPTION 'Invalid profile accepted';
 EXCEPTION WHEN check_violation THEN NULL; END;
 IF (SELECT name FROM public.organizations WHERE id=v_org_id)<>'B11 Renamed'
  THEN RAISE EXCEPTION 'Profile failure left partial organization update'; END IF;

 FOREACH sensitive IN ARRAY ARRAY['plan','role','stripe_connect_allowed','stripe_connected_account_id','payments_status','payment_status','payments_live_ready','platform_admin'] LOOP
  BEGIN
   PERFORM public.organizer_update_organization(actor,jsonb_build_object('org_id',v_org_id,sensitive,'forged'));
   RAISE EXCEPTION 'Sensitive organization field accepted: %',sensitive;
  EXCEPTION WHEN raise_exception THEN IF sqlerrm<>'VALIDATION_ERROR: invalid organization fields' THEN RAISE; END IF; END;
 END LOOP;
 IF EXISTS(SELECT 1 FROM public.user_profile WHERE user_id=actor AND stripe_connect_allowed)
  OR EXISTS(SELECT 1 FROM public.organization_members WHERE organization_members.org_id=v_org_id AND role<>'owner')
  THEN RAISE EXCEPTION 'Organization patch changed user privileges or owner role'; END IF;

 result:=public.organizer_update_seller_identity(actor,v_org_id,'  Fixture Seller  ',' Rue Example 10, 5000 Namur ',' ','non_professional',' +3200000000 ');
 terms_version:=result->>'sales_terms_version';
 IF result->>'seller_legal_name'<>'Fixture Seller' OR result->>'seller_business_number' IS NOT NULL
  THEN RAISE EXCEPTION 'Seller identity normalization lost'; END IF;
 result:=public.organizer_update_seller_identity(actor,v_org_id,'Fixture Seller','Rue Example 10, 5000 Namur',NULL,'non_professional','+3200000000');
 IF result->>'sales_terms_version'<>terms_version THEN RAISE EXCEPTION 'Unchanged seller identity changed legal version'; END IF;
 BEGIN
  PERFORM public.organizer_accept_platform_agreements(actor,v_org_id,'old','2026-10-01','2026-10-01','2026-10-01');
  RAISE EXCEPTION 'Stale agreement accepted';
 EXCEPTION WHEN raise_exception THEN IF sqlerrm<>'PLATFORM_AGREEMENTS_CHANGED' THEN RAISE; END IF; END;
 IF EXISTS(SELECT 1 FROM public.organization_profile p WHERE p.org_id=v_org_id AND p.platform_agreements_accepted_at IS NOT NULL)
  THEN RAISE EXCEPTION 'Stale agreement produced evidence'; END IF;
 result:=public.organizer_accept_platform_agreements(actor,v_org_id,'2026-10-01','2026-10-01','2026-10-01','2026-10-01');
 IF result->>'platformAgreementsAcceptedAt' IS NULL
  OR NOT EXISTS(SELECT 1 FROM public.organization_profile p WHERE p.org_id=v_org_id AND p.platform_agreements_accepted_by=actor)
  THEN RAISE EXCEPTION 'Acceptance did not preserve verified actor/timestamp'; END IF;
END $$;
RESET ROLE;
-- Audit assertions require the database fixture owner, without opening private
-- schema access to service_role merely for a test.
DO $$
DECLARE
 actor constant uuid:='b1100000-0000-4000-8000-000000000001';
 v_org_id uuid; proof private.organization_platform_acceptances%rowtype;
BEGIN
 SELECT id INTO STRICT v_org_id FROM public.organizations WHERE created_by=actor;
 SELECT * INTO STRICT proof FROM private.organization_platform_acceptances a WHERE a.org_id=v_org_id;
 IF proof.accepted_by<>actor OR proof.signer_email<>'b11-1@example.test'
  OR proof.organization_identity_snapshot->>'legal_name'<>'Fixture Seller'
  OR proof.accepted_at IS NULL
  OR proof.connect_snapshot IS DISTINCT FROM (SELECT body FROM private.legal_document_versions WHERE document_key='connect' AND version='2026-10-01')
  OR proof.dpa_snapshot IS DISTINCT FROM (SELECT body FROM private.legal_document_versions WHERE document_key='dpa' AND version='2026-10-01')
  OR proof.platform_terms_snapshot IS DISTINCT FROM (SELECT body FROM private.legal_document_versions WHERE document_key='platform_terms' AND version='2026-10-01')
  OR proof.privacy_snapshot IS DISTINCT FROM (SELECT body FROM private.legal_document_versions WHERE document_key='privacy' AND version='2026-10-01')
  OR NOT EXISTS(SELECT 1 FROM public.organization_profile p WHERE p.org_id=v_org_id AND p.platform_agreements_accepted_by=actor AND p.platform_agreements_accepted_at=proof.accepted_at)
  THEN RAISE EXCEPTION 'Legal evidence actor/version/timestamp/snapshots lost'; END IF;
END $$;
ROLLBACK;
