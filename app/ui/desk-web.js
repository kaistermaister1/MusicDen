/* The phone and browser stand-in for the desktop shell. Songs are kept in the browser's own
   storage on the device instead of a folder, and come and go through the account's sync.
   Saving video and transcribing links need a computer, so they are left out here. */
const SETTINGS = 'piano-visualizer-look-5';
/* first visit: start with the Songs panel closed, which suits a small screen */
if (!localStorage.getItem(SETTINGS)) localStorage.setItem(SETTINGS, JSON.stringify({libOpen: false}));

/* Each account's songs are in a store of their own, and the songs added while no one is signed in
   are in another, so one account never sees another's. An account's store also holds the note of
   how its songs stood against the account at the last sync. */
const STORE = 'piano-visualizer-songs';
const store = id => new Promise((yes, no) => {
  const req = indexedDB.open(id ? STORE + ':' + id : STORE, 1);
  req.onupgradeneeded = () => { req.result.createObjectStore('songs', {keyPath: 'name'}); if (id) req.result.createObjectStore('record'); };
  req.onsuccess = () => yes(req.result); req.onerror = () => no(req.error);
});
const within = (db, name, mode, fn) => new Promise((ok, bad) => { const tx = db.transaction(name, mode), r = fn(tx.objectStore(name)); tx.oncomplete = () => ok(r.result); tx.onerror = tx.onabort = () => bad(tx.error); });
let owner = '', opened = store('');
const run = async (mode, fn) => within(await opened, 'songs', mode, fn);
const watchers = [];
let pending = 0;
const changed = () => { clearTimeout(pending); pending = setTimeout(() => watchers.forEach(fn => fn()), 60); };
const isMidi = name => /\.midi?$/i.test(name);
const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

async function put(name, bytes) {
  const copy = new Uint8Array(bytes);
  await run('readwrite', os => os.put({name, bytes: copy, size: copy.length, changed: Date.now()}));
  changed();
}
/* The name a song takes among the songs showing: its own, or with a number added when a different
   song already has it. `twice` says the very same song, byte for byte, is already there under that name. */
async function nameFor(name, bytes) {
  const dot = name.lastIndexOf('.'), stem = name.slice(0, dot), ext = name.slice(dot);
  for (let i = 2, as = name; ; as = `${stem} (${i++})${ext}`) {
    const there = await run('readonly', os => os.get(as));
    if (!there) return {as, twice: false};
    if (same(there.bytes, bytes)) return {as, twice: true};
  }
}
/* Adds files the person picked. One already here with the same bytes is not added twice; a
   different file of the same name gets a number. Files that are not MIDI come back as null. */
async function addFiles(files) {
  const names = [];
  for (const f of files) {
    if (!isMidi(f.name)) { names.push(null); continue; }
    const bytes = new Uint8Array(await f.arrayBuffer()), {as, twice} = await nameFor(f.name, bytes);
    if (!twice) await put(as, bytes);
    names.push(as);
  }
  return names;
}

window.desk = {
  testing: new URLSearchParams(location.search).has('test'),
  library: {
    /* shows the songs of an account ({id, email}), or with nothing those added while signed out */
    open: async who => {
      const was = opened;
      owner = who && who.id ? String(who.id) : '';
      opened = store(owner);
      await opened;
      was.then(db => db.close(), () => {});
      changed();
    },
    /* moves the songs added while signed out over to the account now showing; gives each one's name before and after */
    adopt: async () => {
      const moved = {};
      if (!owner) return moved;
      const from = await store('');
      try {
        for (const s of await within(from, 'songs', 'readonly', os => os.getAll())) {
          const {as, twice} = await nameFor(s.name, s.bytes);
          if (!twice) await run('readwrite', os => os.put({...s, name: as}));
          moved[s.name] = as;
        }
        await within(from, 'songs', 'readwrite', os => os.clear());
      } finally { from.close(); }
      changed();
      return moved;
    },
    record: async () => { const db = await opened; return db.objectStoreNames.contains('record') ? (await within(db, 'record', 'readonly', os => os.get('last'))) || null : null; },
    keepRecord: async record => { const db = await opened; if (db.objectStoreNames.contains('record')) await within(db, 'record', 'readwrite', os => os.put(record, 'last')); },
    folder: async () => 'device',
    choose: async () => 'device',
    list: async () => (await run('readonly', os => os.getAll())).map(s => ({name: s.name, size: s.size, changed: s.changed})),
    read: async name => { const s = await run('readonly', os => os.get(name)); if (!s) throw new Error('missing'); return s.bytes; },
    write: put,
    pick: () => new Promise(done => {
      const input = Object.assign(document.createElement('input'), {type: 'file', multiple: true, accept: '.mid,.midi,audio/midi,audio/x-midi'});
      input.onchange = () => addFiles([...input.files]).then(done);
      input.oncancel = () => done([]);
      input.click();
    }),
    importFiles: addFiles,
    importPaths: async () => [],
    trash: async name => { await run('readwrite', os => os.delete(name)); changed(); },
    rename: async (from, to) => {
      if (await run('readonly', os => os.get(to))) throw new Error('taken');
      const s = await run('readonly', os => os.get(from));
      if (!s) throw new Error('missing');
      await run('readwrite', os => os.put({...s, name: to}));
      await run('readwrite', os => os.delete(from));
      changed();
    },
    saveCopy: async (suggested, bytes) => {
      const a = Object.assign(document.createElement('a'), {href: URL.createObjectURL(new Blob([bytes], {type: 'audio/midi'})), download: suggested});
      a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 10000);
      return suggested;
    },
    openFolder: async () => {},
    onChanged: fn => watchers.push(fn)
  },
  sheet: {available: async () => false, engrave: async () => { throw new Error('unavailable'); }},
  link: {start: async () => ({error: 'tools'}), cancel: async () => {}, transcriber: async () => ({tools: false, card: ''}), onStage: () => {}},
  video: {available: async () => false, choose: async () => '', show: async () => {}, start: async () => { throw new Error('no-encoder'); }, finish: async () => false, cancel: async () => {}}
};
