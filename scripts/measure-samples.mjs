/* Measures how loud each piano sample starts, so the app can blend loudness layers smoothly.
   Writes app/assets/piano/levels.json. Needs ffmpeg on the PATH. */
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const LAYERS = [2, 4, 6, 8, 10, 12, 14, 16];
const NAMES = ['C', 'Cs', 'D', 'Ds', 'E', 'F', 'Fs', 'G', 'Gs', 'A', 'As', 'B'];
const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'app', 'assets', 'piano');
const files = [], rms = [], peak = [];
for (let midi = 21; midi <= 108; midi += 3) {
  const stem = `${NAMES[midi % 12]}${Math.floor(midi / 12) - 1}`, row = [], top = [];
  for (const v of LAYERS) {
    const r = spawnSync('ffmpeg', ['-v', 'error', '-t', '0.6', '-i', path.join(dir, `${stem}v${v}.mp3`), '-ac', '1', '-f', 'f32le', '-'], {maxBuffer: 1 << 26});
    if (r.status !== 0) throw new Error(`could not read ${stem}v${v}.mp3`);
    const pcm = new Float32Array(r.stdout.buffer, r.stdout.byteOffset, r.stdout.length >> 2);
    let sum = 0, max = 0;
    for (const s of pcm) { sum += s * s; max = Math.max(max, Math.abs(s)); }
    row.push(+Math.sqrt(sum / pcm.length).toFixed(5)); top.push(+max.toFixed(4));
  }
  files.push(stem); rms.push(row); peak.push(top);
}
fs.writeFileSync(path.join(dir, 'levels.json'), JSON.stringify({layers: LAYERS, first: 21, step: 3, files, rms, peak}));
console.log('levels.json written');
for (let i = 0; i < files.length; i += 4) console.log(files[i].padEnd(4), rms[i].map(v => v.toFixed(3)).join(' '), ' peak', Math.max(...peak[i]));
