/* The welcome page and the tour that follows it, in the real app. The page lies over the app the
   first time it is opened: the app's own stage plays in the strip without a sound, an account is
   made through the form (against a stand-in for the account service, on this computer), and
   picking the piano lifts the page off the app. The tour then moves on when what it asks for is
   tried, or with Next, and Skip ends it. A second start is not welcomed again. */
import {launch, out, root} from './harness.mjs';
import {_electron as electron} from 'playwright-core';
import {serve} from '../../scripts/serve-phone.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';

/* ---------- the stand-in account service: sign-up, sign-in, and an account with nothing in it ---------- */
const users = new Map();
const cors = {'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'apikey, authorization, content-type, x-upsert', 'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS'};
const cloud = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', c => chunks.push(c)).on('end', () => {
    const body = Buffer.concat(chunks).toString(), url = new URL(req.url, 'http://x'), reply = (code, data) => res.writeHead(code, {...cors, 'Content-Type': 'application/json'}).end(data === undefined ? '' : JSON.stringify(data));
    if (req.method === 'OPTIONS') return reply(204);
    const session = (email, u) => ({access_token: 'token-' + u.id, refresh_token: 'refresh-' + u.id, expires_in: 3600, user: {id: u.id, email}});
    if (url.pathname === '/auth/v1/signup') {
      const {email, password} = JSON.parse(body);
      if (users.has(email)) return reply(422, {msg: 'User already registered'});
      const u = {id: crypto.randomUUID(), password}; users.set(email, u);
      return reply(200, session(email, u));
    }
    if (url.pathname === '/auth/v1/token') {
      const j = JSON.parse(body), u = users.get(j.email);
      return u && u.password === j.password ? reply(200, session(j.email, u)) : reply(400, {error_code: 'invalid_credentials'});
    }
    if (url.pathname.startsWith('/storage/v1/object/list/')) return reply(200, []);
    reply(404, {});
  });
});
await new Promise(r => cloud.listen(0, '127.0.0.1', r));
const cloudUrl = 'http://127.0.0.1:' + cloud.address().port;
/* the phone version, served from this computer */
const site = await serve(0, '127.0.0.1'), siteUrl = 'http://127.0.0.1:' + site.address().port + '/ui/index.html?test';

const keep = fs.mkdtempSync(path.join(os.tmpdir(), 'pv-welcome-'));
/* Opens the app as if for the first time, with the welcome page up and the strip cleared. From
   here on the app takes the stand-in for the account service, at every start. */
async function firstVisit(a) {
  await a.win.evaluate(url => { localStorage.setItem('musicden-welcome-check', '1'); localStorage.setItem('musicden-cloud-check', url); location.reload(); }, cloudUrl);
  await a.win.waitForFunction(() => window.pv && pv.stage.geo && window.pvCloud && document.querySelector('#welcome') && !document.querySelector('#welcome.wv-wait'), null, {timeout: 20000});
  await a.win.waitForTimeout(1300);
}
const shown = (win, sel) => win.evaluate(sel => { const el = document.querySelector(sel); return !!el && el.getClientRects().length > 0; }, sel);
const tourAt = win => win.evaluate(() => (document.querySelector('.tour-box.tour-on:not(.tour-off) #tourName') || {}).textContent || '');
const untilTour = (win, name) => win.waitForFunction(name => (document.querySelector('.tour-box.tour-on:not(.tour-off) #tourName') || {}).textContent === name, name, {timeout: 8000});

let a = await launch({keep});
try {
  const {win} = a, T = await win.evaluate(() => pv.T);
  assert.equal(await shown(win, '#welcome'), false, 'a check that has not asked is not welcomed');

  /* ---------- first visit: the page over the app ---------- */
  await firstVisit(a);
  assert.equal(await win.evaluate(() => document.querySelector('.app').classList.contains('welcoming')), true);
  assert.equal(await shown(win, '#lib'), false, 'the Songs panel waits under the page');
  const [t0, playing] = await win.evaluate(() => [pv.now(), pv.playing]);
  await win.waitForTimeout(700);
  const t1 = await win.evaluate(() => pv.now());
  assert.ok(playing && t1 > t0 + 0.4, `the piece plays under the page (${t0.toFixed(2)} to ${t1.toFixed(2)})`);
  assert.equal(await win.evaluate(() => pv.piano.voices ? pv.piano.voices.size || pv.piano.voices.length || 0 : 0), 0, 'and makes no sound');
  assert.equal(await win.evaluate(() => document.querySelector('.wv-pane:not([hidden]) .wv-title').textContent), T.welcome);
  await a.shot('200-welcome-account');

  /* the space bar belongs to the page while it is up: it does not stop the piece underneath */
  await win.keyboard.press('Space');
  assert.equal(await win.evaluate(() => pv.playing), true);

  /* ---------- an account, made through the form ---------- */
  await win.locator('#wvCreate').click();
  await win.waitForTimeout(450);
  assert.equal(await shown(win, '#wvEmail'), true);
  await win.locator('#wvGo').click();
  assert.equal(await win.evaluate(() => document.querySelector('#wvSay').textContent), T.errAccountFields, 'an empty form says what is missing');
  await a.shot('201-welcome-form');
  /* the line under the list turns the form into a sign-in, and back */
  await win.locator('#wvOther').click();
  assert.deepEqual(await win.evaluate(() => [document.querySelector('#wvCreate .wv-name').textContent, document.querySelector('#wvGo').textContent]), [T.signIn, T.signIn]);
  await win.locator('#wvOther').click();
  assert.deepEqual(await win.evaluate(() => [document.querySelector('#wvCreate .wv-name').textContent, document.querySelector('#wvGo').textContent]), [T.welcomeCreate, T.createAccount]);
  await win.locator('#wvEmail').fill('pianist@example.com');
  await win.locator('#wvPass').fill('correct horse');
  await win.locator('#wvGo').click();
  await win.waitForFunction(() => !document.querySelector('.wv-pane[data-step="2"]').hidden, null, {timeout: 10000});
  assert.equal(await win.evaluate(() => pvCloud.cloud.account().email), 'pianist@example.com');
  assert.equal(users.size, 1, 'the account was made');
  assert.equal(await shown(win, '#wvBack'), false, 'once signed in there is no going back to the question about an account');

  /* ---------- the instrument: the strip shows the one looked at ---------- */
  await win.waitForTimeout(700);
  assert.equal(await win.evaluate(() => document.querySelector('.wv-pane:not([hidden]) .wv-title').textContent), T.welcomeChoose);
  assert.deepEqual(await win.evaluate(() => [...document.querySelectorAll('.wv-pane:not([hidden]) .wv-name')].map(n => n.textContent + ': ' + n.nextElementSibling.textContent)),
    [T.piano + ': ' + T.pianoNote, T.guitar + ': ' + T.guitarNote]);
  await win.locator('.wv-row[data-inst=piano]').hover();
  await win.waitForTimeout(500);
  await a.shot('202-welcome-instrument-piano');
  await win.locator('.wv-row[data-inst=guitar]').hover();
  await win.waitForTimeout(1200);
  assert.equal(await win.evaluate(() => document.querySelector('#welcome').classList.contains('wv-guitar')), true);
  const inked = await win.evaluate(() => { const c = document.querySelector('.wv-tab canvas'), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] > 200 && d[i + 1] > 200 && d[i + 2] > 200) n++; return n; });
  assert.ok(inked > 200, 'the guitar\'s tab is drawn in the strip (' + inked + ' bright pixels)');
  await a.shot('203-welcome-instrument-guitar');

  /* ---------- the piano: the page lifts off the app, and the tour begins ---------- */
  await win.locator('.wv-row[data-inst=piano]').click();
  await win.waitForTimeout(900);
  await a.shot('204-welcome-lifting');
  await win.waitForFunction(() => !document.querySelector('#welcome'), null, {timeout: 8000});
  assert.deepEqual(await win.evaluate(() => [document.querySelector('.app').classList.contains('welcoming'), pv.playing, pv.now(), localStorage.getItem('musicden-welcomed'), localStorage.getItem('musicden-instrument')]), [false, false, 0, '1', 'piano']);
  assert.equal(await shown(win, '#lib'), true, 'the Songs panel is back');
  await untilTour(win, T.tour.piano.play[0]);
  await win.waitForTimeout(500);
  await a.shot('205-tour-play');
  /* the first stop asks for the piece to be played: the space bar does it, and the tour moves on by itself */
  await win.keyboard.press('Space');
  assert.equal(await win.evaluate(() => pv.playing), true);
  await untilTour(win, T.tour.piano.keys[0]);
  await win.evaluate(() => pv.pause());
  await win.waitForTimeout(500);
  await a.shot('206-tour-keyboard');
  /* the second stop is about the keyboard: a key played by hand moves the tour on */
  await win.evaluate(() => { pv.liveOn(60, 0.7); setTimeout(() => pv.liveOff(60), 300); });
  await untilTour(win, T.tour.piano.songs[0]);
  await win.waitForTimeout(500);
  await a.shot('207-tour-songs');
  await win.locator('#tourNext').click();
  await untilTour(win, T.tour.piano.sheet[0]);
  await win.locator('#tourNext').click();
  await untilTour(win, T.tour.piano.settings[0]);
  assert.equal(await win.evaluate(() => document.querySelector('#tourNext').textContent), T.tourDone);
  await win.waitForTimeout(500);
  await a.shot('208-tour-settings');
  /* the last stop is about Settings: opening it ends the tour */
  await win.locator('#lookBtn').click();
  await win.waitForFunction(() => !document.querySelector('.tour-box'), null, {timeout: 8000});
  assert.equal(await win.evaluate(() => document.querySelector('#insp [data-inst=piano]').getAttribute('aria-checked')), 'true', 'Settings names the instrument');
  await a.shot('209-settings-instrument');
  assert.deepEqual(a.problems, [], 'nothing went wrong on the page');
  await a.close();

  /* ---------- a second start is not welcomed, and has no tour ---------- */
  a = await launch({keep});
  await a.win.waitForTimeout(800);
  assert.equal(await shown(a.win, '#welcome'), false);
  assert.equal(await tourAt(a.win), '');

  /* ---------- someone already signed in is asked only for the instrument; Skip ends the tour at once ---------- */
  await a.win.evaluate(() => { localStorage.removeItem('musicden-welcomed'); location.reload(); });
  await a.win.waitForFunction(() => window.pv && pv.stage.geo && document.querySelector('#welcome') && !document.querySelector('#welcome.wv-wait'), null, {timeout: 20000});
  await a.win.waitForTimeout(1200);
  assert.equal(await shown(a.win, '#wvCreate'), false);
  assert.equal(await a.win.evaluate(() => document.querySelector('.wv-pane:not([hidden]) .wv-title').textContent), T.welcome);
  await a.shot('210-welcome-signed-in');
  await a.win.locator('.wv-row[data-inst=piano]').click();
  await untilTour(a.win, T.tour.piano.play[0]);
  await a.win.locator('#tourSkip').click();
  await a.win.waitForFunction(() => !document.querySelector('.tour-box'), null, {timeout: 3000});
  assert.deepEqual(a.problems, [], 'nothing went wrong on the page');

  /* ---------- the guitar: its own page takes the piano's place, comes up from under the dark sheet, and has its own tour ---------- */
  await a.close();
  const guitarist = fs.mkdtempSync(path.join(os.tmpdir(), 'pv-welcome-guitar-'));
  try {
    a = await launch({keep: guitarist});
    await firstVisit(a);
    await a.win.locator('#wvLocal').click();
    await a.win.waitForFunction(() => !document.querySelector('.wv-pane[data-step="2"]').hidden);
    await a.win.waitForTimeout(700);
    await a.win.locator('.wv-row[data-inst=guitar]').click();
    await a.win.waitForFunction(() => location.pathname.endsWith('/ui/guitar/index.html') && window.gt && gt.ready, null, {timeout: 20000});
    assert.deepEqual(await a.win.evaluate(() => [localStorage.getItem('musicden-welcomed'), localStorage.getItem('musicden-instrument'), gt.current]), ['1', 'guitar', 'aguado-small-piece-4']);
    await untilTour(a.win, T.tour.guitar.play[0]);
    assert.equal(await shown(a.win, '.wv'), false, 'the dark sheet has lifted off the guitar\'s page');
    await a.win.waitForTimeout(500);
    await a.shot('216-guitar-tour-play');
    /* the space bar plays the tab, and the tour moves on by itself */
    await a.win.keyboard.press('Space');
    await untilTour(a.win, T.tour.guitar.tab[0]);
    await a.win.evaluate(() => gt.pause());
    await a.win.waitForTimeout(500);
    await a.shot('217-guitar-tour-tab');
    await a.win.locator('#tourNext').click();
    await untilTour(a.win, T.tour.guitar.songs[0]);
    await a.win.waitForTimeout(500);
    await a.shot('218-guitar-tour-songs');
    await a.win.locator('#tourNext').click();
    await untilTour(a.win, T.tour.guitar.edit[0]);
    /* pressing Edit is trying it: on to the last stop, which opening Settings ends */
    await a.win.locator('#editBtn').click();
    await untilTour(a.win, T.tour.guitar.settings[0]);
    await a.win.waitForTimeout(500);
    await a.shot('219-guitar-tour-settings');
    await a.win.locator('#setBtn').click();
    await a.win.waitForFunction(() => !document.querySelector('.tour-box'), null, {timeout: 8000});
    assert.equal(await a.win.evaluate(() => document.querySelector('#instrument').value), 'guitar', 'Settings names the instrument');
    assert.deepEqual(a.problems, [], 'nothing went wrong on the guitar\'s page');
    await a.close();
    /* from then on the app opens on the guitar's page, with no welcome and no tour */
    const again = await electron.launch({args: ['.'], cwd: root, env: {...process.env, MUSICDEN_TEST: '1', MUSICDEN_TEST_VISIBLE: '', MUSICDEN_USER_DATA: guitarist, MUSICDEN_FOLDER: ''}});
    try {
      const page = await again.firstWindow();
      await page.waitForFunction(() => location.pathname.endsWith('/ui/guitar/index.html') && window.gt && gt.ready, null, {timeout: 20000});
      await page.waitForTimeout(900);
      assert.deepEqual(await page.evaluate(() => [!!document.querySelector('.wv'), !!document.querySelector('.tour-box'), gt.current]), [false, false, 'aguado-small-piece-4']);
    } finally { await again.close(); }
    a = await launch();
  } finally { try { fs.rmSync(guitarist, {recursive: true, force: true}); } catch (e) {} }

  /* ---------- the phone version: held upright the app lies on its side, and the page and the tour with it ---------- */
  for (const [name, width, height] of [['upright', 412, 860], ['sideways', 860, 412]]) {
    const opened = a.app.waitForEvent('window');
    await a.app.evaluate(({BrowserWindow}, [url, w, h]) => { const win = new BrowserWindow({width: w, height: h, x: -30000, y: -30000, show: false, useContentSize: true, webPreferences: {backgroundThrottling: false}}); win.showInactive(); win.loadURL(url); }, [siteUrl, width, height]);
    const phone = await opened, wrong = [];
    phone.on('console', m => { if (m.type() === 'error') wrong.push(m.text()); });
    phone.on('pageerror', e => wrong.push(e.message));
    await phone.waitForFunction(() => window.pv && pv.stage.geo, null, {timeout: 20000});
    await phone.evaluate(url => { localStorage.clear(); localStorage.setItem('musicden-welcome-check', '1'); localStorage.setItem('musicden-cloud-check', url); location.reload(); }, cloudUrl);
    await phone.waitForFunction(() => window.pv && pv.stage.geo && document.querySelector('#welcome') && !document.querySelector('#welcome.wv-wait'), null, {timeout: 20000});
    await phone.waitForTimeout(1300);
    assert.equal(await phone.evaluate(() => document.documentElement.classList.contains('turned')), name === 'upright');
    await phone.screenshot({path: path.join(out, `211-phone-${name}-welcome.png`)});
    await phone.locator('#wvCreate').click();
    await phone.waitForTimeout(500);
    await phone.screenshot({path: path.join(out, `212-phone-${name}-form.png`)});
    await phone.locator('#wvLocal').click();
    await phone.waitForFunction(() => !document.querySelector('.wv-pane[data-step="2"]').hidden);
    await phone.waitForTimeout(700);
    await phone.screenshot({path: path.join(out, `213-phone-${name}-instrument.png`)});
    await phone.locator('.wv-row[data-inst=piano]').click();
    await untilTour(phone, T.tour.piano.play[0]);
    await phone.waitForTimeout(500);
    await phone.screenshot({path: path.join(out, `214-phone-${name}-tour-play.png`)});
    /* in a browser the tour has no stop for sheet music, which is written on a computer */
    const stops = [];
    for (let i = 0; i < 6 && await tourAt(phone); i++) {
      stops.push(await tourAt(phone));
      if (stops.length === 3) { await phone.waitForTimeout(500); await phone.screenshot({path: path.join(out, `215-phone-${name}-tour-songs.png`)}); }
      await phone.locator('#tourNext').click();
      await phone.waitForTimeout(450);
    }
    assert.deepEqual(stops, [T.tour.piano.play[0], T.tour.piano.keysTouch[0], T.tour.piano.songsWeb[0], T.tour.piano.settings[0]]);
    assert.deepEqual(wrong, [], 'nothing went wrong on the phone');
    await phone.close();
  }
  console.log('WELCOME AND TOUR CHECKS PASSED (accounts against the stand-in account service)');
} finally {
  await a.close().catch(() => {});
  cloud.close(); site.close();
  try { fs.rmSync(keep, {recursive: true, force: true}); } catch (e) {}
}
