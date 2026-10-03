import { assertDisposableOrganizerContainer } from './disposable-container.mjs';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const container = process.argv[2];
assertDisposableOrganizerContainer(container);
function run(input, name) {
  const result = spawnSync('docker', ['exec','-i',container,'psql','-X','-q','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1'], { input, encoding:'utf8', windowsHide:true });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${name}: ${result.stderr || result.stdout}`);
  console.log(`B3 SQL ${name}: passed, rolled back`);
}
run(readFileSync(new URL('./b3/orders.sql',import.meta.url),'utf8'),'transactions');
const closure=readFileSync(new URL('../../supabase/deferred-migrations/b3/20261003130000_close_orders_browser_access.sql',import.meta.url),'utf8');
run(readFileSync(new URL('./b3/orders-closure.sql',import.meta.url),'utf8').replace('BEGIN;',`BEGIN;
GRANT SELECT(buyer_email),UPDATE(buyer_email) ON public.orders TO PUBLIC, anon, authenticated;
DO $grant$ DECLARE f record; BEGIN FOR f IN SELECT oid::regprocedure signature FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN ('search_event_admin_orders_view','search_event_admin_tickets_view','get_event_admin_orders_view','get_event_admin_participants_export_data','admin_update_order_attendee','admin_delete_order','get_bank_transfer_admin_summaries','expire_bank_transfer_order') LOOP EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO PUBLIC',f.signature); END LOOP; END $grant$;
${closure}`),'closure with/without RLS');
