/* The page a person meets the first time the app is opened. It lies over the app itself, which is
   starting underneath: along the bottom the app's own stage shows through, playing its piece
   without a sound, so what is seen there is the keyboard and the notes exactly as the app draws
   them. The person says whether they want an account, then picks an instrument. For the piano the
   page lifts off the app; for the guitar it gives way to the guitar's page. While the guitar is
   looked at, the strip shows the guitar's own tab, drawn by the guitar page's own code. */
import {T, fill} from './strings.js';
import * as cloud from './cloud.js';
import {choose} from './instrument.js';
import {welcomed} from './first.js';
import {handOver} from './arrive.js';
import {TabView} from './guitar/tab.js';
import {DEFAULTS as TAB, THEMES as TAB_THEMES} from './guitar/settings.js';

const wait = ms => new Promise(done => setTimeout(done, ms));
const painted = () => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done)));
const still = matchMedia('(prefers-reduced-motion: reduce)').matches;

const ARROW = '<svg class="wv-arrow" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8h9.5M8.5 4l4 4-4 4"/></svg>';
const KEYS = '<svg class="wv-glyph" viewBox="0 0 46 30" aria-hidden="true">' +
  [0, 1, 2, 3, 4, 5, 6].map(i => `<rect class="wv-key" style="--k:${i}" x="${(i * 6.6).toFixed(1)}" width="6" height="30" rx="1"/>`).join('') +
  [0, 1, 3, 4, 5].map(i => `<rect class="wv-sharp" x="${((i + 1) * 6.6 - 2.3).toFixed(1)}" width="4" height="18" rx=".8"/>`).join('') + '</svg>';
const STRINGS = '<svg class="wv-glyph" viewBox="0 0 46 30" aria-hidden="true">' +
  [0, 1, 2, 3, 4, 5].map(i => `<line style="--k:${i}" x1="0" x2="46" y1="${2.5 + i * 5}" y2="${2.5 + i * 5}" stroke-width="${(0.7 + i * 0.24).toFixed(2)}"/>`).join('') + '</svg>';
/* a title whose words arrive one at a time */
const words = s => s.split(' ').map((w, i) => `<span class="wv-word" style="--i:${i}">${w}</span>`).join(' ');
const row = (attrs, picture, name, note) =>
  `<button type="button" class="wv-row" ${attrs}>${picture}<span class="wv-text"><span class="wv-name">${name}</span><span class="wv-note">${note}</span></span>${ARROW}</button>`;

/* The guitar's tab as the guitar page draws it, in a box of this page. It is sized by the room the
   box takes in the page, which holds on a phone where the whole app lies on its side. */
class Preview extends TabView {
  resize() {
    const box = this.c.parentElement, dpr = window.devicePixelRatio || 1;
    this.w = Math.max(1, box.clientWidth); this.h = Math.max(1, box.clientHeight);
    this.c.width = Math.round(this.w * dpr); this.c.height = Math.round(this.h * dpr);
    this.g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const sp = Math.min(44, Math.max(18, Math.min((this.h - this.headroom) / 9, this.w / 12))) * this.look.size;
    if (Math.abs(sp - this.sp) > 0.01) { this.sp = sp; this.fs = sp * 0.94; this.layout(); }
    this.draw(this.t);
  }
}

/* Puts the page up at once. What comes back takes the app itself, once it has started, through
   ready(): from then on the stage shows in the strip. */
export function open() {
  const app = document.querySelector('.app');
  /* the question about an account is for someone who could have one and is not signed in */
  const ask = cloud.configured() && !cloud.account();
  const el = document.createElement('div');
  el.className = 'wv wv-wait'; el.id = 'welcome';
  el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-label', T.welcome);
  el.innerHTML = `<div class="wv-tab"><canvas></canvas></div>
<div class="wv-shade"><div class="wv-cover"><div class="wv-col">
  <ol class="wv-steps"${ask ? '' : ' hidden'} aria-label="${fill(T.welcomeStep, {n: 1})}"><li class="wv-on"></li><li></li></ol>
  <section class="wv-pane" data-step="1"${ask ? '' : ' hidden'}>
    <h1 class="wv-title" tabindex="-1">${words(T.welcome)}</h1>
    <ul class="wv-list">
      <li class="wv-in" style="--i:1">${row('id="wvCreate" aria-expanded="false"', '', T.welcomeCreate, T.welcomeCreateNote)}
        <div class="wv-fold"><div><form class="wv-form" id="wvForm" novalidate>
          <input class="wv-field" id="wvEmail" type="email" autocomplete="username" spellcheck="false" placeholder="${T.email}" aria-label="${T.email}">
          <input class="wv-field" id="wvPass" type="password" autocomplete="new-password" placeholder="${T.password}" aria-label="${T.password}">
          <button type="submit" class="wv-go" id="wvGo">${T.createAccount}</button>
          <p class="wv-say" id="wvSay" role="status"></p>
        </form></div></div></li>
      <li class="wv-in" style="--i:2">${row('id="wvLocal"', '', T.welcomeLocal, T.welcomeLocalNote)}</li>
    </ul>
    <p class="wv-alt wv-in" style="--i:3" id="wvSwap"></p>
  </section>
  <section class="wv-pane" data-step="2"${ask ? ' hidden' : ''}>
    <h1 class="wv-title" tabindex="-1">${ask ? T.welcomeChoose : words(T.welcome)}</h1>
    <ul class="wv-list"${ask ? '' : ` aria-label="${T.welcomeChoose}"`}>
      <li class="wv-in" style="--i:1">${row('data-inst="piano"', KEYS, T.piano, T.pianoNote)}</li>
      <li class="wv-in" style="--i:2">${row('data-inst="guitar"', STRINGS, T.guitar, T.guitarNote)}</li>
      <li class="wv-in wv-soon" style="--i:3"><span>${T.moreSoon}</span></li>
    </ul>
    <p class="wv-alt wv-in" style="--i:4">${ask ? `<button type="button" class="wv-link" id="wvBack">${T.back}</button>` : ''}</p>
  </section>
</div></div><div class="wv-fade"></div></div>
<div class="wv-drop"></div>`;
  app.classList.add('welcoming');
  app.appendChild(el);
  /* what lies under the page is not to be reached with the keyboard either */
  const under = [...app.children].filter(part => part !== el);
  for (const part of under) part.inert = true;

  const $ = id => el.querySelector('#' + id), steps = el.querySelector('.wv-steps');
  let stage = null, started;
  const whenStarted = new Promise(done => { started = done; });

  /* ---------- the strip: the piano's stage showing through, or the guitar's tab over it ---------- */
  let tab = null, song = null, at = 0, loop = 0, putAway = 0;
  fetch(new URL('guitar/songs/aguado-small-piece-4.json', import.meta.url)).then(r => (r.ok ? r.json() : null)).then(s => { song = s; if (tab && s) tab.setSong(s); }, () => {});
  function tabOn() {
    clearTimeout(putAway);
    if (!tab) {
      tab = new Preview(el.querySelector('.wv-tab canvas'), {scrubStart() {}, scrub() {}, scrubEnd() {}, tap() {}}, '');
      tab.setLook({...TAB_THEMES[TAB.theme].tab, accent: TAB.accent, size: TAB.size / 100, spacing: TAB.spacing / 100, lowOnTop: TAB.lowOnTop, barNumbers: TAB.barNumbers, stringNames: TAB.stringNames});
      if (song) tab.setSong(song);
    }
    if (loop) return;
    if (still) { if (song) tab.draw(2.5); return; }
    /* the tab goes on from where it stood when it was last looked at, and from the start again at its end */
    const since = performance.now() - at * 1000;
    const draw = now => { loop = requestAnimationFrame(draw); if (song) { at = ((now - since) / 1000) % (tab.end + 1.2); tab.draw(at); } };
    loop = requestAnimationFrame(draw);
  }
  function tabOff() { cancelAnimationFrame(loop); loop = 0; }
  let showing = 'piano';
  function show(which) {
    if (which === showing) return;
    showing = which;
    el.classList.toggle('wv-guitar', which === 'guitar');
    /* the tab is drawn until it has faded out of sight */
    if (which === 'guitar') tabOn(); else putAway = setTimeout(tabOff, 450);
  }
  /* the run from dark to clear stops short of the keyboard, however tall the stage makes it */
  function fit() {
    if (!stage) return;
    const strip = el.querySelector('.wv-drop').offsetHeight;
    el.style.setProperty('--wv-fade', Math.max(24, Math.round((strip - stage.keysHeight()) * 0.72)) + 'px');
  }
  /* once more a moment after the window changes size, when the stage has been laid out for it */
  let settle = 0;
  const watch = new ResizeObserver(() => { fit(); clearTimeout(settle); settle = setTimeout(fit, 150); });
  watch.observe(el);

  /* ---------- the two questions ---------- */
  function to(n) {
    const from = el.querySelector('.wv-pane:not([hidden])'), next = el.querySelector(`.wv-pane[data-step="${n}"]`);
    if (from === next) return;
    from.classList.add('wv-leave');
    setTimeout(() => {
      from.hidden = true; from.classList.remove('wv-leave'); next.hidden = false;
      steps.lastElementChild.classList.toggle('wv-on', n === 2); steps.setAttribute('aria-label', fill(T.welcomeStep, {n}));
      if (n === 1) show('piano');
      next.querySelector('.wv-title').focus({preventScroll: true});
    }, 160);
  }

  /* The form under the first row makes a new account or signs in to one that exists; the line
     under the list turns it from one into the other, and the row's name follows. */
  const create = $('wvCreate'), fold = el.querySelector('.wv-fold'), say = $('wvSay'), go = $('wvGo');
  let fresh = true, working = false;
  function mode(isNew) {
    fresh = isNew;
    create.querySelector('.wv-name').textContent = fresh ? T.welcomeCreate : T.signIn;
    go.textContent = fresh ? T.createAccount : T.signIn;
    $('wvPass').autocomplete = fresh ? 'new-password' : 'current-password';
    $('wvSwap').innerHTML = `<span>${fresh ? T.welcomeHave : T.welcomeNew}</span><button type="button" class="wv-link" id="wvOther">${fresh ? T.signIn : T.welcomeCreate}</button>`;
  }
  function unfold(yes) {
    fold.classList.toggle('wv-open', yes); create.setAttribute('aria-expanded', String(yes));
    if (yes) setTimeout(() => $('wvEmail').focus({preventScroll: true}), 140);
  }
  mode(true);
  $('wvForm').addEventListener('submit', async e => {
    e.preventDefault();
    if (working) return;
    const mail = $('wvEmail').value.trim(), pass = $('wvPass').value;
    if (!mail || pass.length < 6) { say.textContent = T.errAccountFields; return; }
    working = true; go.disabled = true; say.textContent = '';
    await whenStarted;
    let why;
    try { why = await (await import('./account.js')).enterFrom(mail, pass, fresh); } catch (err) { why = T.errOffline; }
    working = false; go.disabled = false;
    /* signed in: on to the instrument, with no way back to a question that is now answered */
    if (!why) { $('wvPass').value = ''; if ($('wvBack')) $('wvBack').remove(); to(2); return; }
    say.textContent = why;
    /* an account that first has to be confirmed by email is then signed in to */
    if (why === T.confirmEmail) mode(false);
  });

  /* ---------- the instrument ---------- */
  let picked = '';
  for (const b of el.querySelectorAll('[data-inst]')) {
    for (const on of ['pointerenter', 'focus']) b.addEventListener(on, () => { if (!picked) show(b.dataset.inst); });
    for (const off of ['pointerleave', 'blur']) b.addEventListener(off, () => { if (!picked) show('piano'); });
  }
  async function pick(which, button) {
    if (picked) return;
    picked = which; show(which); button.classList.add('wv-picked');
    await Promise.all([whenStarted, wait(still ? 0 : 460)]);
    /* the questions go, and the strip goes dark for the moment in which the app is put in order */
    el.classList.add('wv-shut');
    await wait(260);
    welcomed();
    const tour = await import('./tour.js').catch(() => null);
    if (tour) tour.pend(which);
    /* the guitar's page takes this one's place, and comes up from under a dark sheet as the piano does */
    if (which !== 'piano') { handOver(); choose(which); return; }
    choose('piano');
    watch.disconnect(); clearTimeout(settle); tabOff(); clearTimeout(putAway);
    stage.hush(false);
    app.classList.remove('welcoming');
    for (const part of under) part.inert = false;
    /* the dark sheet now covers the whole window, then lifts off the app from the bottom up */
    el.style.setProperty('--wv-fade', '150px');
    el.classList.add('wv-full');
    await painted();
    el.classList.add('wv-rise');
    await wait(still ? 40 : 800);
    el.remove();
    if (tour) tour.begin('piano');
  }

  el.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b || picked) return;
    if (b === create) unfold(create.getAttribute('aria-expanded') !== 'true');
    else if (b.id === 'wvOther') { mode(!fresh); say.textContent = ''; unfold(true); }
    else if (b.id === 'wvLocal') to(2);
    else if (b.id === 'wvBack') to(1);
    else if (b.dataset.inst) pick(b.dataset.inst, b);
  });

  return {
    /* `mod` is the app (app.js), now running: its stage starts to play without a sound, and the strip clears */
    ready(mod) {
      stage = mod;
      stage.hush(true);
      fit();
      /* the stage is laid out again once the panels beside it are out of the way */
      for (const ms of [120, 600]) setTimeout(fit, ms);
      painted().then(() => el.classList.remove('wv-wait'));
      started();
    }
  };
}
