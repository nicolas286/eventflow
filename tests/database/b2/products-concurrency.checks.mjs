// Real overlapping PostgreSQL connections; no project links, DB URLs or live data.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { assertDisposableOrganizerContainer } from '../disposable-container.mjs';
const container = process.argv[2];
assertDisposableOrganizerContainer(container);
function sql(statement) {
  return new Promise((resolve, reject) => {
    const child = spawn('docker', ['exec', '-i', container, 'psql', '-X', '-qAt', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'], { windowsHide: true });
    let output = ''; let errors = '';
    child.stdout.on('data', chunk => { output += chunk; });
    child.stderr.on('data', chunk => { errors += chunk; });
    child.on('error', reject);
    child.on('exit', code => code === 0 ? resolve(output.trim()) : reject(new Error(errors || `psql exit ${code}`)));
    child.stdin.end(statement);
  });
}
const actor = 'b22c0000-0000-4000-8000-000000000001';
const org = 'b22c0000-0000-4000-8000-000000000011';
const firstEvent = 'b22c0000-0000-4000-8000-000000000021';
const secondEvent = 'b22c0000-0000-4000-8000-000000000022';
const product = 'b22c0000-0000-4000-8000-000000000031';
const cleanup = `delete from public.organizations where id='${org}';
 delete from private.rate_limit_hits where key like '%${org}%' or key='update_event:${secondEvent}';`;
async function waitFor(statement, description) {
  for (let n=0; n<40; n++) {
    if (await sql(statement) === 't') return;
    await delay(40);
  }
  throw new Error(description);
}
async function concurrent(label, firstStatement, secondStatement, expectedError) {
  const firstName = `b22_${label}_first`; const secondName = `b22_${label}_second`;
  const first = sql(`begin; set local application_name='${firstName}'; set local role service_role;
    ${firstStatement} select pg_sleep(3); commit;`).then(output => ({output}),error => ({error}));
  await waitFor(`select exists(select 1 from pg_stat_activity where application_name='${firstName}' and wait_event='PgSleep');`, 'First transaction did not retain its lock');
  const second = sql(`set application_name='${secondName}'; set role service_role; ${secondStatement}`)
    .then(output => ({output}),error => ({error}));
  await waitFor(`select exists(select 1 from pg_stat_activity where application_name='${secondName}' and wait_event_type='Lock');`, 'Second transaction did not wait for the first');
  const results = await Promise.all([first,second]);
  assert.equal(results[0].error,undefined,'First operation must commit');
  assert.match(results[1].error?.message ?? '',expectedError,'Waiter must validate the freshly committed state');
}
try {
  assert.equal(await sql("select max_events_per_year=1 and max_products_per_event>=2 from public.plan_limits where plan='free';"),'t','Requires the seeded disposable free limits');
  await sql(cleanup);
  await sql(`insert into public.organizations(id,type,name,plan) values ('${org}','association','B22 concurrent products','free');
   insert into public.events(id,org_id,slug,title) values ('${firstEvent}','${org}','b22-concurrent-first','First event'),('${secondEvent}','${org}','b22-concurrent-second','Second event');`);
  await concurrent('create',
    `select public.organizer_create_event_product('${actor}','{"org_id":"${org}","event_id":"${firstEvent}","name":"Paid winner","price_cents":100}');`,
    `select public.organizer_create_event_product('${actor}','{"org_id":"${org}","event_id":"${secondEvent}","name":"Paid waiter","price_cents":100}');`,
    /PLAN_LIMIT: paid_events_per_year exceeded/);
  assert.equal(await sql(`select count(*) from public.event_products where event_id='${secondEvent}';`),'0','Rejected create must have no partial row');
  await sql(`delete from public.event_products where event_id='${firstEvent}';
   insert into public.event_products(id,event_id,name,price_cents,stock_qty) values('${product}','${firstEvent}','Concurrent stock',0,10);`);
  await concurrent('mixed_paid',
    `select public.organizer_update_event_product('${actor}','{"org_id":"${org}","event_id":"${firstEvent}","product_id":"${product}","price_cents":100}');`,
    `select public.organizer_update_event('${actor}','{"org_id":"${org}","event_id":"${secondEvent}","deposit_cents":100}');`,
    /PLAN_LIMIT: paid_events_per_year exceeded/);
  assert.equal(await sql(`select coalesce(deposit_cents,0) from public.events where id='${secondEvent}';`),'0','Rejected deposit transition must roll back');
  await concurrent('stock',
    `update public.event_products set reserved_qty=3,sold_qty=2 where id='${product}';`,
    `select public.organizer_update_event_product('${actor}','{"org_id":"${org}","event_id":"${firstEvent}","product_id":"${product}","stock_qty":4,"name":"Must rollback"}');`,
    /STOCK_BELOW_ALLOCATED/);
  assert.equal(await sql(`select name||':'||stock_qty||':'||reserved_qty||':'||sold_qty from public.event_products where id='${product}';`),'Concurrent stock:10:3:2','Waiter must preserve stock and counters');
  console.log('PASS: paid product creation, product/deposit transitions, and allocated-stock updates validate committed state under real overlapping row locks');
} finally {
  await sql(cleanup);
}
