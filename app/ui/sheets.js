/* Sheet music saved as PDF. The Songs panel can be switched to list the PDFs saved from
   Settings; one picked there opens its pages in place of the stage, to scroll through. */
import {T, fill} from './strings.js';
import {ICON, esc} from './inspector.js';
import {renaming} from './rename.js';

const desk = window.desk, $ = id => document.getElementById(id);
const lib = $('lib'), head = lib.querySelector('.lib-head'), stageEl = $('stage');
let showing = false, list = [], open = '', urls = [];

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
    desk.sheet.unprint(name).then(refresh, refresh);
  });
  renaming($('sheets'), li => li.dataset.name, (li, to) => {
    const from = li.dataset.name;
    desk.sheet.rename(from, to).then(() => { if (open === from) open = to; return refresh(); }, e => { $('sheetsNote').textContent = /taken/.test(String(e && e.message)) ? T.errNameTaken : T.errRename; });
  });
  document.addEventListener('sheet-saved', e => { if (open === e.detail.name) shut(); refresh(); });
  /* each account has its own saved sheet music, as it has its own songs */
  document.addEventListener('library-opened', () => { shut(); refresh(); });
  /* starting a song puts the pages away */
  for (const id of ['play', 'restart', 'songs']) $(id).addEventListener('click', () => shut(), true);
  refresh();
}

function render() {
  $('sheets').innerHTML = list.map(s => `<li class="song" data-name="${esc(s.name)}"${s.name === open ? ' aria-current="true"' : ''}><button type="button" class="pick" title="${T.renameTip}"><span class="name">${esc(s.name)}</span><span class="dur">${Math.max(1, Math.round(s.size / 1024))} KB</span></button>` +
    `<button type="button" class="ib rm" title="${T.removeSheetTip}" aria-label="${esc(fill(T.remove, {name: s.name}))}">${ICON.x}</button></li>`).join('');
  $('sheetsNote').textContent = list.length ? '' : T.sheetsEmpty;
}
async function refresh() {
  try { list = await desk.sheet.printed(); } catch (e) { list = []; }
  render();
}
/* Opens a saved PDF's pages over the stage, after asking the piece on stage to stop. */
async function look(name) {
  document.dispatchEvent(new CustomEvent('stage-quiet'));
  let pages;
  try { pages = await desk.sheet.pages(name); }
  catch (e) { $('sheetsNote').textContent = T.errPdfOpen; return; }
  shut();
  /* the band of sheet music over the stage is put away, so the pages have the room */
  if ($('sheetBtn').getAttribute('aria-expanded') === 'true') $('sheetBtn').click();
  open = name;
  urls = pages.map(svg => URL.createObjectURL(new Blob([svg], {type: 'image/svg+xml'})));
  const file = (list.find(s => s.name === name) || {}).file;
  stageEl.insertAdjacentHTML('beforeend', `<div class="pages" id="pages" tabindex="0" aria-label="${esc(name)}"><div class="bar2"><button type="button" class="tb" id="pagesShow">${T.showFile}</button><button type="button" class="tb" id="pagesClose">${T.closeSheet}</button></div>` +
    urls.map((u, i) => `<img src="${u}" alt="${esc(fill(i ? T.pagesN : T.pages1, {n: i + 1}))}">`).join('') + `</div>`);
  $('pagesClose').addEventListener('click', shut);
  $('pagesShow').addEventListener('click', () => { if (file) desk.sheet.show(file); });
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
