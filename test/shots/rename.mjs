/* Renaming by right-click in the Songs and Sheets lists, the title printed on saved sheet music,
   and the sheet music band closing when saved pages open. */
import {launch, songFolder} from './harness.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import assert from 'node:assert/strict';

const keep = fs.mkdtempSync(path.join(os.tmpdir(), 'pv-keep-')), folder = songFolder(['Chop-28-4.mid', 'wtk1-prelude1.mid']);
const a = await launch({folder, keep});
const {win} = a;
try {
  await win.waitForFunction(() => pv.songs.length === 2);
  await win.evaluate(() => pv.openSong('Chop-28-4.mid'));
  const row = name => win.locator(`#songs .song[data-id="${name}"]`);

  /* right-click puts a box in place of the name; Escape leaves the name alone */
  await row('Chop-28-4.mid').click({button: 'right'});
  assert.equal(await win.locator('#songs .rename').inputValue(), 'Chop-28-4');
  await a.shot('140-rename-song');
  await win.keyboard.press('Escape');
  assert.equal(await win.locator('#songs .rename').count(), 0);
  assert.ok(fs.existsSync(path.join(folder, 'Chop-28-4.mid')));

  /* Enter renames the file, and the song on stage carries on under the new name */
  await row('Chop-28-4.mid').click({button: 'right'});
  await win.locator('#songs .rename').fill('Prelude in E minor');
  await win.keyboard.press('Enter');
  await win.waitForFunction(() => pv.songs.some(s => s.name === 'Prelude in E minor.mid'));
  assert.ok(fs.existsSync(path.join(folder, 'Prelude in E minor.mid')) && !fs.existsSync(path.join(folder, 'Chop-28-4.mid')));
  assert.equal(await win.evaluate(() => pv.current), 'Prelude in E minor.mid');
  assert.equal(await win.locator('#title').textContent(), 'Prelude in E minor');
  assert.equal(await win.evaluate(() => pv.playing), false, 'typing a name does not start the song');

  /* a name another song has is refused */
  await row('wtk1-prelude1.mid').click({button: 'right'});
  await win.locator('#songs .rename').fill('prelude in e minor');
  await win.keyboard.press('Enter');
  await win.waitForFunction(() => pv.message === pv.T.errNameTaken);
  assert.ok(fs.existsSync(path.join(folder, 'wtk1-prelude1.mid')));

  /* saved sheet music has the song's title printed at the top of its first page */
  await win.locator('#lookBtn').click();
  await win.locator('#sheetPdf').click();
  await win.waitForFunction(() => pv.message === pv.T.pdfSaved, null, {timeout: 90000});
  await win.locator('#lookBtn').click();
  const sheets = path.join(keep, 'sheets'), pages = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(sheets, 'Prelude in E minor.pages'))).toString('utf8'));
  assert.ok(/class="Text"/.test(pages[0]) && !/class="Text"/.test(pages[1] || ''), 'a title on the first page only');

  /* opening saved pages puts the sheet music band away */
  await win.locator('#sheetBtn').click();
  assert.equal(await win.locator('#sheetBtn').getAttribute('aria-expanded'), 'true');
  await win.locator('#libKind [data-kind="sheets"]').click();
  await win.waitForFunction(() => pvSheets.list.length === 1);
  await win.locator('#sheets .pick').click();
  await win.waitForFunction(() => document.querySelectorAll('#pages img').length > 0 && [...document.querySelectorAll('#pages img')].every(i => i.complete && i.naturalWidth > 0));
  assert.equal(await win.locator('#sheetBtn').getAttribute('aria-expanded'), 'false', 'the band closes');
  assert.ok(!(await win.locator('#sheet').isVisible()));
  await win.waitForTimeout(300);
  await a.shot('141-saved-sheet-with-title');

  /* a saved sheet is renamed the same way, and stays open under its new name */
  await win.locator('#sheets .song').click({button: 'right'});
  await win.locator('#sheets .rename').fill('Chopin: Prelude');
  await win.keyboard.press('Enter');
  await win.waitForFunction(() => pvSheets.list.length === 1 && pvSheets.list[0].name === 'Chopin Prelude');
  assert.ok(fs.existsSync(path.join(sheets, 'Chopin Prelude.pdf')) && fs.existsSync(path.join(sheets, 'Chopin Prelude.pages')) && !fs.existsSync(path.join(sheets, 'Prelude in E minor.pdf')));
  assert.equal(await win.evaluate(() => pvSheets.open), 'Chopin Prelude');
  assert.equal(await win.locator('#pages').count(), 1);
  await a.shot('142-sheet-renamed');
  console.log('ALL RENAME CHECKS PASSED');
} finally {
  console.log(a.problems.join('\n') || 'no console problems');
  await a.close();
  fs.rmSync(keep, {recursive: true, force: true});
}
