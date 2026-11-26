/* The account row at the bottom of the Songs panel: sign in or create an account, then sync this
   device's tabs with the account so they show up on the person's other devices. Signing in shows
   that account's own tabs and brings along the ones made while signed out; signing out puts them
   away. Hidden when no project is set up. */
import {T, fill} from './strings.js';
import * as cloud from './cloud.js';

const esc = s => String(s).replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]));
/* where the piano's page remembers whose songs it is showing (../owner.js) */
const PIANO_OWNER = 'piano-visualizer-owner';

/* `box` is the element the row is drawn in; `store` is the device's tab store; `changed` is called
   after whose tabs are showing has changed, and after a sync that brought tabs in or took tabs
   away, so the list can be drawn again. */
export function accountRow(box, store, changed) {
  let open = false, working = false, note = '', email = '', password = '', again = false;

  function render() {
    box.hidden = !cloud.configured();
    if (box.hidden) return;
    const who = cloud.account(), says = note ? `<p class="acct-note" role="status">${esc(note)}</p>` : '', off = working ? ' disabled' : '';
    if (who) {
      box.innerHTML = `<div class="acct-row"><span class="who" title="${esc(who.email)}">${esc(who.email)}</span><button type="button" class="tb" id="acctSync"${off}>${working ? T.syncing : T.sync}</button><button type="button" class="tb" id="acctOut"${off}>${T.signOut}</button></div>${says}`;
    } else if (!open) {
      box.innerHTML = `<div class="acct-row"><span class="who">${T.accountHint}</span><button type="button" class="tb" id="acctOpen">${T.signIn}</button></div>${says}`;
    } else {
      box.innerHTML = `<form id="acctForm" novalidate><input id="acctEmail" type="email" autocomplete="username" spellcheck="false" placeholder="${T.email}" aria-label="${T.email}"><input id="acctPass" type="password" autocomplete="current-password" placeholder="${T.password}" aria-label="${T.password}">` +
        `<div class="acct-row"><button type="submit" class="tb"${off}>${T.signIn}</button><button type="button" class="tb" id="acctNew"${off}>${T.createAccount}</button><button type="button" class="tb" id="acctClose">${T.cancel}</button></div></form>${says}`;
      box.querySelector('#acctEmail').value = email; box.querySelector('#acctPass').value = password;
    }
  }

  /* Sends and fetches whatever differs between this device and the account. A sync asked for while
     one is running runs once more when that one ends, so the latest change is never left behind. */
  async function runSync() {
    if (!cloud.account()) return;
    if (working) { again = true; return; }
    working = true; note = ''; render();
    try {
      const r = await cloud.sync(store);
      note = r.sent || r.received || r.removed ? fill(T.syncedCounts, {up: r.sent, down: r.received}) : T.synced;
      if (r.received || r.removed) await changed();
    } catch (e) { note = e.code === 'signed-out' ? T.signedOut : e.code === 'offline' ? T.errOffline : T.errSync; }
    working = false; render();
    if (again) { again = false; runSync(); }
  }

  /* Shows the tabs of whoever is signed in now, or with no one signed in the tabs made on this device. */
  async function changeHands() {
    try { await store.open(cloud.account()); } catch { /* the tabs that were showing stay */ }
    await changed();
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
    working = true; note = ''; again = false; render();
    try { await cloud.signOut(); } catch { /* signed out here all the same */ }
    /* the piano's page puts that account's songs away too, the next time it opens */
    try { localStorage.removeItem(PIANO_OWNER); } catch { /* nothing was kept */ }
    await changeHands();
    working = false; render();
  }

  box.addEventListener('input', e => { if (e.target.id === 'acctEmail') email = e.target.value; else if (e.target.id === 'acctPass') password = e.target.value; });
  box.addEventListener('submit', e => { e.preventDefault(); enter(false); });
  box.addEventListener('click', e => {
    const id = (e.target.closest('button') || {}).id;
    if (id === 'acctOpen') { open = true; note = ''; render(); box.querySelector('#acctEmail').focus(); }
    else if (id === 'acctClose') { open = false; note = ''; password = ''; render(); }
    else if (id === 'acctNew') enter(true);
    else if (id === 'acctSync') runSync();
    else if (id === 'acctOut') leave();
  });
  render();
  if (cloud.account()) runSync();
  return {sync: runSync, signedIn: () => !!cloud.account(), render,
    get working() { return working; }, get note() { return note; }};
}
