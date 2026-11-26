/* Pictures of the 3D view in several settings. Usage: node test/shots/solid.mjs [names...] */
import {launch, songFolder} from './harness.mjs';

const only = process.argv.slice(2), want = n => !only.length || only.includes(n);
const a = await launch({folder: songFolder(['Chop-28-4.mid'])});
const {win} = a;
const set = (k, v) => win.evaluate(([k, v]) => pv.set(k, v), [k, v]);
/* Plays for a moment so sparks and key movement are in the picture, then holds still. */
const run = async (from, secs = 1.6) => {
  await win.evaluate(t => { pv.seek(t); pv.play(); }, from);
  await win.waitForTimeout(secs * 1000);
  await win.evaluate(() => pv.pause());
  await win.waitForTimeout(250);
};
try {
  await win.evaluate(() => { pv.S.libOpen = false; document.querySelector('.app').classList.add('hide-lib'); });
  await win.waitForTimeout(300);
  await set('view', 'solid');
  if (want('default')) { await run(5); await a.shot('40-solid-default'); }
  if (want('gloss')) { await set('finish', 'gloss'); await set('glow', 0.5); await run(12); await a.shot('41-solid-gloss-glow'); await set('finish', 'matte'); await set('glow', 0); }
  if (want('rounded')) { await set('shape', 'pill'); await set('smoke', 0.6); await set('haze', true); await run(20); await a.shot('42-solid-rounded-smoke-haze'); await set('smoke', 0); await set('haze', false); }
  if (want('outline')) { await set('shape', 'outline'); await set('noteNames', true); await run(28); await a.shot('43-solid-outline-names'); await set('shape', 'bar'); await set('noteNames', false); }
  if (want('tilt')) { await set('tilt', 0); await run(5, 1); await a.shot('44-solid-tilt-0'); await set('tilt', 1); await run(5, 1); await a.shot('45-solid-tilt-max'); await set('tilt', 0.55); }
  if (want('chopin')) { await win.evaluate(() => pv.openSong('Chop-28-4.mid')); await set('range', 'fit'); await set('glow', 0.35); await run(30, 2); await a.shot('46-solid-chopin-fit'); }
} finally {
  console.log(a.problems.slice(0, 12).join('\n') || 'no console problems');
  await a.close();
}
