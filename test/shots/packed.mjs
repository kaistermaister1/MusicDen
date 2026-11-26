/* Starts the built app from dist (after "npm run pack") and checks that it comes up with the piano loaded. */
import {_electron as electron} from 'playwright-core';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {root, out} from './harness.mjs';

const exe = path.join(root, 'dist', 'MusicDen-win32-x64', 'MusicDen.exe');
if (!fs.existsSync(exe)) { console.log('Not built yet: run "npm run pack" first.'); process.exit(1); }
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'pv-packed-'));
const app = await electron.launch({executablePath: exe, args: [], env: {...process.env, MUSICDEN_TEST: '1', MUSICDEN_USER_DATA: userData, MUSICDEN_FOLDER: ''}});
try {
  const win = await app.firstWindow();
  const problems = [];
  win.on('console', m => { if (m.type() === 'error') problems.push(m.text()); });
  await win.waitForFunction(() => window.pv && window.pv.stage.geo && document.fonts.status === 'loaded', null, {timeout: 20000});
  await win.waitForFunction(() => pv.bank.ready && pv.bank.buffers.size >= 30, null, {timeout: 20000});
  await win.evaluate(() => { pv.seek(6); pv.play(); });
  await win.waitForTimeout(1500);
  const state = await win.evaluate(() => ({title: document.title, playing: pv.playing, at: pv.now().toFixed(1), recordings: pv.bank.buffers.size, sampledVoices: [...pv.piano.voices].filter(v => v.sampled).length}));
  await win.screenshot({path: path.join(out, '80-packed-app.png')});
  console.log('built app:', JSON.stringify(state), problems.length ? problems.join('; ') : 'no console errors');
} finally {
  await app.close();
  fs.rmSync(userData, {recursive: true, force: true});
}
