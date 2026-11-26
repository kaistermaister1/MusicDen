/* The guitar: recorded notes of an acoustic guitar, one for each pitch a song needs, played through
   Web Audio. A pitch with no recording of its own borrows the nearest one, played faster or slower.
   Where the recordings can't be had, a plucked string worked out from scratch stands in. */

const AC = window.AudioContext || window.webkitAudioContext;
/* where the recordings are, beside the piano's among the app's own files */
const RECORDINGS = '../../assets/guitar/';

export class Guitar {
  constructor() {
    this.ctx = null; this.master = null; this.volume = 0.8;
    this.list = null;            /* promise of {midi number: file name}, or null when there is none */
    this.files = new Map();      /* file name -> promise of its sound, or null when it can't be had */
    this.voices = new Map();     /* pitch -> {buffer, rate, gain, offset} */
    this.live = new Set();       /* notes sounding or about to */
    this.onString = [];          /* the last note started on each string */
  }

  context() {
    if (!this.ctx) {
      this.ctx = new AC({latencyHint: 'interactive'});
      this.master = this.ctx.createGain(); this.master.gain.value = this.volume;
      const comp = this.ctx.createDynamicsCompressor();
      comp.threshold.value = -16; comp.knee.value = 14; comp.ratio.value = 3; comp.attack.value = 0.006; comp.release.value = 0.22;
      this.master.connect(comp); comp.connect(this.ctx.destination);
    }
    return this.ctx;
  }

  /* Must be called from inside a tap or click, or a phone keeps the sound off. */
  unlock() { const c = this.context(); return c.state === 'running' ? Promise.resolve() : c.resume().catch(() => {}); }
  now() { return this.context().currentTime; }
  /* how long after the clock says so a sound is actually heard */
  latency() { const c = this.ctx; return c ? (c.outputLatency || c.baseLatency || 0) : 0; }
  setVolume(v) { this.volume = v; if (this.master) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.02); }

  /* Gets the sounds for these pitches ready; resolves when every one can be played. */
  async load(pitches) {
    this.context();
    if (!this.list) this.list = fetch(RECORDINGS + 'manifest.json').then(r => r.ok ? r.json() : null).then(m => m && m.notes ? m.notes : null).catch(() => null);
    const notes = await this.list, have = notes ? Object.keys(notes).map(Number).filter(Number.isFinite) : [];
    await Promise.all([...new Set(pitches)].filter(p => Number.isFinite(p) && !this.voices.has(p)).map(async p => {
      let voice = null;
      if (have.length) {
        const near = have.reduce((a, b) => Math.abs(b - p) < Math.abs(a - p) ? b : a);
        const rec = await this.file(notes[near]);
        if (rec) voice = {buffer: rec.buffer, gain: rec.gain, offset: rec.offset, rate: Math.pow(2, (p - near) / 12)};
      }
      this.voices.set(p, voice || {buffer: this.pluck(p), gain: 1, offset: 0, rate: 1});
    }));
  }

  /* One recording, with how much to turn it up so all are equally loud and where its note begins. */
  file(name) {
    if (!this.files.has(name)) this.files.set(name, fetch(RECORDINGS + name)
      .then(r => { if (!r.ok) throw new Error(name); return r.arrayBuffer(); })
      .then(bytes => new Promise((yes, no) => this.ctx.decodeAudioData(bytes, yes, no)))
      .then(buffer => {
        const d = buffer.getChannelData(0); let peak = 0;
        for (let i = 0; i < d.length; i++) { const a = d[i] < 0 ? -d[i] : d[i]; if (a > peak) peak = a; }
        let first = 0; const floor = peak * 0.03;
        while (first < d.length && Math.abs(d[first]) < floor) first++;
        return {buffer, gain: peak ? Math.min(4, 0.9 / peak) : 1, offset: Math.max(0, first / buffer.sampleRate - 0.004)};
      })
      .catch(() => null));
    return this.files.get(name);
  }

  /* A plucked string at this pitch: a burst of noise going round a delay as long as one cycle,
     losing a little of its top each time round (Karplus-Strong). */
  pluck(pitch) {
    const sr = this.ctx.sampleRate, freq = 440 * Math.pow(2, (pitch - 69) / 12);
    const ring = Math.min(4.5, Math.max(1.4, 4.5 - (pitch - 40) * 0.07));
    const n = Math.floor(sr * (ring + 0.3)), buffer = this.ctx.createBuffer(1, n, sr), out = buffer.getChannelData(0);
    const delay = sr / freq - 0.5, N = Math.max(2, Math.floor(delay)), frac = delay - N, C = (1 - frac) / (1 + frac);
    const loop = new Float32Array(N);
    /* the pluck: softened noise, with the hollow a pick leaves a fifth of the way along the string */
    let soft = 0; const raw = new Float32Array(N), gap = Math.max(1, Math.round(N * 0.2));
    for (let i = 0; i < N; i++) { soft = soft * 0.55 + (Math.random() * 2 - 1) * 0.45; raw[i] = soft; }
    for (let i = 0; i < N; i++) loop[i] = raw[i] - 0.6 * raw[(i + N - gap) % N];
    const keep = Math.pow(10, -3 / (freq * ring));
    let p = 0, before = 0, passIn = 0, passOut = 0, peak = 0;
    for (let i = 0; i < n; i++) {
      const cur = loop[p], low = 0.5 * (cur + before); before = cur;
      const pass = C * low + passIn - C * passOut; passIn = low; passOut = pass;
      out[i] = cur; loop[p] = pass * keep;
      if (++p === N) p = 0;
      const a = cur < 0 ? -cur : cur; if (a > peak) peak = a;
    }
    const scale = peak ? 0.8 / peak : 1, rise = Math.floor(sr * 0.002);
    for (let i = 0; i < n; i++) out[i] *= scale * (i < rise ? i / rise : 1);
    return buffer;
  }

  /* Starts a note at a time on the audio clock. It sounds for `held` seconds, then fades; a note
     already ringing on the same string is stopped as this one begins, as a finger or pick would. */
  noteOn(when, pitch, velocity, string, held) {
    const v = this.voices.get(pitch), ctx = this.ctx;
    if (!v) return;
    const src = ctx.createBufferSource(), g = ctx.createGain();
    src.buffer = v.buffer; src.playbackRate.value = v.rate;
    const level = v.gain * 0.6 * (0.2 + 0.8 * Math.pow(Math.min(127, Math.max(1, velocity)) / 127, 1.4));
    const end = when + Math.max(held, 0.15);
    g.gain.setValueAtTime(level, when);
    g.gain.setTargetAtTime(0, end, 0.09);
    src.connect(g); g.connect(this.master);
    src.start(when, v.offset); src.stop(end + 0.7);
    const voice = {src, g, level, when, end};
    const prev = this.onString[string];
    if (prev && this.live.has(prev) && prev.end > when) this.cut(prev, when, 0.013);
    this.onString[string] = voice;
    this.live.add(voice);
    src.onended = () => { this.live.delete(voice); g.disconnect(); };
  }

  /* A short click at a time on the audio clock, higher on the first beat of a bar. */
  click(when, strong) {
    const ctx = this.ctx, osc = ctx.createOscillator(), g = ctx.createGain();
    osc.type = 'square'; osc.frequency.value = strong ? 1760 : 1175;
    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(strong ? 0.16 : 0.1, when + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0005, when + 0.05);
    osc.connect(g); g.connect(this.master);
    osc.start(when); osc.stop(when + 0.07);
    const voice = {src: osc, g, level: 0.1, when, end: when + 0.06};
    this.live.add(voice);
    osc.onended = () => { this.live.delete(voice); g.disconnect(); };
  }

  /* Fades a note out from a moment on, over a few times `tc` seconds. */
  cut(voice, when, tc) {
    const p = voice.g.gain;
    if (p.cancelAndHoldAtTime) p.cancelAndHoldAtTime(when); else { p.cancelScheduledValues(when); p.setValueAtTime(voice.level, when); }
    p.setTargetAtTime(0, when, tc);
    voice.end = when;
    try { voice.src.stop(when + tc * 8); } catch { /* it has already stopped */ }
  }

  /* Silences everything: notes that are sounding fade at once, notes not yet begun never start. */
  stopAll() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    for (const v of this.live) {
      if (v.when > t) { v.g.disconnect(); try { v.src.stop(); } catch { /* it never started */ } this.live.delete(v); }
      else if (v.end > t) this.cut(v, t, 0.01);
    }
    this.onString = [];
  }
}
