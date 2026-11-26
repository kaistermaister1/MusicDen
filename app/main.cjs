/* The desktop shell: one window, the songs on disk, and the native dialogs. */
const {app, BrowserWindow, ipcMain, dialog, shell, protocol, net, session, Menu} = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const fsp = fs.promises;
const {pathToFileURL} = require('node:url');
const {spawn, spawnSync} = require('node:child_process');

const ROOT = __dirname;
const TESTING = !!process.env.MUSICDEN_TEST;
if (process.env.MUSICDEN_USER_DATA) app.setPath('userData', process.env.MUSICDEN_USER_DATA);
if (TESTING) app.commandLine.appendSwitch('mute-audio');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
/* Frames for video are drawn while the window may be covered; keep the page running at full rate. */
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');

protocol.registerSchemesAsPrivileged([{scheme: 'app', privileges: {standard: true, secure: true, supportFetchAPI: true, stream: true}}]);

/* ---------- what is remembered between runs ---------- */
const configFile = () => path.join(app.getPath('userData'), 'config.json');
let config = {folder: '', bounds: null};
function loadConfig() {
  try { Object.assign(config, JSON.parse(fs.readFileSync(configFile(), 'utf8'))); } catch (e) {}
  if (process.env.MUSICDEN_FOLDER) config.folder = process.env.MUSICDEN_FOLDER;
}
function saveConfig() {
  try { fs.mkdirSync(path.dirname(configFile()), {recursive: true}); fs.writeFileSync(configFile(), JSON.stringify(config)); } catch (e) {}
}

/* ---------- where the songs are kept ---------- */
/* Songs live in the song folder: the one chosen in Settings, or "MusicDen" in the person's Music
   folder until one is chosen, so nobody has to pick a folder before adding a song. Each account
   has a folder of its own inside it, named after the account, and the app shows only the songs of
   whoever is signed in; songs added while no one is signed in have a folder of their own there
   too. Files lying loose in the song folder itself are left alone and are not listed. */
const isMidi = name => /\.midi?$/i.test(name);
const isDir = dir => { try { return fs.statSync(dir).isDirectory(); } catch (e) { return false; } };
const NOBODY = 'Not signed in';
let home = '', owner = null;
/* Settles on the song folder, making the usual one when none is chosen or the chosen one cannot be reached. */
function findHome() {
  home = '';
  if (config.folder && isDir(config.folder)) { home = config.folder; return; }
  const usual = [];
  /* a check never touches the person's own Music folder */
  if (!TESTING) { try { usual.push(path.join(app.getPath('music'), 'MusicDen')); } catch (e) {} }
  usual.push(path.join(app.getPath('userData'), 'Songs'));
  for (const dir of usual) { try { fs.mkdirSync(dir, {recursive: true}); home = dir; return; } catch (e) {} }
}
/* The name of an account's folder: its email, without what a folder's name cannot hold. */
const dirOf = who => who.email.toLowerCase().replace(/[\\/:*?"<>|\x00-\x1f]+/g, '_').replace(/[. ]+$/, '').slice(0, 120) || who.id.replace(/[^\w-]+/g, '_');
/* The folder holding the songs that are showing, and making sure it is there. */
const folder = () => home ? path.join(home, owner ? dirOf(owner) : NOBODY) : '';
const folderReady = () => !!home && isDir(folder());
const makeFolder = async () => { if (home) await fsp.mkdir(folder(), {recursive: true}).catch(() => {}); };
const inFolder = name => {
  if (!home || path.basename(name) !== name) throw new Error('name');
  return path.join(folder(), name);
};
let win = null, watcher = null, watchTimer = 0;
function watchFolder() {
  if (watcher) { try { watcher.close(); } catch (e) {} watcher = null; }
  if (!folderReady()) return;
  try {
    /* only songs coming, going or changing are passed on: the note of what was synced changes without the list changing */
    watcher = fs.watch(folder(), (event, file) => {
      if (file && !isMidi(String(file))) return;
      clearTimeout(watchTimer);
      watchTimer = setTimeout(() => { if (win && !win.isDestroyed()) win.webContents.send('lib:changed'); }, 250);
    });
    watcher.on('error', () => {});
  } catch (e) {}
}
async function listSongs() {
  if (!folderReady()) return [];
  const out = [], dir = folder();
  for (const name of await fsp.readdir(dir)) {
    if (!isMidi(name)) continue;
    try { const st = await fsp.stat(path.join(dir, name)); if (st.isFile()) out.push({name, size: st.size, changed: st.mtimeMs}); } catch (e) {}
  }
  return out;
}
/* Writes beside the target first, then swaps it in, so a song is never left half written. */
async function writeSafely(file, bytes) {
  const temp = file + '.saving';
  await fsp.writeFile(temp, bytes);
  await fsp.rename(temp, file);
}
/* The name a file takes in a folder: its own, or with a number added when a different file there
   already has it. `twice` says the very same file, byte for byte, is already there under that name. */
async function nameIn(dir, name, bytes) {
  const ext = path.extname(name), stem = path.basename(name, ext);
  for (let i = 2, as = name; ; as = `${stem} (${i++})${ext}`) {
    let there = null;
    try { there = await fsp.readFile(path.join(dir, as)); } catch (e) {}
    if (!there) return {as, twice: false};
    if (there.equals(bytes)) return {as, twice: true};
  }
}
/* Copies files into the folder. A file already there with the same bytes is not copied twice;
   a different file of the same name gets a number added. */
async function importFiles(paths) {
  const names = [], dir = folder();
  for (const from of paths) {
    if (!isMidi(from)) { names.push(null); continue; }
    try {
      const bytes = await fsp.readFile(from), {as, twice} = await nameIn(dir, path.basename(from), bytes);
      if (!twice) await fsp.writeFile(path.join(dir, as), bytes);
      names.push(as);
    } catch (e) { names.push(null); }
  }
  return names;
}
/* Moves the songs added while no one was signed in into the folder of the account now showing.
   One the account already has, byte for byte, is not kept twice. Gives back each song's name
   before and after, which differ when the account had another song of that name. */
async function adopt() {
  const moved = {};
  if (!owner || !folderReady()) return moved;
  const to = folder(), loose = path.join(home, NOBODY);
  for (const name of await fsp.readdir(loose).catch(() => [])) {
    if (!isMidi(name)) continue;
    const from = path.join(loose, name);
    try {
      if (!(await fsp.stat(from)).isFile()) continue;
      const {as, twice} = await nameIn(to, name, await fsp.readFile(from));
      if (twice) await fsp.unlink(from); else await fsp.rename(from, path.join(to, as));
      moved[name] = as;
    } catch (e) {}
  }
  return moved;
}

/* Shows the songs of an account ({id, email}), or with nothing those added while signed out.
   Answers with the name of the folder they are in. */
ipcMain.handle('lib:open', async (e, who) => {
  owner = who && typeof who.id === 'string' && who.id ? {id: who.id, email: String(who.email || '')} : null;
  await makeFolder();
  watchFolder();
  return owner ? dirOf(owner) : NOBODY;
});
ipcMain.handle('lib:adopt', () => adopt());
/* What was in step between this folder and the account when they were last synced. It is kept in
   the folder it describes, so a folder that is new, or swapped for another, starts without one. */
const RECORD = '.sync.json';
ipcMain.handle('lib:record', async () => {
  if (!owner || !folderReady()) return null;
  try { return JSON.parse(await fsp.readFile(path.join(folder(), RECORD), 'utf8')); } catch (e) { return null; }
});
ipcMain.handle('lib:keepRecord', async (e, record) => { if (owner && folderReady()) await writeSafely(path.join(folder(), RECORD), JSON.stringify(record)); });
ipcMain.handle('lib:folder', () => folderReady() ? folder() : '');
ipcMain.handle('lib:choose', async (e, title, button) => {
  const r = await dialog.showOpenDialog(win, {title, buttonLabel: button, defaultPath: home || app.getPath('music'), properties: ['openDirectory', 'createDirectory']});
  if (r.canceled || !r.filePaths[0]) return '';
  config.folder = r.filePaths[0]; saveConfig(); findHome();
  await makeFolder();
  watchFolder();
  return folderReady() ? folder() : '';
});
ipcMain.handle('lib:list', () => listSongs());
ipcMain.handle('lib:read', (e, name) => fsp.readFile(inFolder(name)));
ipcMain.handle('lib:write', (e, name, bytes) => writeSafely(inFolder(name), Buffer.from(bytes)));
ipcMain.handle('lib:import', (e, paths) => folderReady() ? importFiles(paths) : []);
ipcMain.handle('lib:pick', async (e, title, button, kind) => {
  if (!folderReady()) return [];
  const r = await dialog.showOpenDialog(win, {title, buttonLabel: button, filters: [{name: kind, extensions: ['mid', 'midi']}], properties: ['openFile', 'multiSelections']});
  return r.canceled ? [] : importFiles(r.filePaths);
});
ipcMain.handle('lib:trash', (e, name) => shell.trashItem(inFolder(name)));
/* Gives a song's file another name. Refuses a name another file in the folder already has. */
ipcMain.handle('lib:rename', async (e, from, to) => {
  const a = inFolder(from), b = inFolder(to);
  if (a.toLowerCase() !== b.toLowerCase() && fs.existsSync(b)) throw new Error('taken');
  await fsp.rename(a, b);
});
ipcMain.handle('lib:openFolder', () => folderReady() ? shell.openPath(folder()) : '');

/* ---------- a song from a link ---------- */
/* The programs this needs: yt-dlp to fetch the recording, and a Python that has Transkun, which
   writes out the recording's piano notes; the same Python sorts the notes into a right-hand and a
   left-hand track. Looked for in the environment "npm run transcriber" sets up, then on the PATH. */
const TRANSCRIBE = path.join(ROOT, 'tools', 'transcribe.py'), HANDS = path.join(ROOT, 'tools', 'hand_split.py');
function linkTools() {
  const own = path.join(process.env.LOCALAPPDATA || '', 'MusicDen', 'transcriber', 'Scripts', 'python.exe');
  if (fs.existsSync(own)) return {fetch: [own, '-m', 'yt_dlp'], py: own};
  const where = cmd => { try { const r = spawnSync('where', [cmd], {windowsHide: true, encoding: 'utf8'}); return r.status === 0 ? r.stdout.split(/\r?\n/)[0].trim() : ''; } catch (e) { return ''; } };
  const transkun = where('transkun');
  if (!transkun || !where('yt-dlp')) return null;
  /* Transkun's own Python sits beside its program, or one folder up */
  const beside = path.dirname(transkun);
  return {fetch: ['yt-dlp'], py: [path.join(beside, 'python.exe'), path.join(beside, '..', 'python.exe')].find(f => fs.existsSync(f)) || 'python'};
}
/* ELECTRON_RUN_AS_NODE lets yt-dlp use this app itself as the JavaScript engine YouTube links need */
const toolEnv = () => ({...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1', ELECTRON_RUN_AS_NODE: '1'});

/* What transcribing can run on here: {tools: false} while the programs are missing, otherwise
   {tools: true, card}, where card is the name of the graphics card the transcriber can use, ''
   when it can use none. Asked once a run, since the answer takes a few seconds to come. */
let asked = null;
function transcriber() {
  if (asked) return asked;
  const tools = linkTools();
  if (!tools) return Promise.resolve({tools: false, card: ''});
  return asked = new Promise(resolve => {
    let out = '', over = false;
    const done = () => { if (over) return; over = true; const m = /^device cuda (.+)$/m.exec(out); resolve({tools: true, card: m ? m[1].trim() : ''}); };
    const p = spawn(tools.py, [TRANSCRIBE, '--probe'], {windowsHide: true, env: toolEnv()});
    p.stdout.on('data', d => { out += d; }); p.stderr.on('data', () => {});
    p.on('error', done); p.on('close', done);
  });
}
ipcMain.handle('link:transcriber', () => transcriber());

let linkJob = null;
/* Fetches the recording at `url` and writes its notes into the songs that are showing. `useCard`
   says whether the graphics card may do the transcribing. */
ipcMain.handle('link:start', async (e, url, useCard) => {
  if (linkJob || !folderReady()) return {error: 'failed'};
  let link;
  try { link = new URL(String(url)); } catch (err) { return {error: 'download'}; }
  if (link.protocol !== 'https:' && link.protocol !== 'http:') return {error: 'download'};
  const tools = linkTools();
  if (!tools) return {error: 'tools'};
  /* the song goes to whoever asked for it, also when someone else has signed in by the time it is ready */
  const into = folder();
  const dir = await fsp.mkdtemp(path.join(app.getPath('temp'), 'musicden-link-'));
  const job = linkJob = {proc: null, cancelled: false};
  /* Runs one program to its end. `onLine` is given each line it prints, as it prints it. */
  const step = (cmd, args, onLine) => new Promise(resolve => {
    let out = '', part = '';
    const p = job.proc = spawn(cmd[0], [...cmd.slice(1), ...args], {windowsHide: true, cwd: dir, env: toolEnv()});
    p.stdout.on('data', d => {
      out += d;
      if (!onLine) return;
      const lines = (part + d).split(/\r?\n/);
      part = lines.pop(); lines.forEach(onLine);
    });
    p.stderr.on('data', () => {});
    p.on('error', () => resolve({code: -1, out})); p.on('close', code => resolve({code, out}));
  });
  const tell = info => { if (win && !win.isDestroyed()) win.webContents.send('link:stage', info); };
  try {
    tell({stage: 'download'});
    const sound = path.join(dir, 'sound.wav');
    const got = await step(tools.fetch, ['--js-runtimes', 'node:' + process.execPath, '--no-playlist', '--no-progress', '--no-simulate', '--encoding', 'utf-8', '--print', 'before_dl:%(title)s',
      '-f', 'bestaudio/best', '-x', '--audio-format', 'wav', '-o', path.join(dir, 'sound.%(ext)s'), '--', link.href]);
    if (job.cancelled) return {error: 'cancelled'};
    if (got.code !== 0 || !fs.existsSync(sound)) return {error: 'download'};
    tell({stage: 'transcribe'});
    const notes = path.join(dir, 'notes.mid');
    /* the transcriber says what it is running on and, while that is the graphics card, how much of
       the card's memory it holds; the window is told each time */
    let on = null;
    const wrote = await step([tools.py, TRANSCRIBE], [sound, notes, useCard === false ? 'cpu' : 'cuda'], line => {
      const device = /^device (cuda|cpu)( again)?/.exec(line), memory = /^memory (\d+)/.exec(line);
      if (device) on = {stage: 'transcribe', card: device[1] === 'cuda', gaveUp: !!device[2]};
      else if (memory && on && on.card) on = {...on, memory: +memory[1]};
      else return;
      tell(on);
    });
    if (job.cancelled) return {error: 'cancelled'};
    if (wrote.code !== 0 || !fs.existsSync(notes)) return {error: 'failed'};
    const {parseMidi} = await import(pathToFileURL(path.join(ROOT, 'ui', 'midi.js')).toString());
    try { parseMidi(new Uint8Array(await fsp.readFile(notes))); } catch (err) { return {error: 'notes'}; }
    /* Transkun writes every note into one track; the splitter gives each hand its own. If it cannot run, the single track is kept. */
    const hands = path.join(dir, 'hands.mid');
    const split = await step([tools.py, HANDS], [notes, hands]);
    if (job.cancelled) return {error: 'cancelled'};
    const bytes = await fsp.readFile(split.code === 0 && fs.existsSync(hands) ? hands : notes);
    /* the song is named after the recording */
    const title = got.out.split(/\r?\n/).map(s => s.trim()).filter(Boolean)[0] || 'Recording';
    const stem = title.replace(/[\\/:*?"<>|\x00-\x1f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120).replace(/[. ]+$/, '') || 'Recording';
    let name = stem + '.mid';
    for (let i = 2; fs.existsSync(path.join(into, name)); i++) name = `${stem} (${i}).mid`;
    await writeSafely(path.join(into, name), bytes);
    return {name, card: !!(on && on.card)};
  } catch (err) {
    return {error: 'failed'};
  } finally {
    linkJob = null;
    fsp.rm(dir, {recursive: true, force: true}).catch(() => {});
  }
});
/* Stops the download or the transcription, and the programs they started in turn. */
ipcMain.handle('link:cancel', () => {
  if (!linkJob) return;
  linkJob.cancelled = true;
  const pid = linkJob.proc && linkJob.proc.pid;
  if (pid) { try { spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], {windowsHide: true}); } catch (err) {} }
});

/* ---------- video ---------- */
ipcMain.handle('video:choose', async (e, suggested, title, kind) => {
  const r = await dialog.showSaveDialog(win, {title, defaultPath: path.join(config.videoFolder && fs.existsSync(config.videoFolder) ? config.videoFolder : app.getPath('videos'), suggested), filters: [{name: kind, extensions: ['mp4']}]});
  if (r.canceled || !r.filePath) return '';
  config.videoFolder = path.dirname(r.filePath); saveConfig();
  return r.filePath;
});
ipcMain.handle('video:show', (e, file) => shell.showItemInFolder(file));
/* A saved sheet music file goes to the Recycle Bin. Only files in the app's own folder of saved sheet music are taken. */
ipcMain.handle('sheet:trash', async (e, file) => {
  const kept = path.join(app.getPath('userData'), 'sheets') + path.sep, target = path.resolve(String(file));
  if (!target.startsWith(kept)) throw new Error('name');
  await shell.trashItem(target);
});
ipcMain.handle('app:paths', () => ({temp: app.getPath('temp'), root: ROOT, testing: TESTING, userData: app.getPath('userData'), nobody: NOBODY}));

/* ---------- window ---------- */
function createWindow() {
  const b = config.bounds || {};
  win = new BrowserWindow({
    width: b.width || 1360, height: b.height || 820, x: b.x, y: b.y,
    minWidth: 760, minHeight: 480, backgroundColor: '#101012', show: false, skipTaskbar: TESTING,
    webPreferences: {preload: path.join(ROOT, 'preload.cjs'), contextIsolation: true, sandbox: false, nodeIntegration: false, backgroundThrottling: false}
  });
  /* a check runs the app off the edge of the screen, out of the way of whoever is using the computer */
  win.once('ready-to-show', () => { if (TESTING) { if (!process.env.MUSICDEN_TEST_VISIBLE) win.setPosition(-30000, -30000); win.showInactive(); } else { if (b.maximized) win.maximize(); win.show(); } });
  win.on('close', () => {
    if (TESTING) return;
    config.bounds = Object.assign(win.getNormalBounds(), {maximized: win.isMaximized()});
    saveConfig();
  });
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type === 'keyDown' && input.key === 'F12' && !app.isPackaged) win.webContents.toggleDevTools();
  });
  win.webContents.setWindowOpenHandler(() => ({action: 'deny'}));
  win.webContents.on('will-navigate', e => e.preventDefault());
  win.loadURL('app://local/ui/index.html');
}

app.whenReady().then(() => {
  loadConfig();
  findHome();
  if (home) { try { fs.mkdirSync(folder(), {recursive: true}); } catch (e) {} }
  Menu.setApplicationMenu(null);
  protocol.handle('app', request => {
    const file = path.normalize(path.join(ROOT, decodeURIComponent(new URL(request.url).pathname)));
    if (!file.startsWith(ROOT)) return new Response('', {status: 403});
    return net.fetch(pathToFileURL(file).toString());
  });
  const allowed = new Set(['midi', 'midiSysex', 'fullscreen']);
  session.defaultSession.setPermissionRequestHandler((wc, permission, done) => done(allowed.has(permission)));
  session.defaultSession.setPermissionCheckHandler((wc, permission) => allowed.has(permission));
  createWindow();
  watchFolder();
});
app.on('window-all-closed', () => app.quit());
