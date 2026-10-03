-- Preserve business edits during the Edge migration, but close system writes.
-- Column REVOKE alone is ineffective while a table-level grant still exists.
BEGIN;
REVOKE INSERT, UPDATE, TRUNCATE ON TABLE public.event_products
  FROM PUBLIC, anon, authenticated;

-- Clear pre-existing column grants too, including any on new system columns.
DO $$
DECLARE columns_sql text;
BEGIN
  SELECT string_agg(format('%I', attname), ', ' ORDER BY attnum) INTO columns_sql
  FROM pg_attribute
  WHERE attrelid = 'public.event_products'::regclass AND attnum > 0 AND NOT attisdropped;
  EXECUTE format('REVOKE INSERT (%s), UPDATE (%s) ON TABLE public.event_products FROM PUBLIC, anon, authenticated',
                 columns_sql, columns_sql);
END $$;

-- Identifiers and timestamps use DB defaults on creation. event_id is needed
-- only to create the relation; moving an existing product is not a front flow.
GRANT INSERT (event_id, name, description, price_cents, currency, stock_qty,
  is_active, sort_order, creates_attendees, attendees_per_unit,
  is_gatekeeper, close_event_when_sold_out)
  ON TABLE public.event_products TO authenticated;
GRANT UPDATE (name, description, price_cents, currency, stock_qty,
  is_active, sort_order, creates_attendees, attendees_per_unit,
  is_gatekeeper, close_event_when_sold_out)
  ON TABLE public.event_products TO authenticated;
-- SELECT/DELETE, current RLS, and server/SECURITY DEFINER stock operations stay
-- in place. Browser writes to id/event_id, timestamps and counters are closed.
COMMIT;
