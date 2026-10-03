// Explicit disposable container only; never accepts a database URL.
// Usage: node tests/database/order-confirmation-concurrency.checks.mjs supabase_db_eventflow-security-a5-20261002
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

const container = process.argv[2];
if (!container || !/^supabase_db_eventflow-security-(?:a5|b6)-[a-zA-Z0-9-]+$/.test(container)) {
  throw new Error('An explicit isolated A5/B6 disposable Docker container is required');
}
function sql(statement) {
  return new Promise((resolve, reject) => {
    const process = spawn('docker', ['exec', '-i', container, 'psql', '-X', '-qAt', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'], { windowsHide: true });
    let output = '';
    let errors = '';
    process.stdout.on('data', chunk => { output += chunk; });
    process.stderr.on('data', chunk => { errors += chunk; });
    process.on('error', reject);
    process.on('exit', code => code === 0 ? resolve(output.trim()) : reject(new Error(errors || `psql exit ${code}`)));
    process.stdin.end(statement);
  });
}
const org = 'a5cc0000-0000-4000-8000-000000000001';
const event = 'a5cc0000-0000-4000-8000-000000000002';
const order = 'a5cc0000-0000-4000-8000-000000000003';
const cleanup = `delete from public.organizations where id='${org}';`;
try {
  await sql(`
    insert into public.organizations(id,type,name) values ('${org}','association','Concurrent confirmation fixture');
    insert into public.events(id,org_id,slug,title) values ('${event}','${org}','a5-concurrency','Concurrency fixture');
    insert into public.orders(id,org_id,event_id,total_cents,paid_cents,buyer_email,booking_token,status,confirmed_at)
    values ('${order}','${org}','${event}',0,0,'concurrency@example.test','synthetic-a5-concurrency-booking-token','paid',now());
  `);
  // Session 1 holds the real order lock after acquiring its claim. Session 2
  // overlaps this transaction, waits for commit, then must observe that claim.
  const first = sql(`begin; set local application_name='a5_confirmation_first'; set local role service_role;
    select public.claim_order_confirmation_delivery('${order}'); select pg_sleep(3); commit;`);
  let observed = false;
  for (let n = 0; n < 50; n++) {
    if (await sql("select exists(select 1 from pg_stat_activity where application_name='a5_confirmation_first' and wait_event='PgSleep');") === 't') {
      observed = true;
      break;
    }
    await delay(40);
  }
  assert.ok(observed, 'First session never acquired the claim and held its transaction');
  const second = sql(`set role service_role; select public.claim_order_confirmation_delivery('${order}');`);
  const [firstOutput, secondOutput] = await Promise.all([first, second]);
  const initial = JSON.parse(firstOutput.split('\n')[0]);
  const rejected = JSON.parse(secondOutput);
  assert.equal(initial.claimed, true);
  assert.deepEqual(rejected, { claimed: false, reason: 'in_progress' });
  assert.equal(await sql(`select attempt_count from private.order_confirmation_deliveries where order_id='${order}';`), '1');

  await sql(`update private.order_confirmation_deliveries set claimed_at=now()-interval '6 minutes' where order_id='${order}';`);
  const resumed = JSON.parse(await sql(`set role service_role; select public.claim_order_confirmation_delivery('${order}');`));
  assert.equal(resumed.claimed, true);
  assert.notEqual(resumed.claimToken, initial.claimToken);
  const obsolete = await sql(`set role service_role;
    select public.complete_order_confirmation_delivery('${order}','${initial.claimToken}',true,'obsolete-provider-message');
    select public.complete_order_confirmation_delivery('${order}','${initial.claimToken}',false,null,'OBSOLETE');
    select public.prepare_order_confirmation_dispatch('${order}','${initial.claimToken}','{}','resend') is null;`);
  assert.equal(obsolete, 'f\nf\nt');
  assert.equal(await sql(`select claim_token from private.order_confirmation_deliveries where order_id='${order}';`), resumed.claimToken);
  await sql(`set role service_role;
    select public.prepare_order_confirmation_dispatch('${order}','${resumed.claimToken}','{"attachments":[{"filename":"conditions.pdf","content":"cHJvb2Y="}]}','resend');
    select public.complete_order_confirmation_delivery('${order}','${resumed.claimToken}',true,'synthetic-concurrent-message');`);
  assert.equal(await sql(`select status from private.order_confirmation_deliveries where order_id='${order}';`), 'sent');
  console.log('PASS: two real concurrent connections, expired lease recovery and stale-worker fencing');
} finally {
  await sql(cleanup);
}
