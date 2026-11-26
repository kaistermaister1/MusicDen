/* Turns a saved tab into written music: bars, note values, voices, spelled pitches and accidentals.
   Nothing here draws or touches the page, so it also runs outside a browser. Lengths are counted
   in ticks, 48 to a quarter note. */

export const DIV = 48;

/* every note value that can be written with one notehead: [ticks, name, dots, part of a triplet] */
const VALUES = [[192, 'whole', 0, false], [144, 'half', 1, false], [96, 'half', 0, false], [72, 'quarter', 1, false],
  [48, 'quarter', 0, false], [36, 'eighth', 1, false], [32, 'quarter', 0, true], [24, 'eighth', 0, false],
  [18, '16th', 1, false], [16, 'eighth', 0, true], [12, '16th', 0, false], [9, '32nd', 1, false],
  [8, '16th', 0, true], [6, '32nd', 0, false], [4, '32nd', 0, true], [3, '64th', 0, false]];
const VALUE = new Map(VALUES.map(v => [v[0], {type: v[1], dots: v[2], tuplet: v[3]}]));
const PLAIN = VALUES.filter(v => !v[3]).map(v => v[0]), TRIPLET = [32, 16, 8, 4];
const FLAGS = {eighth: 1, '16th': 2, '32nd': 3, '64th': 4};

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const median = a => { const s = [...a].sort((x, y) => x - y); return s.length ? s[s.length >> 1] : 0; };
const frac = s => { if (s == null) return null; const [a, b] = String(s).split('/'), v = Number(a) / (b ? Number(b) : 1); return Number.isFinite(v) ? v : null; };

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

/* A length in ticks as the note values that add up to it, longest first. */
export function pieces(d) {
  if (VALUE.has(d)) return [d];
  const out = [];
  let rest = d;
  if (rest % 3) {
    const t = TRIPLET.find(t => t <= rest && (rest - t) % 3 === 0);
    if (t) { out.push(t); rest -= t; } else rest = Math.max(3, Math.round(rest / 3) * 3);
  }
  for (const b of PLAIN) while (rest >= b) { out.push(b); rest -= b; }
  return out.sort((a, b) => b - a);
}

/* A stretch of a bar as [tick, length] pairs. A stretch that starts between beats is first written
   up to the next beat, so the beats stay easy to see. */
export function cut(start, end, beatTicks, barStart) {
  const out = [];
  let s = start;
  const into = (s - barStart) % beatTicks;
  if (into) {
    const beat = s + beatTicks - into;
    if (beat < end) { for (const p of pieces(beat - s).reverse()) { out.push([s, p]); s += p; } s = beat; }
  }
  if (end > s) for (const p of pieces(end - s)) { out.push([s, p]); s += p; }
  return out;
}

const LETTERS = 'FCGDAEB', NATURAL = {C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11}, STEP = {C: 0, D: 1, E: 2, F: 3, G: 4, A: 5, B: 6};

/* How a pitch is written in a key: its letter, sharp or flat (alter), octave, and place on the
   treble staff counted in half spaces up from the bottom line. Of the two ways to write a black
   key, the one nearer the key is taken, and the sharp when they are equally near. */
export function spell(midi, fifths = 0) {
  const pc = ((midi % 12) + 12) % 12, base = (pc * 7) % 12, centre = fifths + 2;
  let best = null;
  for (const c of [base - 12, base, base + 12]) {
    const alter = Math.floor((c + 1) / 7);
    if (Math.abs(alter) > 1) continue;
    const d = Math.abs(c - centre);
    if (!best || d < best.d || (d === best.d && c > best.c)) best = {c, d, alter};
  }
  const step = LETTERS[(((best.c + 1) % 7) + 7) % 7];
  const octave = Math.round((midi - best.alter - NATURAL[step]) / 12) - 1;
  return {step, alter: best.alter, octave, line: octave * 7 + STEP[step] - 30};
}

/* The key signature (sharps as a positive count, flats negative) that leaves the fewest notes
   needing an accidental. */
export function chooseKey(pitches) {
  const count = new Array(12).fill(0);
  for (const p of pitches) count[((p % 12) + 12) % 12]++;
  let best = 0, least = Infinity;
  for (const f of [0, 1, -1, 2, -2, 3, -3, 4, -4, 5, -5]) {
    const tonic = (((f * 7) % 12) + 12) % 12, scale = new Set([0, 2, 4, 5, 7, 9, 11].map(i => (tonic + i) % 12));
    let cost = Math.abs(f) * pitches.length * 0.004;
    for (let pc = 0; pc < 12; pc++) if (!scale.has(pc)) cost += count[pc];
    if (cost < least - 1e-9) { least = cost; best = f; }
  }
  return best;
}

/* What the key signature does to each letter. */
export function keyAlters(fifths) {
  const out = {C: 0, D: 0, E: 0, F: 0, G: 0, A: 0, B: 0};
  for (let i = 0; i < Math.abs(fifths); i++) out[fifths > 0 ? 'FCGDAEB'[i] : 'BEADGCF'[i]] = fifths > 0 ? 1 : -1;
  return out;
}

const written = (n, fifths) => ({id: n.id, pitch: n.pitch, string: n.string, fret: n.fret, accidental: null, ...spell(n.pitch + 12, fifths)});
const ACCIDENTAL = {'1': 'sharp', '-1': 'flat', '0': 'natural'};

/* The whole song as written music. See the end of the function for what it returns. */
export function toScore(song) {
  const tuning = (song && song.tuning) || [];
  const raw = ((song && song.notes) || [])
    .filter(n => n.string >= 1 && n.string <= 6 && n.fret != null && Number.isFinite(n.start_s))
    .map(n => ({id: n.id, start: n.start_s, end: Math.max(n.end_s || 0, n.start_s + 0.03), string: n.string, fret: n.fret,
      pitch: n.pitch == null ? (tuning[n.string - 1] || 0) + n.fret : n.pitch, bar: n.bar, pos: frac(n.beat_pos)}))
    .sort((a, b) => a.start - b.start || a.pitch - b.pitch);
  const fifths = chooseKey(raw.map(n => n.pitch)), inKey = keyAlters(fifths);
  const title = (song && song.title) || '';

  const beats = [];
  for (const b of (song && song.beats) || []) if (!beats.length || b.time_s > beats[beats.length - 1].time_s + 1e-4) beats.push(b);
  if (beats.length < 2 || !raw.length) return unmeasured(title, raw, fifths, inKey);

  /* bars, each with the moments of its beats */
  const bars = [];
  for (const b of beats) {
    const last = bars[bars.length - 1];
    if (!last || last.number !== b.bar) bars.push({number: b.bar, times: [b.time_s]}); else last.times.push(b.time_s);
  }
  const flat = beats.map(b => b.time_s), gaps = flat.slice(1).map((t, i) => t - flat[i]), beatLen = median(gaps);
  const inner = bars.length > 2 ? bars.slice(bars[0].number === 0 ? 1 : 0, -1) : bars;
  const sizes = inner.map(b => b.times.length);
  const usual = [...new Set(sizes)].sort((a, b) => sizes.filter(s => s === b).length - sizes.filter(s => s === a).length || a - b)[0] || bars[0].times.length;

  /* what one beat is written as: a dotted quarter where beats mostly split in three, an eighth
     where they come very quickly, a quarter otherwise */
  let thirds = 0, halves = 0;
  for (const n of raw) {
    if (n.pos == null) continue;
    const f = n.pos - Math.floor(n.pos);
    if (f < 1e-6 || f > 1 - 1e-6) continue;
    const sixths = f * 6;
    if (Math.abs(sixths - Math.round(sixths)) < 1e-6 && Math.round(sixths) % 3) thirds++; else halves++;
  }
  const compound = thirds > 8 && thirds > halves * 1.5;
  const beatTicks = compound ? 72 : 60 / beatLen > 200 ? 24 : 48;
  const signature = beatsInBar => compound ? {num: beatsInBar * 3, den: 8} : {num: beatsInBar, den: beatTicks === 24 ? 8 : 4};

  /* notes played before the first beat lengthen the first bar backwards by whole beats */
  let lead = 0;
  for (const n of raw) {
    if (n.pos != null && n.bar === bars[0].number && n.pos < 0) lead = Math.max(lead, Math.ceil(-n.pos - 1e-9));
    else if (n.pos == null && n.start < flat[0]) lead = Math.max(lead, Math.ceil((flat[0] - n.start) / (gaps[0] || beatLen) - 0.25));
  }
  lead = Math.min(lead, Math.max(1, usual));

  /* where each bar and each beat falls, in ticks and in seconds */
  const T = [], K = [];
  let tick = 0;
  bars.forEach((b, i) => {
    const extra = i === 0 ? lead : 0;
    b.startTick = tick; b.ticks = (b.times.length + extra) * beatTicks;
    b.start_s = b.times[0] - extra * (gaps[0] || beatLen);
    b.time = signature(b.times.length + extra);
    b.pickup = i === 0 && b.times.length + extra < usual;
    b.times.forEach((t, j) => { T.push(t); K.push(tick + (extra + j) * beatTicks); });
    tick += b.ticks;
  });
  const total = tick;
  bars.forEach((b, i) => { b.end_s = i + 1 < bars.length ? bars[i + 1].times[0] : flat[flat.length - 1] + (gaps[gaps.length - 1] || beatLen); delete b.times; });
  T.push(bars[bars.length - 1].end_s); K.push(total);
  if (lead) { T.unshift(bars[0].start_s); K.unshift(0); }
  const barAt = k => { let lo = 0, hi = bars.length - 1; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (bars[m].startTick <= k) lo = m; else hi = m - 1; } return lo; };
  const numberToBar = new Map(bars.map((b, i) => [b.number, i]));

  /* each note's place, from what is saved with it or else from the beats around it */
  for (const n of raw) {
    const bi = n.pos != null && numberToBar.has(n.bar) ? numberToBar.get(n.bar) : -1;
    let k;
    if (bi >= 0) k = bars[bi].startTick + Math.round(((bi === 0 ? lead : 0) + n.pos) * beatTicks);
    else { const grid = beatTicks / 4; k = Math.round(interp(T, K, n.start) / grid) * grid; }
    n.tick = clamp(k, 0, total - 3);
  }

  /* notes on one tick are one chord */
  const byTick = new Map();
  for (const n of raw) { if (!byTick.has(n.tick)) byTick.set(n.tick, []); byTick.get(n.tick).push(n); }
  const groups = [...byTick].sort((a, b) => a[0] - b[0]).map(([k, notes]) => ({tick: k, notes: notes.sort((a, b) => a.pitch - b.pitch), time: Math.min(...notes.map(n => n.start))}));

  /* A bass line of its own: low notes on the three low strings that fall on a beat or under a
     higher note. It gets a voice to itself when enough of them sound together with the notes above. */
  let basses = 0, together = 0;
  groups.forEach((g, i) => {
    const low = g.notes[0], onBeat = (g.tick - bars[barAt(g.tick)].startTick) % beatTicks === 0;
    g.bass = low.string >= 4 && low.pitch <= 57 && (g.notes.length > 1 || onBeat) ? low : null;
    if (!g.bass) return;
    basses++;
    const next = groups[i + 1];
    if (g.notes.length > 1 || (next && low.end > next.time + 0.03 && next.notes.some(m => m.string <= 3 || m.pitch > low.pitch + 7))) together++;
  });
  const twoVoices = basses >= 4 && together >= basses * 0.3 && basses >= groups.length * 0.08;
  const voices = twoVoices ? [[], []] : [[]];
  for (const g of groups) {
    if (twoVoices && g.bass) {
      voices[1].push({tick: g.tick, notes: [g.bass], time: g.bass.start});
      const above = g.notes.filter(n => n !== g.bass);
      if (above.length) voices[0].push({tick: g.tick, notes: above, time: g.time});
    } else voices[0].push({tick: g.tick, notes: g.notes, time: g.time});
  }

  /* Each chord lasts until the next one in its voice, or the bar line; one still sounding well
     past the bar line is carried into the next bar with a tie. */
  const events = [];
  const secondsAt = k => interp(K, T, k);
  voices.forEach((list, vi) => {
    list.forEach((ev, i) => {
      const bi = barAt(ev.tick), barEnd = bars[bi].startTick + bars[bi].ticks;
      const nextTick = i + 1 < list.length ? list[i + 1].tick : Infinity;
      const sounds = Math.max(...ev.notes.map(n => n.end));
      const spans = [[ev.tick, Math.min(nextTick, barEnd), bi]];
      if (nextTick > barEnd && bi + 1 < bars.length) {
        const until = interp(T, K, sounds);
        if (until > barEnd + beatTicks * 0.4) spans.push([barEnd, Math.min(nextTick, bars[bi + 1].startTick + bars[bi + 1].ticks), bi + 1]);
      }
      const made = [];
      for (const [s, e, b] of spans) for (const [k, dur] of cut(s, e, beatTicks, bars[b].startTick)) {
        made.push({voice: vi + 1, bar: b, tick: k, dur, ...VALUE.get(dur), flags: FLAGS[VALUE.get(dur).type] || 0, rest: false, whole: false,
          head: !made.length, time_s: made.length ? secondsAt(k) : ev.time, start_s: ev.time, end_s: sounds,
          tieFromPrev: made.length > 0, tieToNext: false, next: null, stemUp: true, beam: null,
          notes: ev.notes.map(n => written(n, fifths))});
      }
      made.forEach((m, j) => { if (j + 1 < made.length) { m.tieToNext = true; m.next = made[j + 1]; } });
      events.push(...made);
    });
  });

  /* rests in the upper voice: a silent bar, or the silence before its first note in a bar */
  const rest = (b, k, dur, whole) => ({voice: 1, bar: b, tick: k, dur, ...(whole ? {type: 'whole', dots: 0, tuplet: false} : VALUE.get(dur)),
    flags: 0, rest: true, whole, head: false, time_s: secondsAt(k), start_s: secondsAt(k), end_s: secondsAt(k + dur),
    tieFromPrev: false, tieToNext: false, next: null, stemUp: true, beam: null, notes: []});
  const firstUpper = new Map();
  for (const e of events) if (e.voice === 1 && (!firstUpper.has(e.bar) || e.tick < firstUpper.get(e.bar))) firstUpper.set(e.bar, e.tick);
  bars.forEach((b, i) => {
    if (!firstUpper.has(i)) events.push(rest(i, b.startTick, b.ticks, true));
    else for (const [k, dur] of cut(b.startTick, firstUpper.get(i), beatTicks, b.startTick)) events.push(rest(i, k, dur, false));
  });
  events.sort((a, b) => a.tick - b.tick || a.voice - b.voice);

  /* accidentals: shown when a note differs from what its line last held in this bar, or from the key */
  let bar = -1, held = null;
  for (const e of events) {
    if (e.bar !== bar) { bar = e.bar; held = new Map(); }
    if (e.rest || e.tieFromPrev) continue;
    for (const n of e.notes) {
      const now = held.has(n.line) ? held.get(n.line) : inKey[n.step];
      if (n.alter !== now) n.accidental = ACCIDENTAL[n.alter];
      held.set(n.line, n.alter);
    }
  }

  /* stems: the upper voice up and the bass down, or by where a lone voice's notes lie on the staff */
  const lean = list => { let lo = Infinity, hi = -Infinity; for (const e of list) for (const n of e.notes) { lo = Math.min(lo, n.line); hi = Math.max(hi, n.line); } return (lo + hi) / 2 < 4; };
  for (const e of events) if (!e.rest) e.stemUp = twoVoices ? e.voice === 1 : lean([e]);

  /* beams: runs of flagged notes that follow straight on from each other inside one beat */
  const span = beatTicks === 24 ? (usual % 3 === 0 ? 72 : 48) : beatTicks;
  const beams = [];
  for (let v = 1; v <= voices.length; v++) {
    let run = [];
    const close = () => { if (run.length > 1) { const up = twoVoices ? v === 1 : lean(run); for (const e of run) { e.beam = beams.length; e.stemUp = up; } beams.push(run); } run = []; };
    for (const e of events) {
      if (e.voice !== v) continue;
      const last = run[run.length - 1];
      const joins = last && !e.rest && e.flags && last.bar === e.bar && last.tick + last.dur === e.tick &&
        Math.floor((last.tick - bars[e.bar].startTick) / span) === Math.floor((e.tick - bars[e.bar].startTick) / span);
      if (!joins) close();
      if (!e.rest && e.flags) run.push(e);
    }
    close();
  }

  /* title; measured (false when there were no beats to go by); twoVoices; key {fifths}; time
     {num, den} of the usual bar; beatTicks; bars [{number, startTick, ticks, start_s, end_s, time,
     pickup}]; events in order, each {voice, bar (index), tick, dur, type, dots, tuplet, flags, rest,
     whole (a rest for the whole bar), head (the struck start of a chord, not a tied-on part),
     time_s (where it stands), start_s / end_s (while its chord sounds), tieFromPrev, tieToNext,
     next, stemUp, beam (index into beams), notes [{id, pitch, string, fret, step, alter, octave,
     line, accidental}]}; beams (lists of events); secondsAt(tick). */
  return {title, measured: true, twoVoices, key: {fifths}, time: signature(usual), beatTicks,
    bars: bars.map(b => ({number: b.number, startTick: b.startTick, ticks: b.ticks, start_s: b.start_s, end_s: b.end_s, time: b.time, pickup: b.pickup})),
    events, beams, secondsAt};
}

/* A song with no beats to go by: each chord as plain noteheads at its moment, with no values. */
function unmeasured(title, raw, fifths, inKey) {
  const events = [];
  for (const n of raw) {
    const last = events[events.length - 1];
    if (last && n.start - last.time_s <= 0.035) { last.notes.push(written(n, fifths)); last.end_s = Math.max(last.end_s, n.end); continue; }
    events.push({voice: 1, bar: -1, tick: null, dur: null, type: null, dots: 0, tuplet: false, flags: 0, rest: false, whole: false, head: true,
      time_s: n.start, start_s: n.start, end_s: n.end, tieFromPrev: false, tieToNext: false, next: null, stemUp: true, beam: null, notes: [written(n, fifths)]});
  }
  for (const e of events) for (const n of e.notes) if (n.alter !== inKey[n.step]) n.accidental = ACCIDENTAL[n.alter];
  return {title, measured: false, twoVoices: false, key: {fifths}, time: null, beatTicks: DIV, bars: [], events, beams: [], secondsAt: () => 0};
}
