/* Which instrument the app is set to. Each has a page of its own: the piano's is index.html, and
   the guitar's is guitar/index.html beside it. The choice is made on the welcome page and can be
   changed in Settings; the app always starts on the piano's page, which hands over to the page of
   the instrument chosen. */
const KEY = 'musicden-instrument';
/* each instrument's page, from the piano's own folder */
const PAGE = {piano: 'index.html', guitar: 'guitar/index.html'};

/* The instrument chosen; the piano until one is. */
export function chosen() {
  try { const v = localStorage.getItem(KEY); return PAGE[v] ? v : 'piano'; } catch (e) { return 'piano'; }
}
/* The instrument whose page this is. */
export const here = () => (/\/guitar\/[^/]*$/.test(location.pathname) ? 'guitar' : 'piano');
/* The address of an instrument's page, as it is reached from this one. */
export function pageOf(which) {
  const to = new URL((here() === 'guitar' ? '../' : '') + PAGE[which], location.href);
  /* what the address asks for (a check asks for "test") goes along */
  to.search = location.search; to.hash = '';
  return to.href;
}
/* Chooses an instrument and, when this is not its page, opens its page in place of this one. */
export function choose(which) {
  if (!PAGE[which]) return;
  try { localStorage.setItem(KEY, which); } catch (e) {}
  if (which !== here()) location.replace(pageOf(which));
}
