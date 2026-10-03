// Explicit disposable container only; never accepts a database URL.
// Usage: node tests/database/rate-limit-concurrency.checks.mjs supabase_db_eventflow-security-a8-20261002
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

const container = process.argv[2];
if (!container || !/^supabase_db_eventflow-security-(?:a8|b6)-[a-zA-Z0-9-]+$/.test(container)) {
  throw new Error('An explicit isolated A8/B6 disposable Docker container is required');
}
function sql(statement) {
  return new Promise((resolve, reject) => {
    const child = spawn('docker', ['exec', '-i', container, 'psql', '-X', '-qAt', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'], { windowsHide: true });
    let output = '';
    let errors = '';
    child.stdout.on('data', chunk => { output += chunk; });
    child.stderr.on('data', chunk => { errors += chunk; });
    child.on('error', reject);
    child.on('exit', code => code === 0 ? resolve(output.trim()) : reject(new Error(errors || `psql exit ${code}`)));
    child.stdin.end(statement);
  });
}
const scope = 'a8-real-connections';
const cleanup = `delete from private.rate_limit_hits where key like '${scope}:%';`;
const consume = (key, limit = 5, window = 2147483647) =>
  `select row_to_json(result) from public.consume_rate_limit('${key}','${scope}',${limit},${window}) result;`;
try {
  await sql(cleanup);
  // A committed limiter RPC precedes a different failed business transaction.
  const consumed = JSON.parse(await sql(`set role service_role; ${consume('business-failure')}`));
  assert.equal(consumed.allowed, true);
  await assert.rejects(sql("begin; select 1 / 0; commit;"), /division by zero/);
  assert.equal(await sql(`select hits from private.rate_limit_hits where key='${scope}:business-failure';`), '1');

  // The first real connection holds the UPSERT lock. Independent connections
  // overlap and must serialize increments without exceeding the accepted budget.
  const first = sql(`begin; set local application_name='a8_rate_limit_first'; set local role service_role;
    ${consume('concurrent')} select pg_sleep(3); commit;`);
  let held = false;
  for (let n = 0; n < 50; n++) {
    held = await sql("select exists(select 1 from pg_stat_activity where application_name='a8_rate_limit_first' and wait_event='PgSleep');") === 't';
    if (held) break;
    await delay(40);
  }
  assert.ok(held, 'First connection never held the rate-limit transaction');
  const others = Array.from({ length: 11 }, () => sql(`set role service_role; ${consume('concurrent')}`));
  let waiting = false;
  for (let n = 0; n < 30; n++) {
    waiting = await sql("select exists(select 1 from pg_stat_activity where query like '%a8-real-connections%' and wait_event_type='Lock');") === 't';
    if (waiting) break;
    await delay(40);
  }
  assert.ok(waiting, 'Concurrent connections never overlapped the locked counter');
  const outputs = await Promise.all([first, ...others]);
  const results = outputs.map(output => JSON.parse(output.split('\n')[0]));
  assert.equal(results.filter(result => result.allowed).length, 5);
  assert.deepEqual(results.map(result => result.request_count).sort((a, b) => a - b), Array.from({ length: 12 }, (_, n) => n + 1));
  assert.ok(results.filter(result => !result.allowed).every(result => Number.isInteger(result.retry_after_seconds) && result.retry_after_seconds >= 1));
  assert.equal(await sql(`select hits from private.rate_limit_hits where key='${scope}:concurrent';`), '12');

  // Exhaust a two-second window, then wait for its actual stored end. Even if
  // the very short window rolled over between calls, the final call exhausts it.
  let exhausted;
  for (let n = 0; n < 5; n++) {
    exhausted = JSON.parse(await sql(`set role service_role; ${consume('expiry', 1, 2)}`));
    if (!exhausted.allowed) break;
  }
  assert.equal(exhausted.allowed, false);
  assert.ok(exhausted.retry_after_seconds >= 1 && exhausted.retry_after_seconds <= 2);
  await sql(`select pg_sleep(greatest(0, extract(epoch from (
    (select max(window_start) from private.rate_limit_hits where key='${scope}:expiry')
    + interval '2 seconds' - clock_timestamp()))) + 0.05);`);
  const reopened = JSON.parse(await sql(`set role service_role; ${consume('expiry', 1, 2)}`));
  assert.equal(reopened.allowed, true);
  assert.equal(reopened.request_count, 1);
  assert.equal(reopened.retry_after_seconds, 0);
  console.log('PASS: committed count survives business rollback; 12 real overlapping connections accept exactly 5; expired window reopens');
} finally {
  await sql(cleanup);
}
