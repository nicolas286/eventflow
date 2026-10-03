-- Refuse inconsistent existing data; operators must inventory and resolve it
-- explicitly before applying this migration. Never repair or delete silently.
BEGIN;
LOCK TABLE public.event_form_field_groups, public.event_form_fields IN SHARE ROW EXCLUSIVE MODE;
DO $$
DECLARE inconsistent_count bigint;
BEGIN
  SELECT count(*) INTO inconsistent_count
  FROM public.event_form_fields f
  LEFT JOIN public.event_form_field_groups g ON g.id = f.group_id
  WHERE f.group_id IS NOT NULL AND (g.id IS NULL OR g.event_id <> f.event_id);
  IF inconsistent_count > 0 THEN
    RAISE EXCEPTION 'FORM_GROUP_EVENT_SCOPE_INCONSISTENT: % fields; run the A0 inventory and resolve explicitly', inconsistent_count;
  END IF;
END $$;

ALTER TABLE public.event_form_field_groups
  ADD CONSTRAINT event_form_field_groups_id_event_key UNIQUE (id, event_id);
ALTER TABLE public.event_form_fields DROP CONSTRAINT event_form_fields_group_id_fkey;
ALTER TABLE public.event_form_fields
  ADD CONSTRAINT event_form_fields_group_event_fkey
  FOREIGN KEY (group_id, event_id)
  REFERENCES public.event_form_field_groups (id, event_id)
  ON DELETE SET NULL (group_id);
-- Only group_id is cleared on deletion; event_id and the field survive.
COMMIT;
