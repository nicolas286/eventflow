-- B2.3 additive form operations. Edge owns authorization; SQL owns atomicity.
-- NO KEY UPDATE serializes organizers without blocking checkout organization FKs.
-- No product/event lock inversion: the event is read for scope, never locked here.
BEGIN;
CREATE OR REPLACE FUNCTION private.organizer_form_scope(p_actor_id uuid,p_org_id uuid,p_event_id uuid)
RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$ BEGIN
 IF p_actor_id IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
 IF p_org_id IS NULL OR p_event_id IS NULL THEN RAISE EXCEPTION 'VALIDATION_ERROR: form org_id and event_id are required'; END IF;
 PERFORM 1 FROM public.organizations WHERE id=p_org_id FOR NO KEY UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
 PERFORM 1 FROM public.events WHERE id=p_event_id AND org_id=p_org_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
END $$;
REVOKE ALL ON FUNCTION private.organizer_form_scope(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION private.organizer_form_input(p_input jsonb,p_keys text[])
RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog AS $$ BEGIN
 IF p_input IS NULL OR jsonb_typeof(p_input)<>'object' THEN RAISE EXCEPTION 'VALIDATION_ERROR: form input must be an object'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_object_keys(p_input) k WHERE k<>ALL(p_keys)) THEN RAISE EXCEPTION 'VALIDATION_ERROR: unsupported form input'; END IF;
END $$;
REVOKE ALL ON FUNCTION private.organizer_form_input(jsonb,text[]) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION private.organizer_option_length(p_text text)
RETURNS integer LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 -- Match JavaScript trim() whitespace and UTF-16 length for validation only.
 -- Never change the JSON stored or returned to callers.
 SELECT coalesce(sum(CASE WHEN ascii(ch)>65535 THEN 2 ELSE 1 END),0)::integer
 FROM regexp_split_to_table(btrim(p_text,U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF'),'') ch
 WHERE ch<>'';
$$;
REVOKE ALL ON FUNCTION private.organizer_option_length(text) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION private.organizer_validate_form_field(p_row public.event_form_fields,p_check_options boolean)
RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE item jsonb; kind text; option_kind text;
BEGIN
 IF p_row.label IS NULL OR length(trim(p_row.label))<2 THEN RAISE EXCEPTION 'VALIDATION_ERROR: label too short'; END IF;
 IF length(p_row.label)>120 THEN RAISE EXCEPTION 'VALIDATION_ERROR: label too long'; END IF;
 IF p_row.field_key IS NULL OR length(p_row.field_key)<2 OR length(p_row.field_key)>100
  OR p_row.field_key !~ '^[a-z][a-z0-9_]*$' THEN RAISE EXCEPTION 'VALIDATION_ERROR: field_key format invalid'; END IF;
 IF p_row.field_type IS NULL OR p_row.field_type NOT IN ('text','textarea','email','number','select','checkbox','radio','date','country','phone') THEN
  RAISE EXCEPTION 'VALIDATION_ERROR: field_type invalid'; END IF;
 IF p_row.sort_order IS NULL OR p_row.sort_order<0 OR p_row.sort_order>1000 THEN RAISE EXCEPTION 'VALIDATION_ERROR: sort_order invalid'; END IF;
 IF p_row.is_required IS NULL OR p_row.is_active IS NULL THEN RAISE EXCEPTION 'VALIDATION_ERROR: form flags must be booleans'; END IF;
 IF p_row.group_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.event_form_field_groups WHERE id=p_row.group_id AND event_id=p_row.event_id) THEN
  RAISE EXCEPTION 'VALIDATION_ERROR: group_id invalid'; END IF;
 IF NOT p_check_options THEN RETURN; END IF;
 IF p_row.field_type IN ('select','radio') AND p_row.options IS NULL THEN RAISE EXCEPTION 'VALIDATION_ERROR: options are required for choice fields'; END IF;
 IF p_row.options IS NULL THEN RETURN; END IF;
 IF jsonb_typeof(p_row.options)<>'array' THEN RAISE EXCEPTION 'VALIDATION_ERROR: options must be an array'; END IF;
 IF jsonb_array_length(p_row.options)<1 OR jsonb_array_length(p_row.options)>100 THEN RAISE EXCEPTION 'VALIDATION_ERROR: options must contain 1 to 100 items'; END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(p_row.options) LOOP
  kind:=jsonb_typeof(item);
  IF option_kind IS NULL THEN option_kind:=kind; END IF;
  IF kind<>option_kind THEN RAISE EXCEPTION 'VALIDATION_ERROR: options must be homogeneous'; END IF;
  IF kind='string' THEN
   IF private.organizer_option_length(item#>>'{}')<1 OR private.organizer_option_length(item#>>'{}')>80 THEN RAISE EXCEPTION 'VALIDATION_ERROR: each option must contain 1 to 80 characters'; END IF;
  ELSIF kind='object' THEN
   IF NOT (item ? 'label' AND item ? 'value') OR EXISTS(SELECT 1 FROM jsonb_object_keys(item) k WHERE k NOT IN ('label','value'))
    OR jsonb_typeof(item->'label')<>'string' OR jsonb_typeof(item->'value')<>'string'
    OR private.organizer_option_length(item->>'label')<1 OR private.organizer_option_length(item->>'label')>80
    OR private.organizer_option_length(item->>'value')<1 OR private.organizer_option_length(item->>'value')>80 THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: legacy options require label and value strings'; END IF;
  ELSE RAISE EXCEPTION 'VALIDATION_ERROR: options must contain strings or legacy objects'; END IF;
 END LOOP;
 -- Validation never rewrites option values/keys, preserving snapshot semantics.
END $$;
REVOKE ALL ON FUNCTION private.organizer_validate_form_field(public.event_form_fields,boolean) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION private.organizer_validate_form_group(p_row public.event_form_field_groups)
RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog AS $$ BEGIN
 IF p_row.label IS NULL OR length(trim(p_row.label))<1 OR length(p_row.label)>100 THEN RAISE EXCEPTION 'VALIDATION_ERROR: group label invalid'; END IF;
 IF p_row.description IS NOT NULL AND (length(trim(p_row.description))<1 OR length(p_row.description)>300) THEN RAISE EXCEPTION 'VALIDATION_ERROR: group description invalid'; END IF;
 IF p_row.sort_order IS NULL OR p_row.sort_order<0 OR p_row.sort_order>10000 THEN RAISE EXCEPTION 'VALIDATION_ERROR: group sort_order invalid'; END IF;
 IF p_row.is_active IS NULL THEN RAISE EXCEPTION 'VALIDATION_ERROR: group is_active must be a boolean'; END IF;
END $$;
REVOKE ALL ON FUNCTION private.organizer_validate_form_group(public.event_form_field_groups) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.organizer_create_event_form_field(p_actor_id uuid,p_input jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,private AS $$
DECLARE v_org uuid; r public.event_form_fields%rowtype; v_constraint text;
BEGIN
 PERFORM private.organizer_form_input(p_input,ARRAY['org_id','event_id','group_id','label','field_key','field_type','is_required','options','sort_order','is_active']);
 v_org:=nullif(trim(p_input->>'org_id'),'')::uuid;
 r.event_id:=nullif(trim(p_input->>'event_id'),'')::uuid;
 PERFORM private.organizer_form_scope(p_actor_id,v_org,r.event_id);
 r.id:=gen_random_uuid(); r.created_at:=now(); r.updated_at:=now();
 r.label:=nullif(trim(p_input->>'label'),''); r.field_key:=nullif(trim(p_input->>'field_key'),''); r.field_type:=nullif(trim(p_input->>'field_type'),'');
 r.group_id:=nullif(trim(p_input->>'group_id'),'')::uuid;
 r.is_required:=CASE WHEN p_input ? 'is_required' THEN (p_input->>'is_required')::boolean ELSE false END;
 r.is_active:=CASE WHEN p_input ? 'is_active' THEN (p_input->>'is_active')::boolean ELSE true END;
 r.sort_order:=nullif(trim(p_input->>'sort_order'),'')::integer;
 IF r.sort_order IS NULL THEN SELECT coalesce(max(sort_order),0)+1 INTO r.sort_order FROM public.event_form_fields WHERE event_id=r.event_id; END IF;
 r.options:=nullif(p_input->'options','null'::jsonb);
 -- Historical create drops options on non-choice fields.
 IF r.field_type NOT IN ('select','radio') THEN r.options:=NULL; END IF;
 PERFORM private.organizer_validate_form_field(r,true);
 PERFORM public.assert_rate_limit('create_form_field:event:'||r.event_id::text,60,3600);
 PERFORM public.assert_can_add_form_field(v_org,r.event_id);
 INSERT INTO public.event_form_fields SELECT (r).* RETURNING * INTO r;
 RETURN to_jsonb(r);
EXCEPTION WHEN unique_violation THEN
 GET STACKED DIAGNOSTICS v_constraint=CONSTRAINT_NAME;
 IF v_constraint='event_form_fields_event_id_field_key_key' THEN RAISE EXCEPTION 'DUPLICATE_FIELD_KEY'; END IF;
 RAISE EXCEPTION 'CONFLICT';
END $$;
REVOKE ALL ON FUNCTION public.organizer_create_event_form_field(uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.organizer_create_event_form_field(uuid,jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.organizer_update_event_form_field(p_actor_id uuid,p_input jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,private AS $$
DECLARE v_org uuid; v_event uuid; v_id uuid; r public.event_form_fields%rowtype; was_active boolean; v_constraint text;
BEGIN
 PERFORM private.organizer_form_input(p_input,ARRAY['org_id','event_id','field_id','group_id','label','field_key','field_type','is_required','options','sort_order','is_active']);
 v_org:=nullif(trim(p_input->>'org_id'),'')::uuid; v_event:=nullif(trim(p_input->>'event_id'),'')::uuid; v_id:=nullif(trim(p_input->>'field_id'),'')::uuid;
 IF v_id IS NULL THEN RAISE EXCEPTION 'VALIDATION_ERROR: field_id is required'; END IF;
 PERFORM private.organizer_form_scope(p_actor_id,v_org,v_event);
 SELECT * INTO r FROM public.event_form_fields WHERE id=v_id AND event_id=v_event FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
 was_active:=r.is_active;
 IF p_input ? 'label' THEN r.label:=nullif(trim(p_input->>'label'),''); END IF;
 IF p_input ? 'field_key' THEN r.field_key:=nullif(trim(p_input->>'field_key'),''); END IF;
 IF p_input ? 'field_type' THEN r.field_type:=nullif(trim(p_input->>'field_type'),''); END IF;
 IF p_input ? 'group_id' THEN r.group_id:=nullif(trim(p_input->>'group_id'),'')::uuid; END IF;
 IF p_input ? 'is_required' THEN r.is_required:=(p_input->>'is_required')::boolean; END IF;
 IF p_input ? 'is_active' THEN r.is_active:=(p_input->>'is_active')::boolean; END IF;
 IF p_input ? 'sort_order' THEN r.sort_order:=(p_input->>'sort_order')::integer; END IF;
 IF p_input ? 'options' THEN r.options:=nullif(p_input->'options','null'::jsonb); END IF;
 -- A label-only patch leaves legacy JSON untouched. Explicit options/type
 -- edits validate the final options, including inherited legacy object arrays.
 PERFORM private.organizer_validate_form_field(r,p_input ? 'options' OR p_input ? 'field_type');
 IF NOT was_active AND r.is_active THEN PERFORM public.assert_can_add_form_field(v_org,v_event); END IF;
 UPDATE public.event_form_fields SET group_id=r.group_id,label=r.label,field_key=r.field_key,field_type=r.field_type,
  is_required=r.is_required,options=r.options,sort_order=r.sort_order,is_active=r.is_active,updated_at=now()
  WHERE id=v_id AND event_id=v_event RETURNING * INTO r;
 RETURN to_jsonb(r);
EXCEPTION WHEN unique_violation THEN
 GET STACKED DIAGNOSTICS v_constraint=CONSTRAINT_NAME;
 IF v_constraint='event_form_fields_event_id_field_key_key' THEN RAISE EXCEPTION 'DUPLICATE_FIELD_KEY'; END IF;
 RAISE EXCEPTION 'CONFLICT';
END $$;
REVOKE ALL ON FUNCTION public.organizer_update_event_form_field(uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.organizer_update_event_form_field(uuid,jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.organizer_create_event_form_field_group(p_actor_id uuid,p_input jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,private AS $$
DECLARE v_org uuid; r public.event_form_field_groups%rowtype;
BEGIN
 PERFORM private.organizer_form_input(p_input,ARRAY['org_id','event_id','label','description','sort_order','is_active']);
 v_org:=nullif(trim(p_input->>'org_id'),'')::uuid; r.event_id:=nullif(trim(p_input->>'event_id'),'')::uuid;
 PERFORM private.organizer_form_scope(p_actor_id,v_org,r.event_id);
 r.id:=gen_random_uuid(); r.created_at:=now(); r.updated_at:=now();
 r.label:=nullif(trim(p_input->>'label'),''); r.description:=nullif(trim(p_input->>'description'),'');
 r.is_active:=CASE WHEN p_input ? 'is_active' THEN (p_input->>'is_active')::boolean ELSE true END;
 r.sort_order:=nullif(trim(p_input->>'sort_order'),'')::integer;
 IF r.sort_order IS NULL THEN SELECT coalesce(max(sort_order),0)+1 INTO r.sort_order FROM public.event_form_field_groups WHERE event_id=r.event_id; END IF;
 PERFORM private.organizer_validate_form_group(r);
 PERFORM public.assert_rate_limit('create_form_field_group:event:'||r.event_id::text,60,3600);
 INSERT INTO public.event_form_field_groups SELECT (r).* RETURNING * INTO r;
 RETURN to_jsonb(r);
EXCEPTION WHEN unique_violation THEN RAISE EXCEPTION 'CONFLICT';
END $$;
REVOKE ALL ON FUNCTION public.organizer_create_event_form_field_group(uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.organizer_create_event_form_field_group(uuid,jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.organizer_update_event_form_field_group(p_actor_id uuid,p_input jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,private AS $$
DECLARE v_org uuid; v_event uuid; v_id uuid; r public.event_form_field_groups%rowtype;
BEGIN
 PERFORM private.organizer_form_input(p_input,ARRAY['org_id','event_id','group_id','label','description','sort_order','is_active']);
 v_org:=nullif(trim(p_input->>'org_id'),'')::uuid; v_event:=nullif(trim(p_input->>'event_id'),'')::uuid; v_id:=nullif(trim(p_input->>'group_id'),'')::uuid;
 IF v_id IS NULL THEN RAISE EXCEPTION 'VALIDATION_ERROR: group_id is required'; END IF;
 PERFORM private.organizer_form_scope(p_actor_id,v_org,v_event);
 SELECT * INTO r FROM public.event_form_field_groups WHERE id=v_id AND event_id=v_event FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
 IF p_input ? 'label' THEN r.label:=nullif(trim(p_input->>'label'),''); END IF;
 IF p_input ? 'description' THEN r.description:=nullif(trim(p_input->>'description'),''); END IF;
 IF p_input ? 'sort_order' THEN r.sort_order:=(p_input->>'sort_order')::integer; END IF;
 IF p_input ? 'is_active' THEN r.is_active:=(p_input->>'is_active')::boolean; END IF;
 PERFORM private.organizer_validate_form_group(r);
 UPDATE public.event_form_field_groups SET label=r.label,description=r.description,sort_order=r.sort_order,is_active=r.is_active,updated_at=now()
  WHERE id=v_id AND event_id=v_event RETURNING * INTO r;
 RETURN to_jsonb(r);
END $$;
REVOKE ALL ON FUNCTION public.organizer_update_event_form_field_group(uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.organizer_update_event_form_field_group(uuid,jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.organizer_delete_event_form_field(p_actor_id uuid,p_org_id uuid,p_event_id uuid,p_field_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,private AS $$ BEGIN
 PERFORM private.organizer_form_scope(p_actor_id,p_org_id,p_event_id);
 PERFORM 1 FROM public.event_form_fields WHERE id=p_field_id AND event_id=p_event_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
 DELETE FROM public.event_form_fields WHERE id=p_field_id AND event_id=p_event_id;
 -- Answers contain independent snapshots, no field FK: deletion preserves them.
 RETURN jsonb_build_object('success',true);
END $$;
REVOKE ALL ON FUNCTION public.organizer_delete_event_form_field(uuid,uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.organizer_delete_event_form_field(uuid,uuid,uuid,uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.organizer_delete_event_form_field_group(p_actor_id uuid,p_org_id uuid,p_event_id uuid,p_group_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,private AS $$ BEGIN
 PERFORM private.organizer_form_scope(p_actor_id,p_org_id,p_event_id);
 PERFORM 1 FROM public.event_form_field_groups WHERE id=p_group_id AND event_id=p_event_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
 PERFORM 1 FROM public.event_form_fields WHERE group_id=p_group_id AND event_id=p_event_id ORDER BY id FOR UPDATE;
 DELETE FROM public.event_form_field_groups WHERE id=p_group_id AND event_id=p_event_id;
 -- A2 composite FK clears only group_id, leaving fields and event_id intact.
 RETURN jsonb_build_object('success',true);
END $$;
REVOKE ALL ON FUNCTION public.organizer_delete_event_form_field_group(uuid,uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.organizer_delete_event_form_field_group(uuid,uuid,uuid,uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.organizer_reorder_event_form(p_actor_id uuid,p_input jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,private AS $$
DECLARE v_org uuid; v_event uuid; fields jsonb; groups jsonb; batch jsonb; item jsonb; i int; maximum int;
BEGIN
 PERFORM private.organizer_form_input(p_input,ARRAY['org_id','event_id','fields','groups']);
 v_org:=nullif(trim(p_input->>'org_id'),'')::uuid; v_event:=nullif(trim(p_input->>'event_id'),'')::uuid;
 PERFORM private.organizer_form_scope(p_actor_id,v_org,v_event);
 fields:=coalesce(p_input->'fields','[]'); groups:=coalesce(p_input->'groups','[]');
 IF jsonb_typeof(fields)<>'array' OR jsonb_typeof(groups)<>'array' THEN RAISE EXCEPTION 'VALIDATION_ERROR: reorder arrays required'; END IF;
 IF jsonb_array_length(fields)>100 OR jsonb_array_length(groups)>100 OR jsonb_array_length(fields)+jsonb_array_length(groups)=0 THEN
  RAISE EXCEPTION 'VALIDATION_ERROR: reorder requires 1 to 100 items per array'; END IF;
 FOR i IN 1..2 LOOP
  batch:=CASE WHEN i=1 THEN fields ELSE groups END; maximum:=CASE WHEN i=1 THEN 1000 ELSE 10000 END;
  FOR item IN SELECT value FROM jsonb_array_elements(batch) LOOP
   PERFORM private.organizer_form_input(item,ARRAY['id','sort_order']);
   IF NOT (item ? 'id' AND item ? 'sort_order') OR jsonb_typeof(item->'id')<>'string'
    OR jsonb_typeof(item->'sort_order')<>'number' OR (item->>'sort_order') !~ '^[0-9]+$'
    OR (item->>'sort_order')::numeric>maximum THEN RAISE EXCEPTION 'VALIDATION_ERROR: reorder item invalid'; END IF;
   PERFORM (item->>'id')::uuid;
  END LOOP;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(batch) t GROUP BY (t.value->>'id')::uuid HAVING count(*)>1) THEN
   RAISE EXCEPTION 'VALIDATION_ERROR: duplicate reorder id'; END IF;
 END LOOP;
 -- Validate/lock every group and field before the first write; foreign IDs
 -- cannot leave the other half of this combined batch partially reordered.
 PERFORM 1 FROM public.event_form_field_groups WHERE event_id=v_event AND id IN (SELECT (value->>'id')::uuid FROM jsonb_array_elements(groups)) ORDER BY id FOR UPDATE;
 IF (SELECT count(*) FROM public.event_form_field_groups WHERE event_id=v_event AND id IN (SELECT (value->>'id')::uuid FROM jsonb_array_elements(groups)))<>jsonb_array_length(groups) THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
 PERFORM 1 FROM public.event_form_fields WHERE event_id=v_event AND id IN (SELECT (value->>'id')::uuid FROM jsonb_array_elements(fields)) ORDER BY id FOR UPDATE;
 IF (SELECT count(*) FROM public.event_form_fields WHERE event_id=v_event AND id IN (SELECT (value->>'id')::uuid FROM jsonb_array_elements(fields)))<>jsonb_array_length(fields) THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
 UPDATE public.event_form_field_groups g SET sort_order=(item.value->>'sort_order')::integer,updated_at=now()
  FROM jsonb_array_elements(groups) item WHERE g.id=(item.value->>'id')::uuid AND g.event_id=v_event;
 UPDATE public.event_form_fields f SET sort_order=(item.value->>'sort_order')::integer,updated_at=now()
  FROM jsonb_array_elements(fields) item WHERE f.id=(item.value->>'id')::uuid AND f.event_id=v_event;
 RETURN jsonb_build_object('success',true);
END $$;
REVOKE ALL ON FUNCTION public.organizer_reorder_event_form(uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.organizer_reorder_event_form(uuid,jsonb) TO service_role;
COMMIT;
