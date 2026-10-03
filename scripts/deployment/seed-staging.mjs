import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

const targets = JSON.parse(readFileSync(new URL('../../deploy/environments.json', import.meta.url)));
const url = process.env.SUPABASE_URL;
if (url !== `https://${targets.staging.supabaseProjectRef}.supabase.co` || targets.staging.supabaseProjectRef === targets.production.supabaseProjectRef) throw new Error('Seed refused: staging project required');
const password = process.env.STAGING_TEST_PASSWORD;
if (!password || password.length < 20) throw new Error('Provide STAGING_TEST_PASSWORD (at least 20 characters)');
const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const client = createClient(url, process.env.SUPABASE_ANON_KEY, { auth: { persistSession: false } });
const email = 'qa-owner@eventflow.example';
function checked(result) { if (result.error) throw new Error(result.error.message); return result.data; }
const { users } = checked(await admin.auth.admin.listUsers({ perPage: 1000 }));
if (!users.some(user => user.email === email)) checked(await admin.auth.admin.createUser({ email, password, email_confirm: true }));
checked(await client.auth.signInWithPassword({ email, password }));
const name = 'Eventflow démonstration staging';
let bootstrap = checked(await client.functions.invoke('organizations/bootstrap', { body: {} }));
let org = bootstrap.organization;
if (org && org.name !== name) throw new Error('Seed owner belongs to an unexpected organization');
if (!org) {
  const orgId = checked(await client.functions.invoke('organizations/create', { body: { name, type: 'association' } }));
  bootstrap = checked(await client.functions.invoke('organizations/bootstrap', { body: { orgId } }));
  org = bootstrap.organization;
}
if (!org?.id) throw new Error('Unexpected organizations bootstrap response');
const overview = checked(await client.functions.invoke('events/overview', { body: { orgId: org.id } }));
let event = overview.events.map(row => row.event).find(row => row.title === 'Rencontre de démonstration');
if (!event) event = checked(await client.functions.invoke('events/create', { body: {
  orgId: org.id, title: 'Rencontre de démonstration', description: 'Événement fictif pour tester Eventflow. Aucun paiement réel.',
  location: 'Salle de démonstration', startsAt: new Date(Date.now() + 30 * 86400000).toISOString(),
  endsAt: new Date(Date.now() + 30 * 86400000 + 7200000).toISOString(), maxAttendees: 50, depositCents: 0,
} }));
if (!event?.id) throw new Error('Unexpected events/create response');
checked(await client.functions.invoke('events/update', { body: { eventId: event.id, patch: { isPublished: true } } }));
const detail = checked(await client.functions.invoke('events/detail', { body: { eventId: event.id } }));
let product = detail.products.find(row => row.name === 'Entrée gratuite');
if (!product) product = checked(await client.functions.invoke('events/products/create', { body: {
  eventId: event.id, name: 'Entrée gratuite', priceCents: 0, currency: 'EUR', stockQty: 50,
  createsAttendees: true, attendeesPerUnit: 1, isActive: true, sortOrder: 1,
} }));
checked(await client.functions.invoke('events/products/update', { body: { productId: product.id, patch: { createsAttendees: true } } }));
const profile = bootstrap.organizationProfile;
if (!profile?.slug) throw new Error('Unexpected organization profile response');
console.log(JSON.stringify({ email, orgId: org.id, eventId: event.id, productId: product.id, publicPath: `/o/${profile.slug}/e/${event.slug}/billets` }));
await client.auth.signOut();
