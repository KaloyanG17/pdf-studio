// End-to-end check of accounts, cloud library rules, quotas and billing against a running API
// and the real Supabase project. Creates a throwaway user and deletes it afterwards.
//
//   API_URL=http://localhost:3001 node test/accounts.e2e.mjs
//
// Needs SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY (or _ANON_KEY) and SUPABASE_SECRET_KEY
// (or _SERVICE_ROLE_KEY); read from ../.env.local when not set.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { after, before, test } from 'node:test';
import { createClient } from '@supabase/supabase-js';

const envFile = new URL('../../.env.local', import.meta.url);
if (existsSync(envFile))
  for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)="?(.*?)"?$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }

const API = process.env.API_URL ?? 'http://localhost:3001';
const url = process.env.SUPABASE_URL;
const anonKey = process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_ANON_KEY;
const admin = createClient(url, process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const email = `e2e-${randomBytes(4).toString('hex')}@example.com`;
const password = randomBytes(12).toString('base64url');
let user; // supabase client signed in as the test user
let token;
let userId;

const api = (path, init = {}) =>
  fetch(API + path, { ...init, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...init.headers } });

before(async () => {
  const r = await api('/api/auth/signup', { method: 'POST', body: JSON.stringify({ email, password }) });
  assert.equal(r.status, 201, await r.text());
  user = createClient(url, anonKey, { auth: { persistSession: false } });
  const { data, error } = await user.auth.signInWithPassword({ email, password });
  assert.ifError(error);
  token = data.session.access_token;
  userId = data.user.id;
});

after(async () => {
  if (!userId) return;
  const { data } = await admin.storage.from('documents').list(userId);
  for (const d of data ?? []) {
    const { data: files } = await admin.storage.from('documents').list(`${userId}/${d.name}`);
    await admin.storage.from('documents').remove((files ?? []).map((f) => `${userId}/${d.name}/${f.name}`));
  }
  await admin.from('usage').delete().eq('subject', `u:${userId}`);
  await admin.auth.admin.deleteUser(userId);
});

test('config exposes only public keys', async () => {
  const cfg = await (await api('/api/config')).json();
  assert.equal(cfg.accounts.url, url);
  assert.ok(cfg.accounts.key && !/service|secret/i.test(cfg.accounts.key));
  assert.equal(cfg.plans.free.cloudDocs, 3);
});

test('a new account starts on Free with empty usage', async () => {
  const me = await (await api('/api/me')).json();
  assert.equal(me.email, email);
  assert.equal(me.plan, 'free');
  assert.deepEqual(me.cloud, { used: 0, limit: 3 });
  assert.equal(me.usage.used, 0);
});

test('duplicate sign-up is refused', async () => {
  const r = await api('/api/auth/signup', { method: 'POST', body: JSON.stringify({ email, password }) });
  assert.equal(r.status, 400);
});

test('the browser cannot upgrade itself', async () => {
  await user.from('profiles').update({ plan: 'pro' }).eq('id', userId);
  const { data } = await admin.from('profiles').select('plan').eq('id', userId).single();
  assert.equal(data.plan, 'free');
});

test('free plan keeps at most 3 documents in the cloud', async () => {
  for (let i = 0; i < 3; i++) {
    const { error } = await user.from('documents').insert({ id: `doc-${i}`, name: `Doc ${i}` });
    assert.ifError(error);
  }
  const { error } = await user.from('documents').insert({ id: 'doc-3', name: 'One too many' });
  assert.ok(error, 'fourth insert should be rejected by row-level security');
});

test('users only see their own files', async () => {
  const mine = await user.storage.from('documents').upload(`${userId}/doc-0/doc.json`, new Blob(['{}']), { upsert: true });
  assert.ifError(mine.error);
  const other = await user.storage.from('documents').upload(`00000000-0000-0000-0000-000000000000/x/doc.json`, new Blob(['{}']));
  assert.ok(other.error, 'writing outside your own folder must fail');
});

test('translation counts against the monthly quota', async () => {
  const r = await api('/api/translate', { method: 'POST', body: JSON.stringify({ texts: ['Фактура'], source: 'bg', target: 'en' }) });
  assert.equal(r.status, 201, await r.text());
  const me = await (await api('/api/me')).json();
  assert.equal(me.usage.used, 'Фактура'.length);
});

test('over-quota requests get 402', async () => {
  await admin.from('usage').upsert({ subject: `u:${userId}`, period: new Date().toISOString().slice(0, 7), chars: 20_000 });
  const r = await api('/api/translate', { method: 'POST', body: JSON.stringify({ texts: ['Здравей'], source: 'bg', target: 'en' }) });
  assert.equal(r.status, 402);
  assert.equal((await r.json()).error, 'quota_exceeded');
});

test('checkout opens a Stripe subscription page', async (t) => {
  const cfg = await (await api('/api/config')).json();
  if (!cfg.billing) return t.skip('billing not configured');
  const r = await api('/api/billing/checkout', { method: 'POST', headers: { origin: 'http://localhost:5173' } });
  const body = await r.text();
  assert.equal(r.status, 201, body);
  assert.match(JSON.parse(body).url, /^https:\/\/checkout\.stripe\.com\//);
});

test('webhooks without a valid signature are rejected', async () => {
  const r = await fetch(`${API}/api/billing/webhook`, { method: 'POST', headers: { 'stripe-signature': 't=1,v1=bad', 'content-type': 'application/json' }, body: '{}' });
  assert.ok([400, 503].includes(r.status));
});
