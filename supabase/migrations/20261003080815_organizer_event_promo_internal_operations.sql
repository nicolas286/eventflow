-- B2.4 additive internal promos. Edge authorizes the organization/resources.
-- Preserve existing constraints, counters, timestamps and redemption snapshots.
BEGIN;
CREATE OR REPLACE FUNCTION private.organizer_promo_scope(p_actor_id uuid,p_org_id uuid,p_event_id uuid)
RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$ BEGIN
 IF p_actor_id IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
 IF p_org_id IS NULL OR p_event_id IS NULL THEN RAISE EXCEPTION 'VALIDATION_ERROR: promo org_id and event_id are required'; END IF;
 -- Compatible with checkout product -> event -> promo -> org FK KEY SHARE.
 PERFORM 1 FROM public.organizations WHERE id=p_org_id FOR NO KEY UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
 PERFORM 1 FROM public.events WHERE id=p_event_id AND org_id=p_org_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
END $$;
REVOKE ALL ON FUNCTION private.organizer_promo_scope(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION private.organizer_validate_promo(p_row public.promo_codes)
RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog AS $$ BEGIN
 -- Legacy rows may retain padding: the existing CHECK measures trim(code).
 -- A non-code patch validates that rule without normalizing the stored value.
 IF p_row.code IS NULL OR length(trim(p_row.code))<1 OR length(trim(p_row.code))>20 THEN RAISE EXCEPTION 'VALIDATION_ERROR: promo code must contain 1 to 20 characters'; END IF;
 IF NOT ((p_row.discount_percent IS NOT NULL AND p_row.discount_percent BETWEEN 1 AND 100 AND p_row.discount_cents IS NULL)
  OR (p_row.discount_cents IS NOT NULL AND p_row.discount_cents BETWEEN 1 AND 100000 AND p_row.discount_percent IS NULL)) THEN
  RAISE EXCEPTION 'VALIDATION_ERROR: promo requires exactly one valid discount type'; END IF;
 IF p_row.max_uses IS NOT NULL AND (p_row.max_uses<1 OR p_row.max_uses>99999) THEN RAISE EXCEPTION 'VALIDATION_ERROR: promo max_uses invalid'; END IF;
 IF p_row.starts_at IS NOT NULL AND p_row.ends_at IS NOT NULL AND p_row.starts_at>=p_row.ends_at THEN RAISE EXCEPTION 'VALIDATION_ERROR: promo date range invalid'; END IF;
 IF p_row.is_active IS NULL THEN RAISE EXCEPTION 'VALIDATION_ERROR: promo is_active must be a boolean'; END IF;
 -- max_uses below used_count is valid: subsequent checkout treats it as exhausted.
END $$;
REVOKE ALL ON FUNCTION private.organizer_validate_promo(public.promo_codes) FROM PUBLIC,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION private.organizer_promo_input(p_input jsonb,p_is_update boolean)
RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog AS $$ BEGIN
 IF p_input IS NULL OR jsonb_typeof(p_input)<>'object' THEN RAISE EXCEPTION 'VALIDATION_ERROR: promo input must be an object'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_object_keys(p_input) k WHERE k<>ALL(ARRAY['org_id','event_id','code','discount_percent','discount_cents','max_uses','starts_at','ends_at','is_active']) AND NOT (p_is_update AND k='promo_code_id')) THEN
  RAISE EXCEPTION 'VALIDATION_ERROR: unsupported promo input'; END IF;
END $$;
REVOKE ALL ON FUNCTION private.organizer_promo_input(jsonb,boolean) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.organizer_create_event_promo_code(p_actor_id uuid,p_input jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,private AS $$
DECLARE r public.promo_codes%rowtype; v_constraint text;
BEGIN
 PERFORM private.organizer_promo_input(p_input,false);
 r.org_id:=(p_input->>'org_id')::uuid; r.event_id:=(p_input->>'event_id')::uuid;
 PERFORM private.organizer_promo_scope(p_actor_id,r.org_id,r.event_id);
 r.code:=upper(btrim(p_input->>'code',U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF'));
 r.discount_percent:=(p_input->>'discount_percent')::integer; r.discount_cents:=(p_input->>'discount_cents')::integer;
 r.max_uses:=(p_input->>'max_uses')::integer; r.starts_at:=(p_input->>'starts_at')::timestamptz; r.ends_at:=(p_input->>'ends_at')::timestamptz;
 r.is_active:=CASE WHEN p_input ? 'is_active' THEN (p_input->>'is_active')::boolean ELSE true END;
 PERFORM private.organizer_validate_promo(r);
 INSERT INTO public.promo_codes(org_id,event_id,code,discount_percent,discount_cents,max_uses,starts_at,ends_at,is_active)
 VALUES(r.org_id,r.event_id,r.code,r.discount_percent,r.discount_cents,r.max_uses,r.starts_at,r.ends_at,r.is_active)
 RETURNING * INTO r;
 RETURN to_jsonb(r);
EXCEPTION WHEN unique_violation THEN
 GET STACKED DIAGNOSTICS v_constraint=CONSTRAINT_NAME;
 IF v_constraint='promo_codes_event_code_unique' THEN RAISE EXCEPTION 'DUPLICATE_PROMO_CODE'; END IF;
 RAISE;
END $$;
REVOKE ALL ON FUNCTION public.organizer_create_event_promo_code(uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.organizer_create_event_promo_code(uuid,jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.organizer_update_event_promo_code(p_actor_id uuid,p_input jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,private AS $$
DECLARE v_org uuid; v_event uuid; v_id uuid; r public.promo_codes%rowtype; v_constraint text;
BEGIN
 PERFORM private.organizer_promo_input(p_input,true);
 v_org:=(p_input->>'org_id')::uuid; v_event:=(p_input->>'event_id')::uuid; v_id:=(p_input->>'promo_code_id')::uuid;
 IF v_id IS NULL THEN RAISE EXCEPTION 'VALIDATION_ERROR: promo_code_id is required'; END IF;
 PERFORM private.organizer_promo_scope(p_actor_id,v_org,v_event);
 SELECT * INTO r FROM public.promo_codes WHERE id=v_id AND org_id=v_org AND event_id=v_event FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
 IF p_input ? 'code' THEN r.code:=upper(btrim(p_input->>'code',U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF')); END IF;
 IF p_input ? 'discount_percent' THEN r.discount_percent:=(p_input->>'discount_percent')::integer; END IF;
 IF p_input ? 'discount_cents' THEN r.discount_cents:=(p_input->>'discount_cents')::integer; END IF;
 IF p_input ? 'max_uses' THEN r.max_uses:=(p_input->>'max_uses')::integer; END IF;
 IF p_input ? 'starts_at' THEN r.starts_at:=(p_input->>'starts_at')::timestamptz; END IF;
 IF p_input ? 'ends_at' THEN r.ends_at:=(p_input->>'ends_at')::timestamptz; END IF;
 IF p_input ? 'is_active' THEN r.is_active:=(p_input->>'is_active')::boolean; END IF;
 PERFORM private.organizer_validate_promo(r);
 -- No updated_at trigger exists. Preserve the legacy direct-patch timestamp.
 UPDATE public.promo_codes SET code=r.code,discount_percent=r.discount_percent,discount_cents=r.discount_cents,
  max_uses=r.max_uses,starts_at=r.starts_at,ends_at=r.ends_at,is_active=r.is_active
 WHERE id=v_id AND org_id=v_org AND event_id=v_event RETURNING * INTO r;
 RETURN to_jsonb(r);
EXCEPTION WHEN unique_violation THEN
 GET STACKED DIAGNOSTICS v_constraint=CONSTRAINT_NAME;
 IF v_constraint='promo_codes_event_code_unique' THEN RAISE EXCEPTION 'DUPLICATE_PROMO_CODE'; END IF;
 RAISE;
END $$;
REVOKE ALL ON FUNCTION public.organizer_update_event_promo_code(uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.organizer_update_event_promo_code(uuid,jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.organizer_delete_event_promo_code(p_actor_id uuid,p_org_id uuid,p_event_id uuid,p_promo_code_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,private AS $$ BEGIN
 PERFORM private.organizer_promo_scope(p_actor_id,p_org_id,p_event_id);
 IF p_promo_code_id IS NULL THEN RAISE EXCEPTION 'VALIDATION_ERROR: promo_code_id is required'; END IF;
 PERFORM 1 FROM public.promo_codes WHERE id=p_promo_code_id AND org_id=p_org_id AND event_id=p_event_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
 DELETE FROM public.promo_codes WHERE id=p_promo_code_id AND org_id=p_org_id AND event_id=p_event_id;
 -- Existing redemption FK RESTRICT is the rule; no new used_count guard.
 RETURN jsonb_build_object('success',true);
END $$;
REVOKE ALL ON FUNCTION public.organizer_delete_event_promo_code(uuid,uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.organizer_delete_event_promo_code(uuid,uuid,uuid,uuid) TO service_role;
COMMIT;
