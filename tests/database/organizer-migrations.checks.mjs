import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { assertDisposableOrganizerContainer } from './disposable-container.mjs';

const container = process.argv[2];
assertDisposableOrganizerContainer(container);
if (!container?.startsWith('supabase_db_') || !/^[a-zA-Z0-9_-]+$/.test(container)) throw new Error('Pass a disposable Supabase DB container');
function run(input, name) {
  const result = spawnSync('docker',['exec','-i',container,'psql','-X','-q','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1'], {input,encoding:'utf8'});
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${name}: ${result.stderr || result.stdout}`);
  console.log(`Organizer SQL ${name}: passed, fixtures rolled back.`);
}
for (const lot of ['b1','b2']) {
  const tests = new URL(`./${lot}/`,import.meta.url);
  if (!existsSync(tests)) continue;
  for (const name of readdirSync(tests).filter(n => n.endsWith('.sql') && !n.includes('closure')).sort()) run(readFileSync(new URL(name,tests),'utf8'),name);
  const deferred = new URL(`../../supabase/deferred-migrations/${lot}/`,import.meta.url);
  if (!existsSync(deferred)) continue;
  const closure = readdirSync(deferred).filter(n => n.endsWith('.sql')).sort().map(n => readFileSync(new URL(n,deferred),'utf8')).join('\n');
  for (const name of readdirSync(tests).filter(n => n.endsWith('-closure.sql')).sort()) {
    // A closure fixture owns BEGIN/ROLLBACK. Insert the closure after its BEGIN,
    // so CI verifies the future phase without applying it to the replayed DB.
    const fixture = readFileSync(new URL(name,tests),'utf8');
    if (!/\bBEGIN;/i.test(fixture) || !/\bROLLBACK;/i.test(fixture)) throw new Error(`Closure fixture must roll back: ${name}`);
    run(fixture.replace(/\bBEGIN;/i,() => `BEGIN;\n${closure}`),name);
  }
}
