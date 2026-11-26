/* The phone and browser stand-in for the desktop shell. Songs are kept in the browser's own
   storage on the device instead of a folder, and come and go through the account's sync, as does
   the sheet music saved on a computer. Saving video, transcribing links and writing sheet music
   need a computer, so they are left out here. */
const SETTINGS = 'piano-visualizer-look-5';
/* first visit: start with the Songs panel closed, which suits a small screen */
if (!localStorage.getItem(SETTINGS)) localStorage.setItem(SETTINGS, JSON.stringify({libOpen: false}));

/* Each account's songs are in a database of their own, and the songs added while no one is signed
   in are in another, so one account never sees another's. The account's saved sheet music is in
   a database beside it. Each holds what it is named for, and the note of how that stood against
   the account at the last sync. */
const SONGS = 'piano-visualizer-songs', SHEETS = 'piano-visualizer-sheets', NOBODY = 'none';
const database = (name, kind) => new Promise((yes, no) => {
  const req = indexedDB.open(name, 1);
  req.onupgradeneeded = () => { req.result.createObjectStore(kind, {keyPath: 'name'}); req.result.createObjectStore('record'); };
  req.onsuccess = () => yes(req.result); req.onerror = () => no(req.error);
});
const store = id => database(SONGS + ':' + (id || NOBODY), 'songs'), sheetStore = id => database(SHEETS + ':' + (id || NOBODY), 'sheets');
const within = (db, name, mode, fn) => new Promise((ok, bad) => { const tx = db.transaction(name, mode), r = fn(tx.objectStore(name)); tx.oncomplete = () => ok(r.result); tx.onerror = tx.onabort = () => bad(tx.error); });
let owner = '', opened = store(''), openedSheets = sheetStore('');
const run = async (mode, fn) => within(await opened, 'songs', mode, fn);
const inSheets = async (mode, fn) => within(await openedSheets, 'sheets', mode, fn);
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

/* A saved sheet is one file, as the account keeps it: the letters MDS1, the PDF's length as four
   bytes, the PDF, and then its pages, a packed list of pictures. */
function parts(bytes) {
  const b = new Uint8Array(bytes);
  if (b.length < 8 || String.fromCharCode(b[0], b[1], b[2], b[3]) !== 'MDS1') throw new Error('sheet');
  const end = 8 + new DataView(b.buffer, b.byteOffset, b.byteLength).getUint32(4, true);
  if (end > b.length) throw new Error('sheet');
  return {pdf: b.subarray(8, end), pages: b.subarray(end)};
}
const unpacked = bytes => new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
const sheetOf = async name => { const s = await inSheets('readonly', os => os.get(name)); if (!s) throw new Error('missing'); return s; };

window.desk = {
  testing: new URLSearchParams(location.search).has('test'),
  library: {
    /* shows the songs of an account ({id, email}), or with nothing those added while signed out */
    open: async who => {
      const was = [opened, openedSheets];
      owner = who && who.id ? String(who.id) : '';
      opened = store(owner); openedSheets = sheetStore(owner);
      await opened; await openedSheets;
      for (const p of was) p.then(db => db.close(), () => {});
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
    record: async () => (owner ? (await within(await opened, 'record', 'readonly', os => os.get('last'))) || null : null),
    keepRecord: async record => { if (owner) await within(await opened, 'record', 'readwrite', os => os.put(record, 'last')); },
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
    openFolder: async () => {},
    onChanged: fn => watchers.push(fn)
  },
  /* sheet music is written on a computer; what was saved there can be looked at here */
  sheet: {
    available: async () => false,
    engrave: async () => { throw new Error('unavailable'); },
    printed: async () => (await inSheets('readonly', os => os.getAll())).map(s => ({name: s.name, size: s.pdf, when: s.changed})).sort((a, b) => b.when - a.when),
    pages: async name => JSON.parse(await unpacked(parts((await sheetOf(name)).bytes).pages)),
    unprint: async name => { await inSheets('readwrite', os => os.delete(name)); },
    rename: async (from, to) => {
      const s = await sheetOf(from);
      if (from.toLowerCase() !== to.toLowerCase() && (await inSheets('readonly', os => os.getAllKeys())).some(k => k.toLowerCase() === to.toLowerCase())) throw new Error('taken');
      await inSheets('readwrite', os => os.put({...s, name: to}));
      if (to !== from) await inSheets('readwrite', os => os.delete(from));
    },
    /* hands the PDF itself to the browser, to keep or print */
    download: async name => {
      const a = Object.assign(document.createElement('a'), {href: URL.createObjectURL(new Blob([parts((await sheetOf(name)).bytes).pdf], {type: 'application/pdf'})), download: name + '.pdf'});
      a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    }
  },
  /* the saved sheet music as a sync sees it */
  sheets: {
    list: async () => (await inSheets('readonly', os => os.getAll())).map(s => ({name: s.name, size: s.size, changed: s.changed})),
    read: async name => (await sheetOf(name)).bytes,
    write: async (name, bytes) => {
      const copy = new Uint8Array(bytes), pdf = parts(copy).pdf.length;
      await inSheets('readwrite', os => os.put({name, bytes: copy, size: copy.length, pdf, changed: Date.now()}));
    },
    trash: async name => { await inSheets('readwrite', os => os.delete(name)); },
    record: async () => (owner ? (await within(await openedSheets, 'record', 'readonly', os => os.get('last'))) || null : null),
    keepRecord: async record => { if (owner) await within(await openedSheets, 'record', 'readwrite', os => os.put(record, 'last')); },
    adopt: async () => []
  },
  link: {start: async () => ({error: 'tools'}), cancel: async () => {}, transcriber: async () => ({tools: false, card: ''}), onStage: () => {}},
  video: {available: async () => false, choose: async () => '', show: async () => {}, start: async () => { throw new Error('no-encoder'); }, finish: async () => false, cancel: async () => {}}
};
