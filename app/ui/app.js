import {T, fill} from './strings.js';
import {S, save, clamp, PALETTES, EXTRA, LIVE_COLOR} from './settings.js';
import {parseMidi, writeMidi, isEdited} from './midi.js';
import {preludeMidi} from './demo.js';
import {SampleBank, Piano, renderWav} from './piano.js';
import {Stage} from './stage.js';
import {inspectorHtml, shown, esc, ICON} from './inspector.js';
import {Sheet} from './sheet.js';
import {renaming} from './rename.js';
import * as folders from './folders.js';
import * as owner from './owner.js';
import {install} from './offline.js';

const desk = window.desk;
const $ = id => document.getElementById(id);
const clock = () => performance.now() / 1000;
const clockText = s => { s = Math.max(0, Math.floor(s)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
document.title = T.appName;

const app = document.querySelector('.app'), stageEl = $('stage'), canvas = $('glc'), insp = $('insp');
const stage = new Stage(canvas);
let piece = null, dirty = true, busy = false;
const sheet = new Sheet($('sheet'), {seek: t => seek(t), now: () => now(), redraw: () => { dirty = true; }});

/* ---------- sound ---------- */
const bank = new SampleBank('../assets/piano/');
let audio = null, piano = null;
function ensureAudio() {
  if (!audio) {
    try { audio = new AudioContext({latencyHint: 'interactive', sampleRate: 48000}); }
    catch (e) { try { audio = new AudioContext(); } catch (e2) { return false; } }
    piano = new Piano(audio, bank, S.volume);
  }
  if (audio.state === 'suspended') audio.resume().catch(() => {});
  return true;
}
ensureAudio();
bank.init().then(ok => { if (ok) { bank.warm(); if (piece) bank.prepare(piece.notes); } });

/* ---------- playback clock ---------- */
/* While sound is running the piece follows the sound card's clock, so what is seen lands with what is heard. */
let playing = false, speed = 1;
let tAnchor = 0, wallAnchor = 0, ctxAnchor = 0, onAudio = false, nextIdx = 0, timer = 0, skew = null;
function heard() {
  const ts = audio.getOutputTimestamp();
  if (!ts.performanceTime) return audio.currentTime - (audio.outputLatency || 0) - (audio.baseLatency || 0);
  const o = ts.contextTime - ts.performanceTime / 1000;
  if (skew === null || Math.abs(o - skew) > 0.05) skew = o; else skew += (o - skew) * 0.05;
  return clock() + skew;
}
const now = () => !playing ? tAnchor : onAudio ? Math.max(tAnchor, tAnchor + (heard() - ctxAnchor) * speed) : tAnchor + (clock() - wallAnchor) * speed;
function schedule() {
  if (!onAudio) return;
  const a = piece.notes, at = audio.currentTime, until = tAnchor + (at - ctxAnchor) * speed + 0.2 * speed;
  while (nextIdx < a.length && a[nextIdx].start < until) {
    const n = a[nextIdx++];
    if (piece.tracks[n.track].muted) continue;
    const when = ctxAnchor + (n.start - tAnchor) / speed;
    if (when < at - 0.05) continue;
    piano.start(n.midi, n.vel, Math.max(when, at), (n.soundEnd - n.start) / speed);
  }
}
function anchor(t) {
  tAnchor = t; wallAnchor = clock();
  onAudio = !!audio && audio.state === 'running';
  if (onAudio) { ctxAnchor = audio.currentTime + 0.03; skew = null; }
  nextIdx = stage.firstFrom(t); stage.lastT = t;
}
function play() {
  if (busy) return;
  ensureAudio();
  let t = tAnchor;
  if (t >= piece.duration) t = 0;
  if (t <= 0) t = -0.7;
  playing = true; anchor(t);
  /* where sound may only start after a tap (phones), the piece is re-timed to the sound once it is running */
  if (audio && audio.state !== 'running') audio.resume().then(() => { if (playing && !onAudio) { anchor(now()); schedule(); } }).catch(() => {});
  clearInterval(timer); timer = setInterval(schedule, 25); schedule();
  syncPlayButton();
}
function pause(ring) {
  tAnchor = Math.max(0, now()); playing = false;
  clearInterval(timer);
  if (piano && !ring) piano.silence();
  syncPlayButton(); dirty = true;
}
function seek(t) {
  if (busy) return;
  t = clamp(t, 0, piece.duration);
  if (piano) piano.silence();
  if (playing) anchor(t); else { tAnchor = t; stage.lastT = t; }
  dirty = true;
}

/* ---------- the piece on stage ---------- */
const DEMO = ':built-in', NONE = ':none';
let currentId = S.demo ? DEMO : NONE;
function loadDemo() { const p = parseMidi(preludeMidi(T.rightHand, T.leftHand), T.demoTitle); p.by = T.demoBy; return p; }
/* The stage with nothing on it, for when the song list is empty. */
function emptyPiece() {
  const hand = name => ({name, src: null, ch: 0, count: 0, muted: false});
  return {title: '', by: '', notes: [], tracks: [hand(T.rightHand), hand(T.leftHand)], duration: 0, longest: 0, soundEnd: 0, lo: 60, hi: 72, fitLo: 48, fitHi: 84, source: null};
}
/* True when the song on stage is a file in the song folder. */
const onDisk = () => currentId !== DEMO && currentId !== NONE;
const undo = [];
function setPiece(p) {
  if (playing) pause();
  piece = p;
  applyPalette(S.palette >= 0 ? S.palette : 0, true);
  tAnchor = 0; nextIdx = 0; undo.length = 0;
  if (S.editHands) secondHand();
  $('title').textContent = p.title; $('by').textContent = p.by;
  $('tdur').textContent = clockText(p.duration);
  $('ov').setAttribute('aria-valuemax', Math.round(p.duration));
  stage.setPiece(p); sheet.setPiece(p, currentId); buildInspector(); ovDirty = true; dirty = true;
  if (bank.ready) bank.prepare(p.notes);
}
function applyPalette(i, onLoad) {
  const pal = PALETTES[i];
  piece.tracks.forEach((tr, j) => { tr.color = j < 2 ? pal[j] : EXTRA[(j - 2) % EXTRA.length]; });
  if (!onLoad) { S.palette = i; S.single = pal[0]; }
}
const liveColorOf = m => S.colorBy === 'pitch' ? S.pitch[m % 12] : S.colorBy === 'one' ? S.single : LIVE_COLOR;

/* ---------- playing by hand ---------- */
const liveHeld = new Map();
function liveOn(midi, vel) {
  if (midi < 21 || midi > 108 || liveHeld.has(midi)) return;
  const note = stage.liveOn(midi, liveColorOf(midi), vel, clock());
  if (ensureAudio()) { note.voice = piano.start(midi, vel, audio.currentTime); note.voice.live = true; }
  liveHeld.set(midi, note); dirty = true;
}
function liveOff(midi) {
  const note = liveHeld.get(midi);
  if (!note) return;
  liveHeld.delete(midi); note.end = clock();
  if (note.voice) piano.lift(note.voice);
}

/* Where a pointer is inside an element, in the element's own pixels. On a phone held upright the
   whole app is turned a quarter to stay in landscape, so across the element runs down the screen. */
function within(el, e) {
  const r = el.getBoundingClientRect();
  return document.documentElement.classList.contains('turned') ? [e.clientY - r.top, r.right - e.clientX] : [e.clientX - r.left, e.clientY - r.top];
}

/* ---------- stage size ---------- */
function resize() {
  if (busy) return;
  /* the element's own size, which stays the same when the phone layout turns the app on its side */
  const r = {width: stageEl.clientWidth, height: stageEl.clientHeight};
  if (r.width < 2 || r.height < 2) return;
  /* on a phone the picture is never wider than 16:9; it sits in the middle and the rest stays black */
  const wide = document.documentElement.classList.contains('compact') ? Math.min(r.width, Math.round(r.height * 16 / 9)) : r.width;
  canvas.style.width = wide < r.width ? wide + 'px' : '';
  canvas.style.left = wide < r.width ? (r.width - wide) / 2 + 'px' : '';
  stage.setSize(wide, r.height, Math.min(2, window.devicePixelRatio || 1));
  ovW = $('ov').clientWidth; ovH = $('ov').clientHeight; ovDpr = Math.min(2, window.devicePixelRatio || 1);
  ovc.width = Math.max(1, Math.round(ovW * ovDpr)); ovc.height = Math.max(1, Math.round(ovH * ovDpr));
  dirty = true; ovDirty = true;
}

/* ---------- scrub bar: the whole piece drawn small ---------- */
const ovc = $('ovc'), og = ovc.getContext('2d');
let ovW = 0, ovH = 0, ovDpr = 1, ovDirty = true, ovLayer = null;
function buildOverview() {
  ovLayer = document.createElement('canvas');
  ovLayer.width = ovc.width; ovLayer.height = ovc.height;
  const c = ovLayer.getContext('2d');
  c.setTransform(ovDpr, 0, 0, ovDpr, 0, 0);
  const span = Math.max(12, piece.hi - piece.lo);
  for (const n of piece.notes) {
    c.fillStyle = stage.colorOf(n);
    c.fillRect(n.start / piece.duration * ovW, ovH - 4 - (n.midi - piece.lo) / span * (ovH - 7), Math.max(1.2, (n.end - n.start) / piece.duration * ovW), 1.6);
  }
  ovDirty = false;
}
/* The scrub bar zoomed in: its whole width is a few seconds either side of a moment, which is
   the playing position, or where a drag began while the bar is being dragged. */
function drawFine(t) {
  const span = S.fineSpan, mid = scrubbing ? fineCenter : clamp(t, 0, piece.duration), from = mid - span, perSec = ovW / (span * 2);
  const high = Math.max(12, piece.hi - piece.lo), a = piece.notes;
  og.setTransform(ovDpr, 0, 0, ovDpr, 0, 0);
  og.clearRect(0, 0, ovW, ovH);
  for (let i = stage.firstFrom(from - piece.longest); i < a.length && a[i].start < mid + span; i++) {
    const n = a[i];
    if (n.end < from) continue;
    og.globalAlpha = n.start <= t ? 1 : 0.34;
    og.fillStyle = stage.colorOf(n);
    og.fillRect((n.start - from) * perSec, ovH - 4 - (n.midi - piece.lo) / high * (ovH - 7), Math.max(1.5, (n.end - n.start) * perSec), 2);
  }
  og.globalAlpha = 1; og.fillStyle = '#ece6d6';
  og.fillRect(Math.round((t - from) * perSec) - 0.5, 0, 1, ovH);
}
function drawOverview(t) {
  if (S.fine && fineOn()) { drawFine(t); return; }
  if (ovDirty) buildOverview();
  const px = clamp(t / piece.duration, 0, 1) * ovW;
  og.setTransform(1, 0, 0, 1, 0, 0);
  og.clearRect(0, 0, ovc.width, ovc.height);
  og.globalAlpha = 0.34; og.drawImage(ovLayer, 0, 0);
  og.globalAlpha = 1;
  og.save(); og.beginPath(); og.rect(0, 0, px * ovDpr, ovc.height); og.clip(); og.drawImage(ovLayer, 0, 0); og.restore();
  og.fillStyle = '#ece6d6'; og.fillRect(Math.round(px * ovDpr) - ovDpr / 2, 0, ovDpr, ovc.height);
}

/* ---------- settings column ---------- */
let midiStatus = '';
/* What transcribing can run on here ({tools, card}); null until the transcriber has been asked.
   It is asked when Settings is first shown or a link is first given, since the answer takes a few
   seconds; an answer that the programs are missing is asked for again, in case they were installed since. */
let transcriber = null, asking = false;
function askTranscriber() {
  if (asking || (transcriber && transcriber.tools) || document.documentElement.classList.contains('web')) return;
  asking = true;
  desk.link.transcriber().then(t => { transcriber = t; }, () => {}).then(() => { asking = false; buildInspector(); });
}
function buildInspector() {
  const at = insp.scrollTop;
  insp.innerHTML = inspectorHtml({piece, builtIn: currentId === DEMO, midiStatus, busy, folder, transcriber, cardNow: cardNow()});
  insp.scrollTop = at;
}
insp.addEventListener('input', e => {
  const el = e.target;
  if (el.dataset.k) {
    const k = el.dataset.k, v = parseFloat(el.value);
    S[k] = v;
    el.style.setProperty('--p', (v - el.min) / (el.max - el.min) * 100 + '%');
    $('o-' + k).textContent = shown(k, v);
    if (k === 'tilt') stage.layout();
  } else if (el.dataset.c) {
    const [kind, idx] = el.dataset.c.split(':');
    if (kind === 'bg') S.bg = el.value;
    else if (kind === 'single') S.single = el.value;
    else if (kind === 'pitch') S.pitch[+idx] = el.value;
    else if (kind === 'track') { piece.tracks[+idx].color = el.value; S.palette = -1; insp.querySelectorAll('.pal').forEach(b => b.setAttribute('aria-pressed', 'false')); }
    ovDirty = true;
  } else return;
  save(); dirty = true;
});
insp.addEventListener('click', e => {
  const el = e.target.closest('button');
  if (!el) return;
  if (el.dataset.seg) {
    const k = el.dataset.seg;
    S[k] = el.dataset.v;
    if (k === 'range' || k === 'view') { stage.parts.length = 0; stage.layout(); }
    if (k === 'colorBy') ovDirty = true;
    buildInspector();
    const again = insp.querySelector(`[data-seg="${k}"][data-v="${el.dataset.v}"]`);
    if (again) again.focus();
  } else if (el.dataset.sw) {
    const k = el.dataset.sw;
    S[k] = !S[k];
    if (k === 'sparks' || k === 'editHands' || k === 'noteNames') {
      if (!S.sparks) stage.parts.length = 0;
      if (k === 'editHands' && S.editHands) { secondHand(); if (S.colorBy !== 'track') { S.colorBy = 'track'; ovDirty = true; } }
      buildInspector();
      const again = insp.querySelector(`[data-sw="${k}"]`); if (again) again.focus();
    } else { el.setAttribute('aria-checked', String(S[k])); if (k === 'octaveLabels') stage.refresh(); }
  } else if (el.dataset.mute) {
    const tr = piece.tracks[+el.dataset.mute];
    tr.muted = !tr.muted;
    el.setAttribute('aria-pressed', String(tr.muted)); el.innerHTML = tr.muted ? ICON.muted : ICON.sound;
  } else if (el.dataset.pal) {
    applyPalette(+el.dataset.pal); ovDirty = true; buildInspector();
    const again = insp.querySelector(`[data-pal="${el.dataset.pal}"]`);
    if (again) again.focus();
  } else if (el.id === 'copy') {
    saveCopy();
  } else if (el.id === 'video') {
    saveVideo();
  } else if (el.id === 'sheetPdf') {
    savePdf(el);
  } else if (el.id === 'folderBtn') {
    chooseFolder();
  } else if (el.id === 'where') {
    desk.library.openFolder();
  } else if (el.id === 'install') {
    install();
  } else return;
  save(); dirty = true;
});

/* ---------- MIDI keyboard ---------- */
/* One message from a MIDI keyboard: a key going down or up, or the sustain pedal. */
function midiIn(data) {
  const [st, a, b] = data, kind = st & 0xf0;
  if (kind === 0x90 && b > 0) liveOn(a, b / 127);
  else if (kind === 0x80 || kind === 0x90) liveOff(a);
  else if (kind === 0xb0 && a === 64 && ensureAudio()) piano.pedal(b >= 64);
}
function setMidiStatus(text) { midiStatus = text; const el = $('midiStatus'); if (el) el.textContent = text; }
function connectMidi() {
  if (!navigator.requestMIDIAccess) { setMidiStatus(T.midiFail); return; }
  navigator.requestMIDIAccess().then(access => {
    const attach = () => {
      const names = [];
      access.inputs.forEach(input => {
        if (input.state !== 'connected') return;
        names.push(input.name || 'MIDI');
        input.onmidimessage = ev => midiIn(ev.data);
      });
      setMidiStatus(names.length ? fill(T.connected, {name: names.join(', ')}) : T.noDevice);
    };
    attach(); access.onstatechange = attach;
  }).catch(() => setMidiStatus(T.midiFail));
}

/* ---------- top strip ---------- */
const playBtn = $('play');
function syncPlayButton() {
  playBtn.innerHTML = playing ? ICON.pause : ICON.play;
  playBtn.setAttribute('aria-label', playing ? T.pause : T.play);
  playBtn.title = playing ? T.pause : T.play;
  /* the page as a whole says whether a song is playing, for the phone layout to keep the screen on */
  document.documentElement.classList.toggle('playing', playing);
}
$('restart').innerHTML = ICON.restart; $('restart').setAttribute('aria-label', T.restart); $('restart').title = T.restart;
$('ov').setAttribute('aria-label', T.position);
$('speedLab').textContent = T.speed; $('volLab').textContent = T.volume;
$('drop').textContent = T.drop;
$('libBtn').textContent = T.songs; $('lookBtn').textContent = T.settings; $('sheetBtn').textContent = T.sheet;
$('libTitle').textContent = T.songs; $('add').textContent = T.add;
function syncPanels() {
  app.classList.toggle('hide-lib', !S.libOpen); app.classList.toggle('hide-insp', !S.lookOpen);
  $('libBtn').setAttribute('aria-expanded', String(S.libOpen)); $('lookBtn').setAttribute('aria-expanded', String(S.lookOpen));
  $('sheetBtn').setAttribute('aria-expanded', String(S.sheetOpen)); sheet.setOpen(S.sheetOpen);
}
$('libBtn').addEventListener('click', () => { S.libOpen = !S.libOpen; save(); syncPanels(); });
$('lookBtn').addEventListener('click', () => { S.lookOpen = !S.lookOpen; save(); syncPanels(); if (S.lookOpen) askTranscriber(); });
$('sheetBtn').addEventListener('click', () => { S.sheetOpen = !S.sheetOpen; save(); syncPanels(); });
syncPanels();
$('speed').innerHTML = [0.5, 0.75, 1, 1.25, 1.5].map(v => `<option value="${v}"${v === 1 ? ' selected' : ''}>${Math.round(v * 100)}%</option>`).join('');
const vol = $('vol');
vol.value = S.volume; vol.style.setProperty('--p', S.volume * 100 + '%');

playBtn.addEventListener('click', () => playing ? pause() : play());
$('restart').addEventListener('click', () => { seek(0); if (playing) anchor(-0.7); });
$('speed').addEventListener('change', e => {
  const t = now(); speed = parseFloat(e.target.value);
  if (playing) { piano && piano.silence(); anchor(t); }
});
vol.addEventListener('input', () => {
  S.volume = parseFloat(vol.value); vol.style.setProperty('--p', S.volume * 100 + '%');
  if (piano) piano.setVolume(S.volume); save();
});

const ov = $('ov');
let scrubbing = false;
/* Fine scrubbing is offered where the bar is short and fingers are coarse: in the phone version. */
const fineBtn = $('fineBtn'), fineOn = () => document.documentElement.classList.contains('web');
let fineCenter = 0;
const scrubTo = e => {
  const [x] = within(ov, e), part = x / ov.clientWidth;
  seek(S.fine && fineOn() ? fineCenter + (part - 0.5) * 2 * S.fineSpan : part * piece.duration);
};
function syncFine() { fineBtn.setAttribute('aria-pressed', String(S.fine)); }
fineBtn.innerHTML = ICON.zoom; fineBtn.title = T.fineScrub; fineBtn.setAttribute('aria-label', T.fineScrub);
if (!fineOn()) fineBtn.style.display = 'none';
fineBtn.addEventListener('click', () => { S.fine = !S.fine; save(); syncFine(); dirty = true; });
syncFine();
ov.addEventListener('pointerdown', e => { fineCenter = clamp(now(), 0, piece.duration); scrubbing = true; ov.setPointerCapture(e.pointerId); scrubTo(e); });
ov.addEventListener('pointermove', e => { if (scrubbing) scrubTo(e); });
ov.addEventListener('pointerup', () => { scrubbing = false; dirty = true; });
ov.addEventListener('pointercancel', () => { scrubbing = false; dirty = true; });
ov.addEventListener('keydown', e => {
  if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { seek(now() + (e.key === 'ArrowRight' ? 5 : -5)); e.preventDefault(); }
  else if (e.key === 'Home') { seek(0); e.preventDefault(); }
});

/* ---------- song library: MIDI files in a folder on disk, or in the browser's storage on a phone ---------- */
const msg = $('msg');
let msgTimer = 0;
function say(text) { msg.textContent = text; clearTimeout(msgTimer); if (text) msgTimer = setTimeout(() => { msg.textContent = ''; }, 7000); }

const songList = $('songs'), sorter = new Intl.Collator(undefined, {numeric: true, sensitivity: 'base'});
const titleOf = name => name.replace(/\.(mid|midi)$/i, '');
let folder = '', songs = [], picked = false;
/* How long each song runs, remembered against the file's size and date so files are only read once. */
const LENGTHS = 'piano-visualizer-lengths';
let lengths = {};
try { lengths = JSON.parse(localStorage.getItem(LENGTHS) || '{}') || {}; } catch (e) {}
const stamp = s => s.size + ':' + Math.round(s.changed);
const reader = n => fill(T.trackN, {n});

let renderLater = 0;
function renderSongs() {
  /* a name being typed in the list, or a song being dragged, is not wiped by a redraw: the list is drawn once that is over */
  clearTimeout(renderLater);
  if (songList.querySelector('.rename') || songList.classList.contains('dragging')) { renderLater = setTimeout(renderSongs, 250); return; }
  const row = (id, title, dur, tip) =>
    `<li class="song" data-id="${esc(id)}"${id === currentId ? ' aria-current="true"' : ''}><button type="button" class="pick"${tip ? ` title="${T.renameTip}"` : ''}><span class="name">${esc(title)}</span><span class="dur">${dur == null ? '' : clockText(dur)}</span></button>` +
    `<button type="button" class="ib rm"${tip ? ` title="${tip}"` : ''} aria-label="${esc(fill(T.remove, {name: title}))}">${ICON.x}</button></li>`;
  const lengthOf = new Map(songs.map(s => [s.name, s.duration]));
  /* for someone signed in, removing a song takes it out of the account as well */
  const tip = document.documentElement.classList.contains('signed-in') ? T.removeTipAccount : T.removeTip;
  songList.innerHTML = folders.listHtml(songs.map(s => s.name), name => row(name, titleOf(name), lengthOf.get(name), tip), S.demo ? row(DEMO, T.demoTitle, demoLength, '') : '', currentId);
  $('libNote').textContent = songs.length ? '' : T.addHint;
}
async function measure() {
  for (const s of songs) {
    if (s.duration != null) continue;
    try { s.duration = parseMidi(await desk.library.read(s.name), '', reader).duration; }
    catch (e) { s.duration = 0; }
    lengths[s.name] = [stamp(s), s.duration];
    const el = songList.querySelector(`[data-id="${CSS.escape(s.name)}"] .dur`);
    if (el) el.textContent = clockText(s.duration);
  }
  const keep = {};
  for (const s of songs) if (lengths[s.name]) keep[s.name] = lengths[s.name];
  lengths = keep;
  try { localStorage.setItem(LENGTHS, JSON.stringify(lengths)); } catch (e) {}
}
let listing = Promise.resolve();
function refreshSongs() {
  listing = listing.then(async () => {
    const was = folder;
    folder = await desk.library.folder();
    if (folder !== was) buildInspector();
    const rows = folder ? await desk.library.list() : [];
    rows.sort((a, b) => sorter.compare(a.name, b.name));
    for (const s of rows) { const known = lengths[s.name]; s.duration = known && known[0] === stamp(s) ? known[1] : null; }
    songs = rows;
    if (currentId === NONE) { if (songs.length) await showSomething(); }
    else if (onDisk() && !songs.some(s => s.name === currentId)) {
      /* the song on stage is missing from the folder's listing: it is only taken down if its file
         really cannot be read, since a listing can come back short while a file is busy */
      const there = await desk.library.read(currentId).then(() => true, () => false);
      if (there) setTimeout(refreshSongs, 1000); else await showSomething();
    }
    renderSongs();
    await measure();
  }).catch(() => {});
  return listing;
}
async function openSong(id, quietly) {
  if (busy) return false;
  if (!quietly) picked = true;
  await flushEdits();
  if (id === DEMO) { currentId = DEMO; setPiece(loadDemo()); }
  else {
    try {
      const p = parseMidi(await desk.library.read(id), titleOf(id), reader);
      currentId = id; setPiece(p);
    } catch (e) { say(e && e.code === 'empty' ? T.errEmpty : T.errLoad); return false; }
  }
  S.lastSong = currentId === DEMO ? '' : currentId; save(); renderSongs();
  return true;
}
/* Puts something on stage when the song there has gone: the built-in piece if it is still listed,
   otherwise the song last opened or the first that opens, otherwise an empty stage. */
async function showSomething() {
  if (S.demo) { currentId = DEMO; setPiece(loadDemo()); }
  else {
    const last = songs.find(s => s.name === S.lastSong);
    for (const s of last ? [last, ...songs] : songs) if (await openSong(s.name, true)) return;
    currentId = NONE; setPiece(emptyPiece());
  }
  S.lastSong = ''; save(); renderSongs();
}
/* Adds files to the folder and opens the first one. `names` has null for files that were not MIDI. */
async function added(names) {
  await refreshSongs();
  const first = names.find(Boolean);
  if (first) await openSong(first);
  if (names.some(n => n === null)) say(T.errNotMidi);
}
/* The songs have a folder from the start; Settings can move them to another. */
async function chooseFolder() {
  await flushEdits();
  if (await desk.library.choose(T.folderDialog, T.folderPick)) await refreshSongs();
}
$('add').addEventListener('click', async () => {
  if (busy) return;
  const names = await desk.library.pick(T.addDialog, T.addPick, T.midiFiles);
  if (names.length) added(names);
});
folders.attach(songList, renderSongs);
songList.addEventListener('click', e => {
  const li = e.target.closest('.song');
  if (!li) return;
  const id = li.dataset.id, rm = e.target.closest('.rm');
  if (!rm) { openSong(id).then(ok => { if (ok && currentId === id && !playing) play(); }); return; }
  if (!rm.classList.contains('sure')) {
    rm.classList.add('sure'); rm.textContent = T.removeConfirm;
    setTimeout(() => { if (rm.isConnected) renderSongs(); }, 3500);
    return;
  }
  if (currentId === id) { clearTimeout(saveTimer); pendingSave = false; }
  /* the built-in piece is not a file: removing it takes it off the list for good */
  if (id === DEMO) { S.demo = false; save(); if (currentId === DEMO) showSomething(); else renderSongs(); return; }
  desk.library.trash(id).then(() => refreshSongs(), () => { say(T.errRemove); renderSongs(); });
});
/* A song takes a new name by its file being renamed; the built-in piece is not a file and keeps its name. */
renaming(songList, li => li.dataset.id === DEMO ? null : titleOf(li.dataset.id), async (li, title) => {
  if (busy) return;
  const id = li.dataset.id, to = title + (/\.(mid|midi)$/i.exec(id) || ['.mid'])[0];
  if (currentId === id) await flushEdits();
  try { await desk.library.rename(id, to); }
  catch (e) { say(/taken/.test(String(e && e.message)) ? T.errNameTaken : T.errRename); return; }
  if (lengths[id]) lengths[to] = lengths[id];
  if (currentId === id) {
    currentId = to; piece.title = title; $('title').textContent = title; sheet.song = to;
    S.lastSong = to; save();
  }
  document.dispatchEvent(new CustomEvent('song-renamed', {detail: {from: id, to}}));
  refreshSongs();
});
let dragDepth = 0;
const hasFiles = e => e.dataTransfer && [...e.dataTransfer.types].includes('Files');
app.addEventListener('dragenter', e => { if (!hasFiles(e)) return; e.preventDefault(); dragDepth++; stageEl.classList.add('over'); });
app.addEventListener('dragover', e => { if (hasFiles(e)) e.preventDefault(); });
app.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; stageEl.classList.remove('over'); } });
app.addEventListener('drop', async e => {
  e.preventDefault(); dragDepth = 0; stageEl.classList.remove('over');
  const files = [...e.dataTransfer.files];
  if (!files.length || busy) return;
  added(await desk.library.importFiles(files));
});
desk.library.onChanged(() => refreshSongs());
/* The songs changed hands: an account signed in, or signed out. A change still on its way to a
   song's file is saved first, to the songs it belongs with. Afterwards the song on stage stays if
   it came along to the account that signed in; otherwise it belongs to the songs that were put
   away, and something from the songs now showing takes its place. */
owner.beforeChange(() => flushEdits());
document.addEventListener('library-opened', async e => {
  const to = (e.detail.moved || {})[currentId];
  if (to && to !== currentId) {
    if (lengths[currentId]) lengths[to] = lengths[currentId];
    currentId = to; piece.title = titleOf(to); $('title').textContent = piece.title; sheet.song = to;
    S.lastSong = to; save();
  } else if (!to && onDisk()) {
    clearTimeout(saveTimer); pendingSave = false;
    currentId = NONE;
  }
  await refreshSongs();
  if (currentId === NONE) await showSomething();
});
document.addEventListener('account-changed', () => renderSongs());

/* ---------- songs from links: each recording is fetched and its piano notes written out as MIDI ---------- */
/* Links are worked through one at a time, in the order given. `links` holds the ones not done yet:
   one being fetched ('download') or written out ('transcribe'), the ones waiting their turn, and
   any that failed, which stay listed until they are tried again or removed. */
const linkRow = $('link');
linkRow.innerHTML = `<ul class="links" id="linkJobs"></ul><div class="link-new"><input id="linkUrl" type="url" spellcheck="false" autocomplete="off" placeholder="${T.linkPlaceholder}" aria-label="${T.linkPlaceholder}"><button type="submit" class="tb">${T.linkGo}</button></div>`;
const linkList = $('linkJobs'), linkBox = $('linkUrl');
let links = [], linkWorking = false, linkSince = 0, linkTimer = 0, lastLink = null;
const linkActive = j => j.state === 'download' || j.state === 'transcribe';
/* A link as it is listed: without its "https://www." and with coded characters spelled out; the row shows its end. */
const linkShown = url => { const s = url.replace(/^https?:\/\/(www\.)?/i, ''); try { return decodeURI(s); } catch (e) { return s; } };
function renderLinks() {
  linkList.innerHTML = links.map((j, i) => {
    const li = `<li data-i="${i}" title="${esc(j.state === 'failed' ? j.why : j.url)}">`, off = `<button type="button" class="ib cut" aria-label="${esc(fill(T.remove, {name: j.url}))}">${ICON.x}</button>`;
    if (linkActive(j)) return li + `<span class="what">${j.state === 'transcribe' ? T.linkWriting : T.linkGetting}</span><span class="left" id="linkTime"></span><button type="button" class="tb" id="linkCancel">${T.cancel}</button></li>`;
    return li + `<span class="what url"><bdi>${esc(linkShown(j.url))}</bdi></span>` +
      (j.state === 'failed' ? `<button type="button" class="tb again">${T.linkAgain}</button>` : `<span class="left">${T.linkWaiting}</span>`) + off + `</li>`;
  }).join('');
  const tick = () => { const el = $('linkTime'); if (el) el.textContent = clockText(clock() - linkSince); };
  clearInterval(linkTimer);
  if (links.some(linkActive)) { linkTimer = setInterval(tick, 500); tick(); }
  showCardNow();
}
/* What Settings says, under the graphics card switch, about the recording being transcribed at the
   moment: that the card is doing it, with how much of the card's memory the work holds, or that
   the processor is. */
function cardNow() {
  const job = links.find(j => j.state === 'transcribe');
  if (!job || job.card === undefined) return '';
  if (job.card) return job.memory ? fill(T.cardWorking, {memory: job.memory >= 1e9 ? (job.memory / 1e9).toFixed(1) + ' GB' : Math.round(job.memory / 1e6) + ' MB'}) : T.cardWorkingPlain;
  return job.gaveUp ? T.cardGaveUp : T.cardOff;
}
function showCardNow() {
  const el = $('cardNow');
  if (!el) return;
  /* Settings scrolled to its end stays there as this line comes and goes under the switch */
  const atEnd = insp.scrollHeight - insp.scrollTop - insp.clientHeight < 4;
  el.textContent = cardNow();
  if (atEnd) insp.scrollTop = insp.scrollHeight;
}
async function workLinks() {
  if (linkWorking) return;
  linkWorking = true;
  for (let job; (job = links.find(j => j.state === 'waiting'));) {
    job.state = 'download'; job.card = job.memory = job.gaveUp = undefined; linkSince = clock(); renderLinks();
    askTranscriber();
    let result;
    try { result = await desk.link.start(job.url, S.card); } catch (err) { result = {error: 'failed'}; }
    lastLink = result;
    if (result.name || result.error === 'cancelled') {
      links = links.filter(j => j !== job);
      /* a link that was stopped goes back in the box, to be given again */
      if (!result.name && !linkBox.value) linkBox.value = job.url;
    } else {
      job.state = 'failed'; job.why = {tools: T.errLinkTools, download: T.errLinkDownload, notes: T.errLinkNotes}[result.error] || T.errLink;
      say(job.why);
    }
    renderLinks();
    if (result.name) {
      /* the new song goes on stage, unless that would cut off a song that is playing. It is among
         the songs of whoever asked for it, which are not the ones showing if someone else has signed in since */
      await refreshSongs();
      if (!songs.some(s => s.name === result.name)) continue;
      if (playing || busy) say(fill(T.linkDone, {name: titleOf(result.name)})); else await openSong(result.name);
    }
  }
  linkWorking = false;
}
/* Word from the desktop side on the link being worked on: which stage it is at and, while its notes
   are written out, whether the graphics card is doing that and how much of its memory the work holds. */
desk.link.onStage(info => {
  const job = links.find(linkActive);
  if (!job) return;
  const was = job.state;
  job.state = info.stage; job.card = info.card; job.memory = info.memory; job.gaveUp = info.gaveUp;
  if (was !== job.state) renderLinks(); else showCardNow();
});
linkList.addEventListener('click', e => {
  const li = e.target.closest('li'), job = li && links[+li.dataset.i];
  if (!job) return;
  if (e.target.closest('#linkCancel')) desk.link.cancel();
  else if (e.target.closest('.again')) { job.state = 'waiting'; renderLinks(); workLinks(); }
  else if (e.target.closest('.cut')) { links = links.filter(j => j !== job); renderLinks(); }
});
linkRow.addEventListener('submit', async e => {
  e.preventDefault();
  const url = linkBox.value.trim();
  if (!url) return;
  if (!/^https?:\/\/\S+$/i.test(url)) { say(T.errLinkBad); return; }
  linkBox.value = '';
  const there = links.find(j => j.url === url);
  if (!there) links.push({url, state: 'waiting'}); else if (there.state === 'failed') there.state = 'waiting';
  renderLinks(); workLinks();
});

/* ---------- playing with mouse, touch and computer keys ---------- */
const touching = new Map();
const spot = e => within(canvas, e);
canvas.addEventListener('pointerdown', e => {
  const [px, py] = spot(e), m = stage.keyAt(px, py);
  if (m < 0) {
    if (S.editHands) { swept = new Set(); canvas.setPointerCapture(e.pointerId); moveAt(px, py); e.preventDefault(); }
    else tap = {id: e.pointerId, x: e.clientX, y: e.clientY, at: clock()};
    return;
  }
  canvas.setPointerCapture(e.pointerId); touching.set(e.pointerId, m); liveOn(m, 0.7); e.preventDefault();
});
canvas.addEventListener('pointermove', e => {
  const [px, py] = spot(e);
  stage.hoverX = px; stage.hoverY = py;
  if (S.editHands) { dirty = true; if (swept) moveAt(px, py); }
  if (!touching.has(e.pointerId)) return;
  const m = stage.keyAt(px, py), was = touching.get(e.pointerId);
  if (m !== was) { liveOff(was); if (m >= 0) liveOn(m, 0.7); touching.set(e.pointerId, m); }
});
const liftPointer = e => { swept = null; if (touching.has(e.pointerId)) { liveOff(touching.get(e.pointerId)); touching.delete(e.pointerId); } };
/* A short press above the keys that did not move is a tap on the stage; the phone layout uses it to show or hide the top strip. */
let tap = null;
canvas.addEventListener('pointerup', e => {
  if (tap && tap.id === e.pointerId && clock() - tap.at < 0.5 && Math.hypot(e.clientX - tap.x, e.clientY - tap.y) < 12) document.dispatchEvent(new CustomEvent('stage-tap'));
  tap = null;
});
/* Other parts of the app ask for quiet before they play something of their own. */
document.addEventListener('stage-quiet', () => { if (playing) pause(); });
canvas.addEventListener('pointerup', liftPointer);
canvas.addEventListener('pointercancel', liftPointer);
canvas.addEventListener('pointerleave', () => { stage.hoverY = -1; if (S.editHands) dirty = true; });

/* ---------- moving notes between hands ---------- */
let swept = null, saveTimer = 0, pendingSave = false, saving = Promise.resolve();
/* A piece with one track gets an empty second one to move notes into. */
function secondHand() {
  if (piece.tracks.length > 1) return;
  const only = piece.tracks[0];
  piece.tracks.push({name: only.name === T.leftHand ? T.rightHand : T.leftHand, src: null, ch: only.ch || 0, count: 0, muted: false, color: PALETTES[S.palette >= 0 ? S.palette : 0][1]});
}
function moveNote(n, to) {
  piece.tracks[n.track].count--; n.track = to; piece.tracks[to].count++;
}
function moveAt(px, py) {
  const i = stage.noteAt(px, py);
  if (i < 0) return;
  const n = stage.refs[i / 5];
  if (!n || swept.has(n)) return;
  swept.add(n); undo.push([n, n.track]);
  moveNote(n, (n.track + 1) % piece.tracks.length);
  edited();
}
function edited() {
  piece.tracks.forEach((tr, i) => { const el = $('cnt-' + i); if (el) el.textContent = tr.count; });
  ovDirty = true; dirty = true; sheet.changed();
  if (!onDisk()) return;
  pendingSave = true;
  clearTimeout(saveTimer); saveTimer = setTimeout(flushEdits, 600);
}
/* Rewrites the song's file with the notes where they are now. */
function flushEdits() {
  clearTimeout(saveTimer);
  if (!pendingSave || !onDisk()) return saving;
  pendingSave = false;
  const name = currentId, bytes = writeMidi(piece);
  saving = saving.then(() => desk.library.write(name, bytes)).catch(() => say(T.errSave));
  return saving;
}
async function saveCopy() {
  if (!piece.notes.length) return;
  const title = piece.title || T.demoTitle;
  try {
    const file = await desk.library.saveCopy(fill(T.copyName, {name: title.replace(/[\\/:*?"<>|]+/g, ' ').trim()}), writeMidi(piece), T.saveCopyDialog, T.midiFiles);
    if (file) say(fill(T.copySaved, {name: file.split(/[\\/]/).pop()}));
  } catch (e) { say(T.errCopy); }
}

/* ---------- saving the sheet music as a PDF ---------- */
/* MuseScore lays the piece out on pages, as the band has it: the same hands, and the same beats for a piece in free time. */
async function savePdf(button) {
  if (!piece.notes.length || button.disabled) return;
  if (!(await desk.sheet.available())) { say(T.errNoMuseScore); return; }
  button.disabled = true; say(T.pdfSaving);
  try {
    const name = (piece.title || T.demoTitle).replace(/[\\/:*?"<>|]+/g, ' ').trim(), job = await sheet.jobFor(piece);
    await desk.sheet.print(name, {midi: job.midi, title: piece.title || T.demoTitle});
    say(T.pdfSaved);
    document.dispatchEvent(new CustomEvent('sheet-saved', {detail: {name}}));
  } catch (e) { say(e && e.message === 'no-musescore' ? T.errNoMuseScore : T.errPdf); }
  if (button.isConnected) button.disabled = false;
}

/* ---------- saving a video ---------- */
const job = $('job'), ticker = new MessageChannel();
/* Frames for the encoder cross to the desktop side through this port, handed over rather than copied. */
const frameLink = new MessageChannel(), framePort = frameLink.port1;
window.postMessage('frame-port', location.origin, [frameLink.port2]);
let cancelled = false;
function showJob(what, part, left) {
  job.hidden = false;
  job.innerHTML = `<span class="what">${what}</span><span class="meter"><i style="width:${(part * 100).toFixed(1)}%"></i></span><span class="left">${left || ''}</span><button type="button" class="tb" id="jobCancel">${T.cancel}</button>`;
}
job.addEventListener('click', e => {
  if (e.target.closest('#jobCancel')) cancelled = true;
  else if (e.target.closest('#jobShow')) desk.video.show(job.dataset.file);
  else if (e.target.closest('#jobClose')) job.hidden = true;
});
function setBusy(on) {
  busy = on;
  for (const el of [document.querySelector('.bar'), $('lib'), $('sheet'), insp]) el.inert = on;
  stageEl.classList.toggle('framed', on);
}
async function saveVideo() {
  if (busy || !piece.notes.length) return;
  if (!(await desk.video.available())) { say(T.errNoEncoder); return; }
  const file = desk.testing && window.pvVideoFile ? window.pvVideoFile : await desk.video.choose((piece.title || T.demoTitle).replace(/[\\/:*?"<>|]+/g, ' ').trim() + '.mp4', T.videoDialog, T.videoKind);
  if (!file) return;
  if (playing) pause();
  await flushEdits();
  const big = S.videoSize === 'uhd', tall = S.videoShape === 'tall', fps = +S.videoRate, scale = big ? 2 : 1;
  const width = (tall ? 1080 : 1920) * scale, height = (tall ? 1920 : 1080) * scale;
  const from = -1, to = Math.min(piece.soundEnd, piece.duration + 6) + 1.5, frames = Math.ceil((to - from) * fps);
  const keepT = tAnchor, wasEditing = S.editHands;
  cancelled = false; setBusy(true); S.editHands = false;
  let started = false;
  try {
    showJob(T.videoSound, 0);
    const sound = await renderWav(bank, piece, from, to, part => showJob(T.videoSound, part * 0.1));
    if (cancelled) return;
    stage.setSize(width / scale, height / scale, scale);
    stage.parts.length = 0; stage.live.length = 0; stage.lastT = from - 1; stage.setCapturing(true);
    const encoder = await desk.video.start({file, width, height, fps, sound}); started = true;
    const began = clock();
    /* Each frame is drawn, copied off the graphics card into a spare buffer, and handed to the encoder.
       Buffers come back for reuse; drawing waits only when all of them are with the encoder. */
    const spent = {draw: 0, read: 0, wait: 0};
    const spare = Array.from({length: 4}, () => new ArrayBuffer(width * height * 3 / 2));
    let out = 0, failed = false;
    framePort.onmessage = e => { spare.push(e.data.bytes); out--; if (e.data.failed) failed = true; };
    const tick = () => new Promise(done => { ticker.port2.onmessage = done; ticker.port1.postMessage(0); });
    for (let i = 0; i < frames && !cancelled && !failed; i++) {
      const t0 = clock();
      do await tick(); while (!spare.length && !failed && !cancelled);
      if (failed || cancelled) break;
      const t1 = clock();
      stage.render({t: from + i / fps, dt: 1 / fps, clock: i / fps, playing: true}, i % 6 === 0);
      const t2 = clock(), bytes = spare.pop();
      stage.readFrame(new Uint8Array(bytes));
      out++; framePort.postMessage({bytes}, [bytes]);
      spent.wait += t1 - t0; spent.draw += t2 - t1; spent.read += clock() - t2;
      if (i % 12 === 0) {
        const done = (i + 1) / frames, left = (clock() - began) / done * (1 - done);
        showJob(T.videoSaving, 0.1 + done * 0.9, i > fps ? fill(T.videoLeft, {time: clockText(left + 1)}) : '');
      }
    }
    while (out > 0 && !failed) await tick();
    if (cancelled) { await desk.video.cancel(); return; }
    if (failed) throw new Error('encode');
    await desk.video.finish();
    if (desk.testing) window.pvVideo = {frames, seconds: clock() - began, length: to - from, encoder, spent};
    job.dataset.file = file;
    job.innerHTML = `<span class="what">${T.videoSaved}</span><span class="meter"><i style="width:100%"></i></span><button type="button" class="tb" id="jobShow">${T.showFile}</button><button type="button" class="tb" id="jobClose">${T.dismiss}</button>`;
    document.dispatchEvent(new CustomEvent('video-saved', {detail: {file, seconds: to - from}}));
  } catch (e) {
    if (started) await desk.video.cancel().catch(() => {});
    if (desk.testing) window.pvVideo = {error: String(e && e.message || e)};
    job.hidden = true; say(e && e.message === 'no-encoder' ? T.errNoEncoder : T.errVideo);
  } finally {
    if (cancelled) job.hidden = true;
    stage.setCapturing(false); stage.parts.length = 0;
    S.editHands = wasEditing;
    setBusy(false); tAnchor = keepT; stage.lastT = keepT;
    resize(); buildInspector();
  }
}

/* ---------- full screen ---------- */
let wake = 0;
function stir() { app.classList.add('awake'); clearTimeout(wake); wake = setTimeout(() => app.classList.remove('awake'), 2600); }
function setFull(on) {
  app.classList.toggle('full', on);
  $('fullBtn').innerHTML = on ? ICON.unfull : ICON.full;
  $('fullBtn').setAttribute('aria-label', on ? T.exitFullScreen : T.fullScreen); $('fullBtn').title = on ? T.exitFullScreen : T.fullScreen;
  if (on) stir();
}
/* Fills the window at once, and asks for the whole screen as well; if that is refused, the window stays filled. */
function toggleFull() {
  const on = !app.classList.contains('full');
  setFull(on);
  try {
    if (on && app.requestFullscreen) app.requestFullscreen().catch(() => {});
    else if (!on && document.fullscreenElement) document.exitFullscreen().catch(() => {});
  } catch (e) {}
}
document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement && app.classList.contains('full')) setFull(false); });
app.addEventListener('pointermove', () => { if (app.classList.contains('full')) stir(); });
$('fullBtn').addEventListener('click', toggleFull);
setFull(false);

const KEYS = {a: 0, w: 1, s: 2, e: 3, d: 4, f: 5, t: 6, g: 7, y: 8, h: 9, u: 10, j: 11, k: 12, o: 13, l: 14, p: 15, ';': 16};
let octave = 0;
const typed = new Map();
const typingText = e => e.target.tagName === 'TEXTAREA' || (e.target.tagName === 'INPUT' && !/^(range|color|checkbox|radio|button)$/.test(e.target.type));
window.addEventListener('keydown', e => {
  if (busy) return;
  const k = e.key.toLowerCase();
  if ((e.ctrlKey || e.metaKey) && k === 'z' && S.editHands && undo.length && !typingText(e)) { const [n, from] = undo.pop(); moveNote(n, from); edited(); e.preventDefault(); return; }
  if (e.ctrlKey || e.metaKey || e.altKey || typingText(e)) return;
  /* Space always plays or pauses, whichever button or slider was used last; only a text box keeps it for typing */
  if (k === ' ') { e.preventDefault(); if (!e.repeat) playing ? pause() : play(); return; }
  if (k === 'escape' && app.classList.contains('full')) { toggleFull(); return; }
  if (e.target.tagName === 'SELECT') return;
  if ((k === 'arrowleft' || k === 'arrowright') && e.target === document.body) { seek(now() + (k === 'arrowright' ? 5 : -5)); e.preventDefault(); return; }
  if (e.repeat) return;
  if (k === 'z') octave = Math.max(-3, octave - 1);
  else if (k === 'x') octave = Math.min(3, octave + 1);
  else if (k in KEYS && !typed.has(k)) { const m = 60 + KEYS[k] + 12 * octave; typed.set(k, m); liveOn(m, 0.7); }
});
window.addEventListener('keyup', e => {
  /* a button that has the focus would otherwise be pressed when Space is let go */
  if (e.key === ' ' && !busy && !typingText(e)) e.preventDefault();
  const k = e.key.toLowerCase();
  if (typed.has(k)) { liveOff(typed.get(k)); typed.delete(k); }
});
window.addEventListener('blur', () => { typed.forEach(m => liveOff(m)); typed.clear(); });
window.addEventListener('beforeunload', () => { flushEdits(); });

/* ---------- frame loop ---------- */
let lastStamp = 0, lastSecond = -1;
function frame(stampMs) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (stampMs - lastStamp) / 1000 || 0);
  lastStamp = stampMs;
  if (busy || !stage.geo || !piece) return;
  if (playing && now() > piece.duration + 1.2) { pause(true); tAnchor = piece.duration; }
  if (!playing && !dirty && !stage.parts.length && !stage.live.length && !stage.solid.busy) return;
  const t = now();
  stage.render({t, dt, clock: clock(), playing});
  drawOverview(t);
  sheet.follow(t);
  const sec = Math.floor(Math.max(0, Math.min(t, piece.duration)));
  if (sec !== lastSecond) {
    lastSecond = sec;
    $('tcur').textContent = clockText(sec);
    ov.setAttribute('aria-valuenow', sec); ov.setAttribute('aria-valuetext', clockText(sec));
  }
  dirty = false;
}

/* ---------- start ---------- */
const demoLength = loadDemo().duration;
syncPlayButton();
new ResizeObserver(resize).observe(stageEl);
resize();
setPiece(S.demo ? loadDemo() : emptyPiece());
renderSongs();
connectMidi();
if (S.lookOpen) askTranscriber();
refreshSongs().then(() => { if (!picked && S.lastSong && currentId !== S.lastSong && songs.some(s => s.name === S.lastSong)) openSong(S.lastSong, true); });
document.fonts.ready.then(() => { stage.refresh(); dirty = true; });
requestAnimationFrame(frame);

if (desk.testing) {
  window.pv = {
    stage, sheet, S, T, say,
    get piece() { return piece; }, get playing() { return playing; }, get current() { return currentId; }, get songs() { return songs; }, get busy() { return busy; },
    now, play, pause, seek, openSong, refreshSongs, liveOn, liveOff, midiIn, flushEdits, saveVideo, bank,
    get linking() { const job = links.find(linkActive); return job ? job.state : ''; }, get links() { return links.map(j => ({url: j.url, state: j.state, card: j.card, memory: j.memory})); },
    get transcriber() { return transcriber; }, get lastLink() { return lastLink; },
    get message() { return msg.textContent; },
    get audio() { return audio; }, get piano() { return piano; },
    set(k, v) { S[k] = v; stage.layout(); stage.refresh(); buildInspector(); ovDirty = true; dirty = true; },
    redraw() { dirty = true; }
  };
}
