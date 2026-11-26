import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseMidi, writeMidi, buildMidi, isEdited} from '../../app/ui/midi.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtures = path.join(here, '..', 'fixtures');
const files = fs.readdirSync(fixtures).filter(f => /\.midi?$/i.test(f));

/* Everything in a file that is not a note, per track: tick, status and data bytes, in order. */
function others(piece) {
  return piece.source.tracks.map(tr => tr.events
    .filter(ev => !ev.note && !(ev.status === 0xff && ev.type === 0x2f))
    .map(ev => ev.tick + ':' + ev.status.toString(16) + ':' + Buffer.from(ev.running || ev.status < 0x80 || ev.status >= 0xf0 ? ev.raw : ev.raw.subarray(1)).toString('hex')));
}
const noteKey = n => [n.on.tick, n.off.tick, n.midi, n.on.b, n.off.b, (n.off.status & 0xf0).toString(16)].join(',');
const same = (a, b) => a.length === b.length && Buffer.compare(Buffer.from(a), Buffer.from(b)) === 0;

/* A two-hand file with tempo changes, pedal, running status, a sysex, text and a zero-length note. */
function sample() {
  const right = [
    {tick: 0, data: [0xff, 0x03, 5, ...Buffer.from('Right')]},
    {tick: 0, data: [0xc0, 0]},
    {tick: 0, data: [0xb0, 64, 127]},
    {tick: 0, data: [0x90, 60, 80]}, {tick: 240, data: [0x80, 60, 33]},
    {tick: 240, data: [0x90, 64, 70]}, {tick: 480, data: [0x90, 64, 0]},
    {tick: 480, data: [0xb0, 64, 0]},
    {tick: 480, data: [0xf0, 3, 0x7e, 0x7f, 0xf7]},
    {tick: 480, data: [0x90, 67, 90]}, {tick: 480, data: [0x80, 67, 0]},
    {tick: 600, data: [0xe0, 0, 64]},
    {tick: 720, data: [0x90, 72, 100]}, {tick: 1200, data: [0x80, 72, 64]}
  ];
  const left = [
    {tick: 0, data: [0xff, 0x03, 4, ...Buffer.from('Left')]},
    {tick: 0, data: [0x91, 36, 60]}, {tick: 960, data: [0x81, 36, 0]},
    {tick: 960, data: [0xff, 0x01, 2, 0x68, 0x69]},
    {tick: 960, data: [0x91, 43, 62]}, {tick: 1900, data: [0x81, 43, 0]}
  ];
  const lead = [{tick: 0, data: [0xff, 0x51, 3, 0x07, 0xa1, 0x20]}, {tick: 0, data: [0xff, 0x58, 4, 4, 2, 24, 8]}, {tick: 960, data: [0xff, 0x51, 3, 0x0b, 0x71, 0xb0]}];
  return buildMidi(480, [lead, right, left]);
}

test('a file with no moves is written back identical', () => {
  for (const bytes of [sample(), ...files.map(f => new Uint8Array(fs.readFileSync(path.join(fixtures, f))))]) {
    const piece = parseMidi(bytes);
    assert.equal(isEdited(piece), false);
    assert.ok(same(writeMidi(piece), bytes));
  }
});

test('moving notes keeps every other event, and moving them back restores the file', () => {
  const inputs = [['sample', sample()], ...files.map(f => [f, new Uint8Array(fs.readFileSync(path.join(fixtures, f)))])];
  for (const [name, bytes] of inputs) {
    const piece = parseMidi(bytes);
    if (piece.tracks.length < 2) continue;
    const before = others(piece), keysBefore = piece.notes.map(noteKey).sort();
    const picked = piece.notes.filter((n, i) => i % 3 === 0);
    const want = new Map();
    for (const n of picked) { n.track = (n.track + 1) % piece.tracks.length; want.set(noteKey(n) + '@' + n.start.toFixed(6), piece.tracks[n.track].src); }
    const out = writeMidi(piece);
    assert.ok(!same(out, bytes), name + ': the file changed');

    const again = parseMidi(out);
    assert.deepEqual(others(again), before, name + ': events other than notes');
    assert.deepEqual(again.notes.map(noteKey).sort(), keysBefore, name + ': notes keep pitch, timing and velocity');
    assert.equal(again.duration, piece.duration);
    for (const n of again.notes) {
      const to = want.get(noteKey(n) + '@' + n.start.toFixed(6));
      if (to !== undefined) assert.equal(again.tracks[n.track].src, to, name + ': moved note is in the other track');
    }
    /* tracks nothing moved through are byte-identical */
    const touched = new Set(picked.flatMap(n => [piece.tracks[n.home].src, piece.tracks[n.track].src]));
    piece.source.chunks.forEach((c, i) => {
      if (c.track < 0 || touched.has(c.track)) return;
      const d = again.source.chunks[i];
      assert.ok(same(out.subarray(d.start, d.end), bytes.subarray(c.start, c.end)), name + ': untouched track ' + c.track);
    });

    for (const n of picked) n.track = n.home;
    assert.ok(same(writeMidi(piece), bytes), name + ': restored');
  }
});

test('a one-track file gains a second track for the other hand', () => {
  const only = buildMidi(480, [[
    {tick: 0, data: [0xff, 0x51, 3, 0x07, 0xa1, 0x20]},
    {tick: 0, data: [0xb0, 64, 127]},
    {tick: 0, data: [0x90, 48, 70]}, {tick: 0, data: [0x90, 72, 80]},
    {tick: 480, data: [0x80, 48, 0]}, {tick: 480, data: [0x80, 72, 0]},
    {tick: 480, data: [0x90, 50, 70]}, {tick: 960, data: [0x80, 50, 0]},
    {tick: 960, data: [0xb0, 64, 0]}
  ]]);
  new DataView(only.buffer).setUint16(8, 0);
  const piece = parseMidi(only);
  assert.equal(piece.tracks.length, 1);
  const before = others(piece);
  piece.tracks.push({name: 'Left hand', src: null, ch: piece.tracks[0].ch, count: 0, muted: false});
  for (const n of piece.notes) if (n.midi < 60) n.track = 1;
  const out = writeMidi(piece), v = new DataView(out.buffer);
  assert.equal(v.getUint16(8), 1, 'format 1');
  assert.equal(v.getUint16(10), 2, 'two tracks');
  const again = parseMidi(out);
  assert.equal(again.tracks.length, 2);
  assert.equal(again.tracks[1].name, 'Left hand');
  assert.deepEqual(again.notes.filter(n => n.track === 1).map(n => n.midi).sort(), [48, 50]);
  assert.deepEqual(others(again)[0], before[0]);
  /* the pedal still holds the moved notes: same channel, so they ring until it lifts */
  const low = again.notes.find(n => n.midi === 48);
  assert.ok(low.soundEnd > low.end);
});

test('the pedal in one track sustains notes in another on the same channel', () => {
  const bytes = buildMidi(480, [
    [{tick: 0, data: [0xb0, 64, 127]}, {tick: 0, data: [0x90, 72, 80]}, {tick: 240, data: [0x80, 72, 0]}, {tick: 960, data: [0xb0, 64, 0]}],
    [{tick: 0, data: [0x90, 48, 80]}, {tick: 240, data: [0x80, 48, 0]}]
  ]);
  const piece = parseMidi(bytes);
  const low = piece.notes.find(n => n.midi === 48);
  assert.ok(Math.abs(low.end - 0.25) < 1e-9);
  assert.ok(Math.abs(low.soundEnd - 1) < 1e-9);
});

test('files that are not MIDI are refused', () => {
  assert.throws(() => parseMidi(new Uint8Array(40)), {code: 'not-midi'});
  assert.throws(() => parseMidi(buildMidi(480, [[{tick: 0, data: [0xff, 0x51, 3, 7, 0xa1, 0x20]}]])), {code: 'empty'});
});
