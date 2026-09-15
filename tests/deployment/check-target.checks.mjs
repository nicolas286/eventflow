import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateTarget } from '../../scripts/deployment/check-target.mjs';

const ref = 'abcdefghijklmnopqrst';
const targets = {
  staging: { branch: 'dev', supabaseProjectRef: ref, publicOrigin: 'https://staging.useeventflow.eu', netlifySiteId: 'staging-site', deploymentEnabled: true },
  production: { branch: 'main', supabaseProjectRef: 'dixirvllhfkvqoahhfqh', publicOrigin: 'https://app.useeventflow.eu', netlifySiteId: 'production-site', deploymentEnabled: false },
};
const jwt = (role = 'anon', project = ref) => `header.${Buffer.from(JSON.stringify({ role, ref: project })).toString('base64url')}.signature`;
const env = {
  GITHUB_EVENT_NAME: 'push', GITHUB_REF: 'refs/heads/dev', SUPABASE_PROJECT_REF: ref,
  NETLIFY_SITE_ID: 'staging-site', VITE_SUPABASE_URL: `https://${ref}.supabase.co`,
  VITE_PUBLIC_BASE_URL: targets.staging.publicOrigin, PUBLIC_BASE_URL: targets.staging.publicOrigin,
  VITE_SUPABASE_ANON_KEY: jwt(), APP_ENV: 'staging',
};
test('accepts the complete staging destination', () => assert.equal(validateTarget('staging', targets, env), targets.staging));
test('production remains locked before bootstrap', () => assert.throws(() => validateTarget('production', targets, env), /disabled/));
for (const [label, changes] of [
  ['production project', { SUPABASE_PROJECT_REF: targets.production.supabaseProjectRef }],
  ['production URL', { VITE_SUPABASE_URL: `https://${targets.production.supabaseProjectRef}.supabase.co` }],
  ['production site', { NETLIFY_SITE_ID: 'production-site' }],
  ['wrong branch', { GITHUB_REF: 'refs/heads/main' }],
  ['pull request', { GITHUB_EVENT_NAME: 'pull_request' }],
  ['service-role key', { VITE_SUPABASE_ANON_KEY: jwt('service_role') }],
  ['key from production', { VITE_SUPABASE_ANON_KEY: jwt('anon', targets.production.supabaseProjectRef) }],
  ['missing variable', { PUBLIC_BASE_URL: undefined }],
]) test(`rejects ${label}`, () => assert.throws(() => validateTarget('staging', targets, { ...env, ...changes })));
test('rejects a shared backend even if variables match', () => assert.throws(() => validateTarget('staging', { ...targets, production: { ...targets.production, supabaseProjectRef: ref } }, env), /different Supabase/));
