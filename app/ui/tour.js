/* The short tour a person is taken on after the welcome page. A small box stands beside one part of
   the app after another and says what it is for; an outline is drawn round that part. The app
   stays in use throughout: where a stop asks for something to be tried, the tour moves on by
   itself once it has been. Next moves on too, and Skip, which is always in the box, or the Escape
   key, ends the tour at any moment. Both instruments' pages use it. */
import {T, fill} from './strings.js';

const PENDING = 'musicden-tour';
const root = document.documentElement, $ = id => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/* Notes that the tour of an instrument is owed. The welcome page does this as it ends, and the
   page of that instrument begins the tour once it has started. */
export function pend(which) { try { localStorage.setItem(PENDING, which); } catch (e) {} }
/* Begins the tour of this page's instrument, if it is owed. It is offered once. */
export function begin(which) {
  let owed = '';
  try { owed = localStorage.getItem(PENDING); if (owed === which) localStorage.removeItem(PENDING); } catch (e) {}
  if (owed === which && T.tour[which]) start(which);
}

/* The stops of an instrument's tour. `at` gives the part of the app a stop is about: an element,
   or a box in the window's pixels. `say` is its name and the line about it. `arrive` is done on
   reaching the stop. `seen` reads something that changes when the person tries what the stop is
   about; the tour then moves on by itself. */
async function stopsOf(which) {
  const t = T.tour[which], desktop = !!window.desk && !root.classList.contains('web'), touch = matchMedia('(pointer: coarse)').matches;
  const open = id => () => $(id) && $(id).getAttribute('aria-expanded') === 'true';
  const showSongs = () => { if ($('libBtn') && !open('libBtn')()) $('libBtn').click(); };
  if (which === 'piano') {
    const {keysHeight, keysHeld} = await import('./app.js'), listed = () => document.querySelectorAll('#songs .song').length;
    /* the keyboard is the bottom of the picture on stage */
    const keyboard = () => { const r = $('glc').getBoundingClientRect(), h = Math.min(r.height, keysHeight()); return turned() ? {left: r.left, top: r.top, width: h, height: r.height} : {left: r.left, top: r.bottom - h, width: r.width, height: h}; };
    return [
      {at: () => $('play'), say: t.play, seen: () => root.classList.contains('playing')},
      {at: keyboard, say: touch ? t.keysTouch : t.keys, seen: () => keysHeld() > 0},
      {at: () => $('lib'), say: desktop ? t.songs : t.songsWeb, arrive: showSongs, seen: listed},
      desktop && {at: () => $('sheetBtn'), say: t.sheet, seen: open('sheetBtn')},
      {at: () => $('lookBtn'), say: t.settings, seen: open('lookBtn')}
    ].filter(Boolean);
  }
  return [
    {at: () => $('play'), say: t.play, seen: () => $('play') && $('play').getAttribute('aria-label')},
    {at: () => $('tab'), say: t.tab},
    {at: () => $('lib'), say: desktop ? t.songs : t.songsWeb, arrive: showSongs, seen: () => document.querySelectorAll('#songs li').length},
    {at: () => $('editBtn'), say: t.edit, seen: () => $('editBtn') && $('editBtn').getAttribute('aria-pressed')},
    {at: () => $('setBtn'), say: t.settings, seen: open('setBtn')}
  ];
}

/* On a phone held upright the piano's whole page lies on its side. The box and the outline are
   inside the page and turn with it, so places are worked out in the page's own pixels. */
const turned = () => root.classList.contains('turned');
function placeOf(what, page) {
  const r = what.getBoundingClientRect ? what.getBoundingClientRect() : what, a = page.getBoundingClientRect();
  return turned() ? {x: r.top - a.top, y: a.right - (r.left + r.width), w: r.height, h: r.width} : {x: r.left - a.left, y: r.top - a.top, w: r.width, h: r.height};
}

async function start(which) {
  const page = document.querySelector('.app');
  if (!page) return;
  await new Promise(done => {
    const link = Object.assign(document.createElement('link'), {rel: 'stylesheet', href: new URL('tour.css', import.meta.url).href});
    link.onload = link.onerror = done;
    document.head.appendChild(link);
  });
  const stops = await stopsOf(which);
  const ring = document.createElement('div'), box = document.createElement('div');
  ring.className = 'tour-ring';
  box.className = 'tour-box'; box.setAttribute('role', 'dialog');
  box.innerHTML = `<div class="tour-head"><h2 id="tourName"></h2><span class="tour-count" id="tourCount"></span></div><p class="tour-text" id="tourText" aria-live="polite"></p>` +
    `<div class="tour-foot"><button type="button" class="tour-skip" id="tourSkip">${T.tourSkip}</button><button type="button" class="tour-next" id="tourNext"></button></div>`;
  box.setAttribute('aria-labelledby', 'tourName');
  page.append(ring, box);

  let i = -1, was, moving = 0, frame = 0, last = '', over = false;
  function go(n) {
    clearTimeout(moving); moving = 0;
    /* a stop about something this page does not show is passed over */
    for (; n < stops.length; n++) {
      if (stops[n].arrive) stops[n].arrive();
      const el = stops[n].at(), r = el && placeOf(el, page);
      if (r && r.w > 0 && r.h > 0) break;
    }
    if (n >= stops.length) { end(); return; }
    i = n;
    const stop = stops[i];
    was = stop.seen ? stop.seen() : undefined;
    $('tourName').textContent = stop.say[0]; $('tourText').textContent = stop.say[1];
    $('tourCount').textContent = fill(T.tourCount, {n: i + 1, of: stops.length});
    $('tourNext').textContent = i === stops.length - 1 ? T.tourDone : T.tourNext;
    ring.classList.remove('tour-did');
    /* the words come up afresh at each stop */
    box.classList.remove('tour-fresh'); void box.offsetWidth; box.classList.add('tour-fresh');
    last = '';
  }
  function end() {
    if (over) return;
    over = true;
    clearTimeout(moving); cancelAnimationFrame(frame);
    window.removeEventListener('keydown', keys, true);
    ring.classList.add('tour-off'); box.classList.add('tour-off');
    setTimeout(() => { ring.remove(); box.remove(); }, 260);
  }
  /* Keeps the outline round its part of the app and the box beside it, wherever that part now is:
     under it if there is room, else over it, else to one side. Looks, too, for the person having
     tried what the stop is about. */
  function follow() {
    frame = requestAnimationFrame(follow);
    const stop = stops[i], el = stop && stop.at();
    if (!el) return;
    const r = placeOf(el, page), W = page.clientWidth, H = page.clientHeight, bw = box.offsetWidth, bh = box.offsetHeight;
    /* round a small part the outline stands a little off it; a part that fills its side of the window is outlined just inside its edge */
    const out = r.w > 200 && r.h > 200 ? -4 : 4;
    const fits = (x, y) => x >= 8 && y >= 8 && x + bw <= W - 8 && y + bh <= H - 8;
    const across = clamp(r.x + r.w / 2 - bw / 2, 8, W - bw - 8), down = clamp(r.y + Math.min(r.h / 2, 70) - bh / 2, 8, H - bh - 8);
    const [x, y] = [[across, r.y + r.h + 12], [across, r.y - bh - 12], [r.x + r.w + 12, down], [r.x - bw - 12, down]].find(p => fits(p[0], p[1])) || [across, clamp(r.y + r.h / 2 - bh / 2, 8, H - bh - 8)];
    const now = [r.x, r.y, r.w, r.h, x, y].map(Math.round).join(',');
    if (now !== last) {
      last = now;
      ring.style.transform = `translate(${Math.round(r.x - out)}px,${Math.round(r.y - out)}px)`;
      ring.style.width = Math.round(r.w + out * 2) + 'px'; ring.style.height = Math.round(r.h + out * 2) + 'px';
      box.style.transform = `translate(${Math.round(x)}px,${Math.round(y)}px)`;
      /* the first time, both appear in their places; from then on they glide from one place to the next */
      if (!box.classList.contains('tour-on')) { void box.offsetWidth; ring.classList.add('tour-on'); box.classList.add('tour-on'); }
    }
    if (stop.seen && !moving && stop.seen() !== was) {
      ring.classList.add('tour-did');
      const here = i;
      moving = setTimeout(() => { moving = 0; if (!over && i === here) go(i + 1); }, 1100);
    }
  }
  function keys(e) {
    if (e.key !== 'Escape') return;
    e.stopPropagation(); e.preventDefault(); end();
  }
  box.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.id === 'tourSkip') end(); else go(i + 1);
  });
  window.addEventListener('keydown', keys, true);
  go(0);
  if (!over) frame = requestAnimationFrame(follow);
}
