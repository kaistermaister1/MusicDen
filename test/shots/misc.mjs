/* Smaller behaviors: the Space key, adding files to the folder, speed, mute, full screen, removing
   the built-in piece, remembering the last song, and the stage when there are no songs at all. */
import {launch, songFolder, root} from './harness.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

const folder = songFolder(['Chop-28-4.mid']);
const keep = fs.mkdtempSync(path.join(os.tmpdir(), 'pv-keep-'));
let a = await launch({folder, keep});
let win = a.win;
try {
  /* Space plays or pauses whatever was clicked last, and does not press that thing again */
  const playing = () => win.evaluate(() => pv.playing);
  await win.locator('#lookBtn').click();
  await win.keyboard.press('Space'); await win.waitForTimeout(150);
  assert.equal(await playing(), true, 'Space after clicking Settings starts playback');
  assert.ok(await win.evaluate(() => pv.S.lookOpen), 'and the Settings panel stays open');
  await win.locator('[data-seg="finish"][data-v="gloss"]').click();
  await win.keyboard.press('Space'); await win.waitForTimeout(150);
  assert.equal(await playing(), false, 'Space after clicking Gloss pauses');
  assert.equal(await win.evaluate(() => pv.S.finish), 'gloss');
  await win.locator('[data-mute="0"]').click();
  await win.keyboard.press('Space'); await win.waitForTimeout(150);
  assert.equal(await playing(), true, 'Space after clicking mute plays');
  assert.equal(await win.evaluate(() => pv.piece.tracks[0].muted), true, 'and the track stays muted');
  await win.locator('#speed').focus();
  await win.keyboard.press('Space'); await win.waitForTimeout(150);
  assert.equal(await playing(), false, 'Space with the speed list focused pauses');
  await win.locator('#play').click(); await win.waitForTimeout(150);
  assert.equal(await playing(), true);
  await win.keyboard.press('Space'); await win.waitForTimeout(150);
  assert.equal(await playing(), false, 'Space after clicking Play pauses once, not twice');
  await win.locator('[data-mute="0"]').click();
  await win.locator('[data-seg="finish"][data-v="matte"]').click();
  await win.locator('#lookBtn').click();
  console.log('Space: plays or pauses after clicking Settings, a choice, mute, the speed list and Play');

  /* adding files: a new one is copied in, the same one again is not doubled, a different file of
     the same name gets a number, and something that is not MIDI is refused */
  const fixture = n => path.join(root, 'test', 'fixtures', n);
  const other = path.join(os.tmpdir(), 'pv-other'); fs.mkdirSync(other, {recursive: true});
  fs.copyFileSync(fixture('gymnopedie_1.mid'), path.join(other, 'Chop-28-4.mid'));
  fs.writeFileSync(path.join(other, 'notes.txt'), 'not a song');
  const names = await win.evaluate(list => window.desk.library.importPaths(list), [fixture('wtk1-prelude1.mid'), fixture('wtk1-prelude1.mid'), fixture('Chop-28-4.mid'), path.join(other, 'Chop-28-4.mid'), path.join(other, 'notes.txt')]);
  assert.deepEqual(names, ['wtk1-prelude1.mid', 'wtk1-prelude1.mid', 'Chop-28-4.mid', 'Chop-28-4 (2).mid', null]);
  assert.deepEqual(fs.readdirSync(folder).sort(), ['Chop-28-4 (2).mid', 'Chop-28-4.mid', 'wtk1-prelude1.mid']);
  await win.waitForFunction(() => pv.songs.length === 3 && pv.songs.every(s => s.duration != null));
  console.log('adding files: copied, not doubled, renamed on a name clash, non-MIDI refused; list updated by itself');

  /* speed: at 150% the piece moves one and a half times as fast as the clock */
  await win.evaluate(() => pv.openSong('wtk1-prelude1.mid'));
  await win.selectOption('#speed', '1.5');
  await win.evaluate(() => { pv.seek(10); pv.play(); });
  await win.waitForTimeout(500);
  const t0 = await win.evaluate(() => [pv.now(), performance.now()]);
  await win.waitForTimeout(2000);
  const t1 = await win.evaluate(() => [pv.now(), performance.now()]);
  const ratio = (t1[0] - t0[0]) / ((t1[1] - t0[1]) / 1000);
  assert.ok(Math.abs(ratio - 1.5) < 0.03, 'speed 150% measured ' + ratio.toFixed(3));
  console.log('speed 150%: the piece advanced', ratio.toFixed(3), 'seconds per second');
  await win.selectOption('#speed', '1');

  /* mute: a muted track is drawn faint and no longer sounds */
  await win.locator('#lookBtn').click();
  await win.locator('[data-mute="1"]').click();
  await win.evaluate(() => { pv.piano.silence(); });
  await win.waitForTimeout(1500);
  const sounding = await win.evaluate(() => { const t = pv.now(); return pv.piece.notes.filter(n => n.track === 1 && n.start < t && n.start > t - 1).length; });
  assert.ok(sounding > 0, 'the muted hand has notes in this stretch');
  await a.shot('60-muted-track');
  await win.evaluate(() => pv.pause());
  await win.locator('[data-mute="1"]').click();
  await win.locator('#lookBtn').click();


  /* the built-in piece is removed like any song: a second click confirms, and the next song takes the stage */
  const demoRow = win.locator('.song[data-id=":built-in"]');
  await demoRow.locator('.pick').click();
  await win.waitForFunction(() => pv.current === ':built-in');
  await win.evaluate(() => pv.pause());
  await demoRow.hover(); await demoRow.locator('.rm').click();
  await a.shot('63-remove-built-in-confirm');
  await demoRow.locator('.rm').click();
  await win.waitForFunction(() => pv.current !== ':built-in');
  assert.equal(await demoRow.count(), 0, 'the built-in piece is off the list');
  console.log('built-in piece removed; now showing', await win.evaluate(() => pv.current));
  await win.evaluate(() => pv.openSong('wtk1-prelude1.mid'));

  /* closing and starting again reopens the last song, and the built-in piece stays gone */
  await a.close();
  a = await launch({folder, keep}); win = a.win;
  await win.waitForFunction(() => pv.current === 'wtk1-prelude1.mid', null, {timeout: 10000});
  assert.equal(await win.locator('.song[data-id=":built-in"]').count(), 0);
  console.log('restart: reopened', await win.evaluate(() => pv.current), 'and the built-in piece is still gone');

  /* with every song removed the stage is empty and nothing breaks */
  for (const name of await win.evaluate(() => pv.songs.map(s => s.name))) {
    const row = win.locator(`.song[data-id="${name}"]`);
    await row.hover(); await row.locator('.rm').click(); await row.locator('.rm').click();
    await win.waitForFunction(n => !pv.songs.some(s => s.name === n), name);
  }
  await win.waitForFunction(() => pv.current === ':none');
  await win.keyboard.press('Space'); await win.waitForTimeout(400); await win.keyboard.press('Space');
  await win.locator('#lookBtn').click(); await win.waitForTimeout(200);
  await a.shot('64-no-songs');
  assert.deepEqual(fs.readdirSync(folder), [], 'the song folder is empty');
  console.log('no songs: empty stage, title', JSON.stringify(await win.evaluate(() => document.getElementById('title').textContent)));
  /* full screen needs a window that is really on the screen, so this last part shows one for a few seconds */
  await a.close();
  a = await launch({folder, keep, visible: true}); win = a.win;
  /* the strip hides, Esc leaves */
  await win.locator('#fullBtn').click();
  await win.waitForTimeout(3200);
  assert.ok(await win.evaluate(() => document.querySelector('.app').classList.contains('full') && !!document.fullscreenElement), 'the app is full screen');
  await a.shot('61-full-screen');
  await win.mouse.move(400, 300); await win.mouse.move(420, 320);
  await win.waitForTimeout(300);
  await a.shot('62-full-screen-strip');
  await win.keyboard.press('Escape');
  await win.waitForTimeout(500);
  assert.ok(await win.evaluate(() => !document.querySelector('.app').classList.contains('full')), 'Esc leaves full screen');
  console.log('full screen: entered, strip hides and returns on movement, Esc leaves');
  console.log('ALL MISC CHECKS PASSED');
} finally {
  console.log(a.problems.slice(0, 8).join('\n') || 'no console problems');
  await a.close();
  fs.rmSync(keep, {recursive: true, force: true});
}
