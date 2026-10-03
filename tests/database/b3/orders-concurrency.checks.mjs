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
const actor='b3000000-0000-4000-8000-000000000001', org='b3000000-0000-4000-8000-000000000011', event='b3000000-0000-4000-8000-000000000021';
const id=n=>`b3000000-0000-4000-8000-00000000004${n}`;
const expire=n=>`select public.organizer_expire_bank_transfer_order('${actor}','${org}','${event}','${id(n)}');`;
const remove=n=>`select public.organizer_admin_delete_order('${actor}','${org}','${event}','${id(n)}');`;
const pay=n=>`select public.apply_order_payment('${id(n)}','offline',100,'EUR','bank_transfer:${id(n)}','{}',null);`;
async function waitFor(query) {
  for(let n=0;n<70;n++){ if(await sql(query)==='t')return; await delay(40); }
  throw new Error('Expected actual PostgreSQL lock overlap');
}
async function concurrent(name,first,second,error) {
  const firstName=`b3_${name}_first`, secondName=`b3_${name}_second`;
  const a=sql(`begin;set local application_name='${firstName}';set local role service_role;${first}select pg_sleep(3);commit;`).then(output=>({output}),error=>({error}));
  await waitFor(`select exists(select 1 from pg_stat_activity where application_name='${firstName}' and wait_event='PgSleep');`);
  const b=sql(`set application_name='${secondName}';set role service_role;${second}`).then(output=>({output}),error=>({error}));
  await waitFor(`select exists(select 1 from pg_stat_activity where application_name='${secondName}' and wait_event_type='Lock');`);
  const results=await Promise.all([a,b]); assert.equal(results[0].error,undefined);
  if(error) assert.match(results[1].error?.message ?? '',error);
  else { assert.equal(results[1].error,undefined); assert.match(results[1].output,/"idempotent": true/); }
}
const cleanup=`delete from public.organizations where id in ('${org}','b3000000-0000-4000-8000-000000000012');delete from auth.users where id='${actor}';`;
try {
  await sql(cleanup);
  const setup=readFileSync(new URL('./orders.sql',import.meta.url),'utf8').split('CREATE FUNCTION pg_temp.expect_error')[0];
  await sql(`${setup} COMMIT;`);
  for(const n of [1,3]) await sql(`set role service_role;select public.create_bank_transfer_payment('${id(n)}',100,'EUR','Synthetic B3','BE51732081025262','B3 ONLY ${n}','B3-${n}');`);
  await concurrent('payment_first',pay(1),expire(1),/ORDER_NOT_EXPIRABLE/);
  await concurrent('expiration_first',expire(3),pay(3),/ORDER_NOT_PAYABLE/);
  await concurrent('expiration_repeat',expire(3),expire(3));
  assert.equal(await sql(`select status||':'||paid_cents from public.orders where id='${id(1)}';`),'paid:100');
  assert.equal(await sql(`select status||':'||paid_cents from public.orders where id='${id(3)}';`),'expired:0');
  assert.equal(await sql("select reserved_qty||':'||sold_qty from public.event_products where id='b3000000-0000-4000-8000-000000000031';"),'0:2');
  await concurrent('delete_repeat',remove(1),remove(1),/NOT_FOUND/);
  assert.equal(await sql("select reserved_qty||':'||sold_qty from public.event_products where id='b3000000-0000-4000-8000-000000000031';"),'0:1');
  console.log('PASS B3: payment/expiry both lock orders, repeated expiry and deletion, no double stock release');
} finally { await sql(cleanup); }
