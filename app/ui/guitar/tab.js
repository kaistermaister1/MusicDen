/* The tab: six string lines, fret numbers, bar lines and a playhead, drawn on one canvas as a long
   line that slides sideways. Distance follows the seconds, so the line moves under the playhead at
   one steady pace for the whole song: notes close in time stand close together, and a bar played
   slowly is a wide bar. In edit mode a number can be dragged to another string. */

const DIGITS = '"Segoe UI","Helvetica Neue",Helvetica,Roboto,Arial,sans-serif';
const LABELS = '"IBM Plex Sans Condensed","Arial Narrow",Arial,sans-serif';
const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
/* where the playhead stands, as a share of the width */
const HEAD_AT = 0.35;
/* the share of successive notes on a string that are given room to stand clear of each other */
const PACE_SHARE = 0.85;
/* how far apart chords at the song's usual spacing stand, in heights of a number */
const USUAL_GAP = 1.05;
/* a chord this many seconds or less from a downbeat counts as played on it */
const DOWNBEAT_REACH = 0.07;

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
/* a #rrggbb color let through by the given share */
const sheer = (hex, a) => `rgba(${parseInt(hex.slice(1, 3), 16)},${parseInt(hex.slice(3, 5), 16)},${parseInt(hex.slice(5, 7), 16)},${a})`;

/* The value at v on the line through the points (xs[i], ys[i]); past either end the nearest
   segment is carried on. xs must rise. */
export function interp(xs, ys, v) {
  let lo = 0, hi = xs.length - 1;
  if (hi < 1) return ys.length ? ys[0] : 0;
  if (v >= xs[hi]) lo = hi - 1;
  else if (v > xs[0]) { while (hi - lo > 1) { const m = (lo + hi) >> 1; if (xs[m] <= v) lo = m; else hi = m; } }
  const d = xs[lo + 1] - xs[lo];
  return d ? ys[lo] + (v - xs[lo]) * (ys[lo + 1] - ys[lo]) / d : ys[lo];
}

export class TabView {
  /* on: {scrubStart(), scrub(seconds), scrubEnd(), tap()}; capo: the words for a capo, with {n} */
  constructor(canvas, on, capo) {
    this.c = canvas; this.g = canvas.getContext('2d'); this.on = on; this.capoText = capo;
    this.song = null; this.notes = []; this.beats = []; this.bars = [];
    this.at = [0, 1]; this.ax = [0, 100]; this.t = 0; this.end = 0;
    this.w = 1; this.h = 1; this.sp = 0; this.fs = 0;
    this.look = {bg: '#121212', string: '#77756e', ink: '#ffffff', bar: '#e6e2d6', dim: '#8d897e', accent: '#f0a030',
      size: 1, spacing: 1, lowOnTop: false, barNumbers: true, stringNames: true};
    /* editing: null, or {grab(id), try(id, string) -> {fret} or {why}, drop(id, string)} */
    this.edit = null; this.sel = null; this.ghost = null;
    /* room kept clear above the tab for something drawn over it, in pixels */
    this.headroom = 0;
    new ResizeObserver(() => this.resize()).observe(canvas.parentElement);
    this.resize();
    this.pointer();
  }

  /* Changes colors, sizes and what is shown; anything left out stays as it was. */
  setLook(look) {
    Object.assign(this.look, look);
    this.sp = 0;
    this.resize();
  }

  /* Turns editing on (with what to call) or off (null). */
  setEdit(edit) { this.edit = edit; this.ghost = null; if (!edit) this.sel = null; this.draw(this.t); }

  /* Takes a song as it is saved. Notes struck together, or one after another as a strum, share
     one place along the line. With `keep`, the moment under the playhead stays where it was. */
  setSong(song, keep = false) {
    this.song = song; this.notes = []; this.beats = []; this.end = 0;
    if (song) {
      this.notes = (song.notes || []).filter(n => n.string >= 1 && n.string <= 6 && n.fret != null)
        .map(n => ({id: n.id, start: n.start_s, end: n.end_s, string: n.string, text: String(n.fret)}))
        .sort((a, b) => a.start - b.start);
      let group = -1, prev = -1;
      for (const n of this.notes) {
        if (n.start - prev > 0.035 || n.start - group > 0.1) group = n.start;
        prev = n.start; n.at = group; this.end = Math.max(this.end, n.end);
      }
      /* a number stays lit while its note sounds: until it ends, or the next note on its string begins */
      const next = [];
      for (let i = this.notes.length - 1; i >= 0; i--) {
        const n = this.notes[i], until = next[n.string] == null ? Infinity : next[n.string];
        n.lit = Math.max(n.start + 0.08, Math.min(Math.max(n.end, n.start + 0.15), until));
        next[n.string] = n.start;
      }
      for (const b of song.beats || []) if (!this.beats.length || b.time_s > this.beats[this.beats.length - 1].time_s + 1e-4) this.beats.push(b);
      if (this.beats.length < 2) this.beats = [];
    }
    if (this.sel != null && !this.notes.some(n => n.id === this.sel)) this.sel = null;
    this.layout();
    this.draw(keep ? this.t : 0);
  }

  /* Where a moment of the song stands along the line, in pixels from the song's start. */
  xOf(seconds) { return interp(this.at, this.ax, seconds); }
  /* Where the chord struck at a moment was actually set down (a crowded chord stands a little
     right of its moment), or null when no note starts there. */
  columnX(seconds) {
    const notes = this.notes;
    let lo = 0, hi = notes.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (notes[m].start < seconds) lo = m + 1; else hi = m; }
    let best = null;
    for (const n of [notes[lo - 1], notes[lo]]) if (n && Math.abs(n.start - seconds) <= 0.06 && (!best || Math.abs(n.start - seconds) < Math.abs(best.start - seconds))) best = n;
    return best ? best.x : null;
  }
  /* Where a bar's line stands, or null when the tab has no such bar. */
  barX(number) { const b = this.bars.find(x => x.n === number); return b ? b.x : null; }

  /* Places every note and bar line along the line for the current size of type. A second is given
     enough room that all but the quickest notes on a string stand clear of each other; the same
     room for every second of the song. A bar line stands just before the notes of its downbeat. */
  layout() {
    const fs = this.fs, g = this.g;
    g.font = `300 ${fs}px ${DIGITS}`;
    const widths = new Map();
    /* frets of two digits are drawn a little narrow, so a run of them takes less room */
    const width = text => { if (!widths.has(text)) widths.set(text, g.measureText(text).width * (text.length > 1 ? 0.8 : 1)); return widths.get(text); };
    this.widthOf = width;
    for (const n of this.notes) n.w = width(n.text);
    const zero = g.measureText('0');
    this.dy = ((zero.actualBoundingBoxAscent || fs * 0.7) - (zero.actualBoundingBoxDescent || 0)) / 2;

    /* the room a second needs for each pair of successive notes on a string to stand clear */
    const need = [], last = [];
    for (const n of this.notes) {
      const p = last[n.string];
      if (p) { const d = n.at - p.at; if (d > 1e-3) need.push((p.w / 2 + n.w / 2 + fs * 0.14) / d); }
      last[n.string] = n;
    }
    need.sort((a, b) => a - b);
    const want = need.length ? need[Math.floor((need.length - 1) * PACE_SHARE)] : 0;
    /* and the room it needs for chords at the song's usual spacing to stand well apart */
    const gaps = [];
    for (let i = 1; i < this.notes.length; i++) { const d = this.notes[i].at - this.notes[i - 1].at; if (d > 1e-3) gaps.push(d); }
    gaps.sort((a, b) => a - b);
    const usual = gaps.length ? fs * USUAL_GAP / gaps[gaps.length >> 1] : 0;
    const per = clamp(Math.max(want, usual), fs * 3.2, fs * 8) * this.look.spacing;
    /* seconds to distance: one straight line, so the pace never changes */
    this.at = [0, 1]; this.ax = [0, per];

    /* Each chord stands where its moment falls. One that would print over the number before it
       on a string is set a little to the right, by no more than `give`, and never left of the
       chord before it. */
    const notes = this.notes, give = fs * 0.9, tight = fs * 0.05, on = [], cols = [];
    for (let i = 0; i < notes.length;) {
      let j = i, half = 0; const at = notes[i].at, home = at * per; let x = home;
      for (; j < notes.length && notes[j].at === at; j++) {
        const n = notes[j], p = on[n.string];
        if (p) x = Math.max(x, p.x + p.w / 2 + n.w / 2 + tight);
        half = Math.max(half, n.w / 2);
      }
      x = Math.min(x, home + give);
      if (cols.length) x = Math.max(x, cols[cols.length - 1].x + fs * 0.1);
      for (let k = i; k < j; k++) { notes[k].x = x; on[notes[k].string] = notes[k]; }
      cols.push({at, x, half});
      i = j;
    }

    /* A bar line goes just left of the chord played on its downbeat, or at the downbeat's own
       moment when nothing is played there; where the chord before is close, halfway between. */
    this.bars = [];
    let c = 0;
    for (const b of this.beats) {
      if (!b.downbeat) continue;
      const t = b.time_s, air = fs * 0.22;
      while (c + 1 < cols.length && Math.abs(cols[c + 1].at - t) <= Math.abs(cols[c].at - t)) c++;
      if (!cols.length || Math.abs(cols[c].at - t) > DOWNBEAT_REACH) { this.bars.push({x: t * per - air, n: b.bar}); continue; }
      const left = cols[c].x - cols[c].half, before = c ? cols[c - 1].x + cols[c - 1].half : -Infinity;
      this.bars.push({x: left - before < air * 2 ? (left + before) / 2 : left - air, n: b.bar});
    }
  }

  resize() {
    const box = this.c.parentElement.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
    this.w = Math.max(1, Math.round(box.width)); this.h = Math.max(1, Math.round(box.height));
    this.c.width = Math.round(this.w * dpr); this.c.height = Math.round(this.h * dpr);
    this.g.setTransform(dpr, 0, 0, dpr, 0, 0);
    /* the lines are spaced to suit the room there is, and the numbers are as tall as the spacing allows */
    const sp = clamp(Math.min((this.h - this.headroom) / 9, this.w / 12), 18, 44) * this.look.size;
    if (Math.abs(sp - this.sp) > 0.01) { this.sp = sp; this.fs = sp * 0.94; this.layout(); }
    this.draw(this.t);
  }

  /* the top string line, the playhead, and how far the line has slid, for the moment t */
  frameOf(t) {
    const top = Math.round(this.headroom + (this.h - this.headroom - 5 * this.sp) / 2), head = Math.round(this.w * HEAD_AT);
    return {top, head, off: interp(this.at, this.ax, t) - head};
  }
  /* the height of a string's line; the low E can be drawn on top */
  rowOf(string, top) { return Math.round(top + (this.look.lowOnTop ? 6 - string : string - 1) * this.sp); }
  /* the string whose line is nearest a height */
  stringAt(y) {
    const {top} = this.frameOf(this.t), k = clamp(Math.round((y - top) / this.sp), 0, 5);
    return this.look.lowOnTop ? 6 - k : k + 1;
  }
  /* the number under a point of the canvas, if any */
  noteAt(x, y) {
    const {top, off} = this.frameOf(this.t), reach = this.sp * 0.5;
    let best = null, near = Infinity;
    for (const n of this.notes) {
      const dx = Math.abs(n.x - off - x), dy = Math.abs(this.rowOf(n.string, top) - y);
      if (dx <= n.w / 2 + 8 && dy <= reach && dx + dy < near) { best = n; near = dx + dy; }
    }
    return best;
  }

  /* One frame, with the given moment of the song under the playhead. */
  draw(t) {
    this.t = t;
    const g = this.g, W = this.w, H = this.h, sp = this.sp, fs = this.fs, L = this.look;
    g.fillStyle = L.bg; g.fillRect(0, 0, W, H);
    if (!this.song) return;
    const {top, head, off} = this.frameOf(t);
    const row = s => this.rowOf(s, top);

    g.fillStyle = L.string;
    for (let s = 1; s <= 6; s++) g.fillRect(0, row(s), W, 1);

    g.textAlign = 'center'; g.textBaseline = 'alphabetic';
    const small = Math.max(10, Math.round(fs * 0.36));
    g.font = `500 ${small}px ${LABELS}`;
    for (const b of this.bars) {
      const x = Math.round(b.x - off);
      if (x < -4 || x > W + 4) continue;
      g.fillStyle = L.bar; g.fillRect(x - 1, top, 2, 5 * sp + 1);
      if (b.n != null && L.barNumbers) { g.fillStyle = L.dim; g.fillText(String(b.n), x, top - Math.round(sp * 0.4)); }
    }

    /* the notes in view: first a patch that breaks the string line behind each number */
    const notes = this.notes, from = off - fs * 2, to = off + W + fs * 2, ghost = this.ghost;
    let lo = 0, hi = notes.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (notes[m].x < from) lo = m + 1; else hi = m; }
    g.fillStyle = L.bg;
    for (let i = lo; i < notes.length && notes[i].x <= to; i++) {
      const n = notes[i];
      g.fillRect(n.x - off - n.w / 2 - 3, row(n.string) - fs * 0.42, n.w + 6, fs * 0.84);
    }
    g.fillStyle = sheer(L.accent, 0.24);
    g.fillRect(head - fs * 0.55, top - sp * 0.8, fs * 1.1, 5 * sp + sp * 1.6);
    g.font = `300 ${fs}px ${DIGITS}`;
    for (let i = lo; i < notes.length && notes[i].x <= to; i++) {
      const n = notes[i], lifted = ghost && ghost.note === n && ghost.text != null && ghost.string !== n.string;
      g.fillStyle = lifted ? sheer(L.ink, 0.25) : t >= n.start - 0.005 && t < n.lit ? L.accent : L.ink;
      g.fillText(n.text, n.x - off, row(n.string) + this.dy, n.w);
      if (this.edit && n.id === this.sel && !lifted) {
        g.strokeStyle = L.accent; g.lineWidth = 1.5;
        g.strokeRect(Math.round(n.x - off - n.w / 2 - 5) + 0.5, Math.round(row(n.string) - fs * 0.5) + 0.5, Math.round(n.w + 10), Math.round(fs));
      }
    }
    /* a number being dragged, shown on the string it is held over with the fret it would take */
    if (ghost && ghost.text != null && ghost.string !== ghost.note.string) {
      const w = this.widthOf(ghost.text), x = ghost.note.x - off, y = row(ghost.string);
      g.fillStyle = L.bg; g.fillRect(x - w / 2 - 3, y - fs * 0.42, w + 6, fs * 0.84);
      g.fillStyle = L.accent; g.fillText(ghost.text, x, y + this.dy, w);
      g.strokeStyle = L.accent; g.lineWidth = 1.5;
      g.strokeRect(Math.round(x - w / 2 - 5) + 0.5, Math.round(y - fs * 0.5) + 0.5, Math.round(w + 10), Math.round(fs));
    }

    /* the name of each open string stays at the left edge, and the capo above them when there is one */
    const tuning = this.song.tuning || [], edge = Math.round(fs * 0.95);
    if (L.stringNames) {
      g.fillStyle = L.bg; g.fillRect(0, top - sp / 2, edge, 5 * sp + sp);
      g.font = `500 ${Math.max(10, Math.round(fs * 0.42))}px ${LABELS}`;
      g.fillStyle = L.dim;
      const lift = Math.max(10, Math.round(fs * 0.42)) * 0.36;
      for (let s = 1; s <= 6; s++) if (tuning[s - 1] != null) g.fillText(NAMES[((tuning[s - 1] % 12) + 12) % 12], edge / 2, row(s) + lift);
    }
    if (this.song.capo > 0 && this.capoText) {
      g.textAlign = 'left'; g.font = `500 ${small}px ${LABELS}`; g.fillStyle = L.dim;
      g.fillText(this.capoText.replace('{n}', this.song.capo), 8, top - Math.round(sp * 0.9));
    }
    if (this.onDraw) this.onDraw(t);
  }

  /* Dragging the tab moves the song under the playhead; a press that goes nowhere is a tap. In
     edit mode a press on a number picks it up instead: dragged up or down, it moves to the string
     it is let go over. */
  pointer() {
    const c = this.c; let drag = null;
    const at = e => { const box = c.getBoundingClientRect(); return {x: e.clientX - box.left, y: e.clientY - box.top}; };
    c.addEventListener('pointerdown', e => {
      if (e.button) return;
      const p = at(e), hit = this.edit && this.song ? this.noteAt(p.x, p.y) : null;
      if (hit) {
        drag = {id: e.pointerId, note: hit, string: hit.string, moved: false};
        this.sel = hit.id; this.edit.grab(hit.id); this.draw(this.t);
      } else {
        drag = {id: e.pointerId, x: e.clientX, from: interp(this.at, this.ax, this.t), moved: false};
        if (this.edit && this.sel != null) { this.sel = null; this.draw(this.t); }
      }
      try { c.setPointerCapture(e.pointerId); } catch { /* the pointer is already gone */ }
    });
    c.addEventListener('pointermove', e => {
      if (!drag || e.pointerId !== drag.id || !this.song) return;
      if (drag.note) {
        const s = this.stringAt(at(e).y);
        if (s === drag.string) return;
        drag.string = s; drag.moved = true;
        const to = s === drag.note.string ? {} : this.edit ? this.edit.try(drag.note.id, s) : {};
        this.ghost = {note: drag.note, string: s, text: to.fret != null ? String(to.fret) : null};
        this.draw(this.t);
        return;
      }
      const dx = e.clientX - drag.x;
      if (!drag.moved && Math.abs(dx) > 5) { drag.moved = true; c.classList.add('held'); this.on.scrubStart(); }
      if (drag.moved) this.on.scrub(clamp(interp(this.ax, this.at, drag.from - dx), 0, this.end));
    });
    const up = e => {
      if (!drag || e.pointerId !== drag.id) return;
      const d = drag; drag = null; c.classList.remove('held');
      if (d.note) {
        this.ghost = null;
        if (this.edit && e.type === 'pointerup' && d.moved && d.string !== d.note.string) this.edit.drop(d.note.id, d.string);
        this.draw(this.t);
        return;
      }
      if (d.moved) this.on.scrubEnd(); else if (e.type === 'pointerup') this.on.tap();
    };
    c.addEventListener('pointerup', up);
    c.addEventListener('pointercancel', up);
    c.addEventListener('wheel', e => {
      if (!this.song) return;
      e.preventDefault();
      const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      this.on.scrub(clamp(interp(this.ax, this.at, interp(this.at, this.ax, this.t) + d), 0, this.end));
    }, {passive: false});
  }
}
