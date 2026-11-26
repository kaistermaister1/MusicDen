/* What a person can change about how tabs look and sound, what is remembered between visits, and
   the Settings panel that changes it. */
import {T} from './strings.js';
import {choose} from '../instrument.js';

export const DEFAULTS = {
  theme: 'dark',        /* one of THEMES */
  accent: '#f0a030',    /* the playhead and the notes sounding under it */
  size: 100,            /* fret numbers and string spacing, percent */
  spacing: 100,         /* how far apart notes sit along the line, percent */
  lowOnTop: false,      /* the low E string drawn on top instead of the high E */
  barNumbers: true,
  stringNames: true,
  ring: true,           /* a note rings on after its written end, as a plucked string does */
  click: false          /* a click on every beat while playing */
};

/* Each theme: the colors of the panels and controls, then of the tab itself. */
export const THEMES = {
  dark: {scheme: 'dark', ebony: '#101012', panel: '#17181b', line: '#2b2d32', ivory: '#ece6d6', dim: '#a09c90', row: '#1c1d21', rowOn: '#212226',
    tab: {bg: '#121212', string: '#77756e', ink: '#ffffff', bar: '#e6e2d6', dim: '#8d897e'}},
  black: {scheme: 'dark', ebony: '#000000', panel: '#0b0b0c', line: '#26272b', ivory: '#f2efe6', dim: '#9a968a', row: '#131315', rowOn: '#1a1a1d',
    tab: {bg: '#000000', string: '#6a6862', ink: '#ffffff', bar: '#e6e2d6', dim: '#85827a'}},
  light: {scheme: 'light', ebony: '#e6e4de', panel: '#f3f1ec', line: '#cfccc3', ivory: '#1b1b1d', dim: '#66635b', row: '#eae8e2', rowOn: '#dfdcd4',
    tab: {bg: '#fbfaf6', string: '#a3a097', ink: '#111112', bar: '#3a3935', dim: '#77746b'}},
  paper: {scheme: 'light', ebony: '#e3d9c2', panel: '#eee5d0', line: '#cdc1a5', ivory: '#2a2418', dim: '#6f6552', row: '#e6dcc5', rowOn: '#dbd0b6',
    tab: {bg: '#f6efdd', string: '#a89c80', ink: '#231d12', bar: '#4a402c', dim: '#7d725c'}}
};

const KEY = 'gt.settings';
export function load() {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch { saved = {}; }
  const s = {...DEFAULTS};
  for (const k of Object.keys(DEFAULTS)) if (typeof saved[k] === typeof DEFAULTS[k]) s[k] = saved[k];
  if (!THEMES[s.theme]) s.theme = DEFAULTS.theme;
  if (!/^#[0-9a-f]{6}$/i.test(s.accent)) s.accent = DEFAULTS.accent;
  s.size = Math.min(160, Math.max(70, s.size)); s.spacing = Math.min(200, Math.max(50, s.spacing));
  return s;
}
export function save(s) { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* nothing is kept */ } }

/* Puts a theme's colors on the page's panels and controls. */
export function paintPage(s) {
  const t = THEMES[s.theme], root = document.documentElement.style;
  for (const k of ['ebony', 'panel', 'line', 'ivory', 'dim', 'row']) root.setProperty('--' + k, t[k]);
  root.setProperty('--row-on', t.rowOn); root.setProperty('--tab', t.tab.bg); root.setProperty('--accent', s.accent);
  root.setProperty('color-scheme', t.scheme);
  const meta = document.querySelector('meta[name=theme-color]');
  if (meta) meta.content = t.panel;
}

/* Builds the panel's rows in `box`. `s` is the live settings object; `changed(key)` is called after
   each change. Returns {refresh, section}: `section(title)` adds a titled group and returns it, for
   other parts of the app that have settings of their own. */
export function settingsPanel(box, s, changed) {
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const head = el('div', 'insp-head'); head.append(el('h2', '', T.settings)); box.append(head);
  const body = el('div', 'insp-body'); box.append(body);
  const fresh = [];
  const section = title => { const sec = el('section', 'set'); sec.append(el('h3', '', title)); body.append(sec); return sec; };
  const row = (sec, label, control) => { const r = el('label', 'set-row'); r.append(el('span', 'set-name', label), control); sec.append(r); return r; };
  const set = (k, v) => { s[k] = v; save(s); changed(k); };

  const pick = (sec, label, k, options) => {
    const c = el('select');
    for (const [v, name] of options) { const o = el('option', '', name); o.value = v; c.append(o); }
    c.addEventListener('change', () => set(k, c.value));
    fresh.push(() => { c.value = s[k]; });
    row(sec, label, c);
  };
  const slide = (sec, label, k, min, max, step) => {
    const wrap = el('span', 'set-slide'), c = el('input'), val = el('span', 'set-val');
    c.type = 'range'; c.min = min; c.max = max; c.step = step;
    const show = () => { c.value = s[k]; val.textContent = T.percent.replace('{n}', s[k]); c.style.setProperty('--p', (s[k] - min) / (max - min) * 100 + '%'); };
    c.addEventListener('input', () => { set(k, +c.value); show(); });
    fresh.push(show); wrap.append(c, val); row(sec, label, wrap);
  };
  const tick = (sec, label, k) => {
    const c = el('input'); c.type = 'checkbox';
    c.addEventListener('change', () => set(k, c.checked));
    fresh.push(() => { c.checked = !!s[k]; });
    row(sec, label, c);
  };
  const color = (sec, label, k) => {
    const c = el('input'); c.type = 'color';
    c.addEventListener('input', () => set(k, c.value));
    fresh.push(() => { c.value = s[k]; });
    row(sec, label, c);
  };

  /* first, the instrument the app is set to: choosing the piano opens its page in place of this one */
  {
    const sec = el('section', 'set'), c = el('select');
    for (const k of ['piano', 'guitar']) { const o = el('option', '', T.instruments[k]); o.value = k; c.append(o); }
    c.id = 'instrument'; c.value = 'guitar';
    c.addEventListener('change', () => choose(c.value));
    body.append(sec); row(sec, T.setInstrument, c);
  }

  const look = section(T.setLook);
  pick(look, T.setTheme, 'theme', Object.keys(THEMES).map(k => [k, T.themes[k]]));
  color(look, T.setAccent, 'accent');
  const tab = section(T.setTab);
  slide(tab, T.setSize, 'size', 70, 160, 5);
  slide(tab, T.setSpacing, 'spacing', 50, 200, 5);
  tick(tab, T.setLowOnTop, 'lowOnTop');
  tick(tab, T.setBarNumbers, 'barNumbers');
  tick(tab, T.setStringNames, 'stringNames');
  const sound = section(T.setSound);
  tick(sound, T.setRing, 'ring');
  tick(sound, T.setClick, 'click');

  const foot = el('div', 'insp-foot'), reset = el('button', 'tb', T.setReset);
  reset.type = 'button';
  reset.addEventListener('click', () => { for (const k of Object.keys(DEFAULTS)) s[k] = DEFAULTS[k]; save(s); refresh(); changed(null); });
  foot.append(reset); box.append(foot);

  function refresh() { for (const f of fresh) f(); }
  refresh();
  return {refresh, section, row};
}
