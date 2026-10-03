-- B1.2 internal billing operations, disposable fixtures only.
BEGIN;
UPDATE private.platform_settings SET registrations_open=true WHERE singleton;
INSERT INTO auth.users(id,aud,role,email,encrypted_password,created_at,updated_at,raw_user_meta_data)
VALUES ('b1200000-0000-4000-8000-000000000001','authenticated','authenticated','b12@example.test','',now(),now(),
 '{"platform_terms_version":"2026-10-01","platform_terms_accepted":true}');
INSERT INTO public.organizations(id,type,name,created_by)
VALUES ('b1200000-0000-4000-8000-000000000011','association','B12 Billing','b1200000-0000-4000-8000-000000000001');

DO $$ DECLARE p record; n integer:=0; BEGIN
 FOR p IN SELECT proc.* FROM pg_proc proc JOIN pg_namespace ns ON ns.oid=proc.pronamespace
  WHERE ns.nspname='public' AND proc.proname='organizer_upsert_organization_billing'
 LOOP
  n:=n+1;
  IF has_function_privilege('anon',p.oid,'EXECUTE') OR has_function_privilege('authenticated',p.oid,'EXECUTE')
   OR EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.grantee=0)
   OR NOT has_function_privilege('service_role',p.oid,'EXECUTE')
   THEN RAISE EXCEPTION 'Bad internal billing ACL: %',p.oid::regprocedure; END IF;
 END LOOP;
 IF n<>1 THEN RAISE EXCEPTION 'Re-inventory billing internal overloads: %',n; END IF;
END $$;
CREATE FUNCTION pg_temp.assert_internal_billing_denied() RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 BEGIN
  PERFORM public.organizer_upsert_organization_billing('b1200000-0000-4000-8000-000000000001',
   '{"org_id":"b1200000-0000-4000-8000-000000000011","legal_name":"Forged Billing"}');
  RAISE EXCEPTION 'Browser called internal billing: %',current_user;
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
-- Temporary test helper only; B6 closes implicit PUBLIC EXECUTE defaults.
GRANT EXECUTE ON FUNCTION pg_temp.assert_internal_billing_denied() TO anon,authenticated,service_role;
SET LOCAL ROLE anon;
SELECT pg_temp.assert_internal_billing_denied();
RESET ROLE;
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub"='b1200000-0000-4000-8000-000000000001';
SELECT pg_temp.assert_internal_billing_denied();
RESET ROLE;
ALTER TABLE public.organization_billing DISABLE ROW LEVEL SECURITY;
SET LOCAL ROLE anon;
SELECT pg_temp.assert_internal_billing_denied();
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT pg_temp.assert_internal_billing_denied();
RESET ROLE;
SET LOCAL ROLE service_role;
SET LOCAL "request.jwt.claim.role"='service_role';
-- JWT subject deliberately differs from the verified Edge actor parameter.
SET LOCAL "request.jwt.claim.sub"='b1200000-0000-4000-8000-000000000002';
DO $$
DECLARE actor constant uuid:='b1200000-0000-4000-8000-000000000001';
 org constant uuid:='b1200000-0000-4000-8000-000000000011';
 r jsonb; field text;
BEGIN
 BEGIN
  PERFORM public.organizer_upsert_organization_billing(actor,jsonb_build_object('org_id',org,'legal_name','Incomplete'));
  RAISE EXCEPTION 'Incomplete first billing setup accepted';
 EXCEPTION WHEN raise_exception THEN
  IF sqlerrm<>'VALIDATION_ERROR: missing required fields for first billing setup' THEN RAISE; END IF;
 END;
 IF EXISTS(SELECT 1 FROM public.organization_billing WHERE org_id=org)
  THEN RAISE EXCEPTION 'Rejected first setup left partial billing'; END IF;
 r:=public.organizer_upsert_organization_billing(actor,jsonb_build_object(
  'org_id',org,'legal_name','  Fixture Legal Name  ','address_line1',' Rue Exemple 10 ',
  'address_line2',' Floor 2 ','postal_code',' 5000 ','city',' Namur ','country_code',' be ',
  'vat_country_code',' be ','vat_number',' be 0123 456 789 ','billing_email',' Billing@Example.Test ',
  'invoice_reference',' REF-01 '));
 IF r->>'legalName'<>'Fixture Legal Name' OR r->>'countryCode'<>'BE' OR r->>'city'<>'Namur'
  OR r->>'billingEmail'<>'billing@example.test' OR r->>'vatCountryCode'<>'BE'
  OR r->>'vatNumber'<>'BE0123456789' OR (r->>'isVatValidated')::boolean
  THEN RAISE EXCEPTION 'Billing normalization or validation initialization changed'; END IF;
 UPDATE public.organization_billing SET is_vat_validated=true,vat_validated_at=now(),vat_validation_source='fixture-vies'
  WHERE org_id=org;
 r:=public.organizer_upsert_organization_billing(actor,jsonb_build_object('org_id',org,'city','Bruxelles'));
 IF r->>'legalName'<>'Fixture Legal Name' OR r->>'addressLine2'<>'Floor 2'
  OR r->>'billingEmail'<>'billing@example.test' OR NOT (r->>'isVatValidated')::boolean
  OR r->>'vatValidationSource'<>'fixture-vies'
  THEN RAISE EXCEPTION 'Absent fields or unchanged VAT validation were overwritten'; END IF;
 r:=public.organizer_upsert_organization_billing(actor,jsonb_build_object('org_id',org,'address_line2',NULL,'invoice_reference',' ','billing_email',NULL));
 IF r->>'addressLine2' IS NOT NULL OR r->>'invoiceReference' IS NOT NULL OR r->>'billingEmail' IS NOT NULL
  OR r->>'city'<>'Bruxelles' OR NOT (r->>'isVatValidated')::boolean
  THEN RAISE EXCEPTION 'Explicit clearing differs from omitted fields'; END IF;
 r:=public.organizer_upsert_organization_billing(actor,jsonb_build_object('org_id',org,'vat_number','BE9999999999'));
 IF (r->>'isVatValidated')::boolean OR r->>'vatValidatedAt' IS NOT NULL OR r->>'vatValidationSource' IS NOT NULL
  OR r->>'vatCountryCode'<>'BE' THEN RAISE EXCEPTION 'VAT identity change did not reset validation'; END IF;
 BEGIN
  PERFORM public.organizer_upsert_organization_billing(actor,jsonb_build_object('org_id',org,'legal_name','Partial Update','vat_country_code','BE','vat_number',NULL));
  RAISE EXCEPTION 'Inconsistent VAT pair accepted';
 EXCEPTION WHEN raise_exception THEN IF sqlerrm<>'VALIDATION_ERROR: vat_number required when vat_country_code is set' THEN RAISE; END IF; END;
 IF (SELECT legal_name FROM public.organization_billing WHERE org_id=org)<>'Fixture Legal Name'
  THEN RAISE EXCEPTION 'Invalid VAT patch produced partial changes'; END IF;
 FOREACH field IN ARRAY ARRAY['is_vat_validated','vat_validated_at','vat_validation_source','actor_id','plan'] LOOP
  BEGIN
   PERFORM public.organizer_upsert_organization_billing(actor,jsonb_build_object('org_id',org,field,'forged'));
   RAISE EXCEPTION 'Forbidden billing field accepted: %',field;
  EXCEPTION WHEN raise_exception THEN
   IF sqlerrm NOT IN ('VALIDATION_ERROR: forbidden billing validation fields','VALIDATION_ERROR: invalid billing fields') THEN RAISE; END IF;
  END;
 END LOOP;
 BEGIN
  PERFORM public.organizer_upsert_organization_billing(NULL,jsonb_build_object('org_id',org,'city','Bruxelles'));
  RAISE EXCEPTION 'Missing server actor accepted';
 EXCEPTION WHEN raise_exception THEN IF sqlerrm<>'NOT_AUTHENTICATED' THEN RAISE; END IF; END;
END $$;
RESET ROLE;
ROLLBACK;
