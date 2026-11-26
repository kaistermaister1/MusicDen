/* Changes hands by clicking and dragging notes in the real window, then checks the song's file on
   disk byte by byte and opens the result in MuseScore to see which staff each note landed on. */
import {launch, songFolder, out, root} from './harness.mjs';
import {parseMidi, buildMidi} from '../../app/ui/midi.js';
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';

const MUSESCORE = 'C:/Program Files/MuseScore 4/bin/MuseScore4.exe';
const folder = songFolder(['wtk1-prelude1.mid']);
const file = path.join(folder, 'wtk1-prelude1.mid'), original = fs.readFileSync(file);

/* a one-track version of the same piece, both hands on one channel */
{
  const p = parseMidi(new Uint8Array(original)), evs = [{tick: 0, data: [0xff, 0x51, 3, 0x0b, 0x71, 0xb0]}, {tick: 0, data: [0xc0, 0]}];
  for (const n of p.notes) evs.push({tick: n.on.tick, data: [0x90, n.midi, n.on.b]}, {tick: n.off.tick, data: [0x80, n.midi, 0]});
  const bytes = buildMidi(384, [evs]);
  new DataView(bytes.buffer).setUint16(8, 0);
  fs.writeFileSync(path.join(folder, 'one-track.mid'), bytes);
}
const oneFile = path.join(folder, 'one-track.mid'), oneOriginal = fs.readFileSync(oneFile);

const others = piece => piece.source.tracks.map(tr => tr.events.filter(ev => !ev.note && !(ev.status === 0xff && ev.type === 0x2f))
  .map(ev => ev.tick + ':' + ev.status.toString(16) + ':' + Buffer.from(ev.running || ev.status < 0x80 || ev.status >= 0xf0 ? ev.raw : ev.raw.subarray(1)).toString('hex')));
const noteKey = n => [n.on.tick, n.off.tick, n.midi, n.on.b, n.off.b].join(',');

/* Notes that start in each part and staff of a MuseScore conversion. */
function staves(midiFile, tag) {
  const xml = path.join(out, 'ms', tag + '.musicxml');
  fs.mkdirSync(path.dirname(xml), {recursive: true});
  const r = spawnSync(MUSESCORE, ['-o', xml, midiFile], {encoding: 'utf8', timeout: 120000});
  if (!fs.existsSync(xml)) throw new Error('MuseScore did not convert ' + midiFile + ' ' + r.stderr);
  const text = fs.readFileSync(xml, 'utf8'), names = [...text.matchAll(/<part-name>([^<]*)/g)].map(m => m[1]), result = {};
  text.split(/<part id="/).slice(1).forEach((part, i) => {
    for (const m of part.matchAll(/<note[ >][\s\S]*?<\/note>/g)) {
      const n = m[0];
      if (n.includes('<rest') || n.includes('<tie type="stop"')) continue;
      const staff = (n.match(/<staff>(\d+)/) || [0, '1'])[1], key = `${names[i] || 'part ' + (i + 1)} / staff ${staff}`;
      result[key] = (result[key] || 0) + 1;
    }
  });
  return result;
}

const a = await launch({folder});
const {win} = a;
/* Where the notes on screen are, in window coordinates: {x, y, midi, track, start}. */
const visible = () => win.evaluate(() => {
  const s = pv.stage, g = s.geo, r = document.getElementById('glc').getBoundingClientRect(), res = [];
  for (let i = 0; i < s.list.length; i += 5) {
    const n = s.refs[i / 5]; if (!n) continue;
    const top = Math.max(0, g.hitY - s.list[i + 2]), bottom = Math.min(g.hitY, g.hitY - s.list[i + 1]);
    if (bottom - top < 6) continue;
    res.push({x: r.left + g.x[n.midi] + g.w[n.midi] / 2, y: r.top + (top + bottom) / 2, midi: n.midi, track: n.track, start: n.start});
  }
  return res;
});
const counts = () => win.evaluate(() => pv.piece.tracks.map(t => t.count));
try {
  await win.waitForFunction(() => pv.songs.length === 2);
  await win.evaluate(() => pv.openSong('wtk1-prelude1.mid'));
  await win.locator('#lookBtn').click();
  await win.evaluate(() => { document.getElementById('insp').scrollTop = 99999; });
  await win.locator('[data-sw="editHands"]').click();
  await a.at(20);
  const before = await counts();

  /* one click */
  let notes = await visible();
  const target = notes.filter(n => n.track === 1).sort((p, q) => p.y - q.y)[2];
  await win.mouse.move(target.x, target.y);
  await win.waitForTimeout(150);
  await a.shot('20-edit-hover');
  await win.mouse.click(target.x, target.y);
  await win.waitForTimeout(1100);
  const afterClick = await counts();
  assert.deepEqual(afterClick, [before[0] + 1, before[1] - 1], 'one note changed hands');
  const edited = fs.readFileSync(file);
  assert.ok(!edited.equals(original), 'the file on disk changed');
  const p0 = parseMidi(new Uint8Array(original)), p1 = parseMidi(new Uint8Array(edited));
  assert.deepEqual(others(p1), others(p0), 'tempo, pedal and every other event are untouched');
  assert.deepEqual(p1.notes.map(noteKey).sort(), p0.notes.map(noteKey).sort(), 'every note keeps its pitch, timing and velocity');
  const movedNote = p1.notes.find(n => n.midi === target.midi && Math.abs(n.start - target.start) < 1e-6);
  assert.equal(movedNote.track, 0, 'the clicked note is now in the other track');
  console.log('click: counts', before, '->', afterClick, '| file', original.length, '->', edited.length, 'bytes');

  /* undo restores the file exactly */
  await win.keyboard.press('Control+z');
  await win.waitForTimeout(1100);
  assert.ok(fs.readFileSync(file).equals(original), 'undo puts the file back byte for byte');
  console.log('undo: file is byte-identical to the original');

  /* drag across several notes of the upper hand */
  notes = (await visible()).filter(n => n.track === 1).sort((p, q) => q.y - p.y).slice(0, 6);
  await win.mouse.move(notes[0].x, notes[0].y);
  await win.mouse.down();
  for (const n of notes.slice(1)) { await win.mouse.move(n.x, n.y, {steps: 8}); }
  await win.mouse.up();
  await win.waitForTimeout(1100);
  const afterDrag = await counts(), moved = afterDrag[0] - before[0];
  assert.ok(moved >= 5, 'dragging moved several notes: ' + moved);
  await a.at(20);
  await a.shot('21-edit-after-drag');
  const dragged = fs.readFileSync(file), p2 = parseMidi(new Uint8Array(dragged));
  assert.deepEqual(others(p2), others(p0));
  assert.deepEqual(p2.tracks.map(t => t.count), afterDrag, 'the file agrees with the screen');
  console.log('drag: moved', moved, 'notes; counts', afterDrag);

  const m0 = staves(path.join(root, 'test', 'fixtures', 'wtk1-prelude1.mid'), 'wtk-original'), m1 = staves(file, 'wtk-edited');
  console.log('MuseScore, original:', JSON.stringify(m0));
  console.log('MuseScore, edited:  ', JSON.stringify(m1));

  /* a file with one track gains a second one */
  await win.evaluate(() => pv.openSong('one-track.mid'));
  await win.waitForFunction(() => pv.current === 'one-track.mid');
  console.log('one track: tracks', await win.evaluate(() => pv.piece.tracks.map(t => t.name + ':' + t.count).join(' | ')));
  let total = 0;
  for (const t of [4, 8, 12, 16, 20, 24]) {
    await a.at(t);
    for (const n of (await visible()).filter(n => n.midi < 60 && n.track === 0)) { await win.mouse.click(n.x, n.y); total++; }
  }
  await win.waitForTimeout(1100);
  await a.at(20);
  await a.shot('22-one-track-split');
  const split = fs.readFileSync(oneFile), ps = parseMidi(new Uint8Array(split)), po = parseMidi(new Uint8Array(oneOriginal)), v = new DataView(split.buffer, split.byteOffset);
  assert.equal(v.getUint16(8), 1); assert.equal(v.getUint16(10), 2);
  assert.equal(ps.tracks.length, 2);
  assert.deepEqual(others(ps)[0], others(po)[0]);
  assert.deepEqual(ps.notes.map(noteKey).sort(), po.notes.map(noteKey).sort());
  console.log('one track: clicked', total, 'notes; file now has tracks', ps.tracks.map(t => t.name + ':' + t.count).join(' | '));
  console.log('MuseScore, one track original:', JSON.stringify(staves(path.join(folder, '..', path.basename(folder), 'one-track.mid').replace('one-track.mid', 'one-track.mid'), 'one-edited')));
  fs.writeFileSync(path.join(out, 'ms', 'one-original.mid'), oneOriginal);
  console.log('MuseScore, one track before edit:', JSON.stringify(staves(path.join(out, 'ms', 'one-original.mid'), 'one-original')));
  console.log('ALL EDIT CHECKS PASSED');
} finally {
  console.log(a.problems.join('\n') || 'no console problems');
  await a.close();
}
