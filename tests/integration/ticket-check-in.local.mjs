import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const workdir=process.argv[2], project='eventflow-security-b4-20261003';
if(!workdir || !readFileSync(`${workdir}/supabase/config.toml`,'utf8').includes(`project_id = "${project}"`)) throw new Error('Pass only the isolated B4 workdir');
const container=`supabase_db_${project}`;
function sql(input){const r=spawnSync('docker',['exec','-i',container,'psql','-X','-qAt','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1'],{input,encoding:'utf8',windowsHide:true});if(r.status!==0)throw new Error(r.stderr);return r.stdout.trim();}
const status=spawnSync('supabase',['status','--workdir',workdir,'--output','json'],{encoding:'utf8',windowsHide:true});
if(status.status!==0)throw new Error('Cannot read isolated local runtime');
const runtime=JSON.parse(status.stdout);
if(!runtime.API_URL?.startsWith('http://127.0.0.1:') || !runtime.ANON_KEY || !runtime.SERVICE_ROLE_KEY)throw new Error('Missing synthetic loopback configuration');
const tables=['orders','order_items','order_attendees','order_attendee_answers','payments','tickets','organization_members','events'];
const wasOpen=sql('select registrations_open from private.platform_settings where singleton;');
try{
 const closure=readFileSync(new URL('../../supabase/deferred-migrations/b3/20261003130000_close_orders_browser_access.sql',import.meta.url),'utf8')+readFileSync(new URL('../../supabase/deferred-migrations/b4/20261003140000_close_ticket_check_in_browser_access.sql',import.meta.url),'utf8');
 sql(`BEGIN;${closure}${tables.map(t=>`ALTER TABLE public.${t} DISABLE ROW LEVEL SECURITY;`).join('\n')}UPDATE private.platform_settings SET registrations_open=true WHERE singleton;NOTIFY pgrst,'reload schema';COMMIT;`);
 const r=spawnSync('deno',['test','--config','supabase/functions/deno.json','--allow-net=127.0.0.1','--allow-env=SUPABASE_URL,SUPABASE_ANON_KEY,SUPABASE_SERVICE_ROLE_KEY,RATE_LIMIT_SALT,CORS_ALLOWED_ORIGINS,APP_ALLOWED_ORIGINS,APP_BASE_URL','tests/integration/ticket-check-in.local.ts'],{
  stdio:'inherit',windowsHide:true,env:{...process.env,SUPABASE_URL:runtime.API_URL,SUPABASE_ANON_KEY:runtime.ANON_KEY,SUPABASE_SERVICE_ROLE_KEY:runtime.SERVICE_ROLE_KEY,RATE_LIMIT_SALT:'synthetic-b4-salt'},
 });
 if(r.error)throw r.error;if(r.status!==0)throw new Error('B4 real HTTP recipe failed');
}finally{sql(`${tables.map(t=>`ALTER TABLE public.${t} ENABLE ROW LEVEL SECURITY;`).join('\n')}UPDATE private.platform_settings SET registrations_open=${wasOpen==='t'?'true':'false'} WHERE singleton;`);}
