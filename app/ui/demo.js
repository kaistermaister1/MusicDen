/* The built-in piece, written out as a MIDI file so it goes through the same reader as any song. */
import {buildMidi} from './midi.js';

const STEP = {C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11};
const midiOf = s => { const m = /^([A-G])([#b]?)(\d)$/.exec(s); return STEP[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0) + (parseInt(m[3], 10) + 1) * 12; };
const BARS = [
  'C4 E4 G4 C5 E5', 'C4 D4 A4 D5 F5', 'B3 D4 G4 D5 F5', 'C4 E4 G4 C5 E5',
  'C4 E4 A4 E5 A5', 'C4 D4 F#4 A4 D5', 'B3 D4 G4 D5 G5', 'B3 C4 E4 G4 C5',
  'A3 C4 E4 G4 C5', 'D3 A3 D4 F#4 C5', 'G3 B3 D4 G4 B4', 'G3 Bb3 E4 G4 C#5',
  'F3 A3 D4 A4 D5', 'F3 Ab3 D4 F4 B4', 'E3 G3 C4 G4 C5', 'E3 F3 A3 C4 F4',
  'D3 F3 A3 C4 F4', 'G2 D3 G3 B3 F4', 'C3 E3 G3 C4 E4', 'C3 G3 Bb3 C4 E4',
  'F2 F3 A3 C4 E4', 'F#2 C3 A3 C4 Eb4', 'Ab2 F3 B3 C4 D4', 'G2 F3 G3 B3 D4',
  'G2 E3 G3 C4 E4', 'G2 D3 G3 C4 F4', 'G2 D3 G3 B3 F4', 'G2 Eb3 A3 C4 F#4',
  'G2 E3 G3 C4 G4', 'G2 D3 G3 C4 F4', 'G2 D3 G3 B3 F4', 'C2 C3 G3 Bb3 E4'
];
const CLOSING = [
  'C2 C3 F3 A3 C4 F4 C4 A3 C4 A3 F3 A3 F3 D3 F3 D3',
  'C2 B2 G4 B4 D5 F5 D5 B4 D5 B4 G4 B4 D4 F4 E4 D4'
];
const LAST_CHORD = 'C2 C3 E4 G4 C5';

/* 480 ticks to the quarter note at 75 beats a minute, in 4/4: a sixteenth is 120 ticks, a fifth of a second.
   The pedal is changed on every half bar. */
export function preludeMidi(rightName, leftName) {
  const S16 = 120, named = name => ({tick: 0, data: [0xff, 0x03, name.length, ...Array.from(name, c => c.charCodeAt(0) & 0x7f)]});
  const right = [named(rightName), {tick: 0, data: [0xc0, 0]}], left = [named(leftName)];
  const add = (hand, name, tick, len, vel) => {
    const midi = midiOf(name);
    hand.push({tick, data: [0x90, midi, Math.round(vel * 127)]}, {tick: tick + len, data: [0x80, midi, 0]});
  };
  const pedal = (tick, len) => right.push({tick: tick + 6, data: [0xb0, 64, 127]}, {tick: tick + len - 6, data: [0xb0, 64, 0]});
  let t = 0;
  BARS.forEach((bar, i) => {
    const n = bar.split(' '), swell = 0.8 + 0.2 * Math.sin(Math.PI * i / 34);
    for (let half = 0; half < 2; half++) {
      const t0 = t + half * 8 * S16;
      pedal(t0, 8 * S16);
      add(left, n[0], t0, 8 * S16 - 12, 0.62 * swell);
      add(left, n[1], t0 + S16, 7 * S16 - 12, 0.5 * swell);
      [2, 3, 4, 2, 3, 4].forEach((k, j) => add(right, n[k], t0 + (2 + j) * S16, Math.round(S16 * 0.94), (j % 3 === 0 ? 0.6 : 0.52) * swell));
    }
    t += 16 * S16;
  });
  for (const bar of CLOSING) {
    const n = bar.split(' ');
    pedal(t, 16 * S16);
    add(left, n[0], t, 16 * S16 - 12, 0.6);
    add(left, n[1], t + S16, 15 * S16 - 12, 0.5);
    for (let j = 2; j < 16; j++) add(right, n[j], t + j * S16, Math.round(S16 * 0.94), 0.5);
    t += 16 * S16;
  }
  pedal(t, 2760);
  LAST_CHORD.split(' ').forEach((name, j) => add(j < 2 ? left : right, name, t + j * 30, 2520, 0.55));
  const lead = [{tick: 0, data: [0xff, 0x51, 3, 0x0c, 0x35, 0x00]}, {tick: 0, data: [0xff, 0x58, 4, 4, 2, 24, 8]}];
  return buildMidi(480, [lead, right, left]);
}
