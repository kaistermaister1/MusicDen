/* Videos in the person's account. A video saved on the computer while signed in is sent to the
   account; the Songs panel can be switched to list those videos, and one tapped there plays in
   place of the stage, on the computer or the phone. */
import {T, fill} from './strings.js';
import {ICON, esc} from './inspector.js';
import * as cloud from './cloud.js';
import {renaming} from './rename.js';

const desk = window.desk, $ = id => document.getElementById(id);
const lib = $('lib'), head = lib.querySelector('.lib-head'), stageEl = $('stage');
const megabytes = bytes => Math.max(1, Math.round(bytes / 1e6)) + ' MB';
let showing = false, list = [], playingName = '';

if (cloud.configured()) {
  /* the panel's title becomes a switch between its two lists */
  $('libTitle').hidden = true;
  head.insertAdjacentHTML('afterbegin', `<div class="seg" role="radiogroup" id="libKind" aria-label="${T.songs}"><button type="button" role="radio" data-kind="songs" aria-checked="true">${T.songs}</button><button type="button" role="radio" data-kind="videos" aria-checked="false">${T.videos}</button></div>`);
  $('songs').insertAdjacentHTML('afterend', `<ul class="songs" id="videos" aria-label="${T.videos}"></ul><p class="lib-note" id="videosNote"></p>`);
  $('libKind').addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    showing = b.dataset.kind === 'videos';
    lib.classList.toggle('show-videos', showing);
    for (const x of $('libKind').children) x.setAttribute('aria-checked', String(x === b));
    if (showing) refresh();
  });
  $('videos').addEventListener('click', e => {
    const li = e.target.closest('.song');
    if (!li) return;
    const name = li.dataset.name, rm = e.target.closest('.rm');
    if (!rm) { watch(name); return; }
    if (!rm.classList.contains('sure')) {
      rm.classList.add('sure'); rm.textContent = T.removeConfirm;
      setTimeout(() => { if (rm.isConnected) render(); }, 3500);
      return;
    }
    if (playingName === name) closePlayer();
    cloud.removeVideo(name).then(refresh, () => { $('videosNote').textContent = T.errOffline; });
  });
  renaming($('videos'), li => li.dataset.name.replace(/\.mp4$/i, ''), (li, title) => {
    const from = li.dataset.name, to = title + '.mp4';
    if (list.some(v => v.name.toLowerCase() === to.toLowerCase() && v.name !== from)) { $('videosNote').textContent = T.errNameTaken; return; }
    cloud.renameVideo(from, to).then(() => { if (playingName === from) playingName = to; return refresh(); }, () => { $('videosNote').textContent = T.errRename; });
  });
  document.addEventListener('account-changed', () => { closePlayer(); list = []; render(); if (showing) refresh(); });
  /* a video just saved on this computer goes to the account, made smaller first if it is over the account's size limit */
  document.addEventListener('video-saved', async e => {
    if (!cloud.account() || !desk.video.forAccount) return;
    const what = () => document.querySelector('#job .what'), {file, seconds} = e.detail;
    if (what()) what().textContent = T.videoSending;
    let text = T.videoInAccount;
    try { await cloud.sendVideo(file.split(/[\\/]/).pop(), await desk.video.forAccount(file, seconds)); }
    catch (err) { text = /too-long|too-big/.test(String(err && (err.code || err.message))) ? T.errVideoTooLong : T.errVideoSend; }
    if (what()) what().textContent = text;
    if (desk.testing) window.pvVideoSent = text;
    if (showing) refresh();
  });
  /* while a video is up, Space pauses and resumes it, and starting a song puts it away */
  window.addEventListener('keydown', e => {
    const p = $('player');
    if (!p || e.key !== ' ' || /^(INPUT|TEXTAREA)$/.test(e.target.tagName)) return;
    const v = p.querySelector('video');
    e.preventDefault(); e.stopImmediatePropagation();
    if (!e.repeat) v.paused ? v.play() : v.pause();
  }, true);
  for (const id of ['play', 'restart', 'songs']) $(id).addEventListener('click', () => closePlayer(), true);
  render();
}

function render() {
  $('videos').innerHTML = list.map(v => `<li class="song" data-name="${esc(v.name)}"${v.name === playingName ? ' aria-current="true"' : ''}><button type="button" class="pick" title="${T.renameTip}"><span class="name">${esc(v.name.replace(/\.mp4$/i, ''))}</span><span class="dur">${megabytes(v.size)}</span></button>` +
    `<button type="button" class="ib rm" title="${T.removeVideoTip}" aria-label="${esc(fill(T.remove, {name: v.name}))}">${ICON.x}</button></li>`).join('');
  $('videosNote').textContent = !cloud.account() ? T.videosSignIn : list.length ? '' : T.videosEmpty;
}
async function refresh() {
  if (!cloud.account()) { list = []; render(); return; }
  try { list = await cloud.videos(); render(); }
  catch (e) { $('videosNote').textContent = e.code === 'signed-out' ? T.videosSignIn : T.errOffline; }
}
/* Plays a video over the stage, after asking the piece on stage to stop. */
async function watch(name) {
  document.dispatchEvent(new CustomEvent('stage-quiet'));
  let address;
  try { address = await cloud.videoAddress(name); }
  catch (e) { $('videosNote').textContent = T.errVideoOpen; return; }
  closePlayer();
  playingName = name;
  stageEl.insertAdjacentHTML('beforeend', `<div class="player" id="player"><video controls playsinline autoplay></video><button type="button" class="tb" id="playerClose">${T.closeVideo}</button></div>`);
  const video = $('player').querySelector('video');
  video.src = address;
  video.addEventListener('error', () => { $('videosNote').textContent = T.errVideoOpen; closePlayer(); });
  $('playerClose').addEventListener('click', closePlayer);
  render();
}
function closePlayer() {
  const p = $('player');
  if (p) { const v = p.querySelector('video'); v.pause(); v.removeAttribute('src'); v.load(); p.remove(); }
  if (playingName) { playingName = ''; if (cloud.configured()) render(); }
}
if (desk.testing) window.pvVideos = {refresh, get list() { return list; }, get playing() { return playingName; }};
