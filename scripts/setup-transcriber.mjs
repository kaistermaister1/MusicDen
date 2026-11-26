/* Sets up the two programs that turn a recording into a MIDI file: yt-dlp, which fetches the
   recording from a link, and Transkun, which writes out its piano notes. They go into a Python
   environment of their own, so nothing else on the computer changes. Needs Python on the PATH.
   A PyTorch already on the computer is used as it is. That matters when it is a build that can
   use the graphics card: the one pip would fetch in its place cannot. */
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const home = process.env.LOCALAPPDATA || path.join(process.env.HOME || '.', '.local', 'share');
const dir = path.join(home, 'MusicDen', 'transcriber');
const py = path.join(dir, process.platform === 'win32' ? 'Scripts' : 'bin', process.platform === 'win32' ? 'python.exe' : 'python');
const run = (cmd, args) => { const r = spawnSync(cmd, args, {stdio: 'inherit'}); if (r.status !== 0) { console.error(`\nFailed: ${cmd} ${args.join(' ')}`); process.exit(1); } };
/* What a command prints, or '' when it fails. */
const ask = (cmd, args) => { const r = spawnSync(cmd, args, {encoding: 'utf8'}); return r.status === 0 ? String(r.stdout).trim() : ''; };

if (!fs.existsSync(py)) {
  fs.mkdirSync(path.dirname(dir), {recursive: true});
  /* packages already on this computer (PyTorch above all) are reused rather than downloaded again */
  run('python', ['-m', 'venv', '--system-site-packages', dir]);
}
const install = ['-m', 'pip', 'install', '--upgrade', '--disable-pip-version-check', 'transkun', 'yt-dlp[default]'];
/* the PyTorch already here is held at the version it has; if that cannot be done, pip chooses */
const torch = ask(py, ['-c', 'import torch; print(torch.__version__)']);
let done = false;
if (torch) {
  const pins = path.join(os.tmpdir(), `musicden-pins-${process.pid}.txt`);
  fs.writeFileSync(pins, `torch==${torch}\n`);
  done = spawnSync(py, [...install, '-c', pins], {stdio: 'inherit'}).status === 0;
  fs.rmSync(pins, {force: true});
}
if (!done) run(py, install);
run(py, ['-m', 'yt_dlp', '--version']);
run(py, ['-c', 'import transkun']);

/* what recordings will be transcribed on */
const card = /^device cuda (.+)$/m.exec(ask(py, [path.join(root, 'app', 'tools', 'transcribe.py'), '--probe']));
console.log('\nThe transcriber is set up in', dir);
if (card) console.log('Recordings are transcribed on the graphics card:', card[1].trim());
else {
  console.log('Recordings are transcribed on the processor.');
  if (spawnSync('nvidia-smi', ['-L'], {stdio: 'ignore'}).status === 0) {
    console.log('This computer has an NVIDIA graphics card, but the PyTorch installed cannot use it.\nTo transcribe on the card, install PyTorch\'s CUDA build into this environment: take the\ninstall command from https://pytorch.org/get-started/locally and run it as\n  "' + py + '" -m pip install ...');
  }
}
