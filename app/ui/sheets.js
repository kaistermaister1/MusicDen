/* Sheet music saved as PDF. The Songs panel can be switched to list the sheets saved from Settings
   on a computer; one picked there opens its pages in place of the stage, to scroll through. For
   someone signed in the saved sheets are kept in the account (account.js), so a phone lists and
   opens them too. They can be grouped into folders, as the songs can. */
import {T, fill} from './strings.js';
import {ICON, esc} from './inspector.js';
import {renaming} from './rename.js';
import * as folders from './folders.js';

const desk = window.desk, $ = id => document.getElementById(id);
const lib = $('lib'), head = lib.querySelector('.lib-head'), stageEl = $('stage'), root = document.documentElement;
const shelf = folders.sheets, web = root.classList.contains('web');
let showing = false, list = [], open = '', urls = [], later = 0;
/* Tells the account that the saved sheets on this device have changed. */
const changed = () => document.dispatchEvent(new CustomEvent('sheets-changed'));

if (desk.sheet && desk.sheet.printed) {
  /* the panel's title is a switch between its lists; it is made here when nothing else has made it */
  if (!$('libKind')) {
    $('libTitle').hidden = true;
    head.insertAdjacentHTML('afterbegin', `<div class="seg" role="radiogroup" id="libKind" aria-label="${T.songs}"><button type="button" role="radio" data-kind="songs" aria-checked="true">${T.songs}</button></div>`);
  }
  $('libKind').insertAdjacentHTML('beforeend', `<button type="button" role="radio" data-kind="sheets" aria-checked="false">${T.sheets}</button>`);
  /* with a third list in the switch, the button beside it keeps to one word */
  $('add').textContent = T.addPick; $('add').setAttribute('aria-label', T.add);
  $('songs').insertAdjacentHTML('afterend', `<ul class="songs" id="sheets" aria-label="${T.sheets}"></ul><p class="lib-note" id="sheetsNote"></p>`);
  $('libKind').addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    showing = b.dataset.kind === 'sheets';
    lib.classList.toggle('show-sheets', showing);
    for (const x of $('libKind').children) x.setAttribute('aria-checked', String(x === b));
    if (showing) refresh();
  });
  shelf.attach($('sheets'), render);
  $('sheets').addEventListener('click', e => {
    const li = e.target.closest('.song');
    if (!li) return;
    const name = li.dataset.name, rm = e.target.closest('.rm');
    if (!rm) { look(name); return; }
    if (!rm.classList.contains('sure')) {
      rm.classList.add('sure'); rm.textContent = T.removeConfirm;
      setTimeout(() => { if (rm.isConnected) render(); }, 3500);
      return;
    }
    if (open === name) shut();
    desk.sheet.unprint(name).then(() => { changed(); return refresh(); }, refresh);
  });
  renaming($('sheets'), li => li.dataset.name, (li, to) => {
    const from = li.dataset.name;
    desk.sheet.rename(from, to).then(() => {
      if (open === from) open = to;
      document.dispatchEvent(new CustomEvent('sheet-renamed', {detail: {from, to}}));
      changed();
      return refresh();
    }, e => { $('sheetsNote').textContent = /taken/.test(String(e && e.message)) ? T.errNameTaken : T.errRename; });
  });
  document.addEventListener('sheet-saved', e => { if (open === e.detail.name) shut(); changed(); refresh(); });
  /* each account has its own saved sheet music, as it has its own songs */
  document.addEventListener('library-opened', () => { shut(); refresh(); });
  document.addEventListener('account-changed', () => render());
  /* a sync may have fetched sheets saved on another device, or removed ones that were removed there */
  document.addEventListener('account-synced', () => refresh());
  /* starting a song puts the pages away */
  for (const id of ['play', 'restart', 'songs']) $(id).addEventListener('click', () => shut(), true);
  refresh();
}

function render() {
  /* a name being typed in the list, or a row being dragged, is not wiped by a redraw: the list is drawn once that is over */
  clearTimeout(later);
  if ($('sheets').querySelector('.rename') || $('sheets').classList.contains('dragging')) { later = setTimeout(render, 250); return; }
  const signedIn = root.classList.contains('signed-in'), sizeOf = new Map(list.map(s => [s.name, s.size]));
  const row = name => `<li class="song" data-id="${esc(name)}" data-name="${esc(name)}"${name === open ? ' aria-current="true"' : ''}><button type="button" class="pick" title="${T.renameTip}"><span class="name">${esc(name)}</span><span class="dur">${Math.max(1, Math.round(sizeOf.get(name) / 1024))} KB</span></button>` +
    `<button type="button" class="ib rm" title="${signedIn ? T.removeSheetTipAccount : T.removeSheetTip}" aria-label="${esc(fill(T.remove, {name}))}">${ICON.x}</button></li>`;
  $('sheets').innerHTML = shelf.listHtml(list.map(s => s.name), row, '', open);
  $('sheetsNote').textContent = list.length ? '' : !web ? T.sheetsEmpty : signedIn ? T.sheetsEmptyWeb : T.sheetsSignIn;
}
async function refresh() {
  try { list = await desk.sheet.printed(); } catch (e) { list = []; }
  if (open && !list.some(s => s.name === open)) shut();
  render();
}
/* Opens a saved sheet's pages over the stage, after asking the piece on stage to stop. */
async function look(name) {
  document.dispatchEvent(new CustomEvent('stage-quiet'));
  let pages;
  try { pages = await desk.sheet.pages(name); }
  catch (e) { $('sheetsNote').textContent = web ? T.errSheetOpen : T.errPdfOpen; return; }
  shut();
  /* the band of sheet music over the stage is put away, so the pages have the room */
  if ($('sheetBtn').getAttribute('aria-expanded') === 'true') $('sheetBtn').click();
  open = name;
  urls = pages.map(svg => URL.createObjectURL(new Blob([svg], {type: 'image/svg+xml'})));
  const file = (list.find(s => s.name === name) || {}).file;
  /* on a computer the PDF is a file to be shown in its folder; in a browser it is handed over to keep or print */
  stageEl.insertAdjacentHTML('beforeend', `<div class="pages" id="pages" tabindex="0" aria-label="${esc(name)}"><div class="bar2"><button type="button" class="tb" id="pagesShow">${desk.sheet.download ? T.downloadPdf : T.showFile}</button><button type="button" class="tb" id="pagesClose">${T.closeSheet}</button></div>` +
    urls.map((u, i) => `<img src="${u}" alt="${esc(fill(i ? T.pagesN : T.pages1, {n: i + 1}))}">`).join('') + `</div>`);
  $('pagesClose').addEventListener('click', shut);
  $('pagesShow').addEventListener('click', () => { if (desk.sheet.download) desk.sheet.download(name).catch(() => {}); else if (file) desk.sheet.show(file); });
  $('pages').focus();
  render();
}
function shut() {
  const p = $('pages');
  if (p) p.remove();
  urls.forEach(u => URL.revokeObjectURL(u)); urls = [];
  if (open) { open = ''; render(); }
}
if (desk.testing) window.pvSheets = {refresh, look, shut, get list() { return list; }, get open() { return open; }};
