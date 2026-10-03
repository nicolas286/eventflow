import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { deployPaused, pausedEntrypoint, DRAIN_SECONDS } from '../../scripts/deployment/pause-platform-campaigns.mjs';

const revision = 'a'.repeat(40);
test('paused deployment rejects campaign sends before auth, SQL and mail, while preserving other routes', async () => {
  let handler;
  let calls = 0;
  const code = ts.transpileModule(pausedEntrypoint(revision), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  runInNewContext(code, {
    exports: {}, URL,
    Deno: { serve: value => { handler = value; } },
    require: path => path.includes('deployment-active')
      ? { handlePlatformAdminRequest: () => { calls++; return new Response(null, { status: 401 }); } }
      : { json: (_req, body, status) => Response.json(body, { status }) },
  });
  for (const path of ['communications/email', 'communications/email/', 'communications/email?retry=1', '/communications/email', 'communications//email']) {
    const response = await handler(new Request(`https://example.test/functions/v1/platform-admin/${path}`, { method: 'POST' }));
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: 'PLATFORM_CAMPAIGNS_DEPLOYING', revision });
  }
  assert.equal(calls, 0);
  assert.equal((await handler(new Request('https://example.test/platform-admin/access'))).status, 401);
  assert.equal(calls, 1);
  assert.ok(DRAIN_SECONDS > 400);
});

test('failed pause deployment restores local source without overwriting preexisting files', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'eventflow-campaign-rollout-'));
  const entry = join(dir, 'index.ts');
  const active = join(dir, 'deployment-active.ts');
  try {
    await writeFile(entry, 'original source');
    await assert.rejects(deployPaused({ entry, active, revision, deploy: async () => {
      assert.equal(await readFile(active, 'utf8'), 'original source');
      assert.match(await readFile(entry, 'utf8'), /PLATFORM_CAMPAIGNS_DEPLOYING/);
      throw new Error('synthetic deploy failure');
    } }), /synthetic deploy failure/);
    assert.equal(await readFile(entry, 'utf8'), 'original source');
    await assert.rejects(access(active));
    await writeFile(active, 'preserve');
    await assert.rejects(deployPaused({ entry, active, revision, deploy: () => assert.fail() }), /EEXIST/);
    assert.equal(await readFile(active, 'utf8'), 'preserve');
    assert.equal(await readFile(entry, 'utf8'), 'original source');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('deployment drains before SQL and publishes normal Edge before readiness check and frontend', async () => {
  const workflow = await readFile(new URL('../../.github/workflows/deploy-environment.yml', import.meta.url), 'utf8');
  const steps = ['node scripts/deployment/pause-platform-campaigns.mjs', 'supabase db push --yes',
    'supabase functions deploy --project-ref', 'node scripts/deployment/check-backend.mjs',
    'npm run test:integration:business-boundary', 'netlify-cli@'];
  let previous = -1;
  for (const step of steps) {
    const at = workflow.indexOf(step);
    assert.ok(at > previous, `Missing or out-of-order deployment step: ${step}`);
    previous = at;
  }
  assert.match(workflow, /name: Pause campaign sends and drain existing workers\s+if: inputs\.target == 'production'/);
});
