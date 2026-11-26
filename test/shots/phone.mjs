/* The phone version and account sync, with the desktop app and a phone-sized browser window side by
   side. A stand-in for the account service runs on this computer: it answers the same sign-in and
   file requests Supabase does and keeps each account's files apart. Songs are synced from the
   desktop's folder to the phone, and a song added on the phone is synced back. Folders made in the
   Songs list on one device show up on the other. A song removed on one device goes from the
   account and the other device. Sheet music saved on the desktop shows up on the phone, where it
   can be opened, put in a folder, renamed and removed, and each of those reaches the desktop. A
   second account on the same computer, and on the same phone, gets nothing of the first account's
   songs, sheets or folders, and the first account finds its own again on signing back in. With no
   one signed in a device lists the built-in piece alone, whatever files lie loose in the song folder. */
import {launch, songFolder, sheetFolder, out, root} from './harness.mjs';
import {serve} from '../../scripts/serve-phone.mjs';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';

/* ---------- the stand-in account service ---------- */
const users = new Map(), files = new Map();   /* email -> {id, password}; "id/name" -> {bytes, updated} */
const cors = {'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'apikey, authorization, content-type, x-upsert', 'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS'};
const cloudServer = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', c => chunks.push(c)).on('end', () => {
    const body = Buffer.concat(chunks), url = new URL(req.url, 'http://x'), reply = (code, data) => res.writeHead(code, {...cors, 'Content-Type': 'application/json'}).end(data === undefined ? '' : JSON.stringify(data));
    if (req.method === 'OPTIONS') return reply(204);
    /* a signed address plays without any sign-in headers, and in pieces when the player asks for a range */
    const signed = url.pathname.match(/^\/storage\/v1\/object\/sign\/songs\/(.+)$/);
    if (signed && req.method === 'GET') {
      const f = url.searchParams.get('token') === 'ok' && files.get(signed[1]);
      if (!f) return reply(404, {});
      const m = /bytes=(\d+)-(\d*)/.exec(req.headers.range || ''), from = m ? +m[1] : 0, to = m && m[2] ? +m[2] : f.bytes.length - 1;
      return res.writeHead(m ? 206 : 200, {...cors, 'Content-Type': 'video/mp4', 'Accept-Ranges': 'bytes', 'Content-Length': to - from + 1, ...(m ? {'Content-Range': `bytes ${from}-${to}/${f.bytes.length}`} : {})}).end(f.bytes.subarray(from, to + 1));
    }
    if (req.headers.apikey !== 'test-key') return reply(401, {msg: 'no key'});
    const sessionFor = (email, u) => ({access_token: 'token-' + u.id, refresh_token: 'refresh-' + u.id, expires_in: 3600, user: {id: u.id, email}});
    const who = (req.headers.authorization || '').replace('Bearer token-', '');
    const p = url.pathname;
    if (p === '/auth/v1/signup') {
      const {email, password} = JSON.parse(body);
      if (users.has(email)) return reply(422, {msg: 'User already registered'});
      const u = {id: crypto.randomUUID(), password}; users.set(email, u);
      return reply(200, sessionFor(email, u));
    }
    if (p === '/auth/v1/token') {
      const j = JSON.parse(body);
      if (url.searchParams.get('grant_type') === 'password') { const u = users.get(j.email); return u && u.password === j.password ? reply(200, sessionFor(j.email, u)) : reply(400, {error_code: 'invalid_credentials'}); }
      for (const [email, u] of users) if ('refresh-' + u.id === j.refresh_token) return reply(200, sessionFor(email, u));
      return reply(400, {});
    }
    if (p === '/auth/v1/logout') return reply(204);
    if (![...users.values()].some(u => u.id === who)) return reply(401, {});
    if (p === '/storage/v1/object/list/songs') {
      const {prefix} = JSON.parse(body);
      if (!prefix.startsWith(who + '/')) return reply(200, []);
      return reply(200, [...files].filter(([k]) => k.startsWith(prefix) && !k.slice(prefix.length).includes('/')).map(([k, f]) => ({name: k.slice(prefix.length), id: k, updated_at: f.updated, metadata: {size: f.bytes.length}})));
    }
    if (p === '/storage/v1/object/move') {
      const {sourceKey, destinationKey} = JSON.parse(body);
      if (!sourceKey.startsWith(who + '/') || !destinationKey.startsWith(who + '/') || !files.has(sourceKey)) return reply(400, {});
      files.set(destinationKey, files.get(sourceKey)); files.delete(sourceKey);
      return reply(200, {});
    }
    if (signed && req.method === 'POST') return signed[1].startsWith(who + '/') && files.has(signed[1]) ? reply(200, {signedURL: '/object/sign/songs/' + signed[1] + '?token=ok'}) : reply(400, {});
    const put = p.match(/^\/storage\/v1\/object\/songs\/([^/]+)\/(.+)$/), get = p.match(/^\/storage\/v1\/object\/authenticated\/songs\/([^/]+)\/(.+)$/);
    if (put && req.method === 'POST') { if (put[1] !== who) return reply(403, {}); files.set(put[1] + '/' + put[2], {bytes: body, updated: new Date().toISOString()}); return reply(200, {Key: p}); }
    if (put && req.method === 'DELETE') { if (put[1] !== who) return reply(403, {}); files.delete(put[1] + '/' + put[2]); return reply(200, {}); }
    if (get && req.method === 'GET') { const f = get[1] === who && files.get(get[1] + '/' + get[2]); if (!f) return reply(404, {}); return res.writeHead(200, {...cors, 'Content-Type': 'audio/midi'}).end(f.bytes); }
    reply(404, {});
  });
});
await new Promise(r => cloudServer.listen(0, '127.0.0.1', r));
const cloudUrl = 'http://127.0.0.1:' + cloudServer.address().port;
const site = await serve(0, '127.0.0.1'), siteUrl = 'http://127.0.0.1:' + site.address().port + '/ui/index.html?test';

const folder = songFolder(['Chop-28-4.mid', 'wtk1-prelude1.mid']);
/* each account's songs go in a folder of their own inside the song folder, named after the account,
   beside the folder of the songs added with no one signed in */
const home = path.dirname(folder), mine = path.join(home, 'pianist@example.com'), theirs = path.join(home, 'someone@example.com');
const songsIn = dir => fs.readdirSync(dir).filter(f => f.endsWith('.mid')).sort();
/* a file lying loose in the song folder itself is no one's: it is never listed, moved or sent */
const loose = path.join(home, 'Left lying about.mid');
fs.copyFileSync(path.join(root, 'test', 'fixtures', 'gymnopedie_1.mid'), loose);
const a = await launch({folder});
const {win} = a;
/* Saved sheet music as the desktop keeps it: a PDF and its pages, in a folder for each account. */
const userData = await a.app.evaluate(({app}) => app.getPath('userData'));
const sheetsOf = email => path.join(userData, 'sheets', email);
const page = n => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 210 297"><rect width="210" height="297" fill="#fff"/><text x="20" y="40" font-size="14">Page ${n}</text></svg>`;
const saveSheet = (dir, name, pages) => {
  fs.mkdirSync(dir, {recursive: true});
  fs.writeFileSync(path.join(dir, name + '.pdf'), '%PDF-1.4 ' + name);
  fs.writeFileSync(path.join(dir, name + '.pages'), zlib.gzipSync(JSON.stringify(Array.from({length: pages}, (_, i) => page(i + 1)))));
};
const pdfsIn = dir => (fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => f.endsWith('.pdf')).map(f => f.slice(0, -4)).sort() : []);
/* The saved sheets an account holds, by the account's email. */
const sheetsHeld = email => { const at = users.get(email).id + '/sheets/'; return [...files.keys()].filter(k => k.startsWith(at) && k.endsWith('.sheet')).map(k => Buffer.from(k.slice(at.length, -6), 'hex').toString()).sort(); };
const until = async (what, test) => { for (let i = 0; i < 200; i++) { if (test()) return; await new Promise(r => setTimeout(r, 100)); } throw new Error(what); };
/* Signs in through the account row's own controls and waits for the sync that follows. */
const enter = async (page, create, email = 'pianist@example.com', password = 'correct horse') => {
  await page.evaluate(url => { pvCloud.cloud.configure(url, 'test-key'); pvCloud.render(); }, cloudUrl);
  await page.locator('#acctOpen').click();
  await page.locator('#acctEmail').fill(email);
  await page.locator('#acctPass').fill(password);
  await page.locator(create ? '#acctNew' : '#acctForm button[type=submit]').click();
  await page.waitForFunction(() => pvCloud.cloud.account() && !pvCloud.working && pvCloud.note, null, {timeout: 20000});
  return said(page);
};
/* Signs out through the account row, and waits until the account's songs are put away. */
const leave = async page => {
  await page.locator('#acctOut').click();
  await page.waitForFunction(() => !pvCloud.cloud.account() && !pvCloud.working && pv.songs.length === 0, null, {timeout: 20000});
};
/* The songs an account holds, by the account's email. */
const held = email => { const id = users.get(email).id; return [...files.keys()].filter(k => k.startsWith(id + '/') && /^[0-9a-f]+\.mid$/.test(k.slice(id.length + 1))).map(k => Buffer.from(k.slice(id.length + 1, -4), 'hex').toString()).sort(); };
/* What the account row says after a sync, and what the sync did. */
const said = page => page.evaluate(() => `"${pvCloud.note}" (${pvCloud.last.sent} sent, ${pvCloud.last.received} received)`);
const syncNow = async page => { await page.locator('#acctSync').click(); await page.waitForFunction(() => !pvCloud.working && pvCloud.note); return said(page); };
/* The folders as the account holds them, once they say what is expected: those of the Songs list, or of the Sheets list. */
const accountFolders = async (want, file = 'folders.json') => {
  for (let i = 0; i < 80; i++) {
    const f = [...files].find(([k]) => k.endsWith('/' + file));
    const got = f ? JSON.parse(f[1].bytes).folders.map(x => x.name + ': ' + x.songs.join(', ')).join(' | ') : '';
    if (got === want) return got;
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error('the account never held the folders "' + want + '"');
};
const listed = page => page.evaluate(() => [...document.querySelectorAll('#songs > li')].map(li => li.classList.contains('fold') ? '[' + li.querySelector('.name').textContent + ']' : (li.classList.contains('in') ? '  ' : '') + li.querySelector('.name').textContent));
try {
  await win.waitForFunction(() => pv.songs.length === 2 && window.pvCloud);
  assert.deepEqual(await listed(win), ['[New folder]', 'Prelude in C major', 'Chop-28-4', 'wtk1-prelude1'], 'the loose file in the song folder is not listed');
  /* sheet music saved before signing in comes along to the account, as the songs do */
  saveSheet(sheetFolder(userData), 'Saved early', 1);
  console.log('desktop, create account:', await enter(win, true));
  assert.deepEqual(held('pianist@example.com'), ['Chop-28-4.mid', 'wtk1-prelude1.mid'], 'both songs in the folder were sent to the account, and the loose file was not');
  assert.deepEqual(songsIn(mine), ['Chop-28-4.mid', 'wtk1-prelude1.mid'], 'the songs added before signing in moved to the account\'s own folder');
  assert.deepEqual(songsIn(folder), [], 'and none are left outside it');
  assert.deepEqual(pdfsIn(sheetsOf('pianist@example.com')), ['Saved early']);
  assert.deepEqual(pdfsIn(sheetFolder(userData)), []);
  assert.deepEqual(sheetsHeld('pianist@example.com'), ['Saved early'], 'the sheet saved before signing in was sent to the account');
  await win.waitForFunction(() => pv.songs.length === 2);
  await a.shot('95-desktop-signed-in');

  /* the phone: same account, nothing on the device yet */
  const opened = a.app.waitForEvent('window');
  await a.app.evaluate(({BrowserWindow}, url) => { const w = new BrowserWindow({width: 412, height: 860, x: -30000, y: -30000, show: false, useContentSize: true, webPreferences: {backgroundThrottling: false}}); w.showInactive(); w.loadURL(url); }, siteUrl);
  const phone = await opened;
  const problems = [];
  phone.on('console', m => { if (m.type() === 'error') problems.push(m.text()); });
  phone.on('pageerror', e => problems.push(e.message));
  await phone.waitForFunction(() => window.pv && pv.stage.geo && window.pvCloud, null, {timeout: 20000});
  await phone.waitForTimeout(500);
  await phone.screenshot({path: path.join(out, '96-phone-start.png')});
  await phone.locator('#libBtn').click();
  console.log('phone, sign in:', await enter(phone, false));
  await phone.waitForFunction(() => pv.songs.length === 2 && pv.songs.every(s => s.duration != null));
  await phone.screenshot({path: path.join(out, '97-phone-songs.png')});
  await phone.locator('.song[data-id="Chop-28-4.mid"] .pick').click();
  await phone.waitForFunction(() => pv.current === 'Chop-28-4.mid' && pv.playing);
  await phone.locator('#libBtn').click();
  await phone.waitForTimeout(2500);
  const sound = await phone.evaluate(() => ({audio: pv.audio.state, sampled: [...pv.piano.voices].filter(v => v.sampled).length, at: pv.now()}));
  assert.ok(sound.at > 1 && sound.sampled > 0, 'the song plays on the phone with the sampled piano');
  await phone.screenshot({path: path.join(out, '98-phone-playing.png')});
  await phone.evaluate(() => pv.pause());
  const same = await phone.evaluate(async () => Array.from(await desk.library.read('Chop-28-4.mid')));
  assert.ok(Buffer.from(same).equals(fs.readFileSync(path.join(mine, 'Chop-28-4.mid'))), 'the song on the phone is the file from the folder, byte for byte');

  /* a song added on the phone reaches the desktop's folder */
  await phone.evaluate(async bytes => { await desk.library.importFiles([new File([new Uint8Array(bytes)], 'Added on the phone – été.mid')]); }, Array.from(fs.readFileSync(path.join(mine, 'Chop-28-4.mid'))));
  await phone.locator('#libBtn').click();
  console.log('phone, sync:', await syncNow(phone));
  console.log('desktop, sync:', await syncNow(win));
  assert.ok(fs.existsSync(path.join(mine, 'Added on the phone – été.mid')), 'the phone\'s song arrived in the folder');
  await win.waitForFunction(() => pv.songs.length === 3);

  /* a hand change on the desktop travels to the phone */
  await win.evaluate(async () => { await pv.openSong('wtk1-prelude1.mid'); const n = pv.piece.notes[10]; pv.piece.tracks[n.track].count--; n.track = 1 - n.track; pv.piece.tracks[n.track].count++; });
  const edited = await win.evaluate(async () => { const {writeMidi} = await import('./midi.js'); const b = writeMidi(pv.piece); await desk.library.write('wtk1-prelude1.mid', b); return Array.from(b); });
  await win.waitForTimeout(600);
  console.log('desktop, sync after a hand change:', await syncNow(win));
  console.log('phone, sync:', await syncNow(phone));
  assert.ok(Buffer.from(await phone.evaluate(async () => Array.from(await desk.library.read('wtk1-prelude1.mid')))).equals(Buffer.from(edited)), 'the changed song replaced the phone\'s copy');
  console.log('again, nothing to do:', await syncNow(phone), '|', await syncNow(win));
  assert.equal(await win.evaluate(() => pvCloud.note), await win.evaluate(() => pv.T.synced));
  assert.equal(await win.locator('.acct-note').textContent(), 'Up to date');

  /* a folder made on the desktop goes to the account by itself, and the phone has it after its next sync */
  await win.locator('#songs .fold.new .pick').click();
  await win.locator('#songs .fold.new .rename').fill('Preludes');
  await win.keyboard.press('Enter');
  await win.locator('#songs .song[data-id="Chop-28-4.mid"]').dragTo(win.locator('#songs .fold[data-folder="Preludes"]'));
  console.log('folders in the account after the desktop made one:', await accountFolders('Preludes: Chop-28-4.mid'));
  await a.shot('95-desktop-folder');
  await syncNow(phone);
  assert.deepEqual((await listed(phone)).slice(0, 3), ['[Preludes]', '[New folder]', 'Prelude in C major'], 'the phone lists the folder, closed');
  await phone.locator('#songs .fold[data-folder="Preludes"] .pick').click();
  assert.deepEqual((await listed(phone)).slice(0, 3), ['[Preludes]', '  Chop-28-4', '[New folder]']);
  /* a song put in the folder on the phone, from its row's menu, shows up inside it on the desktop */
  await phone.locator('#songs .song[data-id="wtk1-prelude1.mid"] .more').click();
  await phone.locator('#lib .more-menu button', {hasText: 'Move to Preludes'}).click();
  console.log('folders in the account after the phone added a song:', await accountFolders('Preludes: Chop-28-4.mid, wtk1-prelude1.mid'));
  await phone.screenshot({path: path.join(out, '97-phone-folder.png')});
  await syncNow(win);
  assert.deepEqual((await listed(win)).slice(0, 4), ['[Preludes]', '  Chop-28-4', '  wtk1-prelude1', '[New folder]']);
  assert.equal(await win.evaluate(() => pv.songs.length), 3, 'folders move no files');

  /* sheet music saved on the desktop goes to the account by itself: one file for each sheet, its PDF and its pages together */
  saveSheet(sheetsOf('pianist@example.com'), 'Nocturne', 2);
  await win.evaluate(() => document.dispatchEvent(new CustomEvent('sheet-saved', {detail: {name: 'Nocturne'}})));
  await until('the saved sheet never reached the account', () => sheetsHeld('pianist@example.com').includes('Nocturne'));
  const kept = [...files].find(([k]) => k.endsWith('.sheet') && Buffer.from(k.split('/').pop().slice(0, -6), 'hex').toString() === 'Nocturne')[1].bytes;
  assert.equal(kept.subarray(0, 4).toString(), 'MDS1');
  assert.equal(kept.subarray(8, 8 + kept.readUInt32LE(4)).toString(), '%PDF-1.4 Nocturne', 'the PDF is in the account as it was saved');
  await win.waitForFunction(() => !pvCloud.working);
  /* the phone lists the sheets after its next sync, and opens one: its pages lie over the whole screen */
  await syncNow(phone);
  await phone.locator('#libKind [data-kind="sheets"]').click();
  await phone.waitForFunction(() => pvSheets.list.length === 2);
  assert.deepEqual(await phone.evaluate(() => pvSheets.list.map(s => s.name).sort()), ['Nocturne', 'Saved early']);
  await phone.screenshot({path: path.join(out, '97-phone-sheets.png')});
  await phone.locator('#sheets .song[data-id="Nocturne"] .pick').click();
  await phone.waitForFunction(() => document.querySelectorAll('#pages img').length === 2 && [...document.querySelectorAll('#pages img')].every(i => i.complete && i.naturalWidth > 0), null, {timeout: 20000});
  assert.equal(await phone.locator('#pagesShow').textContent(), 'Download PDF');
  const over = await phone.evaluate(() => { const p = document.getElementById('pages').getBoundingClientRect(), a = document.querySelector('.app').getBoundingClientRect(), top = document.elementFromPoint(40, 200); return {fills: Math.abs(p.width - a.width) < 2 && Math.abs(p.height - a.height) < 2, onTop: !!top.closest('#pages')}; });
  assert.ok(over.fills && over.onTop, 'the pages cover the strip and the panel: ' + JSON.stringify(over));
  await phone.waitForTimeout(300);
  await phone.screenshot({path: path.join(out, '98-phone-sheet-open.png')});
  await phone.locator('#pagesClose').click();
  assert.equal(await phone.locator('#pages').count(), 0);

  /* a folder made in the desktop's Sheets list shows up on the phone; the Songs list's folders are another matter */
  await win.locator('#libKind [data-kind="sheets"]').click();
  await win.waitForFunction(() => pvSheets.list.length === 2);
  await win.locator('#sheets .fold.new .pick').click();
  await win.locator('#sheets .fold.new .rename').fill('Chopin');
  await win.keyboard.press('Enter');
  await win.locator('#sheets .song[data-id="Nocturne"]').dragTo(win.locator('#sheets .fold[data-folder="Chopin"]'));
  console.log('sheet folders in the account after the desktop made one:', await accountFolders('Chopin: Nocturne', 'sheet-folders.json'));
  await a.shot('95-desktop-sheets');
  await syncNow(phone);
  const sheetRows = pg => pg.evaluate(() => [...document.querySelectorAll('#sheets > li')].map(li => li.classList.contains('fold') ? '[' + li.querySelector('.name').textContent + ']' : (li.classList.contains('in') ? '  ' : '') + li.querySelector('.name').textContent));
  assert.deepEqual(await sheetRows(phone), ['[Chopin]', '[New folder]', 'Saved early']);
  /* on the phone a sheet goes into the folder from its row's menu */
  await phone.locator('#sheets .song[data-id="Saved early"] .more').click();
  assert.deepEqual(await phone.locator('#lib .more-menu button').allTextContents(), ['Rename', 'Move to Chopin', 'Remove']);
  await phone.locator('#lib .more-menu button', {hasText: 'Move to Chopin'}).click();
  console.log('sheet folders in the account after the phone added a sheet:', await accountFolders('Chopin: Nocturne, Saved early', 'sheet-folders.json'));
  await accountFolders('Preludes: Chop-28-4.mid, wtk1-prelude1.mid');
  /* renamed on the phone, a sheet has its new name in the account at once and on the desktop after a sync, still in its folder */
  await phone.locator('#sheets .fold[data-folder="Chopin"] .pick').click();
  await phone.locator('#sheets .song[data-id="Saved early"] .more').click();
  await phone.locator('#lib .more-menu button', {hasText: 'Rename'}).click();
  await phone.locator('#sheets .rename').fill('Waltz');
  await phone.keyboard.press('Enter');
  await until('the renamed sheet never reached the account', () => sheetsHeld('pianist@example.com').join() === 'Nocturne,Waltz');
  await phone.waitForFunction(() => !pvCloud.working && pvSheets.list.some(s => s.name === 'Waltz'));
  await phone.waitForTimeout(3200);
  await phone.waitForFunction(() => !pvCloud.working);
  console.log('sheet folders in the account after the phone renamed a sheet:', await accountFolders('Chopin: Nocturne, Waltz', 'sheet-folders.json'));
  await syncNow(win);
  await win.waitForFunction(() => pvSheets.list.length === 2 && pvSheets.list.some(s => s.name === 'Waltz'));
  assert.deepEqual(pdfsIn(sheetsOf('pianist@example.com')), ['Nocturne', 'Waltz']);
  assert.equal(fs.readFileSync(path.join(sheetsOf('pianist@example.com'), 'Waltz.pdf'), 'utf8'), '%PDF-1.4 Saved early', 'the renamed sheet is the same PDF');
  assert.deepEqual(await sheetRows(win), ['[Chopin]', '  Nocturne', '  Waltz', '[New folder]']);
  /* removed on the phone, a sheet leaves the account by itself and the desktop at its next sync */
  const leaving = phone.locator('#sheets .song[data-id="Waltz"]');
  await leaving.locator('.more').click();
  await phone.locator('#lib .more-menu button', {hasText: 'Remove'}).click();
  await leaving.locator('.rm').click();
  await until('the sheet removed on the phone stayed in the account', () => sheetsHeld('pianist@example.com').join() === 'Nocturne');
  await phone.waitForFunction(() => !pvCloud.working);
  await syncNow(win);
  await win.waitForFunction(() => pvSheets.list.length === 1);
  assert.deepEqual(pdfsIn(sheetsOf('pianist@example.com')), ['Nocturne'], 'the sheet removed on the phone is gone from the desktop');
  console.log('after a sheet was removed on the phone:', await syncNow(phone), '|', await syncNow(win));
  assert.deepEqual(sheetsHeld('pianist@example.com'), ['Nocturne'], 'and it does not come back from either side');
  await win.locator('#libKind [data-kind="songs"]').click();
  await phone.locator('#libKind [data-kind="songs"]').click();

  /* a video saved on the desktop goes to the account; one over the account's 50 MB limit is made smaller first */
  const small = path.join(out, 'account-small.mp4'), big = path.join(out, 'account-big.mp4');
  spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=s=1280x720:r=30', '-f', 'lavfi', '-i', 'sine=f=440', '-t', '6', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', small]);
  spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=s=1920x1080:r=30,noise=alls=70:allf=t+u', '-f', 'lavfi', '-i', 'sine=f=440', '-t', '40', '-c:v', 'libx264', '-preset', 'ultrafast', '-b:v', '14M', '-pix_fmt', 'yuv420p', '-c:a', 'aac', big]);
  const videoFiles = () => [...files].filter(([k]) => k.includes('/videos/')).map(([, f]) => f.bytes.length);
  for (const [file, seconds] of [[small, 6], [big, 40]]) {
    await win.evaluate(d => { window.pvVideoSent = ''; document.dispatchEvent(new CustomEvent('video-saved', {detail: d})); }, {file, seconds});
    await win.waitForFunction(() => window.pvVideoSent, null, {timeout: 300000});
    console.log(`video of ${(fs.statSync(file).size / 1e6).toFixed(1)} MB:`, await win.evaluate(() => window.pvVideoSent), '| in the account:', videoFiles().map(n => (n / 1e6).toFixed(1) + ' MB').join(', '));
  }
  assert.equal(videoFiles().length, 2);
  assert.ok(fs.statSync(big).size > 50e6 && videoFiles().every(n => n < 50e6), 'the large video was made small enough for the account');
  await win.locator('#libKind [data-kind="videos"]').click();
  await win.waitForFunction(() => pvVideos.list.length === 2);
  await a.shot('95-desktop-videos');

  /* the phone lists them and plays one */
  await phone.locator('#libKind [data-kind="videos"]').click();
  await phone.waitForFunction(() => pvVideos.list.length === 2);
  await phone.screenshot({path: path.join(out, '97-phone-videos.png')});
  await phone.locator('#videos .song[data-name="account-big.mp4"] .pick').click();
  await phone.waitForFunction(() => { const v = document.querySelector('#player video'); return v && v.videoWidth > 0 && v.currentTime > 0.6; }, null, {timeout: 30000}).catch(async e => { console.log('the video did not start:', JSON.stringify(await phone.evaluate(() => { const v = document.querySelector('#player video'); return v ? {src: v.src.slice(0, 90), error: v.error && (v.error.code + ' ' + v.error.message), net: v.networkState, ready: v.readyState, paused: v.paused, t: v.currentTime, w: v.videoWidth, note: document.getElementById('videosNote').textContent} : {player: 'none', note: document.getElementById('videosNote').textContent, held: !!document.querySelector('.held'), menu: !!document.querySelector('.more-menu')}; })), '| console:', problems.join(' ; ')); throw e; });
  console.log('phone, playing a video:', JSON.stringify(await phone.evaluate(() => { const v = document.querySelector('#player video'); return {width: v.videoWidth, height: v.videoHeight, length: +v.duration.toFixed(1)}; })));
  /* on the phone the video sits in the middle, smaller than the screen, with its own controls */
  await phone.waitForTimeout(300);
  await phone.screenshot({path: path.join(out, '98-phone-video-playing.png')});
  const fits = await phone.evaluate(() => { const v = document.querySelector('#player video'), a = document.querySelector('.app'); return v.controls && v.clientWidth > 100 && v.clientWidth <= a.clientWidth * 0.75 && v.clientHeight <= a.clientHeight * 0.75; });
  assert.ok(fits, 'the player is smaller than the screen and has its controls');
  await phone.locator('#playerClose').click();
  /* on the phone a row is removed from its "more" menu, and the row's own button asks once more */
  const row = phone.locator('#videos .song[data-name="account-small.mp4"]');
  await row.locator('.more').click();
  await phone.locator('#lib .more-menu button', {hasText: 'Remove'}).click();
  await row.locator('.rm').click();
  await phone.waitForFunction(() => pvVideos.list.length === 1);
  assert.equal(videoFiles().length, 1, 'removing a video on the phone removes it from the account');
  await phone.locator('#libKind [data-kind="songs"]').click();

  /* a song removed on the phone leaves the account by itself, and the desktop's folder at its next sync */
  const extra = 'Added on the phone – été.mid';
  assert.deepEqual(held('pianist@example.com'), ['Added on the phone – été.mid', 'Chop-28-4.mid', 'wtk1-prelude1.mid']);
  const going = phone.locator(`#songs .song[data-id="${extra}"]`);
  await going.locator('.more').click();
  await phone.locator('#lib .more-menu button', {hasText: 'Remove'}).click();
  await going.locator('.rm').click();
  for (let i = 0; held('pianist@example.com').includes(extra); i++) { if (i > 200) throw new Error('the song removed on the phone stayed in the account'); await new Promise(r => setTimeout(r, 100)); }
  await syncNow(win);
  await win.waitForFunction(() => pv.songs.length === 2);
  assert.deepEqual(songsIn(mine), ['Chop-28-4.mid', 'wtk1-prelude1.mid'], 'the song removed on the phone is gone from the desktop\'s folder');
  /* and it does not come back from either side */
  console.log('after a song was removed on the phone:', await syncNow(phone), '|', await syncNow(win));
  assert.deepEqual(held('pianist@example.com'), ['Chop-28-4.mid', 'wtk1-prelude1.mid']);
  assert.equal(await phone.evaluate(() => pv.songs.length), 2);

  /* signing out puts the account's songs and folders away; the files stay in the account's own folder */
  await leave(win);
  assert.deepEqual(await listed(win), ['[New folder]', 'Prelude in C major'], 'nothing of the account is listed after signing out');
  assert.deepEqual(songsIn(mine), ['Chop-28-4.mid', 'wtk1-prelude1.mid']);
  await a.shot('95-desktop-signed-out');
  /* nor is its sheet music: the Sheets list is empty, and the files stay where they are */
  await win.locator('#libKind [data-kind="sheets"]').click();
  await win.waitForFunction(() => pvSheets.list.length === 0);
  assert.deepEqual(await win.evaluate(() => [...document.querySelectorAll('#sheets > li')].map(li => li.querySelector('.name').textContent)), ['New folder']);
  assert.deepEqual(pdfsIn(sheetsOf('pianist@example.com')), ['Nocturne']);
  await win.locator('#libKind [data-kind="songs"]').click();
  /* a song added while no one is signed in */
  assert.deepEqual(await win.evaluate(list => desk.library.importPaths(list), [path.join(root, 'test', 'fixtures', 'gymnopedie_1.mid')]), ['gymnopedie_1.mid']);
  await win.waitForFunction(() => pv.songs.length === 1);
  assert.deepEqual(songsIn(folder), ['gymnopedie_1.mid']);

  /* a second account on the same computer gets that song, and nothing of the first account's */
  console.log('desktop, a second account:', await enter(win, true, 'someone@example.com', 'another one'));
  await win.waitForFunction(() => pv.songs.length === 1);
  assert.deepEqual(held('someone@example.com'), ['gymnopedie_1.mid'], 'the second account holds only the song added while signed out');
  assert.deepEqual(held('pianist@example.com'), ['Chop-28-4.mid', 'wtk1-prelude1.mid'], 'the first account is as it was');
  assert.deepEqual(songsIn(theirs), ['gymnopedie_1.mid']);
  assert.deepEqual(songsIn(mine), ['Chop-28-4.mid', 'wtk1-prelude1.mid']);
  assert.deepEqual(songsIn(folder), []);
  assert.deepEqual(await listed(win), ['[New folder]', 'Prelude in C major', 'gymnopedie_1'], 'and none of the first account\'s folders');
  assert.equal([...files.keys()].some(k => k === users.get('someone@example.com').id + '/folders.json'), false, 'the first account\'s folders were not sent to the second');
  assert.deepEqual(sheetsHeld('someone@example.com'), [], 'nor its sheet music');
  assert.deepEqual(pdfsIn(sheetsOf('someone@example.com')), []);
  assert.equal([...files.keys()].some(k => k === users.get('someone@example.com').id + '/sheet-folders.json'), false);
  await a.shot('95-desktop-second-account');

  /* the first account again: its songs and folders are back as they were, without the second account's song */
  await leave(win);
  console.log('desktop, the first account again:', await enter(win, false));
  await win.waitForFunction(() => pv.songs.length === 2);
  assert.deepEqual((await listed(win)).slice(0, 4), ['[Preludes]', '  Chop-28-4', '  wtk1-prelude1', '[New folder]']);
  assert.deepEqual(held('pianist@example.com'), ['Chop-28-4.mid', 'wtk1-prelude1.mid']);
  assert.deepEqual(held('someone@example.com'), ['gymnopedie_1.mid']);
  await win.locator('#libKind [data-kind="sheets"]').click();
  await win.waitForFunction(() => pvSheets.list.length === 1 && pvSheets.list[0].name === 'Nocturne');
  await win.locator('#libKind [data-kind="songs"]').click();

  /* the phone keeps accounts apart the same way; with no one signed in it lists the built-in piece alone, and says where the sheets are */
  await leave(phone);
  assert.deepEqual(await listed(phone), ['[New folder]', 'Prelude in C major']);
  await phone.locator('#libKind [data-kind="sheets"]').click();
  await phone.waitForFunction(() => pvSheets.list.length === 0);
  assert.equal(await phone.locator('#sheetsNote').textContent(), 'Sign in to see your sheet music.');
  await phone.locator('#libKind [data-kind="songs"]').click();
  console.log('phone, the second account:', await enter(phone, false, 'someone@example.com', 'another one'));
  await phone.waitForFunction(() => pv.songs.length === 1 && pv.songs[0].name === 'gymnopedie_1.mid');
  assert.deepEqual(held('pianist@example.com'), ['Chop-28-4.mid', 'wtk1-prelude1.mid'], 'signing in to another account on the phone sent it nothing of the first');
  assert.deepEqual(held('someone@example.com'), ['gymnopedie_1.mid']);
  await phone.locator('#libKind [data-kind="sheets"]').click();
  await phone.waitForFunction(() => pvSheets.list.length === 0);
  assert.equal(await phone.locator('#sheetsNote').textContent(), 'Sheet music you save in the Windows app while signed in appears here.');
  assert.deepEqual(sheetsHeld('pianist@example.com'), ['Nocturne']);
  /* the file left loose in the song folder is where it was, and in no account */
  assert.ok(fs.existsSync(loose) && songsIn(home).join() === 'Left lying about.mid');
  assert.ok(![...files.keys()].some(k => Buffer.from(k.split('/').pop().replace(/\.\w+$/, ''), 'hex').toString().includes('Left lying')));
  console.log(problems.length ? 'phone console: ' + problems.join('; ') : 'no phone console problems');
  console.log('PHONE AND SYNC CHECKS PASSED (against the stand-in account service)');
} finally {
  console.log(a.problems.slice(0, 8).join('\n') || 'no console problems');
  await a.close(); cloudServer.close(); site.close();
}
