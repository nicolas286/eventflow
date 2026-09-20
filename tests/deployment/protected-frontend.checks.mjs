import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { assertAssetHash, assertPublishedDeployment } from '../../scripts/deployment/verify-protected-frontend.mjs';

const target = { netlifySiteId: 'stage', publicOrigin: 'https://stage.example' };
const site = { id: 'stage', ssl_url: target.publicOrigin, published_deploy: { state: 'ready', title: 'GitHub abc (staging)' } };
test('protected verification requires the exact published commit and site', () => {
  assertPublishedDeployment(site, target, 'abc');
  assert.throws(() => assertPublishedDeployment(site, target, 'old'));
  assert.throws(() => assertPublishedDeployment({ ...site, id: 'production' }, target, 'abc'));
  assert.throws(() => assertPublishedDeployment({ ...site, published_deploy: { state: 'uploading', title: 'GitHub abc (staging)' } }, target, 'abc'));
});
test('protected verification rejects different asset bytes', () => {
  const asset = { sha: createHash('sha1').update('expected').digest('hex') };
  assertAssetHash(asset, Buffer.from('expected'));
  assert.throws(() => assertAssetHash(asset, Buffer.from('stale')));
});
