/* Whose songs this device is showing. Each account's songs are kept apart on a device, from one
   another and from the songs added while no one is signed in, and so is its saved sheet music.
   Signing in shows that account's songs and brings along whatever was added while signed out;
   signing out puts them away, untouched, until that account signs in again. So one account's
   songs never reach another, and with no one signed in a device starts with the built-in piece alone. */
import * as folders from './folders.js';

const KEY = 'piano-visualizer-owner', desk = window.desk;
let owner = null;
try { const o = JSON.parse(localStorage.getItem(KEY) || 'null'); if (o && typeof o.id === 'string' && o.id) owner = {id: o.id, email: String(o.email || '')}; } catch (e) {}
const leaving = [];

/* The account whose songs are showing ({id, email}), or null for the songs added while signed out. */
export const current = () => owner;
/* Names something to finish before the songs change hands, such as a change still on its way to a song's file. */
export const beforeChange = fn => { leaving.push(fn); };
/* Hands the device over to an account's songs, or with null to the songs added while signed out. */
export async function give(account) {
  const next = account ? {id: account.id, email: account.email} : null;
  if ((next && next.id) === (owner && owner.id)) return;
  for (const fn of leaving) { try { await fn(); } catch (e) {} }
  await desk.library.open(next);
  const moved = next ? await desk.library.adopt() : {}, sheets = next ? await desk.sheets.adopt() : [];
  owner = next;
  if (next) localStorage.setItem(KEY, JSON.stringify(next)); else localStorage.removeItem(KEY);
  folders.songs.use(next ? next.id : '', moved);
  /* a sheet keeps its name when it comes over */
  folders.sheets.use(next ? next.id : '', Object.fromEntries(sheets.map(name => [name, name])));
  document.dispatchEvent(new CustomEvent('library-opened', {detail: {moved}}));
}

/* at the start: the songs of whoever had them when the app was last open */
try { await desk.library.open(owner); } catch (e) {}
folders.songs.use(owner ? owner.id : '');
folders.sheets.use(owner ? owner.id : '');
