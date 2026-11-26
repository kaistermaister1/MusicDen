/* Sheet music drawn on a canvas: a treble staff with the song's notes, as a band that slides with
   the tab under the same playhead. The same drawing is used for the printed pages. Music symbols
   come from the Bravura typeface (assets/fonts/bravura.woff2). */
import {toScore} from './notation.js';

/* the symbols used, by their place in the typeface */
const G = {
  clef: '', black: '', half: '', whole: '', dot: '',
  sharp: '', flat: '', natural: '',
  flagUp: ['', '', '', '', ''], flagDown: ['', '', '', '', ''],
  rest: {whole: '', half: '', quarter: '', eighth: '', '16th': '', '32nd': '', '64th': ''},
  digit: d => String.fromCharCode(0xE080 + d)
};
/* where the sharps and flats of a key signature sit, in half spaces up from the bottom line */
const SHARP_AT = [8, 5, 9, 6, 3, 7, 4], FLAT_AT = [4, 7, 3, 6, 2, 5, 1];

let font = null;
/* Resolves once the music typeface can be drawn with. */
export function ensureFont() {
  if (!font) {
    const face = new FontFace('Bravura', `url(${new URL('../../assets/fonts/bravura.woff2', import.meta.url)})`);
    font = face.load().then(f => { document.fonts.add(f); return true; }).catch(() => false);
  }
  return font;
}

/* How many staff spaces a score needs above its top line and below its bottom line, so that its
   highest and lowest notes and their stems are not cut off. */
export function staffRoom(score) {
  let lo = 0, hi = 8;
  for (const e of score.events) for (const n of e.notes) { lo = Math.min(lo, n.line); hi = Math.max(hi, n.line); }
  return {above: Math.max(4.5, (hi - 8) / 2 + 5), below: Math.max(4.5, -lo / 2 + 5)};
}

/* How wide the clef, key and time signature are for a staff with spaces of `sp`. */
export function headerWidth(score, sp, withTime = true) {
  return sp * (4.2 + Math.abs(score.key.fifths) * 1.1 + (withTime && score.time ? 2.6 : 0.4));
}

/* Clef, key signature and time signature, starting at x on a staff whose top line is at `top`. */
export function drawHeader(g, score, x, top, sp, ink, withTime = true) {
  const y = line => top + 4 * sp - line * sp / 2;
  g.font = `${4 * sp}px Bravura`; g.textAlign = 'left'; g.textBaseline = 'alphabetic'; g.fillStyle = ink;
  g.fillText(G.clef, x + sp * 0.5, y(2));
  let at = x + sp * 3.6;
  const f = score.key.fifths;
  for (let i = 0; i < Math.abs(f); i++) { g.fillText(f > 0 ? G.sharp : G.flat, at, y(f > 0 ? SHARP_AT[i] : FLAT_AT[i])); at += sp * 1.1; }
  if (withTime && score.time) {
    at += sp * 0.5;
    g.textAlign = 'center';
    const put = (n, line) => g.fillText(String(n).split('').map(d => G.digit(+d)).join(''), at + sp * 0.9, y(line));
    put(score.time.num, 6); put(score.time.den, 2);
    g.textAlign = 'left';
  }
}

/* Draws the notes of a score on a staff. o: {top (y of the top staff line), sp (one staff space),
   x(event) -> where it stands or null to leave it out, barX(index) -> where the bar's opening line
   stands or null, endX (the closing line, or null), ink, bar (colour of bar lines), accent,
   lit(event) -> whether it is sounding now}. */
export function drawScore(g, score, o) {
  const {top, sp} = o, y = line => top + 4 * sp - line * sp / 2;
  g.font = `${4 * sp}px Bravura`; g.textAlign = 'left'; g.textBaseline = 'alphabetic';
  const wide = ch => g.measureText(ch).width;
  const headW = {whole: wide(G.whole), half: wide(G.half), black: wide(G.black)};
  const stemT = Math.max(1, sp * 0.13), accW = {sharp: wide(G.sharp), flat: wide(G.flat), natural: wide(G.natural)};

  /* bar lines */
  g.fillStyle = o.bar || o.ink;
  score.bars.forEach((b, i) => { const x = i ? o.barX(i) : null; if (x != null) g.fillRect(Math.round(x), top, 1, 4 * sp + 1); });
  if (o.endX != null) g.fillRect(Math.round(o.endX), top, 1, 4 * sp + 1);

  /* where each note stands, and its stem */
  const at = new Map();
  for (const e of score.events) {
    const x = o.x(e);
    if (x == null) continue;
    if (e.rest) { at.set(e, {x}); continue; }
    let lo = Infinity, hi = -Infinity;
    for (const n of e.notes) { lo = Math.min(lo, n.line); hi = Math.max(hi, n.line); }
    const hw = e.type === 'whole' ? headW.whole : e.type === 'half' ? headW.half : headW.black, up = e.stemUp;
    const reach = sp * (3.5 + Math.max(0, e.flags - 2) * 0.8);
    let end = up ? y(hi) - reach : y(lo) + reach;
    if (!score.twoVoices) end = up ? Math.min(end, y(4)) : Math.max(end, y(4));
    at.set(e, {x, hw, up, lo, hi, stemX: up ? x + hw / 2 - stemT / 2 : x - hw / 2 + stemT / 2, from: up ? y(lo) : y(hi), end});
  }

  /* beams: one straight bar across the stems of a run, leaning with it but never steeply, and
     far enough out that no stem is cut short; shorter values get further bars between them */
  const thick = sp * 0.5, step = sp * 0.75;
  for (const run of score.beams) {
    const m = run.map(e => at.get(e));
    if (m.some(p => !p)) continue;
    const a = m[0], z = m[m.length - 1], up = a.up, dx = z.stemX - a.stemX;
    const slope = dx > 0 ? Math.max(-0.2, Math.min(0.2, (z.end - a.end) / dx)) : 0;
    let y0 = a.end, shift = 0;
    for (const p of m) { const d = p.end - (y0 + slope * (p.stemX - a.stemX)); shift = up ? Math.min(shift, d) : Math.max(shift, d); }
    y0 += shift;
    const on = p => y0 + slope * (p.stemX - a.stemX);
    for (const p of m) { p.end = on(p); p.beamed = true; }
    g.fillStyle = o.ink;
    const bar = (p, q, level) => {
      const off = (level - 1) * step * (up ? 1 : -1), t = up ? thick : -thick;
      g.beginPath();
      g.moveTo(p.stemX - stemT / 2, on(p) + off); g.lineTo(q.stemX + stemT / 2, on(q) + off);
      g.lineTo(q.stemX + stemT / 2, on(q) + off + t); g.lineTo(p.stemX - stemT / 2, on(p) + off + t);
      g.closePath(); g.fill();
    };
    const stub = (p, toRight, level) => bar(toRight ? p : {stemX: p.stemX - sp * 1.1}, toRight ? {stemX: p.stemX + sp * 1.1} : p, level);
    bar(a, z, 1);
    for (let level = 2; level <= 4; level++) run.forEach((e, i) => {
      if (e.flags < level) return;
      const right = run[i + 1] && run[i + 1].flags >= level, left = run[i - 1] && run[i - 1].flags >= level;
      if (right) bar(m[i], m[i + 1], level); else if (!left) stub(m[i], i === 0, level);
    });
  }

  for (const e of score.events) {
    const p = at.get(e);
    if (!p) continue;
    const colour = o.lit && o.lit(e) ? o.accent : o.ink;
    g.fillStyle = colour; g.font = `${4 * sp}px Bravura`; g.textAlign = 'left';
    if (e.rest) {
      const ch = G.rest[e.type] || G.rest.quarter, x = e.whole && o.wholeRestX ? o.wholeRestX(e) : p.x;
      if (x != null) g.fillText(ch, x - wide(ch) / 2, y(e.type === 'whole' ? 6 : 4));
      continue;
    }
    const {x, hw, up} = p, notes = [...e.notes].sort((a, b) => a.line - b.line);
    /* short lines for notes above or below the staff */
    g.fillStyle = o.ink;
    for (let l = -2; l >= p.lo; l -= 2) g.fillRect(x - hw / 2 - sp * 0.35, Math.round(y(l)), hw + sp * 0.7, 1);
    for (let l = 10; l <= p.hi; l += 2) g.fillRect(x - hw / 2 - sp * 0.35, Math.round(y(l)), hw + sp * 0.7, 1);
    g.fillStyle = colour;
    /* noteheads; of two a step apart, one goes on the other side of the stem */
    const ch = e.type === 'whole' ? G.whole : e.type === 'half' ? G.half : G.black;
    let aside = false, anyAside = false;
    const order = up ? notes : [...notes].reverse();
    order.forEach((n, i) => {
      aside = i > 0 && Math.abs(n.line - order[i - 1].line) === 1 && !aside;
      anyAside = anyAside || aside;
      g.fillText(ch, x - hw / 2 + (aside ? (up ? hw - stemT : -(hw - stemT)) : 0), y(n.line));
    });
    /* sharps, flats and naturals, stepped leftward where they would collide */
    let col = 0, lastLine = Infinity;
    for (const n of [...notes].reverse()) {
      if (!n.accidental) continue;
      col = lastLine - n.line < 6 ? col + 1 : 0; lastLine = n.line;
      g.fillText(G[n.accidental], x - hw / 2 - sp * 0.25 - accW[n.accidental] - col * sp * 1.15 - (anyAside && !up ? hw : 0), y(n.line));
    }
    for (let d = 0; d < e.dots; d++) for (const n of notes) g.fillText(G.dot, x + hw / 2 + sp * (0.45 + d * 0.6) + (anyAside && up ? hw : 0), y(n.line % 2 ? n.line : n.line + 1));
    if (e.type && e.type !== 'whole') {
      g.fillRect(p.stemX - stemT / 2, Math.min(p.from, p.end), stemT, Math.abs(p.end - p.from));
      if (e.flags && !p.beamed) g.fillText((up ? G.flagUp : G.flagDown)[e.flags], p.stemX - stemT / 2, p.end);
    }
    if (e.tuplet) {
      g.font = `italic ${Math.round(sp * 1.5)}px Georgia,"Times New Roman",serif`; g.textAlign = 'center';
      g.fillText('3', p.stemX, up ? p.end - sp * 0.5 : p.end + sp * 1.6);
    }
    /* a tie to the part of this note written next */
    if (e.tieToNext && e.next) {
      const q = at.get(e.next), x2 = q ? q.x - q.hw / 2 - sp * 0.2 : x + sp * 6, x1 = x + hw / 2 + sp * 0.2;
      g.strokeStyle = colour; g.lineWidth = Math.max(1, sp * 0.14);
      for (const n of notes) {
        const yy = y(n.line) + (up ? sp * 0.7 : -sp * 0.7), bow = up ? sp * 0.8 : -sp * 0.8;
        g.beginPath(); g.moveTo(x1, yy); g.quadraticCurveTo((x1 + x2) / 2, yy + bow, x2, yy); g.stroke();
      }
    }
  }
}

/* The band above the tab. canvas: the canvas to draw on; its size on the page decides how large
   the staff is. Returns {setSong, setAxis, setTheme, draw, height, score}. */
export function createSheet(canvas) {
  const g = canvas.getContext('2d');
  let score = null, xOf = t => t * 100, where = {};
  let theme = {bg: '#121212', line: 'rgba(236,230,214,.5)', ink: '#ffffff', dim: '#8f8b80', accent: '#f7a43a', head: 'rgba(247,164,58,.24)'};
  let last = null, ready = false;
  ensureFont().then(() => { ready = true; if (last) api.draw(...last); });

  const api = {
    /* the height the band asks for, in CSS pixels */
    height: 168,
    get score() { return score; },
    /* a saved tab, or null for none */
    setSong(song) { score = song ? toScore(song) : null; },
    /* xOf(seconds) is the tab's own distance along the line. places, when given, pins things to
       the tab exactly: {columnX(seconds) -> the x of the chord struck then, barX(barNumber) -> the
       x of that bar's line}; either may return null to fall back on xOf. */
    setAxis(fn, places) { xOf = fn; where = places || {}; },
    setTheme(t) { theme = {...theme, ...t}; },
    /* One frame with moment t under the playhead. viewWidth: the band's width in CSS pixels;
       playheadX: where the playhead stands; headWidth: how wide its column is (optional). */
    draw(t, viewWidth, playheadX, headWidth) {
      last = [t, viewWidth, playheadX, headWidth];
      const W = Math.max(1, Math.round(viewWidth || canvas.clientWidth)), H = Math.max(1, Math.round(canvas.clientHeight || api.height));
      const dpr = window.devicePixelRatio || 1;
      if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) { canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr); }
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.fillStyle = theme.bg; g.fillRect(0, 0, W, H);
      if (!score) return;
      /* the staff is as large as the room allows once the song's highest and lowest notes,
         with their stems, are given their place above and below it */
      const room = staffRoom(score), sp = H / (room.above + 4 + room.below), top = Math.round(sp * room.above);
      const lines = () => { g.fillStyle = theme.line; for (let i = 0; i < 5; i++) g.fillRect(0, Math.round(top + i * sp), W, 1); };
      const hw = headWidth || sp * 2.6;
      g.fillStyle = theme.head; g.fillRect(playheadX - hw / 2, 0, hw, H);
      lines();
      if (!ready) return;
      const off = xOf(t) - playheadX, pad = sp * 12;
      const column = e => { const x = e.head && where.columnX ? where.columnX(e.start_s) : null; return (x == null ? xOf(e.time_s) : x) - off; };
      const barX = i => { const b = score.bars[i], x = where.barX ? where.barX(b.number) : null; return (x == null ? xOf(b.start_s) - sp * 1.5 : x) - off; };
      const seen = x => x > -pad && x < W + pad;
      drawScore(g, score, {top, sp, ink: theme.ink, bar: theme.ink, accent: theme.accent,
        x: e => { const x = column(e); return seen(x) ? x : null; },
        barX: i => { const x = barX(i); return seen(x) ? x : null; },
        endX: score.bars.length ? (x => seen(x) ? x : null)(xOf(score.bars[score.bars.length - 1].end_s) - off) : null,
        wholeRestX: e => { const b = score.bars[e.bar], a = e.bar ? barX(e.bar) : xOf(b.start_s) - off, z = e.bar + 1 < score.bars.length ? barX(e.bar + 1) : xOf(b.end_s) - off; return (a + z) / 2; },
        lit: e => !e.rest && t >= e.start_s - 0.005 && t < Math.max(e.end_s, e.start_s + 0.15)});
      /* clef, key and time stay at the left edge, over whatever has slid beneath them */
      const head = headerWidth(score, sp);
      g.fillStyle = theme.bg; g.fillRect(0, 0, head, H);
      g.fillStyle = theme.line; for (let i = 0; i < 5; i++) g.fillRect(0, Math.round(top + i * sp), head, 1);
      drawHeader(g, score, 0, top, sp, theme.ink);
    }
  };
  return api;
}
