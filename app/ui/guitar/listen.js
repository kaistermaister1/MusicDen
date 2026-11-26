/* Listening: the microphone, and telling whether the notes the tab is waiting for have just been
   played. Nothing is recorded or sent anywhere; each look at the sound is measured and dropped.

   A look takes the last eighth of a second and finds the partials that have grown sharply since a
   moment before, so a string that is only ringing on counts for nothing and one just struck does.
   A wanted note is heard when its own partials are among those, and most of what was struck
   belongs to the notes the tab expects here rather than to something else. */

const RATE = 8000;            /* the sound is thinned to about this many samples a second before it is measured */
const N = 1024;               /* samples in one look */
const LOW = 65, HIGH = 3500;  /* the frequencies looked at, in Hz */
const LAG = [0.08, 0.17];     /* a look is compared with the quietest look from this long before, in seconds */
const RISE = 1.4;             /* a partial is newly struck when it is this many times stronger than it was */
const CENTS = 45;             /* how far a partial may lie from its true place and still belong to a note */
const PARTIALS = 20;          /* how many partials of a note are followed */
const SHARE = 0.6;            /* the share of what was struck that must belong to the expected notes */
const FAINTEST = 0.0008;      /* a strike weaker than this is taken for silence (1 is the loudest a sound can be) */
const AGAIN = 0.22;           /* one strike is not counted twice: a note just heard can't be heard again this soon */
/* a struck note also sounds, as its overtones, the notes this many frets above it */
const OVERTONES = [0, 12, 19, 24, 28, 31];
/* and is itself an overtone of the notes this many frets below it */
const UNDER = [12, 19, 24];

const hzOf = pitch => 440 * Math.pow(2, (pitch - 69) / 12);

export class Ear {
  /* sampleRate: of the sound that will be handed to look() */
  constructor(sampleRate) {
    const step = this.step = Math.max(1, Math.round(sampleRate / RATE));
    this.rate = sampleRate / step; this.hz = this.rate / N;
    /* thinning keeps every step-th sample, after a filter that removes what the thinned sound can't hold */
    const taps = 24 * step + 1, cut = 0.4625 / step, mid = (taps - 1) / 2;
    this.fir = new Float32Array(taps);
    let sum = 0;
    for (let i = 0; i < taps; i++) {
      const x = i - mid, s = x ? Math.sin(2 * Math.PI * cut * x) / (Math.PI * x) : 2 * cut;
      sum += this.fir[i] = s * (0.54 - 0.46 * Math.cos(2 * Math.PI * i / (taps - 1)));
    }
    for (let i = 0; i < taps; i++) this.fir[i] /= sum;
    /* how many samples look() must be given */
    this.need = (N - 1) * step + taps;

    this.win = new Float32Array(N); this.re = new Float32Array(N); this.im = new Float32Array(N);
    this.cos = new Float32Array(N / 2); this.sin = new Float32Array(N / 2); this.rev = new Uint16Array(N);
    for (let i = 0; i < N; i++) this.win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / N);
    for (let i = 0; i < N / 2; i++) { this.cos[i] = Math.cos(2 * Math.PI * i / N); this.sin[i] = Math.sin(2 * Math.PI * i / N); }
    for (let i = 0, bits = Math.log2(N); i < N; i++) { let r = 0; for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b); this.rev[i] = r; }

    this.lo = Math.max(2, Math.ceil(LOW / this.hz));
    this.hi = Math.min(N / 2 - 2, Math.floor(Math.min(HIGH, 0.42 * this.rate) / this.hz));
    this.past = [];            /* earlier looks, oldest first: {t, mag} */
    this.spare = [];           /* arrays to use again */
    this.diff = new Float32Array(this.hi + 2); this.ref = new Float32Array(this.hi + 2); this.sorted = new Float32Array(this.hi - this.lo + 1);
    this.floor = 0;            /* the level of the room's noise in one band */
    this.level = 0;            /* how loud the last look was, 0 to 1 */
    this.now = 0;
    this.wanted = []; this.around = []; this.got = new Map(); this.block = new Map();
    this.maybe = new Set();    /* wanted notes the last look found */
  }

  /* Sets the notes to listen for (as pitches, 69 being the A above middle C), and the notes that
     may fairly sound around them: the ones just before and just after. */
  want(notes, around = []) {
    for (const [n, t] of this.got) for (const o of OVERTONES) this.block.set(n + o, t + AGAIN);
    for (const [n, t] of this.block) if (t < this.now) this.block.delete(n);
    this.wanted = [...new Set(notes)]; this.around = around; this.got = new Map(); this.maybe = new Set();
  }

  /* true once every wanted note has been heard since want() */
  get heard() { return this.wanted.length > 0 && this.got.size === this.wanted.length; }

  /* The frequency content of the latest sound in `raw`, by a fast Fourier transform. */
  spectrum(raw) {
    const {step, fir, re, im, win, cos, sin, rev} = this, taps = fir.length, base = raw.length - this.need;
    let sq = 0;
    for (let i = 0; i < N; i++) {
      let v = 0; const at = base + i * step;
      for (let j = 0; j < taps; j++) v += fir[j] * raw[at + j];
      sq += v * v; re[rev[i]] = v * win[i]; im[i] = 0;
    }
    this.level = Math.sqrt(sq / N);
    for (let len = 2; len <= N; len <<= 1) {
      const half = len >> 1, stride = N / len;
      for (let i = 0; i < N; i += len) for (let k = 0; k < half; k++) {
        const c = cos[k * stride], s = sin[k * stride], a = i + k, b = a + half;
        const tr = re[b] * c + im[b] * s, ti = im[b] * c - re[b] * s;
        re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
      }
    }
    const mag = this.spare.pop() || new Float32Array(this.hi + 2);
    for (let k = this.lo - 1; k <= this.hi + 1; k++) mag[k] = Math.hypot(re[k], im[k]) * 4 / N;
    return mag;
  }

  /* Looks at the latest sound: `raw` ends now and holds at least `need` samples; `t` is the time
     in seconds. Marks as heard any wanted note that has just been struck. */
  look(raw, t) {
    if (raw.length < this.need) return;
    const {lo, hi, hz, diff, ref, past} = this, mag = this.spectrum(raw);
    this.now = t;

    /* the room's noise: the middle level across the bands, followed down at once and up slowly */
    const sorted = this.sorted; sorted.set(mag.subarray(lo, hi + 1)); sorted.sort();
    const mid = sorted[sorted.length >> 1];
    this.floor = !this.floor || mid < this.floor ? mid : this.floor + (mid - this.floor) * 0.01;

    /* what was sounding a moment ago: the least of the looks from LAG ago, or the latest one older than that */
    while (past.length && (t - past[0].t > 0.4 || t < past[0].t)) this.spare.push(past.shift().mag);
    let from = -1, to = -1;
    for (let i = past.length - 1; i >= 0; i--) {
      const age = t - past[i].t;
      if (age < LAG[0]) continue;
      if (to < 0) to = i;
      if (age > LAG[1]) break;
      from = i;
    }
    if (to >= 0 && from < 0) from = to;
    past.push({t, mag});
    if (to < 0 || !this.wanted.length) { this.maybe = new Set(); return; }
    ref.set(past[from].mag);
    for (let i = from + 1; i <= to; i++) { const m = past[i].mag; for (let k = lo - 1; k <= hi + 1; k++) if (m[k] < ref[k]) ref[k] = m[k]; }

    /* what has been struck since: each band's growth over what it held */
    let top = 0, loud = 0;
    for (let k = lo - 1; k <= hi + 1; k++) { const v = mag[k] - RISE * ref[k] - 2 * this.floor; diff[k] = v > 0 ? v : 0; if (v > top) top = v; if (mag[k] > loud) loud = mag[k]; }
    const was = this.maybe; this.maybe = new Set();
    /* a strike stands well clear of the room's noise and of the swell of strings still ringing */
    if (top < Math.max(FAINTEST, 8 * this.floor, 0.1 * loud)) return;

    /* its partials, each placed between bands by the curve through the band and its neighbours */
    const least = top * 0.12, wanted = this.wanted, around = this.around, found = new Map(), own = new Map(), under = new Map();
    let all = 0, ours = 0;
    for (let k = lo; k <= hi; k++) {
      if (diff[k] < least || diff[k] <= diff[k - 1] || diff[k] < diff[k + 1]) continue;
      let off = 0;
      if (mag[k] > mag[k - 1] && mag[k] >= mag[k + 1]) {
        const a = Math.log(mag[k - 1] + 1e-12), b = Math.log(mag[k]), c = Math.log(mag[k + 1] + 1e-12), bend = a - 2 * b + c;
        if (bend < 0) off = Math.max(-0.5, Math.min(0.5, 0.5 * (a - c) / bend));
      }
      const f = (k + off) * hz, e = diff[k - 1] * diff[k - 1] + diff[k] * diff[k] + diff[k + 1] * diff[k + 1];
      const reach = Math.max(CENTS, 1200 * Math.log2(1 + 0.35 * hz / f));
      let mine = false;
      for (const n of wanted) { const h = partial(f, n, reach); if (h) { mine = true; own.set(n, (own.get(n) || 0) + e); if (h <= 4) found.set(n, (found.get(n) || 0) | 1 << (h - 1)); } }
      if (!mine) for (const n of around) if (partial(f, n, reach)) { mine = true; break; }
      /* a partial nothing here accounts for, but which a note an octave or more below a wanted
         note would have, says that lower note was struck instead */
      if (!mine) for (const n of wanted) for (const d of UNDER) if (partial(f, n - d, reach)) { under.set(n, (under.get(n) || 0) + e); break; }
      all += e; if (mine) ours += e;
    }
    if (ours < SHARE * all) return;

    /* a note is there by its fundamental and one partial above it, or, where a small microphone
       loses the fundamental, by its second and third partials together; and it is believed once
       two looks running agree */
    for (const n of wanted) {
      if (this.got.has(n) || t < (this.block.get(n) || 0)) continue;
      const m = found.get(n) || 0;
      if (!((m & 1) && ((m & 14) || 2 * hzOf(n) > hi * hz) || (m & 6) === 6)) continue;
      if ((under.get(n) || 0) > 0.2 * (own.get(n) || 0)) continue;
      this.maybe.add(n);
      if (was.has(n)) this.got.set(n, t);
    }
  }

  /* Forgets what was sounding, as after a silence in the listening. */
  clear() { while (this.past.length) this.spare.push(this.past.pop().mag); }
}

/* Which partial of the note a frequency is, within `reach` cents; 0 when it is none of them. */
function partial(f, note, reach) {
  const f0 = hzOf(note), h = Math.round(f / f0);
  if (h < 1 || h > PARTIALS) return 0;
  return Math.abs(1200 * Math.log2(f / (h * f0))) <= reach ? h : 0;
}

const AC = typeof window === 'undefined' ? null : window.AudioContext || window.webkitAudioContext;

export class Mic {
  constructor() { this.ctx = null; this.stream = null; this.node = null; this.buf = null; this.ear = null; this.lost = false; }

  get live() { return !!this.stream; }

  /* Opens the microphone, asking the person the first time. Call it from inside a tap or click.
     Resolves to '' once it is open, or to why it isn't: 'blocked', 'none' or 'cannot'. */
  async open() {
    if (this.stream) { if (this.ctx.state !== 'running') this.ctx.resume().catch(() => {}); return ''; }
    const media = navigator.mediaDevices;
    if (!AC || !media || !media.getUserMedia) return 'cannot';
    if (!this.ctx) this.ctx = new AC({latencyHint: 'interactive'});
    this.ctx.resume().catch(() => {});
    let stream;
    /* the browser's own cleaning of speech would wear away held notes, so it is turned off */
    try { stream = await media.getUserMedia({audio: {echoCancellation: false, noiseSuppression: false, autoGainControl: false}}); }
    catch (e) { return e && (e.name === 'NotAllowedError' || e.name === 'SecurityError') ? 'blocked' : 'none'; }
    if (this.stream) { for (const tr of stream.getTracks()) tr.stop(); return ''; }
    this.stream = stream; this.lost = false;
    this.ear = new Ear(this.ctx.sampleRate);
    this.node = this.ctx.createAnalyser();
    this.node.fftSize = Math.min(32768, Math.pow(2, Math.ceil(Math.log2(this.ear.need))));
    this.buf = new Float32Array(this.node.fftSize);
    this.src = this.ctx.createMediaStreamSource(stream);
    this.src.connect(this.node);
    for (const tr of stream.getAudioTracks()) tr.addEventListener('ended', () => { if (this.stream === stream) { this.close(); this.lost = true; } });
    return '';
  }

  /* Lets go of the microphone, so the browser stops showing it in use. */
  close() {
    if (!this.stream) return;
    for (const tr of this.stream.getTracks()) tr.stop();
    try { this.src.disconnect(); } catch { /* it was never joined */ }
    this.stream = null; this.src = null; this.node = null;
    if (this.ctx) this.ctx.suspend().catch(() => {});
  }

  /* Hands the ear the sound up to this moment. */
  look() {
    if (!this.stream) return;
    this.node.getFloatTimeDomainData(this.buf);
    this.ear.look(this.buf, this.ctx.currentTime);
  }
}
