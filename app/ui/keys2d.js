/* The flat keyboard: ivory keys with thin gaps, black keys with a raised, rounded front edge and
   a soft shadow. Painted once per layout, then again only when the set of lit keys changes. */
import {S, clamp, mix, UI_FONT} from './settings.js';

const rr = (c, x, y, w, h, r) => { c.beginPath(); c.roundRect(x, y, w, h, r); };

/* Keys are drawn with y = 0 at the top of the keyboard. `color` is set while a key is held. */
function drawWhite(c, geo, m, color) {
  const {x, keyW, kbH} = geo, gap = clamp(keyW * 0.05, 1, 2), kx = x[m] + gap / 2, kw = keyW - gap;
  const body = c.createLinearGradient(0, 0, 0, kbH);
  if (color) {
    body.addColorStop(0, mix(color, '#000000', 0.4)); body.addColorStop(0.12, mix(color, '#000000', 0.08));
    body.addColorStop(1, mix(color, '#ffffff', 0.22));
  } else {
    body.addColorStop(0, '#cfcdbf'); body.addColorStop(0.04, '#fffef1'); body.addColorStop(0.93, '#fdfbec'); body.addColorStop(1, '#e4e1cf');
  }
  c.fillStyle = body; rr(c, kx, 0, kw, kbH - 1, [0, 0, 2.5, 2.5]); c.fill();
  if (color) {
    const dip = c.createLinearGradient(0, 0, 0, kbH * 0.7);
    dip.addColorStop(0, 'rgba(0,0,0,.3)'); dip.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = dip; c.fillRect(kx, 0, 2, kbH * 0.7); c.fillRect(kx + kw - 2, 0, 2, kbH * 0.7);
  }
  if (S.octaveLabels && m % 12 === 0 && keyW >= 15) {
    c.fillStyle = color ? 'rgba(0,0,0,.45)' : '#8d8b7e';
    c.font = '400 ' + clamp(keyW * 0.5, 9, 26) + 'px ' + UI_FONT; c.textAlign = 'center';
    c.fillText('C' + (m / 12 - 1), x[m] + keyW / 2, kbH - Math.max(7, keyW * 0.32));
  }
}
function drawBlack(c, geo, m, color) {
  const {x, w, bh} = geo, kx = x[m], kw = w[m], lip = color ? geo.lip * 0.5 : geo.lip;
  c.fillStyle = 'rgba(0,0,0,.26)';
  rr(c, kx + 1, 0, kw + (color ? 1.5 : 3), bh + (color ? 1.5 : 4), [0, 0, 4, 4]); c.fill();
  c.fillStyle = '#0b0b0b'; rr(c, kx, 0, kw, bh, [0, 0, 3, 3]); c.fill();
  const inset = Math.max(1.5, kw * 0.1), tx = kx + inset, tw = kw - inset * 2, th = bh - lip - inset;
  const mid = color ? mix(color, '#000000', 0.25) : '#232323', edge = color ? mix(color, '#000000', 0.55) : '#121212';
  const face = c.createLinearGradient(tx, 0, tx + tw, 0);
  face.addColorStop(0, edge); face.addColorStop(0.22, mid); face.addColorStop(0.78, mid); face.addColorStop(1, edge);
  c.fillStyle = face; c.fillRect(tx, 0, tw, th);
  const fade = c.createLinearGradient(0, 0, 0, th);
  fade.addColorStop(0, 'rgba(0,0,0,.4)'); fade.addColorStop(0.25, 'rgba(0,0,0,0)');
  c.fillStyle = fade; c.fillRect(tx, 0, tw, th);
  const nose = c.createLinearGradient(0, th, 0, th + lip), cr = Math.min(tw * 0.32, lip * 0.7);
  nose.addColorStop(0, color ? mix(color, '#ffffff', 0.3) : '#6e6e6e');
  nose.addColorStop(0.35, color ? mix(color, '#000000', 0.2) : '#3e3e3e');
  nose.addColorStop(1, color ? mix(color, '#000000', 0.6) : '#1c1c1c');
  c.fillStyle = nose; rr(c, tx, th, tw, lip, [cr, cr, 2, 2]); c.fill();
}

export class KeyboardPainter {
  constructor() {
    this.canvas = document.createElement('canvas');
    this.whites = document.createElement('canvas'); this.blacks = document.createElement('canvas');
    this.shown = null;
  }
  /* The height of the felt strip that shows when the edge light is off. */
  static felt(geo) { return clamp(geo.keyW * 0.24, 4, 12); }
  build(geo, W, dpr) {
    this.geo = geo; this.W = W; this.dpr = dpr;
    const pw = Math.max(1, Math.round(W * dpr)), ph = Math.max(1, Math.round(geo.kbH * dpr));
    for (const [layer, keys, draw] of [[this.whites, geo.whites, drawWhite], [this.blacks, geo.blacks, drawBlack]]) {
      layer.width = pw; layer.height = ph;
      const c = layer.getContext('2d');
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
      for (const m of keys) draw(c, geo, m, null);
    }
    this.canvas.width = pw; this.canvas.height = ph;
    this.shown = null;
  }
  /* Repaints when the lit keys differ from what is showing. Returns true when the picture changed. */
  paint(lit) {
    const geo = this.geo;
    let sig = S.edgeLight ? 'e' : 'f';
    if (S.keyLight) for (let m = geo.lo; m <= geo.hi; m++) if (lit[m]) sig += m + lit[m];
    if (sig === this.shown) return false;
    this.shown = sig;
    const g = this.canvas.getContext('2d'), {kbH, whites, blacks} = geo, W = this.W;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.fillStyle = '#060607'; g.fillRect(0, 0, W, kbH);
    g.drawImage(this.whites, 0, 0, W, kbH);
    if (S.keyLight) for (const m of whites) if (lit[m]) drawWhite(g, geo, m, lit[m]);
    g.drawImage(this.blacks, 0, 0, W, kbH);
    if (S.keyLight) for (const m of blacks) if (lit[m]) drawBlack(g, geo, m, lit[m]);
    const shade = g.createLinearGradient(0, 0, 0, 20);
    shade.addColorStop(0, 'rgba(0,0,0,.6)'); shade.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = shade; g.fillRect(0, 0, W, 20);
    if (!S.edgeLight) {
      const felt = KeyboardPainter.felt(geo);
      g.fillStyle = '#5e0d10'; g.fillRect(0, 0, W, felt);
      g.fillStyle = '#2b0506'; g.fillRect(0, 0, W, 1);
      g.fillStyle = '#9c2a2c'; g.fillRect(0, felt - 1.5, W, 1.5);
    }
    return true;
  }
}
