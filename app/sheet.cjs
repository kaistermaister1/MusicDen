/* Sheet music through MuseScore: a MIDI file goes in, and one long line of staves comes back as
   pictures, with the place and time of every measure and every note column. What comes back can
   be kept on disk for each song and read again. Also runs the hand-splitting script, which says
   which hand plays each note of a song that has only one track. */
const {spawn} = require('node:child_process');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

/* MuseScore's program file: the one MUSICDEN_MUSESCORE names, otherwise the usual install folders. */
let program = null;
function find() {
  if (program !== null) return program;
  const named = process.env.MUSICDEN_MUSESCORE;
  const homes = [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs')].filter(Boolean);
  const usual = homes.map(dir => path.join(dir, 'MuseScore 4', 'bin', 'MuseScore4.exe'));
  program = (named !== undefined ? [named] : usual).find(file => { try { return fs.statSync(file).isFile(); } catch (e) { return false; } }) || '';
  return program;
}

/* How MuseScore reads the file. Each track stays on its own staff, clefs stay fixed, and the
   first measure is never treated as a pickup, so measures fall where the file's meter puts them. */
const OPTIONS = `<?xml version="1.0" encoding="UTF-8"?>
<MidiOptions>
  <QuantValue>3</QuantValue>
  <VoiceCount>3</VoiceCount>
  <Duplets>false</Duplets>
  <Triplets>true</Triplets>
  <Quadruplets>true</Quadruplets>
  <Quintuplets>true</Quintuplets>
  <Septuplets>true</Septuplets>
  <Nonuplets>true</Nonuplets>
  <HumanPerformance>false</HumanPerformance>
  <MeasureCount2xLess>false</MeasureCount2xLess>
  <SplitStaff>false</SplitStaff>
  <ClefChanges>false</ClefChanges>
  <SimplifyDurations>true</SimplifyDurations>
  <ShowStaccato>false</ShowStaccato>
  <DottedNotes>true</DottedNotes>
  <RecognizePickupBar>false</RecognizePickupBar>
  <Swing>0</Swing>
</MidiOptions>
`;

/* A page so wide and so low that it holds a single system. The last system is never stretched to
   fill it. Sizes are in inches; 270 keeps every coordinate in the pictures to a tenth of a unit. */
const PAGE_WIDE = 270;
const style = staves => {
  const tall = (1.1 + 1.15 * staves).toFixed(2);
  return `<?xml version="1.0" encoding="UTF-8"?>
<museScore version="4.30">
  <Style>
    <pageWidth>${PAGE_WIDE}</pageWidth>
    <pageHeight>${tall}</pageHeight>
    <pagePrintableWidth>${PAGE_WIDE - 0.4}</pagePrintableWidth>
    <pageEvenLeftMargin>0.2</pageEvenLeftMargin>
    <pageOddLeftMargin>0.2</pageOddLeftMargin>
    <pageEvenTopMargin>0.1</pageEvenTopMargin>
    <pageEvenBottomMargin>0.1</pageEvenBottomMargin>
    <pageOddTopMargin>0.1</pageOddTopMargin>
    <pageOddBottomMargin>0.1</pageOddBottomMargin>
    <pageTwosided>0</pageTwosided>
    <enableVerticalSpread>0</enableVerticalSpread>
    <lastSystemFillLimit>1</lastSystemFillLimit>
    <enableIndentationOnFirstSystem>0</enableIndentationOnFirstSystem>
    <showHeader>0</showHeader>
    <showFooter>0</showFooter>
    <hideInstrumentNameIfOneInstrument>1</hideInstrumentNameIfOneInstrument>
  </Style>
</museScore>
`;
};

let job = null;
/* Engraves `midi` (a MIDI file's bytes, one track per staff) on `staves` staves. Gives back the pages as SVG text and
   MuseScore's two position lists as XML text, or null when a newer request took its place. */
async function engrave({midi, staves}) {
  const exe = find();
  if (!exe) throw new Error('no-musescore');
  if (job) job.stop();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'musicden-sheet-'));
  const j = job = {procs: [], stopped: false, stop() { this.stopped = true; for (const p of this.procs) { try { p.kill(); } catch (e) {} } }};
  try {
    const song = path.join(dir, 'song.mid'), how = path.join(dir, 'options.xml'), look = path.join(dir, 'line.mss');
    fs.writeFileSync(song, Buffer.from(midi));
    fs.writeFileSync(how, OPTIONS);
    fs.writeFileSync(look, style(staves));
    /* The picture and the two position lists are separate exports; they run side by side.
       The picture is cut down to the music with a small margin. */
    const exports = [['svg', ['-T', '24']], ['mpos', []], ['spos', []]];
    const codes = await Promise.all(exports.map(([kind, extra]) => new Promise(resolve => {
      const p = spawn(exe, ['-M', how, '-S', look, ...extra, '-o', path.join(dir, 'line.' + kind), song], {windowsHide: true, stdio: 'ignore'});
      j.procs.push(p);
      const giveUp = setTimeout(() => { try { p.kill(); } catch (e) {} }, 90000);
      p.on('error', () => { clearTimeout(giveUp); resolve(-1); });
      p.on('close', code => { clearTimeout(giveUp); resolve(code); });
    })));
    if (j.stopped) return null;
    if (codes.some(code => code !== 0)) throw new Error('engrave');
    const pages = fs.readdirSync(dir).map(name => /^line-(\d+)\.svg$/.exec(name)).filter(Boolean)
      .sort((a, b) => a[1] - b[1]).map(m => fs.readFileSync(path.join(dir, m[0]), 'utf8'));
    if (!pages.length) throw new Error('engrave');
    return {pages, measures: fs.readFileSync(path.join(dir, 'line.mpos'), 'utf8'), columns: fs.readFileSync(path.join(dir, 'line.spos'), 'utf8')};
  } finally {
    if (job === j) job = null;
    fs.rm(dir, {recursive: true, force: true}, () => {});
  }
}

/* ---------- engraved sheet music kept on disk ---------- */
/* One file for each song, in `dir`: what engrave() gave back, with the `key` of what was engraved
   and a mark of how MuseScore was asked to engrave it. A song's file answers only for that key
   and that way of asking, so changed notes, changed hands or changed engraving all mean engraving
   again. */
const MANNER = crypto.createHash('sha1').update(OPTIONS + style(2)).digest('hex').slice(0, 12);
const KEPT = 300;          /* files kept; the ones longest unused go first */
const fileFor = (dir, song) => path.join(dir, song.replace(/[\\/:*?"<>|]/g, '_') + '.sheet');
async function saved(dir, song, key) {
  try {
    const kept = JSON.parse(zlib.gunzipSync(await fs.promises.readFile(fileFor(dir, song))).toString('utf8'));
    if (kept.key !== key || kept.manner !== MANNER) return null;
    fs.promises.utimes(fileFor(dir, song), new Date(), new Date()).catch(() => {});
    return {pages: kept.pages, measures: kept.measures, columns: kept.columns};
  } catch (e) { return null; }
}
async function save(dir, song, key, engraved) {
  const file = fileFor(dir, song), temp = file + '.saving';
  await fs.promises.mkdir(dir, {recursive: true});
  await fs.promises.writeFile(temp, zlib.gzipSync(JSON.stringify({key, manner: MANNER, pages: engraved.pages, measures: engraved.measures, columns: engraved.columns})));
  await fs.promises.rename(temp, file);
  const all = (await fs.promises.readdir(dir)).filter(name => name.endsWith('.sheet'));
  if (all.length <= KEPT) return;
  const aged = await Promise.all(all.map(async name => ({name, used: (await fs.promises.stat(path.join(dir, name))).mtimeMs})));
  for (const old of aged.sort((a, b) => a.used - b.used).slice(0, all.length - KEPT)) await fs.promises.unlink(path.join(dir, old.name)).catch(() => {});
}

/* ---------- sheet music as a PDF ---------- */
/* Has MuseScore lay `midi` out on ordinary pages, with `title` printed over the first line, and
   keeps the result in `dir` under `name`: the PDF itself, and the same pages as pictures for
   looking at in the app. A MIDI file carries no title MuseScore prints, so the file is first
   turned into a score, the title is written into that, and the pages are made from the score. */
async function print(dir, name, {midi, title}) {
  const exe = find();
  if (!exe) throw new Error('no-musescore');
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'musicden-pdf-'));
  try {
    const song = path.join(work, 'song.mid'), how = path.join(work, 'options.xml'), score = path.join(work, 'score.mscx');
    fs.writeFileSync(song, Buffer.from(midi));
    fs.writeFileSync(how, OPTIONS);
    const run = args => new Promise(resolve => {
      const p = spawn(exe, args, {windowsHide: true, stdio: 'ignore'});
      const giveUp = setTimeout(() => { try { p.kill(); } catch (e) {} }, 120000);
      p.on('error', () => { clearTimeout(giveUp); resolve(-1); });
      p.on('close', code => { clearTimeout(giveUp); resolve(code); });
    });
    if (await run(['-M', how, '-o', score, song]) !== 0) throw new Error('print');
    /* the title goes in a frame of its own ahead of the first measure */
    const xml = fs.readFileSync(score, 'utf8'), at = xml.indexOf('<Measure>');
    if (title && at >= 0) {
      const text = String(title).replace(/[&<>]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;'}[c]));
      fs.writeFileSync(score, xml.slice(0, at) + `<VBox><height>10</height><Text><style>title</style><text>${text}</text></Text></VBox>\n` + xml.slice(at));
    }
    const codes = await Promise.all(['pdf', 'svg'].map(kind => run(['-o', path.join(work, 'page.' + kind), score])));
    if (codes.some(code => code !== 0)) throw new Error('print');
    const pages = fs.readdirSync(work).map(f => /^page-(\d+)\.svg$/.exec(f)).filter(Boolean).sort((a, b) => a[1] - b[1]).map(m => fs.readFileSync(path.join(work, m[0]), 'utf8'));
    if (!pages.length) throw new Error('print');
    await fs.promises.mkdir(dir, {recursive: true});
    await fs.promises.copyFile(path.join(work, 'page.pdf'), path.join(dir, name + '.pdf'));
    await fs.promises.writeFile(path.join(dir, name + '.pages'), zlib.gzipSync(JSON.stringify(pages)));
    return path.join(dir, name + '.pdf');
  } finally {
    fs.rm(work, {recursive: true, force: true}, () => {});
  }
}
/* The PDFs kept in `dir`, newest first: {name, file, size, pages}. */
async function printed(dir) {
  let names = [];
  try { names = (await fs.promises.readdir(dir)).filter(f => f.endsWith('.pdf')); } catch (e) {}
  const out = [];
  for (const f of names) { try { const st = await fs.promises.stat(path.join(dir, f)); out.push({name: f.slice(0, -4), file: path.join(dir, f), size: st.size, when: st.mtimeMs}); } catch (e) {} }
  return out.sort((a, b) => b.when - a.when);
}
const pagesOf = async (dir, name) => JSON.parse(zlib.gunzipSync(await fs.promises.readFile(path.join(dir, name + '.pages'))).toString('utf8'));
async function unprint(dir, name) {
  if (path.basename(name) !== name) throw new Error('name');
  for (const ext of ['.pdf', '.pages']) await fs.promises.unlink(path.join(dir, name + ext)).catch(() => {});
}
/* Gives a kept PDF another name. Refuses a name another PDF already has. */
async function rename(dir, from, to) {
  if (!to || path.basename(from) !== from || path.basename(to) !== to) throw new Error('name');
  if (from.toLowerCase() !== to.toLowerCase() && fs.existsSync(path.join(dir, to + '.pdf'))) throw new Error('taken');
  await fs.promises.rename(path.join(dir, from + '.pdf'), path.join(dir, to + '.pdf'));
  await fs.promises.rename(path.join(dir, from + '.pages'), path.join(dir, to + '.pages')).catch(() => {});
}

/* Moves the PDFs kept in `from` into `to`, with their pages, and gives the names of the ones moved.
   One whose name is already taken there stays where it is. */
async function adopt(from, to) {
  let names = [];
  const moved = [];
  try { names = (await fs.promises.readdir(from)).filter(f => f.endsWith('.pdf')); } catch (e) {}
  if (!names.length) return moved;
  await fs.promises.mkdir(to, {recursive: true});
  for (const f of names) {
    if (fs.existsSync(path.join(to, f))) continue;
    try { await fs.promises.rename(path.join(from, f), path.join(to, f)); } catch (e) { continue; }
    const pages = f.slice(0, -4) + '.pages';
    await fs.promises.rename(path.join(from, pages), path.join(to, pages)).catch(() => {});
    moved.push(f.slice(0, -4));
  }
  return moved;
}

/* ---------- saved sheet music as the account keeps it ---------- */
/* In the account a saved sheet is one file: the letters MDS1, the PDF's length as four bytes, the
   PDF, and then its pages as they are kept beside it here. The same file is what a phone keeps. */
const MARK = Buffer.from('MDS1');
const plain = name => typeof name === 'string' && !!name && path.basename(name) === name && !/[\\/:*?"<>|\x00-\x1f]/.test(name);
/* The saved sheets in `dir` as a sync sees them: {name, size, changed}. */
async function kept(dir) {
  return (await printed(dir)).map(s => ({name: s.name, size: s.size, changed: s.when}));
}
async function bundle(dir, name) {
  if (!plain(name)) throw new Error('name');
  const pdf = await fs.promises.readFile(path.join(dir, name + '.pdf'));
  const pages = await fs.promises.readFile(path.join(dir, name + '.pages')).catch(() => zlib.gzipSync('[]'));
  const size = Buffer.alloc(4);
  size.writeUInt32LE(pdf.length);
  return Buffer.concat([MARK, size, pdf, pages]);
}
async function unbundle(dir, name, bytes) {
  const all = Buffer.from(bytes);
  if (!plain(name) || all.length < 8 || !all.subarray(0, 4).equals(MARK)) throw new Error('name');
  const end = 8 + all.readUInt32LE(4);
  if (end > all.length) throw new Error('name');
  await fs.promises.mkdir(dir, {recursive: true});
  const pdf = path.join(dir, name + '.pdf'), pages = path.join(dir, name + '.pages');
  await fs.promises.writeFile(pages + '.saving', all.subarray(end));
  await fs.promises.rename(pages + '.saving', pages);
  await fs.promises.writeFile(pdf + '.saving', all.subarray(8, end));
  await fs.promises.rename(pdf + '.saving', pdf);
}
/* What was in step between the saved sheets in `dir` and the account when they were last synced, kept with them. */
const RECORD = '.sync.json';
const record = async dir => { try { return JSON.parse(await fs.promises.readFile(path.join(dir, RECORD), 'utf8')); } catch (e) { return null; } };
async function keepRecord(dir, what) {
  await fs.promises.mkdir(dir, {recursive: true});
  await fs.promises.writeFile(path.join(dir, RECORD + '.saving'), JSON.stringify(what));
  await fs.promises.rename(path.join(dir, RECORD + '.saving'), path.join(dir, RECORD));
}

/* ---------- which hand plays each note ---------- */
/* The Pythons to try: the one MUSICDEN_PYTHON names, otherwise the one "npm run transcriber" sets up,
   then whatever is on the PATH. */
function pythons() {
  const named = process.env.MUSICDEN_PYTHON;
  if (named !== undefined) return [named];
  const own = path.join(process.env.LOCALAPPDATA || '', 'MusicDen', 'transcriber', 'Scripts', 'python.exe');
  return [...(fs.existsSync(own) ? [own] : []), 'python', 'py'];
}
/* Hands the notes on its input to tools/hand_split.py and prints a 1 for each right-hand note
   and a 0 for each left-hand one, in the order the notes came. */
const SPLITTER = `import sys, json
sys.path.insert(0, sys.argv[1])
from hand_split import assign_hands
class Note:
    __slots__ = ('start', 'end', 'pitch')
    def __init__(self, a): self.start, self.end, self.pitch = a
print(''.join('1' if right else '0' for right in assign_hands([Note(a) for a in json.load(sys.stdin)])))
`;
let python = '';
/* Sorts `notes` ([start, end, pitch] in seconds and MIDI pitch) into hands. Gives back a string
   with a '1' or '0' for each note, or null when no Python on this computer could run the script. */
async function hands(notes) {
  const input = JSON.stringify(notes);
  for (const exe of python ? [python] : pythons()) {
    const answer = await new Promise(resolve => {
      let text = '';
      const p = spawn(exe, ['-c', SPLITTER, path.join(__dirname, 'tools')], {windowsHide: true, stdio: ['pipe', 'pipe', 'ignore']});
      const giveUp = setTimeout(() => { try { p.kill(); } catch (e) {} }, 60000);
      p.on('error', () => { clearTimeout(giveUp); resolve(null); });
      p.stdout.on('data', chunk => { text += chunk; });
      p.on('close', code => { clearTimeout(giveUp); resolve(code === 0 ? text.trim() : null); });
      p.stdin.on('error', () => {});
      p.stdin.end(input);
    });
    if (answer !== null && answer.length === notes.length && /^[01]*$/.test(answer)) { python = exe; return answer; }
  }
  return null;
}

module.exports = {available: async () => !!find(), engrave, hands, saved, save, print, printed, pagesOf, unprint, rename, adopt, kept, bundle, unbundle, record, keepRecord};
