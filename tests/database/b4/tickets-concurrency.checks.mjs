import { assertDisposableOrganizerContainer } from '../disposable-container.mjs';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
const container=process.argv[2];
assertDisposableOrganizerContainer(container);
function sql(input) {
  return new Promise((resolve,reject) => {
    const child=spawn('docker',['exec','-i',container,'psql','-X','-qAt','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1'],{windowsHide:true});
    let out='',err=''; child.stdout.on('data',c=>out+=c); child.stderr.on('data',c=>err+=c);
    child.on('error',reject); child.on('exit',code=>code===0?resolve(out.trim()):reject(new Error(err)));
    child.stdin.end(input);
  });
}
const actor='b4000000-0000-4000-8000-000000000001', org='b4000000-0000-4000-8000-000000000011', event='b4000000-0000-4000-8000-000000000021';
const ticket='b4000000-0000-4000-8000-000000000082';
const scan=`select public.organizer_check_in_ticket('${actor}','${org}','${ticket}','${event}');`;
const qr=`select public.organizer_check_in_ticket_by_qr('${actor}','${org}','B4-token-2','${event}');`;
async function waitFor(query) {
  for(let n=0;n<70;n++){ if(await sql(query)==='t')return; await delay(40); }
  throw new Error('Expected actual PostgreSQL lock overlap');
}
async function concurrent(name,first,second,error) {
  const firstName=`b4_${name}_first`, secondName=`b4_${name}_second`;
  const a=sql(`begin;set local application_name='${firstName}';set local role service_role;${first}select pg_sleep(3);commit;`).then(output=>({output}),error=>({error}));
  await waitFor(`select exists(select 1 from pg_stat_activity where application_name='${firstName}' and wait_event='PgSleep');`);
  const b=sql(`set application_name='${secondName}';set role service_role;${second}`).then(output=>({output}),error=>({error}));
  await waitFor(`select exists(select 1 from pg_stat_activity where application_name='${secondName}' and wait_event_type='Lock');`);
  const results=await Promise.all([a,b]); assert.equal(results[0].error,undefined); assert.match(results[0].output,/"outcome": "validated"/);
  if(error) assert.match(results[1].error?.message ?? '',error);
  else { assert.equal(results[1].error,undefined); assert.match(results[1].output,/"outcome": "already_checked"/); }
}
const cleanup=`delete from public.organizations where id in ('${org}','b4000000-0000-4000-8000-000000000012');delete from auth.users where id='${actor}';`;
try {
  await sql(cleanup);
  const setup=readFileSync(new URL('./fixture.sql',import.meta.url),'utf8');
  await sql(`${setup} COMMIT;`);
  await concurrent('double_scan',scan,qr);
  assert.equal(await sql(`select status||':'||checked_in_by from public.tickets where id='${ticket}';`),`checked_in:${actor}`);
  console.log('PASS B4 actual overlapping ID/QR scans: one validated, one already_checked, one actor/time');
} finally { await sql(cleanup); }
