/* Folders in the Songs list. A folder is a named group of songs: the song files stay where they
   are, and which songs each folder holds is kept on this device and, for someone signed in, in
   their account, so every device shows the same folders. Each account has its own folders here,
   as it has its own songs. Songs are dragged onto a folder to put them in it, and a folder is
   clicked to open or close it. */
import {T, fill} from './strings.js';
import {esc} from './inspector.js';

const KEY = 'piano-visualizer-folders', OPEN = 'piano-visualizer-folders-open';
const X = '<svg viewBox="0 0 16 16" aria-hidden="true"><path class="ln" d="M4 4l8 8M12 4l-8 8"/></svg>';
const CARET = '<svg viewBox="0 0 8 8" aria-hidden="true"><path d="M2 1l4 3-4 3z"/></svg>';
const PLUS = '<svg viewBox="0 0 8 8" aria-hidden="true"><path class="ln" d="M4 1v6M1 4h6"/></svg>';
const order = new Intl.Collator(undefined, {numeric: true, sensitivity: 'base'});
const tidy = s => String(s).replace(/\s+/g, ' ').trim().slice(0, 60);

/* Songs are dragged with a mouse. On a touch screen a drag would fight with scrolling the list, so there a song is moved from its row's menu (more.js). */
const DRAG = matchMedia('(pointer: coarse)').matches ? '' : ' draggable="true"';
/* `who` is the account the folders belong to, '' for the ones made while no one is signed in. */
let who = '', open = {}, redraw = () => {};
const keyOf = id => (id ? KEY + ':' + id : KEY);
const stored = id => { try { const d = JSON.parse(localStorage.getItem(keyOf(id)) || 'null'); if (d && Array.isArray(d.folders)) return d; } catch (e) {} return {updated: '', folders: []}; };
/* `updated` says when the folders were last changed by hand; the newer side wins when devices sync. */
let doc = stored('');
/* What came along at signing in, kept until the account's own folders have been seen: [folder, song]
   for each song that sat in a folder, and [folder, ''] for a folder that came along empty. */
const CARRIED = KEY + '-carried:';
let carried = [];
try { open = JSON.parse(localStorage.getItem(OPEN) || '{}') || {}; } catch (e) {}
const keep = () => {
  try {
    localStorage.setItem(keyOf(who), JSON.stringify(doc)); localStorage.setItem(OPEN, JSON.stringify(open));
    if (who) { if (carried.length) localStorage.setItem(CARRIED + who, JSON.stringify(carried)); else localStorage.removeItem(CARRIED + who); }
  } catch (e) {}
};
function changed() {
  doc.updated = new Date().toISOString(); keep(); redraw();
  document.dispatchEvent(new CustomEvent('folders-changed'));
}

const find = name => doc.folders.find(f => f.name === name);
const holder = song => doc.folders.find(f => f.songs.includes(song));
/* Puts what came along at signing in into the folders now showing, where they leave it out. True when that changed anything. */
function place() {
  let any = false;
  for (const [name, song] of carried) {
    if (song && holder(song)) continue;
    let f = find(name);
    if (!f) { doc.folders.push(f = {name, songs: []}); any = true; }
    if (song) { f.songs.push(song); any = true; }
  }
  return any;
}
/* Turns to the folders of an account, or with '' to the ones made while signed out. `moved` is
   given when someone has just signed in: the songs that came over to the account from before,
   each one's name before and after. The folders made while signed out come over with them. They
   are shown at once, and count as a change made here only once the account's own folders have
   been seen (replace or settle), so folders made on another device are never written over by a
   device that has just signed in. */
export function use(id, moved) {
  who = id || '';
  doc = stored(who);
  carried = [];
  if (who) {
    try { const c = JSON.parse(localStorage.getItem(CARRIED + who) || '[]'); if (Array.isArray(c)) carried = c.filter(p => Array.isArray(p) && typeof p[0] === 'string' && typeof p[1] === 'string'); } catch (e) {}
    if (moved) {
      for (const f of stored('').folders) {
        const songs = f.songs.filter(song => song in moved).map(song => moved[song]);
        if (songs.length) for (const song of songs) carried.push([f.name, song]); else carried.push([f.name, '']);
      }
      try { localStorage.removeItem(KEY); } catch (e) {}
    }
    place();
    keep();
  }
  redraw();
}
/* What the account keeps, and taking the account's version in its place. */
export const read = () => doc;
export function replace(next) {
  if (!next || !Array.isArray(next.folders)) return;
  doc = {updated: String(next.updated || ''), folders: next.folders.filter(f => f && typeof f.name === 'string').map(f => ({name: tidy(f.name), songs: (f.songs || []).filter(s => typeof s === 'string')}))};
  /* what came along at signing in goes on top of the account's folders, and is then a change made here */
  if (carried.length) { if (place()) doc.updated = new Date().toISOString(); carried = []; }
  keep(); redraw();
}
/* Called when the account's folders have been seen and were not newer: what came along at signing in now counts as a change made here. */
export function settle() {
  if (!carried.length) return;
  place(); doc.updated = new Date().toISOString(); carried = [];
  keep();
}
/* The folders' names in the order they are listed, and the name of the folder a song is in ('' for none). */
export const names = () => doc.folders.map(f => f.name).sort(order.compare);
export const folderOf = song => (holder(song) || {name: ''}).name;
/* Puts a song in a folder, or with '' takes it out of the one it is in. */
export function put(song, folderName) {
  const from = holder(song), to = folderName ? find(folderName) : null;
  if (from === to || (!from && !to)) return;
  if (from) from.songs = from.songs.filter(s => s !== song);
  if (to) to.songs.push(song);
  changed();
  /* the folder that took the song shows it for a moment, since a closed folder stays closed */
  if (to) took(to.name);
}
let rowOfFolder = () => null;
function took(name) {
  const row = rowOfFolder(name);
  if (!row) return;
  row.classList.add('took');
  setTimeout(() => row.classList.remove('took'), 700);
}

/* The list's rows: each folder with its songs under it when open, a row that makes a new folder,
   then the songs in no folder. `rowOf(name)` gives a song's own row, `first` is a row to put ahead
   of the songs in no folder, and `current` is the song on stage: a closed folder holding it is marked. */
export function listHtml(names, rowOf, first = '', current = '') {
  const have = new Set(names), placed = new Set();
  let html = '';
  for (const f of [...doc.folders].sort((a, b) => order.compare(a.name, b.name))) {
    const inside = f.songs.filter(n => have.has(n)).sort(order.compare), isOpen = !!open[f.name];
    for (const n of inside) placed.add(n);
    html += `<li class="fold${isOpen ? ' open' : inside.includes(current) ? ' holds' : ''}" data-folder="${esc(f.name)}"><button type="button" class="pick" aria-expanded="${isOpen}" title="${T.renameTip}"><span class="tw">${CARET}</span><span class="name">${esc(f.name)}</span><span class="dur">${inside.length}</span></button>` +
      `<button type="button" class="ib rm" title="${T.folderRemoveTip}" aria-label="${esc(fill(T.remove, {name: f.name}))}">${X}</button></li>`;
    if (isOpen) html += inside.map(n => rowOf(n).replace('<li class="song"', '<li class="song in"' + DRAG)).join('');
  }
  return html + `<li class="fold new"><button type="button" class="pick"><span class="tw">${PLUS}</span><span class="name">${T.newFolder}</span></button></li>` + first +
    names.filter(n => !placed.has(n)).map(n => rowOf(n).replace('<li class="song"', '<li class="song"' + DRAG)).join('');
}

/* A box in place of a row's name, for naming a new folder or renaming one. */
function ask(li, start, done) {
  const pick = li.querySelector('.pick'), box = Object.assign(document.createElement('input'), {className: 'rename', type: 'text', value: start, spellcheck: false, placeholder: T.folderName});
  box.setAttribute('aria-label', T.folderName);
  pick.hidden = true; li.insertBefore(box, pick);
  let over = false;
  const end = ok => { if (over) return; over = true; const name = tidy(box.value); box.remove(); pick.hidden = false; if (ok && name && name !== start) done(name); };
  box.addEventListener('click', e => e.stopPropagation());
  box.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') end(true); else if (e.key === 'Escape') end(false); });
  box.addEventListener('blur', () => end(true));
  box.focus(); box.select();
}

/* Makes the Songs list answer to folders. `draw` redraws the list. */
export function attach(list, draw) {
  redraw = draw;
  list.addEventListener('click', e => {
    const li = e.target.closest('.fold');
    if (!li || li.querySelector('.rename')) return;
    if (li.classList.contains('new')) {
      ask(li, '', name => { if (!find(name)) { doc.folders.push({name, songs: []}); open[name] = true; changed(); } });
      return;
    }
    const name = li.dataset.folder, rm = e.target.closest('.rm');
    if (!rm) { open[name] = !open[name]; keep(); redraw(); return; }
    if (!rm.classList.contains('sure')) {
      rm.classList.add('sure'); rm.textContent = T.removeConfirm;
      setTimeout(() => { if (rm.isConnected) redraw(); }, 3500);
      return;
    }
    doc.folders = doc.folders.filter(f => f.name !== name); delete open[name]; changed();
  });
  list.addEventListener('contextmenu', e => {
    const li = e.target.closest('.fold');
    if (!li || li.classList.contains('new') || li.querySelector('.rename')) return;
    e.preventDefault();
    const was = li.dataset.folder;
    ask(li, was, name => { const f = find(was); if (f && !find(name)) { f.name = name; open[name] = open[was]; delete open[was]; changed(); } });
  });

  rowOfFolder = name => [...list.querySelectorAll('.fold')].find(f => f.dataset.folder === name);
  /* dragging a song: onto a folder (or a song inside one) puts it there, anywhere else in the list
     takes it out. While a song is in the air the list carries the class "dragging", which also
     tells the app not to redraw the list under it. */
  let dragged = '';
  const target = e => {
    const fold = e.target.closest('.fold:not(.new)');
    if (fold) return fold.dataset.folder;
    const row = e.target.closest('.song.in');
    const f = row && holder(row.dataset.id);
    return f ? f.name : '';
  };
  /* shows where the song would land: the folder's row is lit, or the list is outlined when the song would leave its folder */
  const mark = name => {
    for (const el of list.querySelectorAll('.fold.aim')) el.classList.remove('aim');
    list.classList.toggle('drop-out', !!dragged && !name && !!holder(dragged));
    if (name) { const el = rowOfFolder(name); if (el) el.classList.add('aim'); }
  };
  const settle = () => {
    dragged = ''; mark(''); list.classList.remove('dragging');
    for (const el of list.querySelectorAll('.lifted')) el.classList.remove('lifted');
  };
  list.addEventListener('dragstart', e => {
    const li = e.target.closest('.song[draggable]');
    if (!li) return;
    dragged = li.dataset.id;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', dragged);
    list.classList.add('dragging');
    /* the row dims a moment later, after the picture that follows the pointer has been taken of it */
    setTimeout(() => { if (dragged) li.classList.add('lifted'); });
  });
  /* files dragged in from outside are for the app to add, not for a folder */
  const ours = e => dragged && ![...e.dataTransfer.types].includes('Files');
  /* the list takes the song wherever it is over it. A row says so as the song arrives over it and
     again while it stays, so that letting go straight after crossing onto a folder still lands */
  for (const type of ['dragenter', 'dragover']) list.addEventListener(type, e => { if (!ours(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = 'move'; mark(target(e)); });
  /* the marks go when the song is carried off the list, onto some other part of the window */
  for (const type of ['dragenter', 'dragover']) document.addEventListener(type, e => { if (dragged && !list.contains(e.target)) mark(''); });
  list.addEventListener('drop', e => {
    if (!ours(e)) return;
    e.preventDefault(); e.stopPropagation();
    const song = dragged, to = target(e);
    settle();
    put(song, to);
  });
  list.addEventListener('dragend', settle);
  /* the mouse is not heard from while something is dragged, so hearing from it means the drag is over, however it ended */
  window.addEventListener('mousemove', () => { if (dragged) settle(); }, true);
  document.addEventListener('song-renamed', e => { const f = holder(e.detail.from); if (f) { f.songs = f.songs.map(s => s === e.detail.from ? e.detail.to : s); changed(); } });
}
if (window.desk && window.desk.testing) window.pvFolders = {read, replace, put, use};
