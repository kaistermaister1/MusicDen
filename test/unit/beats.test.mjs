import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseMidi, buildMidi} from '../../app/ui/midi.js';
import {isFreeTime, findBeats, beatAt, timeAt} from '../../app/ui/beats.js';
import {handsMidi} from '../../app/ui/sheet.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = name => parseMidi(new Uint8Array(fs.readFileSync(path.join(here, '..', 'fixtures', name))));

/* A piece as someone might play it and a recording would give it back: the pace wanders by
   `sway`, no two notes land exactly together, and the file says nothing of tempo or meter.
   Returns the piece, read back from such a file, and the moments of its true quarter notes. */
function played(piece, sway, seed = 7) {
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648, bell = sd => (rnd() + rnd() + rnd() + rnd() - 2) * 1.73 * sd;
  const tempo = piece.source.tracks.flatMap(tr => tr.events).find(ev => ev.tempo).tempo / 1e6, a = rnd() * 6;
  const when = t => t + sway * 4 * Math.sin(t / 6 + a) + sway * Math.sin(t / 1.7) + 1;
  const tracks = piece.tracks.map(() => [{tick: 0, data: [0xc0, 0]}]);
  for (const n of piece.notes) {
    const start = when(n.start) + bell(0.012), end = Math.max(start + 0.05, when(n.end) + bell(0.02));
    tracks[n.track].push({tick: Math.round(start * 960), data: [0x90, n.midi, n.on.b]}, {tick: Math.round(end * 960), data: [0x80, n.midi, 0]});
  }
  const truth = [];
  for (let q = 0; q * tempo <= piece.duration + tempo; q++) truth.push(when(q * tempo));
  return {piece: parseMidi(buildMidi(480, tracks)), truth};
}
/* Share of the beats found, within the stretch the true ones cover, that sit within 70 ms of a true quarter or eighth. */
function onTrue(beats, truth) {
  const all = [...truth, ...truth.slice(0, -1).map((t, i) => (t + truth[i + 1]) / 2)];
  const inside = beats.filter(b => b >= truth[0] - 0.05 && b <= truth[truth.length - 1] + 0.05);
  return inside.filter(b => all.some(t => Math.abs(t - b) <= 0.07)).length / inside.length;
}

test('a piece written from notation is not in free time; the same piece as played is', () => {
  for (const name of ['wtk1-prelude1.mid', 'Chop-28-4.mid', 'gymnopedie_1.mid']) {
    const piece = fixture(name);
    assert.equal(isFreeTime(piece), false, name);
    assert.equal(isFreeTime(played(piece, 0.08).piece), true, name + ' as played');
  }
});

test('the beats found in a played piece are its true beats', () => {
  for (const name of ['wtk1-prelude1.mid', 'Chop-28-4.mid', 'gymnopedie_1.mid']) {
    for (const sway of [0.04, 0.12]) {
      const {piece, truth} = played(fixture(name), sway), found = findBeats(piece.notes), share = onTrue(found.beats, truth);
      assert.ok(share >= 0.93, `${name} sway ${sway}: ${(share * 100).toFixed(0)}% of beats on a true beat`);
      assert.ok(found.beats[0] <= piece.notes[0].start + 0.02 && found.beats[found.beats.length - 1] >= piece.duration, 'beats cover the whole piece');
      for (let i = 1; i < found.beats.length; i++) assert.ok(found.beats[i] > found.beats[i - 1], 'beats run forward');
    }
  }
});

test('the written beat and the measure are read from where the heavy strokes fall', () => {
  const waltz = findBeats(played(fixture('gymnopedie_1.mid'), 0.08).piece.notes);
  assert.deepEqual([waltz.bar, waltz.dotted, waltz.group], [3, false, 1], 'Satie: three quarters to the measure');
  assert.ok(Math.abs(waltz.pace - 1) < 0.08, 'at the written 60 a minute: ' + waltz.pace);
  const bach = findBeats(played(fixture('wtk1-prelude1.mid'), 0.08).piece.notes);
  assert.equal(bach.dotted, false);
  assert.ok(Math.abs(bach.pace * bach.group - 1) < 0.08, 'Bach: the written quarter of one second, from eighths taken two at a time: ' + bach.pace * bach.group);
  assert.ok(bach.bar === 2 || bach.bar === 4);
  const chopin = findBeats(played(fixture('Chop-28-4.mid'), 0.08).piece.notes);
  assert.deepEqual([chopin.bar, chopin.dotted], [4, false]);
});

test('running sixteenths in sixes are read as six-eight time', () => {
  /* two dotted-quarter beats of 0.8 s to the measure: the left hand rises through six sixteenths from a bass note on each beat, the right hand holds a note */
  let seed = 3;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648, bell = sd => (rnd() + rnd() + rnd() + rnd() - 2) * 1.73 * sd;
  const low = [{tick: 0, data: [0xc0, 0]}], high = [{tick: 0, data: [0xc0, 0]}], sec = t => Math.round((t + 0.5 + 0.2 * Math.sin(t / 5)) * 960);
  for (let beat = 0; beat < 64; beat++) {
    const root = [37, 44, 42, 39][(beat >> 1) % 4], t = beat * 0.8;
    [0, 7, 12, 16, 19, 24].forEach((step, i) => { const at = t + i * 0.8 / 6 + bell(0.008); low.push({tick: sec(at), data: [0x90, root + step, i ? 60 : 90]}, {tick: sec(at + 0.12), data: [0x80, root + step, 0]}); });
    if (beat % 2 === 0 || beat % 8 === 5) high.push({tick: sec(t + bell(0.008)), data: [0x90, 73 + (beat % 5), 85]}, {tick: sec(t + 0.7), data: [0x80, 73 + (beat % 5), 0]});
  }
  const found = findBeats(parseMidi(buildMidi(480, [high, low])).notes);
  assert.equal(found.dotted, true);
  assert.ok(Math.abs(found.pace * found.group - 0.8) < 0.06, 'a dotted-quarter beat of 0.8 s: ' + found.pace * found.group);
  assert.equal(found.bar, 2, 'six-eight rather than nine-eight or twelve-eight');
});

test('a place among the beats and its moment turn into each other', () => {
  const beats = [1, 1.5, 2.1, 2.6, 3.3];
  for (const t of [0.4, 1, 1.2, 2.1, 2.9, 3.3, 4]) assert.ok(Math.abs(timeAt(beats, beatAt(beats, t)) - t) < 1e-9, 'at ' + t);
  assert.equal(beatAt(beats, 1.8), 1.5);
  assert.equal(beatAt(beats, 0.5), -1);
});

test('a played piece is written by its beats, and the written times lead back to the playing', () => {
  const {piece} = played(fixture('Chop-28-4.mid'), 0.1), found = findBeats(piece.notes), job = handsMidi(piece, null, found), back = parseMidi(job.midi);
  assert.equal(job.free.time, '4/4');
  assert.equal(job.staves, 2);
  assert.equal(back.notes.length, piece.notes.length);
  assert.deepEqual(back.tracks.map(t => t.count), [79, 521], 'each hand keeps its notes');
  /* halves, thirds, quarters, sixths and eighths of a 480-tick beat all fall on multiples of 20 */
  assert.ok(back.notes.every(n => n.on.tick % 20 === 0), 'every note starts on a simple cut of a beat');
  const meter = back.source.tracks.flatMap(tr => tr.events).filter(ev => ev.status === 0xff && ev.type === 0x58);
  assert.deepEqual(meter.map(ev => [ev.tick, ev.raw[3], 1 << ev.raw[4]]), [[0, 4, 4]], 'one time signature, at the start');
  /* note for note, by pitch and order: the written start, taken back through timeOf, is close to when the note was played */
  const off = [];
  for (let pitch = 0; pitch < 128; pitch++) {
    const was = piece.notes.filter(n => n.midi === pitch), now = back.notes.filter(n => n.midi === pitch);
    was.forEach((n, i) => off.push(Math.abs(job.timeOf(now[i].on.tick / 960) - n.start)));
  }
  off.sort((a, b) => a - b);
  assert.ok(off[off.length >> 1] < 0.02 && off[Math.floor(off.length * 0.95)] < 0.06, `written starts lead back to the played ones: median ${(off[off.length >> 1] * 1000).toFixed(0)} ms, 95% within ${(off[Math.floor(off.length * 0.95)] * 1000).toFixed(0)} ms`);
  /* no note outlasts the next stroke in its own hand */
  for (const track of [0, 1]) {
    const hand = back.notes.filter(n => n.track === track), starts = [...new Set(hand.map(n => n.on.tick))].sort((a, b) => a - b);
    for (const n of hand) { const next = starts[starts.indexOf(n.on.tick) + 1]; assert.ok(next === undefined || n.off.tick <= next); }
  }
});

test('a piece on its own grid is written as before, whether or not beats are asked for', () => {
  const piece = fixture('Chop-28-4.mid'), job = handsMidi(piece);
  assert.equal(job.free, null);
  assert.deepEqual(parseMidi(job.midi).notes.map(n => n.on.tick), piece.notes.map(n => n.on.tick).sort((a, b) => a - b));
});
