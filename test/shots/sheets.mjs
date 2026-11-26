/* Sheet music as PDF: saved from Settings, listed on the Sheets tab, opened over the stage, put in a folder, removed. */
import {launch, songFolder, sheetFolder} from './harness.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

const keep = fs.mkdtempSync(path.join(os.tmpdir(), 'pv-keep-'));
const a = await launch({folder: songFolder(['Chop-28-4.mid']), keep});
const {win} = a;
try {
  await win.waitForFunction(() => pv.songs.length === 1);
  await win.evaluate(() => pv.openSong('Chop-28-4.mid'));
  await win.locator('#lookBtn').click();
  await win.locator('#sheetPdf').scrollIntoViewIfNeeded();
  await a.shot('120-settings-save-as-pdf');
  await win.locator('#sheetPdf').click();
  await win.waitForFunction(() => pv.message === pv.T.pdfSaved, null, {timeout: 60000});
  const pdf = path.join(sheetFolder(keep), 'Chop-28-4.pdf'), bytes = fs.readFileSync(pdf);
  assert.equal(bytes.subarray(0, 5).toString(), '%PDF-', 'a PDF file was written');
  const pages = (bytes.toString('latin1').match(/\/Type\s*\/Page\b/g) || []).length;
  assert.ok(pages >= 2 && bytes.length > 20000, 'with the piece on its pages: ' + pages + ' pages, ' + bytes.length + ' bytes');
  fs.copyFileSync(pdf, path.join(path.dirname(new URL(import.meta.url).pathname.slice(1)), '..', 'out', 'Chop-28-4.pdf'));
  await win.locator('#lookBtn').click();

  /* the Sheets tab lists it; picking it shows its pages in place of the stage and stops the piece */
  await win.locator('#libKind [data-kind="sheets"]').click();
  await win.waitForFunction(() => pvSheets.list.length === 1);
  assert.equal(await win.locator('#sheets .song .name').textContent(), 'Chop-28-4');
  await a.shot('121-sheets-tab');
  await win.evaluate(() => pv.play());
  await win.locator('#sheets .song .pick').click();
  await win.waitForFunction(() => document.querySelectorAll('#pages img').length > 0 && [...document.querySelectorAll('#pages img')].every(i => i.complete && i.naturalWidth > 0));
  assert.equal(await win.evaluate(() => pv.playing), false, 'the piece stops');
  assert.equal(await win.locator('#pages img').count(), pages, 'every page of the PDF is shown');
  await win.waitForTimeout(300);
  await a.shot('122-sheet-pages-open');
  await win.evaluate(() => { document.getElementById('pages').scrollTop = 99999; });
  await win.waitForTimeout(200);
  await a.shot('123-sheet-pages-end');
  await win.locator('#pagesClose').click();
  assert.equal(await win.locator('#pages').count(), 0);

  /* back to Songs, and starting a song puts open pages away */
  await win.locator('#sheets .song .pick').click();
  await win.waitForSelector('#pages');
  await win.locator('#libKind [data-kind="songs"]').click();
  assert.ok(await win.locator('#songs').isVisible() && !(await win.locator('#sheets').isVisible()));
  await win.locator('#songs .pick').first().click();
  assert.equal(await win.locator('#pages').count(), 0, 'picking a song closes the pages');
  await win.evaluate(() => pv.pause());

  /* saved sheets go in folders as songs do: a folder is made, the sheet is dragged in and out again */
  await win.locator('#libKind [data-kind="sheets"]').click();
  const sheetFolders = () => win.evaluate(() => pvFolders.sheets.read().folders.map(f => f.name + ': ' + f.songs.join(', ')));
  const rows = () => win.evaluate(() => [...document.querySelectorAll('#sheets > li')].map(li => li.classList.contains('fold') ? '[' + li.querySelector('.name').textContent + ']' : (li.classList.contains('in') ? '  ' : '') + li.querySelector('.name').textContent));
  await win.locator('#sheets .fold.new .pick').click();
  await win.locator('#sheets .fold.new .rename').fill('Chopin');
  await win.keyboard.press('Enter');
  assert.deepEqual(await sheetFolders(), ['Chopin: ']);
  await win.locator('#sheets .song[data-id="Chop-28-4"]').dragTo(win.locator('#sheets .fold[data-folder="Chopin"]'));
  assert.deepEqual(await sheetFolders(), ['Chopin: Chop-28-4']);
  assert.deepEqual(await rows(), ['[Chopin]', '  Chop-28-4', '[New folder]']);
  await a.shot('124-sheets-folder');
  assert.deepEqual(await win.evaluate(() => pvFolders.read().folders), [], 'the Songs list has folders of its own');
  await win.locator('#sheets .fold[data-folder="Chopin"] .pick').click();
  assert.deepEqual(await rows(), ['[Chopin]', '[New folder]']);
  assert.equal(await win.locator('#sheets .fold[data-folder="Chopin"] .dur').textContent(), '1');
  await win.locator('#sheets .fold[data-folder="Chopin"] .pick').click();
  await win.locator('#sheets .song .pick').click();
  await win.waitForSelector('#pages');
  await win.locator('#pagesClose').click();
  await win.locator('#sheets .fold[data-folder="Chopin"]').hover();
  await win.locator('#sheets .fold[data-folder="Chopin"] .rm').click();
  await win.locator('#sheets .fold[data-folder="Chopin"] .rm').click();
  assert.deepEqual(await rows(), ['[New folder]', 'Chop-28-4'], 'removing the folder leaves the sheet');

  /* removing takes two clicks and deletes the file */
  await win.locator('#sheets .song').hover();
  await win.locator('#sheets .song .rm').click();
  assert.ok(fs.existsSync(pdf), 'one click only asks');
  await win.locator('#sheets .song .rm').click();
  await win.waitForFunction(() => pvSheets.list.length === 0);
  assert.ok(!fs.existsSync(pdf));
  assert.equal(await win.locator('#sheetsNote').textContent(), await win.evaluate(() => pv.T.sheetsEmpty));
  console.log('PDF:', pages, 'pages,', Math.round(bytes.length / 1024), 'KB; listed, opened, closed and removed');
  console.log('ALL SHEETS CHECKS PASSED');
} finally {
  console.log(a.problems.join('\n') || 'no console problems');
  await a.close();
  fs.rmSync(keep, {recursive: true, force: true});
}
