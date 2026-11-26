/* The phone version under a finger, in windows the size of a phone lying down and held upright:
   what is pressed is big enough, one panel is open at a time, a row's "more" button and a press
   and hold both open the row's menu (rename, move to a folder, take out, remove), and the screen
   is kept on while a song plays. Touches are sent as the browser's own touch input. */
import {launch, songFolder, out} from './harness.mjs';
import {serve} from '../../scripts/serve-phone.mjs';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

const site = await serve(0, '127.0.0.1'), siteUrl = 'http://127.0.0.1:' + site.address().port + '/ui/index.html?test';
const a = await launch({folder: songFolder([])});
const fixtures = ['Chop-28-4.mid', 'gymnopedie_1.mid', 'wtk1-prelude1.mid'].map(n => [n, Array.from(fs.readFileSync(path.join('test', 'fixtures', n)))]);
const problems = [];
/* A window the size of a phone, with the test songs on it. */
async function phoneWindow(w, h) {
  const opened = a.app.waitForEvent('window');
  await a.app.evaluate(({BrowserWindow}, [url, w, h]) => { const win = new BrowserWindow({width: w, height: h, x: -30000, y: -30000, show: false, useContentSize: true, webPreferences: {backgroundThrottling: false}}); win.showInactive(); win.loadURL(url); }, [siteUrl, w, h]);
  const page = await opened;
  page.on('console', m => { if (m.type() === 'error') problems.push(m.text()); });
  page.on('pageerror', e => problems.push(e.message));
  await page.waitForFunction(() => window.pv && pv.stage.geo && window.pvCloud, null, {timeout: 20000});
  await page.evaluate(async files => { localStorage.removeItem('piano-visualizer-folders'); await desk.library.importFiles(files.map(([n, b]) => new File([new Uint8Array(b)], n))); }, fixtures);
  /* a second window finds the first one's songs already there: both keep them in the same place */
  await page.waitForFunction(() => pv.songs.length >= 3);
  return page;
}
const listed = page => page.evaluate(() => [...document.querySelectorAll('#songs > li')].map(li => li.classList.contains('fold') ? '[' + li.querySelector('.name').textContent + ']' : (li.classList.contains('in') ? '  ' : '') + li.querySelector('.name').textContent));
const menuItems = page => page.locator('#lib .more-menu button').allTextContents();
const song = (page, name) => page.locator(`#songs .song[data-id="${name}"]`);
/* A finger down at the middle of an element, held for a while, then lifted. The list is first left
   to finish redrawing: a row that is replaced while it is being brought into view cannot be pressed. */
async function press(page, locator, ms) {
  await page.waitForTimeout(300);
  await locator.scrollIntoViewIfNeeded();
  await page.waitForTimeout(100);
  const box = await locator.boundingBox(), touch = await page.context().newCDPSession(page);
  const point = {x: Math.round(box.x + box.width / 3), y: Math.round(box.y + box.height / 2)};
  await touch.send('Input.dispatchTouchEvent', {type: 'touchStart', touchPoints: [point]});
  await page.waitForTimeout(ms);
  await touch.send('Input.dispatchTouchEvent', {type: 'touchEnd', touchPoints: []});
  await touch.detach();
}
try {
  /* ---------- lying down ---------- */
  const phone = await phoneWindow(844, 390);
  assert.equal(await phone.evaluate(() => document.documentElement.className.includes('compact')), true);

  /* nothing pressed in the top strip is under 40 pixels, and rows and Settings controls are finger-sized */
  await phone.locator('#libBtn').click();
  const sizes = await phone.evaluate(() => {
    const h = sel => Math.round(Math.min(...[...document.querySelectorAll(sel)].filter(el => el.offsetParent).map(el => Math.min(el.offsetHeight, el.offsetWidth))));
    return {strip: h('.bar button, .bar select'), rows: Math.round(document.querySelector('#songs .song').offsetHeight), more: h('#songs .more'), head: h('.lib-head button'), account: h('#acct button')};
  });
  console.log('lying down, smallest side of what is pressed:', JSON.stringify(sizes));
  assert.ok(sizes.strip >= 40 && sizes.rows >= 44 && sizes.more >= 44 && sizes.head >= 36 && sizes.account >= 40, 'controls are big enough for a finger');
  assert.equal(await phone.locator('#songs .rm').first().isVisible(), false, 'rows end with the more button, not the remove button');

  /* one panel at a time */
  await phone.locator('#lookBtn').click();
  await phone.waitForFunction(() => document.querySelector('.app').classList.contains('hide-lib'));
  assert.equal(await phone.locator('#insp').isVisible(), true);
  const settings = await phone.evaluate(() => { const h = sel => Math.round(Math.min(...[...document.querySelectorAll(sel)].filter(el => el.offsetParent).map(el => el.offsetHeight))); return {choices: h('#insp .seg button'), switches: h('#insp .sw'), sliders: h('#insp input[type=range]'), rows: h('#insp .row')}; });
  console.log('Settings:', JSON.stringify(settings));
  assert.ok(settings.choices >= 36 && settings.sliders >= 36 && settings.rows >= 44);
  await phone.screenshot({path: path.join(out, '160-touch-settings.png')});
  await phone.locator('#libBtn').click();
  await phone.waitForFunction(() => document.querySelector('.app').classList.contains('hide-insp') && !document.querySelector('.app').classList.contains('hide-lib'));

  /* a folder, then the more button on a song: rename, and the folder to move into */
  await phone.locator('#songs .fold.new .pick').click();
  await phone.locator('#songs .fold.new .rename').fill('Preludes');
  await phone.keyboard.press('Enter');
  await song(phone, 'Chop-28-4.mid').locator('.more').click();
  assert.deepEqual(await menuItems(phone), ['Rename', 'Move to Preludes', 'Remove']);
  await phone.screenshot({path: path.join(out, '161-touch-menu.png')});
  await phone.locator('#lib .more-menu button', {hasText: 'Move to Preludes'}).click();
  assert.deepEqual((await listed(phone)).slice(0, 3), ['[Preludes]', '  Chop-28-4', '[New folder]']);
  assert.equal(await phone.evaluate(() => pv.current), ':built-in', 'choosing from the menu does not open the song');

  /* rename from the menu: the row turns into a box with the name in it */
  await song(phone, 'Chop-28-4.mid').locator('.more').click();
  assert.deepEqual(await menuItems(phone), ['Rename', 'Take out of Preludes', 'Remove']);
  await phone.locator('#lib .more-menu button', {hasText: 'Rename'}).click();
  assert.equal(await phone.locator('#songs .rename').inputValue(), 'Chop-28-4');
  assert.equal(await phone.evaluate(() => document.activeElement.className), 'rename', 'the box is ready to type in');
  await phone.locator('#songs .rename').fill('Prelude in E minor');
  await phone.keyboard.press('Enter');
  await phone.waitForFunction(() => pv.songs.some(s => s.name === 'Prelude in E minor.mid'));
  assert.deepEqual((await listed(phone)).slice(0, 3), ['[Preludes]', '  Prelude in E minor', '[New folder]']);

  /* pressing and holding a row opens the same menu, and lifting the finger does not open the song */
  await press(phone, song(phone, 'gymnopedie_1.mid'), 700);
  assert.deepEqual(await menuItems(phone), ['Rename', 'Move to Preludes', 'Remove']);
  await phone.waitForTimeout(450);
  assert.equal(await phone.evaluate(() => pv.current), ':built-in', 'the held row was not opened');
  /* a tap elsewhere puts the menu away; a short tap on a row still opens the song */
  await phone.locator('.lib-head').click({position: {x: 200, y: 10}});
  assert.equal(await phone.locator('#lib .more-menu').count(), 0);
  await press(phone, song(phone, 'gymnopedie_1.mid'), 60);
  await phone.waitForFunction(() => pv.current === 'gymnopedie_1.mid' && pv.playing);

  /* while it plays the screen is asked to stay on, and let go when it stops */
  await phone.evaluate(() => {
    pv.pause(); window.holds = [];
    Object.defineProperty(navigator, 'wakeLock', {configurable: true, value: {request: async kind => { window.holds.push('on ' + kind); return {release: async () => { window.holds.push('off'); }, addEventListener() {}}; }}});
    pv.play();
  });
  await phone.waitForFunction(() => window.holds.length === 1);
  await phone.evaluate(() => pv.pause());
  await phone.waitForFunction(() => window.holds.length === 2);
  assert.deepEqual(await phone.evaluate(() => window.holds), ['on screen', 'off']);

  /* take out of the folder, and remove: the row's own button asks once more */
  await song(phone, 'Prelude in E minor.mid').locator('.more').click();
  await phone.locator('#lib .more-menu button', {hasText: 'Take out of Preludes'}).click();
  assert.deepEqual((await listed(phone)).slice(0, 2), ['[Preludes]', '[New folder]']);
  await song(phone, 'wtk1-prelude1.mid').locator('.more').click();
  await phone.locator('#lib .more-menu button', {hasText: 'Remove'}).click();
  assert.equal(await song(phone, 'wtk1-prelude1.mid').locator('.rm').textContent(), 'Remove');
  await phone.screenshot({path: path.join(out, '162-touch-remove.png')});
  await song(phone, 'wtk1-prelude1.mid').locator('.rm').click();
  await phone.waitForFunction(() => pv.songs.length === 2);
  /* a folder's menu: rename and remove */
  await phone.locator('#songs .fold[data-folder="Preludes"] .more').click();
  assert.deepEqual(await menuItems(phone), ['Rename', 'Remove']);
  await phone.locator('#lib .more-menu button', {hasText: 'Rename'}).click();
  await phone.locator('#songs .fold .rename').fill('Chopin');
  await phone.keyboard.press('Enter');
  assert.deepEqual((await listed(phone)).slice(0, 2), ['[Chopin]', '[New folder]']);
  await phone.close();

  /* ---------- held upright: the app lies on its side, and the menu still opens inside the panel ---------- */
  const up = await phoneWindow(390, 844);
  assert.equal(await up.evaluate(() => document.documentElement.className.includes('turned')), true);
  if (await up.evaluate(() => document.querySelector('.app').classList.contains('hide-lib'))) await up.locator('#libBtn').click();
  await up.evaluate(() => pvFolders.replace({updated: '1', folders: [{name: 'Preludes', songs: []}]}));
  await press(up, song(up, 'wtk1-prelude1.mid'), 700);
  assert.deepEqual(await menuItems(up), ['Rename', 'Move to Preludes', 'Remove']);
  const inside = await up.evaluate(() => { const m = document.querySelector('.more-menu').getBoundingClientRect(), l = document.getElementById('lib').getBoundingClientRect(); return m.left >= l.left - 1 && m.right <= l.right + 1 && m.top >= l.top - 1 && m.bottom <= l.bottom + 1; });
  assert.ok(inside, 'the menu lies inside the Songs panel');
  await up.screenshot({path: path.join(out, '163-touch-upright-menu.png')});
  await up.locator('#lib .more-menu button', {hasText: 'Move to Preludes'}).click();
  assert.deepEqual((await up.evaluate(() => pvFolders.read().folders[0].songs)), ['wtk1-prelude1.mid']);
  await up.close();

  console.log(problems.length ? 'console: ' + problems.join('; ') : 'no console problems');
  assert.equal(problems.length, 0);
  console.log('TOUCH CHECKS PASSED');
} finally {
  await a.close(); site.close();
}
