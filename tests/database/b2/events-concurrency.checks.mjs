// Real PostgreSQL connections; explicit disposable container, never a DB URL.
// Usage: node tests/database/b2/events-concurrency.checks.mjs supabase_db_eventflow-security-b1b2-20261003
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
const actor = 'b21c0000-0000-4000-8000-000000000001';
const orgCreate = 'b21c0000-0000-4000-8000-000000000011';
const orgTransition = 'b21c0000-0000-4000-8000-000000000012';
const firstEvent = 'b21c0000-0000-4000-8000-000000000021';
const secondEvent = 'b21c0000-0000-4000-8000-000000000022';
const cleanup = `delete from public.organizations where id in ('${orgCreate}','${orgTransition}');
 delete from private.rate_limit_hits where key in ('create_event:org:${orgCreate}','update_event:${firstEvent}','update_event:${secondEvent}');`;
async function waitFor(statement, description) {
  for (let n=0; n<35; n++) {
    if (await sql(statement) === 't') return;
    await delay(40);
  }
  throw new Error(description);
}
async function concurrent(label, firstStatement, secondStatement) {
  const firstName = `b21_${label}_first`; const secondName = `b21_${label}_second`;
  const first = sql(`begin; set local application_name='${firstName}'; set local role service_role;
    ${firstStatement} select pg_sleep(3); commit;`).then(output => ({output}),error => ({error}));
  await waitFor(`select exists(select 1 from pg_stat_activity where application_name='${firstName}' and wait_event='PgSleep');`, 'First operation never held its organization lock');
  const second = sql(`set application_name='${secondName}'; set role service_role; ${secondStatement}`)
    .then(output => ({output}),error => ({error}));
  await waitFor(`select exists(select 1 from pg_stat_activity where application_name='${secondName}' and wait_event_type='Lock');`, 'Second operation did not wait on the organization lock');
  const results = await Promise.all([first,second]);
  assert.equal(results[0].error,undefined,'First paid operation must commit');
  assert.match(results[1].error?.message ?? '',/PLAN_LIMIT: paid_events_per_year exceeded/,'Waiter must observe the committed paid event');
}
try {
  // Do not overwrite configurable business limits to make a concurrency test pass.
  assert.equal(await sql("select max_events_per_year=1 and max_products_per_event>=1 and max_form_fields>=10 from public.plan_limits where plan='free';"),'t','This disposable fixture requires the seeded free limits');
  await sql(cleanup);
  await sql(`insert into public.organizations(id,type,name,plan) values
    ('${orgCreate}','association','B21 concurrent create','free'),
    ('${orgTransition}','association','B21 concurrent transition','free');
    insert into public.events(id,org_id,slug,title) values
    ('${firstEvent}','${orgTransition}','b21-concurrent-first','First free event'),
    ('${secondEvent}','${orgTransition}','b21-concurrent-second','Second free event');`);
  await concurrent('create',
    `select public.organizer_create_event('${actor}','{"org_id":"${orgCreate}","title":"Paid Winner","deposit_cents":100}');`,
    `select public.organizer_create_event('${actor}','{"org_id":"${orgCreate}","title":"Paid Waiter","deposit_cents":100}');`);
  assert.equal(await sql(`select count(*) from public.events where org_id='${orgCreate}';`),'1');
  assert.equal(await sql(`select count(*) from public.event_form_fields f join public.events e on e.id=f.event_id where e.org_id='${orgCreate}';`),'10');
  assert.equal(await sql(`select count(*) from public.event_products p join public.events e on e.id=p.event_id where e.org_id='${orgCreate}';`),'1');
  await concurrent('transition',
    `select public.organizer_update_event('${actor}','{"org_id":"${orgTransition}","event_id":"${firstEvent}","deposit_cents":100}');`,
    `select public.organizer_update_event('${actor}','{"org_id":"${orgTransition}","event_id":"${secondEvent}","deposit_cents":100}');`);
  assert.equal(await sql(`select count(*) from public.events where org_id='${orgTransition}' and public.is_event_paid(id);`),'1');
  assert.equal(await sql(`select coalesce(deposit_cents,0) from public.events where id='${secondEvent}';`),'0');
  console.log('PASS: real overlapping paid creation and transition serialize on organization locks; waiters reject committed quota consumption without partial children/state');
} finally {
  await sql(cleanup);
}
