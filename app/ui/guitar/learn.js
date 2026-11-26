/* Learning mode: the tab moves at its usual pace up to the next notes and waits there until they
   are heard on the microphone. Notes played before they reach the line are taken as played, and
   the tab comes forward to meet them. */
import {Mic} from './listen.js';

const STRUM = 0.09;   /* notes this close together, in seconds, are one strum and are listened for together */
const SPAN = 0.3;     /* the longest one strum may be */
const AHEAD = 0.25;   /* notes played this long before they reach the line still count as in time */
const DRIFT = 0.08;   /* how far past the line the tab eases before it stands still, in seconds */

export class Learn {
  constructor() { this.on = false; this.mic = new Mic(); this.groups = []; this.i = 0; this.at = 0; }

  /* Takes the notes of a song in order of time, each with start_s and pitch. */
  setSong(notes) {
    this.groups = [];
    let g = null, last = -Infinity;
    for (const n of notes) {
      if (!g || n.start_s - last > STRUM || n.start_s - g.t > SPAN) this.groups.push(g = {t: n.start_s, notes: []});
      if (!g.notes.includes(n.pitch)) g.notes.push(n.pitch);
      last = n.start_s;
    }
    this.seek(this.at);
  }

  /* Starts again from a moment of the song: the first notes at or after it are the ones waited for. */
  seek(t) {
    let i = 0;
    while (i < this.groups.length && this.groups[i].t < t - 0.03) i++;
    this.at = t; this.i = i; this.aim();
  }

  /* Tells the ear which notes to listen for, and which may fairly sound around them. */
  aim() {
    const ear = this.mic.ear, g = this.groups, i = this.i;
    if (ear) ear.want(g[i] ? g[i].notes : [], [...(g[i - 1] ? g[i - 1].notes : []), ...(g[i + 1] ? g[i + 1].notes : [])]);
  }

  /* Opens the microphone; call it from inside a tap or click. Resolves to '' or to why it couldn't. */
  open() { return this.mic.open().then(why => { if (!why) { this.mic.ear.clear(); this.aim(); } return why; }); }
  close() { this.mic.close(); }
  /* true when the microphone was taken away while listening */
  get lost() { return this.mic.lost; }

  /* One frame of playing. `t` is where the song would stand if nothing held it; the answer is
     where it does stand. */
  step(t, speed) {
    this.mic.look();
    const ear = this.mic.ear;
    if (ear && ear.heard) { this.i++; this.aim(); }
    const g = this.groups, line = this.i < g.length ? g[this.i].t : Infinity, back = this.i ? g[this.i - 1].t - AHEAD * speed : -Infinity;
    const d = Math.max(0, t - this.at);
    let at = this.at;
    if (at < back) at = Math.min(back, at + Math.max(d, (back - at) * (1 - Math.exp(-d / speed / 0.05))));
    else if (at + d > line) { const room = DRIFT * speed, over = Math.max(0, at - line); at = Math.min(line + room, at + d * Math.max(0, 1 - over / room)); }
    else at += d;
    return this.at = at;
  }
}
