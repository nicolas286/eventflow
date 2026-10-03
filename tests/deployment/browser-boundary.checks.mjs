import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkBrowserBoundary, inspectSource } from '../../scripts/security/check-browser-boundary.mjs';

test('current React and Netlify sources have no direct business access', () => {
  assert.deepEqual(checkBrowserBoundary(), []);
});
test('AST boundary rejects data capabilities and raw endpoints', () => {
  for (const source of [
    'db.rpc("internal", {})', 'db.from("orders")', 'db["rpc"]("x")',
    'const { rpc: invoke } = db', 'db.schema("public")', 'db.channel("orders")',
    'fetch(`${url}/rest/v1/orders`)', 'fetch(url + "/graphql/v1")',
    'db.storage.from("invoices")', 'db.auth.getUser()',
  ]) assert.ok(inspectSource('src/new.ts', source).length, source);
});
test('AST boundary distinguishes standard Array.from, comments, Edge and allowed Auth', () => {
  assert.deepEqual(inspectSource('src/new.ts', '// db.rpc("x")\nArray.from(values); db.functions.invoke("orders/list")'), []);
  assert.deepEqual(inspectSource('src/app/modules/admin/auth/data/authRepo.ts', 'db.auth.getUser()'), []);
  // Auth permission does not permit Data API in the same file.
  assert.ok(inspectSource('src/app/modules/admin/auth/data/authRepo.ts', 'db.rpc("x")').length);
});
