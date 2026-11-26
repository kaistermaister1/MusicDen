/* Pictures of the flat view in its other settings, and a measurement: with the glow turned all the
   way up, the color at the middle of a note is still exactly the color chosen for it. */
import {launch} from './harness.mjs';
import assert from 'node:assert/strict';

const a = await launch();
const {win} = a;
const set = (k, v) => win.evaluate(([k, v]) => pv.set(k, v), [k, v]);
const run = async (from, secs = 1.4) => {
  await win.evaluate(t => { pv.seek(t); pv.play(); }, from);
  await win.waitForTimeout(secs * 1000);
  await win.evaluate(() => pv.pause());
  await win.waitForTimeout(200);
};
/* The color drawn at the middle of each note on screen, beside the color the note should have.
   Two things are meant to lie over a note and are kept out of the measurement, so that it is of
   the glow alone: sparks, which fly in front of the notes, and the edge light, which reaches a few
   pixels up from the keys. */
const noteColors = () => win.evaluate(() => {
  const s = pv.stage, gl = s.gl, g = s.geo, out = [], px = new Uint8Array(4);
  s.parts.length = 0;
  s.render({t: pv.now(), dt: 0, clock: performance.now() / 1000, playing: false});
  for (let i = 0; i < s.list.length; i += 5) {
    const n = s.refs[i / 5]; if (!n) continue;
    let at;
    if (pv.S.view === 'solid') { const sp = s.solid.noteSpan(i); if (sp.far - sp.near < 1 || sp.far > s.solid.lane * 0.8) continue; at = s.solid.project(sp.x + sp.w / 2, sp.high, -(sp.near + sp.far) / 2); }
    else { const top = Math.max(0, g.hitY - s.list[i + 2]), bottom = Math.min(g.hitY, g.hitY - s.list[i + 1]); if (bottom - top < 12 || g.hitY - (top + bottom) / 2 < 10) continue; at = [g.x[n.midi] + g.w[n.midi] / 2, (top + bottom) / 2]; }
    gl.readPixels(Math.round(at[0] * s.dpr), s.ph - 1 - Math.round(at[1] * s.dpr), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    out.push({want: s.list[i + 3], got: '#' + [px[0], px[1], px[2]].map(v => v.toString(16).padStart(2, '0')).join('')});
  }
  return out;
});
try {
  await win.evaluate(() => { pv.S.libOpen = false; document.querySelector('.app').classList.add('hide-lib'); });
  await win.waitForTimeout(300);
  await set('glow', 1); await set('haze', true); await set('smoke', 0.7);
  await run(12); await a.shot('70-flat-glow-haze-smoke');
  for (const view of ['flat', 'solid']) {
    await set('view', view); await win.waitForTimeout(200);
    const colors = await noteColors();
    assert.ok(colors.length >= 6, 'notes to measure');
    const off = colors.filter(c => c.want !== c.got);
    console.log(`${view} view, glow at 100% with haze and smoke: ${colors.length - off.length} of ${colors.length} notes measured exactly their chosen color` + (off.length ? '; off: ' + off.slice(0, 4).map(c => c.want + ' drawn ' + c.got).join(', ') : ''));
    assert.equal(off.length, 0, 'the glow leaves note colors untouched');
  }
  await set('view', 'flat'); await set('smoke', 0);
  await set('finish', 'gloss'); await set('shape', 'pill'); await run(20); await a.shot('71-flat-gloss-rounded-glow');
  await set('finish', 'matte'); await set('glow', 0); await set('haze', false);
  await set('shape', 'outline'); await set('noteNames', true); await set('motion', 'rise'); await run(30); await a.shot('72-flat-outline-names-rise');
  await set('shape', 'bar'); await set('noteNames', false); await set('motion', 'fall');
  await set('colorBy', 'pitch'); await set('range', 'fit'); await set('window', 6); await set('width', 0.7); await set('edgeLight', false); await run(40); await a.shot('73-flat-pitch-fit-6s-felt');
  await win.locator('#lookBtn').click(); await win.waitForTimeout(200); await a.shot('74-settings-pitch-colors');
  console.log('FLAT CHECKS PASSED');
} finally {
  console.log(a.problems.slice(0, 8).join('\n') || 'no console problems');
  await a.close();
}
