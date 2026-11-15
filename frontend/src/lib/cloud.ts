import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js';
import { create } from 'zustand';
import * as lib from './library';

/**
 * Accounts, cloud library and billing. Everything here is optional: when the server has no
 * Supabase configured, `accounts` stays null and the app is the local-only editor it was.
 *
 * Cloud layout: one row per document in `documents` (metadata for the library grid), and the
 * content in the private `documents` bucket under `<user id>/<doc id>/` (doc.json + source PDFs).
 * Row-level security limits every query to the signed-in user's own rows and folder.
 */

export interface PlanInfo {
  name: string;
  translateChars: number;
  period: 'day' | 'month';
  cloudDocs: number | null;
  priceEur?: number;
}

interface Config {
  accounts: { url: string; key: string } | null;
  billing: boolean;
  plans: Record<'guest' | 'free' | 'pro', PlanInfo>;
}

export interface Me {
  email: string;
  plan: 'free' | 'pro';
  subscription: { status: string; renews: string | null } | null;
  usage: { used: number; limit: number; period: 'day' | 'month' };
  cloud: { used: number; limit: number | null };
}

export interface CloudDoc {
  id: string;
  name: string;
  page_count: number;
  thumb: string;
  tags: string[];
  source_count: number;
  updated_at: string;
}

type Dialog = { kind: 'signin' | 'account' } | { kind: 'upgrade'; reason?: string } | null;

interface CloudState {
  config: Config | null;
  session: Session | null;
  me: Me | null;
  cloudDocs: CloudDoc[];
  /** Free plan reached its cloud limit: new documents stay on this computer. */
  cloudFull: boolean;
  dialog: Dialog;
  setDialog(d: Dialog): void;
}

export const useCloud = create<CloudState>((set) => ({
  config: null,
  session: null,
  me: null,
  cloudDocs: [],
  cloudFull: false,
  dialog: null,
  setDialog: (dialog) => set({ dialog }),
}));

let client: SupabaseClient | null = null;
export const supabase = () => client;

/** Loads server config, restores the session and keeps account info fresh. */
export async function initCloud() {
  let config: Config | null = null;
  // The API can start a few seconds after the page (local dev, cold serverless start).
  for (let i = 0; i < 12 && !config; i++) {
    config = await fetch('/api/config')
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null);
    if (!config) await new Promise((r) => setTimeout(r, 1500));
  }
  if (!config) return;
  useCloud.setState({ config });
  if (!config.accounts) return;
  client = createClient(config.accounts.url, config.accounts.key, { auth: { persistSession: true, autoRefreshToken: true } });
  const { data } = await client.auth.getSession();
  useCloud.setState({ session: data.session });
  client.auth.onAuthStateChange((_e, session) => {
    const was = useCloud.getState().session?.user.id;
    useCloud.setState({ session });
    if (session?.user.id !== was) void refresh();
  });
  await refresh();
  await afterCheckout();
}

/** Re-reads plan, usage and the cloud document list. */
export async function refresh() {
  const { session } = useCloud.getState();
  if (!session || !client) {
    useCloud.setState({ me: null, cloudDocs: [], cloudFull: false });
    return;
  }
  const [me, docs] = await Promise.all([
    authed('/api/me').then((r) => (r.ok ? (r.json() as Promise<Me>) : null)),
    client.from('documents').select('id,name,page_count,thumb,tags,source_count,updated_at').order('updated_at', { ascending: false }),
  ]);
  useCloud.setState({
    me,
    cloudDocs: (docs.data as CloudDoc[] | null) ?? [],
    cloudFull: !!me && me.cloud.limit !== null && me.cloud.used >= me.cloud.limit,
  });
}

/** fetch() with the user's access token when signed in. */
export function authed(input: string, init: RequestInit = {}) {
  const token = useCloud.getState().session?.access_token;
  const headers = new Headers(init.headers);
  if (token) headers.set('Authorization', `Bearer ${token}`);
  return fetch(input, { ...init, headers });
}

async function errorOf(res: Response) {
  try {
    const j = await res.json();
    return Array.isArray(j.message) ? j.message.join(', ') : (j.message ?? res.statusText);
  } catch {
    return res.statusText;
  }
}

// ── Auth ───────────────────────────────────────────────────────────────────────────────

export async function signIn(email: string, password: string) {
  if (!client) throw new Error('Accounts are not available.');
  const { error } = await client.auth.signInWithPassword({ email: email.trim(), password });
  if (error) throw new Error(error.message === 'Invalid login credentials' ? 'Wrong e-mail or password.' : error.message);
}

export async function signUp(email: string, password: string) {
  const res = await fetch('/api/auth/signup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
  if (!res.ok) throw new Error(await errorOf(res));
  await signIn(email, password);
}

export async function signOut() {
  await client?.auth.signOut();
  useCloud.setState({ dialog: null });
}

// ── Billing ────────────────────────────────────────────────────────────────────────────

async function redirect(path: string) {
  const res = await authed(path, { method: 'POST' });
  if (!res.ok) throw new Error(await errorOf(res));
  window.location.href = (await res.json()).url;
}
export const startCheckout = () => redirect('/api/billing/checkout');
export const openBillingPortal = () => redirect('/api/billing/portal');

/** Back from Stripe Checkout: confirm the subscription right away instead of waiting for the webhook. */
async function afterCheckout() {
  const params = new URLSearchParams(window.location.search);
  const result = params.get('billing');
  if (!result) return;
  history.replaceState(null, '', window.location.pathname);
  if (result === 'success' && useCloud.getState().session) {
    // Stripe can take a moment to mark the subscription active: retry briefly.
    for (let i = 0; i < 4; i++) {
      await authed('/api/billing/sync', { method: 'POST' }).catch(() => undefined);
      await refresh().catch(() => undefined);
      if (useCloud.getState().me?.plan === 'pro') break;
      await new Promise((r) => setTimeout(r, 2000));
    }
    useCloud.setState({ dialog: { kind: 'account' } });
  }
}

/** Called when the API refuses a translation because the quota is used up. */
export function requestUpgrade(reason: string) {
  const { session } = useCloud.getState();
  useCloud.setState({ dialog: session ? { kind: 'upgrade', reason } : { kind: 'signin' } });
}

// ── Cloud library ──────────────────────────────────────────────────────────────────────

const uploaded = new Set<string>(); // source files already in storage this session
const pending = new Map<string, number>();

const folder = (id: string) => `${useCloud.getState().session!.user.id}/${id}`;

/** Debounced upload of a library document after it changes. */
export function queuePush(id: string) {
  if (!useCloud.getState().session || !client) return;
  window.clearTimeout(pending.get(id));
  pending.set(
    id,
    window.setTimeout(() => {
      pending.delete(id);
      void pushDoc(id).catch((e) => console.warn('Cloud sync failed', e));
    }, 2500),
  );
}

/** Uploads a document. Returns false when the plan's cloud limit is reached. */
export async function pushDoc(id: string): Promise<boolean> {
  const db = client;
  if (!db || !useCloud.getState().session) return false;
  const rec = await lib.getDoc(id);
  if (!rec) return false;
  const row = {
    name: rec.name,
    page_count: rec.pageCount,
    thumb: rec.thumb,
    tags: rec.tags,
    source_count: rec.sourceNames.length,
    created_at: new Date(rec.createdAt).toISOString(),
    updated_at: new Date(rec.updatedAt).toISOString(),
  };
  // Update first: an upsert would be checked against the "new document" limit even for existing ones.
  const upd = await db.from('documents').update(row).eq('id', id).select('id');
  if (upd.error) throw upd.error;
  if (!upd.data?.length) {
    const ins = await db.from('documents').insert({ id, ...row });
    if (ins.error) {
      if (ins.error.code === '42501') {
        useCloud.setState({ cloudFull: true });
        return false;
      }
      throw ins.error;
    }
  }
  const base = folder(id);
  const files = await lib.loadFiles(id, rec.sourceNames.length);
  for (const [i, bytes] of files.entries()) {
    const key = `${base}/source-${i}.pdf`;
    if (uploaded.has(key)) continue;
    const up = await db.storage.from('documents').upload(key, new Blob([bytes as BlobPart], { type: 'application/pdf' }), { upsert: false });
    if (up.error && !/exists|duplicate/i.test(up.error.message)) throw up.error;
    uploaded.add(key);
  }
  const content = { name: rec.name, createdAt: rec.createdAt, updatedAt: rec.updatedAt, thumb: rec.thumb, tags: rec.tags, pages: rec.pages, sourceNames: rec.sourceNames, versions: rec.versions, watermark: rec.watermark ?? null };
  const up = await db.storage.from('documents').upload(`${base}/doc.json`, new Blob([JSON.stringify(content)], { type: 'application/json' }), { upsert: true });
  if (up.error) throw up.error;
  await refresh();
  return true;
}

/** Downloads a cloud document into the local library. Returns false if it isn't in the cloud. */
export async function pullDoc(id: string): Promise<boolean> {
  const db = client;
  if (!db || !useCloud.getState().session) return false;
  const base = folder(id);
  const json = await db.storage.from('documents').download(`${base}/doc.json`);
  if (json.error || !json.data) return false;
  const c = JSON.parse(await json.data.text()) as Omit<lib.DocRecord, 'id' | 'pageCount'>;
  for (let i = 0; i < c.sourceNames.length; i++) {
    const f = await db.storage.from('documents').download(`${base}/source-${i}.pdf`);
    if (f.error || !f.data) throw new Error('A source file of this document is missing from the cloud.');
    await lib.saveFile(id, i, new Uint8Array(await f.data.arrayBuffer()));
    uploaded.add(`${base}/source-${i}.pdf`);
  }
  await lib.saveDoc({ ...c, id, pageCount: c.pages.length, versions: c.versions ?? [], tags: c.tags ?? [] });
  return true;
}

export async function deleteCloudDoc(id: string) {
  const db = client;
  if (!db || !useCloud.getState().session) return;
  const base = folder(id);
  const { data } = await db.storage.from('documents').list(base);
  if (data?.length) await db.storage.from('documents').remove(data.map((f) => `${base}/${f.name}`));
  await db.from('documents').delete().eq('id', id);
  await refresh();
}
