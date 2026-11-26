/* The guitar's page, in the real window. The guitar is chosen as the instrument and the app opens
   on its page: the piece that comes with the app is listed and plays with the recorded guitar; a
   tab put in the folder of tabs shows up, opens and can be removed; sheet music is saved as
   MusicXML and as a PDF; and signing in (to a stand-in for the account service, on this computer)
   shows that account's tabs, brings along the ones made while signed out, and syncs them, while a
   second account sees none of the first one's. Settings then brings the piano's page back.
   After that the phone version is built as it is published and opened from a server on this
   computer: the guitar's page is answered there too, also once the server is shut down.

   With "transcribe" and a recording of solo guitar, it instead makes tabs with the real models,
   which takes a Python that has them (MUSICDEN_GUITAR_PYTHON, or the environment "npm run
   transcriber" sets up): the recording as a file, then as a link served from this computer; a
   link that is not one and a link that cannot be fetched say so; work under way is stopped with
   Cancel; and with a Python that lacks the models, or no Python at all, the app says what to install.
     node test/shots/guitar.mjs transcribe "C:\path\to\guitar.wav" */
import {launch, songFolder, out, NOBODY} from './harness.mjs';
import {build} from '../../scripts/build-phone.mjs';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';

const TABS = 'Guitar tabs', BUILT_IN = 'aguado-small-piece-4';
const until = async (what, test, ms = 20000) => { for (let t = 0; t < ms; t += 100) { if (await test()) return; await new Promise(r => setTimeout(r, 100)); } throw new Error('never happened: ' + what); };
const tabsIn = dir => (fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => f.endsWith('.json')).map(f => f.slice(0, -5)).sort() : []);
/* Chooses the guitar and waits for its page to have started. */
async function toGuitar(win) {
  await win.evaluate(() => localStorage.setItem('musicden-instrument', 'guitar'));
  await win.reload();
  await win.waitForURL(/\/guitar\/index\.html/, {timeout: 20000});
  await win.waitForFunction(() => window.gt && gt.ready && document.fonts.status === 'loaded', null, {timeout: 20000});
}

/* ---------- recordings into tabs, with the real models ---------- */
if (process.argv[2] === 'transcribe') {
  const recording = path.resolve(process.argv[3] || '');
  assert.ok(fs.existsSync(recording), 'give a recording of solo guitar');
  const bytes = fs.readFileSync(recording), ext = path.extname(recording);
  /* the recording is served under any name but "gone" */
  const server = http.createServer((req, res) => {
    if (req.url.startsWith('/gone')) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, {'Content-Type': 'application/octet-stream', 'Content-Length': bytes.length}); res.end(bytes);
  }).listen(0, '127.0.0.1');
  await new Promise(r => server.once('listening', r));
  const at = name => `http://127.0.0.1:${server.address().port}/${name}${ext}`;
  const folder = songFolder([]), a = await launch({folder});
  const {win} = a, line = () => win.evaluate(() => gt.job), text = k => win.evaluate(k => gt.T[k], k);
  const idle = () => win.waitForFunction(() => !gt.busy, null, {timeout: 300000});
  try {
    await toGuitar(win);
    /* a file on this computer */
    const began = Date.now(), seen = [];
    const done = win.evaluate(file => gt.transcribe(file, 'Check recording'), recording);
    const watch = setInterval(async () => { try { const what = (await line()).replace(/\d+:\d+.*$/, ''); if (what && what !== seen[seen.length - 1]) seen.push(what); } catch (e) {} }, 200);
    await win.waitForTimeout(1500);
    await a.shot('guitar-20-transcribing');
    const ok = await done;
    clearInterval(watch);
    console.log(`a file: ${((Date.now() - began) / 1000).toFixed(1)} s; steps shown: ${seen.join(' | ')}`);
    assert.equal(ok, true, 'the recording became a tab');
    assert.equal(await line(), '');
    const made = await win.evaluate(() => ({id: gt.current, title: gt.song.title, notes: gt.song.notes.length, beats: (gt.song.beats || []).length, listed: gt.songs.map(s => s.id)}));
    console.log('the tab:', JSON.stringify(made));
    assert.ok(made.notes > 20 && made.listed.includes(made.id), 'the tab is open and listed');
    assert.deepEqual(tabsIn(path.join(folder, TABS)), [made.id], 'its file is in the folder of tabs');
    await a.shot('guitar-21-transcribed');

    /* a link: what is not one is refused before anything runs, and one that cannot be fetched says so */
    await win.locator('#linkUrl').fill('not a link');
    await win.locator('#linkGo').click();
    assert.equal(await line(), await text('errLinkBad'));
    await win.locator('#linkUrl').fill(at('gone'));
    await win.locator('#linkUrl').press('Enter');
    await win.waitForFunction(() => gt.busy);
    await idle();
    assert.equal(await line(), await text('errDownload'));
    assert.equal(await win.inputValue('#linkUrl'), at('gone'), 'the link stays in the box, to be put right');
    const linked = Date.now();
    await win.locator('#linkUrl').fill(at('Guitar%20from%20a%20link'));
    await win.locator('#linkUrl').press('Enter');
    await win.waitForFunction(() => gt.busy);
    await idle();
    const fromLink = await win.evaluate(() => ({id: gt.current, title: gt.song.title, notes: gt.song.notes.length, job: gt.job, box: document.getElementById('linkUrl').value}));
    console.log(`a link: ${((Date.now() - linked) / 1000).toFixed(1)} s;`, JSON.stringify(fromLink));
    assert.equal(fromLink.title, 'Guitar from a link', 'the tab is named after the recording');
    assert.ok(fromLink.notes > 20 && fromLink.job === '' && fromLink.box === '');
    assert.deepEqual(tabsIn(path.join(folder, TABS)), [made.id, fromLink.id].sort());

    /* work under way is stopped with Cancel: nothing is saved, and the row is free again */
    await win.locator('#linkUrl').fill(at('Not%20wanted'));
    await win.locator('#linkUrl').press('Enter');
    await win.waitForFunction(() => /Writing out/.test(gt.job), null, {timeout: 120000});
    await win.locator('#jobStop').click();
    await idle();
    assert.equal(await line(), '');
    assert.equal(await win.locator('#linkGo').isDisabled(), false);
    assert.deepEqual(tabsIn(path.join(folder, TABS)), [made.id, fromLink.id].sort(), 'no tab was saved');
    assert.deepEqual(fs.readdirSync(os.tmpdir()).filter(f => f.startsWith('musicden-tab-')), [], 'the work files are gone');
    console.log('cancelled: nothing saved, the work files gone');
    console.log(a.problems.join('\n') || 'no console problems');
  } finally { await a.close(); }

  /* a Python without the models, and no Python at all: the app says what is needed */
  for (const [what, python] of [['a Python without the models', process.env.MUSICDEN_BARE_PYTHON || 'python'], ['no Python', path.join(os.tmpdir(), 'no-such', 'python.exe')]]) {
    process.env.MUSICDEN_GUITAR_PYTHON = python;
    const b = await launch({folder: songFolder([])});
    try {
      await toGuitar(b.win);
      const ok = await b.win.evaluate(file => gt.transcribe(file, 'Never made'), recording);
      const said = await b.win.evaluate(() => [gt.job, gt.T.errTools]);
      console.log(`${what}: ${ok ? 'a tab was made, so this Python has the models after all' : said[0] === said[1] ? 'the app says what to install' : 'the app said: ' + said[0]}`);
      if (what === 'no Python') { assert.equal(ok, false); assert.equal(said[0], said[1]); }
      if (!ok) await b.shot(what === 'no Python' ? 'guitar-23-no-python' : 'guitar-22-no-models');
    } finally { await b.close(); }
  }
  await new Promise(r => { server.closeAllConnections(); server.close(r); });
  console.log('GUITAR TRANSCRIPTION CHECKS PASSED');
  process.exit(0);
}

/* ---------- the stand-in account service ---------- */
const users = new Map(), files = new Map();   /* email -> {id, password}; "id/name" -> {bytes, updated} */
const cors = {'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'apikey, authorization, content-type, x-upsert', 'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS'};
const cloudServer = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', c => chunks.push(c)).on('end', () => {
    const body = Buffer.concat(chunks), url = new URL(req.url, 'http://x'), reply = (code, data) => res.writeHead(code, {...cors, 'Content-Type': 'application/json'}).end(data === undefined ? '' : JSON.stringify(data));
    if (req.method === 'OPTIONS') return reply(204);
    if (req.headers.apikey !== 'test-key') return reply(401, {msg: 'no key'});
    const sessionFor = (email, u) => ({access_token: 'token-' + u.id, refresh_token: 'refresh-' + u.id, expires_in: 3600, user: {id: u.id, email}});
    const who = (req.headers.authorization || '').replace('Bearer token-', ''), p = url.pathname;
    if (p === '/auth/v1/signup') {
      const {email, password} = JSON.parse(body);
      if (users.has(email)) return reply(422, {msg: 'User already registered'});
      const u = {id: crypto.randomUUID(), password}; users.set(email, u);
      return reply(200, sessionFor(email, u));
    }
    if (p === '/auth/v1/token') {
      const j = JSON.parse(body), u = users.get(j.email);
      return url.searchParams.get('grant_type') === 'password' && u && u.password === j.password ? reply(200, sessionFor(j.email, u)) : reply(400, {error_code: 'invalid_credentials'});
    }
    if (p === '/auth/v1/logout') return reply(204);
    if (![...users.values()].some(u => u.id === who)) return reply(401, {});
    if (p === '/storage/v1/object/list/songs') {
      const {prefix} = JSON.parse(body);
      if (!prefix.startsWith(who + '/')) return reply(200, []);
      return reply(200, [...files].filter(([k]) => k.startsWith(prefix) && !k.slice(prefix.length).includes('/')).map(([k, f]) => ({name: k.slice(prefix.length), id: k, updated_at: f.updated, metadata: {size: f.bytes.length}})));
    }
    const put = p.match(/^\/storage\/v1\/object\/songs\/([^/]+)\/(.+)$/), get = p.match(/^\/storage\/v1\/object\/authenticated\/songs\/([^/]+)\/(.+)$/);
    if (put && req.method === 'POST') { if (put[1] !== who) return reply(403, {}); files.set(put[1] + '/' + put[2], {bytes: body, updated: new Date().toISOString()}); return reply(200, {Key: p}); }
    if (put && req.method === 'DELETE') { if (put[1] !== who) return reply(403, {}); return files.delete(put[1] + '/' + put[2]) ? reply(200, {}) : reply(404, {}); }
    if (get && req.method === 'GET') { const f = get[1] === who && files.get(get[1] + '/' + get[2]); if (!f) return reply(404, {}); return res.writeHead(200, {...cors, 'Content-Type': 'application/json'}).end(f.bytes); }
    reply(404, {});
  });
});
await new Promise(r => cloudServer.listen(0, '127.0.0.1', r));
const cloudUrl = 'http://127.0.0.1:' + cloudServer.address().port;
/* The tabs an account holds, by the account's email. */
const tabsHeld = email => { const at = users.get(email).id + '/tabs/'; return [...files.keys()].filter(k => k.startsWith(at) && k.endsWith('.json') && !k.endsWith('/_removed.json')).map(k => k.slice(at.length, -5)).sort(); };

const folder = songFolder([]), home = path.dirname(folder);
const a = await launch({folder});
const {win} = a;
let site = null, server = null;
try {
  /* ---------- the guitar is chosen, and the app opens on its page ---------- */
  await toGuitar(win);
  const start = await win.evaluate(() => ({title: document.title, piece: document.getElementById('title').textContent, songs: gt.songs.map(s => [s.id, !!s.shared]), current: gt.current, hosted: document.documentElement.classList.contains('hosted'), link: getComputedStyle(document.getElementById('link')).display}));
  console.log('the guitar page:', JSON.stringify(start));
  assert.equal(start.title, 'MusicDen');
  assert.deepEqual(start.songs, [[BUILT_IN, true]], 'the piece that comes with the app is the one tab listed');
  assert.equal(start.current, BUILT_IN);
  assert.equal(start.piece, 'Aguado, Small Piece No. 4');
  assert.ok(!start.hosted && start.link !== 'none', 'in the Windows app the link row is there');
  assert.equal(await win.locator('#songs .song .rm').count(), 0, 'the piece that comes with the app cannot be removed');
  await a.shot('guitar-01-start');
  /* Learning mode may listen through the microphone; nothing may use the camera */
  const may = await win.evaluate(async () => ({microphone: (await navigator.permissions.query({name: 'microphone'})).state, camera: (await navigator.permissions.query({name: 'camera'})).state}));
  assert.deepEqual(may, {microphone: 'granted', camera: 'denied'});

  /* it plays, with the recorded guitar */
  await win.locator('#play').click();
  await win.waitForFunction(() => gt.playing && gt.now() > 1.5, null, {timeout: 20000});
  const sound = await win.evaluate(async () => ({at: +gt.now().toFixed(2), pitches: gt.guitar.voices.size, recordings: (await Promise.all([...gt.guitar.files.values()])).filter(Boolean).length, state: gt.guitar.ctx.state}));
  console.log('playing:', JSON.stringify(sound));
  assert.ok(sound.pitches > 5 && sound.recordings > 5, 'the notes are played from recordings');
  await a.shot('guitar-02-playing');
  await win.locator('#play').click();
  assert.equal(await win.evaluate(() => gt.playing), false);

  /* ---------- a tab in the folder of tabs ---------- */
  const builtIn = JSON.parse(fs.readFileSync(path.join('app', 'ui', 'guitar', 'songs', BUILT_IN + '.json'), 'utf8'));
  const tabText = (title, count) => JSON.stringify({...builtIn, title, notes: builtIn.notes.slice(0, count), added: new Date().toISOString().slice(0, 19) + 'Z'});
  await win.evaluate(text => desk.tabs.write('check-tab', text), tabText('Check tab', 60));
  await assert.rejects(win.evaluate(() => desk.tabs.write('../outside', '{"notes":[]}')), 'a name that leads out of the folder is refused');
  await assert.rejects(win.evaluate(() => desk.tabs.write('not-a-tab', '{"title":"x"}')), 'what is not a tab is refused');
  await win.evaluate(() => gt.loadList());
  assert.deepEqual(tabsIn(path.join(folder, TABS)), ['check-tab'], 'the tab is a file among the tabs made with no one signed in');
  assert.deepEqual(await win.evaluate(() => gt.songs.map(s => s.id)), ['check-tab', BUILT_IN]);
  await win.locator('#songs .song .pick', {hasText: 'Check tab'}).click();
  await win.waitForFunction(() => gt.current === 'check-tab' && document.getElementById('title').textContent === 'Check tab');
  assert.equal(await win.evaluate(() => gt.song.notes.length), 60);
  await a.shot('guitar-03-own-tab');

  /* a number dragged to another string is saved to the tab's file */
  await win.locator('#editBtn').click();
  const moved = await win.evaluate(() => { const n = gt.song.notes.find(n => n.string === 1 && n.fret === 0); return n ? {id: n.id, pitch: n.pitch} : null; });
  if (moved) {
    await win.evaluate(id => { gt.tab.sel = id; }, moved.id);
    await win.keyboard.press('ArrowDown');
    await until('the change is in the file', () => { const n = JSON.parse(fs.readFileSync(path.join(folder, TABS, 'check-tab.json'), 'utf8')).notes.find(n => n.id === moved.id); return n.string === 2 && n.fret === moved.pitch - 59; });
    console.log('edited: the open first string became the second string at fret', moved.pitch - 59);
  }
  await win.keyboard.press('Escape');

  /* ---------- sheet music: the band above the tab, then MusicXML and a PDF saved to files ---------- */
  await win.locator('#sheetBtn').click();
  await win.waitForFunction(() => document.getElementById('app').classList.contains('show-sheet'));
  await win.waitForTimeout(400);
  await a.shot('guitar-04-sheet');
  await win.locator('#setBtn').click();
  const rows = await win.evaluate(() => ({first: document.querySelector('#insp .set-row .set-name').textContent, value: document.getElementById('instrument').value, options: [...document.getElementById('instrument').options].map(o => o.textContent)}));
  assert.deepEqual(rows, {first: 'Instrument', value: 'guitar', options: ['Piano', 'Guitar']}, 'Settings starts with the instrument');
  await a.shot('guitar-05-settings');
  const xml = path.join(out, 'guitar-sheet.musicxml'), pdf = path.join(out, 'guitar-sheet.pdf');
  for (const f of [xml, pdf]) fs.rmSync(f, {force: true});
  await win.evaluate(file => { window.gtSaveFile = file; }, xml);
  await win.locator('#insp .set-acts button', {hasText: 'Save as MusicXML'}).click();
  await until('the MusicXML file', () => fs.existsSync(xml) && fs.readFileSync(xml, 'utf8').includes('</score-partwise>'));
  await win.evaluate(file => { window.gtSaveFile = file; }, pdf);
  await win.locator('#insp .set-acts button', {hasText: 'Print or save as PDF'}).click();
  await win.locator('.sheet-print-bar button', {hasText: 'Save as PDF'}).click();
  await until('the PDF file', () => fs.existsSync(pdf) && fs.statSync(pdf).size > 5000);
  assert.equal(fs.readFileSync(pdf).subarray(0, 5).toString(), '%PDF-');
  console.log(`sheet music saved: MusicXML ${fs.statSync(xml).size} bytes, PDF ${fs.statSync(pdf).size} bytes; buttons in the view: ${(await win.locator('.sheet-print-bar button').allTextContents()).join(', ')}`);
  await a.shot('guitar-06-pages');
  await win.locator('.sheet-print-bar button', {hasText: 'Close'}).click();
  await win.locator('#setBtn').click();
  await win.locator('#sheetBtn').click();

  /* ---------- an account: its tabs are its own, and the ones made while signed out come along ---------- */
  const enter = async (create, email, password = 'correct horse') => {
    await win.evaluate(url => { if (!gt.cloud.account()) { gt.cloud.configure(url, 'test-key'); gt.account.render(); } }, cloudUrl);
    await win.locator('#acctOpen').click();
    await win.locator('#acctEmail').fill(email);
    await win.locator('#acctPass').fill(password);
    await win.locator(create ? '#acctNew' : '#acctForm button[type=submit]').click();
    await win.waitForFunction(() => gt.cloud.account() && !gt.account.working && gt.account.note, null, {timeout: 20000});
    return win.evaluate(() => gt.account.note);
  };
  const leave = async () => { await win.locator('#acctOut').click(); await win.waitForFunction(() => !gt.cloud.account() && !gt.account.working); };
  const first = 'guitarist@example.com', second = 'someone@example.com';
  console.log('signed in:', await enter(true, first));
  assert.deepEqual(tabsIn(path.join(home, first, TABS)), ['check-tab'], 'the tab made while signed out went over to the account');
  assert.deepEqual(tabsIn(path.join(home, NOBODY, TABS)), []);
  assert.deepEqual(tabsHeld(first), ['check-tab'], 'and was sent to the account');
  assert.equal(await win.evaluate(() => JSON.parse(localStorage.getItem('piano-visualizer-account')).email), first, 'the sign-in is the one the piano keeps');
  assert.deepEqual(await win.evaluate(() => gt.songs.map(s => s.id)), ['check-tab', BUILT_IN]);
  /* a tab the account got on another device arrives with a sync */
  files.set(users.get(first).id + '/tabs/from-elsewhere.json', {bytes: Buffer.from(tabText('From elsewhere', 30)), updated: new Date().toISOString()});
  await win.locator('#acctSync').click();
  await win.waitForFunction(() => gt.songs.some(s => s.id === 'from-elsewhere') && !gt.account.working, null, {timeout: 20000});
  assert.deepEqual(tabsIn(path.join(home, first, TABS)), ['check-tab', 'from-elsewhere']);
  await a.shot('guitar-07-signed-in');

  /* signed out, the account's tabs are put away; another account sees none of them */
  await win.evaluate(() => localStorage.setItem('piano-visualizer-owner', JSON.stringify({id: 'x', email: 'guitarist@example.com'})));
  await leave();
  assert.deepEqual(await win.evaluate(() => gt.songs.map(s => s.id)), [BUILT_IN], 'signed out, only the piece that comes with the app is listed');
  assert.equal(await win.evaluate(() => localStorage.getItem('piano-visualizer-owner')), null, 'the piano page will put that account\'s songs away too');
  console.log('second account:', await enter(true, second));
  assert.deepEqual(await win.evaluate(() => gt.songs.map(s => s.id)), [BUILT_IN], 'a second account has none of the first one\'s tabs');
  assert.deepEqual(tabsHeld(second), []);
  assert.deepEqual(tabsIn(path.join(home, first, TABS)), ['check-tab', 'from-elsewhere'], 'the first account\'s tabs are still on the computer');
  await leave();

  /* back in the first account: a tab removed here goes from the account too */
  console.log('first account again:', await enter(false, first));
  assert.deepEqual(await win.evaluate(() => gt.songs.map(s => s.id).sort()), [BUILT_IN, 'check-tab', 'from-elsewhere'].sort());
  const row = win.locator('#songs .song', {hasText: 'From elsewhere'});
  await row.hover();
  await row.locator('.rm').click();
  await row.locator('.rm').click();
  await until('the tab is gone from the list, the folder and the account', async () => !(await win.evaluate(() => gt.songs.some(s => s.id === 'from-elsewhere'))) && !tabsIn(path.join(home, first, TABS)).includes('from-elsewhere') && !tabsHeld(first).includes('from-elsewhere'));
  await leave();

  /* ---------- Settings brings the piano's page back ---------- */
  await win.locator('#setBtn').click();
  await win.locator('#instrument').selectOption('piano');
  await win.waitForURL(/\/ui\/index\.html/, {timeout: 20000});
  await win.waitForFunction(() => window.pv && pv.stage.geo, null, {timeout: 20000});
  assert.equal(await win.evaluate(() => localStorage.getItem('musicden-instrument')), 'piano');
  await win.waitForTimeout(300);
  await a.shot('guitar-08-piano-again');
  console.log('back on the piano page:', await win.evaluate(() => location.pathname));
  console.log(a.problems.join('\n') || 'no console problems');

  /* ---------- the phone version, built as it is published ---------- */
  site = fs.mkdtempSync(path.join(os.tmpdir(), 'pv-site-'));
  const made = build(site);
  const TYPES = {'.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.mp3': 'audio/mpeg', '.woff2': 'font/woff2'};
  let served = 0;
  server = http.createServer((req, res) => {
    const file = path.join(site, decodeURIComponent(new URL(req.url, 'http://x').pathname));
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404).end(); return; }
      served++;
      res.writeHead(200, {'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache'}).end(data);
    });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const address = `http://127.0.0.1:${server.address().port}/ui/index.html?test`;
  const worker = fs.readFileSync(path.join(site, 'ui', 'sw.js'), 'utf8'), shell = JSON.parse(/SHELL = (\[.*?\]), PIANO/.exec(worker)[1]);
  assert.ok(shell.includes('./guitar/index.html') && shell.includes('./guitar/songs/' + BUILT_IN + '.json') && shell.includes('../assets/fonts/bravura.woff2'), 'the guitar page is among the files kept on the device');
  assert.ok(!shell.some(f => f.includes('assets/guitar/')), 'its recordings are not fetched at install');
  const opened = a.app.waitForEvent('window');
  await a.app.evaluate(({BrowserWindow}, url) => { const w = new BrowserWindow({width: 844, height: 390, x: -30000, y: -30000, show: false, useContentSize: true, webPreferences: {backgroundThrottling: false}}); w.showInactive(); w.loadURL(url); }, address);
  const phone = await opened, problems = [];
  phone.on('pageerror', e => problems.push(e.message));
  await phone.waitForFunction(() => window.pv && pv.stage.geo && navigator.serviceWorker.controller, null, {timeout: 60000});
  /* the guitar is chosen there: its page is answered by the worker, from the files kept on the device */
  const guitarUp = () => phone.waitForFunction(() => window.gt && gt.ready && document.fonts.status === 'loaded', null, {timeout: 30000});
  await phone.evaluate(() => localStorage.setItem('musicden-instrument', 'guitar'));
  await phone.reload();
  await phone.waitForURL(/\/guitar\/index\.html\?test/, {timeout: 20000});
  await guitarUp();
  const there = await phone.evaluate(() => ({hosted: document.documentElement.classList.contains('hosted'), link: getComputedStyle(document.getElementById('link')).display, file: getComputedStyle(document.getElementById('fileBtn').parentElement).display, songs: gt.songs.map(s => s.id), desk: typeof window.desk, worker: !!navigator.serviceWorker.controller}));
  console.log(`built ${made.files} files; the guitar page on the phone version:`, JSON.stringify(there));
  assert.deepEqual(there, {hosted: true, link: 'none', file: 'none', songs: [BUILT_IN], desk: 'undefined', worker: true});
  await phone.evaluate(() => gt.play());
  await phone.waitForFunction(() => gt.playing && gt.now() > 1.5, null, {timeout: 20000});
  await phone.screenshot({path: path.join(out, 'guitar-09-phone.png')});
  await phone.evaluate(() => gt.pause());

  /* an account there: a tab made on the phone while signed out goes along to the account that signs in, the
     account's own tabs arrive, and each account's tabs are kept in a place of their own on the phone */
  await phone.evaluate(text => gt.tabs.write('phone-made', text), tabText('Made on the phone', 20));
  const phoneEnter = async email => {
    await phone.evaluate(url => { if (!gt.cloud.account()) { gt.cloud.configure(url, 'test-key'); gt.account.render(); } }, cloudUrl);
    if (await phone.locator('#libBtn').getAttribute('aria-expanded') !== 'true') await phone.locator('#libBtn').click();
    await phone.locator('#acctOpen').click();
    await phone.locator('#acctEmail').fill(email);
    await phone.locator('#acctPass').fill('correct horse');
    await phone.locator('#acctForm button[type=submit]').click();
    await phone.waitForFunction(() => gt.cloud.account() && !gt.account.working && gt.account.note, null, {timeout: 20000});
  };
  const phoneLeave = async () => { await phone.locator('#acctOut').click(); await phone.waitForFunction(() => !gt.cloud.account() && !gt.account.working); };
  const listed = () => phone.evaluate(() => gt.songs.map(s => s.id).sort());
  await phoneEnter(first);
  assert.deepEqual(await listed(), [BUILT_IN, 'check-tab', 'phone-made'].sort(), 'the account\'s tab arrived, and the one made on the phone came along');
  assert.deepEqual(tabsHeld(first), ['check-tab', 'phone-made'], 'which the account now has too');
  await phone.screenshot({path: path.join(out, 'guitar-10-phone-songs.png')});
  await phoneLeave();
  assert.deepEqual(await listed(), [BUILT_IN], 'signed out, the account\'s tabs are put away');
  await phoneEnter(second);
  assert.deepEqual(await listed(), [BUILT_IN], 'another account sees none of them');
  await phoneLeave();
  const places = await phone.evaluate(async () => (await indexedDB.databases()).map(d => d.name).filter(n => n.startsWith('guitar-tabs:')).length);
  assert.equal(places, 3, 'a place for each account, and one for no one signed in');
  await phoneEnter(first);
  assert.deepEqual(await listed(), [BUILT_IN, 'check-tab', 'phone-made'].sort(), 'the first account finds its own again');
  await phoneLeave();
  await phone.locator('#libBtn').click();
  console.log('accounts on the phone version: tabs arrive, go along, and are kept apart');
  /* the server goes away: the page opens all the same, with the recordings it has played so far */
  const kept = await phone.evaluate(async () => (await (await caches.open('piano-1')).keys()).filter(r => r.url.includes('/assets/guitar/')).length);
  await new Promise(r => { server.closeAllConnections(); server.close(r); });
  server = null;
  const before = served;
  await phone.reload();
  await guitarUp();
  await phone.evaluate(() => gt.play());
  await phone.waitForFunction(() => gt.playing && gt.now() > 1, null, {timeout: 20000});
  const offline = await phone.evaluate(async () => ({songs: gt.songs.map(s => s.id), recordings: (await Promise.all([...gt.guitar.files.values()])).filter(Boolean).length, path: location.pathname}));
  console.log(`with the server shut down: ${JSON.stringify(offline)}; guitar recordings kept on the device: ${kept}`);
  assert.deepEqual(offline.songs, [BUILT_IN]);
  assert.ok(kept > 5 && offline.recordings > 5, 'the recordings already played are kept and used');
  assert.equal(served, before, 'nothing was asked of the server');
  console.log(problems.length ? 'page errors: ' + problems.join('; ') : 'no page errors');
  assert.equal(problems.length, 0);
  console.log('GUITAR CHECKS PASSED');
} finally {
  await a.close();
  if (server) await new Promise(r => { server.closeAllConnections(); server.close(r); });
  await new Promise(r => { cloudServer.closeAllConnections(); cloudServer.close(r); });
  if (site) fs.rmSync(site, {recursive: true, force: true});
}
