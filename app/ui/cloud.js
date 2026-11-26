/* A person's account and what is kept in it: signing in, and syncing the songs and the saved sheet
   music on this device with the ones in the account. Talks to Supabase's sign-in and file storage
   over plain requests. Each account's files live under its own id in the "songs" bucket, out of
   reach of other accounts. */
import {CLOUD} from './cloud-config.js';

const SESSION = 'piano-visualizer-account', BUCKET = 'songs';
let base = CLOUD.url.replace(/\/+$/, ''), key = CLOUD.key, session = null;
/* a check points the app at its own stand-in for the account service before the app starts */
try { const at = window.desk && window.desk.testing && localStorage.getItem('musicden-cloud-check'); if (at) { base = at.replace(/\/+$/, ''); key = 'test-key'; } } catch (e) {}
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

/* What a sync keeps in step, and where each kind sits under the account's id: songs straight under
   it, saved sheet music in "sheets". A saved sheet is one file, its PDF and its pages together.
   File names are spelled out in plain letters and digits, since the store refuses some characters
   that file names may hold. */
const SONGS = {under: '', ext: '.mid', type: 'audio/midi'}, SHEETS = {under: 'sheets/', ext: '.sheet', type: 'application/octet-stream'};
const hex = name => { let s = ''; for (const b of new TextEncoder().encode(name)) s += b.toString(16).padStart(2, '0'); return s; };
const unspell = spelled => { const hex = spelled.replace(/\.[a-z0-9]+$/, ''), bytes = new Uint8Array(hex.length / 2); for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16); return new TextDecoder().decode(bytes); };
const stored = (kind, name) => `${kind.under}${hex(name)}${kind.ext}`;
const place = (kind, name) => `${BUCKET}/${session.id}/${stored(kind, name)}`;

/* What the account holds of one kind, and when each was last sent. `beside` collects the names of the other files lying with them. */
async function listed(kind, beside) {
  const out = new Map(), fits = name => name.endsWith(kind.ext) && /^[0-9a-f]+$/.test(name.slice(0, -kind.ext.length));
  for (let offset = 0; ; offset += 1000) {
    const res = await call(`/storage/v1/object/list/${BUCKET}`, {method: 'POST', body: {prefix: `${session.id}/${kind.under}`, limit: 1000, offset, sortBy: {column: 'name', order: 'asc'}}});
    if (!res.ok) throw new CloudError('failed');
    const rows = await res.json();
    for (const r of rows) {
      if (r.id && fits(r.name)) out.set(unspell(r.name), r.updated_at || r.created_at || '');
      else if (beside) beside.add(r.name);
    }
    if (rows.length < 1000) break;
  }
  return out;
}
async function upload(kind, name, bytes) {
  const res = await call('/storage/v1/object/' + place(kind, name), {method: 'POST', body: bytes, type: kind.type, headers: {'x-upsert': 'true'}});
  if (!res.ok) throw new CloudError('failed');
}
async function download(kind, name) {
  const res = await call('/storage/v1/object/authenticated/' + place(kind, name));
  if (!res.ok) throw new CloudError('failed');
  return new Uint8Array(await res.arrayBuffer());
}
/* True when the account itself says it has no such file. A list of the account's files that came
   back short is not proof of that, so a file is asked for by name before it is removed from a device. */
async function gone(kind, name) {
  const res = await call('/storage/v1/object/authenticated/' + place(kind, name));
  if (res.ok) { try { await res.body.cancel(); } catch (e) {} return false; }
  const why = await res.json().catch(() => ({}));
  if (res.status === 404 || String(why.statusCode) === '404' || /not.?found/i.test(String(why.error || '') + String(why.message || ''))) return true;
  throw new CloudError('failed');
}
async function removeFromAccount(kind, name) {
  const res = await call('/storage/v1/object/' + place(kind, name), {method: 'DELETE'});
  if (!res.ok && !(await gone(kind, name))) throw new CloudError('failed');
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

/* Gives a song, a saved sheet or a video in the account another name. */
async function move(from, to) {
  await fresh();
  const res = await call('/storage/v1/object/move', {method: 'POST', body: {bucketId: BUCKET, sourceKey: `${session.id}/${from}`, destinationKey: `${session.id}/${to}`}});
  if (!res.ok) throw new CloudError('failed');
}
export const renameSong = (from, to) => move(stored(SONGS, from), stored(SONGS, to));
export const renameSheet = (from, to) => move(stored(SHEETS, from), stored(SHEETS, to));
export const renameVideo = (from, to) => move(`videos/${hex(from)}.mp4`, `videos/${hex(to)}.mp4`);

/* ---------- the folders the songs, and the saved sheets, are grouped into: one small file each in the account, shared by every device ---------- */
const FOLDERS = {'': 'folders.json', sheets: 'sheet-folders.json'};
/* The account's folders of one list. */
async function remoteFolders(file) {
  const res = await call(`/storage/v1/object/authenticated/${BUCKET}/${session.id}/${file}`);
  if (!res.ok) throw new CloudError('failed');
  return res.json().catch(() => null);
}
/* `kind` is '' for the folders of the Songs list and 'sheets' for those of the Sheets list. */
export async function sendFolders(doc, kind = '') {
  await fresh();
  const res = await call(`/storage/v1/object/${BUCKET}/${session.id}/${FOLDERS[kind]}`, {method: 'POST', body: doc, headers: {'x-upsert': 'true'}});
  if (!res.ok) throw new CloudError('failed');
}

/* Brings one kind of file on this device into line with the account. Files only here are sent,
   files only in the account are fetched, and a file changed on one side since the last sync
   replaces the other (the newer one when both changed). A file that was in step at the last sync
   and has since been removed on one side is removed on the other as well, unless it was changed
   there meanwhile: then the changed file is kept, and goes back to the side that removed it. */
async function syncKind(kind, library, still, beside) {
  const stamp = s => s.size + ':' + Math.round(s.changed);
  /* the files are listed before the note is read: where neither can be reached, nothing looks removed */
  const local = new Map((await library.list()).map(s => [s.name, s])), record = (await library.record()) || {}, remote = await listed(kind, beside);
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
  for (const name of send) { const bytes = new Uint8Array(await library.read(name)); still(); await upload(kind, name, bytes); sent++; }
  for (const name of fetchThese) { const bytes = await download(kind, name); still(); await library.write(name, bytes); received++; }
  /* removed here since the last sync: removed from the account */
  for (const name of goneHere) { still(); await removeFromAccount(kind, name); remote.delete(name); removed++; }
  /* removed from the account since the last sync: removed here, once the account confirms it */
  for (const name of goneThere) { if (!(await gone(kind, name))) continue; still(); await library.trash(name); removed++; }
  /* note how both sides stand now, to tell next time which of them changed */
  const after = new Map((await library.list()).map(s => [s.name, s])), afterRemote = sent ? await listed(kind) : remote, next = {};
  for (const [name, s] of after) if (afterRemote.has(name)) next[name] = {local: stamp(s), remote: afterRemote.get(name)};
  still();
  if (JSON.stringify(next) !== JSON.stringify(record)) await library.keepRecord(next);
  return {sent, received, removed};
}
/* The folders of one list go whichever way is newer: the side where they were last changed by hand replaces the other. */
async function syncFolders(shelf, there, still) {
  const theirs = there ? await remoteFolders(FOLDERS[shelf.kind]) : null, when = d => String((d && d.updated) || '');
  still();
  if (when(theirs) > when(shelf.read())) shelf.replace(theirs); else shelf.settle();
  if (when(shelf.read()) > when(theirs)) await sendFolders(shelf.read(), shelf.kind);
}

/* Brings this device and the account into line: the songs and their folders, then the saved sheet
   music and its folders. What it did to the songs comes back as {sent, received, removed}, with
   the same for the sheets under `sheets`.
   `library` is the account's songs on this device, and `sheets` its saved sheet music: each has
   list(), read(name), write(name, bytes), trash(name), and record() and keepRecord(record) for the
   note of how both sides stood at the last sync. That note is kept with the files it describes,
   so files new to a device, or a song folder swapped for another, are never mistaken for files
   that were removed.
   `shelf` and `sheetShelf` are the folders of the two lists: read() gives {updated, folders},
   replace(next) takes the account's, and settle() is called when the account's were not newer. */
export async function sync(library, shelf, sheets, sheetShelf) {
  await fresh();
  /* every step is for the account that was signed in when the sync began */
  const mine = session.id, still = () => { if (!session || session.id !== mine) throw new CloudError('signed-out'); };
  const beside = new Set(), did = await syncKind(SONGS, library, still, beside);
  if (shelf) await syncFolders(shelf, beside.has(FOLDERS['']), still);
  if (sheets) {
    did.sheets = await syncKind(SHEETS, sheets, still);
    if (sheetShelf) await syncFolders(sheetShelf, beside.has(FOLDERS.sheets), still);
  }
  return did;
}
