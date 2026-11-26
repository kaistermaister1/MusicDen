/* The beat of a piece played in free time. A recording written out as notes has no tempo or
   meter in it, only when each key went down; this finds a beat that the notes agree with, how
   the beats group into measures, and whether each beat divides in two or in three, so the piece
   can be written as sheet music and the sheet can be followed in the recording's own time. */

const STEP = 0.01;          /* seconds between the points in time where a beat may fall */
const TOGETHER = 0.045;     /* notes starting within this many seconds of each other are one stroke */
const LEVEL = 0.52;         /* seconds between the quick beats people most readily tap along to */

/* True when a piece's notes do not sit on the grid of its own file: fewer than six in ten start
   on a sixteenth or a triplet eighth of the file's beat. A file timed in frames always counts. */
export function isFreeTime(piece) {
  const division = piece.source.division;
  if (division & 0x8000) return true;
  const slack = division / 48, close = (tick, grid) => { const r = tick % grid; return Math.min(r, grid - r) <= slack; };
  const on = piece.notes.filter(n => close(n.on.tick, division / 4) || close(n.on.tick, division / 3)).length;
  return on < piece.notes.length * 0.6;
}

/* The strokes of a piece: notes that start together, with the moment they sound (`t`), their
   lowest note, their longest length, a plain weight (`w`) that grows with the number of notes
   and how hard and long they are played, and how `heavy` the stroke is to a listener: the
   lowest note around, long notes, full chords and loud playing mark the strong places. */
export function strokes(notes) {
  const out = [];
  for (const n of notes) {
    const last = out[out.length - 1];
    if (last && n.start - last.from <= TOGETHER) last.notes.push(n); else out.push({from: n.start, notes: [n]});
  }
  for (const s of out) {
    const k = s.notes.length;
    let t = 0, vel = 0, long = 0, low = 127;
    for (const n of s.notes) { t += n.start; vel += n.vel; long = Math.max(long, n.end - n.start); low = Math.min(low, n.midi); }
    s.t = t / k; s.low = low; s.long = long; s.vel = vel / k;
    s.w = (0.5 + 0.5 * s.vel) * (1 + 0.6 * Math.log2(k)) * (0.7 + 0.3 * Math.min(2, long));
  }
  let lo = 0, hi = 0;
  for (const s of out) {
    while (out[lo].t < s.t - 1) lo++;
    while (hi + 1 < out.length && out[hi + 1].t <= s.t + 1) hi++;
    let floor = 127;
    for (let k = lo; k <= hi; k++) floor = Math.min(floor, out[k].low);
    s.heavy = (s.low <= floor + 2 ? 1.2 : 0) + Math.min(1.5, Math.log2(1 + 2 * s.long)) + 0.5 * Math.log2(s.notes.length) + 0.5 * s.vel;
  }
  return out;
}

/* How strongly the piece is struck at each point in time: every stroke spread a little to both
   sides, counted by `weigh(stroke)`. */
function pulse(list, length, weigh) {
  const a = new Float32Array(length), spread = 0.022 / STEP, reach = Math.ceil(spread * 3);
  const typical = list.map(weigh).sort((x, y) => x - y)[list.length >> 1] || 1;
  for (const s of list) {
    const c = s.t / STEP, w = weigh(s) / typical;
    for (let i = Math.max(0, Math.floor(c - reach)); i <= Math.min(length - 1, Math.ceil(c + reach)); i++) a[i] += w * Math.exp(-0.5 * ((i - c) / spread) ** 2);
  }
  return a;
}

/* The quick beat the whole piece agrees with best, in steps: the gap at which the pulse repeats
   itself most, counting gaps of two, three and four beats too, and leaning toward a walking pace. */
function steadyBeat(a) {
  const lo = Math.round(0.26 / STEP), hi = Math.round(1.3 / STEP), again = new Float32Array(hi * 4 + 1);
  for (let lag = lo; lag <= hi * 4; lag++) {
    let sum = 0;
    for (let i = 0; i + lag < a.length; i++) sum += a[i] * a[i + lag];
    again[lag] = sum / (a.length - lag);
  }
  let best = lo, top = -1;
  for (let p = lo; p <= hi; p++) {
    const lean = Math.exp(-0.5 * (Math.log2(p * STEP / LEVEL) / 0.75) ** 2);
    const score = (again[p] + 0.5 * again[2 * p] + 0.33 * again[3 * p] + 0.25 * again[4 * p]) * lean;
    if (score > top) { top = score; best = p; }
  }
  return best;
}

/* Beats through the piece, as times in seconds, staying around a beat of `ref` steps. Among all
   ways of stepping through, picks the one whose steps land on the most and heaviest of the
   pulse `a` while changing its pace only gradually; then moves each beat onto the stroke it
   found, and carries on at the same pace to cover the first note and the last one's ring. */
function follow(list, a, ref, weigh, notes) {
  const length = a.length, lo = Math.max(12, Math.round(ref * 0.62)), hi = Math.round(ref * 1.6), kinds = hi - lo + 1;
  const SWERVE = 260, DRIFT = 2.5;    /* what a change of pace costs from one beat to the next, and away from `ref` */
  const logs = Float64Array.from({length: kinds}, (_, j) => Math.log(lo + j)), far = logs.map(l => DRIFT * (l - Math.log(ref)) ** 2);
  const score = new Float32Array(length * kinds), from = new Int16Array(length * kinds).fill(-1);
  for (let t = 0; t < length; t++) {
    for (let j = 0; j < kinds; j++) {
      const p = lo + j, back = t - p;
      let best = 0, who = -1;
      if (back >= 0) {
        best = -Infinity;
        /* the beat before may have been a little shorter or longer, up to about a tenth */
        const reach = Math.max(1, Math.round(p * 0.1));
        for (let i = Math.max(0, j - reach); i <= Math.min(kinds - 1, j + reach); i++) {
          const v = score[back * kinds + i] - SWERVE * (logs[j] - logs[i]) ** 2;
          if (v > best) { best = v; who = i; }
        }
      }
      score[t * kinds + j] = best + a[t] - far[j];
      from[t * kinds + j] = who;
    }
  }
  let t = -1, j = 0, top = -Infinity;
  for (let i = Math.max(0, length - hi); i < length; i++) for (let k = 0; k < kinds; k++) if (score[i * kinds + k] > top) { top = score[i * kinds + k]; t = i; j = k; }
  const steps = [];
  while (t >= 0) {
    steps.push(t);
    const prev = from[t * kinds + j];
    if (prev < 0) break;
    t -= lo + j; j = prev;
  }
  steps.reverse();
  const beats = steps.map((s, i) => {
    const at = s * STEP, gap = ((steps[i + 1] ?? s + ref) - (steps[i - 1] ?? s - ref)) / 2 * STEP, slack = Math.min(0.07, gap * 0.15);
    let pick = null;
    for (const st of list) { if (st.t > at + slack) break; if (st.t >= at - slack && (!pick || weigh(st) > weigh(pick))) pick = st; }
    return pick ? pick.t : at;
  });
  const first = beats[1] - beats[0], last = beats[beats.length - 1] - beats[beats.length - 2], tail = notes.reduce((m, n) => Math.max(m, n.end), 0);
  while (beats[0] > notes[0].start + 0.02) beats.unshift(beats[0] - first);
  while (beats[beats.length - 1] < tail) beats.push(beats[beats.length - 1] + last);
  return beats;
}

/* Where a moment falls among the beats: 3.5 is halfway from the fourth beat to the fifth. */
export function beatAt(beats, t) {
  const n = beats.length;
  if (t <= beats[0]) return (t - beats[0]) / (beats[1] - beats[0]);
  if (t >= beats[n - 1]) return n - 1 + (t - beats[n - 1]) / (beats[n - 1] - beats[n - 2]);
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (beats[mid] <= t) lo = mid; else hi = mid; }
  return lo + (t - beats[lo]) / (beats[hi] - beats[lo]);
}
/* The other way round: the moment a place among the beats is reached. */
export function timeAt(beats, at) {
  const n = beats.length;
  if (at <= 0) return beats[0] + at * (beats[1] - beats[0]);
  if (at >= n - 1) return beats[n - 1] + (at - (n - 1)) * (beats[n - 1] - beats[n - 2]);
  const i = Math.floor(at);
  return beats[i] + (at - i) * (beats[i + 1] - beats[i]);
}

const linked = (a, b) => {
  const n = a.length;
  let ma = 0, mb = 0, sab = 0, saa = 0, sbb = 0;
  for (let i = 0; i < n; i++) { ma += a[i]; mb += b[i]; }
  ma /= n; mb /= n;
  for (let i = 0; i < n; i++) { sab += (a[i] - ma) * (b[i] - mb); saa += (a[i] - ma) ** 2; sbb += (b[i] - mb) ** 2; }
  return saa && sbb ? sab / Math.sqrt(saa * sbb) : 0;
};

/* The beat of a free-time piece as a musician would write it. Returns:
     beats   the quick beats the piece steps to, as times in seconds, from before the first note to after the last
     parts   how a quick beat divides, in 2 or in 3
     group   how many quick beats make one written beat (1, 2 or 3), and `lead`, the first quick beat that starts one
     bar     written beats to the measure (2, 3 or 4), and `first`, the first written beat that starts one
     dotted  whether the written beat is a dotted quarter, as in six-eight time, rather than a quarter
     pace    the usual length of a quick beat in seconds
   The quick beats are followed through the piece first. The beat a musician writes may take two
   or three of them, so every way of grouping them is tried, and the one kept is the one in which
   the heavy strokes sit on the strong places most consistently: measure starts strongest, then
   written beats, then quick beats, then their halves or thirds. Usual tempos and usual meters
   get a small head start. */
export function findBeats(notes) {
  const list = strokes(notes), end = notes.reduce((m, n) => Math.max(m, n.start), 0), length = Math.ceil((end + 0.5) / STEP);
  const plain = pulse(list, length, s => s.w), beats = follow(list, plain, steadyBeat(plain), s => s.w, notes);
  const gaps = beats.slice(1).map((b, i) => b - beats[i]).sort((x, y) => x - y), pace = gaps[gaps.length >> 1];
  const place = list.map(s => beatAt(beats, s.t)), heavy = list.map(s => s.heavy);
  let two = 0, three = 0, between = 0;
  for (const p of place) {
    const off = p - Math.floor(p);
    if (Math.min(off, 1 - off) < 0.1) continue;
    between++;
    const d2 = Math.min(Math.abs(off - 0.25), Math.abs(off - 0.5), Math.abs(off - 0.75)), d3 = Math.min(Math.abs(off - 1 / 3), Math.abs(off - 2 / 3));
    if (d3 < 0.07 && d3 < d2) three++; else if (d2 < 0.07) two++;
  }
  /* a beat is taken to divide in three only when that is plain to see */
  const parts = three > two * 1.3 && three > between * 0.3 ? 3 : 2;
  const onBeat = place.map(p => Math.abs(p - Math.round(p)) < 0.1 ? Math.round(p) : -1);
  const inside = place.map(p => { const off = p - Math.floor(p); return (parts === 3 ? Math.min(Math.abs(off - 1 / 3), Math.abs(off - 2 / 3)) : Math.abs(off - 0.5)) < 0.08 ? 1.5 : 1; });
  const strength = new Float64Array(list.length);
  let best = null;
  for (const group of [1, 2, 3]) {
    /* quick beats in three make a dotted beat by themselves or in pairs, never in threes; and a
       dotted beat shorter than six tenths of a second is too fast to be the written one */
    if (parts === 3 && (group === 3 || (group === 1 && pace < 0.6))) continue;
    const dotted = parts === 3 || group === 3, written = group * pace;
    const tempo = 0.08 * Math.abs(Math.log2(written / (dotted ? 0.85 : 0.62)));
    for (let lead = 0; lead < group; lead++) {
      for (const bar of [2, 3, 4]) {
        const usual = dotted ? (bar === 2 ? 0.02 : bar === 4 ? 0.01 : 0) : (bar === 4 ? 0.02 : bar === 3 ? 0.008 : 0);
        for (let first = 0; first < bar; first++) {
          for (let i = 0; i < list.length; i++) {
            const k = onBeat[i];
            if (k < 0) { strength[i] = inside[i]; continue; }
            const step = k - lead;
            if (((step % group) + group) % group !== 0) { strength[i] = 2; continue; }
            const b = (((step / group - first) % bar) + bar) % bar;
            strength[i] = b === 0 ? 4 : bar === 4 && b === 2 ? 3.4 : 3;
          }
          const score = linked(heavy, strength) - tempo + usual;
          if (!best || score > best.score) best = {group, lead, bar, first, dotted, score};
        }
      }
    }
  }
  return {beats, parts, pace, ...best};
}
