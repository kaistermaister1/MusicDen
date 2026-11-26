/* The piano's sound: recordings of a grand piano at eight loudness layers on every third key,
   shifted to the keys between, with dampers and a sustain pedal. Falls back to a plain synthesized
   tone for any key whose recording has not arrived. */
import {clamp} from './settings.js';

const MAX_SECONDS = 14, RATE = 48000, TRIM = 0.62;

/* The recordings, decoded as they are needed and shared by live playing and video sound. */
export class SampleBank {
  constructor(base) {
    this.base = base; this.levels = null; this.buffers = new Map(); this.loading = new Map();
    this.decoder = new OfflineAudioContext(2, 1, RATE);
  }
  async init() {
    try {
      const res = await fetch(this.base + 'levels.json');
      if (res.ok) this.levels = await res.json();
    } catch (e) {}
    if (this.levels) this.centers = this.levels.layers.map(l => (l - 0.5) * 8);
    return !!this.levels;
  }
  get ready() { return !!this.levels; }
  /* Which recording and layer a key struck at a loudness (1 to 127) calls for. */
  slot(midi, v) {
    const L = this.levels, s = clamp(Math.round((midi - L.first) / L.step), 0, L.files.length - 1);
    const j = clamp(Math.round((v - this.centers[0]) / (this.centers[1] - this.centers[0])), 0, this.centers.length - 1);
    return [s, j];
  }
  load(s, j) {
    const key = s * 16 + j;
    if (this.buffers.has(key)) return Promise.resolve(true);
    let p = this.loading.get(key);
    if (!p) {
      p = (async () => {
        try {
          const res = await fetch(`${this.base}${this.levels.files[s]}v${this.levels.layers[j]}.mp3`);
          if (!res.ok) throw new Error('missing');
          let buf = await this.decoder.decodeAudioData(await res.arrayBuffer());
          const keep = Math.floor(MAX_SECONDS * buf.sampleRate);
          if (buf.length > keep) {
            /* long tails are faded out over their last two seconds to save memory */
            const cut = new AudioBuffer({length: keep, numberOfChannels: buf.numberOfChannels, sampleRate: buf.sampleRate}), fade = 2 * buf.sampleRate;
            for (let c = 0; c < buf.numberOfChannels; c++) {
              const d = buf.getChannelData(c).subarray(0, keep);
              for (let i = keep - fade; i < keep; i++) d[i] *= (keep - i) / fade;
              cut.copyToChannel(d, c);
            }
            buf = cut;
          }
          this.buffers.set(key, buf);
          return true;
        } catch (e) { return false; }
        finally { this.loading.delete(key); }
      })();
      this.loading.set(key, p);
    }
    return p;
  }
  /* The loaded layer closest to the one asked for, or -1 when that key has none yet. */
  nearest(s, j) {
    for (let d = 0; d < this.centers.length; d++) {
      if (j + d < this.centers.length && this.buffers.has(s * 16 + j + d)) return j + d;
      if (j - d >= 0 && this.buffers.has(s * 16 + j - d)) return j - d;
    }
    return -1;
  }
  /* How loud a key should start at a loudness, read between the measured layers. */
  target(s, v) {
    const c = this.centers, r = this.levels.rms[s], n = c.length;
    if (v <= c[0]) return r[0] * Math.pow(v / c[0], 1.2);
    if (v >= c[n - 1]) return r[n - 1] * Math.pow(v / c[n - 1], 1.5);
    const i = Math.min(n - 2, Math.floor((v - c[0]) / (c[1] - c[0]))), u = (v - c[i]) / (c[i + 1] - c[i]);
    return r[i] * Math.pow(r[i + 1] / r[i], u);
  }
  /* One middle layer for every key, so the keyboard answers at once. */
  warm() {
    const jobs = [];
    for (let s = 0; s < this.levels.files.length; s++) jobs.push(this.load(s, 4));
    return Promise.all(jobs);
  }
  /* Everything a piece's notes call for. */
  prepare(notes) {
    if (!this.levels) return Promise.resolve();
    const want = new Set();
    for (const n of notes) { const [s, j] = this.slot(n.midi, clamp(Math.round(n.vel * 127), 1, 127)); want.add(s * 16 + j); }
    return Promise.all([...want].map(k => this.load(k >> 4, k & 15)));
  }
}

/* A piano on one audio context: the speakers, or a video's soundtrack being rendered. */
export class Piano {
  constructor(ctx, bank, volume = 1) {
    this.ctx = ctx; this.bank = bank; this.voices = new Set(); this.pedalDown = false;
    const limit = ctx.createDynamicsCompressor();
    limit.threshold.value = -9; limit.knee.value = 10; limit.ratio.value = 5; limit.attack.value = 0.004; limit.release.value = 0.22;
    limit.connect(ctx.destination);
    this.master = ctx.createGain(); this.master.gain.value = volume * volume; this.master.connect(limit);
    this.bus = ctx.createGain(); this.bus.connect(this.master);
    /* a short, quiet room around the instrument */
    const len = Math.floor(ctx.sampleRate * 1.7), ir = ctx.createBuffer(2, len, ctx.sampleRate);
    let seed = 1234567;
    const rand = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2147483648 - 1; };
    for (let c = 0; c < 2; c++) {
      const ch = ir.getChannelData(c);
      let low = 0;
      for (let i = 0; i < len; i++) { low += (rand() - low) * 0.35; ch[i] = low * Math.pow(1 - i / len, 3.4) * Math.min(1, i / 300); }
    }
    const room = ctx.createConvolver(); room.buffer = ir;
    const wet = ctx.createGain(); wet.gain.value = 0.11;
    this.bus.connect(room); room.connect(wet); wet.connect(this.master);
    const partials = [0, 1, 0.55, 0.3, 0.18, 0.1, 0.07, 0.04, 0.03, 0.02];
    this.wave = ctx.createPeriodicWave(new Float32Array(partials.length), new Float32Array(partials));
  }
  setVolume(v) { this.master.gain.value = v * v; }

  /* Starts a key sounding at `when`. With `dur` it is also damped that long after. */
  start(midi, vel, when, dur) {
    const ctx = this.ctx, v127 = clamp(Math.round(vel * 127), 1, 127);
    const g = ctx.createGain();
    let voice;
    const bank = this.bank, slot = bank.ready ? bank.slot(midi, v127) : null, have = slot ? bank.nearest(slot[0], slot[1]) : -1;
    if (have >= 0) {
      const s = slot[0], L = bank.levels, src = ctx.createBufferSource();
      src.buffer = bank.buffers.get(s * 16 + have);
      src.playbackRate.value = Math.pow(2, (midi - (L.first + s * L.step)) / 12);
      g.gain.value = TRIM * bank.target(s, v127) / L.rms[s][have] * Math.pow(v127 / 100, 0.5);
      src.connect(g); g.connect(this.bus);
      src.start(when);
      voice = {g, srcs: [src], midi, sampled: true};
    } else {
      if (bank.ready) bank.load(slot[0], slot[1]);
      const f = 440 * Math.pow(2, (midi - 69) / 12), lp = ctx.createBiquadFilter();
      const o1 = ctx.createOscillator(), o2 = ctx.createOscillator();
      o1.setPeriodicWave(this.wave); o2.setPeriodicWave(this.wave);
      o1.frequency.value = f; o2.frequency.value = f; o2.detune.value = 4;
      lp.type = 'lowpass'; lp.Q.value = 0.3;
      const peak = 0.15 * Math.pow(vel, 1.3) * (midi < 48 ? 1.2 : midi > 84 ? 0.8 : 1);
      g.gain.setValueAtTime(0, when);
      g.gain.linearRampToValueAtTime(peak, when + 0.005);
      g.gain.setTargetAtTime(0, when + 0.005, clamp(1.1 * Math.pow(2, (60 - midi) / 20), 0.25, 2.4));
      lp.frequency.setValueAtTime(Math.min(14000, f * (3 + 9 * vel)), when);
      lp.frequency.setTargetAtTime(Math.min(9000, f * 2.2), when, 0.25);
      o1.connect(lp); o2.connect(lp); lp.connect(g); g.connect(this.bus);
      o1.start(when); o2.start(when);
      voice = {g, srcs: [o1, o2], midi, sampled: false};
    }
    voice.live = false; voice.waiting = false; voice.released = false; voice.end = Infinity;
    this.voices.add(voice);
    voice.srcs[0].onended = () => { this.voices.delete(voice); try { g.disconnect(); } catch (e) {} };
    if (dur != null) this.release(voice, when + Math.max(0.03, dur));
    if (this.voices.size > 140 && !this.unlimited) this.thin();
    return voice;
  }
  /* Lets the damper fall at `at`. Low strings take longer to stop; the top octave and a half has no dampers. */
  release(voice, at) {
    if (voice.released) return;
    voice.released = true;
    const tc = !voice.sampled ? 0.09 : voice.midi >= 90 ? 0.9 : clamp(0.2 - (voice.midi - 21) * 0.002, 0.06, 0.2);
    try {
      voice.g.gain.cancelScheduledValues(at);
      voice.g.gain.setTargetAtTime(0, at, tc);
      for (const s of voice.srcs) s.stop(at + tc * 8);
    } catch (e) {}
    voice.end = at + tc * 8;
  }
  /* Forgets notes that finished before `t`. Used while rendering a soundtrack, where nothing else clears them. */
  prune(t) {
    for (const v of this.voices) if (v.end < t) { this.voices.delete(v); try { v.g.disconnect(); } catch (e) {} }
  }
  /* A key let go by hand: it stops now, or when the pedal lifts. */
  lift(voice) {
    voice.live = false;
    if (this.pedalDown) voice.waiting = true; else this.release(voice, this.ctx.currentTime);
  }
  pedal(down) {
    this.pedalDown = down;
    if (!down) for (const v of this.voices) if (v.waiting) { v.waiting = false; this.release(v, this.ctx.currentTime); }
  }
  cut(voice, t, tc) {
    try {
      voice.g.gain.cancelScheduledValues(t);
      voice.g.gain.setTargetAtTime(0, t, tc);
      for (const s of voice.srcs) s.stop(t + tc * 8);
    } catch (e) {}
    voice.released = true;
  }
  /* Stops everything the song is playing; keys held by hand keep sounding. */
  silence() {
    const t = this.ctx.currentTime;
    for (const v of this.voices) if (!v.live && !v.waiting) this.cut(v, t, 0.02);
  }
  /* Drops the oldest notes when far more are ringing than can be told apart. */
  thin() {
    let extra = this.voices.size - 110;
    const t = this.ctx.currentTime;
    for (const v of this.voices) { if (extra-- <= 0) break; if (!v.live) this.cut(v, t, 0.03); }
  }
}

/* The sound of a whole piece from `from` to `to` seconds, as a 16-bit WAV file. */
export async function renderWav(bank, piece, from, to, onProgress) {
  await bank.prepare(piece.notes);
  const total = to - from, ctx = new OfflineAudioContext(2, Math.ceil(total * RATE), RATE), piano = new Piano(ctx, bank, 1);
  piano.unlimited = true;
  const notes = piece.notes.filter(n => !piece.tracks[n.track].muted && n.start >= from && n.start < to);
  /* Notes are handed to the renderer a second at a time, so it never carries the whole piece at once. */
  let next = 0;
  const feed = until => {
    piano.prune(ctx.currentTime);
    for (; next < notes.length && notes[next].start - from < until; next++) { const n = notes[next]; piano.start(n.midi, n.vel, n.start - from, n.soundEnd - n.start); }
  };
  feed(1);
  for (let t = 1; t < total; t++) ctx.suspend(t).then(() => { feed(t + 1); if (onProgress) onProgress(t / total); ctx.resume(); });
  const buf = await ctx.startRendering();
  const L = buf.getChannelData(0), R = buf.getChannelData(1), n = buf.length;
  const out = new Uint8Array(44 + n * 4), v = new DataView(out.buffer);
  const put = (at, s) => { for (let i = 0; i < s.length; i++) out[at + i] = s.charCodeAt(i); };
  put(0, 'RIFF'); v.setUint32(4, 36 + n * 4, true); put(8, 'WAVEfmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 2, true);
  v.setUint32(24, RATE, true); v.setUint32(28, RATE * 4, true); v.setUint16(32, 4, true); v.setUint16(34, 16, true); put(36, 'data'); v.setUint32(40, n * 4, true);
  const pcm = new Int16Array(out.buffer, 44, n * 2);
  for (let i = 0; i < n; i++) { pcm[i * 2] = clamp(L[i], -1, 1) * 32767; pcm[i * 2 + 1] = clamp(R[i], -1, 1) * 32767; }
  return out;
}
