// Exercises deployed staging functions after browser ACL closure. No local handlers,
// live payments, subscriptions, PDF generation or customer email are invoked.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const targets = JSON.parse(readFileSync(new URL('../../deploy/environments.json', import.meta.url), 'utf8'));
const base = process.env.SUPABASE_URL;
const anonKey = process.env.SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
assert.equal(base, `https://${targets.staging.supabaseProjectRef}.supabase.co`, 'Only the manifest staging target is allowed');
assert.ok(anonKey && serviceKey, 'Staging Auth and service credentials are required');
const options = { auth: { persistSession: false, autoRefreshToken: false } };
const service = createClient(base, serviceKey, options);
const anonymous = createClient(base, anonKey, options);
const users = [], orgs = [], invoicePaths = [], assetPaths = [];
const runId = randomUUID();
let phase = 'setup', operation = 'configuration', lastStatus = 'none', remoteCode = 'none', verification = 'none', checks = 0;
function verify(value, label) {
  verification = label;
  assert.ok(value, `${phase}: ${label}`);
  checks++;
}
function data(result, label) {
  if (result.error) {
    remoteCode = /^[a-zA-Z0-9_]{1,80}$/.test(result.error.code ?? '') ? result.error.code : 'remote-error';
    lastStatus = Number.isInteger(result.error.status) ? String(result.error.status) : lastStatus;
    throw new Error(`${phase}: ${label} failed (${remoteCode})`);
  }
  return result.data;
}
async function insert(table, rows) {
  data(await service.from(table).insert(rows), `Seed ${table}`);
}
async function actor() {
  operation = 'auth-admin-create-user';
  verification = 'none';
  remoteCode = 'none';
  const email = `boundary-${randomUUID()}@example.test`;
  const password = `Staging-${randomUUID()}`;
  const created = data(await service.auth.admin.createUser({ email, password, email_confirm: true,
    user_metadata: { platform_terms_version: '2026-10-01', platform_terms_accepted: true },
  }), 'Create synthetic Auth user');
  users.push(created.user.id);
  const client = createClient(base, anonKey, options);
  operation = 'auth-password-sign-in';
  const signed = data(await client.auth.signInWithPassword({ email, password }), 'Sign in synthetic actor');
  verify(signed.session?.access_token, 'Auth access token exists');
  return { id: created.user.id, token: signed.session.access_token, client };
}
async function call(path, token, body, expected = 200, method = 'POST') {
  operation = path;
  verification = 'none';
  lastStatus = 'pending';
  const response = await fetch(`${base}/functions/v1/${path}`, {
    method, headers: { apikey: anonKey, 'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    }, ...(method === 'GET' ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(30_000),
  });
  lastStatus = `${response.status} (expected ${expected})`;
  // Do not print responses: PDF URLs, booking tokens and identities are sensitive.
  assert.equal(response.status, expected, `${phase}: ${path} expected ${expected}, got ${response.status}`);
  checks++;
  const result = await response.json();
  if (expected >= 400) verify(result && typeof result.error === 'string', 'Structured failure without data');
  return result;
}

try {
  phase = 'organizations';
  const a = await actor(), b = await actor();
  await call('organizations/bootstrap', null, {}, 401);
  await call('organizations/bootstrap', 'invalid-synthetic-token', {}, 401);
  const orgA = await call('organizations/create', a.token, { type: 'association', name: `Boundary A ${runId}` });
  verify(typeof orgA === 'string' && /^[0-9a-f-]{36}$/i.test(orgA), 'Organization A created by Edge');
  orgs.push(orgA);
  const orgB = await call('organizations/create', b.token, { type: 'association', name: `Boundary B ${runId}` });
  verify(typeof orgB === 'string' && /^[0-9a-f-]{36}$/i.test(orgB), 'Organization B created by Edge');
  orgs.push(orgB);
  // Upgrade only these disposable fixtures to cover paid-product/advanced paths.
  data(await service.from('organizations').update({ plan: 'pro', plan_expires_at: '2099-01-01', status: 'active' }).in('id', orgs), 'Seed fixture plan');
  const bootstrap = await call('organizations/bootstrap', a.token, { orgId: orgA });
  verify(bootstrap.profile.userId === a.id && bootstrap.organization.createdBy === a.id, 'Bootstrap actor is server identity');
  await call('organizations/bootstrap', a.token, { orgId: orgB }, 403);
  await call('organizations/update', a.token, { orgId: orgB, name: 'Forged' }, 403);
  await call('organizations/update', a.token, { orgId: orgA, plan: 'pro' }, 400);
  await call('organizations/billing/update', a.token, {
    orgId: orgA, legalName: 'Synthetic boundary', addressLine1: 'Rue Exemple 1',
    postalCode: '1000', city: 'Bruxelles', countryCode: 'BE', billingEmail: 'boundary@example.test',
  });
  const billing = await call('organizations/billing/read', a.token, { orgId: orgA });
  verify(billing.billing?.orgId === orgA, 'Billing read contract matches organization');
  await call('organizations/billing/read', b.token, { orgId: orgA }, 403);

  phase = 'organization-assets';
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGOQC8gDAAFsAN1urcuHAAAAAElFTkSuQmCC', 'base64');
  async function uploadAsset(orgId, token, bytes, expected) {
    operation = 'organizations/assets/upload';
    verification = 'none';
    lastStatus = 'pending';
    const response = await fetch(`${base}/functions/v1/organizations/assets/upload?orgId=${orgId}&kind=logo`, {
      method: 'POST', headers: { apikey: anonKey, authorization: `Bearer ${token}`, 'content-type': 'image/png' },
      body: bytes, signal: AbortSignal.timeout(30_000),
    });
    lastStatus = `${response.status} (expected ${expected})`;
    const result = await response.json();
    if (response.status === 200 && typeof result.path === 'string') assetPaths.push(result.path);
    assert.equal(response.status, expected, 'Asset Edge upload status');
    checks++;
    return result;
  }
  await uploadAsset(orgB, a.token, png, 403);
  await uploadAsset(orgA, a.token, Buffer.from('<html>forged image</html>'), 400);
  const asset = await uploadAsset(orgA, a.token, png, 200);
  verify(asset.path.startsWith(`orgs/${orgA}/logo/`), 'Upload path scoped to authorized organization');
  const displayed = await fetch(asset.publicUrl, { signal: AbortSignal.timeout(30_000) });
  verify(displayed.status === 200 && displayed.headers.get('content-type') === 'image/png', 'Public asset download available');
  assert.deepEqual(Buffer.from(await displayed.arrayBuffer()), png, 'Downloaded image bytes match upload');
  checks++;
  for (const client of [anonymous, a.client, b.client]) {
    const forgedPath = `orgs/${orgA}/logo/${randomUUID()}.png`;
    assetPaths.push(forgedPath); // Also clean the path if a permission regression makes this succeed.
    const uploaded = await client.storage.from('public-assets').upload(forgedPath, png, { contentType: 'image/png' });
    verify(uploaded.error, 'Browser direct Storage upload denied');
    const removed = await client.storage.from('public-assets').remove([asset.path]);
    verify(removed.error || !removed.data?.some(row => row.name), 'Browser direct Storage delete denied');
  }
  const assetFilename = asset.path.split('/').at(-1);
  const assetFolder = asset.path.slice(0, -(assetFilename.length + 1));
  const untouched = data(await service.storage.from('public-assets').list(assetFolder, { search: assetFilename }), 'Read uploaded asset metadata');
  verify(untouched.some(row => row.name === assetFilename), 'Refused direct deletes preserved authorized image');
  const assetId = assetFilename.split('.')[0];
  await call('organizations/assets/delete', b.token, { orgId: orgA, kind: 'logo', assetId, extension: 'png' }, 403);
  await call('organizations/assets/delete', a.token, { orgId: orgA, kind: 'logo', assetId, extension: 'png' });
  const deleted = data(await service.storage.from('public-assets').list(assetFolder, { search: assetFilename }), 'Read asset metadata after deletion');
  verify(!deleted.some(row => row.name === assetFilename), 'Edge authorized delete removed asset');

  phase = 'events-products-forms';
  const eventA = await call('events/create', a.token, {
    orgId: orgA, title: `Boundary A ${runId}`, startsAt: new Date(Date.now() + 86400000).toISOString(), depositCents: 0,
  });
  const eventB = await call('events/create', b.token, { orgId: orgB, title: `Boundary B ${runId}` });
  verify(eventA.orgId === orgA && eventA.isPublished === false, 'Private event created');
  await call('events/detail', b.token, { eventId: eventA.id }, 403);
  await call('events/update', b.token, { eventId: eventA.id, patch: { title: 'Forged' } }, 403);
  await call('events/update', a.token, { eventId: eventA.id, patch: { orgId: orgB } }, 400);
  const product = await call('events/products/create', a.token, {
    eventId: eventA.id, name: 'Synthetic ticket', priceCents: 100, stockQty: 10,
  });
  verify(product.reservedQty === 0 && product.soldQty === 0, 'System stock starts at zero');
  await call('events/products/update', b.token, { productId: product.id, patch: { priceCents: 0 } }, 403);
  await call('events/products/update', a.token, { productId: product.id, patch: { soldQty: 900 } }, 400);
  const group = await call('events/forms/groups/create', a.token, {
    eventId: eventA.id, label: 'Synthetic group', description: null, sortOrder: 20, isActive: true,
  });
  const field = await call('events/forms/fields/create', a.token, {
    eventId: eventA.id, groupId: group.id, label: 'Synthetic field', fieldKey: 'boundary_identity',
    fieldType: 'text', isRequired: false, isActive: true, sortOrder: 21, options: null,
  });
  await call('events/forms/fields/read', b.token, { fieldId: field.id }, 403);
  const detail = await call('events/detail', a.token, { eventId: eventA.id });
  verify(detail.products.some(p => p.id === product.id) && detail.formFields.some(f => f.id === field.id), 'Detail includes created domain objects');

  phase = 'payment-settings';
  await call('organization-payment-settings', a.token, { action: 'read', orgId: orgA });
  await call('organization-payment-settings', b.token, { action: 'read', orgId: orgA }, 403);
  await call('organization-payment-settings', a.token, { action: 'accept_terms', orgId: orgA,
    confirmed: true, salesTerms: 'Synthetic staging sales terms. '.repeat(12),
  });
  const profile = data(await service.from('organization_profile').select('sales_terms_accepted_by,slug').eq('org_id', orgA).single(), 'Verify persisted payment settings');
  verify(profile.sales_terms_accepted_by === a.id, 'Payment settings persist authenticated actor');

  phase = 'public-catalog';
  await call('events/public/detail', null, { orgSlug: profile.slug, eventSlug: eventA.slug }, 404);
  await call('events/update', a.token, { eventId: eventA.id, patch: { isPublished: true } });
  const catalog = await call('events/public/detail', null, { orgSlug: profile.slug, eventSlug: eventA.slug });
  verify(catalog.event.id === eventA.id, 'Published catalog resolves correct event');
  verify(!JSON.stringify(catalog).includes('booking_token'), 'Public catalog omits booking tokens');
  const share = await call('events/public/share', null, { orgSlug: profile.slug, eventSlug: eventA.slug });
  verify(share.eventTitle === eventA.title, 'Share uses deployed public API');

  phase = 'synthetic-orders';
  const orderId = randomUUID(), itemId = randomUUID(), attendeeId = randomUUID(), ticketId = randomUUID(), qr = randomUUID();
  await insert('orders', [{ id: orderId, org_id: orgA, event_id: eventA.id, currency: 'EUR',
    total_cents: 100, paid_cents: 100, status: 'paid', booking_token: randomUUID(), buyer_email: 'boundary-buyer@example.test',
  }]);
  await insert('order_items', [{ id: itemId, order_id: orderId, product_id: product.id,
    product_name_snapshot: 'Synthetic ticket', unit_price_cents_snapshot: 100, quantity: 1,
  }]);
  await insert('order_attendees', [{ id: attendeeId, order_id: orderId, product_id: product.id,
    product_name_snapshot: 'Synthetic ticket', attendee_index: 1, status: 'confirmed',
  }]);
  await insert('tickets', [{ id: ticketId, order_id: orderId, order_item_id: itemId, event_id: eventA.id,
    product_id: product.id, ticket_index: 1, qr_token: qr, status: 'valid',
  }]);
  const orders = await call('orders/admin/list', a.token, { eventId: eventA.id });
  verify(orders.orders.total === 1 && orders.orders.rows[0].id === orderId, 'Admin list matches seeded order');
  const searched = await call('orders/admin/search', a.token, {
    eventId: eventA.id, query: 'boundary-buyer@example.test', filterMode: 'order',
  });
  verify(searched.orders.total === 1, 'Order search uses deployed API');
  await call('orders/admin/list', b.token, { eventId: eventA.id }, 403);
  await call('orders/admin/delete', b.token, { orderId }, 403);
  await call('orders/admin/participant-update', b.token, { attendeeId,
    attendee: { answers: [{ eventFormFieldId: field.id, valueText: 'Forged' }] },
  }, 403);
  await call('orders/admin/participant-update', a.token, { attendeeId,
    attendee: { answers: [{ eventFormFieldId: field.id, value: { value_text: 'Synthetic answer' } }] },
  });
  const exported = await call('orders/admin/participants-export', a.token, { eventId: eventA.id, confirmedOnly: false, limit: 10 });
  verify(exported.orders.rows.length === 1 && exported.attendees.length === 1, 'Export crosses deployed SQL/API boundary');

  phase = 'ticket-check-in';
  await call('orders/admin/ticket-check-in', b.token, { eventId: eventA.id, ticketId }, 403);
  await call('orders/admin/ticket-check-in', b.token, { eventId: eventB.id, ticketId }, 409);
  const outcomes = await Promise.all([
    call('orders/admin/ticket-check-in', a.token, { eventId: eventA.id, ticketId }),
    call('orders/admin/ticket-check-in-qr', a.token, { eventId: eventA.id, qrToken: qr }),
  ]);
  assert.deepEqual(outcomes.map(r => r.outcome).sort(), ['already_checked', 'validated'], 'Exactly one concurrent scan succeeds');
  verify(outcomes.every(r => r.checkedInBy === a.id) && outcomes[0].checkedInAt === outcomes[1].checkedInAt, 'Check-in actor and timestamp stable');

  phase = 'invoice-history-pdf';
  const invoiceId = randomUUID(), pdfPath = `boundary-staging/${runId}/${invoiceId}.pdf`;
  invoicePaths.push(pdfPath);
  data(await service.storage.from('invoices').upload(pdfPath, Buffer.from('%PDF-1.4\nSynthetic staging fixture\n%%EOF'), { contentType: 'application/pdf' }), 'Upload synthetic PDF');
  await insert('invoices', [{ id: invoiceId, org_id: orgA, number: `STG-${invoiceId.slice(0, 8)}`, status: 'issued',
    issued_at: new Date().toISOString(), subtotal_cents: 100, total_cents: 100, pdf_path: pdfPath,
  }]);
  const history = await call('invoices/list', a.token, { orgId: orgA });
  verify(history.orgId === orgA && history.items.some(i => i.id === invoiceId), 'Invoice history resolves own fixture');
  verify(!JSON.stringify(history).includes(pdfPath), 'History omits storage path');
  await call('invoices/list', b.token, { orgId: orgA }, 403);
  await call(`invoices/${invoiceId}/pdf`, b.token, null, 403, 'GET');
  const pdf = await call(`invoices/${invoiceId}/pdf`, a.token, null, 200, 'GET');
  verify(typeof pdf.url === 'string' && pdf.expiresIn === 120, 'PDF signed URL contract');
  const download = await fetch(pdf.url, { signal: AbortSignal.timeout(30_000) });
  verify(download.status === 200 && (await download.text()).startsWith('%PDF-1.4'), 'Signed PDF usable after ACL closure');

  phase = 'browser-access-closed';
  for (const client of [anonymous, a.client, b.client]) {
    for (const table of ['organizations', 'organization_members', 'organization_profile', 'user_profile',
      'organization_billing', 'events', 'event_products', 'event_form_fields', 'orders', 'order_attendees', 'tickets', 'invoices']) {
      const result = await client.from(table).select('*').limit(1);
      verify(result.error && ['42501', 'PGRST106'].includes(result.error.code), `${table} direct read denied`);
    }
    for (const [name, args] of [
      ['get_dashboard_bootstrap', {}], ['create_organization', { p_input: { type: 'association', name: 'Forged' } }],
      ['organizer_create_organization', { p_actor_id: a.id, p_input: { type: 'association', name: 'Forged' } }],
      ['rpc_get_organization_billing', { p_org_id: orgA }],
    ]) {
      const result = await client.rpc(name, args);
      verify(result.error && ['42501', 'PGRST202', 'PGRST106'].includes(result.error.code), `${name} browser RPC denied`);
    }
    const graphql = await client.schema('graphql_public').rpc('graphql', {
      query: '{ organizationsCollection { edges { node { id name } } } ordersCollection { edges { node { id } } } }',
    });
    verify(graphql.error || (graphql.data?.errors?.length && !graphql.data?.data?.organizationsCollection && !graphql.data?.data?.ordersCollection), 'GraphQL business collections unavailable');
    const write = await client.from('organizations').update({ name: 'Forged' }).eq('id', orgA);
    verify(write.error && ['42501', 'PGRST106'].includes(write.error.code), 'Direct table write denied');
    const storage = await client.storage.from('invoices').download(pdfPath);
    verify(storage.error, 'Direct private PDF access denied');
  }
  const persisted = data(await service.from('organizations').select('name').eq('id', orgA).single(), 'Verify cross-tenant write refusal');
  verify(persisted.name === `Boundary A ${runId}`, 'Refused writes did not mutate fixture');
  console.log(`Staging deployed business boundary: ${checks} checks passed.`);
} catch {
  // Emit only a safe phase marker, never SDK objects or response bodies.
  console.error(`::error title=Business boundary integration failed::Phase: ${phase}; operation: ${operation}; HTTP: ${lastStatus}; SDK code: ${remoteCode}; verification: ${verification}`);
  process.exitCode = 1;
} finally {
  const cleanupErrors = [];
  async function clean(label, action) {
    try {
      const result = await action();
      if (result.error) cleanupErrors.push(label);
    } catch {
      cleanupErrors.push(label);
    }
  }
  if (assetPaths.length) {
    await clean('public-assets', () => service.storage.from('public-assets').remove(assetPaths));
  }
  if (invoicePaths.length) {
    await clean('invoice-storage', () => service.storage.from('invoices').remove(invoicePaths));
  }
  for (const id of orgs) {
    await clean('organization', () => service.from('organizations').delete().eq('id', id));
  }
  for (const id of users) {
    await clean('auth-user', () => service.auth.admin.deleteUser(id));
  }
  if (cleanupErrors.length) {
    console.error(`::error title=Business fixture cleanup failed::Resources: ${[...new Set(cleanupErrors)].join(', ')}`);
    process.exitCode = 1;
  }
}
