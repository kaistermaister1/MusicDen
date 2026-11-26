/* The phone version without a connection. The app is built as it is published and opened from a
   server on this computer; once it says it is kept on the device the server is shut down, and the
   app must still open, show its songs and play with the sampled piano. Then a newer version is
   published: the app moves to it by itself on the next opening. */
import {launch, songFolder, out} from './harness.mjs';
import {build} from '../../scripts/build-phone.mjs';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pv-site-'));
const made = build(dir);
const TYPES = {'.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.mp3': 'audio/mpeg', '.woff2': 'font/woff2'};
let served = 0;
const answer = (req, res) => {
  const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname), file = path.join(dir, rel);
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404).end(); return; }
    served++;
    res.writeHead(200, {'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache'}).end(data);
  });
};
let server = http.createServer(answer);
await new Promise(r => server.listen(0, '127.0.0.1', r));
const port = server.address().port, url = `http://127.0.0.1:${port}/ui/index.html?test`;
const stop = () => new Promise(r => { server.closeAllConnections(); server.close(r); });

const a = await launch({folder: songFolder([])});
try {
  const opened = a.app.waitForEvent('window');
  await a.app.evaluate(({BrowserWindow}, url) => { const win = new BrowserWindow({width: 844, height: 390, x: -30000, y: -30000, show: false, useContentSize: true, webPreferences: {backgroundThrottling: false}}); win.showInactive(); win.loadURL(url); }, url);
  const phone = await opened;
  const problems = [];
  phone.on('pageerror', e => problems.push(e.message));
  const up = () => phone.waitForFunction(() => window.pv && pv.stage.geo && window.pvCloud, null, {timeout: 20000});
  await up();

  /* first visit: the app's files and then every recording are kept on the device */
  await phone.waitForFunction(() => navigator.serviceWorker.controller && window.pvOffline && pvOffline.of > 0 && pvOffline.have === pvOffline.of, null, {timeout: 120000});
  const kept = await phone.evaluate(async () => ({state: pvOffline, caches: await caches.keys(), app: (await (await caches.open((await caches.keys()).find(n => n.startsWith('app-')))).keys()).length}));
  console.log(`built ${made.files} files; kept on the device: ${kept.app} app files, ${kept.state.have} of ${kept.state.of} recordings (${kept.caches.join(', ')})`);
  await phone.evaluate(async bytes => { await desk.library.importFiles([new File([new Uint8Array(bytes)], 'Chop-28-4.mid')]); }, Array.from(fs.readFileSync(path.join('test', 'fixtures', 'Chop-28-4.mid'))));
  await phone.waitForFunction(() => pv.songs.length === 1);

  /* the server goes away: the app opens all the same, and plays */
  await stop();
  const before = served;
  await phone.reload();
  await up();
  await phone.waitForFunction(() => pv.songs.length === 1 && pv.bank.ready);
  await phone.evaluate(() => pv.openSong('Chop-28-4.mid').then(() => pv.play()));
  await phone.waitForTimeout(2500);
  const sound = await phone.evaluate(() => ({at: +pv.now().toFixed(1), sampled: [...pv.piano.voices].filter(v => v.sampled).length, recordings: pv.bank.buffers.size}));
  console.log('with the server shut down:', JSON.stringify(sound));
  assert.ok(sound.at > 1 && sound.sampled > 0, 'the song plays with the sampled piano and no server');
  assert.equal(served, before, 'nothing was asked of the server');
  await phone.evaluate(() => pv.pause());
  await phone.locator('#lookBtn').click();
  await phone.locator('#offline').scrollIntoViewIfNeeded();
  await phone.waitForFunction(() => document.getElementById('offline').textContent === pv.T.offlineYes, null, {timeout: 10000});
  await phone.screenshot({path: path.join(out, '170-offline-settings.png')});

  /* a newer version is published: on the next opening the app fetches it in the background and moves to it by itself */
  const strings = path.join(dir, 'ui', 'strings.js'), worker = path.join(dir, 'ui', 'sw.js');
  fs.writeFileSync(strings, fs.readFileSync(strings, 'utf8').replace("appName: 'MusicDen'", "appName: 'MusicDen, newer'"));
  fs.writeFileSync(worker, fs.readFileSync(worker, 'utf8').replace(/const VERSION = '[0-9a-f]+'/, "const VERSION = 'newer'"));
  server = http.createServer(answer);
  await new Promise(r => server.listen(port, '127.0.0.1', r));
  await phone.reload();
  await phone.waitForFunction(() => document.title === 'MusicDen, newer' && window.pv && pv.stage.geo, null, {timeout: 60000});
  const after = await phone.evaluate(async () => (await caches.keys()).sort());
  console.log('after a newer version was published:', await phone.title(), '| kept:', after.join(', '));
  assert.deepEqual(after, ['app-newer', 'piano-1'], 'the older version\'s files are gone and the recordings were kept');
  assert.equal(await phone.evaluate(() => pv.songs.length), 1, 'the songs on the device are untouched');
  console.log(problems.length ? 'page errors: ' + problems.join('; ') : 'no page errors');
  assert.equal(problems.length, 0);
  console.log('OFFLINE CHECKS PASSED');
} finally {
  await a.close();
  await stop().catch(() => {});
  fs.rmSync(dir, {recursive: true, force: true});
}
