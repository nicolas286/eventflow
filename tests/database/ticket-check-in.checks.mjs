import { assertDisposableOrganizerContainer } from './disposable-container.mjs';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const container=process.argv[2];assertDisposableOrganizerContainer(container);
function run(input){const r=spawnSync('docker',['exec','-i',container,'psql','-X','-qAt','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1'],{input,encoding:'utf8',windowsHide:true});if(r.status!==0)throw new Error(r.stderr);}
run(readFileSync(new URL('./b4/tickets.sql',import.meta.url),'utf8'));
const closure=readFileSync(new URL('../../supabase/deferred-migrations/b4/20261003140000_close_ticket_check_in_browser_access.sql',import.meta.url),'utf8').replace(/^begin;$/mi,'').replace(/^commit;$/mi,'');
let checks=`BEGIN;
GRANT SELECT(id),UPDATE(status) ON public.tickets TO PUBLIC, anon, authenticated;
DO $drift$ DECLARE f record; BEGIN FOR f IN SELECT oid::regprocedure signature FROM pg_proc WHERE pronamespace='public'::regnamespace
 AND proname IN ('get_event_tickets_admin','mark_ticket_checked_in','mark_ticket_checked_in_by_qr','check_in_ticket_internal')
 LOOP EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO PUBLIC',f.signature); END LOOP; END $drift$;`+closure;
for(const role of ['anon','authenticated'])for(const statement of [
 "select public.get_event_tickets_admin(gen_random_uuid())", "select public.mark_ticket_checked_in(gen_random_uuid(),gen_random_uuid())", "select public.mark_ticket_checked_in_by_qr('forged',gen_random_uuid())",
 "select public.organizer_get_event_tickets_admin(gen_random_uuid(),gen_random_uuid())", "select public.organizer_check_in_ticket(gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid())", "select public.organizer_check_in_ticket_by_qr(gen_random_uuid(),gen_random_uuid(),'fake',gen_random_uuid())",
 'select id from public.tickets',"update public.tickets set status='checked_in'" ])checks+=`SET LOCAL ROLE ${role}; DO $test$ BEGIN BEGIN ${statement}; EXCEPTION WHEN insufficient_privilege THEN RETURN; END; RAISE EXCEPTION 'access accepted'; END $test$; RESET ROLE;`;
checks+='ALTER TABLE public.tickets DISABLE ROW LEVEL SECURITY;';
for(const role of ['anon','authenticated'])checks+=`SET LOCAL ROLE ${role};DO $test$ BEGIN BEGIN PERFORM id FROM public.tickets;EXCEPTION WHEN insufficient_privilege THEN RETURN;END;RAISE EXCEPTION 'RLS dependency';END $test$;RESET ROLE;`;
run(checks+'ROLLBACK;');console.log('PASS B4 SQL scope, stable pagination, actor, cancelled/repeat, historical refunded debt, browser closure without RLS');
