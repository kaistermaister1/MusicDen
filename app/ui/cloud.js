/* A person's account and the songs kept in it: signing in, and syncing the songs on this device
   with the ones in the account. Talks to Supabase's sign-in and file storage over plain requests.
   Each account's songs live under its own id in the "songs" bucket, out of reach of other accounts. */
import {CLOUD} from './cloud-config.js';

const SESSION = 'piano-visualizer-account', BUCKET = 'songs';
let base = CLOUD.url.replace(/\/+$/, ''), key = CLOUD.key, session = null;
try { session = JSON.parse(localStorage.getItem(SESSION) || 'null'); } catch (e) {}

export class CloudError extends Error { constructor(code) { super(code); this.code = code; } }
export const configured = () => !!(base && key);
export const account = () => session && session.email ? {email: session.email, id: session.id} : null;
/* Points the app at another project. Used by the checks. */
export function configure(url, k) { base = String(url || '').replace(/\/+$/, ''); key = k || ''; session = null; localStorage.removeItem(SESSION); }

function keep(s) {
  session = s ? {access: s.access_token, refresh: s.refresh_token, until: Date.now() + (s.expires_in || 3600) * 1000, email: s.user.email, id: s.user.id} : null;
  if (session) localStorage.setItem(SESSION, JSON.stringify(session)); else localStorage.removeItem(SESSION);
}
async function call(path, {method = 'GET', body, type, auth = true, headers = {}} = {}) {
  if (auth) await fresh();
  let res;
  try {
    /* always asked of the account itself: a copy the browser kept could be older than what another device sent since */
    res = await fetch(base + path, {method, cache: 'no-store', body: body instanceof Uint8Array ? body : body ? JSON.stringify(body) : undefined,
      headers: {apikey: key, ...(auth ? {Authorization: 'Bearer ' + session.access} : {}), ...(body ? {'Content-Type': type || 'application/json'} : {}), ...headers}});
  } catch (e) { throw new CloudError('offline'); }
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

/* A song's place in the bucket. File names are spelled out in plain letters and digits, since the
   store refuses some characters that file names may hold. */
const hex = name => { let s = ''; for (const b of new TextEncoder().encode(name)) s += b.toString(16).padStart(2, '0'); return s; };
const spell = name => hex(name) + '.mid';
const unspell = stored => { const hex = stored.replace(/\.(mid|mp4)$/, ''), bytes = new Uint8Array(hex.length / 2); for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16); return new TextDecoder().decode(bytes); };
const place = name => `/storage/v1/object/${BUCKET}/${session.id}/${spell(name)}`;

/* The account's songs and when each was last sent. Also notes whether the account has a folders file. */
let foldersThere = false;
async function remoteSongs() {
  const out = new Map();
  foldersThere = false;
  for (let offset = 0; ; offset += 1000) {
    const res = await call(`/storage/v1/object/list/${BUCKET}`, {method: 'POST', body: {prefix: session.id + '/', limit: 1000, offset, sortBy: {column: 'name', order: 'asc'}}});
    if (!res.ok) throw new CloudError('failed');
    const rows = await res.json();
    for (const r of rows) {
      if (r.id && /^[0-9a-f]+\.mid$/.test(r.name)) out.set(unspell(r.name), r.updated_at || r.created_at || '');
      else if (r.name === 'folders.json') foldersThere = true;
    }
    if (rows.length < 1000) break;
  }
  return out;
}
async function upload(name, bytes) {
  const res = await call(place(name), {method: 'POST', body: bytes, type: 'audio/midi', headers: {'x-upsert': 'true'}});
  if (!res.ok) throw new CloudError('failed');
}
async function download(name) {
  const res = await call(`/storage/v1/object/authenticated/${BUCKET}/${session.id}/${spell(name)}`);
  if (!res.ok) throw new CloudError('failed');
  return new Uint8Array(await res.arrayBuffer());
}
/* True when the account itself says it has no such song. A list of the account's songs that came
   back short is not proof of that, so a song is asked for by name before it is removed from a device. */
async function gone(name) {
  const res = await call(`/storage/v1/object/authenticated/${BUCKET}/${session.id}/${spell(name)}`);
  if (res.ok) { try { await res.body.cancel(); } catch (e) {} return false; }
  const why = await res.json().catch(() => ({}));
  if (res.status === 404 || String(why.statusCode) === '404' || /not.?found/i.test(String(why.error || '') + String(why.message || ''))) return true;
  throw new CloudError('failed');
}
async function removeFromAccount(name) {
  const res = await call(place(name), {method: 'DELETE'});
  if (!res.ok && !(await gone(name))) throw new CloudError('failed');
}

/* ---------- videos saved on a computer, kept in the account to be watched on any device ---------- */
const videoPlace = name => `${BUCKET}/${session.id}/videos/${hex(name)}.mp4`;
/* The account's videos, newest first: {name, size, updated}. */
export async function videos() {
  await fresh();
  const res = await call(`/storage/v1/object/list/${BUCKET}`, {method: 'POST', body: {prefix: session.id + '/videos/', limit: 1000, offset: 0, sortBy: {column: 'updated_at', order: 'desc'}}});
  if (!res.ok) throw new CloudError('failed');
  return (await res.json()).filter(r => r.id && /^[0-9a-f]+\.mp4$/.test(r.name)).map(r => ({name: unspell(r.name), size: (r.metadata && r.metadata.size) || 0, updated: r.updated_at || ''}))
    .sort((a, b) => (a.updated < b.updated ? 1 : -1));
}
export async function sendVideo(name, bytes) {
  await fresh();
  const res = await call('/storage/v1/object/' + videoPlace(name), {method: 'POST', body: bytes, type: 'video/mp4', headers: {'x-upsert': 'true'}});
  if (!res.ok) throw new CloudError(res.status === 413 ? 'too-big' : 'failed');
}
/* An address the video can be played from for the next few hours. */
export async function videoAddress(name) {
  await fresh();
  const res = await call('/storage/v1/object/sign/' + videoPlace(name), {method: 'POST', body: {expiresIn: 6 * 3600}});
  if (!res.ok) throw new CloudError('failed');
  const got = await res.json();
  return base + '/storage/v1' + (got.signedURL || got.signedUrl);
}
export async function removeVideo(name) {
  await fresh();
  const res = await call('/storage/v1/object/' + videoPlace(name), {method: 'DELETE'});
  if (!res.ok) throw new CloudError('failed');
}

/* Gives a song or a video in the account another name. */
async function move(from, to) {
  await fresh();
  const res = await call('/storage/v1/object/move', {method: 'POST', body: {bucketId: BUCKET, sourceKey: `${session.id}/${from}`, destinationKey: `${session.id}/${to}`}});
  if (!res.ok) throw new CloudError('failed');
}
export const renameSong = (from, to) => move(spell(from), spell(to));
export const renameVideo = (from, to) => move(`videos/${hex(from)}.mp4`, `videos/${hex(to)}.mp4`);

/* ---------- the folders the songs are grouped into: one small file in the account, shared by every device ---------- */
const foldersPlace = () => `${BUCKET}/${session.id}/folders.json`;
/* The account's folders. */
async function remoteFolders() {
  const res = await call('/storage/v1/object/authenticated/' + foldersPlace());
  if (!res.ok) throw new CloudError('failed');
  return res.json().catch(() => null);
}
export async function sendFolders(doc) {
  await fresh();
  const res = await call('/storage/v1/object/' + foldersPlace(), {method: 'POST', body: doc, headers: {'x-upsert': 'true'}});
  if (!res.ok) throw new CloudError('failed');
}

/* Brings this device and the account into line. Songs only here are sent, songs only in the
   account are fetched, and a song changed on one side since the last sync replaces the other
   (the newer one when both changed). A song that was in step at the last sync and has since been
   removed on one side is removed on the other as well, unless it was changed there meanwhile:
   then the changed song is kept, and goes back to the side that removed it. The folders go
   whichever way is newer: the side where they were last changed by hand replaces the other.
   `library` is the account's songs on this device: list(), read(name), write(name, bytes),
   trash(name), and record() and keepRecord(record) for the note of how both sides stood at the
   last sync. That note is kept with the songs it describes, so songs new to a device, or a song
   folder swapped for another, are never mistaken for songs that were removed.
   `shelf` is the folders: read() gives {updated, folders}, replace(next) takes the account's,
   and settle() is called when the account's were not newer. */
export async function sync(library, shelf) {
  await fresh();
  /* every step is for the account that was signed in when the sync began */
  const mine = session.id, still = () => { if (!session || session.id !== mine) throw new CloudError('signed-out'); };
  const stamp = s => s.size + ':' + Math.round(s.changed);
  /* the songs are listed before the note is read: where neither can be reached, nothing looks removed */
  const local = new Map((await library.list()).map(s => [s.name, s])), record = (await library.record()) || {}, remote = await remoteSongs();
  still();
  let sent = 0, received = 0, removed = 0;
  const send = [], fetchThese = [], goneHere = [], goneThere = [];
  for (const name of new Set([...local.keys(), ...remote.keys()])) {
    const here = local.get(name), there = remote.get(name), was = record[name];
    if (here && there === undefined) (was && was.local === stamp(here) ? goneThere : send).push(name);
    else if (!here) (was && was.remote === there ? goneHere : fetchThese).push(name);
    else {
      const hereNew = !was || was.local !== stamp(here), thereNew = !was || was.remote !== there;
      if (hereNew && thereNew) (here.changed >= Date.parse(there) ? send : fetchThese).push(name);
      else if (hereNew) send.push(name);
      else if (thereNew) fetchThese.push(name);
    }
  }
  for (const name of send) { const bytes = new Uint8Array(await library.read(name)); still(); await upload(name, bytes); sent++; }
  for (const name of fetchThese) { const bytes = await download(name); still(); await library.write(name, bytes); received++; }
  /* removed here since the last sync: removed from the account */
  for (const name of goneHere) { still(); await removeFromAccount(name); remote.delete(name); removed++; }
  /* removed from the account since the last sync: removed here, once the account confirms it */
  for (const name of goneThere) { if (!(await gone(name))) continue; still(); await library.trash(name); removed++; }
  /* note how both sides stand now, to tell next time which of them changed */
  const after = new Map((await library.list()).map(s => [s.name, s])), afterRemote = sent ? await remoteSongs() : remote, next = {};
  for (const [name, s] of after) if (afterRemote.has(name)) next[name] = {local: stamp(s), remote: afterRemote.get(name)};
  still();
  if (JSON.stringify(next) !== JSON.stringify(record)) await library.keepRecord(next);
  if (shelf) {
    const theirs = foldersThere ? await remoteFolders() : null, when = d => String((d && d.updated) || '');
    still();
    if (when(theirs) > when(shelf.read())) shelf.replace(theirs); else shelf.settle();
    if (when(shelf.read()) > when(theirs)) await sendFolders(shelf.read());
  }
  return {sent, received, removed};
}
