/* Runs every check that drives the real app, one after another, and reports which passed. */
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const checks = [['features.mjs'], ['edit.mjs'], ['play.mjs'], ['sound.mjs'], ['misc.mjs'], ['solid.mjs'], ['flat.mjs'], ['sheet.mjs'], ['sheets.mjs'], ['rename.mjs'], ['folders.mjs'], ['touch.mjs'], ['offline.mjs'], ['video.mjs', 'hd', '60', 'wide', 'flat']];
let failed = 0;
for (const [file, ...args] of checks) {
  const r = spawnSync(process.execPath, [path.join(here, file), ...args], {stdio: 'inherit'});
  console.log(`${r.status === 0 ? 'passed' : 'FAILED'}: ${file}\n`);
  if (r.status !== 0) failed++;
}
console.log(failed ? `${failed} of ${checks.length} checks failed` : `all ${checks.length} checks passed`);
process.exit(failed ? 1 : 0);
