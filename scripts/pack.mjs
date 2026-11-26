/* Builds a folder with the app and everything it needs, ready to double-click on Windows. */
import {packager} from '@electron/packager';
import path from 'node:path';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
if (!fs.existsSync(path.join(root, 'app', 'assets', 'piano', 'A4v8.mp3')) || !fs.existsSync(path.join(root, 'app', 'assets', 'guitar', 'A2.mp3'))) console.warn('The piano or the guitar recordings are missing; run "npm run samples" first to include them.');
const [out] = await packager({
  dir: root, name: 'MusicDen', platform: 'win32', arch: 'x64', out: path.join(root, 'dist'), overwrite: true, prune: true, asar: false,
  /* what Python leaves beside the transcriber's scripts when it runs them stays out as well */
  ignore: [/^\/(test|docs|design|dist|dist-phone|scripts|supabase|\.claude|\.wrangler)($|\/)/, /^\/README\.md$/, /^\/wrangler\.jsonc$/, /^\/\.git/, /\/__pycache__($|\/)/],
  icon: path.join(root, 'app', 'assets', 'icon.ico')
});
console.log('Built', out);
