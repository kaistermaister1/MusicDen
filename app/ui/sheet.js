/* The sheet music band: the song's hands engraved as one long line of staves, a marker that
   follows playback, and measures that can be clicked to go there. */
import {T} from './strings.js';
import {buildMidi} from './midi.js';
import {isFreeTime, findBeats, strokes, beatAt, timeAt} from './beats.js';

const STAFF_SPACE = 6.5;   /* screen pixels between two staff lines */
const MOST = 0.45;         /* the band's largest share of the height below the top strip */
const PAD = 8;             /* pixels kept clear beside the pinned clefs and at the band's right edge */
const SETTLE = 700;        /* milliseconds after the last moved note before the line is engraved again */
const RECENT = 8;          /* engraved lines kept in memory, so undoing a change or going back to a song shows its line at once */

/* What stands for a file handed to the engraver: the same notes on the same staves always give
   the same key, and any other file a different one. */
async function keyOf(job) {
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', job.midi));
  return job.staves + '-' + Array.from(hash, b => b.toString(16).padStart(2, '0')).join('');
}

/* The song as a plain MIDI file for the engraver: the meter in a first track, then one track
   for each hand that has notes, the higher hand first, so every hand gets a staff of its own.
   Each hand's track opens with the song's first key signature, which is where MuseScore looks
   for it; a song without one gets a key MuseScore picks from the notes.
   A song with all its notes in one track has no hands to go by. `right` then says which notes
   the right hand plays, a '1' or '0' for each of the piece's notes in order; without it the
   notes from middle C up go on the upper staff and the rest on the lower one.
   Tempo is left out, so no tempo marks are printed over the staff. The engraver then counts time
   at a steady 120 beats a minute, and `timeOf` turns such a time into the piece's own seconds.
   `free` is what findBeats made of a piece played in free time; such a piece is written by
   those beats instead of by the ticks of its file. */
export function handsMidi(piece, right, free) {
  const src = piece.source, division = src.division;
  /* A file timed in frames has no beats; without beats found for it, its notes are written 960
     ticks to the second, which at 120 beats a minute and 480 ticks a beat keeps every time as it is. */
  const framed = (division & 0x8000) !== 0;
  const conductor = [];
  let key = null;
  if (!framed) {
    const marks = [], seen = new Set();
    for (const tr of src.tracks) for (const ev of tr.events) if (ev.status === 0xff && (ev.type === 0x58 || ev.type === 0x59)) marks.push(ev);
    marks.sort((a, b) => a.tick - b.tick);
    for (const ev of marks) {
      /* Only the first key signature is kept, so the clefs and key pinned at the left stay true
         for the whole line; later keys show as accidentals on the notes. */
      if (ev.type === 0x59) { if (!key) key = {tick: 0, data: [...ev.raw]}; continue; }
      const id = ev.tick + ':' + ev.raw.join(',');
      if (free || seen.has(id)) continue;
      seen.add(id);
      conductor.push({tick: ev.tick, data: [...ev.raw]});
    }
  }
  const sums = piece.tracks.map(() => [0, 0]);
  for (const n of piece.notes) { sums[n.track][0] += n.midi; sums[n.track][1]++; }
  const order = sums.map((s, i) => i).filter(i => sums[i][1]).sort((a, b) => sums[b][0] / sums[b][1] - sums[a][0] / sums[a][1]);
  const divided = order.length !== 1 ? '' : right ? 'script' : 'middle';
  const upper = (n, i) => right ? right[i] === '1' : n.midi >= 60;
  const groups = divided ? [piece.notes.filter(upper), piece.notes.filter((n, i) => !upper(n, i))].filter(g => g.length) : order.map(track => piece.notes.filter(n => n.track === track));
  const open = () => key ? [key, {tick: 0, data: [0xc0, 0]}] : [{tick: 0, data: [0xc0, 0]}];
  if (free) return {...byBeats(piece, groups, free, open), staves: groups.length, order, divided, free: {time: free.dotted ? free.bar * 3 + '/8' : free.bar + '/4', tempo: 60 / (free.pace * free.group)}};
  const hands = groups.map(notes => {
    const evs = open();
    for (const n of notes) {
      const on = framed ? Math.round(n.start * 960) : n.on.tick, off = framed ? Math.max(on + 1, Math.round(n.end * 960)) : n.off.tick;
      evs.push({tick: on, data: [0x90, n.midi, Math.max(1, n.on.b)]}, {tick: off, data: [0x80, n.midi, 0]});
    }
    return evs;
  });
  const timeOf = framed ? s => s : s => src.toSec(s * 2 * division);
  return {midi: buildMidi(framed ? 480 : division, [conductor, ...hands]), staves: hands.length, order, divided, timeOf, free: null};
}

const QUARTER = 480;       /* ticks to a quarter note in a file written by beats */
/* The ways a quick beat may be cut to hold the strokes inside it, the simplest first, each with
   what choosing it costs; a beat that divides in three has its own list. */
const CUTS = {2: [[1, 0], [2, 0.004], [4, 0.010], [3, 0.012], [6, 0.022], [8, 0.030]], 3: [[1, 0], [3, 0.004], [6, 0.012], [2, 0.016], [4, 0.030]]};

/* A free-time piece written by the beats found in it (see findBeats). Every stroke is put on the
   simplest cut of its quick beat that fits the strokes in that beat, so notes struck together
   stand together in both hands. A note lasts to the nearest sixteenth, and never past the next
   stroke in its own hand, which keeps each hand to a single line of chords and rests.
   The file starts with enough rest for the first measure to begin on a bar line. */
function byBeats(piece, groups, free, open) {
  const unit = (free.dotted ? QUARTER * 1.5 : QUARTER) / free.group, span = free.bar * free.group;
  const shift = (span - (free.lead + free.first * free.group) % span) % span, sixteenth = QUARTER / 4 / unit;
  const list = strokes(piece.notes), place = list.map(s => beatAt(free.beats, s.t) + shift), within = new Map(), at = new Map();
  place.forEach((p, i) => { const b = Math.floor(p + 0.06); if (!within.has(b)) within.set(b, []); within.get(b).push(i); });
  for (const [b, ids] of within) {
    let best = null;
    for (const [n, cost] of CUTS[free.parts]) {
      let miss = cost * ids.length;
      const spots = ids.map(i => { const x = Math.round((place[i] - b) * n) / n; miss += (place[i] - b - x) ** 2; return b + x; });
      /* two strokes pressed onto one spot is a poor fit */
      miss += 0.05 * (ids.length - new Set(spots).size);
      if (!best || miss < best.miss) best = {miss, spots};
    }
    ids.forEach((i, k) => { for (const n of list[i].notes) at.set(n, best.spots[k]); });
  }
  const hands = groups.map(notes => {
    const spots = [...new Set(notes.map(n => at.get(n)))].sort((a, b) => a - b), evs = open();
    for (const n of notes) {
      const from = at.get(n), next = spots[spots.indexOf(from) + 1] ?? Infinity;
      const end = Math.min(next, Math.max(from + sixteenth, Math.round((beatAt(free.beats, n.end) + shift) / sixteenth) * sixteenth));
      const on = Math.round(from * unit);
      evs.push({tick: on, data: [0x90, n.midi, Math.max(1, Math.round(n.vel * 127))]}, {tick: Math.max(on + 1, Math.round(end * unit)), data: [0x80, n.midi, 0]});
    }
    return evs;
  });
  const meter = free.dotted ? [0xff, 0x58, 4, free.bar * 3, 3, 36, 8] : [0xff, 0x58, 4, free.bar, 2, 24, 8];
  return {midi: buildMidi(QUARTER, [[{tick: 0, data: meter}], ...hands]), timeOf: s => timeAt(free.beats, s * 2 * QUARTER / unit - shift)};
}

/* One of MuseScore's position lists: a box for each element, then a time for each. Returns
   {x, w, page, t} in the order the times are listed, x and w in the list's own units and t in
   the piece's seconds. */
function placed(xml, timeOf) {
  const doc = new DOMParser().parseFromString(xml, 'application/xml'), boxes = new Map(), out = [];
  for (const el of doc.querySelectorAll('element')) boxes.set(el.getAttribute('id'), {x: +el.getAttribute('x'), w: +el.getAttribute('sx'), page: +el.getAttribute('page')});
  for (const ev of doc.querySelectorAll('event')) {
    const box = boxes.get(ev.getAttribute('elid'));
    if (box) out.push({x: box.x, w: box.w, page: box.page, t: timeOf(ev.getAttribute('position') / 1000)});
  }
  return out;
}

/* What a page's picture says about itself: its box, where its staff lines run, the distance
   between two of them, and where the meter is printed after the clefs and key. */
function readPage(svg) {
  const box = (/viewBox="([^"]+)"/.exec(svg) || ['', '0 0 1 1'])[1].trim().split(/[\s,]+/).map(Number);
  let left = Infinity, right = -Infinity;
  const rows = new Set();
  for (const m of svg.matchAll(/class="StaffLines"[^>]*points="([-\d.e+]+),([-\d.e+]+) ([-\d.e+]+),/g)) {
    left = Math.min(left, +m[1]); right = Math.max(right, +m[3]); rows.add(+m[2]);
  }
  const ys = [...rows].sort((a, b) => a - b);
  let gap = Infinity;
  for (let i = 1; i < ys.length; i++) gap = Math.min(gap, ys[i] - ys[i - 1]);
  const meter = /class="TimeSig" transform="matrix\(([^)]+)\)"/.exec(svg);
  return {x: box[0], y: box[1], w: box[2], h: box[3], left, right, top: ys[0], gap, meter: meter ? +meter[1].split(',')[4] : NaN};
}

/* MuseScore draws black on a white page; the band keeps the black and supplies the white itself. */
const inked = svg => svg.replace(/<path class="" fill="#ffffff"[^>]*\/>/, '');

/* MuseScore's answer as pages, measures and note columns. Each page learns how its position
   lists map onto its picture: the first measure starts where the staff lines start and the last
   one ends where they end. */
function readLine(out, timeOf) {
  const pages = out.pages.map(readPage), measures = placed(out.measures, timeOf), columns = placed(out.columns, timeOf);
  pages.forEach((p, i) => {
    const own = measures.filter(m => m.page === i);
    if (!own.length || !isFinite(p.left) || !isFinite(p.gap)) throw new Error('engrave');
    const last = own[own.length - 1];
    p.from = own[0].x;
    p.per = (p.right - p.left) / (last.x + last.w - own[0].x);
  });
  if (!pages.length) throw new Error('engrave');
  return {pages, measures, columns: columns.filter(c => pages[c.page])};
}

export class Sheet {
  /* `seek(t)` moves playback to a time in the piece, `now()` tells where it is, `redraw()` asks for a fresh frame. */
  constructor(el, {seek, now, redraw}) {
    this.el = el; this.seek = seek; this.now = now; this.redraw = redraw;
    this.open = false; this.piece = null; this.stale = true; this.turn = 0; this.timer = 0;
    this.raw = null; this.line = null; this.imgs = []; this.urls = []; this.sent = null; this.drawn = 0;
    this.scroll = 0; this.at = -1; this.over = -1; this.wide = 0; this.split = null; this.beat = null;
    this.song = ''; this.recent = new Map(); this.how = '';
    el.tabIndex = 0; el.setAttribute('role', 'group'); el.setAttribute('aria-label', T.sheet);
    el.innerHTML = '<div class="sheet-line" hidden><div class="sheet-at"></div><div class="sheet-over"></div><div class="sheet-mark"></div></div><div class="sheet-head"></div><p class="sheet-note" role="status"></p>';
    [this.lineEl, this.headEl, this.noteEl] = el.children;
    [this.atEl, this.overEl, this.markEl] = this.lineEl.children;

    new ResizeObserver(() => { this.wide = el.clientWidth; this.redraw(); }).observe(el);
    window.addEventListener('resize', () => this.layout());
    el.addEventListener('pointermove', e => this.hover(this.measureUnder(e)));
    el.addEventListener('pointerleave', () => this.hover(-1));
    el.addEventListener('click', e => { const i = this.measureUnder(e); if (i >= 0) this.seek(this.line.measures[i].t); });
    /* with the band focused, the arrow keys step a measure at a time */
    el.addEventListener('keydown', e => {
      if (!this.line || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
      const ms = this.line.measures, to = Math.max(0, Math.min(ms.length - 1, this.measureAt(this.now()) + (e.key === 'ArrowRight' ? 1 : -1)));
      this.seek(ms[to].t); e.preventDefault();
    });
  }

  setOpen(on) {
    if (on === this.open) return;
    this.open = on; this.el.hidden = !on;
    if (!on) return;
    if (this.stale) this.engrave(); else { this.at = -1; this.redraw(); }
  }
  /* `song` names the piece among the songs, so its engraved line can be kept and found again. */
  setPiece(piece, song = '') {
    this.piece = piece; this.song = song; this.clear(); this.scroll = 0; this.lineEl.style.transform = ''; this.el.classList.remove('turned');
    this.stale = true;
    if (this.open) this.engrave();
  }
  /* Notes have moved between hands: the line is engraved again once the moving stops. */
  changed() {
    this.stale = true;
    clearTimeout(this.timer);
    if (this.open) this.timer = setTimeout(() => this.engrave(), SETTLE);
  }

  say(text) { this.noteEl.textContent = text; }
  /* The beats of a piece played in free time, found once for each piece; null for a piece whose
     notes sit on the grid of its own file. */
  beatsOf(piece) {
    if (!this.beat || this.beat.piece !== piece) this.beat = {piece, found: isFreeTime(piece) ? findBeats(piece.notes) : null};
    return this.beat.found;
  }
  /* Which notes of a one-track piece the right hand plays, as the hand-splitting script sorts
     them: a '1' or '0' for each note, or null when the script could not be run. Asked once for
     each piece. */
  handsOf(piece) {
    if (!this.split || this.split.piece !== piece) {
      this.split = {piece, answer: window.desk.sheet.hands(piece.notes.map(n => [n.start, n.end, n.midi])).catch(() => null)};
    }
    return this.split.answer;
  }
  clear() {
    for (const img of this.imgs) img.remove();
    for (const url of this.urls) URL.revokeObjectURL(url);
    this.headEl.textContent = '';
    this.imgs = []; this.urls = []; this.raw = null; this.line = null; this.at = -1;
    this.lineEl.hidden = true; this.el.style.height = ''; this.hover(-1);
  }

  /* The file for the engraver for the piece as it stands: hands sorted and beats found where the piece needs them. */
  async jobFor(piece) {
    const alone = new Set(piece.notes.map(n => n.track)).size === 1;
    return handsMidi(piece, alone ? await this.handsOf(piece) : null, this.beatsOf(piece));
  }

  /* Shows the piece as it stands as sheet music. A line engraved before from the same notes and
     hands is used again, from memory or from the song's saved file; otherwise MuseScore engraves
     it and the result is saved for next time. The line already on screen stays until the new one
     is ready. `how` says where the line came from: 'recent', 'saved' or 'engraved'. */
  async engrave() {
    clearTimeout(this.timer);
    if (!this.open || !this.piece) { this.stale = true; return; }
    this.stale = false;
    const turn = ++this.turn, desk = window.desk;
    /* nothing on the stage, nothing on the staves */
    if (!this.piece.notes.length) { this.clear(); this.say(''); return; }
    if (!this.line) this.say(T.sheetPreparing);
    try {
      const piece = this.piece, song = this.song, job = await this.jobFor(piece);
      if (turn !== this.turn) return;
      if (desk.testing) this.sent = job;
      const key = await keyOf(job);
      let out = this.recent.get(key), how = 'recent';
      if (!out && song && desk.sheet.saved) { out = await desk.sheet.saved(song, key); how = 'saved'; }
      if (turn !== this.turn) return;
      if (!out) {
        if (!(await desk.sheet.available())) { if (turn === this.turn) { this.clear(); this.say(T.errNoMuseScore); } return; }
        out = await desk.sheet.engrave({midi: job.midi, staves: job.staves}); how = 'engraved';
        if (turn !== this.turn || !out) return;
        if (song && desk.sheet.save) desk.sheet.save(song, key, out).catch(() => {});
      }
      this.recent.delete(key); this.recent.set(key, out);
      if (this.recent.size > RECENT) this.recent.delete(this.recent.keys().next().value);
      const raw = readLine(out, job.timeOf);
      const urls = out.pages.map(svg => URL.createObjectURL(new Blob([inked(svg)], {type: 'image/svg+xml'})));
      const imgs = urls.map(url => { const img = new Image(); img.alt = ''; img.draggable = false; img.src = url; return img; });
      await Promise.all(imgs.map(img => img.decode().catch(() => {})));
      if (turn !== this.turn) { urls.forEach(url => URL.revokeObjectURL(url)); return; }
      this.clear();
      this.raw = raw; this.imgs = imgs; this.urls = urls;
      for (const img of imgs) this.lineEl.insertBefore(img, this.atEl);
      /* a second copy of the first page stays pinned at the left, cut off after the clefs and key */
      const pinned = new Image(); pinned.alt = ''; pinned.draggable = false; pinned.src = urls[0];
      this.headEl.append(pinned);
      this.say('');
      this.drawn++; this.how = how;
      this.layout();
    } catch (e) {
      if (turn === this.turn) { this.clear(); this.say(T.errSheet); }
    }
  }

  /* Works out the line in screen pixels: pages side by side with their top staff lines level,
     scaled so staff lines sit STAFF_SPACE apart, or smaller when the band would grow too tall. */
  layout() {
    const raw = this.raw;
    if (!raw) return;
    const drop = p => p.top - p.y, above = Math.max(...raw.pages.map(drop)), tall = Math.max(...raw.pages.map(p => above - drop(p) + p.h));
    const k = Math.min(STAFF_SPACE / raw.pages[0].gap, Math.max(120, (window.innerHeight - 44) * MOST) / tall);
    let wide = 0;
    const starts = raw.pages.map(p => { const at = wide; wide += Math.round(p.w * k); return at; });
    const px = (page, x) => { const p = raw.pages[page]; return starts[page] + (p.left + (x - p.from) * p.per - p.x) * k; };
    const measures = raw.measures.map(m => ({x0: px(m.page, m.x), x1: px(m.page, m.x + m.w), t: m.t, page: m.page}));
    /* the marker runs through the middle of the note heads, a little right of where each column starts */
    const columns = raw.columns.map(c => ({x: px(c.page, c.x) + 0.6 * raw.pages[0].gap * k, t: c.t, page: c.page})).sort((a, b) => a.t - b.t);
    const ends = raw.pages.map((p, i) => starts[i] + (p.right - p.x) * k);
    const first = raw.pages[0], cut = isFinite(first.meter) ? first.meter - 0.4 * first.gap : first.left;
    this.line = {k, measures, columns, ends, wide, tall: Math.ceil(tall * k), head: Math.max(0, Math.round((cut - first.x) * k))};
    const put = (img, i, left) => {
      const p = raw.pages[i];
      Object.assign(img.style, {left: left + 'px', top: Math.round((above - drop(p)) * k) + 'px', width: p.w * k + 'px', height: p.h * k + 'px'});
    };
    this.imgs.forEach((img, i) => put(img, i, starts[i]));
    put(this.headEl.firstChild, 0, 0);
    this.headEl.style.width = this.line.head + 'px';
    this.lineEl.style.width = wide + 'px'; this.lineEl.hidden = false;
    this.el.style.height = this.line.tall + 'px';
    this.at = -1; this.hover(-1); this.redraw();
  }

  /* Index of the measure sounding at time `t`. */
  measureAt(t) {
    const ms = this.line.measures;
    let lo = 0, hi = ms.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (ms[mid].t <= t) lo = mid; else hi = mid - 1; }
    return lo;
  }
  /* Where the marker stands at time `t`: on a note column as it sounds, gliding to the next one in
     between, and to the end of the staff where the line breaks or the piece ends. */
  xAt(t) {
    const c = this.line.columns;
    if (!c.length) return this.line.measures[0].x0;
    if (t <= c[0].t) return c[0].x;
    let lo = 0, hi = c.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (c[mid].t <= t) lo = mid; else hi = mid - 1; }
    const a = c[lo], b = c[lo + 1];
    const toX = b && b.page === a.page ? b.x : this.line.ends[a.page], toT = b ? b.t : Math.max(this.piece.duration, a.t + 0.01);
    return a.x + (toX - a.x) * Math.min(1, (t - a.t) / (toT - a.t));
  }
  /* Index of the measure under the pointer, or -1 over the pinned clefs or between systems. */
  measureUnder(e) {
    if (!this.line) return -1;
    const inBand = e.clientX - this.el.getBoundingClientRect().left;
    if (this.scroll > 0 && inBand < this.line.head) return -1;
    const x = inBand + this.scroll, ms = this.line.measures;
    let lo = 0, hi = ms.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (ms[mid].x0 <= x) lo = mid; else hi = mid - 1; }
    return x >= ms[lo].x0 && x <= ms[lo].x1 ? lo : -1;
  }
  hover(i) {
    if (i === this.over) return;
    this.over = i;
    this.el.classList.toggle('aim', i >= 0);
    if (i < 0) return;
    const m = this.line.measures[i];
    this.overEl.style.transform = `translateX(${m.x0}px)`; this.overEl.style.width = m.x1 - m.x0 + 'px';
  }

  /* Puts the marker where the piece is at time `t`, tints the measure it is in, and turns the
     line when that measure, or the one after it if both fit, is not wholly in view. A turn puts
     the current measure just right of the pinned clefs. */
  follow(t) {
    const L = this.line;
    if (!this.open || !L) return;
    const W = this.wide || (this.wide = this.el.clientWidth);
    if (!W) return;
    const m = this.measureAt(t), cur = L.measures[m], next = L.measures[m + 1], x = this.xAt(t);
    const both = next && next.x1 - cur.x0 + L.head + PAD * 2 <= W;
    const reach = both ? next.x1 : cur.x1, clear = this.scroll > 0 ? L.head + PAD : 0;
    let scroll = this.scroll;
    if (cur.x0 < scroll + clear - 0.5 || reach > scroll + W + 0.5 || x > scroll + W - PAD) {
      scroll = cur.x0 - L.head - PAD;
      /* a measure wider than the band is followed by the marker instead */
      if (x > scroll + W - PAD) scroll = x - L.head - PAD;
      scroll = Math.round(Math.max(0, Math.min(scroll, L.wide - W)));
    }
    if (scroll !== this.scroll) {
      this.scroll = scroll;
      this.lineEl.style.transform = `translateX(${-scroll}px)`;
      this.el.classList.toggle('turned', scroll > 0);
    }
    this.markEl.style.transform = `translateX(${x.toFixed(1)}px)`;
    if (m !== this.at) {
      this.at = m;
      this.atEl.style.transform = `translateX(${cur.x0}px)`; this.atEl.style.width = cur.x1 - cur.x0 + 'px';
    }
  }
}
