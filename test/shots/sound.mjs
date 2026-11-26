/* Measures the piano's sound, since a check cannot listen: pitch of sampled and shifted keys,
   loudness across velocities, which recording layer each velocity uses, dampers and the pedal. */
import {launch} from './harness.mjs';
import assert from 'node:assert/strict';

const a = await launch();
try {
  const r = await a.win.evaluate(async () => {
    const {Piano} = await import('./piano.js');
    const bank = pv.bank, RATE = 48000;
    /* One note rendered alone: struck at 0.05 s, released after `hold` seconds. */
    const render = async (midi, vel, hold, secs = 2.5) => {
      const v = Math.round(vel * 127), [s, j] = bank.slot(midi, v);
      await bank.load(s, j);
      const ctx = new OfflineAudioContext(2, RATE * secs, RATE), p = new Piano(ctx, bank, 1);
      const voice = p.start(midi, vel, 0.05, hold);
      const buf = await ctx.startRendering();
      return {x: buf.getChannelData(0), layer: bank.levels.layers[bank.nearest(s, j)], sampled: voice.sampled};
    };
    const rms = (x, from, to) => { let sum = 0; const a = Math.floor(from * RATE), b = Math.floor(to * RATE); for (let i = a; i < b; i++) sum += x[i] * x[i]; return Math.sqrt(sum / (b - a)); };
    /* The fundamental, from the strongest repeat in the wave between 0.15 and 0.45 s. */
    const pitch = (x, guess) => {
      const from = Math.floor(0.15 * RATE), n = Math.floor(0.3 * RATE);
      let best = 0, bestLag = 0;
      for (let lag = Math.floor(RATE / (guess * 1.12)); lag <= Math.ceil(RATE / (guess * 0.89)); lag++) {
        let c = 0; for (let i = from; i < from + n; i++) c += x[i] * x[i + lag];
        if (c > best) { best = c; bestLag = lag; }
      }
      let c0 = 0, c1 = 0, c2 = 0;
      for (let i = from; i < from + n; i++) { c0 += x[i] * x[i + bestLag - 1]; c1 += x[i] * x[i + bestLag]; c2 += x[i] * x[i + bestLag + 1]; }
      return RATE / (bestLag + 0.5 * (c0 - c2) / (c0 - 2 * c1 + c2));
    };
    const out = {pitches: [], loud: [], layers: []};
    for (const midi of [57, 68, 69, 70, 84]) { const n = await render(midi, 0.7, 1.5); out.pitches.push([midi, 440 * Math.pow(2, (midi - 69) / 12), pitch(n.x, 440 * Math.pow(2, (midi - 69) / 12)), n.sampled]); }
    for (const v of [10, 25, 40, 55, 70, 85, 100, 115, 127]) { const n = await render(60, v / 127, 1.5); out.loud.push(rms(n.x, 0.05, 0.55)); out.layers.push(n.layer); }
    const short = await render(60, 0.7, 0.2), long = await render(60, 0.7, 2.2), high = await render(96, 0.7, 0.2), below = await render(87, 0.7, 0.2);
    out.damped = rms(short.x, 1, 1.2) / rms(short.x, 0.06, 0.2);
    out.held = rms(long.x, 1, 1.2) / rms(long.x, 0.06, 0.2);
    out.topRing = rms(high.x, 0.6, 0.8) / rms(high.x, 0.06, 0.2);
    out.belowRing = rms(below.x, 0.6, 0.8) / rms(below.x, 0.06, 0.2);
    out.buffers = bank.buffers.size;
    return out;
  });
  for (const [midi, want, got, sampled] of r.pitches) {
    console.log(`key ${midi}: expected ${want.toFixed(1)} Hz, measured ${got.toFixed(1)} Hz${sampled ? '' : ' (synthesized)'}`);
    assert.ok(sampled, 'the key plays a recording');
    assert.ok(Math.abs(got / want - 1) < 0.012, `key ${midi} is in tune`);
  }
  console.log('loudness of middle C at velocities 10..127 (dB):', r.loud.map(v => (20 * Math.log10(v)).toFixed(1)).join(' '));
  console.log('recording layer used:', r.layers.join(' '));
  for (let i = 1; i < r.loud.length; i++) assert.ok(r.loud[i] > r.loud[i - 1], 'louder velocities sound louder');
  assert.ok(new Set(r.layers).size >= 7, 'velocities spread across the recorded layers');
  console.log(`one second after the strike: a released key is at ${(r.damped * 100).toFixed(2)}% of its level, a held or pedalled one at ${(r.held * 100).toFixed(0)}%`);
  assert.ok(r.damped < 0.01 && r.held > 0.08 && r.held > r.damped * 10, 'dampers stop a released note; a sustained one rings on');
  console.log(`half a second after release: a top-octave key (no dampers) is at ${(r.topRing * 100).toFixed(1)}% of its level, a key just below the undamped range at ${(r.belowRing * 100).toFixed(2)}%`);
  assert.ok(r.topRing > r.belowRing, 'the top octave rings on longer after release');
  console.log('ALL SOUND CHECKS PASSED');
} finally {
  console.log(a.problems.slice(0, 8).join('\n') || 'no console problems');
  await a.close();
}
