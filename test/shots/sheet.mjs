/* The sheet music band in the real window: opening and closing it, the hands on their staves
   before and after notes change hands, the marker against the piece's own clock, turning,
   clicking a measure, a one-track song sorted into hands by the hand-splitting script, a song
   too long for one page, a song played in free time, what the band says without MuseScore,
   that it is open again after a restart, and that an engraved line is saved and used again. */
import {launch, songFolder, out, root} from './harness.mjs';
import {parseMidi, buildMidi} from '../../app/ui/midi.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';

const MUSESCORE = 'C:/Program Files/MuseScore 4/bin/MuseScore4.exe';
if (!fs.existsSync(MUSESCORE)) { console.log('MuseScore 4 is not installed; the sheet music check cannot run.'); process.exit(1); }
const FIXTURES = ['Chop-28-4.mid', 'wtk1-prelude1.mid', 'gymnopedie_1.mid'];
const folder = songFolder(FIXTURES);
const fixture = name => parseMidi(new Uint8Array(fs.readFileSync(path.join(folder, name))));

/* three more songs made from the Bach prelude: both hands in one track, the piece four times over,
   and the lower hand divided again to make three tracks; and a short song whose tempo, meter
   and key all change after three measures */
{
  const p = fixture('wtk1-prelude1.mid'), head = [{tick: 0, data: [0xff, 0x51, 3, 0x0f, 0x42, 0x40]}, {tick: 0, data: [0xff, 0x58, 4, 4, 2, 24, 8]}];
  const length = Math.ceil(Math.max(...p.notes.map(n => n.off.tick)) / (384 * 4)) * 384 * 4;
  const one = [...head, {tick: 0, data: [0xc0, 0]}], upper = [{tick: 0, data: [0xc0, 0]}], lower = [{tick: 0, data: [0xc0, 0]}];
  for (const n of p.notes) one.push({tick: n.on.tick, data: [0x90, n.midi, n.on.b]}, {tick: n.off.tick, data: [0x80, n.midi, 0]});
  for (let round = 0; round < 4; round++) for (const n of p.notes) {
    (n.track === 1 ? upper : lower).push({tick: n.on.tick + round * length, data: [0x90, n.midi, n.on.b]}, {tick: n.off.tick + round * length, data: [0x80, n.midi, 0]});
  }
  fs.writeFileSync(path.join(folder, 'one-track.mid'), buildMidi(384, [one]));
  fs.writeFileSync(path.join(folder, 'four-times.mid'), buildMidi(384, [head, upper, lower]));
  const three = [[{tick: 0, data: [0xc0, 0]}], [{tick: 0, data: [0xc0, 0]}], [{tick: 0, data: [0xc0, 0]}]];
  for (const n of p.notes) three[n.track === 1 ? 0 : n.midi >= 55 ? 1 : 2].push({tick: n.on.tick, data: [0x90, n.midi, n.on.b]}, {tick: n.off.tick, data: [0x80, n.midi, 0]});
  fs.writeFileSync(path.join(folder, 'three-tracks.mid'), buildMidi(384, [head, ...three]));
  const turn = 3 * 3 * 480, marks = [
    {tick: 0, data: [0xff, 0x51, 3, 0x07, 0xa1, 0x20]}, {tick: 0, data: [0xff, 0x58, 4, 3, 2, 24, 8]}, {tick: 0, data: [0xff, 0x59, 2, 2, 0]},
    {tick: turn, data: [0xff, 0x51, 3, 0x0f, 0x42, 0x40]}, {tick: turn, data: [0xff, 0x58, 4, 4, 2, 24, 8]}, {tick: turn, data: [0xff, 0x59, 2, 0xfd, 0]}
  ];
  const high = [{tick: 0, data: [0xc0, 0]}], low = [{tick: 0, data: [0xc0, 0]}];
  for (let beat = 0; beat < 9 + 16; beat++) {
    const pitch = beat < 9 ? [74, 78, 81][beat % 3] : [75, 79, 82, 87][beat % 4];
    high.push({tick: beat * 480, data: [0x90, pitch, 80]}, {tick: beat * 480 + 480, data: [0x80, pitch, 0]});
    low.push({tick: beat * 480, data: [0x90, pitch - 24, 70]}, {tick: beat * 480 + 480, data: [0x80, pitch - 24, 0]});
  }
  fs.writeFileSync(path.join(folder, 'changes.mid'), buildMidi(480, [marks, high, low]));
  /* the Chopin prelude as someone might play it: the pace wanders, no two notes land exactly together,
     and the file says nothing of tempo or meter, as a recording written out as notes does not */
  let seed = 7;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648, bell = sd => (rnd() + rnd() + rnd() + rnd() - 2) * 1.73 * sd;
  const c = fixture('Chop-28-4.mid'), when = t => t + 0.4 * Math.sin(t / 6 + 2) + 0.1 * Math.sin(t / 1.7) + 1, hands = c.tracks.map(() => [{tick: 0, data: [0xc0, 0]}]);
  for (const n of c.notes) {
    const start = when(n.start) + bell(0.012), end = Math.max(start + 0.05, when(n.end) + bell(0.02));
    hands[n.track].push({tick: Math.round(start * 960), data: [0x90, n.midi, n.on.b]}, {tick: Math.round(end * 960), data: [0x80, n.midi, 0]});
  }
  fs.writeFileSync(path.join(folder, 'played.mid'), buildMidi(480, hands));
}
const SONGS = FIXTURES.length + 5;

/* Notes that start on each staff, and the key signatures printed, when MuseScore converts `bytes` the way the app asks it to. */
function staves(bytes, tag) {
  const dir = path.join(out, 'ms'), mid = path.join(dir, tag + '.mid'), xml = path.join(dir, tag + '.musicxml'), how = path.join(dir, 'sheet-options.xml');
  fs.mkdirSync(dir, {recursive: true});
  fs.writeFileSync(mid, Buffer.from(bytes));
  fs.writeFileSync(how, '<?xml version="1.0" encoding="UTF-8"?><MidiOptions><QuantValue>3</QuantValue><VoiceCount>3</VoiceCount><Triplets>true</Triplets><SplitStaff>false</SplitStaff><ClefChanges>false</ClefChanges><RecognizePickupBar>false</RecognizePickupBar></MidiOptions>');
  if (fs.existsSync(xml)) fs.unlinkSync(xml);
  spawnSync(MUSESCORE, ['-M', how, '-o', xml, mid], {timeout: 120000});
  const text = fs.readFileSync(xml, 'utf8'), count = {parts: (text.match(/<score-part /g) || []).length, 1: 0, 2: 0, keys: [...text.matchAll(/<fifths>(-?\d+)/g)].map(m => +m[1])};
  for (const m of text.matchAll(/<note[ >][\s\S]*?<\/note>/g)) {
    const n = m[0];
    if (n.includes('<rest') || n.includes('<tie type="stop"')) continue;
    count[(n.match(/<staff>(\d+)/) || [0, '1'])[1]]++;
  }
  return count;
}
/* The hands tools/hand_split.py gives a piece's notes, asked for directly: a '1' for each right-hand
   note and a '0' for each left-hand one. Null when this computer has no Python to run it. */
function scriptHands(piece) {
  const own = path.join(process.env.LOCALAPPDATA || '', 'MusicDen', 'transcriber', 'Scripts', 'python.exe');
  const code = "import sys, json\nsys.path.insert(0, sys.argv[1])\nfrom hand_split import assign_hands\nfrom types import SimpleNamespace as N\nprint(''.join('1' if r else '0' for r in assign_hands([N(start=a, end=b, pitch=c) for a, b, c in json.load(sys.stdin)])))\n";
  for (const exe of [...(fs.existsSync(own) ? [own] : []), 'python', 'py']) {
    const r = spawnSync(exe, ['-c', code, path.join(root, 'app', 'tools')], {input: JSON.stringify(piece.notes.map(n => [n.start, n.end, n.midi])), encoding: 'utf8', windowsHide: true});
    if (r.status === 0) return r.stdout.trim();
  }
  return null;
}
/* When each measure of a file starts, worked out from the file's own tempo and meter. */
function measureStarts(piece, count) {
  const division = new DataView(piece.source.bytes.buffer, piece.source.bytes.byteOffset).getUint16(12);
  const events = piece.source.tracks.flatMap(tr => tr.events), tempo = events.find(ev => ev.tempo).tempo, meter = events.find(ev => ev.status === 0xff && ev.type === 0x58).raw;
  const quarters = meter[3] * 4 / (1 << meter[4]);
  return Array.from({length: count}, (_, i) => i * quarters * tempo / 1e6);
}

let a = await launch({folder});
let win = a.win;
/* What the band is showing: the line's measures, where it has turned to, and the marker as drawn. */
const band = () => win.evaluate(() => {
  const s = pv.sheet, L = s.line, el = document.getElementById('sheet'), r = el.getBoundingClientRect(), t = pv.now();
  const drawn = /translateX\(([-\d.]+)px\)/.exec(el.querySelector('.sheet-mark').style.transform);
  return {
    hidden: el.hidden, note: el.querySelector('.sheet-note').textContent, box: {x: r.left, y: r.top, w: r.width, h: r.height},
    stage: document.getElementById('stage').getBoundingClientRect().height, t,
    scroll: s.scroll, at: s.at, mark: drawn ? +drawn[1] : null, where: L ? s.xAt(t) : null, head: L ? L.head : 0, wide: L ? L.wide : 0,
    measures: L ? L.measures : [], columns: L ? L.columns : [], pages: s.imgs.length, drawn: s.drawn,
    order: s.sent ? s.sent.order : null, divided: s.sent ? s.sent.divided : null, free: s.sent ? s.sent.free : null, how: s.how,
    pinned: getComputedStyle(el.querySelector('.sheet-head')).display !== 'none'
  };
});
/* Waits for the song list to hold every song in the folder; says what it holds if it never does. */
const listed = () => win.waitForFunction(n => pv.songs.length === n, SONGS).catch(async () => { throw new Error('song list: ' + JSON.stringify(await win.evaluate(() => pv.songs.map(s => s.name))) + ' | folder: ' + JSON.stringify(fs.readdirSync(folder))); });
const ready = () => win.waitForFunction(() => pv.sheet.line && !document.querySelector('.sheet-note').textContent, null, {timeout: 60000});
const sent = () => win.evaluate(() => Array.from(pv.sheet.sent.midi));
/* Freezes the piece at `t` and waits for the line to finish turning before a picture is taken. */
const still = async t => { await a.at(t); await win.waitForTimeout(350); };
const open = async name => { await win.evaluate(n => pv.openSong(n), name); await ready(); await win.waitForTimeout(300); };
const redrawn = async from => { await win.waitForFunction(n => pv.sheet.drawn > n, from, {timeout: 60000}); await win.waitForTimeout(300); };
/* The measure sounding at `t` and, when both fit, the one after it are wholly in view, right of the pinned clefs. */
const inView = (b, i, why) => {
  const m = b.measures[i], next = b.measures[i + 1], left = b.scroll + (b.scroll > 0 ? b.head : 0), right = b.scroll + b.box.w;
  assert.equal(b.at, i, why + ': the tinted measure is the one sounding');
  assert.ok(m.x0 >= left - 1 && m.x1 <= right + 1, `${why}: measure ${i + 1} is in view (${Math.round(m.x0)}..${Math.round(m.x1)} in ${Math.round(left)}..${Math.round(right)})`);
  if (next && next.x1 - m.x0 + b.head + 16 <= b.box.w) assert.ok(next.x1 <= right + 1, `${why}: measure ${i + 2} is in view as well`);
  assert.ok(b.mark >= m.x0 - 1 && b.mark <= m.x1 + 1, `${why}: the marker is inside measure ${i + 1}`);
  assert.equal(b.pinned, b.scroll > 0, why + ': clefs are pinned exactly when the line has turned');
};

try {
  await listed();

  /* closed at first; the button opens the band above the stage and the stage gives up the room */
  await win.evaluate(() => pv.openSong('Chop-28-4.mid'));
  let b = await band();
  assert.equal(b.hidden, true, 'the band starts hidden');
  const stageBefore = b.stage;
  await win.locator('#sheetBtn').click();
  assert.equal(await win.locator('#sheetBtn').getAttribute('aria-expanded'), 'true');
  await ready(); await win.waitForTimeout(300);
  await a.at(0);
  b = await band();
  assert.equal(b.hidden, false);
  assert.equal(b.how, 'engraved', 'the first time, MuseScore engraves the line');
  assert.ok(Math.abs(b.stage + b.box.h - stageBefore) < 1.5, 'the stage shrinks by the band: ' + [b.stage, b.box.h, stageBefore]);
  await a.shot('90-sheet-chopin-start');
  console.log('open: band', Math.round(b.box.w) + 'x' + Math.round(b.box.h), '| measures', b.measures.length, '| note columns', b.columns.length, '| pages', b.pages);

  /* each hand on its own staff: MuseScore's reading of what the app sent, against the app's tracks */
  const chopin = fixture('Chop-28-4.mid'), tracks = chopin.tracks.map(t => t.count);
  let on = staves(await sent(), 'sheet-chopin');
  assert.equal(on.parts, 1, 'one piano part');
  assert.deepEqual(b.order, [0, 1], 'rh above lh');
  assert.deepEqual([on[1], on[2]], tracks, 'every note of each track is on that track\'s staff');
  assert.deepEqual(on.keys, [1], 'the file\'s one sharp is the only key signature');
  console.log('hands: tracks', chopin.tracks.map(t => t.name + t.count).join(' '), '-> staff 1:', on[1], 'staff 2:', on[2]);

  /* the measures start when the file's own tempo and meter say they do */
  for (const name of FIXTURES) {
    if (name !== 'Chop-28-4.mid') await open(name);
    const got = (await band()).measures.map(m => m.t), want = measureStarts(fixture(name), got.length);
    const worst = Math.max(...got.map((t, i) => Math.abs(t - want[i])));
    assert.ok(worst < 0.002, name + ': measure starts match the file to ' + (worst * 1000).toFixed(2) + ' ms');
    console.log('clock:', name, got.length, 'measures, furthest from the file\'s own timing', (worst * 1000).toFixed(2), 'ms');
  }
  /* every note of the Bach prelude has a column that sounds when it does */
  {
    const bach = fixture('wtk1-prelude1.mid');
    await open('wtk1-prelude1.mid');
    b = await band();
    const times = b.columns.map(c => c.t);
    let worst = 0;
    for (const n of bach.notes) worst = Math.max(worst, Math.min(...times.map(t => Math.abs(t - n.start))));
    assert.ok(worst < 0.002, 'each note start has a column: ' + worst);
    assert.deepEqual(b.order, [1, 0], 'the track named upper is on the top staff although the file lists it second');
    on = staves(await sent(), 'sheet-bach');
    assert.deepEqual([on.parts, on[1], on[2]], [1, bach.tracks[1].count, bach.tracks[0].count]);
    await still(30); await a.shot('91-sheet-bach-30s');
    console.log('columns: every one of', bach.notes.length, 'note starts has a column within', (worst * 1000).toFixed(2), 'ms; upper hand', on[1], 'on top, lower hand', on[2], 'below');
  }

  /* the marker and the turning, measure by measure, forwards and then backwards */
  await open('Chop-28-4.mid');
  b = await band();
  const starts = b.measures.map(m => m.t), turns = new Set();
  for (let i = 0; i < starts.length; i++) {
    await a.at(starts[i] + 0.4);
    const now = await band();
    inView(now, i, 'forwards');
    turns.add(now.scroll);
    if (i === 9) { await win.waitForTimeout(350); await a.shot('92-sheet-chopin-turned'); }
  }
  assert.ok(turns.size > 3 && turns.size < starts.length, 'the line turns a few measures at a time: ' + turns.size + ' positions over ' + starts.length + ' measures');
  for (let i = starts.length - 1; i >= 0; i -= 3) { await a.at(starts[i] + 0.4); inView(await band(), i, 'backwards'); }
  console.log('turning:', turns.size, 'positions over', starts.length, 'measures; current and next measure in view at every one');

  /* while playing, the marker on screen is where the clock says, frame after frame */
  await a.at(starts[2]);
  await win.evaluate(() => pv.play());
  let furthest = 0, moved = 0, last = null;
  for (let i = 0; i < 12; i++) {
    await win.waitForTimeout(140);
    const now = await band();
    furthest = Math.max(furthest, Math.abs(now.mark - now.where));
    if (last !== null && now.mark > last) moved++;
    last = now.mark;
  }
  await win.evaluate(() => pv.pause());
  assert.ok(moved >= 10, 'the marker keeps moving: ' + moved);
  assert.ok(furthest < 6, 'the drawn marker is within a frame of the clock: ' + furthest.toFixed(2) + ' px');
  console.log('playing: marker moved on', moved, 'of 11 looks, at most', furthest.toFixed(2), 'px from where the clock puts it');

  /* clicking a measure goes to its start; so does stepping with the arrow keys */
  await a.at(starts[4] + 1);
  b = await band();
  const target = b.at + 1, m = b.measures[target], cx = b.box.x + (m.x0 + m.x1) / 2 - b.scroll, cy = b.box.y + b.box.h / 2;
  await win.mouse.move(cx, cy); await win.waitForTimeout(150);
  await a.shot('93-sheet-hover-measure');
  await win.mouse.click(cx, cy); await win.waitForTimeout(200);
  b = await band();
  assert.ok(Math.abs(b.t - starts[target]) < 0.001, 'a click lands on the start of the measure: ' + b.t + ' vs ' + starts[target]);
  assert.equal(b.at, target);
  await win.keyboard.press('ArrowRight'); await win.waitForTimeout(200);
  assert.ok(Math.abs((await band()).t - starts[target + 1]) < 0.001, 'Right arrow steps to the next measure');
  await win.keyboard.press('ArrowLeft'); await win.keyboard.press('ArrowLeft'); await win.waitForTimeout(200);
  assert.ok(Math.abs((await band()).t - starts[target - 1]) < 0.001, 'Left arrow steps back');
  await win.evaluate(() => pv.play()); await win.waitForTimeout(300);
  b = await band();
  const shown = b.measures.map((m, i) => i).filter(i => i !== b.at && b.measures[i].x0 >= b.scroll + b.head && b.measures[i].x1 <= b.scroll + b.box.w);
  const far = shown[shown.length - 1];
  await win.mouse.click(b.box.x + (b.measures[far].x0 + b.measures[far].x1) / 2 - b.scroll, cy); await win.waitForTimeout(250);
  b = await band();
  assert.ok(await win.evaluate(() => pv.playing) && b.t > starts[far] && b.t < starts[far] + 1, 'a click while playing keeps playing from there: ' + b.t + ' vs ' + starts[far]);
  await win.evaluate(() => pv.pause());
  await win.mouse.move(10, 400);
  console.log('seeking: click, arrow keys and click while playing all land on measure starts');

  /* notes moved to the other hand move to the other staff */
  await win.locator('#lookBtn').click();
  await win.evaluate(() => { document.getElementById('insp').scrollTop = 99999; });
  await win.locator('[data-sw="editHands"]').click();
  await still(starts[1] + 0.2);
  await a.shot('94-sheet-before-hand-change');
  const before = (await band()).drawn;
  const visible = await win.evaluate(() => {
    const s = pv.stage, g = s.geo, r = document.getElementById('glc').getBoundingClientRect(), res = [];
    for (let i = 0; i < s.list.length; i += 5) {
      const n = s.refs[i / 5]; if (!n) continue;
      const top = Math.max(0, g.hitY - s.list[i + 2]), bottom = Math.min(g.hitY, g.hitY - s.list[i + 1]);
      if (bottom - top >= 6) res.push({x: r.left + g.x[n.midi] + g.w[n.midi] / 2, y: r.top + (top + bottom) / 2, track: n.track});
    }
    return res;
  });
  const picks = visible.filter(n => n.track === 1).slice(0, 12);
  for (const n of picks) await win.mouse.click(n.x, n.y);
  await win.mouse.move(10, 400);
  const after = await win.evaluate(() => pv.piece.tracks.map(t => t.count));
  assert.deepEqual(after, [tracks[0] + picks.length, tracks[1] - picks.length], 'the clicks moved notes to the other hand');
  await redrawn(before);
  await still(starts[1] + 0.2);
  await a.shot('95-sheet-after-hand-change');
  on = staves(await sent(), 'sheet-chopin-moved');
  assert.deepEqual([on.parts, on[1], on[2]], [1, after[0], after[1]], 'the staves follow the hands');
  console.log('hand change:', picks.length, 'notes clicked; staff 1:', tracks[0], '->', on[1], '| staff 2:', tracks[1], '->', on[2]);
  const again = (await band()).drawn;
  for (let i = 0; i < picks.length; i++) await win.keyboard.press('Control+z');
  await redrawn(again);
  on = staves(await sent(), 'sheet-chopin-undone');
  assert.deepEqual([on[1], on[2]], tracks, 'undoing puts the staves back');
  assert.equal((await band()).how, 'recent', 'and the line from before the change is shown again without engraving');
  await win.locator('[data-sw="editHands"]').click();
  console.log('undo: staves back to', on[1], 'and', on[2]);

  /* both panels open, then the band closed and opened again without engraving twice */
  await still(starts[12] + 1);
  await a.shot('96-sheet-with-settings');
  inView(await band(), 12, 'with Settings open');
  await win.locator('#lookBtn').click();
  const kept = (await band()).drawn;
  await win.locator('#sheetBtn').click(); await win.waitForTimeout(200);
  b = await band();
  assert.equal(b.hidden, true);
  assert.ok(Math.abs(b.stage - stageBefore) < 1.5, 'closing gives the stage its room back');
  await win.locator('#sheetBtn').click(); await win.waitForTimeout(300);
  b = await band();
  assert.equal(b.hidden, false);
  assert.equal(b.drawn, kept, 'the line is still there, not engraved again');
  inView(b, 12, 'after reopening');
  console.log('close and reopen: stage back to', Math.round(stageBefore), 'px; line kept');

  /* the other songs */
  await open('gymnopedie_1.mid'); await still(40); await a.shot('97-sheet-satie-40s');
  await win.evaluate(() => pv.openSong(':built-in')); await ready(); await win.waitForTimeout(300);
  await still(12); await a.shot('98-sheet-built-in-12s');
  b = await band();
  assert.ok(b.measures.length > 30 && b.order.length === 2, 'the built-in prelude is engraved from memory, two hands: ' + b.measures.length);

  /* a song with both hands in one track is sorted into hands by the hand-splitting script */
  await open('one-track.mid');
  b = await band();
  const whole = fixture('one-track.mid'), wanted = scriptHands(whole);
  assert.ok(wanted, 'a Python to run the hand-splitting script with');
  assert.equal(b.divided, 'script');
  assert.equal(await win.evaluate(() => pv.sheet.split.answer), wanted, 'the band uses the hands the script gives');
  on = staves(await sent(), 'sheet-one-track');
  const inRight = wanted.split('1').length - 1;
  assert.deepEqual([on.parts, on[1], on[2]], [1, inRight, wanted.length - inRight], 'right-hand notes on the upper staff, left-hand notes on the lower');
  await still(20); await a.shot('99-sheet-one-track');
  /* for the record: how often the script and a plain middle C split put a note where the two-track original has it */
  const original = new Map(fixture('wtk1-prelude1.mid').notes.map(n => [n.midi + '@' + n.on.tick, n.track === 1]));
  const same = pick => whole.notes.filter((n, i) => pick(n, i) === original.get(n.midi + '@' + n.on.tick)).length / whole.notes.length * 100;
  console.log('one track: the script puts', inRight, 'notes in the right hand and', wanted.length - inRight, 'in the left;',
    'it matches the two-track original on', same((n, i) => wanted[i] === '1').toFixed(0) + '% of notes, a middle C split on', same(n => n.midi >= 60).toFixed(0) + '%');

  /* a song too long for one page continues on the next, in one line */
  await open('four-times.mid');
  b = await band();
  assert.ok(b.pages > 1, 'more than one page: ' + b.pages);
  assert.equal(b.measures.length, 140);
  for (let i = 1; i < b.measures.length; i++) assert.ok(b.measures[i].x0 >= b.measures[i - 1].x1 - 1 && b.measures[i].t > b.measures[i - 1].t, 'measures run left to right across pages: ' + i);
  const seam = b.measures.findIndex((m, i) => i > 0 && m.page !== b.measures[i - 1].page), want = measureStarts(fixture('four-times.mid'), 140);
  assert.ok(Math.max(...b.measures.map((m, i) => Math.abs(m.t - want[i]))) < 0.002, 'measure starts match across pages');
  for (const i of [seam - 2, seam - 1, seam, seam + 1, 139]) { await a.at(b.measures[i].t + 0.5); inView(await band(), i, 'long song'); if (i === seam - 1) { await win.waitForTimeout(350); await a.shot('100-sheet-page-seam'); } }
  console.log('long song:', b.pages, 'pages,', b.measures.length, 'measures, line', Math.round(b.wide), 'px; second page starts at measure', seam + 1);

  /* tempo, meter and key change midway: three measures of 1.5 s, then four of 4 s; only the opening key is printed */
  await open('changes.mid');
  b = await band();
  const expected = [0, 1.5, 3, 4.5, 8.5, 12.5, 16.5];
  assert.equal(b.measures.length, expected.length);
  assert.ok(Math.max(...b.measures.map((m, i) => Math.abs(m.t - expected[i]))) < 0.002, 'measures start where the tempo and meter put them: ' + b.measures.map(m => m.t.toFixed(3)));
  for (const [i, t] of [[1, 2.2], [3, 6], [5, 14]]) { await a.at(t); inView(await band(), i, 'after the change'); }
  await still(6); await a.shot('100b-sheet-tempo-meter-key-change');
  on = staves(await sent(), 'sheet-changes');
  assert.deepEqual(on.keys, [2], 'the opening two sharps are printed, the later three flats are not');
  console.log('changes: measures start at', b.measures.map(m => m.t.toFixed(2)).join(', '), 's; key signatures printed:', on.keys.join(','));

  /* a song played in free time is written by the beats found in it, and its columns sound when the played notes do */
  await open('played.mid');
  b = await band();
  assert.equal(b.free.time, '4/4');
  assert.ok(Math.abs(b.free.tempo - 112) < 8, 'the beat found is the eighth-note pulse of the playing: ' + b.free.tempo);
  const lengths = b.measures.slice(2, -2).map((m, i, all) => i ? m.t - all[i - 1].t : 0).slice(1);
  assert.ok(Math.max(...lengths) / Math.min(...lengths) > 1.08, 'measures take longer where the playing slows: ' + [Math.min(...lengths).toFixed(2), Math.max(...lengths).toFixed(2)]);
  const struck = [...new Set(fixture('played.mid').notes.map(n => n.start))], away = struck.map(t => Math.min(...b.columns.map(c => Math.abs(c.t - t)))).sort((x, y) => x - y);
  assert.ok(away[away.length >> 1] < 0.02 && away[Math.floor(away.length * 0.95)] < 0.06, 'columns sound with the played notes: ' + away[away.length >> 1] + ', ' + away[Math.floor(away.length * 0.95)]);
  for (const i of [3, 20, 40]) { await a.at(b.measures[i].t + 0.3); inView(await band(), i, 'free time'); }
  await still(b.measures[20].t + 0.3); await a.shot('100c-sheet-free-time');
  console.log('free time: read as', b.free.time, 'at', Math.round(b.free.tempo), 'a minute;', b.measures.length, 'measures of', Math.min(...lengths).toFixed(2), 'to', Math.max(...lengths).toFixed(2), 's; columns a median', Math.round(away[away.length >> 1] * 1000), 'ms from the played notes, 95% within', Math.round(away[Math.floor(away.length * 0.95)] * 1000), 'ms');

  /* a song with three tracks gets three staves; in a small window the band keeps to its share of the height */
  await open('three-tracks.mid');
  b = await band();
  assert.equal(b.order.length, 3, 'three hands were sent');
  await still(20); await a.shot('101-sheet-three-tracks');
  const roomy = b.box.h;
  await a.app.evaluate(({BrowserWindow}) => BrowserWindow.getAllWindows()[0].setContentSize(760, 480));
  await win.waitForTimeout(500);
  await a.at(20); await win.waitForTimeout(300);
  b = await band();
  const share = ((await win.evaluate(() => innerHeight)) - 44) * 0.45;
  assert.ok(roomy > share && b.box.h <= share + 1, 'the band shrinks to its share of a small window: ' + [roomy, b.box.h, share]);
  inView(b, 5, 'small window');
  await a.shot('102-sheet-small-window');
  await open('Chop-28-4.mid');
  await a.app.evaluate(({BrowserWindow}) => BrowserWindow.getAllWindows()[0].setContentSize(1360, 820));
  await win.waitForTimeout(400);
  await win.locator('#fullBtn').click(); await win.waitForTimeout(3200);
  await a.at(starts[6] + 1);
  inView(await band(), 6, 'full screen');
  await a.shot('103-sheet-full-screen');
  await win.keyboard.press('Escape');
  console.log('three tracks: band', Math.round(roomy), 'px, in a small window', Math.round(b.box.h), 'px; full screen keeps the band');
} finally {
  console.log(a.problems.join('\n') || 'no console problems');
  await a.close();
}

/* without MuseScore the band says what is missing */
const keep = fs.mkdtempSync(path.join(os.tmpdir(), 'pv-keep-'));
const line = b => b.measures.map(m => [Math.round(m.x0), +m.t.toFixed(3)]);
let builtIn = null, oneTrack = null;
process.env.MUSICDEN_MUSESCORE = path.join(folder, 'not-here', 'MuseScore4.exe');
a = await launch({folder, keep});
win = a.win;
try {
  await listed();
  await win.locator('#sheetBtn').click();
  await win.waitForFunction(() => document.querySelector('.sheet-note').textContent === pv.T.errNoMuseScore, null, {timeout: 20000});
  const b = await band();
  assert.ok(b.box.h < 40 && b.measures.length === 0, 'one row, no staves');
  await a.shot('104-sheet-no-musescore');
  console.log('no MuseScore: the band reads "' + b.note + '"');
} finally {
  delete process.env.MUSICDEN_MUSESCORE;
  console.log(a.problems.join('\n') || 'no console problems');
  await a.close();
}

/* the band is remembered: started again, the app opens it by itself and engraves the piece on stage;
   and with no Python to run the hand-splitting script, a one-track song is divided at middle C */
process.env.MUSICDEN_PYTHON = path.join(folder, 'not-here', 'python.exe');
a = await launch({folder, keep});
win = a.win;
try {
  await ready();
  const b = await band();
  assert.equal(b.hidden, false, 'open from the start');
  assert.equal(await win.locator('#sheetBtn').getAttribute('aria-expanded'), 'true');
  assert.ok(b.measures.length > 30, 'the piece on stage is engraved: ' + b.measures.length);
  assert.equal(b.how, 'engraved');
  builtIn = line(b);
  console.log('remembered: open again after a restart, with', b.measures.length, 'measures on the staves');
  await open('one-track.mid');
  oneTrack = line(await band());
  assert.equal((await band()).divided, 'middle');
  const on = staves(await sent(), 'sheet-one-track-middle'), notes = fixture('one-track.mid').notes;
  assert.deepEqual([on.parts, on[1], on[2]], [1, notes.filter(n => n.midi >= 60).length, notes.filter(n => n.midi < 60).length], 'middle C and up on the upper staff, the rest below');
  await still(20); await a.shot('99b-sheet-one-track-no-python');
  console.log('no Python: staff 1 has the', on[1], 'notes from middle C up, staff 2 the', on[2], 'below');
} finally {
  console.log(a.problems.join('\n') || 'no console problems');
  await a.close();
}

/* an engraved line is saved: started once more, now without MuseScore, the app shows the lines it
   engraved before, the same as they were, and says what is missing only for a song it never engraved */
process.env.MUSICDEN_MUSESCORE = path.join(folder, 'not-here', 'MuseScore4.exe');
a = await launch({folder, keep});
win = a.win;
try {
  /* the song that was open last comes back, with its line */
  await ready();
  let b = await band();
  assert.equal(await win.evaluate(() => pv.current), 'one-track.mid');
  assert.equal(b.how, 'saved', 'the line comes from the song\'s saved file');
  assert.deepEqual(line(b), oneTrack, 'the same line as when it was engraved');
  await still(20); await a.shot('105-sheet-from-saved');
  const timed = Date.now();
  await win.evaluate(() => pv.openSong(':built-in')); await ready(); await win.waitForTimeout(300);
  b = await band();
  /* the app showed the built-in piece for a moment as it started, so its line may already be in memory */
  assert.ok(b.how === 'saved' || b.how === 'recent', 'so does the built-in piece: ' + b.how);
  assert.deepEqual(line(b), builtIn);
  await win.evaluate(() => pv.openSong('Chop-28-4.mid'));
  await win.waitForFunction(() => document.querySelector('.sheet-note').textContent === pv.T.errNoMuseScore, null, {timeout: 20000});
  const kept = fs.readdirSync(path.join(keep, 'sheet-music'));
  assert.deepEqual(kept.sort(), ['_built-in.sheet', 'one-track.mid.sheet'], 'one saved file for each song engraved');
  console.log('saved: without MuseScore the two songs engraved before show from their saved lines (the built-in piece', Date.now() - timed - 300, 'ms after it was picked); files', kept.map(f => f + ' ' + Math.round(fs.statSync(path.join(keep, 'sheet-music', f)).size / 1024) + ' KB').join(', '));
  console.log('ALL SHEET MUSIC CHECKS PASSED');
} finally {
  delete process.env.MUSICDEN_PYTHON; delete process.env.MUSICDEN_MUSESCORE;
  console.log(a.problems.join('\n') || 'no console problems');
  await a.close();
  fs.rmSync(keep, {recursive: true, force: true});
}
