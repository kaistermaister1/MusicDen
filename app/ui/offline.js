/* The phone and browser version kept on the device. Starts the service worker (sw.js), which keeps
   the app's files and the piano's recordings so the app opens at once and works without a
   connection; says in Settings how far that has got; moves to a newer version of the app as
   soon as one has been fetched, when that would not interrupt anything; and offers to install
   the app among the device's own. On the desktop none of this runs: the app's files are already
   on the computer. */
import {T, fill} from './strings.js';

const root = document.documentElement, workers = navigator.serviceWorker;
const on = root.classList.contains('web') && !!workers && window.isSecureContext;
let state = null;   /* {have, of}: recordings kept, out of how many there are */

/* What Settings says under Offline. */
export const offlineText = () => !state || !state.of ? T.offlineNo : state.have < state.of ? fill(T.offlineSaving, state) : T.offlineYes;
const show = () => { const el = document.getElementById('offline'); if (el) el.textContent = offlineText(); };

/* Putting the app among the device's own apps. Where the browser offers to install it, Settings
   shows a button that takes the offer up. An iPhone or iPad makes no such offer, so there
   Settings says where Add to Home Screen is found. Neither shows once the app is installed. */
const web = root.classList.contains('web');
const installed = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const apple = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
let offer = null;
export const canInstall = () => !!offer && !installed();
export const installHint = () => (web && apple && !installed() ? T.installIos : '');
const showInstall = () => { const b = document.getElementById('install'); if (b) b.hidden = !canInstall(); };
export async function install() {
  const o = offer;
  if (!o) return;
  /* an offer can be taken up once; the browser makes another if this one is turned down */
  offer = null; showInstall();
  try { await o.prompt(); } catch (e) {}
}
if (web) {
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); offer = e; showInstall(); });
  window.addEventListener('appinstalled', () => { offer = null; showInstall(); });
}

if (on) {
  /* Whether a reload would go unnoticed: nothing is playing, and the app has not been touched
     since it was opened or brought back to the front. */
  let touched = false;
  for (const type of ['pointerdown', 'keydown']) window.addEventListener(type, () => { touched = true; }, true);
  const had = !!workers.controller;
  workers.addEventListener('controllerchange', () => { if (had && !touched && !root.classList.contains('playing')) location.reload(); });

  const ask = () => workers.ready.then(reg => { if (reg.active) reg.active.postMessage('fill'); }, () => {});
  let again = 0;
  workers.addEventListener('message', e => {
    if (!e.data || !e.data.offline) return;
    /* more recordings are asked for straight away while they keep coming, and now and then while they do not (no connection) */
    const stuck = state && e.data.offline.have === state.have;
    state = e.data.offline; show();
    if (window.desk.testing) window.pvOffline = state;
    clearTimeout(again);
    if (state.have < state.of) again = setTimeout(ask, stuck ? 15000 : 300);
  });
  workers.register('sw.js').then(reg => {
    /* the recordings are fetched once the app itself is up, so they do not hold up its start */
    setTimeout(ask, 2500);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) return;
      touched = false; reg.update().catch(() => {}); ask();
    });
  }, () => {});
}
