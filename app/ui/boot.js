/* Starts the app. On the desktop the shell has already provided `desk`; in a phone or browser
   the stand-in is loaded first, along with the layout for small touch screens. */
if (!window.desk) {
  await import('./desk-web.js');
  document.documentElement.classList.add('web');
  document.head.appendChild(Object.assign(document.createElement('link'), {rel: 'stylesheet', href: 'phone.css'}));
  await import('./phone.js');
}
/* the songs of whoever had them when the app was last open are the ones showing before anything is listed */
await import('./owner.js');
await import('./app.js');
await import('./account.js');
await import('./videos.js');
await import('./sheets.js');
if (document.documentElement.classList.contains('web')) await import('./more.js');
