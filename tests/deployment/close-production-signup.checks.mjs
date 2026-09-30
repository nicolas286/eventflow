import { test } from 'node:test';
import assert from 'node:assert/strict';
import { closeProductionSignup } from '../../scripts/deployment/close-production-signup.mjs';

const ref = 'dixirvllhfkvqoahhfqh';
const targets = {
  production: {
    branch: 'main', supabaseProjectRef: ref, publicOrigin: 'https://app.useeventflow.eu',
    netlifySiteId: 'production-site', deploymentEnabled: true,
  },
  staging: {
    branch: 'dev', supabaseProjectRef: 'abcdefghijklmnopqrst',
    publicOrigin: 'https://staging.useeventflow.eu',
    netlifySiteId: 'staging-site', deploymentEnabled: true,
  },
};
const env = {
  GITHUB_EVENT_NAME: 'push', GITHUB_REF: 'refs/heads/main', APP_ENV: 'production',
  SUPABASE_PROJECT_REF: ref, NETLIFY_SITE_ID: 'production-site',
  VITE_SUPABASE_URL: `https://${ref}.supabase.co`,
  VITE_PUBLIC_BASE_URL: targets.production.publicOrigin,
  PUBLIC_BASE_URL: targets.production.publicOrigin,
  VITE_SUPABASE_ANON_KEY: 'sb_publishable_test',
  SUPABASE_ACCESS_TOKEN: 'test-token',
};

test('closes only the selected production Auth project and verifies the setting', async () => {
  const calls = [];
  await closeProductionSignup(targets, env, async (url, options) => {
    calls.push({ url, options });
    return options.method === 'GET' ? Response.json({ disable_signup: true }) : Response.json({});
  });
  assert.equal(calls.length, 2);
  assert.deepEqual(calls.map(({ url }) => url), [
    `https://api.supabase.com/v1/projects/${ref}/config/auth`,
    `https://api.supabase.com/v1/projects/${ref}/config/auth`,
  ]);
  assert.equal(calls[0].options.method, 'PATCH');
  assert.deepEqual(JSON.parse(calls[0].options.body), { disable_signup: true });
  assert.equal(calls[1].options.method, 'GET');
});

test('refuses a mismatched target before contacting Supabase', async () => {
  let requested = false;
  await assert.rejects(
    closeProductionSignup(targets, { ...env, GITHUB_REF: 'refs/heads/dev' }, async () => {
      requested = true;
    }),
    /Branch does not match/,
  );
  assert.equal(requested, false);
});

test('fails if Supabase Auth still reports open signup', async () => {
  await assert.rejects(
    closeProductionSignup(targets, env, async () => Response.json({ disable_signup: false })),
    /still enabled/,
  );
});
