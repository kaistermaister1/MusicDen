import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseMidi, buildMidi} from '../../app/ui/midi.js';
import {handsMidi} from '../../app/ui/sheet.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = name => parseMidi(new Uint8Array(fs.readFileSync(path.join(here, '..', 'fixtures', name))));
/* A note by pitch and time. `timeOf` turns the engraver's steady 120 beats a minute back into the piece's seconds. */
const key = (n, timeOf = t => t) => [n.midi, timeOf(n.start).toFixed(5), timeOf(n.end).toFixed(5)].join(',');
const metas = (piece, type) => piece.source.tracks.flatMap(tr => tr.events.filter(ev => ev.status === 0xff && ev.type === type));

test('each hand becomes a track of the file for the engraver, the higher hand first', () => {
  for (const [name, order] of [['Chop-28-4.mid', [0, 1]], ['wtk1-prelude1.mid', [1, 0]], ['gymnopedie_1.mid', [0, 1]]]) {
    const piece = fixture(name), job = handsMidi(piece), back = parseMidi(job.midi);
    assert.deepEqual(job.order, order, name);
    assert.equal(job.staves, 2);
    assert.equal(job.divided, '');
    order.forEach((track, staff) => {
      const want = piece.notes.filter(n => n.track === track).map(n => key(n)).sort(), got = back.notes.filter(n => n.track === staff).map(n => key(n, job.timeOf)).sort();
      assert.deepEqual(got, want, `${name}: staff ${staff + 1} holds track ${track}, every note at its own time`);
    });
    assert.ok(Math.abs(job.timeOf(back.duration) - piece.duration) < 1e-6);
  }
});

test('notes moved to the other hand move to the other track', () => {
  const piece = fixture('Chop-28-4.mid'), moved = piece.notes.filter(n => n.track === 1).slice(0, 40);
  for (const n of moved) n.track = 0;
  const job = handsMidi(piece), back = parseMidi(job.midi);
  assert.deepEqual(back.tracks.map(t => t.count), [79 + 40, 521 - 40]);
  assert.deepEqual(back.notes.filter(n => n.track === 0).map(n => key(n, job.timeOf)).sort(), piece.notes.filter(n => n.track === 0).map(n => key(n)).sort());
});

test('a song with all its notes in one track is divided by the hands it is given, or at middle C', () => {
  const src = fixture('wtk1-prelude1.mid'), evs = [{tick: 0, data: [0xff, 0x51, 3, 0x0f, 0x42, 0x40]}];
  for (const n of src.notes) evs.push({tick: n.on.tick, data: [0x90, n.midi, n.on.b]}, {tick: n.off.tick, data: [0x80, n.midi, 0]});
  const piece = parseMidi(buildMidi(384, [evs])), job = handsMidi(piece), back = parseMidi(job.midi);
  assert.equal(job.divided, 'middle');
  assert.equal(job.staves, 2);
  assert.ok(back.notes.every(n => (n.track === 0) === (n.midi >= 60)));
  assert.equal(back.notes.length, piece.notes.length);
  /* given a hand for each note, the right-hand notes make the upper staff whatever their pitch */
  const right = piece.notes.map((n, i) => i % 3 ? '1' : '0').join(''), told = handsMidi(piece, right), sorted = parseMidi(told.midi);
  assert.equal(told.divided, 'script');
  assert.deepEqual(sorted.notes.filter(n => n.track === 0).map(n => key(n, told.timeOf)).sort(), piece.notes.filter((n, i) => i % 3).map(n => key(n)).sort());
  assert.deepEqual(sorted.notes.filter(n => n.track === 1).map(n => key(n, told.timeOf)).sort(), piece.notes.filter((n, i) => !(i % 3)).map(n => key(n)).sort());
  assert.equal(handsMidi(piece, '1'.repeat(piece.notes.length)).staves, 1);
  /* a second, empty hand added for editing changes nothing until a note is moved into it */
  piece.tracks.push({name: 'Left hand', src: null, ch: 0, count: 0, muted: false});
  assert.equal(handsMidi(piece).divided, 'middle');
  piece.notes[0].track = 1;
  const edited = handsMidi(piece, right);
  assert.equal(edited.divided, '', 'with notes in two tracks the tracks decide, not the hands given');
  assert.deepEqual(parseMidi(edited.midi).tracks.map(t => t.count).sort((a, b) => a - b), [1, piece.notes.length - 1]);
  /* notes all on one side of middle C make a single staff */
  const high = parseMidi(buildMidi(480, [[{tick: 0, data: [0x90, 72, 80]}, {tick: 480, data: [0x80, 72, 0]}]]));
  assert.equal(handsMidi(high).staves, 1);
});

test('meter and the first key signature are carried over, the key in each hand; tempo is left out and timeOf makes up for it', () => {
  const head = [
    {tick: 0, data: [0xff, 0x51, 3, 0x07, 0xa1, 0x20]}, {tick: 0, data: [0xff, 0x58, 4, 3, 2, 24, 8]}, {tick: 0, data: [0xff, 0x59, 2, 2, 0]},
    {tick: 1440, data: [0xff, 0x51, 3, 0x0f, 0x42, 0x40]}, {tick: 1440, data: [0xff, 0x58, 4, 4, 2, 24, 8]}, {tick: 1440, data: [0xff, 0x59, 2, 0xfd, 0]}
  ];
  const hand = pitch => [{tick: 0, data: [0x90, pitch, 80]}, {tick: 1440, data: [0x80, pitch, 0]}, {tick: 1440, data: [0x90, pitch + 2, 80]}, {tick: 3360, data: [0x80, pitch + 2, 0]}];
  /* the same key signature repeated in both hands, as notation programs write it */
  const piece = parseMidi(buildMidi(480, [head, [{tick: 0, data: [0xff, 0x59, 2, 2, 0]}, ...hand(72)], [{tick: 0, data: [0xff, 0x59, 2, 2, 0]}, ...hand(48)]]));
  const job = handsMidi(piece), back = parseMidi(job.midi);
  assert.deepEqual(metas(back, 0x51), []);
  assert.deepEqual(metas(back, 0x58).map(ev => [ev.tick, ev.raw[3]]), [[0, 3], [1440, 4]]);
  assert.deepEqual(back.source.tracks.map(tr => tr.events.filter(ev => ev.status === 0xff && ev.type === 0x59).map(ev => [ev.tick, ev.raw[3]])), [[], [[0, 2]], [[0, 2]]]);
  /* the piece runs 1.5 s at 120 beats a minute and then 4 s at 60; the engraver's file runs 7 beats at 120 */
  assert.deepEqual(piece.notes.map(n => n.end), [1.5, 1.5, 5.5, 5.5]);
  assert.deepEqual(back.notes.map(n => n.end), [1.5, 1.5, 3.5, 3.5]);
  assert.deepEqual(back.notes.map(n => key(n, job.timeOf)).sort(), piece.notes.map(n => key(n)).sort());
});

test('a file timed in frames keeps every note at its time', () => {
  const evs = [{tick: 0, data: [0x90, 60, 80]}, {tick: 500, data: [0x80, 60, 0]}, {tick: 500, data: [0x90, 67, 80]}, {tick: 1250, data: [0x80, 67, 0]}];
  const lower = [{tick: 0, data: [0x90, 40, 80]}, {tick: 1250, data: [0x80, 40, 0]}];
  const bytes = buildMidi(480, [evs, lower]);
  new DataView(bytes.buffer).setUint16(12, 0xe728);   /* 25 frames a second, 40 ticks a frame: 1000 ticks a second */
  const piece = parseMidi(bytes), job = handsMidi(piece), back = parseMidi(job.midi);
  assert.deepEqual(piece.notes.map(n => n.start), [0, 0, 0.5]);
  for (const n of piece.notes) {
    const twin = back.notes.find(m => m.midi === n.midi);
    assert.ok(Math.abs(job.timeOf(twin.start) - n.start) < 0.001 && Math.abs(job.timeOf(twin.end) - n.end) < 0.001, 'note ' + n.midi);
  }
});
