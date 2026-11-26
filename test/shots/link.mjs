/* A song from a link, end to end in the real app: a recording is served from this computer, the
   app fetches it with yt-dlp, Transkun writes out its notes, and the MIDI lands in the song folder.
   The recording is the built-in prelude played by the app's own piano, so the notes that come back
   can be compared with the notes that went in. More links are given while the first is still being
   worked on: they wait their turn, one that cannot be fetched stays listed to be tried again, and
   a song that is playing is not cut off when another is ready. While the GPU is transcribing, a
   light glows beside the Transcribe button and says what the GPU is doing. Pass a web link as an
   argument to try that as well. */
import {launch, songFolder, out} from './harness.mjs';
import {parseMidi} from '../../app/ui/midi.js';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import assert from 'node:assert/strict';

const folder = songFolder([]);
const a = await launch({folder});
const {win} = a;
let server;
try {
  await win.waitForFunction(() => pv.bank.ready);
  /* Settings has a Transcription section: a switch for the GPU, on where the transcriber can use one, and under it the GPU's name or that there is none */
  await win.locator('#lookBtn').click();
  await win.waitForFunction(() => pv.transcriber, null, {timeout: 60000});
  const can = await win.evaluate(() => pv.transcriber), cardSwitch = win.locator('#insp [data-sw="card"]'), light = win.locator('#gpuLight'), tip = win.locator('#gpuTip');
  assert.ok(can.tools, 'the transcriber is set up on this computer');
  console.log('transcription can use:', can.card || 'the processor only');
  await win.locator('#gpuName').scrollIntoViewIfNeeded();
  assert.equal(await win.locator('#insp .sec:has(#gpuName) h2').textContent(), 'Transcription');
  assert.equal(await win.locator('#l-card').textContent(), 'Use GPU for transcription');
  assert.equal(await win.locator('#gpuName').textContent(), can.card || 'No GPU detected');
  assert.equal(await cardSwitch.getAttribute('aria-checked'), String(!!can.card));
  assert.equal(await cardSwitch.isDisabled(), !can.card);
  assert.equal(await light.isVisible(), false, 'the light beside the Transcribe button is off while nothing is transcribed');
  await a.shot('89-settings-transcription');
  /* the first 40 seconds of the prelude as a WAV file, and the notes in it */
  const sound = await win.evaluate(async () => {
    const {renderWav} = await import('./piano.js');
    const bytes = await renderWav(pv.bank, pv.piece, -0.5, 40);
    let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return {wav: btoa(s), notes: pv.piece.notes.filter(n => n.start < 39).map(n => [n.midi, n.start + 0.5, n.track === 0])};
  });
  /* the recording is served under any name but "gone", and its first 12 seconds under "Short take" */
  const wav = Buffer.from(sound.wav, 'base64'), short = Buffer.concat([wav.subarray(0, 44), wav.subarray(44, 44 + 12 * wav.readUInt32LE(28))]);
  short.writeUInt32LE(short.length - 8, 4); short.writeUInt32LE(short.length - 44, 40);
  server = http.createServer((req, res) => {
    if (req.url.startsWith('/gone')) { res.writeHead(404); res.end(); return; }
    const bytes = req.url.startsWith('/Short') ? short : wav;
    res.writeHead(200, {'Content-Type': 'audio/wav', 'Content-Length': bytes.length}); res.end(bytes);
  }).listen(0, '127.0.0.1');
  await new Promise(r => server.once('listening', r));
  const at = name => `http://127.0.0.1:${server.address().port}/${name}.wav`, link = at('Prelude%20from%20a%20link');
  const give = async url => { await win.locator('#linkUrl').fill(url); await win.locator('#linkUrl').press('Enter'); };
  const queue = () => win.evaluate(() => pv.links.map(j => decodeURIComponent(j.url.split('/').pop()) + ' ' + j.state));

  /* a link that is not one is refused before anything runs */
  await win.locator('#linkUrl').fill('not a link');
  await win.locator('#link button[type=submit]').click();
  assert.equal(await win.evaluate(() => pv.message), await win.evaluate(() => pv.T.errLinkBad));

  await win.locator('#linkUrl').fill(link);
  await a.shot('90-link-row');
  const began = Date.now();
  await win.locator('#linkUrl').press('Enter');
  /* the box is free again at once: more links go in behind the first, and one of them is taken out again */
  assert.equal(await win.inputValue('#linkUrl'), '');
  await give(at('Short%20take')); await give(at('gone')); await give(at('Not%20wanted')); await give(at('Short%20take'));
  assert.deepEqual(await queue(), ['Prelude from a link.wav download', 'Short take.wav waiting', 'gone.wav waiting', 'Not wanted.wav waiting'], 'links wait in the order given, and the same link is not listed twice');
  await win.locator('#linkJobs li').nth(3).locator('.cut').click();
  assert.deepEqual((await queue()).slice(1), ['Short take.wav waiting', 'gone.wav waiting']);
  await win.waitForFunction(() => pv.linking === 'transcribe', null, {timeout: 120000});
  /* while the GPU writes out the notes, the light beside the Transcribe button glows, brighter and dimmer by turns;
     with the pointer on it, a line says how much of the GPU's memory the work holds */
  await win.waitForFunction(() => pv.links[0].card !== undefined, null, {timeout: 120000});
  const wrote = Date.now();
  assert.equal(await win.evaluate(() => pv.links[0].card), !!can.card);
  if (can.card) {
    assert.equal(await light.isVisible(), true, 'the light is on');
    assert.equal(await tip.isVisible(), false, 'and says nothing until it is pointed at');
    const beside = await win.evaluate(() => { const l = document.getElementById('gpuLight').getBoundingClientRect(), b = document.querySelector('#link button[type=submit]').getBoundingClientRect(); return {gap: Math.round(b.left - l.right), level: Math.abs((l.top + l.bottom) / 2 - (b.top + b.bottom) / 2) < 3, size: Math.round(l.width)}; });
    assert.ok(beside.gap >= 0 && beside.gap <= 12 && beside.level && beside.size <= 10, 'a small light just left of the button: ' + JSON.stringify(beside));
    await light.hover();
    assert.equal(await tip.isVisible(), true);
    await win.waitForFunction(() => pv.links[0].memory > 0 && /^Transcribing on the GPU, using \d+(\.\d)? (MB|GB) of its memory$/.test(document.getElementById('gpuTip').textContent), null, {timeout: 60000});
    await a.shot('91-link-transcribing');
    const glow = [], seen = [];
    for (let i = 0; i < 12 && await win.evaluate(() => pv.linking === 'transcribe' && pv.links[0].memory > 0); i++) {
      glow.push(+(await light.evaluate(el => getComputedStyle(el).opacity)));
      seen.push(Math.round(await win.evaluate(() => pv.links[0].memory) / 1e6));
      await win.waitForTimeout(700);
    }
    console.log('GPU memory held while transcribing, MB:', seen.join(', '), '| the light\'s brightness:', glow.map(g => g.toFixed(2)).join(', '));
    assert.ok(Math.max(...glow) - Math.min(...glow) > 0.2, 'the light grows brighter and dimmer');
    assert.equal(await light.evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(180, 140, 242)', 'and it is purple');
    await win.mouse.move(700, 300);
    assert.equal(await tip.isVisible(), false);
  } else {
    assert.equal(await light.isVisible(), false, 'no light while the processor transcribes');
    await a.shot('91-link-transcribing');
  }
  /* the switch is turned off for the links after this one */
  if (can.card) { await cardSwitch.click(); assert.equal(await win.evaluate(() => pv.S.card), false); }
  await win.waitForFunction(() => !pv.links.some(j => j.url.includes('Prelude')), null, {timeout: 900000});
  const secs = (Date.now() - began) / 1000;
  console.log(`notes of a 40 s recording written out in ${((Date.now() - wrote) / 1000).toFixed(0)} s on ${can.card ? 'the GPU' : 'the processor'}`);
  assert.equal(await light.isVisible(), false, 'the light goes out when the notes are written');
  assert.equal(await win.evaluate(() => pv.lastLink.card), !!can.card, 'the transcriber itself said what it ran on');
  await win.waitForFunction(() => pv.current !== ':built-in' || pv.message, null, {timeout: 15000});
  const state = await win.evaluate(() => ({current: pv.current, songs: pv.songs.map(s => s.name), message: pv.message, title: document.getElementById('title').textContent}));
  console.log(`link finished in ${secs.toFixed(0)} s:`, JSON.stringify(state));
  assert.deepEqual(fs.readdirSync(folder), ['Prelude from a link.mid'], 'the MIDI was saved into the song folder under the recording\'s name');
  assert.equal(state.current, 'Prelude from a link.mid', 'and opened');

  /* the next link started by itself. The new song is set playing: the one that arrives meanwhile does not take the stage */
  assert.equal((await queue())[0].replace(/ (download|transcribe)$/, ''), 'Short take.wav');
  await win.evaluate(() => { pv.play(); window.again = setInterval(() => { if (pv.now() > 20) pv.seek(1); }, 500); });
  /* with the switch off, this one is written out on the processor, and the light stays off */
  await win.waitForFunction(() => pv.links[0] && pv.links[0].state === 'transcribe' && pv.links[0].card !== undefined, null, {timeout: 120000});
  assert.equal(await win.evaluate(() => pv.links[0].card), false);
  assert.equal(await light.isVisible(), false);
  await win.waitForFunction(() => pv.songs.some(s => s.name === 'Short take.mid'), null, {timeout: 600000});
  assert.equal(await win.evaluate(() => pv.lastLink.card), false);
  await win.waitForFunction(() => pv.links.length === 1 && pv.links[0].state === 'failed', null, {timeout: 120000});
  assert.equal(await win.evaluate(() => pv.current), 'Prelude from a link.mid', 'the song that was playing stays on stage');
  assert.equal(await win.evaluate(() => pv.playing), true);
  await win.evaluate(() => { clearInterval(window.again); pv.pause(); });
  console.log('queue: second link done after', ((Date.now() - began) / 1000).toFixed(0), 's; left:', JSON.stringify(await queue()), '| message:', await win.evaluate(() => pv.message));
  /* the link that could not be fetched stays listed, saying why on hover, until it is tried again or removed */
  assert.equal(await win.evaluate(() => pv.message), await win.evaluate(() => pv.T.errLinkDownload));
  assert.equal(await win.locator('#linkJobs li').getAttribute('title'), await win.evaluate(() => pv.T.errLinkDownload));
  await a.shot('93-link-failed');
  await win.locator('#linkJobs .again').click();
  await win.waitForFunction(() => pv.links.length === 1 && pv.links[0].state === 'failed', null, {timeout: 120000});
  await win.locator('#linkJobs .cut').click();
  assert.deepEqual(await queue(), []);
  assert.deepEqual(fs.readdirSync(folder).sort(), ['Prelude from a link.mid', 'Short take.mid']);

  /* how much of the piece came back: a note counts when the same key starts within 60 ms */
  const saved = parseMidi(new Uint8Array(fs.readFileSync(path.join(folder, 'Prelude from a link.mid'))));
  assert.deepEqual(saved.tracks.map(t => t.name), ['Right Hand', 'Left Hand'], 'the song has a track for each hand');
  const got = saved.notes.map(n => [n.midi, n.start, n.track === 0]);
  let found = 0, rightHand = 0;
  const used = new Set();
  for (const [midi, start, right] of sound.notes) {
    const i = got.findIndex((g, k) => !used.has(k) && g[0] === midi && Math.abs(g[1] - start) < 0.06);
    if (i >= 0) { used.add(i); found++; if (got[i][2] === right) rightHand++; }
  }
  console.log(`hands: ${rightHand} of ${found} notes are in the hand that played them (${saved.tracks.map(t => t.name + ' ' + t.count).join(', ')})`);
  assert.ok(rightHand / found > 0.6, 'most notes land in the hand that played them');
  console.log(`transcription: ${found} of ${sound.notes.length} notes found again; ${got.length - used.size} extra notes`);
  assert.ok(found / sound.notes.length > 0.9, 'most notes are recovered');
  await win.waitForTimeout(400);
  await a.shot('92-link-song-open');

  /* stopping partway leaves nothing behind */
  await give(at('Short%20take'));
  await win.waitForFunction(() => pv.linking === 'transcribe', null, {timeout: 120000});
  await win.locator('#linkCancel').click();
  await win.waitForFunction(() => !pv.linking, null, {timeout: 30000});
  assert.deepEqual(fs.readdirSync(folder).sort(), ['Prelude from a link.mid', 'Short take.mid'], 'cancelling saves nothing');
  assert.equal(await win.inputValue('#linkUrl'), at('Short%20take'), 'the link goes back in the box after stopping');
  await win.locator('#linkUrl').fill('');
  console.log('cancel: stopped cleanly, nothing saved');

  for (const url of process.argv.slice(2)) {
    await win.locator('#linkUrl').fill(url);
    const t0 = Date.now();
    await win.locator('#linkUrl').press('Enter');
    await win.waitForFunction(() => pv.linking, null, {timeout: 10000});
    await win.waitForFunction(() => !pv.linking, null, {timeout: 1800000});
    console.log(`${url}: ${((Date.now() - t0) / 1000).toFixed(0)} s ->`, JSON.stringify(await win.evaluate(() => ({current: pv.current, message: pv.message}))), fs.readdirSync(folder).join(' | '));
  }
  console.log('LINK CHECKS PASSED');
} finally {
  console.log(a.problems.slice(0, 8).join('\n') || 'no console problems');
  if (server) server.close();
  await a.close();
}
