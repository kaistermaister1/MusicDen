/* What a mouse does by right-click, drag and the small remove button, a finger does from a menu.
   In the phone layout every row in the Songs panel's lists ends with a "more" button; tapping it,
   or pressing and holding the row, opens a short menu under the row: rename it, move a song or a
   saved sheet into a folder or out of one, remove it. Each choice hands on to what the list already does for a
   mouse, so both ways of working stay the same underneath. */
import {T, fill} from './strings.js';
import {esc} from './inspector.js';
import * as folders from './folders.js';

const lib = document.getElementById('lib'), root = document.documentElement;
const DOTS = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 6.6a1.4 1.4 0 110 2.8 1.4 1.4 0 010-2.8zm5 0a1.4 1.4 0 110 2.8 1.4 1.4 0 010-2.8zm5 0a1.4 1.4 0 110 2.8 1.4 1.4 0 010-2.8z"/></svg>';
const rows = 'li.song, li.fold:not(.new)';
/* the lists whose rows can be put in folders, and each one's folders */
const shelves = {songs: folders.songs, sheets: folders.sheets};

/* every row gets its button, again whenever a list is redrawn */
function dress() {
  for (const li of lib.querySelectorAll(rows)) {
    if (li.querySelector('.more')) continue;
    li.insertAdjacentHTML('beforeend', `<button type="button" class="ib more" aria-haspopup="menu" aria-label="${T.more}">${DOTS}</button>`);
  }
}
new MutationObserver(dress).observe(lib, {childList: true, subtree: true});
dress();

/* `under` is the list the menu's row is in, and `at` how far that list was scrolled when the menu opened. */
let menu = null, held = null, under = null, at = 0;
function close() {
  if (menu) menu.remove();
  if (held) held.classList.remove('held');
  menu = held = under = null;
}
/* Which row a row is, and the row that is it now: a list is redrawn whenever it changes, so the row
   a finger went down on, or a menu was opened for, may have been replaced by a new one since. */
const which = li => ({list: li.parentElement.id, name: li.dataset.id || li.dataset.name || li.dataset.folder, fold: li.classList.contains('fold')});
const now = w => [...lib.querySelectorAll(rows)].find(x => { const v = which(x); return v.list === w.list && v.name === w.name && v.fold === w.fold; });

function open(li) {
  close();
  const list = li.parentElement, row = which(li), shelf = shelves[row.list], song = shelf && !row.fold ? row.name : '', builtIn = song.startsWith(':');
  const items = [];
  /* renaming is the list's own answer to a right-click on the row */
  if (!builtIn) items.push([T.renameIt, row => row.dispatchEvent(new MouseEvent('contextmenu', {bubbles: true, cancelable: true}))]);
  if (song && !builtIn) {
    const inside = shelf.folderOf(song);
    for (const name of shelf.names()) if (name !== inside) items.push([fill(T.moveTo, {folder: name}), () => shelf.put(song, name)]);
    if (inside) items.push([fill(T.takeOut, {folder: inside}), () => shelf.put(song, '')]);
  }
  /* removing shows the row's own button asking once more */
  if (li.querySelector('.rm')) items.push([T.removeConfirm, row => row.querySelector('.rm').click()]);
  if (!items.length) return;
  held = li; li.classList.add('held');
  menu = document.createElement('div');
  menu.className = 'more-menu'; menu.setAttribute('role', 'menu');
  menu.innerHTML = items.map(([text], i) => `<button type="button" role="menuitem" data-i="${i}">${esc(text)}</button>`).join('');
  menu.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    const there = now(row), run = items[+b.dataset.i][1];
    close();
    if (there) run(there);
  });
  lib.appendChild(menu);
  under = list; at = list.scrollTop;
  /* under the row, or above it when there is no room below; the panel's own measures hold whichever way the phone is turned */
  const top = li.offsetTop - list.scrollTop, below = top + li.offsetHeight;
  menu.style.top = Math.max(4, below + menu.offsetHeight + 4 <= lib.clientHeight ? below : Math.min(top - menu.offsetHeight, lib.clientHeight - menu.offsetHeight - 4)) + 'px';
}

/* the button opens the menu, or closes it when it is already open for that row */
lib.addEventListener('click', e => {
  const b = e.target.closest('.more');
  if (!b) return;
  e.stopPropagation();
  const li = b.closest('li');
  if (held === li) close(); else open(li);
}, true);

/* pressing and holding a row with a finger opens it too */
let timer = 0, from = null, lifted = 0;
const letGo = () => { clearTimeout(timer); timer = 0; };
lib.addEventListener('pointerdown', e => {
  letGo();
  if (lifted === Infinity) lifted = 0;
  if (e.pointerType === 'mouse' || !root.classList.contains('compact')) return;
  const li = e.target.closest(rows);
  if (!li || e.target.closest('.rm, .more, .rename, .more-menu')) return;
  from = [e.clientX, e.clientY];
  const row = which(li);
  timer = setTimeout(() => { timer = 0; const there = now(row); if (there) { lifted = Infinity; open(there); } }, 500);
});
lib.addEventListener('pointermove', e => { if (timer && Math.hypot(e.clientX - from[0], e.clientY - from[1]) > 10) letGo(); });
for (const type of ['pointerup', 'pointercancel']) lib.addEventListener(type, () => { letGo(); if (lifted === Infinity) lifted = Date.now(); });
/* scrolling puts the menu away, since it would no longer sit by its row. Word of a scroll that ended
   just before the menu opened can come after it: the list is then where it was, and the menu stays */
lib.addEventListener('scroll', e => { letGo(); if (menu && e.target === under && under.scrollTop === at) return; close(); }, true);
/* the finger coming up after a hold is not a tap on the row, and a phone's own long-press menu stays out of it */
lib.addEventListener('click', e => { if ((lifted === Infinity || Date.now() - lifted < 400) && !e.target.closest('.more-menu')) { e.stopPropagation(); e.preventDefault(); } }, true);
lib.addEventListener('contextmenu', e => { if (e.isTrusted && (menu || e.pointerType === 'touch' || e.pointerType === 'pen')) { e.preventDefault(); e.stopPropagation(); } }, true);

/* a tap anywhere else, or Escape, puts the menu away */
document.addEventListener('pointerdown', e => { if (menu && !e.target.closest('.more-menu, .more')) close(); }, true);
document.addEventListener('keydown', e => { if (menu && e.key === 'Escape') close(); });
