/* The guitar's page, when the welcome page hands over to it, comes up as the piano's does: from
   under a dark sheet that lifts off it from the bottom up. The welcome page leaves word that it is
   handing over; the guitar's page puts the sheet up before anything of it shows, and lifts it once
   it has started. The sheet is the welcome page's own (welcome.css). */
const KEY = 'musicden-arriving';
const wait = ms => new Promise(done => setTimeout(done, ms));
const painted = () => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done)));

/* Leaves word, for the page about to be opened in this one's place. */
export function handOver() { try { sessionStorage.setItem(KEY, '1'); } catch (e) {} }

/* Puts the sheet up if word was left. What comes back has lift(), which takes the sheet off and
   resolves when it is gone; with no word left it resolves at once. */
export function arriving() {
  let due = false;
  try { due = sessionStorage.getItem(KEY) === '1'; sessionStorage.removeItem(KEY); } catch (e) {}
  if (!due) return {lift: async () => {}};
  const sheet = document.createElement('div');
  sheet.className = 'wv wv-full';
  sheet.style.setProperty('--wv-fade', '150px');
  sheet.innerHTML = '<div class="wv-shade"><div class="wv-cover"></div><div class="wv-fade"></div></div>';
  document.body.appendChild(sheet);
  return {
    async lift() {
      await painted();
      sheet.classList.add('wv-rise');
      await wait(matchMedia('(prefers-reduced-motion: reduce)').matches ? 40 : 800);
      sheet.remove();
    }
  };
}
