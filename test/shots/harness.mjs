/* Starts the real app for a check: its own settings folder, sound muted, a window that does not take focus. */
import {_electron as electron} from 'playwright-core';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const out = path.join(root, 'test', 'out');
fs.mkdirSync(out, {recursive: true});

/* `keep` names a settings folder to reuse, so a second start remembers what the first one did.
   The window opens off the edge of the screen unless `visible` is set. */
export async function launch({folder = '', size = [1360, 820], keep = '', visible = false} = {}) {
  const userData = keep || fs.mkdtempSync(path.join(os.tmpdir(), 'pv-test-'));
  const app = await electron.launch({args: ['.'], cwd: root, env: {...process.env, MUSICDEN_TEST: '1', MUSICDEN_TEST_VISIBLE: visible ? '1' : '', MUSICDEN_USER_DATA: userData, MUSICDEN_FOLDER: folder}});
  const win = await app.firstWindow();
  const problems = [];
  win.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') problems.push(m.type() + ': ' + m.text()); });
  win.on('pageerror', e => problems.push('pageerror: ' + e.message));
  await app.evaluate(({BrowserWindow}, s) => BrowserWindow.getAllWindows()[0].setContentSize(s[0], s[1]), size);
  await win.waitForFunction(() => window.pv && window.pv.stage.geo && document.fonts.status === 'loaded', null, {timeout: 20000});
  await win.waitForTimeout(400);
  const shot = async name => { const file = path.join(out, name + '.png'); await win.screenshot({path: file}); return file; };
  /* Freezes the stage at a moment of the piece and draws it. */
  const at = async t => { await win.evaluate(t => { const pv = window.pv; if (pv.playing) pv.pause(); pv.seek(t); pv.redraw(); }, t); await win.waitForTimeout(120); };
  const close = async () => { await app.close(); if (!keep) { try { fs.rmSync(userData, {recursive: true, force: true}); } catch (e) {} } };
  return {app, win, shot, at, close, problems};
}

/* A scratch song folder holding copies of the given fixture files. */
export function songFolder(names) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pv-songs-'));
  for (const n of names) fs.copyFileSync(path.join(root, 'test', 'fixtures', n), path.join(dir, n));
  return dir;
}
