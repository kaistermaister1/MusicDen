/* The stage: notes falling onto the keyboard, the light and sparks around them, drawn on the
   graphics card. One frame is collected (what is on screen at a moment), then drawn flat or in 3D. */
import {S, clamp, isBlack, rgb, rgbf, sharpOf, PITCH, UI_FONT} from './settings.js';
import {program, target, dropTarget, QUAD_VS, QUAD_FS, POST_VS, PRE_FS, DOWN_FS, UP_FS, FINAL_FS, IMAGE_VS, IMAGE_FS, PACK_FS} from './gl.js';
import {KeyboardPainter} from './keys2d.js';
import {Solid} from './solid.js';

const MAX_QUADS = 24000, STRIDE = 12, MAX_PARTS = 3200;
export const SPARK = 0, DUST = 1, PUFF = 2;
const WHITE = [1, 1, 1];
/* Lettering, drawn large and scaled down: twelve cells of note names, then nine of key labels (C0 to C8). */
const CELL_W = 96, CELL_H = 56, CELL_FONT = 40, CELL_BASE = 44, CELLS = 21;

export class Stage {
  constructor(canvas) {
    this.canvas = canvas;
    const gl = this.gl = canvas.getContext('webgl2', {alpha: false, antialias: false, depth: false, stencil: false, powerPreference: 'high-performance'});
    if (!gl) throw new Error('webgl2');
    this.deep = !!gl.getExtension('EXT_color_buffer_float');
    this.W = 0; this.H = 0; this.dpr = 1; this.geo = null; this.piece = null;
    this.parts = []; this.puffCount = 0;
    this.lit = new Array(128).fill(null); this.mood = [236, 230, 214];
    this.list = []; this.refs = []; this.flares = []; this.live = [];
    this.lastT = 0; this.hover = null; this.hoverX = -1; this.hoverY = -1; this.capturing = false; this.preview = true;
    this.quads = new Float32Array(MAX_QUADS * STRIDE); this.quadCount = 0;
    this.keys = new KeyboardPainter();

    this.pQuad = program(gl, QUAD_VS, QUAD_FS, ['uRes', 'uDpr', 'uTime', 'uAtlas', 'uCells']);
    this.pPre = program(gl, POST_VS, PRE_FS, ['uTex', 'uBg', 'uNote']);
    this.pDown = program(gl, POST_VS, DOWN_FS, ['uTex', 'uTexel']);
    this.pUp = program(gl, POST_VS, UP_FS, ['uTex', 'uTexel']);
    this.pFinal = program(gl, POST_VS, FINAL_FS, ['uTex', 'uBloom', 'uStrength', 'uGrain']);
    this.pImage = program(gl, IMAGE_VS, IMAGE_FS, ['uTex', 'uRect', 'uRes']);
    this.pPack = program(gl, POST_VS, PACK_FS, ['uTex', 'uSize']);

    this.corners = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.corners); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
    this.vao = gl.createVertexArray(); gl.bindVertexArray(this.vao);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    this.buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf); gl.bufferData(gl.ARRAY_BUFFER, this.quads.byteLength, gl.DYNAMIC_DRAW);
    for (let i = 0; i < 3; i++) { gl.enableVertexAttribArray(i + 1); gl.vertexAttribPointer(i + 1, 4, gl.FLOAT, false, STRIDE * 4, i * 16); gl.vertexAttribDivisor(i + 1, 1); }
    this.imageVao = gl.createVertexArray(); gl.bindVertexArray(this.imageVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.corners);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    this.blank = gl.createVertexArray();
    gl.bindVertexArray(null);

    const flat = () => {
      const t = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, t);
      for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
      return t;
    };
    this.keysTex = flat(); this.atlasTex = flat();
    this.buildAtlas();
    this.solid = new Solid(this);
  }

  /* ---------- size and layout ---------- */
  setSize(W, H, dpr) {
    const gl = this.gl;
    const pw = Math.max(4, Math.round(W * dpr)), ph = Math.max(4, Math.round(H * dpr));
    /* the stage is measured in whole device pixels so the keyboard and the landing line stay sharp */
    this.W = pw / dpr; this.H = ph / dpr; this.dpr = dpr;
    if (this.canvas.width !== pw || this.canvas.height !== ph) { this.canvas.width = pw; this.canvas.height = ph; }
    for (const t of [this.scene, this.shot, this.pack, ...(this.mips || [])]) dropTarget(gl, t);
    const make = () => { this.scene = target(gl, pw, ph, this.deep); this.mips = [1, 2, 3, 4, 5].map(i => target(gl, Math.max(1, pw >> i), Math.max(1, ph >> i), this.deep)); };
    try { make(); } catch (e) { this.deep = false; make(); }
    this.shot = null; this.pack = null;
    this.pw = pw; this.ph = ph;
    this.solid.resize();
    this.layout();
  }
  setPiece(piece) {
    this.piece = piece; this.parts.length = 0; this.lastT = 0; this.hover = null;
    this.layout();
  }
  layout() {
    const {piece, W, H} = this;
    if (!piece || !W) return;
    const lo = S.range === 'fit' ? piece.fitLo : 21, hi = S.range === 'fit' ? piece.fitHi : 108;
    const whites = [], blacks = [], x = new Float32Array(128).fill(-1), w = new Float32Array(128);
    for (let m = lo; m <= hi; m++) if (!isBlack(m)) whites.push(m);
    const keyW = W / whites.length, bw = keyW * 0.6;
    const kbH = Math.round(clamp(keyW * 5.6, 64, H * 0.3) * this.dpr) / this.dpr;
    const bh = kbH * 0.63, lip = clamp(bh * 0.115, 5, 24);
    const nudge = {1: -0.1, 3: 0.1, 6: -0.14, 8: 0, 10: 0.14};
    whites.forEach((m, i) => { x[m] = i * keyW; w[m] = keyW; });
    for (let m = lo + 1; m < hi; m++) if (isBlack(m)) { x[m] = x[m - 1] + keyW - bw / 2 + nudge[m % 12] * bw; w[m] = bw; blacks.push(m); }
    this.geo = {lo, hi, whites, blacks, x, w, keyW, bw, kbH, bh, lip, hitY: H - kbH, lane: H - kbH};
    this.keys.build(this.geo, W, this.dpr);
    this.solid.layout();
  }
  /* Called when the lettering font has arrived or a keyboard setting changed. */
  refresh() { this.buildAtlas(); if (this.geo) this.keys.build(this.geo, this.W, this.dpr); }
  buildAtlas() {
    const gl = this.gl, c = document.createElement('canvas');
    c.width = CELL_W * CELLS; c.height = CELL_H;
    const g = c.getContext('2d');
    g.fillStyle = '#fff'; g.textAlign = 'center'; g.font = `600 ${CELL_FONT}px ${UI_FONT}`;
    /* note names are drawn with an outline of their own color as well, which makes them bolder than the typeface's heaviest weight */
    g.strokeStyle = '#fff'; g.lineWidth = 2.2; g.lineJoin = 'round';
    PITCH.forEach((name, i) => { g.strokeText(name, CELL_W * (i + 0.5), CELL_BASE); g.fillText(name, CELL_W * (i + 0.5), CELL_BASE); });
    g.font = `400 ${CELL_FONT}px ${UI_FONT}`;
    for (let i = 0; i < 9; i++) g.fillText('C' + i, CELL_W * (12.5 + i), CELL_BASE);
    gl.bindTexture(gl.TEXTURE_2D, this.atlasTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, c);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  }

  /* ---------- colors ---------- */
  colorOf(n) { return S.colorBy === 'track' ? this.piece.tracks[n.track].color : S.colorBy === 'pitch' ? S.pitch[n.midi % 12] : S.single; }

  /* ---------- sparks, dust and smoke ---------- */
  /* Particles live above the line where notes land: x across the keyboard, y up from the line,
     z toward the viewer (used in 3D only). Louder notes throw them faster and further. */
  spawn(kind, midi, color, vel) {
    const geo = this.geo, parts = this.parts;
    if (parts.length >= MAX_PARTS) return;
    const cx = geo.x[midi] + geo.w[midi] / 2, kw = geo.w[midi], up = 0.35 + S.lift * 1.3, push = 0.7 + 0.6 * vel, deep = S.view === 'solid';
    const r = Math.random;
    if (kind === SPARK) parts.push({kind, color, x: cx + (r() - 0.5) * kw * 0.7, y: 2, z: 0, vx: (r() - 0.5) * 130 * push, vy: (110 + r() * 330) * up * push, vz: deep ? (r() - 0.35) * 150 : 0, age: 0, life: 0.35 + r() * 0.6, size: 0.8 + r() * 0.9, seed: 0, heat: 1});
    else if (kind === DUST) parts.push({kind, color, x: cx + (r() - 0.5) * kw * 1.2, y: 1 + r() * 6, z: 0, vx: (r() - 0.5) * 46, vy: (18 + r() * 95) * up * push, vz: deep ? (r() - 0.4) * 60 : 0, age: 0, life: 1.1 + r() * 2.2, size: 0.8 + r() * 1.1, seed: r() * 6.28, heat: 1});
    else if (this.puffCount < 90) {
      this.puffCount++;
      parts.push({kind, color, x: cx + (r() - 0.5) * kw, y: 6, z: 0, vx: (r() - 0.5) * 16, vy: (16 + r() * 30) * (0.4 + S.lift) * push, vz: deep ? (r() - 0.4) * 14 : 0, age: 0, life: 1.8 + r() * 1.8, size: Math.max(26, kw * 1.3) * (0.7 + r() * 0.5 + vel * 0.5), seed: r() * 6.28, heat: 0.45 + vel * 0.9});
    }
  }
  burst(midi, color, vel) {
    const sparks = Math.round((3 + 9 * vel) * S.amount * 1.5), dust = Math.round((8 + 24 * vel) * S.amount * 1.6);
    for (let i = 0; i < sparks; i++) this.spawn(SPARK, midi, color, vel);
    for (let i = 0; i < dust; i++) this.spawn(DUST, midi, color, vel);
    const puffs = Math.round(S.smoke * (1 + 3 * vel));
    for (let i = 0; i < puffs; i++) this.spawn(PUFF, midi, color, vel);
  }
  trickle(midi, color, vel, dt) {
    const k = S.amount * (0.6 + 0.8 * vel) * dt;
    if (Math.random() < 34 * k) this.spawn(DUST, midi, color, vel);
    if (Math.random() < 7 * k) this.spawn(SPARK, midi, color, vel);
    if (Math.random() < 3 * S.smoke * (0.5 + vel) * dt) this.spawn(PUFF, midi, color, vel);
  }
  stepParts(dt, s) {
    const parts = this.parts, top = this.geo.lane + 40;
    /* Direction of the slow air current that dust follows at a point and moment. */
    const current = (x, y) => (Math.sin(x * 0.011 + s * 0.6) + Math.cos(y * 0.013 - s * 0.45) + Math.sin((x + y) * 0.007 + s * 0.3)) * 2.2;
    let puffs = 0;
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      p.age += dt;
      if (p.age >= p.life || p.y > top || p.y < -6) { parts[i] = parts[parts.length - 1]; parts.pop(); continue; }
      if (p.kind === SPARK) { p.vy -= 300 * dt; p.vx *= 1 - 1.2 * dt; p.vz *= 1 - 1.2 * dt; }
      else if (p.kind === DUST) {
        const a = current(p.x, this.geo.lane - p.y);
        p.vx += Math.cos(a) * S.drift * 250 * dt; p.vy -= (Math.sin(a) * S.drift * 250 - 16) * dt;
        p.vx *= 1 - 1.5 * dt; p.vy *= 1 - 1.1 * dt; p.vz *= 1 - 1.3 * dt;
      } else { puffs++; p.x += Math.sin(p.seed + p.age * 1.3) * 10 * S.drift * dt; }
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
    }
    this.puffCount = puffs;
  }

  /* ---------- playing by hand ---------- */
  liveOn(midi, color, vel, clock) {
    const note = {midi, start: clock, end: null, color, vel};
    this.live.push(note);
    if (S.sparks && this.geo && this.geo.x[midi] >= 0) this.burst(midi, color, vel);
    return note;
  }

  /* ---------- what is on screen this frame ---------- */
  firstFrom(time) {
    const a = this.piece.notes; let lo = 0, hi = a.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (a[m].start < time) lo = m + 1; else hi = m; }
    return lo;
  }
  /* Fills `list` with five numbers per note: key, distance from the landing line to its near
     and far end, color, muted. `refs` holds the note each came from; null for notes played by hand. */
  collect(t, dt, clock, playing) {
    const {geo, piece, list, refs, flares, lit, live, mood} = this, {x, lane} = geo;
    const pps = lane / S.window, fall = S.motion === 'fall', a = piece.notes;
    list.length = 0; refs.length = 0; flares.length = 0; lit.fill(null);
    for (let i = this.firstFrom(t - piece.longest - (fall ? 0 : S.window)); i < a.length; i++) {
      const n = a[i];
      if (fall ? n.start >= t + S.window : n.start > t) break;
      if (x[n.midi] < 0) continue;
      let near, far;
      if (fall) { near = (n.start - t) * pps; far = (n.end - t) * pps; if (far < 0) continue; }
      else { far = (t - n.start) * pps; near = Math.max(0, t - n.end) * pps; if (near > lane) continue; }
      const quiet = piece.tracks[n.track].muted, color = this.colorOf(n);
      if (n.start <= t && n.end > t) {
        lit[n.midi] = color;
        if (!quiet) {
          flares.push({midi: n.midi, color, vel: n.vel, age: t - n.start});
          if (S.sparks && playing) { if (n.start > this.lastT) this.burst(n.midi, color, n.vel); else this.trickle(n.midi, color, n.vel, dt); }
        }
      }
      list.push(n.midi, near, far, isBlack(n.midi) ? sharpOf(color) : color, quiet); refs.push(n);
    }
    for (let i = live.length - 1; i >= 0; i--) {
      const n = live[i];
      const far = (clock - n.start) * pps, near = n.end == null ? 0 : (clock - n.end) * pps;
      if (near > lane) { live.splice(i, 1); continue; }
      if (x[n.midi] < 0) continue;
      if (n.end == null) { lit[n.midi] = n.color; flares.push({midi: n.midi, color: n.color, vel: n.vel, age: clock - n.start}); if (S.sparks) this.trickle(n.midi, n.color, n.vel, dt); }
      list.push(n.midi, near, far, isBlack(n.midi) ? sharpOf(n.color) : n.color, false); refs.push(null);
    }
    /* the edge and haze take on a running blend of whatever is sounding */
    let aim = rgb(S.colorBy === 'one' ? S.single : S.colorBy === 'pitch' ? '#ece6d6' : piece.tracks[0].color);
    if (flares.length) {
      aim = [0, 0, 0];
      for (const f of flares) { const c = rgb(f.color); aim[0] += c[0]; aim[1] += c[1]; aim[2] += c[2]; }
      aim = aim.map(v => v / flares.length);
    }
    const ease = 1 - Math.exp(-dt * 5);
    for (let i = 0; i < 3; i++) mood[i] += (aim[i] - mood[i]) * ease;
  }
  /* Where a note sits across the keyboard: left edge, width, corner radius for a given length. */
  noteBox(midi, h) {
    const kw = this.geo.w[midi], w = kw * S.width;
    return [this.geo.x[midi] + (kw - w) / 2, w, Math.max(0, Math.min(S.shape === 'pill' ? w / 2 : Math.min(w * 0.17, 9), h / 2, w / 2))];
  }
  /* The index in `list` of the note under a point, sharps first because they sit on top. -1 when none. */
  noteAt(px, py) {
    if (!this.geo) return -1;
    if (S.view === 'solid') return this.solid.noteAt(px, py);
    const {list, refs, geo} = this;
    if (py >= geo.hitY) return -1;
    for (const wantBlack of [true, false]) {
      for (let i = list.length - 5; i >= 0; i -= 5) {
        if (!refs[i / 5] || isBlack(list[i]) !== wantBlack) continue;
        const top = Math.max(0, geo.hitY - list[i + 2]), bottom = Math.min(geo.hitY, geo.hitY - list[i + 1]), [x, w] = this.noteBox(list[i], bottom - top);
        const slack = Math.max(0, (12 - (bottom - top)) / 2);
        if (px >= x && px <= x + w && py >= top - slack && py <= bottom + slack) return i;
      }
    }
    return -1;
  }
  /* The key under a point, or -1. */
  keyAt(px, py) {
    const geo = this.geo;
    if (!geo) return -1;
    if (S.view === 'solid') return this.solid.keyAt(px, py);
    if (py < geo.hitY) return -1;
    if (py < geo.hitY + geo.bh) for (const m of geo.blacks) if (px >= geo.x[m] && px < geo.x[m] + geo.w[m]) return m;
    const i = Math.floor(px / geo.keyW);
    return i >= 0 && i < geo.whites.length ? geo.whites[i] : -1;
  }

  /* ---------- drawing ---------- */
  /* One shape for the card to draw; see the list of modes beside the shader. */
  quad(x, y, w, h, c, a, radius, mode, angle, extra) {
    if (this.quadCount >= MAX_QUADS) return;
    const q = this.quads, o = this.quadCount++ * STRIDE;
    q[o] = x; q[o + 1] = y; q[o + 2] = w; q[o + 3] = h;
    q[o + 4] = c[0]; q[o + 5] = c[1]; q[o + 6] = c[2]; q[o + 7] = a;
    q[o + 8] = radius; q[o + 9] = mode; q[o + 10] = angle; q[o + 11] = extra;
  }
  /* Draws the shapes gathered so far into the scene. `keep` leaves the note mask in the alpha
     channel untouched; `clip` limits drawing to a band of the stage given as [top, bottom]. */
  flush(clock, keep, clip) {
    const gl = this.gl;
    if (!this.quadCount) return;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.scene.fb); gl.viewport(0, 0, this.pw, this.ph);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf); gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.quads, 0, this.quadCount * STRIDE);
    gl.enable(gl.BLEND);
    if (keep) gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ONE); else gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    if (clip) { gl.enable(gl.SCISSOR_TEST); const y0 = Math.round(clip[0] * this.dpr), y1 = Math.round(clip[1] * this.dpr); gl.scissor(0, this.ph - y1, this.pw, Math.max(0, y1 - y0)); }
    gl.useProgram(this.pQuad.p);
    gl.uniform2f(this.pQuad.uRes, this.W, this.H); gl.uniform1f(this.pQuad.uDpr, this.dpr); gl.uniform1f(this.pQuad.uTime, clock % 3600);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.atlasTex); gl.uniform1i(this.pQuad.uAtlas, 0); gl.uniform1f(this.pQuad.uCells, CELLS);
    gl.bindVertexArray(this.vao); gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, this.quadCount);
    gl.bindVertexArray(null); gl.disable(gl.BLEND); gl.disable(gl.SCISSOR_TEST);
    this.quadCount = 0;
  }
  pass(prog, dest, tex, set) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, dest ? dest.fb : null);
    gl.viewport(0, 0, dest ? dest.w : this.pw, dest ? dest.h : this.ph);
    gl.useProgram(prog.p);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tex); gl.uniform1i(prog.uTex, 0);
    if (set) set();
    gl.bindVertexArray(this.blank);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
  /* Blurs whatever gives off light in the scene into the glow. */
  bloom() {
    const gl = this.gl, m = this.mips, bg = rgbf(S.bg);
    this.pass(this.pPre, m[0], this.scene.tex, () => { gl.uniform3f(this.pPre.uBg, bg[0], bg[1], bg[2]); gl.uniform1f(this.pPre.uNote, S.finish === 'gloss' ? 0.7 : 0.5); });
    for (let i = 1; i < 5; i++) this.pass(this.pDown, m[i], m[i - 1].tex, () => gl.uniform2f(this.pDown.uTexel, 1 / m[i - 1].w, 1 / m[i - 1].h));
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
    for (let i = 3; i >= 0; i--) this.pass(this.pUp, m[i], m[i + 1].tex, () => gl.uniform2f(this.pUp.uTexel, 1 / m[i + 1].w, 1 / m[i + 1].h));
    gl.disable(gl.BLEND);
  }
  /* Puts the finished scene on screen, with the glow laid around the notes. */
  finish() {
    const gl = this.gl;
    if (this.capturing && !this.shot) { this.shot = target(gl, this.pw, this.ph, false, true); this.pack = target(gl, this.pw / 4, this.ph * 3 / 2, false, true); }
    this.pass(this.pFinal, this.capturing ? this.shot : null, this.scene.tex, () => {
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.mips[0].tex); gl.uniform1i(this.pFinal.uBloom, 1);
      gl.uniform1f(this.pFinal.uStrength, S.glow * 0.4);
      gl.uniform1f(this.pFinal.uGrain, S.glow > 0 || S.view === 'solid' ? 1 : 0);
    });
    if (!this.capturing) return;
    this.pass(this.pPack, this.pack, this.shot.tex, () => gl.uniform2i(this.pPack.uSize, this.pw, this.ph));
    if (this.preview) {
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.shot.fb); gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
      gl.blitFramebuffer(0, 0, this.pw, this.ph, 0, 0, this.pw, this.ph, gl.COLOR_BUFFER_BIT, gl.NEAREST);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }
  /* Copies the frame just drawn, packed for the video encoder, into `into` (width x height x 1.5 bytes). */
  readFrame(into) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.pack.fb);
    gl.readPixels(0, 0, this.pack.w, this.pack.h, gl.RGBA, gl.UNSIGNED_BYTE, into);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }
  /* While set, every frame is also packed for the video encoder, ready for readFrame. */
  setCapturing(on) {
    this.capturing = on;
    if (!on) { dropTarget(this.gl, this.shot); dropTarget(this.gl, this.pack); this.shot = this.pack = null; }
  }

  /* One frame. `t` is the moment in the piece, `clock` a steady clock for effects and notes played by hand.
     While frames are being captured, `preview` says whether this one is also shown on screen. */
  render({t, dt, clock, playing}, preview = true) {
    if (!this.geo || !this.piece) return;
    this.preview = preview; this.dt = dt;
    this.collect(t, dt, clock, playing);
    this.stepParts(dt, clock);
    this.hover = null;
    if (S.editHands && this.hoverY >= 0 && !this.capturing) { const i = this.noteAt(this.hoverX, this.hoverY); if (i >= 0) this.hover = i; }
    if (S.view === 'solid') this.solid.draw(clock); else { this.solid.busy = false; this.drawFlat(clock); }
    this.finish();
    this.lastT = t;
  }

  drawFlat(clock) {
    const gl = this.gl, {geo, W, list, flares, mood, parts} = this, {x, w, keyW, hitY, whites, kbH} = geo;
    const moodC = [mood[0] / 255, mood[1] / 255, mood[2] / 255], bg = rgbf(S.bg);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.scene.fb); gl.viewport(0, 0, this.pw, this.ph);
    gl.clearColor(bg[0], bg[1], bg[2], 0); gl.clear(gl.COLOR_BUFFER_BIT);

    if (S.octaveLines) {
      for (const m of whites) {
        const pc = m % 12;
        if ((pc === 0 || pc === 5) && x[m] > 0) this.quad(Math.round(x[m]) - 0.5, 0, 1, hitY, WHITE, pc === 0 ? 0.1 : 0.055, 0, 7, 0, 0);
      }
    }
    const lum = Math.min(1, S.glow * 1.6);
    if (S.haze) { const rise = Math.min(240, hitY * 0.42); this.quad(0, hitY - rise, W, rise, moodC, 0.4, 0, 5, 0, 0); }
    for (const f of flares) {
      const cx = x[f.midi] + w[f.midi] / 2, c = rgbf(f.color);
      if (S.haze) { const pw = Math.max(keyW * 5, 80), ph = Math.min(300, hitY * 0.5); this.quad(cx - pw / 2, hitY - ph, pw, ph, c, 0.38, 0, 6, 0, f.midi * 1.37); }
      if (lum > 0) {
        const rad = Math.max(keyW * 2.2, 30);
        this.quad(cx - rad, hitY - rad, rad * 2, rad * 2, c, 0.42 * lum, 0, 3, 0, 0);
        this.quad(cx - rad * 0.4, hitY - rad * 0.4, rad * 0.8, rad * 0.8, WHITE, 0.14 * lum, 0, 3, 0, 0);
      }
    }
    for (const p of parts) {
      if (p.kind !== PUFF) continue;
      const u = p.age / p.life, rad = p.size * (1 + u * 1.7);
      this.quad(p.x - rad, hitY - p.y - rad, rad * 2, rad * 2, rgbf(p.color), 0.17 * p.heat * Math.sin(Math.PI * Math.pow(u, 0.6)), 0, 10, 0, p.seed);
    }
    const mode = S.shape === 'outline' ? 2 : S.finish === 'gloss' ? 1 : 0, extra = mode === 2 ? 2 : S.shape === 'pill' ? 1 : 0.6;
    for (const wantBlack of [false, true]) {
      for (let i = 0; i < list.length; i += 5) {
        const midi = list[i], h = list[i + 2] - list[i + 1];
        if (h <= 0 || isBlack(midi) !== wantBlack) continue;
        const [nx, nw, r] = this.noteBox(midi, h), quiet = list[i + 4];
        this.quad(nx + 0.5, hitY - list[i + 2], nw - 1, h, rgbf(list[i + 3]), quiet ? 0.3 : 1, r, quiet && mode === 1 ? 0 : mode, 0, extra);
      }
    }
    if (S.noteNames) {
      /* names in the chosen color and size (10 to 20 pixels tall), smaller where a note is too narrow for them */
      const ink = S.nameColor === 'white' ? [1, 1, 1] : [8 / 255, 8 / 255, 10 / 255], want = 10 + 10 * S.nameSize;
      for (let i = 0; i < list.length; i += 5) {
        const midi = list[i], top = hitY - list[i + 2], bottom = hitY - list[i + 1], [nx, nw] = this.noteBox(midi, bottom - top);
        const px = Math.min(want, nw * (isBlack(midi) ? 0.62 : 0.9));
        if (nw < 12 || bottom - top < px + 4) continue;
        const k = px / CELL_FONT, base = S.motion === 'fall' ? Math.min(bottom, hitY) - 4 - px * 0.1 : top + px + 2;
        this.quad(nx + nw / 2 - CELL_W * k / 2, base - CELL_BASE * k, CELL_W * k, CELL_H * k, S.shape === 'outline' ? rgbf(list[i + 3]) : ink, (S.shape === 'outline' ? 1 : 0.92) * (list[i + 4] ? 0.3 : 1), midi % 12, 9, 0, 0);
      }
    }
    for (const p of parts) {
      const c = rgbf(p.color);
      if (p.kind === SPARK) {
        const len = clamp(Math.hypot(p.vx, p.vy) * 0.04, 4, 30), th = p.size * 1.5 + 1.5;
        this.quad(p.x - len / 2, hitY - p.y - th / 2, len, th, c, (1 - p.age / p.life) * 2.4, 0, 4, Math.atan2(-p.vy, p.vx), 0);
      } else if (p.kind === DUST) {
        const sz = p.size * 3.4, u = p.age / p.life;
        this.quad(p.x - sz / 2, hitY - p.y - sz / 2, sz, sz, c, Math.min(1, u * 9) * Math.pow(1 - u, 1.3) * (0.62 + 0.38 * Math.sin(p.seed + p.age * 9)) * 2, 0, 4, 0, 0);
      }
    }
    if (S.edgeLight) {
      this.quad(0, hitY - 8, W, 16, moodC, 0.9, 0, 8, 0, 0);
      for (const f of flares) {
        const cx = x[f.midi] + w[f.midi] / 2, core = Math.max(keyW * 0.9, 12);
        this.quad(cx - keyW * 3.2, hitY - 6, keyW * 6.4, 12, rgbf(f.color), 0.8, 0, 3, 0, 0);
        this.quad(cx - core, hitY - 4, core * 2, 8, WHITE, 0.45, 0, 3, 0, 0);
      }
    }
    this.flush(clock, false);
    if (S.glow > 0) this.bloom();

    /* the keyboard goes in after the glow is gathered, so it takes the glow's light without adding to it */
    if (this.keys.paint(this.lit)) {
      gl.bindTexture(gl.TEXTURE_2D, this.keysTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.keys.canvas);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.scene.fb); gl.viewport(0, 0, this.pw, this.ph);
    gl.useProgram(this.pImage.p);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.keysTex); gl.uniform1i(this.pImage.uTex, 0);
    gl.uniform4f(this.pImage.uRect, 0, hitY, W, kbH); gl.uniform2f(this.pImage.uRes, W, this.H);
    gl.bindVertexArray(this.imageVao); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4); gl.bindVertexArray(null);

    if (S.spill > 0) {
      const rad = keyW * 3;
      for (const f of flares) this.quad(x[f.midi] + w[f.midi] / 2 - rad, hitY - rad, rad * 2, rad * 2, rgbf(f.color), 0.68 * S.spill, 0, 12, 0, 0);
      this.flush(clock, true, [hitY + (S.edgeLight ? 0 : KeyboardPainter.felt(geo)), hitY + kbH]);
    }
    if (S.edgeLight) {
      this.quad(0, hitY, W, kbH * 0.45, moodC, 0.3, 0, 11, 0, 0);
      this.quad(0, hitY - 1.5, W, 2, [(mood[0] * 0.45 + 140) / 255, (mood[1] * 0.45 + 140) / 255, (mood[2] * 0.45 + 140) / 255], 1, 0, 0, 0, 0);
      this.flush(clock, true);
    }
    if (this.hover != null) {
      const i = this.hover, top = hitY - list[i + 2], h = list[i + 2] - list[i + 1], [nx, nw, r] = this.noteBox(list[i], h);
      this.quad(nx - 2, top - 2, nw + 4, h + 4, WHITE, 1, r + 2, 13, 0, 2);
      this.flush(clock, true, [0, hitY]);
    }
  }
}
