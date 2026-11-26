/* Downloads the recordings the app plays.
   The piano: Salamander Grand Piano V3 by Alexander Holm, CC BY 3.0, as hosted for Tone.js Piano;
   every third key, eight loudness layers.
   The guitar: the acoustic guitar of github.com/nbrosowsky/tonejs-instruments, one recording for
   each pitch from D2 to D5, and the list of them the player reads. */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const NAMES = ['C', 'Cs', 'D', 'Ds', 'E', 'F', 'Fs', 'G', 'Gs', 'A', 'As', 'B'];
const assets = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'app', 'assets');
const here = (dir, f) => { try { return fs.statSync(path.join(dir, f)).size >= 1000; } catch (e) { return false; } };

/* Fetches the files of one instrument that are not in its folder yet, eight at a time. Returns how many could not be fetched. */
async function fetchAll(what, base, dir, wanted) {
  fs.mkdirSync(dir, {recursive: true});
  const missing = wanted.filter(f => !here(dir, f));
  console.log(`${what}: ${wanted.length - missing.length} of ${wanted.length} samples present`);
  let done = 0, failed = 0;
  async function worker() {
    for (let f; (f = missing.pop());) {
      for (let attempt = 1; ; attempt++) {
        try {
          const res = await fetch(base + f);
          if (!res.ok) throw new Error(String(res.status));
          fs.writeFileSync(path.join(dir, f), Buffer.from(await res.arrayBuffer()));
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
  return failed;
}

const LAYERS = [2, 4, 6, 8, 10, 12, 14, 16], piano = [];
for (let midi = 21; midi <= 108; midi += 3) for (const v of LAYERS) piano.push(`${NAMES[midi % 12]}${Math.floor(midi / 12) - 1}v${v}.mp3`);
let failed = await fetchAll('piano', 'https://tambien.github.io/Piano/audio/', path.join(assets, 'piano'), piano);

/* the guitar's player is told which pitches have a recording; the others borrow the nearest one */
const guitarDir = path.join(assets, 'guitar'), guitar = new Map();
for (let midi = 38; midi <= 74; midi++) guitar.set(midi, `${NAMES[midi % 12]}${Math.floor(midi / 12) - 1}.mp3`);
failed += await fetchAll('guitar', 'https://raw.githubusercontent.com/nbrosowsky/tonejs-instruments/master/samples/guitar-acoustic/', guitarDir, [...guitar.values()]);
const notes = {};
for (const [midi, f] of guitar) if (here(guitarDir, f)) notes[midi] = f;
fs.writeFileSync(path.join(guitarDir, 'manifest.json'), JSON.stringify({notes}));

console.log(failed ? `${failed} samples could not be downloaded. Run this again.` : 'All samples are in place.');
process.exit(failed ? 1 : 0);
