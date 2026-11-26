/* A person's account and the tabs kept in it: signing in, and syncing the tabs on this device with
   the ones in the account. Talks to Supabase's sign-in and file storage over plain requests. Each
   account's tabs live under its own id, in a "tabs" folder of the "songs" bucket, out of reach of
   other accounts and apart from the piano's songs. The sign-in itself is the one the piano's page
   keeps (../cloud.js), under the same name, so signing in on either page signs in both. */
import {CLOUD} from '../cloud-config.js';

const SESSION = 'piano-visualizer-account', RECORD = 'guitar-tabs-sync', GONE = 'guitar-tabs-removed', BUCKET = 'songs', FOLDER = 'tabs';
let base = CLOUD.url.replace(/\/+$/, ''), key = CLOUD.key, session = null;
const recall = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k) || 'null'); return v == null ? d : v; } catch { return d; } };
const note = (k, v) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch { /* nothing is kept */ } };
session = recall(SESSION, null);

export class CloudError extends Error { constructor(code) { super(code); this.code = code; } }
export const configured = () => !!(base && key);
export const account = () => session && session.email ? {email: session.email, id: session.id} : null;
/* Points the app at another project. Used by the checks. */
export function configure(url, k) { base = String(url || '').replace(/\/+$/, ''); key = k || ''; session = null; note(SESSION, null); }

function keep(s) {
  session = s ? {access: s.access_token, refresh: s.refresh_token, until: Date.now() + (s.expires_in || 3600) * 1000, email: s.user.email, id: s.user.id} : null;
  note(SESSION, session);
}
async function call(path, {method = 'GET', body, type, auth = true, headers = {}} = {}) {
  if (auth) await fresh();
  let res;
  try {
    res = await fetch(base + path, {method, body: body instanceof Uint8Array ? body : body ? JSON.stringify(body) : undefined,
      headers: {apikey: key, ...(auth ? {Authorization: 'Bearer ' + session.access} : {}), ...(body ? {'Content-Type': type || 'application/json'} : {}), ...headers}});
  } catch { throw new CloudError('offline'); }
  if (res.status === 401 && auth) { keep(null); throw new CloudError('signed-out'); }
  return res;
}
/* Renews the sign-in shortly before it runs out. */
async function fresh() {
  if (!session) throw new CloudError('signed-out');
  if (Date.now() < session.until - 60000) return;
  const res = await call('/auth/v1/token?grant_type=refresh_token', {method: 'POST', body: {refresh_token: session.refresh}, auth: false});
  if (!res.ok) { keep(null); throw new CloudError('signed-out'); }
  keep(await res.json());
}
export async function signIn(email, password) {
  const res = await call('/auth/v1/token?grant_type=password', {method: 'POST', body: {email, password}, auth: false});
  if (!res.ok) {
    const why = await res.json().catch(() => ({}));
    throw new CloudError(/confirm/i.test(why.error_code || why.msg || why.error_description || '') ? 'unconfirmed' : 'refused');
  }
  keep(await res.json());
  return account();
}
/* Creates the account. Resolves to the account when it can be used at once, or null when the
   person first has to follow the link sent to their email. */
export async function signUp(email, password) {
  const res = await call('/auth/v1/signup', {method: 'POST', body: {email, password}, auth: false});
  const got = await res.json().catch(() => ({}));
  if (!res.ok) throw new CloudError(/password/i.test(got.error_code || got.msg || '') ? 'weak' : 'refused');
  if (got.access_token) { keep(got); return account(); }
  return null;
}
export async function signOut() {
  if (session) await call('/auth/v1/logout', {method: 'POST'}).catch(() => {});
  keep(null);
}

const safe = id => /^[A-Za-z0-9][A-Za-z0-9_-]{0,80}$/.test(id);
const place = id => `${BUCKET}/${session.id}/${FOLDER}/${id}.json`;
const GONE_FILE = '_removed';   /* the account's list of tabs removed on some device: {id: when} */

/* The tabs in the account: id -> when each was last changed there. */
async function remoteTabs() {
  const out = new Map();
  for (let offset = 0; ; offset += 1000) {
    const res = await call(`/storage/v1/object/list/${BUCKET}`, {method: 'POST', body: {prefix: `${session.id}/${FOLDER}/`, limit: 1000, offset, sortBy: {column: 'name', order: 'asc'}}});
    if (!res.ok) throw new CloudError('failed');
    const rows = await res.json();
    for (const r of rows) {
      const id = r.id && /\.json$/.test(r.name) ? r.name.slice(0, -5) : '';
      if (id === GONE_FILE) out.hasGone = true;
      else if (id && safe(id)) out.set(id, r.updated_at || r.created_at || '');
    }
    if (rows.length < 1000) break;
  }
  return out;
}
async function upload(id, bytes) {
  const res = await call('/storage/v1/object/' + place(id), {method: 'POST', body: bytes, type: 'application/json', headers: {'x-upsert': 'true'}});
  if (!res.ok) throw new CloudError('failed');
}
async function download(id) {
  const res = await call(`/storage/v1/object/authenticated/${place(id)}`);
  if (!res.ok) throw new CloudError(res.status === 404 || res.status === 400 ? 'missing' : 'failed');
  return new Uint8Array(await res.arrayBuffer());
}
async function removeRemote(id) {
  const res = await call('/storage/v1/object/' + place(id), {method: 'DELETE'});
  if (!res.ok && res.status !== 404 && res.status !== 400) throw new CloudError('failed');
}

/* Notes that a tab was removed on this device, so the next sync removes it from the account and
   from the person's other devices instead of bringing it back. The note is kept for the account
   that is signed in; a tab removed while no one is signed in was never in an account. */
export function forget(id) {
  if (!session) return;
  const all = recall(GONE, {}), mine = all[session.id] || (all[session.id] = {});
  mine[id] = Date.now();
  note(GONE, all);
}

/* Brings this device and the account into line. Tabs only here are sent, tabs only in the account
   are fetched, and a tab changed on one side since the last sync replaces the other (the newer one
   when both changed). A tab removed on any device is removed everywhere, unless it was changed or
   added again after that. `store` is the app's tab store: list(), read(id), write(id, text), remove(id). */
export async function sync(store) {
  await fresh();
  const enc = new TextEncoder(), dec = new TextDecoder();
  /* every step is for the account that was signed in when the sync began */
  const me = session.id, still = () => { if (!session || session.id !== me) throw new CloudError('signed-out'); };
  let sent = 0, received = 0, removed = 0;

  /* removals first: the account's list, joined with what was removed here since the last sync */
  const local = new Map((await store.list()).map(s => [s.id, s])), remote = await remoteTabs();
  let gone = {};
  if (remote.hasGone) try { gone = JSON.parse(dec.decode(await download(GONE_FILE))) || {}; } catch (e) { if (e.code !== 'missing') throw e; }
  const mine = recall(GONE, {})[me] || {};
  let goneChanged = false;
  for (const [id, when] of Object.entries(mine)) if (!(gone[id] >= when)) { gone[id] = when; goneChanged = true; }
  for (const [id, when] of Object.entries(gone)) {
    const here = local.get(id), there = remote.get(id);
    if (here && here.changed < when) { still(); await store.remove(id); local.delete(id); removed++; }
    if (there !== undefined && !(Date.parse(there) > when)) { await removeRemote(id); remote.delete(id); }
  }
  if (goneChanged) await upload(GONE_FILE, enc.encode(JSON.stringify(gone)));
  still();
  const notes = recall(GONE, {});
  delete notes[me];
  note(GONE, Object.keys(notes).length ? notes : null);

  const record = recall(RECORD, {})[me] || {};
  const stamp = s => s.size + ':' + Math.round(s.changed);
  const send = [], fetchThese = [];
  for (const id of new Set([...local.keys(), ...remote.keys()])) {
    const here = local.get(id), there = remote.get(id), was = record[id];
    if (here && there === undefined) send.push(id);
    else if (!here) fetchThese.push(id);
    else {
      const hereNew = !was || was.local !== stamp(here), thereNew = !was || was.remote !== there;
      if (hereNew && thereNew) (here.changed >= Date.parse(there) ? send : fetchThese).push(id);
      else if (hereNew) send.push(id);
      else if (thereNew) fetchThese.push(id);
    }
  }
  for (const id of send) { const bytes = enc.encode(await store.read(id)); still(); await upload(id, bytes); sent++; }
  for (const id of fetchThese) { const text = dec.decode(await download(id)); still(); await store.write(id, text); received++; }

  /* note how both sides stand now, to tell next time which of them changed */
  const after = new Map((await store.list()).map(s => [s.id, s])), afterRemote = sent ? await remoteTabs() : remote, next = {};
  for (const [id, s] of after) if (afterRemote.has(id)) next[id] = {local: stamp(s), remote: afterRemote.get(id)};
  still();
  const all = recall(RECORD, {});
  all[me] = next;
  note(RECORD, all);
  return {sent, received, removed};
}
