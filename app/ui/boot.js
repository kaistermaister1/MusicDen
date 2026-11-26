/* Starts the app. On the desktop the shell has already provided `desk`; in a phone or browser
   the stand-in is loaded first, along with the layout for small touch screens. The first time
   the app is opened the welcome page lies over it from the start, and a short tour follows. */
import {chosen, choose} from './instrument.js';
import {returning, firstTime} from './first.js';

/* the guitar has a page of its own: when it is the instrument chosen, that page takes this one's place */
if (chosen() !== 'piano') { choose(chosen()); await new Promise(() => {}); }
/* on what may be a first visit the app stays out of sight until the welcome page is up */
const root = document.documentElement;
if (!returning()) root.classList.add('greeting');
root.classList.add('started');
if (!window.desk) {
  await import('./desk-web.js');
  root.classList.add('web');
  document.head.appendChild(Object.assign(document.createElement('link'), {rel: 'stylesheet', href: 'phone.css'}));
  await import('./phone.js');
}
const welcome = firstTime() ? (await import('./welcome.js')).open() : null;
root.classList.remove('greeting');
/* the songs of whoever had them when the app was last open are the ones showing before anything is listed */
await import('./owner.js');
const app = await import('./app.js');
await import('./account.js');
await import('./videos.js');
await import('./sheets.js');
if (root.classList.contains('web')) await import('./more.js');
/* the welcome page shows the app's own stage, and begins the tour as it ends; a tour still owed begins here */
if (welcome) welcome.ready(app);
else import('./tour.js').then(tour => tour.begin('piano'));
