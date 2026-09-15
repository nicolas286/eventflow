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
let org = checked(await client.from('organizations').select('id').eq('name', name).maybeSingle());
if (!org) org = { id: checked(await client.rpc('create_organization', { p_input: { name, type: 'association' } })) };
let event = checked(await client.from('events').select('id,slug').eq('org_id', org.id).eq('title', 'Rencontre de démonstration').maybeSingle());
if (!event) event = checked(await client.rpc('create_event', { p_input: {
  org_id: org.id, title: 'Rencontre de démonstration', description: 'Événement fictif pour tester Eventflow. Aucun paiement réel.',
  location: 'Salle de démonstration', starts_at: new Date(Date.now() + 30 * 86400000).toISOString(),
  ends_at: new Date(Date.now() + 30 * 86400000 + 7200000).toISOString(), max_attendees: 50, deposit_cents: 0,
} }));
if (!event?.id) throw new Error('Unexpected create_event response');
checked(await admin.from('events').update({ is_published: true }).eq('id', event.id));
let product = checked(await client.from('event_products').select('id').eq('event_id', event.id).eq('name', 'Entrée gratuite').maybeSingle());
if (!product) product = { id: checked(await client.rpc('create_event_product', { p_input: {
  event_id: event.id, name: 'Entrée gratuite', price_cents: 0, currency: 'EUR', stock_qty: 50,
  creates_attendees: true, attendees_per_unit: 1, is_active: true, sort_order: 1,
} })) };
checked(await admin.from('event_products').update({ creates_attendees: true }).eq('id', product.id));
const profile = checked(await client.from('organization_profile').select('slug').eq('org_id', org.id).single());
console.log(JSON.stringify({ email, orgId: org.id, eventId: event.id, productId: product.id, publicPath: `/o/${profile.slug}/e/${event.slug}/billets` }));
await client.auth.signOut();
