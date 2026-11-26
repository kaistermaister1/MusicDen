/* Where this device keeps its tabs. In the Windows app that is a folder on the computer, reached
   through the desktop shell; anywhere else it is the browser's storage, filled by syncing with the
   account. Either way each account's tabs are kept apart from every other's, and from the tabs
   made while no one is signed in, so one account's tabs never reach another. Both answer the same
   questions: open(who), list(), read(id), write(id, text), remove(id). */

const summary = (id, text, changed) => {
  let song = {};
  try { song = JSON.parse(text) || {}; } catch { song = {}; }
  return {id, title: song.title || id, duration_s: (song.source && song.source.duration_s) || 0,
    note_count: (song.notes || []).length, added: song.added || new Date(changed).toISOString(), size: text.length, changed};
};
const newestFirst = list => list.sort((a, b) => (a.added < b.added ? 1 : a.added > b.added ? -1 : 0));

/* The folder of tabs on the computer. */
export function deskStore() {
  const tabs = window.desk.tabs;
  return {
    /* Shows the tabs of an account ({id, email}), or with nothing those made while signed out.
       Tabs made while signed out go over to the account that signs in. */
    async open(who) {
      await tabs.open(who || null);
      if (who) await tabs.adopt();
    },
    list: () => tabs.list(),
    read: id => tabs.read(id),
    write: (id, text) => tabs.write(id, text),
    remove: id => tabs.remove(id)
  };
}

/* The tabs that come with the app itself: there for everyone who opens it, to read but not change. */
export function siteShelf() {
  return {
    async list() {
      const r = await fetch('songs/index.json', {cache: 'no-cache'});
      if (!r.ok) return [];
      return ((await r.json()).songs || []);
    },
    async read(id) {
      const r = await fetch('songs/' + encodeURIComponent(id) + '.json', {cache: 'no-cache'});
      if (!r.ok) throw new Error('read');
      return r.text();
    }
  };
}

/* The browser's own storage: a database for each account, and one for the tabs made while no one
   is signed in. Where the browser offers none (some private windows), tabs are held for this visit
   only and fetched again from the account next time. */
export function browserStore() {
  const NOBODY = 'none', bases = new Map(), held = new Map();
  let owner = NOBODY;
  const base = who => {
    if (!bases.has(who)) bases.set(who, new Promise(yes => {
      let req;
      try { req = indexedDB.open('guitar-tabs:' + who, 1); } catch { yes(null); return; }
      req.onupgradeneeded = () => req.result.createObjectStore('tabs', {keyPath: 'id'});
      req.onsuccess = () => yes(req.result);
      req.onerror = () => yes(null);
    }));
    return bases.get(who);
  };
  const keptFor = who => { if (!held.has(who)) held.set(who, new Map()); return held.get(who); };
  const run = async (who, mode, work) => {
    const d = await base(who);
    if (!d) return undefined;
    return new Promise((yes, no) => {
      const tx = d.transaction('tabs', mode), req = work(tx.objectStore('tabs'));
      tx.oncomplete = () => yes(req && req.result);
      tx.onerror = tx.onabort = () => no(tx.error);
    });
  };
  const rows = async who => ((await base(who)) ? (await run(who, 'readonly', s => s.getAll())) || [] : [...keptFor(who).values()]);
  const put = async (who, row) => { if (await base(who)) await run(who, 'readwrite', s => s.put(row)); else keptFor(who).set(row.id, row); };
  return {
    /* Shows the tabs of an account ({id, email}), or with nothing those made while signed out.
       Tabs made while signed out go over to the account that signs in; where the account has a
       later copy of one, the account's copy stays. */
    async open(who) {
      owner = who && who.id ? String(who.id) : NOBODY;
      if (owner === NOBODY) return;
      const to = owner, mine = new Map((await rows(to)).map(r => [r.id, r]));
      for (const r of await rows(NOBODY)) if (!mine.has(r.id) || mine.get(r.id).changed < r.changed) await put(to, r);
      if (await base(NOBODY)) await run(NOBODY, 'readwrite', s => s.clear()); else keptFor(NOBODY).clear();
    },
    async list() { return newestFirst((await rows(owner)).map(r => summary(r.id, r.text, r.changed))); },
    async read(id) {
      const who = owner, row = (await base(who)) ? await run(who, 'readonly', s => s.get(id)) : keptFor(who).get(id);
      if (!row) throw new Error('read');
      return row.text;
    },
    async write(id, text) { await put(owner, {id, text, changed: Date.now()}); },
    async remove(id) { const who = owner; if (await base(who)) await run(who, 'readwrite', s => s.delete(id)); else keptFor(who).delete(id); }
  };
}
