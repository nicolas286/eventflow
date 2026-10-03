// Only run against the disposable DB rebuilt by CI or the B0 local recipe.
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const container = process.argv[2];
if (!container?.startsWith('supabase_db_') || !/^[a-zA-Z0-9_-]+$/.test(container)) {
  throw new Error('Pass the disposable Supabase DB container name');
}
const closure = readFileSync(new URL('../../supabase/deferred-migrations/b0/20261002213326_close_invoice_history_browser_access.sql', import.meta.url), 'utf8');
const assertions = readFileSync(new URL('./b0/invoice-history.sql', import.meta.url), 'utf8');
// Seed permissive column/PUBLIC grants to prove closure removes those too.
const input = `BEGIN;
GRANT SELECT(number) ON public.invoices TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_list_invoices(uuid,integer,timestamptz,uuid) TO PUBLIC;
${closure}
${assertions}
ROLLBACK;`;
const result = spawnSync('docker', ['exec', '-i', container, 'psql', '-X', '-q', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'], { input, encoding: 'utf8' });
if (result.error) throw result.error;
if (result.status !== 0) throw new Error(result.stderr || result.stdout);
console.log('B0 SQL: browser ACLs denied with/without RLS; server access preserved; transaction rolled back.');
