/* Playing along and pointing at things, in the flat and the 3D view: clicking keys, computer keys,
   a MIDI keyboard's messages, and changing hands by clicking a 3D note. */
import {launch, songFolder} from './harness.mjs';
import assert from 'node:assert/strict';

const a = await launch({folder: songFolder(['wtk1-prelude1.mid'])});
const {win} = a;
const canvasBox = () => win.locator('#glc').boundingBox();
/* Where a key's top is on screen, by asking the stage which point it answers to. */
const keySpot = midi => win.evaluate(midi => {
  const s = pv.stage, r = document.getElementById('glc').getBoundingClientRect();
  for (let y = s.H - 4; y > s.H * 0.6; y -= 3) for (let x = 2; x < s.W; x += 3) if (s.keyAt(x, y) === midi) return [r.left + x + 2, r.top + y - 2];
  return null;
}, midi);
const lit = () => win.evaluate(() => { pv.redraw(); return new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => r(pv.stage.lit.map((c, m) => c ? m : -1).filter(m => m >= 0))))); });
try {
  for (const view of ['flat', 'solid']) {
    await win.evaluate(v => { pv.set('view', v); pv.pause(); pv.seek(pv.piece.duration); }, view);
    await win.waitForTimeout(300);
    /* a mouse on the keys */
    for (const midi of [60, 61, 72]) {
      const at = await keySpot(midi);
      assert.ok(at, `${view}: key ${midi} can be found on screen`);
      await win.mouse.move(at[0], at[1]); await win.mouse.down();
      await win.waitForTimeout(120);
      assert.deepEqual(await lit(), [midi], `${view}: clicking key ${midi} lights it`);
      await win.mouse.up();
    }
    /* computer keys: A is middle C, W the black key above it, X moves up an octave */
    await win.keyboard.down('a'); await win.keyboard.down('w'); await win.keyboard.down('k');
    await win.waitForTimeout(350);
    assert.deepEqual(await lit(), [60, 61, 72], `${view}: computer keys A W K`);
    assert.equal(await win.evaluate(() => [...pv.piano.voices].filter(v => v.live).length), 3, 'three notes sounding by hand');
    await a.shot(`50-play-along-${view}`);
    await win.keyboard.up('a'); await win.keyboard.up('w'); await win.keyboard.up('k');
    await win.keyboard.press('x'); await win.keyboard.down('a'); await win.waitForTimeout(100);
    assert.deepEqual(await lit(), [72], `${view}: X shifts up an octave`);
    await win.keyboard.up('a'); await win.keyboard.press('z');
    /* what a MIDI keyboard sends: note on, pedal down, note off (still ringing), pedal up */
    const ring = await win.evaluate(async () => {
      const wait = ms => new Promise(r => setTimeout(r, ms)), ringing = () => [...pv.piano.voices].filter(v => !v.released).length;
      pv.midiIn([0x90, 64, 100]); await wait(60);
      const held = ringing();
      pv.midiIn([0xb0, 64, 127]); pv.midiIn([0x80, 64, 0]); await wait(60);
      const pedalled = ringing(), shown = pv.stage.lit[64];
      pv.midiIn([0xb0, 64, 0]); await wait(60);
      return {held, pedalled, shown: !!shown, after: ringing()};
    });
    assert.deepEqual(ring, {held: 1, pedalled: 1, shown: false, after: 0}, `${view}: the pedal holds a released note until it lifts`);
    await win.waitForTimeout(400);
  }
  /* changing hands in 3D: click a note's top */
  await win.evaluate(() => { pv.openSong('wtk1-prelude1.mid'); });
  await win.waitForFunction(() => pv.current === 'wtk1-prelude1.mid');
  await win.evaluate(() => { pv.pause(); pv.S.editHands = true; pv.seek(20); pv.redraw(); });
  await win.waitForTimeout(300);
  const spot = await win.evaluate(() => {
    const s = pv.stage, r = document.getElementById('glc').getBoundingClientRect();
    for (let i = 0; i < s.list.length; i += 5) {
      const n = s.refs[i / 5]; if (!n || n.track !== 1) continue;
      const span = s.solid.noteSpan(i), mid = s.solid.project(span.x + span.w / 2, span.high, -(span.near + span.far) / 2);
      if (mid && span.far - span.near > 0.5 && span.near > 2) return {x: r.left + mid[0], y: r.top + mid[1], midi: n.midi, start: n.start};
    }
  });
  const before = await win.evaluate(() => pv.piece.tracks.map(t => t.count));
  await win.mouse.move(spot.x, spot.y); await win.waitForTimeout(200);
  await a.shot('51-solid-edit-hover');
  await win.mouse.click(spot.x, spot.y); await win.waitForTimeout(300);
  const after = await win.evaluate(() => pv.piece.tracks.map(t => t.count));
  assert.deepEqual(after, [before[0] + 1, before[1] - 1], 'clicking a note in 3D moves it to the other hand');
  await win.keyboard.press('Control+z');
  await a.shot('52-solid-edit-moved-back');
  console.log('ALL PLAY-ALONG CHECKS PASSED (mouse, computer keys, MIDI messages with pedal, 3D note picking)');
} finally {
  console.log(a.problems.slice(0, 10).join('\n') || 'no console problems');
  await a.close();
}
