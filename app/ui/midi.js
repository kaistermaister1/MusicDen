/* Standard MIDI Files, read into notes for the stage and written back with notes moved
   between tracks. Every byte that is not a moved note stays where it was: tracks nothing
   moved in or out of are copied as they were read, and a file with no moves comes back identical. */

export class MidiError extends Error {
  constructor(code) { super(code); this.code = code; }
}

const text = bytes => {
  try { return new TextDecoder('utf-8', {fatal: true}).decode(bytes); }
  catch (e) { return new TextDecoder('windows-1252').decode(bytes); }
};
const isEnd = ev => ev.status === 0xff && ev.type === 0x2f;

/* One MTrk body as a list of events. Each event keeps the bytes it was read from (`raw`, without
   the delta time), so it can be written back unchanged. `running` marks a channel event whose
   status byte was left out in the file. */
function readTrack(bytes, start, end) {
  const events = [];
  let p = start, tick = 0, running = 0, name = '';
  const varLen = () => { let v = 0, b; do { b = bytes[p++]; v = v * 128 + (b & 0x7f); } while ((b & 0x80) && p < end); return v; };
  while (p < end) {
    tick += varLen();
    if (p >= end) break;
    const at = p;
    let st = bytes[p], wasRunning = false;
    if (st & 0x80) p++; else { st = running; wasRunning = true; }
    const ev = {tick, status: st, type: -1, a: 0, b: 0, raw: null, running: false, note: null};
    if (st === 0xff) {
      ev.type = bytes[p++];
      const len = varLen(), from = p;
      p = Math.min(end, p + len);
      if (ev.type === 0x51 && len === 3) ev.tempo = (bytes[from] << 16) | (bytes[from + 1] << 8) | bytes[from + 2];
      else if (ev.type === 0x03 && !name) name = text(bytes.subarray(from, p)).trim();
    } else if (st === 0xf0 || st === 0xf7) {
      const len = varLen();
      p = Math.min(end, p + len);
    } else if (st >= 0x80 && st < 0xf0) {
      const kind = st & 0xf0, need = kind === 0xc0 || kind === 0xd0 ? 1 : 2;
      if (p + need > end) { p = end; ev.status = 0; }
      else { ev.a = bytes[p]; ev.b = need === 2 ? bytes[p + 1] : 0; p += need; running = st; ev.running = wasRunning; }
    } else if (st >= 0xf1) {
      p = Math.min(end, p + (st === 0xf2 ? 2 : st === 0xf1 || st === 0xf3 ? 1 : 0));
    } else {
      /* a data byte with no status before it: kept as it is so it can be written back */
      p++; ev.status = 0;
    }
    ev.raw = bytes.subarray(at, p);
    events.push(ev);
  }
  return {events, name};
}

/* `nameTrack(n)` supplies the label for a track the file leaves unnamed. */
export function parseMidi(input, title = '', nameTrack = n => 'Track ' + n) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = p => String.fromCharCode(bytes[p], bytes[p + 1], bytes[p + 2], bytes[p + 3]);
  if (bytes.length < 14 || tag(0) !== 'MThd') throw new MidiError('not-midi');
  const headEnd = 8 + view.getUint32(4), format = view.getUint16(8), division = view.getUint16(12);
  if (division === 0 || headEnd > bytes.length) throw new MidiError('not-midi');

  const chunks = [], tracks = [];
  let p = headEnd;
  while (p + 8 <= bytes.length) {
    const start = p, end = Math.min(bytes.length, p + 8 + view.getUint32(p + 4));
    if (tag(p) === 'MTrk') { tracks.push(readTrack(bytes, p + 8, end)); chunks.push({start, end, track: tracks.length - 1}); }
    else chunks.push({start, end, track: -1});
    p = end;
  }

  /* ticks to seconds: a fixed rate for SMPTE timing, otherwise the file's tempo changes */
  let toSec;
  if (division & 0x8000) {
    const fps = 256 - (division >> 8), perSec = (fps === 29 ? 29.97 : fps) * (division & 0xff);
    toSec = tick => tick / perSec;
  } else {
    const tempos = [];
    tracks.forEach((tr, ti) => tr.events.forEach((ev, seq) => { if (ev.tempo) tempos.push({tick: ev.tick, us: ev.tempo, ti, seq}); }));
    tempos.sort((a, b) => a.tick - b.tick || a.ti - b.ti || a.seq - b.seq);
    const segs = [{tick: 0, sec: 0, us: 500000}];
    for (const tp of tempos) {
      const last = segs[segs.length - 1];
      if (tp.tick === last.tick) last.us = tp.us;
      else segs.push({tick: tp.tick, sec: last.sec + (tp.tick - last.tick) * last.us / division / 1e6, us: tp.us});
    }
    toSec = tick => {
      let lo = 0, hi = segs.length - 1;
      while (lo < hi) { const m = (lo + hi + 1) >> 1; if (segs[m].tick <= tick) lo = m; else hi = m - 1; }
      const s = segs[lo];
      return s.sec + (tick - s.tick) * s.us / division / 1e6;
    };
  }

  /* Tracks on screen follow the file's tracks. A file with all its notes in one track but on
     several channels is split by channel instead. */
  const striking = ev => (ev.status & 0xf0) === 0x90 && ev.b > 0 && (ev.status & 0x0f) !== 9;
  const withNotes = tracks.map((tr, ti) => tr.events.some(striking) ? ti : -1).filter(ti => ti >= 0);
  const byChannel = withNotes.length === 1 && new Set(tracks[withNotes[0]].events.filter(striking).map(ev => ev.status & 0x0f)).size > 1;
  const groups = [], groupIndex = new Map();
  const groupOf = (ti, ch) => {
    const key = byChannel ? 'c' + ch : 't' + ti;
    let g = groupIndex.get(key);
    if (g === undefined) {
      g = groups.length; groupIndex.set(key, g);
      groups.push({name: (!byChannel && tracks[ti].name) || nameTrack(g + 1), src: ti, ch: byChannel ? ch : -1, seen: new Map()});
    }
    return g;
  };
  for (const ti of withNotes) for (const ev of tracks[ti].events) if (striking(ev)) groupOf(ti, ev.status & 0x0f);

  /* Notes and the sustain pedal, in the order they sound. A key's press and release pair up
     inside their own track; the pedal holds every note on its channel, whichever track it is in. */
  const stream = [];
  tracks.forEach((tr, ti) => tr.events.forEach((ev, seq) => {
    const kind = ev.status & 0xf0;
    if ((ev.status & 0x0f) === 9) return;
    if (kind === 0x90 || kind === 0x80 || (kind === 0xb0 && ev.a === 64)) stream.push({ev, ti, seq});
  }));
  stream.sort((a, b) => a.ev.tick - b.ev.tick || a.ti - b.ti || a.seq - b.seq);
  const notes = [], open = tracks.map(() => new Map()), held = new Map(), pedal = new Map();
  for (const {ev, ti} of stream) {
    const kind = ev.status & 0xf0, ch = ev.status & 0x0f, t = toSec(ev.tick);
    if (kind === 0xb0) {
      const down = ev.b >= 64;
      pedal.set(ch, down);
      if (!down) for (const [k, n] of held) if ((k >> 7) === ch) { n.soundEnd = Math.max(n.end, t); held.delete(k); }
      continue;
    }
    const key = (ch << 7) | ev.a;
    if (kind === 0x90 && ev.b > 0) {
      const ringing = held.get(key);
      if (ringing) { ringing.soundEnd = Math.max(ringing.end, t); held.delete(key); }
      const g = groupOf(ti, ch);
      const n = {midi: ev.a, start: t, end: t, soundEnd: t, vel: ev.b / 127, track: g, home: g, on: ev, off: null};
      if (!open[ti].has(key)) open[ti].set(key, []);
      open[ti].get(key).push(n);
    } else {
      const q = open[ti].get(key);
      if (!q || !q.length) continue;
      const n = q.shift();
      n.off = ev; n.on.note = n; ev.note = n;
      n.end = Math.max(t, n.start + 0.03); n.soundEnd = n.end;
      if (pedal.get(ch)) held.set(key, n);
      groups[n.track].seen.set(ch, (groups[n.track].seen.get(ch) || 0) + 1);
      notes.push(n);
    }
  }
  for (const n of held.values()) n.soundEnd = n.end + 1.5;
  if (!notes.length) throw new MidiError('empty');
  for (const g of groups) {
    if (g.ch < 0) { let best = 0, most = -1; for (const [ch, count] of g.seen) if (count > most) { most = count; best = ch; } g.ch = best; }
    delete g.seen;
  }
  /* `source` is the file as it was read, with its timing: ticks to a beat, and `toSec` from a tick to seconds */
  return finishPiece({title, by: '', notes, tracks: groups, source: {bytes, headEnd, format, chunks, tracks, division, toSec}});
}

/* Fills in what the stage needs to know about a piece as a whole. */
export function finishPiece(p) {
  p.notes.sort((a, b) => a.start - b.start);
  let dur = 0, longest = 0, lo = 127, hi = 0;
  p.tracks.forEach(tr => { tr.count = 0; tr.muted = !!tr.muted; });
  for (const n of p.notes) {
    dur = Math.max(dur, n.end);
    longest = Math.max(longest, n.end - n.start);
    lo = Math.min(lo, n.midi); hi = Math.max(hi, n.midi);
    p.tracks[n.track].count++;
  }
  p.duration = dur; p.longest = longest; p.lo = lo; p.hi = hi;
  p.soundEnd = p.notes.reduce((m, n) => Math.max(m, n.soundEnd), dur);
  let fitLo = Math.floor(lo / 12) * 12, fitHi = Math.ceil((hi + 1) / 12) * 12;
  while (fitHi - fitLo < 36) { if (fitLo > 24) fitLo -= 12; if (fitHi - fitLo < 36 && fitHi < 108) fitHi += 12; if (fitLo <= 24 && fitHi >= 108) break; }
  p.fitLo = Math.max(21, fitLo); p.fitHi = Math.min(108, fitHi);
  return p;
}

/* True when some note sits in a different track than the file has it in. */
export const isEdited = p => p.notes.some(n => n.track !== n.home);

const pushVar = (out, v) => {
  const stack = [v & 0x7f];
  while ((v = Math.floor(v / 128)) > 0) stack.push((v & 0x7f) | 0x80);
  for (let i = stack.length - 1; i >= 0; i--) out.push(stack[i]);
};
function encode(items) {
  const out = [];
  let at = 0, run = 0;
  for (const it of items) {
    pushVar(out, it.tick - at); at = it.tick;
    const ev = it.ev, st = ev.status;
    if (st >= 0x80 && st < 0xf0) {
      const status = it.ch >= 0 ? (st & 0xf0) | it.ch : st;
      /* a status byte is left out only where the file left it out and it still follows from the event before */
      if (it.moved || !ev.running || run !== status) out.push(status);
      run = status;
      for (let i = ev.running ? 0 : 1; i < ev.raw.length; i++) out.push(ev.raw[i]);
    } else {
      for (let i = 0; i < ev.raw.length; i++) out.push(ev.raw[i]);
    }
  }
  return out;
}
const chunk = body => {
  const out = new Uint8Array(8 + body.length);
  out.set([0x4d, 0x54, 0x72, 0x6b]);
  new DataView(out.buffer).setUint32(4, body.length);
  out.set(body, 8);
  return out;
};

/* The file's bytes with each note in the track of the hand it now belongs to. */
export function writeMidi(p) {
  const src = p.source, groups = p.tracks;
  const moved = p.notes.filter(n => n.track !== n.home);
  if (!moved.length) return src.bytes.slice();

  const touched = new Set(), arriving = new Map(), added = new Map();
  for (const n of moved) {
    const from = groups[n.home].src, to = groups[n.track].src;
    touched.add(from);
    if (to == null) { if (!added.has(n.track)) added.set(n.track, []); added.get(n.track).push(n); }
    else if (to !== from) { touched.add(to); if (!arriving.has(to)) arriving.set(to, []); arriving.get(to).push(n); }
  }
  /* A moved note's release goes ahead of everything else on its tick and its press after, so a key
     struck again on the same tick is released first. */
  const place = (items, list) => {
    let k = 0;
    for (const n of list) {
      const ch = groups[n.track].ch, same = n.off.tick === n.on.tick;
      items.push({tick: n.on.tick, rank: 2, seq: k++, ev: n.on, ch, moved: true});
      items.push({tick: n.off.tick, rank: same ? 3 : 0, seq: k++, ev: n.off, ch, moved: true});
    }
    items.sort((a, b) => a.tick - b.tick || a.rank - b.rank || a.seq - b.seq);
  };
  const rewrite = ti => {
    const items = [];
    src.tracks[ti].events.forEach((ev, seq) => {
      const n = ev.note;
      if (n && n.track !== n.home) {
        if (groups[n.track].src !== ti) return;
        items.push({tick: ev.tick, rank: 1, seq, ev, ch: groups[n.track].ch, moved: false});
      } else items.push({tick: ev.tick, rank: 1, seq, ev, ch: -1, moved: false});
    });
    const last = items.length && isEnd(items[items.length - 1].ev) ? items.pop() : null;
    place(items, arriving.get(ti) || []);
    if (last) { last.tick = Math.max(last.tick, items.length ? items[items.length - 1].tick : 0); items.push(last); }
    return chunk(encode(items));
  };
  const fresh = (name, list) => {
    const label = new TextEncoder().encode(name).subarray(0, 127), items = [];
    place(items, list);
    const head = [0, 0xff, 0x03, label.length, ...label], body = encode(items);
    return chunk([...head, ...body, 0, 0xff, 0x2f, 0]);
  };

  const parts = [src.bytes.slice(0, src.headEnd)];
  const lastTrack = src.chunks.reduce((at, c, i) => c.track >= 0 ? i : at, -1);
  let count = 0;
  src.chunks.forEach((c, i) => {
    parts.push(c.track >= 0 && touched.has(c.track) ? rewrite(c.track) : src.bytes.subarray(c.start, c.end));
    if (c.track >= 0) count++;
    if (i === lastTrack) for (const [g, list] of [...added].sort((a, b) => a[0] - b[0])) { parts.push(fresh(groups[g].name, list)); count++; }
  });
  const end = src.chunks.length ? src.chunks[src.chunks.length - 1].end : src.headEnd;
  parts.push(src.bytes.subarray(end));

  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) { out.set(part, at); at += part.length; }
  const head = new DataView(out.buffer);
  if (src.format === 0 && count > 1) head.setUint16(8, 1);
  head.setUint16(10, head.getUint16(10) + added.size);
  return out;
}

/* Builds a MIDI file from scratch. `tracks` is a list of event lists: {tick, data: [bytes]}. */
export function buildMidi(division, tracks) {
  const bodies = tracks.map(evs => {
    const sorted = evs.map((e, i) => ({e, i})).sort((a, b) => a.e.tick - b.e.tick || a.i - b.i), body = [];
    let at = 0;
    for (const {e} of sorted) { pushVar(body, e.tick - at); body.push(...e.data); at = e.tick; }
    body.push(0, 0xff, 0x2f, 0);
    return chunk(body);
  });
  const out = new Uint8Array(14 + bodies.reduce((sum, b) => sum + b.length, 0)), v = new DataView(out.buffer);
  out.set([0x4d, 0x54, 0x68, 0x64]); v.setUint32(4, 6); v.setUint16(8, 1); v.setUint16(10, bodies.length); v.setUint16(12, division);
  let at = 14;
  for (const b of bodies) { out.set(b, at); at += b.length; }
  return out;
}
