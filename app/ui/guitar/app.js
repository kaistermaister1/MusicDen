/* Playback, the song list, turning a link or a file into a tab, the account, settings and editing. */
import {T, fill} from './strings.js';
import {TabView} from './tab.js';
import {Guitar} from './guitar.js';
import {deskStore, browserStore, siteShelf} from './store.js';
import {accountRow} from './account.js';
import * as cloud from './cloud.js';
import * as settings from './settings.js';
import {createEditor} from './edit.js';
import {createSheet} from './sheet.js';
import {openPrintView, downloadMusicXml, musicXml, fileNameOf} from './sheet-save.js';
import {SHEET} from './sheet-strings.js';
import {Learn} from './learn.js';
import {arrival} from './arrival.js';

const $ = id => document.getElementById(id);
const el = (tag, cls) => { const e = document.createElement(tag); if (cls) e.className = cls; return e; };
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const clock = s => { s = Math.max(0, Math.floor(s + 0.05)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
/* what is remembered between visits; a browser that refuses simply forgets */
const store = {
  get(k, d) { try { const v = localStorage.getItem('gt.' + k); return v == null ? d : v; } catch { return d; } },
  set(k, v) { try { localStorage.setItem('gt.' + k, String(v)); } catch { /* nothing is kept */ } }
};
const ICON = {
  play: '<svg viewBox="0 0 14 14" aria-hidden="true"><path d="M3 1.5v11l9.5-5.5z"/></svg>',
  pause: '<svg viewBox="0 0 14 14" aria-hidden="true"><path d="M2.5 1.5h3v11h-3zM8.5 1.5h3v11h-3z"/></svg>',
  restart: '<svg viewBox="0 0 14 14" aria-hidden="true"><path d="M2 1.5h2v11H2zM12.5 1.5v11L4.5 7z"/></svg>',
  remove: '<svg viewBox="0 0 14 14" aria-hidden="true"><path class="ln" d="M3.5 3.5l7 7M10.5 3.5l-7 7"/></svg>'
};
const SPEEDS = [50, 60, 75, 85, 100];
/* a small screen: the Songs and Settings panels are drawers over the tab */
const small = matchMedia('(max-width:700px),(max-height:500px)');

const app = $('app'), guitar = new Guitar(), look = settings.load(), learn = new Learn();
/* In the Windows app the desktop shell is there: tabs are files in a folder, and recordings can be
   turned into tabs. In a phone or browser there is none: tabs come from the account. */
const desk = window.desk || null, local = !!desk;
const testing = desk ? !!desk.testing : new URLSearchParams(location.search).has('test');
const tabs = local ? deskStore() : browserStore();   /* this device's tab store */
let acct = null;                   /* the account row */
const shelf = siteShelf();         /* the tabs that come with the app, for everyone who opens it */
let songs = [], song = null, songId = null, songText = '', notes = [], beats = [], dur = 0;
let playing = false, pos = 0, speed = 1;
let anchorClock = 0, anchorPos = 0; /* the audio clock read anchorClock when the song stood at anchorPos */
let nextNote = 0, nextBeat = 0, timer = 0, raf = 0, ready = Promise.resolve(), lock = null, busy = false;
let editing = false, saveTimer = 0;

const tab = new TabView($('tab'), {
  scrubStart() { resumeAfter = playing; pause(); },
  scrub(t) { seek(t); },
  scrubEnd() { if (resumeAfter) play(); },
  tap() {
    if (small.matches && !(app.classList.contains('hide-lib') && !app.classList.contains('show-insp'))) { showLib(false); showSettings(false); }
    else if (!editing) toggle();
  }
}, T.capo);
let resumeAfter = false;

/* ---------- playback ---------- */

function songTime() { return playing ? anchorPos + (guitar.now() - anchorClock) * speed : pos; }

/* Hands the guitar every note, and every click of the beat, that begins within the next quarter
   second of clock time. */
function schedule() {
  /* in learning mode the app is silent, so the microphone hears only the person playing */
  if (learn.on) return;
  const until = songTime() + 0.25 * speed, now = guitar.now();
  while (nextNote < notes.length && notes[nextNote].start_s < until) {
    const n = notes[nextNote++], when = anchorClock + (n.start_s - anchorPos) / speed;
    guitar.noteOn(Math.max(when, now), n.pitch, n.velocity == null ? 90 : n.velocity, n.string, n.ring / speed);
  }
  while (nextBeat < beats.length && beats[nextBeat].time_s < until) {
    const b = beats[nextBeat++], when = anchorClock + (b.time_s - anchorPos) / speed;
    if (look.click && when >= now - 0.01) guitar.click(Math.max(when, now), !!b.downbeat);
  }
}

const firstFrom = (list, key, t) => { let lo = 0, hi = list.length; while (lo < hi) { const m = (lo + hi) >> 1; if (list[m][key] < t - 1e-4) lo = m + 1; else hi = m; } return lo; };
function cue(t) { nextNote = firstFrom(notes, 'start_s', t); nextBeat = firstFrom(beats, 'time_s', t); }

async function play() {
  if (playing || !song || !notes.length) return;
  const mine = songId, waiting = learn.on ? T.learn.allow : T.soundLoading, wait = setTimeout(() => say(waiting), 350);
  const [, , mic] = await Promise.all([guitar.unlock(), learn.on ? null : ready, learn.on ? learn.open() : '']);
  clearTimeout(wait);
  if ($('msg').textContent === waiting) say('');
  if (mic) { say(T.learn[mic]); return; }
  if (playing || mine !== songId) return;
  if (pos >= dur - 0.05) pos = 0;
  playing = true; anchorPos = pos; anchorClock = guitar.now() + 0.08; cue(pos); learn.seek(pos);
  schedule();
  timer = setInterval(schedule, 50);
  raf = requestAnimationFrame(frame);
  playLook();
  if (navigator.wakeLock) navigator.wakeLock.request('screen').then(l => { if (playing) lock = l; else l.release(); }).catch(() => {});
}

/* Stops where the song stands. With hush off, notes already ringing are left to die away. */
function pause(hush = true) {
  if (!playing) return;
  pos = clamp(songTime(), 0, dur);
  playing = false; clearInterval(timer); cancelAnimationFrame(raf);
  if (hush) guitar.stopAll();
  if (lock) { lock.release().catch(() => {}); lock = null; }
  playLook(); paint(pos);
}

function toggle() { if (playing) pause(); else play(); }

function seek(t) {
  t = clamp(t, 0, dur);
  learn.seek(t);
  if (playing) { guitar.stopAll(); anchorPos = t; anchorClock = guitar.now() + 0.05; cue(t); schedule(); }
  else pos = t;
  paint(t);
}

/* While playing, the tab is drawn where the sound is now heard, which is a little behind the clock. */
function frame() {
  if (!playing) return;
  let t = songTime();
  /* in learning mode the song stands where the listening lets it, and goes on from there */
  if (learn.on) {
    if (learn.lost) { pause(); say(T.learn.lost); return; }
    t = learn.step(t, speed); anchorPos = t; anchorClock = guitar.now();
  }
  if (t >= dur) { pause(false); pos = dur; paint(dur); return; }
  paint(learn.on ? t : Math.max(0, t - guitar.latency() * speed));
  raf = requestAnimationFrame(frame);
}

function paint(t) {
  tab.draw(t);
  $('tcur').textContent = clock(t);
  $('ov').setAttribute('aria-valuenow', String(Math.round(t)));
  overview(t);
}

function playLook() {
  const b = $('play');
  b.innerHTML = playing ? ICON.pause : ICON.play;
  b.title = playing ? T.pause : T.play; b.setAttribute('aria-label', b.title);
}

/* ---------- the scrub bar: the whole song in miniature, a row for each string ---------- */

const ovc = $('ovc'), og = ovc.getContext('2d');
let ow = 1, oh = 1;
function sizeOverview() {
  const box = $('ov').getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
  ow = Math.max(1, Math.round(box.width)); oh = Math.max(1, Math.round(box.height));
  ovc.width = Math.round(ow * dpr); ovc.height = Math.round(oh * dpr);
  og.setTransform(dpr, 0, 0, dpr, 0, 0);
  overview(songTime());
}
function overview(t) {
  og.clearRect(0, 0, ow, oh);
  if (!song || !dur) return;
  const theme = settings.THEMES[look.theme], rows = (oh - 10) / 5, at = t / dur * ow;
  for (const n of notes) {
    const x = n.start_s / dur * ow;
    og.fillStyle = x <= at ? theme.ivory : theme.dim;
    og.globalAlpha = x <= at ? 1 : 0.6;
    og.fillRect(x, 4 + (n.string - 1) * rows, Math.max(1.5, (n.end_s - n.start_s) / dur * ow), 2);
  }
  og.globalAlpha = 1;
  og.fillStyle = theme.ivory; og.fillRect(Math.round(at), 0, 1, oh);
}
{
  const ov = $('ov'); let held = false, after = false;
  const to = e => { const box = ov.getBoundingClientRect(); seek(clamp((e.clientX - box.left) / box.width, 0, 1) * dur); };
  ov.addEventListener('pointerdown', e => {
    if (!song || e.button) return;
    held = true; after = playing; pause();
    try { ov.setPointerCapture(e.pointerId); } catch { /* the pointer is already gone */ }
    to(e);
  });
  ov.addEventListener('pointermove', e => { if (held) to(e); });
  const up = () => { if (!held) return; held = false; if (after) play(); };
  ov.addEventListener('pointerup', up); ov.addEventListener('pointercancel', up);
  ov.addEventListener('keydown', e => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); e.stopPropagation(); seek(songTime() + (e.key === 'ArrowLeft' ? -5 : 5)); }
  });
  new ResizeObserver(sizeOverview).observe(ov);
}

/* ---------- songs ---------- */

function say(text) { $('msg').textContent = text; }

function showLib(on) {
  app.classList.toggle('hide-lib', !on);
  $('libBtn').setAttribute('aria-expanded', String(on));
  if (on && small.matches) showSettings(false);
  if (!small.matches) store.set('lib', on ? 1 : 0);
}

/* A tab's text: this device's own copy, or failing that the copy that comes with the app. */
async function readTab(id) {
  try { return await tabs.read(id); } catch { return shelf.read(id); }
}

async function loadList() {
  let own = [], shared = [];
  try { own = await tabs.list(); } catch { own = []; }
  /* the tabs that come with the app follow the device's own, for everyone who opens it */
  try { shared = await shelf.list(); } catch { shared = []; }
  songs = [...own, ...shared.filter(s => !own.some(o => o.id === s.id)).map(s => ({...s, shared: true}))];
  renderList();
}

function renderList() {
  const ul = $('songs'); ul.textContent = '';
  for (const s of songs) {
    const li = el('li', 'song'), pick = el('button', 'pick'), name = el('span', 'name'), d = el('span', 'dur');
    if (s.id === songId) li.setAttribute('aria-current', 'true');
    pick.type = 'button'; name.textContent = s.title || s.id; d.textContent = clock(s.duration_s || 0);
    pick.append(name, d); pick.addEventListener('click', () => openSong(s.id));
    const rm = el('button', 'ib rm'); rm.type = 'button'; rm.innerHTML = ICON.remove;
    rm.title = fill(T.remove, {name: s.title || s.id}); rm.setAttribute('aria-label', rm.title);
    rm.addEventListener('click', () => removeSong(rm, s));
    /* a tab that comes with the app is not this device's to remove */
    if (s.shared) li.append(pick); else li.append(pick, rm);
    ul.append(li);
  }
  $('blank').textContent = song || songs.length ? '' : local ? T.empty : acct && acct.signedIn() ? T.emptyAccount : T.emptyPhone;
}

/* The first click asks, by turning the cross into the word; the second, within four seconds,
   removes the tab from this device and, at the next sync, from the account and other devices. */
async function removeSong(rm, s) {
  if (!rm.classList.contains('sure')) {
    rm.classList.add('sure'); rm.textContent = T.removeConfirm;
    setTimeout(() => { if (rm.isConnected) { rm.classList.remove('sure'); rm.innerHTML = ICON.remove; } }, 4000);
    return;
  }
  try { await tabs.remove(s.id); } catch { say(T.errRemove); return; }
  cloud.forget(s.id);
  say('');
  if (s.id === songId) closeSong();
  await loadList();
  if (!song && songs.length) openSong(songs[0].id);
  if (acct) acct.sync();
}

function closeSong() {
  pause();
  song = null; songId = null; songText = ''; notes = []; beats = []; dur = 0; pos = 0;
  editor.clear(); undoLook(); learn.setSong([]);
  tab.setSong(null);
  if (player.onSong) player.onSong(null);
  $('title').textContent = ''; $('tdur').textContent = clock(0);
  for (const id of ['play', 'restart', 'editBtn']) $(id).disabled = true;
  paint(0);
}

/* Works out, from the tab as it now stands, the notes to play and how long each rings. */
function derive() {
  const tuning = song.tuning || [];
  (song.notes || []).forEach((n, i) => { if (n.id == null) n.id = i; });
  notes = (song.notes || []).filter(n => n.string >= 1 && n.string <= 6 && n.fret != null)
    .map(n => ({...n, pitch: n.pitch == null ? (tuning[n.string - 1] || 0) + n.fret : n.pitch}))
    .sort((a, b) => a.start_s - b.start_s);
  /* a plucked string rings on after its written end: up to a second more, or until that string is played again */
  const nextOn = new Map();
  for (let i = notes.length - 1; i >= 0; i--) {
    const n = notes[i], next = nextOn.get(n.string);
    n.ring = (look.ring ? Math.max(n.end_s, Math.min(n.end_s + 1, next == null ? Infinity : next)) : n.end_s) - n.start_s;
    nextOn.set(n.string, n.start_s);
  }
  beats = (song.beats || []).filter(b => b && b.time_s != null).sort((a, b) => a.time_s - b.time_s);
  dur = notes.length ? notes.reduce((m, n) => Math.max(m, n.end_s), 0) + 0.5 : 0;
  if (playing) cue(songTime());
  learn.setSong(notes);
}

/* Opens a tab. With `keep`, the place in the song is kept, for a tab that changed while open. */
async function openSong(id, keep = false) {
  const at = keep ? songTime() : 0;
  pause();
  let data, text;
  try { text = await readTab(id); data = JSON.parse(text); } catch { say(T.errLoad); return false; }
  say('');
  song = data; songId = id; songText = text;
  editor.clear(); undoLook();
  derive();
  pos = clamp(at, 0, dur);
  tab.setSong(data);
  if (player.onSong) player.onSong(data);
  ready = guitar.load(notes.map(n => n.pitch));
  const entry = songs.find(s => s.id === id);
  $('title').textContent = data.title || (entry && entry.title) || '';
  $('tdur').textContent = clock(dur);
  $('ov').setAttribute('aria-valuemax', String(Math.round(dur)));
  for (const b of ['play', 'restart', 'editBtn']) $(b).disabled = !notes.length;
  store.set('last', id);
  renderList(); paint(pos);
  if (small.matches) showLib(false);
  return true;
}

/* After a sync that changed what is on this device: the list again, and the open tab again if it
   was replaced or taken away. */
async function afterSync() {
  await loadList();
  if (songId && !songs.some(s => s.id === songId)) closeSong();
  if (!song) { if (songs.length) await openSong(songs[0].id); return; }
  if (saveTimer) return;   /* a change made here is about to be saved; it wins */
  try { const text = await readTab(songId); if (text !== songText) await openSong(songId, true); } catch { /* the open copy stays */ }
}

/* ---------- a link or a file into a tab ---------- */

/* The line under the link: what is being done and for how long, with a button that stops it; or why it failed. */
function jobLine(text, bad, left) {
  const p = $('job'); p.classList.toggle('bad', !!bad);
  /* the line of work that is under way is changed where it stands, so its button is never taken away under a press */
  if (text && left && p.querySelector('#jobStop')) { p.querySelector('.what').textContent = text; p.querySelector('.left').textContent = left; return; }
  p.textContent = '';
  if (!text) return;
  const what = el('span', 'what'); what.textContent = text; p.append(what);
  if (left) {
    const l = el('span', 'left'), stop = el('button', 'tb');
    l.textContent = left; stop.type = 'button'; stop.id = 'jobStop'; stop.textContent = T.cancel;
    stop.addEventListener('click', () => { stop.disabled = true; desk.tabs.cancel(); });
    p.append(l, stop);
  }
}
function setBusy(on) {
  busy = on;
  for (const id of ['linkUrl', 'linkGo', 'fileBtn']) $(id).disabled = on;
}

/* Has the desktop shell turn a link, or a recording on this computer, into a tab. Each step is
   named as it is reached, with how long the work has taken so far, and the tab opens when it is
   done. `title` names the tab of a recording. */
let jobStage = '', showJob = null;
if (local) desk.tabs.onStage(s => { if (busy) { jobStage = s; if (showJob) showJob(); } });
async function transcribe(source, title) {
  if (busy || !local) return false;
  setBusy(true);
  const began = Date.now();
  jobStage = 'download';
  showJob = () => jobLine(T.stage[jobStage] || T.stage.download, false, clock((Date.now() - began) / 1000));
  showJob();
  const tick = setInterval(showJob, 1000);
  let r;
  try { r = await desk.tabs.transcribe(source, title || ''); } catch { r = {error: 'failed'}; }
  clearInterval(tick); showJob = null;
  let ok = false;
  if (r && r.id) { jobLine(''); await loadList(); await openSong(r.id); ok = true; if (acct) acct.sync(); }
  else if (r && r.error === 'cancelled') jobLine('');
  else jobLine({tools: T.errTools, download_failed: T.errDownload, no_guitar: T.errNoGuitar}[r && r.error] || T.errFailed, true);
  setBusy(false);
  return ok;
}

$('link').addEventListener('submit', async e => {
  e.preventDefault();
  const url = $('linkUrl').value.trim();
  if (!/^https?:\/\/\S+$/i.test(url)) { jobLine(T.errLinkBad, true); return; }
  if (await transcribe(url)) $('linkUrl').value = '';
});
/* a recording is chosen in the computer's own Open dialog; its tab is named after the file */
$('fileBtn').addEventListener('click', async () => {
  if (busy || !local) return;
  const file = await desk.tabs.pick(T.fileDialog, T.filePick, T.fileKind);
  if (file) transcribe(file, file.replace(/^.*[\\/]/, '').replace(/\.[^.]+$/, ''));
});

/* ---------- editing: a number dragged to another string, a note removed, either undone ---------- */

const editor = createEditor(() => song, () => {
  derive();
  tab.setSong(song, true);
  if (player.onSong) player.onSong(song);
  paint(songTime());
  undoLook();
  saveSoon();
});

/* Saves the open tab a moment after the last change, then syncs it to the account. */
let unsaved = null;
function saveSoon() {
  clearTimeout(saveTimer);
  unsaved = {id: songId, text: JSON.stringify(song)};
  saveTimer = setTimeout(saveNow, 700);
}
async function saveNow() {
  clearTimeout(saveTimer); saveTimer = 0;
  if (!unsaved) return;
  const {id, text} = unsaved;
  unsaved = null;
  try { await tabs.write(id, text); if (id === songId) songText = text; say(''); } catch { say(T.errSave); return; }
  /* a tab that came with the app and was changed here is now this device's own copy */
  if (songs.some(s => s.id === id && s.shared)) loadList();
  if (acct) acct.sync();
}
/* a change still waiting to be saved is saved as the page is left, as when the instrument is changed */
window.addEventListener('pagehide', () => { if (unsaved) saveNow(); });

function undoLook() { $('undoBtn').disabled = !editor.canUndo(); }

function setEditing(on) {
  editing = on && !!song;
  app.classList.toggle('editing', editing);
  $('editBtn').setAttribute('aria-pressed', String(editing));
  $('hint').textContent = editing ? T.editHint : '';
  tab.setEdit(editing ? {
    grab() { pause(); },
    try: (id, string) => editor.try(id, string),
    drop(id, string) { if (!editor.move(id, string)) { say(T.editNoRoom); setTimeout(() => { if ($('msg').textContent === T.editNoRoom) say(''); }, 2500); } }
  } : null);
  undoLook();
}

/* Moves the picked number one string up or down the page, past strings that cannot take it. */
function nudge(up) {
  const n = song && song.notes.find(x => x.id === tab.sel);
  if (!n) return;
  const step = (up ? -1 : 1) * (look.lowOnTop ? -1 : 1);
  for (let s = n.string + step; s >= 1 && s <= 6; s += step) if (editor.move(n.id, s)) return;
}

/* ---------- settings ---------- */

function showSettings(on) {
  app.classList.toggle('show-insp', on);
  $('setBtn').setAttribute('aria-expanded', String(on));
  if (on && small.matches) showLib(false);
}

/* Puts the settings to work; `key` names the one that changed, or is null for all of them. */
function applyLook(key) {
  const theme = settings.THEMES[look.theme];
  settings.paintPage(look);
  tab.setLook({...theme.tab, accent: look.accent, size: look.size / 100, spacing: look.spacing / 100,
    lowOnTop: look.lowOnTop, barNumbers: look.barNumbers, stringNames: look.stringNames});
  if ((key === 'ring' || key == null) && song) derive();
  overview(songTime());
  if (player.onLook) player.onLook();
}

/* ---------- controls ---------- */

document.title = T.appName;
$('libBtn').textContent = T.songs; $('libTitle').textContent = T.songs;
$('restart').innerHTML = ICON.restart; $('restart').title = T.restart; $('restart').setAttribute('aria-label', T.restart);
$('ov').setAttribute('aria-label', T.position);
$('speedLab').textContent = T.speed; $('volLab').textContent = T.volume;
$('linkUrl').placeholder = T.linkPlaceholder; $('linkUrl').setAttribute('aria-label', T.linkPlaceholder);
$('linkGo').textContent = T.linkGo; $('fileBtn').textContent = T.fileGo;
for (const [id, text] of [['editBtn', T.edit], ['undoBtn', T.undo], ['setBtn', T.settings]]) {
  $(id).querySelector('.lbl').textContent = text; $(id).title = text; $(id).setAttribute('aria-label', text);
}
playLook();

for (const p of SPEEDS) { const o = el('option'); o.value = String(p / 100); o.textContent = fill(T.percent, {n: p}); $('speed').append(o); }
speed = SPEEDS.includes(Math.round(+store.get('speed', 1) * 100)) ? +store.get('speed', 1) : 1;
$('speed').value = String(speed);
$('speed').addEventListener('change', () => {
  const t = songTime();
  speed = +$('speed').value; store.set('speed', speed);
  if (playing) { anchorPos = t; anchorClock = guitar.now(); }
});

const vol = $('vol');
const setVol = v => { vol.value = String(v); vol.style.setProperty('--p', v * 100 + '%'); guitar.setVolume(v * v * 1.25); };
setVol(clamp(+store.get('vol', 0.8) || 0, 0, 1));
vol.addEventListener('input', () => { setVol(+vol.value); store.set('vol', vol.value); });

$('play').addEventListener('click', toggle);
$('restart').addEventListener('click', () => seek(0));
$('libBtn').addEventListener('click', () => showLib(app.classList.contains('hide-lib')));
$('setBtn').addEventListener('click', () => showSettings(!app.classList.contains('show-insp')));
$('editBtn').addEventListener('click', () => setEditing(!editing));
$('undoBtn').addEventListener('click', () => editor.undo());
const panel = settings.settingsPanel($('insp'), look, applyLook);
/* What other parts of the app (the sheet music) build on. `onSong(song)` is called when a tab is
   opened, closed (with null) or edited; `onLook()` after a setting changes. */
export const player = {tab, look, panel, themes: settings.THEMES, song: () => song, time: songTime, onSong: null, onLook: null};

/* ---------- sheet music: a staff above the tab, sharing its line and playhead ---------- */

const sheet = createSheet($('sheet'));
let showSheet = store.get('sheet', '0') === '1';
/* the staff takes its places from the tab, so every notehead and bar line stands over its own */
sheet.setAxis(s => tab.xOf(s), {columnX: s => tab.columnX(s), barX: n => tab.barX(n)});
tab.onDraw = t => { if (showSheet && song) sheet.draw(t, tab.w, tab.frameOf(t).head, tab.fs * 1.1); };
player.onSong = s => { try { sheet.setSong(s); } catch { sheet.setSong(null); } };
player.onLook = () => {
  const th = settings.THEMES[look.theme].tab, a = look.accent;
  sheet.setTheme({bg: th.bg, line: th.string, ink: th.ink, dim: th.dim, accent: a,
    head: `rgba(${parseInt(a.slice(1, 3), 16)},${parseInt(a.slice(3, 5), 16)},${parseInt(a.slice(5, 7), 16)},.24)`});
  tab.draw(songTime());
};
function setSheet(on) {
  showSheet = on; store.set('sheet', on ? 1 : 0);
  app.classList.toggle('show-sheet', on);
  $('sheetBtn').setAttribute('aria-pressed', String(on));
  /* the tab makes room for the band and is drawn again beneath it */
  tab.headroom = on ? sheet.height : 0; tab.sp = 0; tab.resize();
}
{
  $('sheetBtn').querySelector('.lbl').textContent = SHEET.show; $('sheetBtn').title = SHEET.show; $('sheetBtn').setAttribute('aria-label', SHEET.show);
  $('sheetBtn').addEventListener('click', () => setSheet(!showSheet));
  /* In the Windows app sheet music is saved through the computer's own Save dialog: the pages as
     a PDF from the view that lays them out, the MusicXML straight away. A check names its file itself. */
  const saveAs = async (s, ext, kind, write) => {
    const file = testing && window.gtSaveFile ? window.gtSaveFile : await desk.tabs.chooseSave(fileNameOf(s) + '.' + ext, SHEET.saveTitle, kind, ext);
    if (!file) return;
    try { await write(file); say(''); } catch { say(SHEET.errSave); }
  };
  const pages = s => openPrintView(s, local ? () => saveAs(s, 'pdf', SHEET.pdfKind, file => desk.tabs.savePdf(file)) : null);
  const xml = s => (local ? saveAs(s, 'musicxml', SHEET.xmlKind, file => desk.tabs.saveText(file, musicXml(s))) : downloadMusicXml(s));
  const sec = panel.section(SHEET.settingsHead), acts = el('div', 'set-acts');
  for (const [text, run] of [[SHEET.savePdf, pages], [SHEET.saveXml, xml]]) {
    const b = el('button', 'tb'); b.type = 'button'; b.textContent = text;
    b.addEventListener('click', () => { if (song) run(song); });
    acts.append(b);
  }
  sec.append(acts);
}
/* ---------- learning mode: the tab waits at each note until the microphone hears it played ---------- */
{
  const sec = panel.section(T.learn.head), box = el('input'), note = el('p', 'set-note');
  box.type = 'checkbox'; box.checked = learn.on = store.get('learn', '0') === '1';
  panel.row(sec, T.learn.name, box);
  note.textContent = T.learn.note; sec.append(note);
  /* turning it on asks for the microphone there and then, so a refusal shows at once */
  box.addEventListener('change', async () => {
    pause();
    learn.on = box.checked; store.set('learn', learn.on ? 1 : 0);
    if (!learn.on) { learn.close(); say(''); return; }
    const why = await learn.open();
    if (why) { learn.on = box.checked = false; store.set('learn', 0); }
    say(why ? T.learn[why] : '');
  });
}
applyLook(null);
setSheet(showSheet);

document.addEventListener('keydown', e => {
  if (e.target instanceof HTMLInputElement && e.target.type !== 'range' || e.target instanceof HTMLSelectElement) return;
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { if (editing) { e.preventDefault(); editor.undo(); } return; }
  if (editing && tab.sel != null && (e.key === 'Delete' || e.key === 'Backspace')) { e.preventDefault(); editor.remove(tab.sel); return; }
  if (editing && tab.sel != null && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) { e.preventDefault(); nudge(e.key === 'ArrowUp'); return; }
  if (e.key === 'Escape' && editing) { setEditing(false); return; }
  if (e.code === 'Space') { e.preventDefault(); if (!(e.target instanceof HTMLButtonElement) || e.target.id === 'play') toggle(); else e.target.click(); }
  else if (e.key === 'Home') seek(0);
  else if (e.key === 'ArrowLeft') seek(songTime() - 2);
  else if (e.key === 'ArrowRight') seek(songTime() + 2);
});
/* the screen is allowed to sleep again when the page is put away, and kept awake again on return */
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && playing && navigator.wakeLock && !lock) navigator.wakeLock.request('screen').then(l => { if (playing) lock = l; else l.release(); }).catch(() => {});
  else if (document.visibilityState !== 'visible') { lock = null; if (learn.on) { pause(); learn.close(); } }
});
if (document.fonts && document.fonts.load) document.fonts.load('500 12px "IBM Plex Sans Condensed"').then(() => tab.draw(songTime())).catch(() => {});

/* ---------- start ---------- */

/* What a check reaches the page through. */
if (testing) {
  window.gt = {
    T, cloud, tab, guitar, look, tabs, ready: false,
    get songs() { return songs; }, get song() { return song; }, get current() { return songId; },
    get playing() { return playing; }, get busy() { return busy; }, get account() { return acct; },
    get message() { return $('msg').textContent; }, get job() { return $('job').textContent; },
    now: songTime, play, pause, seek, openSong, loadList, transcribe
  };
}

(async () => {
  document.documentElement.classList.toggle('hosted', !local);
  /* in a phone or browser the app is kept on the device by the same worker the piano's page starts */
  if (!local && navigator.serviceWorker && window.isSecureContext) navigator.serviceWorker.register('../sw.js').catch(() => {});
  closeSong();
  /* the tabs of whoever is signed in are the ones showing, or with no one signed in the tabs made on this device */
  try { await tabs.open(cloud.account()); } catch { /* the list says what it can */ }
  await loadList();
  const last = store.get('last', ''), first = songs.find(s => s.id === last) || songs[0];
  const opened = first ? await openSong(first.id) : false;
  showLib(small.matches ? !opened : !opened || store.get('lib', '1') !== '0');
  /* a change still on its way to a tab's file is saved before the tabs change hands, to the tabs it belongs with */
  acct = accountRow($('acct'), {...tabs, open: async who => { await saveNow(); await tabs.open(who); }}, afterSync);
  renderList();
  if (testing) window.gt.ready = true;
  /* coming from the welcome page, the dark sheet now lifts off the page; then someone new to the app is shown round it */
  arrival.lift().catch(() => {}).then(() => import('../tour.js')).then(m => m.begin('guitar')).catch(() => {});
})();
