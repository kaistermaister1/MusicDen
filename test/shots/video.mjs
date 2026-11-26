/* Saves videos from the real app and checks what came out: size, frame rate, length, sound,
   colors, and how long the saving took compared with the length of the video.
   Usage: node test/shots/video.mjs [hd|uhd] [30|60] [wide|tall] [flat|solid] */
import {launch, out} from './harness.mjs';
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

const [size = 'hd', rate = '60', shape = 'wide', view = 'flat'] = process.argv.slice(2);
const tag = `${size}-${rate}-${shape}-${view}`, file = path.join(out, `video-${tag}.mp4`);
try { fs.unlinkSync(file); } catch (e) {}
const a = await launch();
const {win} = a;
try {
  await win.waitForFunction(() => pv.bank.ready);
  await win.evaluate(([size, rate, shape, view, file]) => {
    pv.set('videoSize', size); pv.set('videoRate', rate); pv.set('videoShape', shape); pv.set('view', view);
    window.pvVideoFile = file; pv.saveVideo();
  }, [size, rate, shape, view, file]);
  await win.waitForFunction(() => pv.busy, null, {timeout: 20000});
  await win.waitForTimeout(6000);
  await a.shot(`30-video-saving-${tag}`);
  await win.waitForFunction(() => window.pvVideo, null, {timeout: 900000});
  const r = await win.evaluate(() => window.pvVideo);
  await a.shot(`31-video-saved-${tag}`);
  if (r.error) throw new Error('saving failed: ' + r.error);
  console.log(`${tag}: ${r.frames} frames in ${r.seconds.toFixed(1)} s = ${(r.frames / r.seconds).toFixed(0)} frames a second; video is ${r.length.toFixed(1)} s long, saved ${(r.length / r.seconds).toFixed(1)}x faster than it plays (encoder ${r.encoder})`);
  console.log('per frame, ms:', Object.entries(r.spent).map(([k, v]) => k + ' ' + (v / r.frames * 1000).toFixed(1)).join(', '));
  const probe = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_name,width,height,r_frame_rate,pix_fmt,sample_rate,channels,duration,nb_frames', '-of', 'compact', file], {encoding: 'utf8'});
  console.log(probe.stdout.trim());
  console.log('file size', (fs.statSync(file).size / 1e6).toFixed(1), 'MB');
  /* the frame one second in: the first notes have just reached the keys */
  for (const t of ['1.05', '8']) {
    const png = path.join(out, `video-${tag}-at-${t}.png`);
    spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-ss', t, '-i', file, '-frames:v', '1', png]);
  }
  /* when the sound starts: the first note is struck one second into the video */
  const pcm = spawnSync('ffmpeg', ['-v', 'error', '-i', file, '-t', '3', '-ac', '1', '-ar', '48000', '-f', 'f32le', '-'], {maxBuffer: 1 << 26}).stdout;
  const s = new Float32Array(pcm.buffer, pcm.byteOffset, pcm.length >> 2);
  let first = -1, peak = 0;
  for (let i = 0; i < s.length; i++) { const v = Math.abs(s[i]); if (v > peak) peak = v; if (first < 0 && v > 0.01) first = i; }
  console.log('sound starts at', (first / 48000).toFixed(3), 's; loudest sample in the first 3 s', peak.toFixed(3));
} finally {
  console.log(a.problems.join('\n') || 'no console problems');
  await a.close();
}
