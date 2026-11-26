/* The guitar's written music: how a tab's notes become noteheads, values, ties and accidentals, and the MusicXML made from them. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {toScore, spell, chooseKey, pieces, cut} from '../../app/ui/guitar/notation.js';
import {musicXml} from '../../app/ui/guitar/sheet-save.js';

const STD = [64, 59, 55, 50, 45, 40];
/* where in a bar a note falls, in beats: a whole number, or a fraction such as '3/2' */
const beats = pos => { const [a, b] = String(pos).split('/').map(Number); return b ? a / b : a; };
/* a tab in 4/4 at 120 beats a minute: beats every half second, `bars` bars from time 0 */
function song(notes, bars = 2, perBar = 4) {
  const marks = [];
  for (let b = 0; b < bars; b++) for (let k = 0; k < perBar; k++) marks.push({time_s: (b * perBar + k) * 0.5, bar: b + 1, beat: k + 1, downbeat: k === 0});
  return {version: 1, title: 'Check', tuning: STD, capo: 0, beats: marks, tempo_map: [{time_s: 0, bpm: 120}],
    notes: notes.map(([bar, pos, string, fret, len = 0.4], id) => ({id, bar, beat_pos: String(pos), string, fret, pitch: STD[string - 1] + fret,
      start_s: ((bar - 1) * perBar + beats(pos)) * 0.5, end_s: ((bar - 1) * perBar + beats(pos)) * 0.5 + len}))};
}

test('a pitch is written an octave above where it sounds', () => {
  /* the open first string sounds E4 and is written in the top space of the treble staff */
  const s = toScore(song([[1, 0, 1, 0], [1, 1, 6, 0]]));
  const top = s.events.find(e => !e.rest && e.notes[0].string === 1).notes[0], low = s.events.find(e => !e.rest && e.notes[0].string === 6).notes[0];
  assert.deepEqual([top.step, top.octave, top.line], ['E', 5, 7]);
  assert.deepEqual([low.step, low.octave, low.line], ['E', 3, -7]);
});

test('spelling follows the key', () => {
  assert.deepEqual(spell(61 + 12, 2), {step: 'C', alter: 1, octave: 5, line: 5});     // C sharp in D major
  assert.equal(spell(70, 0).step + spell(70, 0).alter, 'B-1');                         // B flat in C major
  assert.equal(spell(68, 0).step + spell(68, 0).alter, 'G1');                          // G sharp, the leading note of A minor
  assert.equal(spell(61, -1).step + spell(61, -1).alter, 'C1');                        // C sharp, the leading note of D minor
  assert.equal(chooseKey([62, 64, 66, 67, 69, 71, 73, 74]), 2);
  assert.equal(chooseKey([60, 62, 64, 65, 67, 69, 71]), 0);
});

test('note values in a bar add up to the bar', () => {
  const s = toScore(song([[1, 0, 1, 0], [1, 1, 1, 1], [1, '3/2', 1, 3], [1, 2, 2, 0], [1, 3, 2, 1], [2, 0, 1, 0], [2, '1/2', 1, 2], [2, 2, 1, 3]]));
  assert.deepEqual(s.time, {num: 4, den: 4});
  s.bars.forEach((b, i) => assert.equal(s.events.filter(e => e.bar === i && e.voice === 1).reduce((a, e) => a + e.dur, 0), b.ticks));
  const first = s.events.filter(e => e.bar === 0 && !e.rest).map(e => [e.type, e.dots]);
  assert.deepEqual(first, [['quarter', 0], ['eighth', 0], ['eighth', 0], ['quarter', 0], ['quarter', 0]]);
});

test('lengths are written with the fewest values, and up to the beat first', () => {
  assert.deepEqual(pieces(48), [48]);
  assert.deepEqual(pieces(60), [48, 12]);
  assert.deepEqual(pieces(40), [24, 16]);
  assert.deepEqual(cut(36, 72, 48, 0), [[36, 12], [48, 24]]);
});

test('an accidental is shown once in a bar, and again in the next', () => {
  /* F sharp twice in bar 1 and once in bar 2, in a piece otherwise in C */
  const s = toScore(song([[1, 0, 1, 2], [1, 1, 1, 2], [1, 2, 1, 1], [1, 3, 1, 1], [2, 0, 1, 2], [2, 1, 1, 1], [2, 2, 1, 1], [2, 3, 2, 1]].concat(
    [[1, 0, 5, 3], [2, 0, 5, 3], [1, 1, 6, 3], [1, 2, 4, 2], [1, 3, 4, 0], [2, 1, 5, 2], [2, 2, 5, 0]])));
  assert.equal(s.key.fifths, 0);
  const sharps = s.events.filter(e => !e.rest).flatMap(e => e.notes.filter(n => n.step === 'F' && n.alter === 1).map(n => [e.bar, n.accidental]));
  assert.deepEqual(sharps, [[0, 'sharp'], [0, null], [1, 'sharp']]);
  const natural = s.events.find(e => e.bar === 0 && e.notes.some(n => n.step === 'F' && n.alter === 0)).notes.find(n => n.step === 'F');
  assert.equal(natural.accidental, 'natural');
});

test('a note still sounding past the bar line is tied into the next bar', () => {
  const s = toScore(song([[1, 0, 1, 0], [1, 3, 1, 3, 2.4], [2, 3, 1, 0]]));
  const held = s.events.filter(e => !e.rest && e.notes[0].fret === 3);
  assert.equal(held.length >= 2, true);
  assert.equal(held[0].tieToNext, true);
  assert.equal(held[held.length - 1].tieFromPrev, true);
  assert.equal(held[held.length - 1].bar, 1);
  assert.equal(held[held.length - 1].notes[0].accidental, null);
});

test('a tab with no beats gives noteheads without values', () => {
  const plain = song([[1, 0, 1, 0], [1, 1, 2, 1], [1, 1, 3, 0]]);
  plain.beats = []; for (const n of plain.notes) { n.bar = null; n.beat_pos = null; }
  const s = toScore(plain);
  assert.equal(s.measured, false);
  assert.equal(s.bars.length, 0);
  assert.deepEqual(s.events.map(e => [e.type, e.notes.length]), [[null, 1], [null, 2]]);
  assert.match(musicXml(plain), /<score-partwise/);
});

test('the MusicXML has a notation staff and a tab staff with strings and frets', () => {
  const xml = musicXml(song([[1, 0, 1, 0], [1, 1, 2, 1], [1, 2, 6, 3], [2, 0, 3, 2]]));
  assert.match(xml, /<clef number="2"><sign>TAB<\/sign>/);
  assert.match(xml, /<staff-tuning line="1"><tuning-step>E<\/tuning-step><tuning-octave>2<\/tuning-octave>/);
  assert.match(xml, /<technical><string>2<\/string><fret>1<\/fret><\/technical>/);
  assert.equal((xml.match(/<measure /g) || []).length, 2);
  /* the open first string is given as it sounds, E4 */
  assert.match(xml, /<pitch><step>E<\/step><octave>4<\/octave><\/pitch>/);
});

test('the tab that comes with the app becomes a score whose upper voice fills each bar', () => {
  const dir = new URL('../../app/ui/guitar/songs/', import.meta.url);
  const tabs = fs.readdirSync(dir).filter(f => f.endsWith('.json') && f !== 'index.json');
  assert.ok(tabs.length > 0, 'the app comes with a tab');
  for (const f of tabs) {
    const s = toScore(JSON.parse(fs.readFileSync(new URL(f, dir), 'utf8')));
    if (!s.measured) continue;
    s.bars.forEach((b, i) => assert.equal(s.events.filter(e => e.bar === i && e.voice === 1).reduce((a, e) => a + e.dur, 0), b.ticks, `${f} bar ${b.number}`));
  }
});
