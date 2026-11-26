/* The account row at the bottom of the Songs panel: sign in, and the songs and the saved sheet
   music here are kept in step with the account, so they show up on the person's other devices.
   Signing in shows that account's own songs, signing out puts them away (owner.js). Hidden when
   no project is set up. */
import {T} from './strings.js';
import * as cloud from './cloud.js';
import * as folders from './folders.js';
import * as owner from './owner.js';

const desk = window.desk, esc = s => String(s).replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]));
const style = document.createElement('link');
style.rel = 'stylesheet'; style.href = 'account.css';
document.head.appendChild(style);
const box = document.createElement('div');
box.className = 'acct'; box.id = 'acct';
document.getElementById('lib').appendChild(box);

let open = false, working = false, note = '', email = '', password = '', last = null;
function render() {
  box.hidden = !cloud.configured();
  /* the page as a whole says whether someone is signed in: removing a song then removes it from the account too */
  document.documentElement.classList.toggle('signed-in', !!cloud.account());
  if (box.hidden) return;
  const who = cloud.account(), says = note ? `<p class="acct-note" role="status">${esc(note)}</p>` : '', off = working ? ' disabled' : '';
  if (who) {
    box.innerHTML = `<div class="acct-row"><span class="who" title="${esc(who.email)}">${esc(who.email)}</span><button type="button" class="tb" id="acctSync"${off}>${working ? T.syncing : T.sync}</button><button type="button" class="tb" id="acctOut"${off}>${T.signOut}</button></div>${says}`;
  } else if (!open) {
    box.innerHTML = `<div class="acct-row"><span class="who">${T.accountHint}</span><button type="button" class="tb" id="acctOpen">${T.signIn}</button></div>${says}`;
  } else {
    box.innerHTML = `<form id="acctForm" novalidate><input id="acctEmail" type="email" autocomplete="username" spellcheck="false" placeholder="${T.email}" aria-label="${T.email}"><input id="acctPass" type="password" autocomplete="current-password" placeholder="${T.password}" aria-label="${T.password}">` +
      `<div class="acct-row"><button type="submit" class="tb"${off}>${T.signIn}</button><button type="button" class="tb" id="acctNew"${off}>${T.createAccount}</button><button type="button" class="tb" id="acctClose">${T.cancel}</button></div></form>${says}`;
    document.getElementById('acctEmail').value = email; document.getElementById('acctPass').value = password;
  }
}
/* Sends and fetches whatever differs between this device and the account: the songs, the saved
   sheet music, and the folders each is grouped into. */
let quietUntil = 0;
async function runSync() {
  if (working || !cloud.account()) return;
  working = true; note = ''; render();
  try {
    last = await cloud.sync(desk.library, folders.songs, desk.sheets, folders.sheets);
    note = T.synced;
  } catch (e) { note = e.code === 'signed-out' ? T.signedOut : T.errSync; }
  /* the songs a sync wrote are no reason to sync again */
  quietUntil = Date.now() + 1500;
  working = false; render();
  document.dispatchEvent(new CustomEvent('account-synced'));
  if (again) { again = false; soon(true); }
}
/* Hands the device's songs to whoever is signed in now, or puts them away, and tells the rest of the app. */
async function changeHands() {
  await owner.give(cloud.account());
  document.dispatchEvent(new CustomEvent('account-changed'));
}
async function enter(create) {
  if (working) return;
  if (!email.trim() || password.length < 6) { note = T.errAccountFields; render(); return; }
  working = true; note = ''; render();
  let ok = false;
  try {
    const who = create ? await cloud.signUp(email.trim(), password) : await cloud.signIn(email.trim(), password);
    if (who) { ok = true; open = false; password = ''; await changeHands(); } else note = T.confirmEmail;
  } catch (e) { note = e.code === 'offline' ? T.errOffline : e.code === 'unconfirmed' ? T.confirmEmail : e.code === 'weak' ? T.errAccountFields : create ? T.errCreate : T.errSignIn; }
  working = false; render();
  if (ok) runSync();
}
async function leave() {
  if (working) return;
  working = true; note = ''; render();
  try { await cloud.signOut(); await changeHands(); } catch (e) {}
  working = false; render();
}
box.addEventListener('input', e => { if (e.target.id === 'acctEmail') email = e.target.value; else if (e.target.id === 'acctPass') password = e.target.value; });
box.addEventListener('submit', e => { e.preventDefault(); enter(false); });
box.addEventListener('click', e => {
  const id = (e.target.closest('button') || {}).id;
  if (id === 'acctOpen') { open = true; note = ''; render(); document.getElementById('acctEmail').focus(); }
  else if (id === 'acctClose') { open = false; note = ''; password = ''; render(); }
  else if (id === 'acctNew') enter(true);
  else if (id === 'acctSync') runSync();
  else if (id === 'acctOut') leave();
});
/* a song renamed on this device takes the new name in the account too, so the old name does not come back with the next sync */
document.addEventListener('song-renamed', e => { if (cloud.account()) cloud.renameSong(e.detail.from, e.detail.to).catch(() => {}); });
document.addEventListener('sheet-renamed', e => { if (cloud.account()) cloud.renameSheet(e.detail.from, e.detail.to).catch(() => {}); });
/* folders changed by hand on this device go to the account a moment later, each list's by itself */
const foldersTimer = {};
document.addEventListener('folders-changed', e => {
  const kind = e.detail.kind, shelf = kind ? folders.sheets : folders.songs;
  clearTimeout(foldersTimer[kind]);
  foldersTimer[kind] = setTimeout(() => { if (cloud.account()) cloud.sendFolders(shelf.read(), kind).catch(() => {}); }, 1200);
});
/* a song added, changed or removed on this device reaches the account a moment later, without
   Sync being pressed, and so does sheet music saved, renamed or removed here */
let songsTimer = 0, again = false;
/* `byHand` says the change is known to have been made here by the person, not written by a sync:
   such a change is never passed over, and one made while a sync is running is synced once that ends */
const soon = byHand => {
  if (!cloud.account() || (!byHand && (working || Date.now() < quietUntil))) return;
  if (working) { again = true; return; }
  clearTimeout(songsTimer);
  songsTimer = setTimeout(runSync, 2500);
};
desk.library.onChanged(() => soon(false));
document.addEventListener('sheets-changed', () => soon(true));

render();
/* someone is signed in: their songs are the ones showing, and are brought into step */
if (cloud.account()) {
  const showing = owner.current();
  if (!showing || showing.id !== cloud.account().id) { working = true; render(); try { await changeHands(); } catch (e) {} working = false; render(); }
  runSync();
}
if (desk.testing) window.pvCloud = {cloud, owner, runSync, render, get note() { return note; }, get working() { return working; }, get last() { return last; }};
