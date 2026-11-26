/* The layout for phones and other touch screens: the stage fills the screen, the top strip lies
   over it, and a tap on the stage shows or hides the strip (and any panel open under it). */
const root = document.documentElement, small = matchMedia('(pointer: coarse), (max-width: 820px), (max-height: 520px)');
/* The phone app is always in landscape: held upright, the whole app is turned a quarter instead. */
const upright = matchMedia('(orientation: portrait)');
const apply = () => { root.classList.toggle('compact', small.matches); root.classList.toggle('turned', small.matches && upright.matches); };
small.addEventListener('change', apply);
upright.addEventListener('change', apply);
apply();
document.addEventListener('stage-tap', () => { if (root.classList.contains('compact')) document.querySelector('.app').classList.toggle('bar-off'); });

/* One panel at a time: two would leave nothing of the stage, so opening one puts the other away. */
const panels = ['libBtn', 'lookBtn'].map(id => document.getElementById(id));
for (const mine of panels) {
  mine.addEventListener('click', () => setTimeout(() => {
    const other = panels.find(b => b !== mine);
    if (root.classList.contains('compact') && mine.getAttribute('aria-expanded') === 'true' && other.getAttribute('aria-expanded') === 'true') other.click();
  }));
}

/* The screen stays on while a song plays, as it would for a video. The phone drops the hold
   whenever the app leaves the front, so it is asked for again on coming back. */
let hold = null, asking = false;
const wanted = () => root.classList.contains('playing') && !document.hidden;
const letSleep = () => { if (hold) { hold.release().catch(() => {}); hold = null; } };
async function screenOn() {
  if (!wanted()) { letSleep(); return; }
  if (hold || asking || !navigator.wakeLock) return;
  asking = true;
  try { hold = await navigator.wakeLock.request('screen'); hold.addEventListener('release', () => { hold = null; }); } catch (e) {}
  asking = false;
  /* the song may have stopped while the phone was being asked */
  if (!wanted()) letSleep();
}
new MutationObserver(screenOn).observe(root, {attributes: true, attributeFilter: ['class']});
document.addEventListener('visibilitychange', screenOn);

/* Safari's pinch, which would zoom the whole app. */
document.addEventListener('gesturestart', e => e.preventDefault());
