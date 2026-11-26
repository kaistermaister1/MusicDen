/* The phone and browser version's service worker: it keeps the app on the device, so the app opens
   at once and works without a connection.

   The published copy of this file is stamped by scripts/build-phone.mjs with a version and two
   lists: the app's own files (page, scripts, styles, fonts, icons) and the piano's recordings.
   The app's files are fetched together when a version is installed and served from that copy from
   then on, so a visit never mixes two versions; a newer version is fetched in the background and
   takes over once it is complete. The recordings never change: each is kept the first time it is
   fetched, and the rest are fetched a few at a time while the app is open.

   Unstamped (when the app is served straight from the source folder) the lists are empty: every
   file is then asked of the server first and the kept copy is only used when the server cannot
   be reached. */
const VERSION = 'dev', SHELL = [], PIANO = [];

const APP = 'app-' + VERSION, SOUNDS = 'piano-1';
const at = rel => new URL(rel, self.location).href, PAGE = at('./index.html');
const isSound = url => url.pathname.includes('/assets/piano/');
/* A copy that can answer a page load: one that arrived by a redirect cannot, so it is rebuilt without that history. */
const plain = async res => res.redirected ? new Response(await res.blob(), {status: res.status, statusText: res.statusText, headers: res.headers}) : res;

self.addEventListener('install', e => e.waitUntil((async () => {
  const cache = await caches.open(APP);
  await Promise.all(SHELL.map(async rel => {
    const res = await fetch(at(rel), {cache: 'reload'});
    if (!res.ok) throw new Error('not fetched: ' + rel);
    await cache.put(at(rel), await plain(res));
  }));
  await self.skipWaiting();
})()));

self.addEventListener('activate', e => e.waitUntil((async () => {
  for (const name of await caches.keys()) if (name.startsWith('app-') && name !== APP) await caches.delete(name);
  await self.clients.claim();
})()));

/* The server first, keeping what it sends; the kept copy when the server cannot be reached. */
async function fresh(req, key) {
  const cache = await caches.open(APP);
  try {
    const res = await fetch(req);
    if (res.ok) await cache.put(key, await plain(res.clone()));
    return res;
  } catch (err) {
    const kept = await cache.match(key, {ignoreSearch: true});
    if (kept) return kept;
    throw err;
  }
}
/* The kept copy first; otherwise the server, keeping what it sends. */
async function kept(name, req, key) {
  const cache = await caches.open(name), have = await cache.match(key, {ignoreSearch: true});
  if (have) return have;
  const res = await fetch(req);
  if (res.status === 200) await cache.put(key, await plain(res.clone()));
  return res;
}

self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin || req.headers.has('range')) return;
  if (isSound(url)) e.respondWith(kept(SOUNDS, req, url.href));
  else if (req.mode === 'navigate') e.respondWith(SHELL.length ? kept(APP, req, PAGE) : fresh(req, PAGE));
  else e.respondWith(SHELL.length ? kept(APP, req, url.origin + url.pathname) : fresh(req, url.origin + url.pathname));
});

/* Fetches recordings that are not kept yet, four at a time, for a few seconds, and resolves to
   how many are kept out of how many there are. The page shows that and asks again until all are. */
let filling = null;
function fill() {
  if (filling) return filling;
  filling = (async () => {
    const cache = await caches.open(SOUNDS), want = PIANO.map(at), since = Date.now();
    const have = new Set((await cache.keys()).map(r => r.url)), missing = want.filter(u => !have.has(u));
    let failed = false;
    const next = async () => {
      while (missing.length && !failed && Date.now() - since < 4000) {
        const u = missing.shift();
        try { const res = await fetch(u); if (res.status === 200) { await cache.put(u, res); have.add(u); } else failed = true; }
        catch (err) { failed = true; }
      }
    };
    await Promise.all([next(), next(), next(), next()]);
    return {have: want.filter(u => have.has(u)).length, of: want.length, version: VERSION};
  })();
  filling.finally(() => { filling = null; });
  return filling;
}
self.addEventListener('message', e => {
  if (e.data === 'fill') e.waitUntil(fill().then(state => e.source.postMessage({offline: state})));
});
