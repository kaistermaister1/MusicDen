/* What the page can ask of the computer: the song folder, native dialogs, sheet music, and the video encoder. */
const {contextBridge, ipcRenderer, webUtils} = require('electron');
const {spawn, spawnSync} = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const sheet = require('./sheet.cjs');

let paths = null;
const ready = ipcRenderer.invoke('app:paths').then(p => { paths = p; });
/* Sheet music saved as PDF is kept apart for each account, as the songs are: `under` is the name of
   the folder of whoever's songs are showing, and `account` says whether that is someone signed in. */
let under = '', account = false;
const sheets = () => path.join(paths.userData, 'sheets', under);
const loose = () => path.join(paths.userData, 'sheets', paths.nobody);
const own = name => { if (typeof name !== 'string' || !name || path.basename(name) !== name) throw new Error('name'); return name; };

/* ---------- video encoding through ffmpeg ---------- */
let ffmpeg = null, encoder = null, job = null;
function findFfmpeg() {
  if (ffmpeg !== null) return ffmpeg;
  const beside = [path.join(paths.root, '..', 'bin', 'ffmpeg.exe'), path.join(paths.root, 'bin', 'ffmpeg.exe')];
  ffmpeg = beside.find(f => fs.existsSync(f)) || '';
  if (!ffmpeg) { try { if (spawnSync('ffmpeg', ['-version'], {windowsHide: true}).status === 0) ffmpeg = 'ffmpeg'; } catch (e) {} }
  return ffmpeg;
}
/* The graphics card's encoder when it has one that works, otherwise the processor. Settings are
   chosen to stay ahead of real time at 4K and 60 frames a second. */
const ENCODERS = [
  ['h264_nvenc', () => ['-preset', 'p4', '-rc', 'vbr', '-cq', '18', '-b:v', '0']],
  ['h264_amf', () => ['-quality', 'balanced', '-rc', 'cqp', '-qp_i', '17', '-qp_p', '19', '-qp_b', '21']],
  ['h264_qsv', () => ['-preset', 'fast', '-global_quality', '19']],
  ['libx264', big => big ? ['-preset', 'ultrafast', '-crf', '14'] : ['-preset', 'veryfast', '-crf', '16']]
];
const COLOR = ['-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv'];
function pickEncoder(width, height) {
  const big = width * height > 1920 * 1080 * 1.5;
  if (encoder) return [encoder[0], encoder[1](big)];
  for (const [name, make] of ENCODERS) {
    const args = make(big);
    try {
      const r = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', `color=c=black:s=${width}x${height}:r=30`, '-frames:v', '3', '-c:v', name, ...args, '-pix_fmt', 'yuv420p', '-f', 'null', '-'], {windowsHide: true, timeout: 15000});
      if (r.status === 0) { encoder = [name, make]; return [name, args]; }
    } catch (e) {}
  }
  encoder = ENCODERS[ENCODERS.length - 1];
  return [encoder[0], encoder[1](big)];
}

const video = {
  available: async () => { await ready; return !!findFfmpeg(); },
  choose: (suggested, title, kind) => ipcRenderer.invoke('video:choose', suggested, title, kind),
  show: file => ipcRenderer.invoke('video:show', file),
  /* Starts an encode. Frames arrive as NV12 pictures, top row first; `sound` is a WAV file's bytes. */
  async start({file, width, height, fps, sound}) {
    await ready;
    if (!findFfmpeg()) throw new Error('no-encoder');
    if (job) throw new Error('busy');
    const wav = path.join(paths.temp, `musicden-${process.pid}-${Date.now()}.wav`);
    fs.writeFileSync(wav, Buffer.from(sound.buffer, sound.byteOffset, sound.byteLength));
    const [name, args] = pickEncoder(width, height);
    const proc = spawn(ffmpeg, [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'rawvideo', '-pix_fmt', 'nv12', '-s', `${width}x${height}`, '-r', String(fps), ...COLOR, '-i', 'pipe:0',
      '-i', wav, '-map', '0:v', '-map', '1:a',
      '-c:v', name, ...args, '-pix_fmt', 'nv12', ...COLOR,
      '-c:a', 'aac', '-b:a', '256k', '-movflags', '+faststart', file
    ], {windowsHide: true, stdio: ['pipe', 'ignore', 'pipe']});
    const j = job = {proc, wav, file, log: '', failed: null, encoder: name};
    proc.stderr.on('data', d => { j.log = (j.log + d).slice(-2000); });
    proc.stdin.on('error', e => { j.failed = e; });
    j.done = new Promise(resolve => proc.on('close', code => resolve(code)));
    proc.on('error', e => { j.failed = e; });
    return name;
  },
  async finish() {
    const j = job;
    if (!j) return false;
    j.proc.stdin.end();
    const code = await j.done;
    job = null;
    try { fs.unlinkSync(j.wav); } catch (e) {}
    if (code !== 0 || j.failed) { try { fs.unlinkSync(j.file); } catch (e) {} throw new Error(j.log || 'encode'); }
    return true;
  },
  /* The saved video as bytes for the person's account, which takes files up to 50 MB. A bigger
     video is first made smaller: no larger than 1080p, at the bit rate that fits its length. */
  async forAccount(file, seconds) {
    await ready;
    const LIMIT = 48e6;
    if (fs.statSync(file).size <= LIMIT) return fs.readFileSync(file);
    if (!findFfmpeg()) throw new Error('no-encoder');
    const rate = Math.floor(LIMIT * 8 / Math.max(1, seconds) * 0.93) - 128000;
    if (rate < 250000) throw new Error('too-long');
    const side = rate < 1200000 ? 1280 : 1920, small = path.join(paths.temp, `musicden-${process.pid}-${Date.now()}.mp4`);
    const [name] = pickEncoder(1920, 1080), speed = name === 'h264_nvenc' ? ['-preset', 'p4', '-rc', 'vbr'] : name === 'libx264' ? ['-preset', 'veryfast'] : [];
    const r = await new Promise(done => {
      const p = spawn(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-i', file,
        '-vf', `scale='if(gt(iw,ih),min(${side},iw),-2)':'if(gt(iw,ih),-2,min(${side},ih))'`,
        '-c:v', name, ...speed, '-b:v', String(rate), '-maxrate', String(rate), '-bufsize', String(rate * 2), '-pix_fmt', 'yuv420p',
        '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', small], {windowsHide: true, stdio: 'ignore'});
      p.on('error', () => done(-1)); p.on('close', done);
    });
    try {
      if (r !== 0 || fs.statSync(small).size > 50e6) throw new Error('too-long');
      return fs.readFileSync(small);
    } finally { try { fs.unlinkSync(small); } catch (e) {} }
  },
  async cancel() {
    const j = job;
    if (!j) return;
    job = null;
    try { j.proc.stdin.destroy(); j.proc.kill(); } catch (e) {}
    await j.done;
    for (const f of [j.wav, j.file]) { try { fs.unlinkSync(f); } catch (e) {} }
  }
};

/* Frames arrive from the page through a port, so their memory is handed over instead of copied.
   Each buffer goes back to the page once the encoder has taken it. */
window.addEventListener('message', e => {
  if (e.source !== window || e.data !== 'frame-port' || !e.ports[0]) return;
  const port = e.ports[0];
  port.onmessage = m => {
    const bytes = m.data.bytes, j = job, back = failed => port.postMessage({bytes, failed}, [bytes]);
    if (!j || j.failed) { back(true); return; }
    j.proc.stdin.write(Buffer.from(bytes), err => back(!!err || !!j.failed));
  };
});

contextBridge.exposeInMainWorld('desk', {
  testing: !!process.env.MUSICDEN_TEST,
  library: {
    /* shows the songs of an account ({id, email}), or with nothing those added while signed out */
    open: async who => { await ready; under = await ipcRenderer.invoke('lib:open', who || null); account = !!(who && who.id); },
    /* moves the songs added while signed out over to the account now showing; gives each one's name before and after */
    adopt: () => ipcRenderer.invoke('lib:adopt'),
    record: () => ipcRenderer.invoke('lib:record'),
    keepRecord: record => ipcRenderer.invoke('lib:keepRecord', record),
    folder: () => ipcRenderer.invoke('lib:folder'),
    choose: (title, button) => ipcRenderer.invoke('lib:choose', title, button),
    list: () => ipcRenderer.invoke('lib:list'),
    read: name => ipcRenderer.invoke('lib:read', name),
    write: (name, bytes) => ipcRenderer.invoke('lib:write', name, bytes),
    pick: (title, button, kind) => ipcRenderer.invoke('lib:pick', title, button, kind),
    importFiles: files => ipcRenderer.invoke('lib:import', files.map(f => webUtils.getPathForFile(f)).filter(Boolean)),
    importPaths: list => ipcRenderer.invoke('lib:import', list),
    trash: name => ipcRenderer.invoke('lib:trash', name),
    rename: (from, to) => ipcRenderer.invoke('lib:rename', from, to),
    openFolder: () => ipcRenderer.invoke('lib:openFolder'),
    onChanged: fn => ipcRenderer.on('lib:changed', () => fn())
  },
  /* guitar tabs: an account's, or with no one signed in the ones made on this computer; each is a
     text of its own, known by an id */
  tabs: {
    /* shows the tabs of an account ({id, email}), or with nothing those made while signed out */
    open: who => ipcRenderer.invoke('tabs:open', who || null),
    /* moves the tabs made while signed out over to the account now showing; gives the ids of the ones moved */
    adopt: () => ipcRenderer.invoke('tabs:adopt'),
    list: () => ipcRenderer.invoke('tabs:list'),
    read: id => ipcRenderer.invoke('tabs:read', id),
    write: (id, text) => ipcRenderer.invoke('tabs:write', id, text),
    remove: id => ipcRenderer.invoke('tabs:remove', id),
    /* a recording chosen in the computer's Open dialog: its path, or '' */
    pick: (title, button, kind) => ipcRenderer.invoke('tabs:pick', title, button, kind),
    /* a link or a recording into a tab: resolves to {id} or {error} */
    transcribe: (source, title) => ipcRenderer.invoke('tabs:transcribe', source, title),
    cancel: () => ipcRenderer.invoke('tabs:cancel'),
    onStage: fn => ipcRenderer.on('tabs:stage', (e, stage) => fn(stage)),
    /* sheet music saved to a file chosen in the computer's Save dialog */
    chooseSave: (suggested, title, kind, ext) => ipcRenderer.invoke('tabs:chooseSave', suggested, title, kind, ext),
    saveText: (file, text) => ipcRenderer.invoke('tabs:saveText', file, text),
    savePdf: file => ipcRenderer.invoke('tabs:savePdf', file)
  },
  link: {
    start: (url, useCard) => ipcRenderer.invoke('link:start', url, useCard),
    transcriber: () => ipcRenderer.invoke('link:transcriber'),
    cancel: () => ipcRenderer.invoke('link:cancel'),
    onStage: fn => ipcRenderer.on('link:stage', (e, info) => fn(info))
  },
  sheet: {
    available: () => sheet.available(),
    engrave: job => sheet.engrave(job),
    hands: notes => sheet.hands(notes),
    /* engraved sheet music kept between runs, in the app's own data folder */
    saved: async (song, key) => { await ready; return sheet.saved(path.join(paths.userData, 'sheet-music'), song, key); },
    save: async (song, key, engraved) => { await ready; return sheet.save(path.join(paths.userData, 'sheet-music'), song, key, engraved); },
    /* sheet music saved as PDFs, kept in the app's data folder */
    print: async (name, job) => { await ready; return sheet.print(sheets(), name, job); },
    printed: async () => { await ready; return sheet.printed(sheets()); },
    pages: async name => { await ready; return sheet.pagesOf(sheets(), name); },
    unprint: async name => { await ready; return sheet.unprint(sheets(), name); },
    rename: async (from, to) => { await ready; return sheet.rename(sheets(), from, to); },
    show: file => ipcRenderer.invoke('video:show', file)
  },
  /* the saved sheet music as a sync sees it: each sheet is one file, the PDF and its pages together */
  sheets: {
    list: async () => { await ready; return sheet.kept(sheets()); },
    read: async name => { await ready; return sheet.bundle(sheets(), name); },
    write: async (name, bytes) => { await ready; return sheet.unbundle(sheets(), name, bytes); },
    /* a sheet the account no longer has goes to the Recycle Bin */
    trash: async name => {
      await ready;
      await ipcRenderer.invoke('sheet:trash', path.join(sheets(), own(name) + '.pdf'));
      await fs.promises.unlink(path.join(sheets(), name + '.pages')).catch(() => {});
    },
    record: async () => { await ready; return account ? sheet.record(sheets()) : null; },
    keepRecord: async what => { await ready; if (account) await sheet.keepRecord(sheets(), what); },
    /* moves the sheet music saved while signed out over to the account now showing; gives the names of the ones moved */
    adopt: async () => { await ready; return account ? sheet.adopt(loose(), sheets()).catch(() => []) : []; }
  },
  video
});
