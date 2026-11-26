/* Walks through the app's features in the real window and saves a picture of each. */
import {launch, songFolder, out, root} from './harness.mjs';
import fs from 'node:fs';
import path from 'node:path';

const only = process.argv.slice(2);
const want = name => !only.length || only.includes(name);
const folder = songFolder(['Chop-28-4.mid', 'gymnopedie_1.mid', 'wtk1-prelude1.mid']);
const a = await launch({folder});
const {win} = a;
const log = (...x) => console.log(...x);
try {
  if (want('library')) {
    await win.waitForFunction(() => pv.songs.length === 3 && pv.songs.every(s => s.duration != null));
    await a.shot('10-library');
    log('songs:', await win.evaluate(() => pv.songs.map(s => s.name + ' ' + s.duration.toFixed(1)).join(' | ')));
    await win.locator('.song[data-id="Chop-28-4.mid"] .pick').click();
    await win.waitForFunction(() => pv.current === 'Chop-28-4.mid' && pv.playing);
    await win.waitForTimeout(2500);
    log('playing at', await win.evaluate(() => pv.now().toFixed(2)), 'voices', await win.evaluate(() => pv.piano.voices.size), 'sampled', await win.evaluate(() => [...pv.piano.voices].filter(v => v.sampled).length), 'buffers', await win.evaluate(() => pv.bank.buffers.size));
    await a.shot('11-playing-chopin');
    await win.locator('#play').click();
  }
  if (want('settings')) {
    await win.locator('#lookBtn').click();
    await a.at(8);
    await a.shot('12-settings-top');
    await win.evaluate(() => { document.getElementById('insp').scrollTop = 99999; });
    await a.shot('13-settings-bottom');
  }
  if (want('remove')) {
    await win.locator('.song[data-id="gymnopedie_1.mid"]').hover();
    await win.locator('.song[data-id="gymnopedie_1.mid"] .rm').click();
    await a.shot('14-remove-confirm');
    await win.locator('.song[data-id="gymnopedie_1.mid"] .rm').click();
    await win.waitForFunction(() => pv.songs.length === 2);
    log('after remove:', fs.readdirSync(folder).join(', '));
  }
} finally {
  log(a.problems.join('\n') || 'no console problems');
  await a.close();
  log('song folder:', folder);
}
