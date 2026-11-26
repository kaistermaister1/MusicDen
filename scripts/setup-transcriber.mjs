/* Sets up the programs that turn a recording into a song or a tab: yt-dlp, which fetches the
   recording from a link; Transkun, which writes out a piano's notes; and for the guitar, the
   models that hear its notes and find the beat. They go into a Python environment of their own,
   so nothing else on the computer changes. Needs Python on the PATH, and Git for the guitar's.
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
const torchHere = () => ask(py, ['-c', 'import torch; print(torch.__version__)']);
/* Runs pip with the PyTorch already here held at the version it has. False when pip fails. */
function pip(args, torch) {
  if (!torch) return spawnSync(py, ['-m', 'pip', 'install', '--disable-pip-version-check', ...args], {stdio: 'inherit'}).status === 0;
  const pins = path.join(os.tmpdir(), `musicden-pins-${process.pid}.txt`);
  fs.writeFileSync(pins, `torch==${torch}\n`);
  const ok = spawnSync(py, ['-m', 'pip', 'install', '--disable-pip-version-check', ...args, '-c', pins], {stdio: 'inherit'}).status === 0;
  fs.rmSync(pins, {force: true});
  return ok;
}

if (!fs.existsSync(py)) {
  fs.mkdirSync(path.dirname(dir), {recursive: true});
  /* packages already on this computer (PyTorch above all) are reused rather than downloaded again */
  run('python', ['-m', 'venv', '--system-site-packages', dir]);
}

/* ---------- the piano's ---------- */
const piano = ['--upgrade', 'transkun', 'yt-dlp[default]'];
/* the PyTorch already here is held at the version it has; if that cannot be done, pip chooses */
const torch = torchHere();
if (!(torch && pip(piano, torch))) run(py, ['-m', 'pip', 'install', '--disable-pip-version-check', ...piano]);
run(py, ['-m', 'yt_dlp', '--version']);
run(py, ['-c', 'import transkun']);

/* what recordings will be transcribed on */
const probe = () => /^device cuda (.+)$/m.exec(ask(py, [path.join(root, 'app', 'tools', 'transcribe.py'), '--probe']));
const card = probe();
console.log('\nThe transcriber is set up in', dir);
if (card) console.log('Recordings are transcribed on the graphics card:', card[1].trim());
else {
  console.log('Recordings are transcribed on the processor.');
  if (spawnSync('nvidia-smi', ['-L'], {stdio: 'ignore'}).status === 0) {
    console.log('This computer has an NVIDIA graphics card, but the PyTorch installed cannot use it.\nTo transcribe on the card, install PyTorch\'s CUDA build into this environment: take the\ninstall command from https://pytorch.org/get-started/locally and run it as\n  "' + py + '" -m pip install ...');
  }
}

/* ---------- the guitar's ---------- */
/* The note model comes from its author's repository, which pip fetches with Git. The beat tracker
   needs torchaudio: one that is already here and loads is left as it is; otherwise it is fetched
   from the place the PyTorch here came from (the graphics-card builds have a place of their own),
   or failing that from where pip looks by itself. */
console.log('\nSetting up the guitar\'s models');
const now = torchHere(), build = now.split('+')[1];
let guitar = !!ask('git', ['--version']);
if (!guitar) console.error('Git was not found, and the guitar\'s note model is fetched with it. Install Git, then run this again.');
if (guitar && !ask(py, ['-c', 'import torchaudio; print(torchaudio.__version__)'])) {
  guitar = (!!build && pip(['torchaudio', '--index-url', 'https://download.pytorch.org/whl/' + build], now)) || pip(['torchaudio'], now);
}
if (guitar) guitar = pip(['git+https://github.com/xavriley/hf_midi_transcription.git', 'beat-this', 'soundfile', 'numpy', 'soxr', 'audioread', 'librosa'], now);
/* the runner itself says whether everything it needs is there, FFmpeg included, or names what is not */
const said = guitar ? String(spawnSync(py, [path.join(root, 'app', 'tools', 'guitar_tab', 'run.py'), '--probe'], {encoding: 'utf8'}).stdout || '').trim() : '';
if (said === 'ready') console.log('\nThe guitar\'s models are set up in the same place. Their weights are fetched the first time a tab is made.');
else {
  const lacking = /^error tools (.+)$/m.exec(said);
  console.error('\nThe guitar\'s models could not be set up' + (lacking ? '. Still missing: ' + lacking[1].trim().split(/\s+/).join(', ') + '.' : '.') + '\nThe piano\'s transcriber is not affected.');
  process.exitCode = 1;
}
/* the piano's transcriber is checked once more, now that more has been installed beside it */
run(py, ['-c', 'import transkun']);
const after = probe();
if (!!card !== !!after) console.error('The graphics card is no longer used after installing the guitar\'s models: PyTorch was replaced. Install its CUDA build again as described above.');
