/* The look a person has chosen, remembered between runs, and the color helpers the stage shares. */

export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const isBlack = m => { const p = m % 12; return p === 1 || p === 3 || p === 6 || p === 8 || p === 10; };
export const PITCH = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
export const UI_FONT = '"IBM Plex Sans Condensed","Arial Narrow","Helvetica Neue",Arial,sans-serif';

export const rgb = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const mixCache = new Map();
export function mix(a, b, t) {
  const k = a + b + t;
  let v = mixCache.get(k);
  if (!v) {
    const A = rgb(a), B = rgb(b);
    v = '#' + A.map((x, i) => Math.round(x + (B[i] - x) * t).toString(16).padStart(2, '0')).join('');
    if (mixCache.size > 4000) mixCache.clear();
    mixCache.set(k, v);
  }
  return v;
}
export function rgba(h, a) { const c = rgb(h); return `rgba(${c[0]},${c[1]},${c[2]},${a})`; }
export function hslHex(h, s, l) {
  const a = s * Math.min(l, 1 - l);
  const f = n => { const k = (n + h / 30) % 12; return Math.round((l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))) * 255).toString(16).padStart(2, '0'); };
  return '#' + f(0) + f(8) + f(4);
}
const floats = new Map();
/* A hex color as three numbers from 0 to 1. */
export function rgbf(hex) {
  let v = floats.get(hex);
  if (!v) { v = rgb(hex).map(c => c / 255); if (floats.size > 600) floats.clear(); floats.set(hex, v); }
  return v;
}

export const PALETTES = [['#a5e85b', '#8cb1d6'], ['#f5b841', '#45c4e0'], ['#f07c8a', '#6c9bf2'], ['#c6e24a', '#b48cf2'], ['#f3eedf', '#f2793d']];
export const EXTRA = ['#9be564', '#f07c8a', '#b48cf2', '#f2793d', '#6c9bf2', '#e0d04a'];
export const LIVE_COLOR = '#f3eedf';
const reducedMotion = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
/* Pitch colors step around the circle of fifths, so keys that sound close look close. */
export const fifthsColors = () => Array.from({length: 12}, (_, pc) => hslHex(((pc * 7) % 12) * 30 + 40, 0.78, 0.62));

export const DEFAULTS = {
  colorBy: 'track', palette: 0, single: '#a5e85b', bg: '#1e1e1e', pitch: fifthsColors(),
  view: 'flat', tilt: 0.55, shape: 'bar', finish: 'matte', motion: 'fall', window: 3, width: 1,
  glow: 0, haze: false, octaveLines: true, noteNames: false, nameColor: 'black', nameSize: 0.5, spill: 0.5,
  sparks: !reducedMotion, amount: 0.27, lift: 0.5, drift: 0.4, smoke: 0,
  range: 'full', keyLight: true, edgeLight: true, octaveLabels: true, volume: 0.8, editHands: false,
  videoSize: 'hd', videoRate: '60', videoShape: 'wide', card: true,
  libOpen: true, lookOpen: false, sheetOpen: false, showLook: false, showNotes: false, lastSong: '', demo: true, fine: false, fineSpan: 5
};
const STORE = 'piano-visualizer-look-5';
export const S = Object.assign({}, DEFAULTS, {pitch: DEFAULTS.pitch.slice()});
try {
  const saved = JSON.parse(localStorage.getItem(STORE) || 'null');
  if (saved && typeof saved === 'object') for (const k in DEFAULTS) if (typeof saved[k] === typeof DEFAULTS[k]) S[k] = saved[k];
  if (!Array.isArray(S.pitch) || S.pitch.length !== 12) S.pitch = fifthsColors();
} catch (e) {}
S.editHands = false;
export const save = () => { try { localStorage.setItem(STORE, JSON.stringify(Object.assign({}, S, {editHands: false}))); } catch (e) {} };

const sharps = new Map();
/* Notes on black keys take a deeper shade of the same hue. */
export function sharpOf(hex) {
  const key = hex + S.finish;
  let v = sharps.get(key);
  if (!v) {
    const [r, g, b] = rgb(hex).map(c => c / 255), mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn, l = (mx + mn) / 2;
    const sat = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
    let h = 0;
    if (d) { h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; h *= 60; if (h < 0) h += 360; }
    v = hslHex(h, Math.min(1, sat * 1.1), l * (S.finish === 'gloss' ? 0.8 : 0.58));
    if (sharps.size > 400) sharps.clear();
    sharps.set(key, v);
  }
  return v;
}
