/* Folders in the Songs list: making one, dragging songs in and out, opening and closing, renaming
   and removing, and the folders still being there after a restart. One drag is done slowly and
   looked at halfway: nothing in the list may move while a song is over a folder. Also the Songs panel without
   the song-folder row, which now sits in Settings. */
import {launch, songFolder} from './harness.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

const keep = fs.mkdtempSync(path.join(os.tmpdir(), 'pv-keep-')), folder = songFolder(['Chop-28-4.mid', 'gymnopedie_1.mid', 'wtk1-prelude1.mid']);
let a = await launch({folder, keep}), {win} = a;
const song = name => win.locator(`#songs .song[data-id="${name}"]`), fold = name => win.locator(`#songs .fold[data-folder="${name}"]`);
const inFolders = () => win.evaluate(() => pvFolders.read().folders.map(f => f.name + ': ' + f.songs.join(', ')));
const order = () => win.evaluate(() => [...document.querySelectorAll('#songs > li')].map(li => li.classList.contains('fold') ? '[' + li.querySelector('.name').textContent + ']' : (li.classList.contains('in') ? '  ' : '') + li.querySelector('.name').textContent));
try {
  await win.waitForFunction(() => pv.songs.length === 3);

  /* nothing in the Songs panel asks for a folder; Settings has the folder's path, with the button that changes it */
  assert.equal(await win.locator('#lib #folderBtn').count(), 0, 'no folder button under the songs');
  await win.locator('#lookBtn').click();
  await win.locator('#insp #folderBtn').scrollIntoViewIfNeeded();
  assert.equal(await win.locator('#insp #where').textContent(), folder);
  assert.equal(await win.locator('#insp .sec:has(#where) .hint').textContent(), 'Select where your music is stored.');
  assert.equal(await win.locator('#insp #folderBtn').isVisible(), true);
  await a.shot('149-settings-folder');
  await win.locator('#lookBtn').click();

  /* a new folder: the row turns into a box for its name */
  await win.locator('#songs .fold.new .pick').click();
  await win.locator('#songs .fold.new .rename').fill('Preludes');
  await a.shot('150-folder-naming');
  await win.keyboard.press('Enter');
  assert.deepEqual(await inFolders(), ['Preludes: ']);
  assert.equal(await win.evaluate(() => pv.playing), false, 'typing a folder name does not start the song');

  /* dragging a song onto the folder puts it in; dragging onto a song already inside does too */
  await song('Chop-28-4.mid').dragTo(fold('Preludes'));
  assert.deepEqual(await inFolders(), ['Preludes: Chop-28-4.mid']);
  await song('wtk1-prelude1.mid').dragTo(song('Chop-28-4.mid'));
  assert.deepEqual(await inFolders(), ['Preludes: Chop-28-4.mid, wtk1-prelude1.mid']);
  assert.deepEqual(await order(), ['[Preludes]', '  Chop-28-4', '  wtk1-prelude1', '[New folder]', 'Prelude in C major', 'gymnopedie_1']);
  await a.shot('151-folder-open');

  /* a click closes the folder and another opens it; a song inside opens and plays like any other */
  await fold('Preludes').locator('.pick').click();
  assert.deepEqual(await order(), ['[Preludes]', '[New folder]', 'Prelude in C major', 'gymnopedie_1']);
  assert.equal(await fold('Preludes').locator('.dur').textContent(), '2');
  await fold('Preludes').locator('.pick').click();
  await song('wtk1-prelude1.mid').locator('.pick').click();
  await win.waitForFunction(() => pv.current === 'wtk1-prelude1.mid' && pv.playing);
  await win.evaluate(() => pv.pause());
  await fold('Preludes').locator('.pick').click();
  assert.equal(await fold('Preludes').evaluate(el => el.classList.contains('holds')), true, 'a closed folder is marked when it holds the song on stage');
  await a.shot('152-folder-closed');
  await fold('Preludes').locator('.pick').click();

  /* dragging a song from the folder onto the songs outside takes it out */
  await song('Chop-28-4.mid').dragTo(song('gymnopedie_1.mid'));
  assert.deepEqual(await inFolders(), ['Preludes: wtk1-prelude1.mid']);

  /* right-click renames the folder; a song renamed while inside stays inside */
  await fold('Preludes').click({button: 'right'});
  await win.locator('#songs .fold .rename').fill('Bach');
  await win.keyboard.press('Enter');
  assert.deepEqual(await inFolders(), ['Bach: wtk1-prelude1.mid']);
  await song('wtk1-prelude1.mid').click({button: 'right'});
  await win.locator('#songs .song .rename').fill('Prelude 1');
  await win.keyboard.press('Enter');
  await win.waitForFunction(() => pv.songs.some(s => s.name === 'Prelude 1.mid'));
  assert.deepEqual(await inFolders(), ['Bach: Prelude 1.mid']);
  assert.deepEqual(await order(), ['[Bach]', '  Prelude 1', '[New folder]', 'Prelude in C major', 'Chop-28-4', 'gymnopedie_1']);

  /* the folders are still there the next time the app starts */
  await a.close();
  a = await launch({folder, keep}); win = a.win;
  await win.waitForFunction(() => pv.songs.length === 3);
  assert.deepEqual(await order(), ['[Bach]', '  Prelude 1', '[New folder]', 'Prelude in C major', 'Chop-28-4', 'gymnopedie_1']);

  /* a slow drag onto a closed folder. While the song is over the folder, the folder is lit and every
     row stays where it was; a change in the song folder on disk waits until the song is let go */
  await fold('Bach').locator('.pick').click();
  const tops = () => win.evaluate(() => [...document.querySelectorAll('#songs > li')].map(li => Math.round(li.getBoundingClientRect().top)));
  const middle = async l => { const b = await l.boundingBox(); return [b.x + b.width / 2, b.y + b.height / 2]; };
  const before = await tops(), [sx, sy] = await middle(song('gymnopedie_1.mid')), [fx, fy] = await middle(fold('Bach'));
  await win.mouse.move(sx, sy); await win.mouse.down();
  await win.mouse.move(sx + 4, sy - 6, {steps: 3});
  await win.mouse.move(fx, fy, {steps: 12});
  await win.waitForTimeout(150);
  assert.deepEqual(await tops(), before, 'no row moves while a song is dragged over a folder');
  assert.deepEqual(await fold('Bach').evaluate(el => [el.classList.contains('aim'), getComputedStyle(el).position, Math.round(el.getBoundingClientRect().height)]), [true, 'static', 30], 'the folder under the song is lit and stays a row of the list');
  fs.copyFileSync(path.join(folder, 'Chop-28-4.mid'), path.join(folder, 'Arrived meanwhile.mid'));
  await win.waitForFunction(() => pv.songs.length === 4);
  await win.waitForTimeout(400);
  assert.equal(await song('Arrived meanwhile.mid').count(), 0, 'the list is not redrawn under a song being dragged');
  await a.shot('153-folder-drag-over');
  await win.mouse.up();
  await win.waitForFunction(() => document.querySelector('#songs .song[data-id="Arrived meanwhile.mid"]'));
  assert.deepEqual(await inFolders(), ['Bach: Prelude 1.mid, gymnopedie_1.mid']);
  assert.deepEqual(await order(), ['[Bach]', '[New folder]', 'Prelude in C major', 'Arrived meanwhile', 'Chop-28-4'], 'a closed folder stays closed when a song is dropped on it');
  assert.equal(await fold('Bach').locator('.dur').textContent(), '2');
  assert.equal(await win.evaluate(() => document.getElementById('songs').className), 'songs', 'nothing of the drag is left on the list');
  await fold('Bach').locator('.pick').click();
  /* dragged out again onto the songs outside */
  await song('gymnopedie_1.mid').dragTo(song('Chop-28-4.mid'));
  assert.deepEqual(await inFolders(), ['Bach: Prelude 1.mid']);

  /* removing a folder asks once more, then lets its songs back into the list; no file is touched */
  await fold('Bach').hover();
  await fold('Bach').locator('.rm').click();
  assert.equal(await fold('Bach').locator('.rm').textContent(), await win.evaluate(() => pv.T.removeConfirm));
  await fold('Bach').locator('.rm').click();
  assert.deepEqual(await inFolders(), []);
  assert.deepEqual(await order(), ['[New folder]', 'Prelude in C major', 'Arrived meanwhile', 'Chop-28-4', 'gymnopedie_1', 'Prelude 1']);
  assert.deepEqual(fs.readdirSync(folder).sort(), ['Arrived meanwhile.mid', 'Chop-28-4.mid', 'Prelude 1.mid', 'gymnopedie_1.mid']);
  console.log('FOLDER CHECKS PASSED');
} finally {
  console.log(a.problems.slice(0, 8).join('\n') || 'no console problems');
  await a.close();
  fs.rmSync(keep, {recursive: true, force: true});
}
