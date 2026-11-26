/* Whether this is the first time the app is opened on this device, which is when the welcome page
   is shown. A check starts the app many times over, each time as if new, and is welcomed only
   when it asks to be. */
const DONE = 'musicden-welcomed', ASKED = 'musicden-welcome-check';
const kept = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };

/* True once the welcome page has been gone through on this device. */
export const returning = () => !!kept(DONE);
/* Needs `desk`, which says whether a check is running. */
export const firstTime = () => !returning() && (!window.desk.testing || !!kept(ASKED));
export function welcomed() { try { localStorage.setItem(DONE, '1'); } catch (e) {} }
