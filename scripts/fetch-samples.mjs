/* Downloads the Salamander Grand Piano samples the app plays: every third key, eight loudness layers.
   Salamander Grand Piano V3 by Alexander Holm, CC BY 3.0, as hosted for Tone.js Piano. */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const BASE = 'https://tambien.github.io/Piano/audio/';
const LAYERS = [2, 4, 6, 8, 10, 12, 14, 16];
const NAMES = ['C', 'Cs', 'D', 'Ds', 'E', 'F', 'Fs', 'G', 'Gs', 'A', 'As', 'B'];
const out = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'app', 'assets', 'piano');
fs.mkdirSync(out, {recursive: true});

const wanted = [];
for (let midi = 21; midi <= 108; midi += 3) for (const v of LAYERS) wanted.push(`${NAMES[midi % 12]}${Math.floor(midi / 12) - 1}v${v}.mp3`);
const missing = wanted.filter(f => { try { return fs.statSync(path.join(out, f)).size < 1000; } catch (e) { return true; } });
console.log(`${wanted.length - missing.length} of ${wanted.length} samples present`);

let done = 0, failed = 0;
async function worker() {
  for (let f; (f = missing.pop());) {
    for (let attempt = 1; ; attempt++) {
      try {
        const res = await fetch(BASE + f);
        if (!res.ok) throw new Error(String(res.status));
        fs.writeFileSync(path.join(out, f), Buffer.from(await res.arrayBuffer()));
        break;
      } catch (e) {
        if (attempt === 4) { failed++; console.error(`failed: ${f} (${e.message})`); break; }
        await new Promise(r => setTimeout(r, 500 * attempt));
      }
    }
    if (++done % 40 === 0) console.log(`${done} downloaded`);
  }
}
await Promise.all(Array.from({length: 8}, worker));
console.log(failed ? `${failed} samples could not be downloaded. Run this again.` : 'All samples are in place.');
process.exit(failed ? 1 : 0);
