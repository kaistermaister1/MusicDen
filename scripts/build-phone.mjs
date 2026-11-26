/* Gathers what the phone version needs into dist-phone, ready to put on a web host: the page and
   its scripts, the fonts, icons and piano recordings. The desktop-only parts are left out.
   The service worker is stamped with a version and the list of files to keep on the phone, so
   the app opens at once there and works without a connection. A folder to build into can be
   given in place of dist-phone. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

export function build(out = path.join(root, 'dist-phone')) {
  fs.rmSync(out, {recursive: true, force: true});
  fs.cpSync(path.join(root, 'app', 'ui'), path.join(out, 'ui'), {recursive: true});
  fs.cpSync(path.join(root, 'app', 'assets'), path.join(out, 'assets'), {recursive: true});
  /* the bare address opens the app */
  fs.writeFileSync(path.join(out, 'index.html'), '<!DOCTYPE html><meta charset="utf-8"><meta http-equiv="refresh" content="0; url=ui/index.html"><title>MusicDen</title>');
  /* scripts are checked for a newer copy on every visit; recordings and fonts are kept by the phone */
  fs.writeFileSync(path.join(out, '_headers'), '/ui/*\n  Cache-Control: no-cache\n/assets/*\n  Cache-Control: public, max-age=31536000, immutable\n');
  stamp(out);
  let files = 0, bytes = 0;
  for (const f of walk(out)) { files++; bytes += fs.statSync(path.join(out, f)).size; }
  return {files, bytes};
}

/* Every file under a folder, as paths with forward slashes, in a settled order. */
function walk(dir, under = '') {
  const found = [];
  for (const f of fs.readdirSync(path.join(dir, under), {withFileTypes: true}).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const rel = under ? under + '/' + f.name : f.name;
    if (f.isDirectory()) found.push(...walk(dir, rel)); else found.push(rel);
  }
  return found;
}

/* Writes into the service worker what it is to keep: the app's own files, fetched together as one
   version, and the piano's recordings. The version is a fingerprint of the app's files, so it
   changes exactly when one of them does. Paths are given from the service worker's own folder. */
function stamp(out) {
  const all = walk(out), shell = all.filter(f => (f.startsWith('ui/') && f !== 'ui/sw.js') || (f.startsWith('assets/') && !f.startsWith('assets/piano/') && !/\.(txt|ico)$/.test(f)));
  const piano = all.filter(f => f.startsWith('assets/piano/'));
  const print = crypto.createHash('sha256');
  for (const f of shell) { print.update(f); print.update(fs.readFileSync(path.join(out, f))); }
  const from = f => (f.startsWith('ui/') ? './' + f.slice(3) : '../' + f);
  const file = path.join(out, 'ui', 'sw.js'), marker = "const VERSION = 'dev', SHELL = [], PIANO = [];", text = fs.readFileSync(file, 'utf8');
  if (!text.includes(marker)) throw new Error('The service worker has no line to stamp.');
  fs.writeFileSync(file, text.replace(marker, () => `const VERSION = '${print.digest('hex').slice(0, 12)}', SHELL = ${JSON.stringify(shell.map(from))}, PIANO = ${JSON.stringify(piano.map(from))};`));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const {files, bytes} = build(process.argv[2] ? path.resolve(process.argv[2]) : undefined);
  console.log(`dist-phone: ${files} files, ${(bytes / 1e6).toFixed(1)} MB`);
}
