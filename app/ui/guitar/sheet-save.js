/* Sheet music to keep: pages to print or save as a PDF, and a MusicXML file for notation programs.
   Both carry the notes on a staff with the tab beneath. */
import {toScore, spell} from './notation.js';
import {ensureFont, drawScore, drawHeader, headerWidth, staffRoom} from './sheet.js';
import {SHEET} from './sheet-strings.js';

/* ---------- printed pages ---------- */

/* a page is laid out 760 units wide and drawn at three times that for print */
const PAGE_W = 760, SP = 6.5, TSP = 10.5, SHARP = 3, INK = '#111111', RULE = '#555555';
/* where the staff and the tab sit in one line of the score, given the room its notes need */
function frame(score) {
  const room = staffRoom(score), staffTop = SP * (room.above + 1.5), tabTop = staffTop + SP * (4 + room.below + 1);
  return {staffTop, tabTop, tabBottom: tabTop + TSP * 5, height: tabTop + TSP * 5 + 12};
}
const DIGITS = '"Segoe UI","Helvetica Neue",Helvetica,Roboto,Arial,sans-serif';

/* Breaks the score into lines of bars that fill the page width. Within a bar, notes are spaced
   by how long they last, though far less than in proportion. Returns [{first, head, end, bars:
   [{index, x, width}], x(event)}]. */
function systems(score) {
  if (!score.measured) {
    /* no bars to go by: so many chords to a line, evenly spaced */
    const gap = SP * 4, head = headerWidth(score, SP, false) + SP, per = Math.max(1, Math.floor((PAGE_W - head - gap) / gap)), out = [];
    for (let i = 0; i < score.events.length; i += per) {
      const row = new Map(score.events.slice(i, i + per).map((e, j) => [e, head + gap * (j + 0.5)]));
      out.push({first: i === 0, head, end: head + gap * (Math.min(per, score.events.length - i) + 0.5), bars: [], x: e => row.has(e) ? row.get(e) : null});
    }
    return out;
  }
  const ticks = score.bars.map(() => new Set());
  for (const e of score.events) if (!e.whole) ticks[e.bar].add(e.tick);
  const bars = score.bars.map((b, i) => {
    const at = [...ticks[i]].sort((x, y) => x - y), offs = new Map();
    let x = SP * 2.4;
    at.forEach((k, j) => { offs.set(k, x); const next = j + 1 < at.length ? at[j + 1] : b.startTick + b.ticks; x += SP * (1.9 + 2.4 * Math.sqrt(Math.max(3, next - k) / 48)); });
    return {width: at.length ? x : SP * 9, offs};
  });
  const out = [];
  for (let i = 0; i < bars.length;) {
    const first = !out.length, head = headerWidth(score, SP, first) + SP, room = PAGE_W - head - 1;
    let j = i, sum = 0;
    while (j < bars.length && (j === i || sum + bars[j].width <= room)) sum += bars[j++].width;
    const scale = j === bars.length && sum < room * 0.6 ? 1 : room / sum, placed = new Map();
    let x = head;
    const sys = {first, head, bars: []};
    for (let k = i; k < j; k++) { const w = bars[k].width * scale; sys.bars.push({index: k, x, width: w}); placed.set(k, {x, scale, width: w}); x += w; }
    sys.end = x;
    sys.x = e => { const p = placed.get(e.bar); return p ? (e.whole ? p.x + p.width / 2 : p.x + bars[e.bar].offs.get(e.tick) * p.scale) : null; };
    out.push(sys);
    i = j;
  }
  return out;
}

/* One line of the score as a picture: the staff, the tab under it, and the bar lines through both. */
function systemCanvas(score, sys) {
  const c = document.createElement('canvas');
  const {staffTop: STAFF_TOP, tabTop: TAB_TOP, tabBottom: TAB_BOTTOM, height: SYSTEM_H} = frame(score);
  c.width = PAGE_W * SHARP; c.height = Math.round(SYSTEM_H * SHARP);
  const g = c.getContext('2d');
  g.setTransform(SHARP, 0, 0, SHARP, 0, 0);
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, PAGE_W, SYSTEM_H);
  g.fillStyle = RULE;
  for (let i = 0; i < 5; i++) g.fillRect(0, STAFF_TOP + i * SP, sys.end, 0.6);
  for (let i = 0; i < 6; i++) g.fillRect(0, TAB_TOP + i * TSP, sys.end, 0.6);
  /* the line down the left joins the two staves; bar lines run through both */
  g.fillStyle = INK;
  g.fillRect(0, STAFF_TOP, 0.9, TAB_BOTTOM - STAFF_TOP);
  for (const b of sys.bars) {
    if (b !== sys.bars[0]) { g.fillRect(b.x, STAFF_TOP, 0.9, SP * 4); g.fillRect(b.x, TAB_TOP, 0.9, TSP * 5); }
  }
  g.fillRect(sys.end - 0.9, STAFF_TOP, 0.9, SP * 4); g.fillRect(sys.end - 0.9, TAB_TOP, 0.9, TSP * 5);
  drawHeader(g, score, 0, STAFF_TOP, SP, INK, sys.first);
  g.font = `600 ${TSP * 1.25}px Georgia,"Times New Roman",serif`; g.textAlign = 'center'; g.fillStyle = INK;
  SHEET.tab.split('').forEach((ch, i) => g.fillText(ch, SP * 2.2, TAB_TOP + TSP * (1.45 + i * 1.3)));
  if (sys.bars.length) {
    g.font = `500 ${SP * 1.5}px ${DIGITS}`; g.textAlign = 'left'; g.fillStyle = RULE;
    g.fillText(String(score.bars[sys.bars[0].index].number), sys.head - SP * 0.5, STAFF_TOP - SP * 3.6);
  }
  drawScore(g, score, {top: STAFF_TOP, sp: SP, ink: INK, accent: INK, x: sys.x, barX: () => null, endX: null, wholeRestX: sys.x});
  /* the tab: each struck note's fret on its string's line */
  g.font = `400 ${TSP * 1.02}px ${DIGITS}`; g.textAlign = 'center'; g.textBaseline = 'middle';
  for (const e of score.events) {
    if (e.rest || !e.head) continue;
    const x = sys.x(e);
    if (x == null) continue;
    for (const n of e.notes) {
      const text = String(n.fret), y = TAB_TOP + (n.string - 1) * TSP, w = g.measureText(text).width;
      g.fillStyle = '#ffffff'; g.fillRect(x - w / 2 - 1, y - TSP * 0.48, w + 2, TSP * 0.96);
      g.fillStyle = INK; g.fillText(text, x, y + 0.5);
    }
  }
  return c;
}

const CSS = `.sheet-print{position:fixed;inset:0;z-index:1000;background:#fff;color:#111;overflow:auto;-webkit-overflow-scrolling:touch;font-family:"IBM Plex Sans Condensed","Arial Narrow",Arial,sans-serif}
.sheet-print-bar{position:sticky;top:0;display:flex;gap:8px;justify-content:flex-end;padding:8px 16px;background:#f1efe9;border-bottom:1px solid #d6d2c6}
.sheet-print-bar button{height:32px;padding:0 12px;border:1px solid #b9b4a6;border-radius:4px;background:#fff;color:#111;font:inherit;font-size:14px;cursor:pointer}
.sheet-print-page{max-width:800px;margin:0 auto;padding:16px;box-sizing:border-box}
.sheet-print-page h1{font:500 22px/1.25 Georgia,"Times New Roman",serif;margin:10px 0 14px;text-align:center;overflow-wrap:anywhere}
.sheet-print-page canvas{display:block;width:100%;height:auto;break-inside:avoid;page-break-inside:avoid}
@media (max-width:700px){.sheet-print-bar button{height:40px}}
@media print{html,body{background:#fff!important;height:auto!important;overflow:visible!important}body>*:not(.sheet-print){display:none!important}
.sheet-print{position:static;overflow:visible}.sheet-print-bar{display:none}.sheet-print-page{max-width:none;padding:0}@page{margin:14mm}}`;

/* Lays the song out as pages over the app, with a button that opens the browser's print dialog
   (which is also where a PDF is saved). In the Windows app saving and printing are two buttons:
   `savePdf()` is then given, and saves the pages as a PDF file. Returns a function that closes
   the view. */
export function openPrintView(song, savePdf) {
  if (!document.getElementById('sheet-print-css')) {
    const style = document.createElement('style'); style.id = 'sheet-print-css'; style.textContent = CSS;
    document.head.append(style);
  }
  const root = document.createElement('div'), bar = document.createElement('div'), page = document.createElement('div');
  root.className = 'sheet-print'; bar.className = 'sheet-print-bar'; page.className = 'sheet-print-page';
  root.setAttribute('role', 'dialog'); root.setAttribute('aria-label', SHEET.show);
  const print = document.createElement('button'), shut = document.createElement('button'), h = document.createElement('h1');
  const pdf = savePdf ? document.createElement('button') : null;
  print.type = shut.type = 'button'; print.textContent = pdf ? SHEET.printOnly : SHEET.print; shut.textContent = SHEET.close;
  h.textContent = (song && song.title) || SHEET.untitled;
  if (pdf) {
    pdf.type = 'button'; pdf.textContent = SHEET.pdfOnly; pdf.disabled = true;
    pdf.addEventListener('click', async () => { pdf.disabled = true; try { await savePdf(); } finally { pdf.disabled = false; } });
    bar.append(pdf);
  }
  bar.append(print, shut); page.append(h); root.append(bar, page);
  document.body.append(root);
  const key = e => { if (e.key === 'Escape') close(); };
  function close() { root.remove(); document.removeEventListener('keydown', key, true); }
  document.addEventListener('keydown', key, true);
  shut.addEventListener('click', close);
  print.addEventListener('click', () => window.print());
  print.disabled = true;
  ensureFont().then(() => {
    const score = toScore(song);
    for (const sys of systems(score)) page.append(systemCanvas(score, sys));
    print.disabled = false;
    if (pdf) { pdf.disabled = false; pdf.focus(); } else print.focus();
  });
  return close;
}

/* ---------- MusicXML ---------- */

const esc = s => String(s).replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]));
const same = (a, b) => a && b && a.num === b.num && a.den === b.den;

/* One note of a chord (n), or a rest (n null), as MusicXML. Pitches are given as they sound; the
   clef, marked an octave down, shows them an octave higher, as guitar music is written. */
function noteXml(e, n, i, staff, voice, tab, group) {
  let s = '<note>';
  if (n && i) s += '<chord/>';
  s += n ? `<pitch><step>${n.step}</step>${n.alter ? `<alter>${n.alter}</alter>` : ''}<octave>${n.octave - 1}</octave></pitch>` : e.whole ? '<rest measure="yes"/>' : '<rest/>';
  s += `<duration>${e.dur}</duration>`;
  if (n && e.tieFromPrev) s += '<tie type="stop"/>';
  if (n && e.tieToNext) s += '<tie type="start"/>';
  s += `<voice>${voice}</voice>`;
  if (!e.whole) s += `<type>${e.type}</type>${'<dot/>'.repeat(e.dots)}`;
  if (n && n.accidental && !tab) s += `<accidental>${n.accidental}</accidental>`;
  if (e.tuplet) s += '<time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification>';
  if (n && !tab && e.type !== 'whole') s += `<stem>${e.stemUp ? 'up' : 'down'}</stem>`;
  s += `<staff>${staff}</staff>`;
  const marks = [];
  if (n && e.tieFromPrev) marks.push('<tied type="stop"/>');
  if (n && e.tieToNext) marks.push('<tied type="start"/>');
  if (group && i === 0) for (const type of group) marks.push(`<tuplet type="${type}"/>`);
  if (n && tab) marks.push(`<technical><string>${n.string}</string><fret>${n.fret}</fret></technical>`);
  return s + (marks.length ? `<notations>${marks.join('')}</notations>` : '') + '</note>';
}

/* One voice of one bar. Silence is stepped over, and nothing is written past the bar's end.
   Returns the text and how far through the bar it got. */
function voiceXml(list, start, ticks, staff, voice, tab) {
  let s = '', at = start;
  const kept = list.filter(e => !(e.rest && tab));
  /* triplets are marked where each group of them starts and stops: a group is a run of triplet
     values that follow straight on from each other, closed as soon as it fills whole beats */
  const marks = new Map();
  let run = 0, prev = null;
  kept.forEach((e, i) => {
    if (!e.tuplet) { run = 0; prev = e; return; }
    const opens = run === 0 || !prev || prev.tick + prev.dur !== e.tick;
    if (opens && prev && prev.tuplet && marks.has(prev) && !marks.get(prev).includes('stop')) marks.get(prev).push('stop');
    run = (opens ? 0 : run) + e.dur;
    const next = kept[i + 1], closes = run % 12 === 0 || !next || !next.tuplet || e.tick + e.dur !== next.tick;
    marks.set(e, [...(opens ? ['start'] : []), ...(closes ? ['stop'] : [])]);
    if (closes) run = 0;
    prev = e;
  });
  for (const e of kept) {
    if (e.tick < at || e.tick + e.dur > start + ticks) continue;
    if (e.tick > at) { s += `<forward><duration>${e.tick - at}</duration></forward>`; at = e.tick; }
    if (e.rest) s += noteXml(e, null, 0, staff, voice, tab, marks.get(e)); else e.notes.forEach((n, i) => { s += noteXml(e, n, i, staff, voice, tab, marks.get(e)); });
    at += e.dur;
  }
  return {xml: s, moved: at - start};
}

/* The song as a MusicXML file's text: one guitar part with a notation staff and a tab staff. */
export function musicXml(song) {
  const score = toScore(song), tuning = song && song.tuning && song.tuning.length === 6 ? song.tuning : [64, 59, 55, 50, 45, 40];
  let bars = score.bars, events = score.events, usual = score.time;
  if (!score.measured) {
    /* no beats to go by: every chord a quarter note, four to a bar */
    usual = {num: 4, den: 4};
    events = score.events.map((e, i) => ({...e, bar: i >> 2, tick: i * 48, dur: 48, type: 'quarter'}));
    bars = Array.from({length: Math.ceil(events.length / 4)}, (_, i) => ({number: i + 1, startTick: i * 192, ticks: 192, time: usual, pickup: false}));
  }
  const strings = tuning.map(spell);
  const out = ['<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">',
    '<score-partwise version="4.0">', `<work><work-title>${esc((song && song.title) || SHEET.untitled)}</work-title></work>`,
    '<part-list><score-part id="P1"><part-name>Guitar</part-name></score-part></part-list>', '<part id="P1">'];
  let time = null;
  bars.forEach((b, i) => {
    out.push(`<measure number="${b.number}"${b.pickup ? ' implicit="yes"' : ''}>`);
    const want = b.pickup ? usual : b.time;
    if (i === 0) {
      out.push(`<attributes><divisions>48</divisions><key><fifths>${score.key.fifths}</fifths></key><time><beats>${want.num}</beats><beat-type>${want.den}</beat-type></time><staves>2</staves>` +
        '<clef number="1"><sign>G</sign><line>2</line><clef-octave-change>-1</clef-octave-change></clef><clef number="2"><sign>TAB</sign><line>5</line></clef>' +
        '<staff-details number="2"><staff-lines>6</staff-lines>' +
        [6, 5, 4, 3, 2, 1].map((s, line) => `<staff-tuning line="${line + 1}"><tuning-step>${strings[s - 1].step}</tuning-step>${strings[s - 1].alter ? `<tuning-alter>${strings[s - 1].alter}</tuning-alter>` : ''}<tuning-octave>${strings[s - 1].octave}</tuning-octave></staff-tuning>`).join('') +
        '</staff-details></attributes>');
      const bpm = song && song.tempo_map && song.tempo_map[0] && song.tempo_map[0].bpm;
      if (bpm && score.measured) out.push(`<direction placement="above"><direction-type><words/></direction-type><staff>1</staff><sound tempo="${Math.round(bpm * score.beatTicks / 48)}"/></direction>`);
    } else if (!same(want, time)) out.push(`<attributes><time><beats>${want.num}</beats><beat-type>${want.den}</beat-type></time></attributes>`);
    time = want;
    const mine = events.filter(e => e.bar === i), upper = mine.filter(e => e.voice === 1), bass = mine.filter(e => e.voice === 2);
    const parts = [[upper, 1, 1, false]];
    if (bass.length) parts.push([bass, 1, 2, false]);
    parts.push([upper, 2, 5, true]);
    if (bass.length) parts.push([bass, 2, 6, true]);
    parts.forEach(([list, staff, voice, tab], k) => {
      const v = voiceXml(list, b.startTick, b.ticks, staff, voice, tab);
      out.push(v.xml);
      if (k + 1 < parts.length) { if (v.moved) out.push(`<backup><duration>${v.moved}</duration></backup>`); }
      else if (v.moved < b.ticks) out.push(`<forward><duration>${b.ticks - v.moved}</duration></forward>`);
    });
    out.push('</measure>');
  });
  out.push('</part>', '</score-partwise>');
  return out.join('\n');
}

/* The name a file of the song's sheet music is given: the song's title, without what a file's name cannot hold. */
export const fileNameOf = song => ((song && song.title) || SHEET.untitled).replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || SHEET.untitled;

/* Saves the MusicXML file through the browser, named after the song. */
export function downloadMusicXml(song) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([musicXml(song)], {type: 'application/vnd.recordare.musicxml+xml'}));
  a.download = fileNameOf(song) + '.musicxml';
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
