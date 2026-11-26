/* The settings column: flat sections of label-and-control rows. */
import {S, PALETTES, PITCH} from './settings.js';
import {T, fill} from './strings.js';
import {offlineText, canInstall, installHint} from './offline.js';

export const esc = s => String(s).replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]));
const FORMAT = {window: v => v.toFixed(1) + ' s', width: v => Math.round(v * 100) + '%', tilt: v => Math.round(v * 70) + '°', fineSpan: v => '±' + v + ' s'};
export const shown = (k, v) => (FORMAT[k] || (x => String(Math.round(x * 100))))(v);

export const ICON = {
  play: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 2.5v11l9.5-5.5z"/></svg>',
  pause: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 2.5h3v11h-3zM9.5 2.5h3v11h-3z"/></svg>',
  restart: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 2.5h2v11H3zM13.5 2.5v11L6 8z"/></svg>',
  sound: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 6h2.5L8 3v10L4.5 10H2z"/><path class="ln" d="M10.5 5.5a3.5 3.5 0 010 5"/></svg>',
  muted: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 6h2.5L8 3v10L4.5 10H2z"/><path class="ln" d="M10.5 6l3.5 4M14 6l-3.5 4"/></svg>',
  x: '<svg viewBox="0 0 16 16" aria-hidden="true"><path class="ln" d="M4 4l8 8M12 4l-8 8"/></svg>',
  full: '<svg viewBox="0 0 16 16" aria-hidden="true"><path class="ln" d="M2.5 6V2.5H6M10 2.5h3.5V6M13.5 10v3.5H10M6 13.5H2.5V10"/></svg>',
  unfull: '<svg viewBox="0 0 16 16" aria-hidden="true"><path class="ln" d="M6 2.5V6H2.5M13.5 6H10V2.5M10 13.5V10h3.5M2.5 10H6v3.5"/></svg>',
  zoom: '<svg viewBox="0 0 16 16" aria-hidden="true"><path class="ln" d="M1.5 8h13M4.5 5L1.5 8l3 3M11.5 5l3 3-3 3M8 4.5v7"/></svg>'
};

/* `state`: the piece, whether it is the built-in one, the MIDI keyboard status line, whether a video
   is being saved, the folder on this computer where the songs are kept, what transcribing can run
   on here ({tools, card}, null until that is known), and what a transcription under way is running on. */
export function inspectorHtml({piece, builtIn, midiStatus, busy, folder, transcriber, cardNow}) {
  const web = document.documentElement.classList.contains('web');
  /* the graphics card can be chosen only where the transcriber can use one; without one the line under the switch says why */
  const card = transcriber && transcriber.tools ? transcriber.card : '';
  const cardSays = !transcriber ? '' : !transcriber.tools ? T.errLinkTools : card || T.cardNone;
  const slider = (k, label, min, max, step) =>
    `<div class="row"><label for="r-${k}">${label}</label><input id="r-${k}" type="range" data-k="${k}" min="${min}" max="${max}" step="${step}" value="${S[k]}" style="--p:${(S[k] - min) / (max - min) * 100}%"><output id="o-${k}" for="r-${k}">${shown(k, S[k])}</output></div>`;
  const choice = (k, label, opts) =>
    `<div class="row"><span class="lab" id="l-${k}">${label}</span><div class="seg" role="radiogroup" aria-labelledby="l-${k}">${opts.map(([v, text]) => `<button type="button" role="radio" aria-checked="${S[k] === v}" data-seg="${k}" data-v="${v}">${text}</button>`).join('')}</div></div>`;
  const toggle = k => `<button type="button" class="sw" role="switch" aria-checked="${!!S[k]}" aria-labelledby="l-${k}" data-sw="${k}"></button>`;
  const onOff = (k, label) => `<div class="row"><span class="lab" id="l-${k}">${label}</span>${toggle(k)}</div>`;

  const trackRows = piece.tracks.map((tr, i) => {
    const name = esc(tr.name);
    const swatch = S.colorBy === 'track' ? `<input type="color" id="tc-${i}" data-c="track:${i}" value="${tr.color}" aria-label="${fill(T.trackColor, {name})}">` : '';
    return `<div class="trk">${swatch}<span class="name">${name}</span><span class="cnt" id="cnt-${i}">${tr.count}</span><button type="button" class="ib" data-mute="${i}" aria-pressed="${tr.muted}" aria-label="${fill(T.mute, {name})}">${tr.muted ? ICON.muted : ICON.sound}</button></div>`;
  }).join('');

  let colorRows = '';
  if (S.colorBy === 'track') {
    colorRows = `<div class="row"><span class="lab">${T.palette}</span><div class="pals">${PALETTES.map((p, i) => `<button type="button" class="pal" data-pal="${i}" aria-pressed="${S.palette === i}" aria-label="${T.palette} ${i + 1}"><i style="background:${p[0]}"></i><i style="background:${p[1]}"></i></button>`).join('')}</div></div>`;
  } else if (S.colorBy === 'pitch') {
    colorRows = `<div class="pcs">${S.pitch.map((c, i) => `<label><input type="color" id="pc-${i}" data-c="pitch:${i}" value="${c}">${PITCH[i]}</label>`).join('')}</div>`;
  } else {
    colorRows = `<div class="row"><label for="c-single">${T.noteColor}</label><input class="end" type="color" id="c-single" data-c="single" value="${S.single}"></div>`;
  }

  return `<section class="sec"><h2>${T.tracks}</h2>${trackRows}</section>` +
    `<section class="sec"><h2>${T.color}</h2>${choice('colorBy', T.colorBy, [['track', T.byTrack], ['pitch', T.byPitch], ['one', T.byOne]])}${colorRows}` +
      `<div class="row"><label for="c-bg">${T.background}</label><input class="end" type="color" id="c-bg" data-c="bg" value="${S.bg}"></div></section>` +
    `<section class="sec"><h2>${T.notes}</h2>${choice('view', T.view, [['flat', T.flat], ['solid', T.solid]])}` +
      (S.view === 'solid' ? slider('tilt', T.tilt, 0, 1, 0.01) : '') +
      choice('shape', T.shape, [['bar', T.bar], ['pill', T.pill], ['outline', T.outline]]) + choice('finish', T.finish, [['matte', T.matte], ['gloss', T.gloss]]) + choice('motion', T.motion, [['fall', T.fall], ['rise', T.rise]]) +
      slider('window', T.onScreen, 1.5, 8, 0.1) + slider('width', T.width, 0.5, 1, 0.01) +
      (document.documentElement.classList.contains('web') ? slider('fineSpan', T.fineScrub, 1, 30, 1) : '') +
      onOff('octaveLines', T.guideLines) + onOff('noteNames', T.noteNames) +
      (S.noteNames ? choice('nameColor', T.nameColor, [['black', T.nameBlack], ['white', T.nameWhite]]) + slider('nameSize', T.nameSize, 0, 1, 0.01) : '') + `</section>` +
    `<section class="sec"><h2>${T.light}</h2>` + slider('glow', T.glow, 0, 1, 0.01) + slider('spill', T.spill, 0, 1, 0.01) +
      onOff('edgeLight', T.edgeLight) + onOff('haze', T.haze) + onOff('keyLight', T.litKeys) + `</section>` +
    `<section class="sec"><h2><span id="l-sparks">${T.sparks}</span>${toggle('sparks')}</h2>` +
      (S.sparks ? slider('amount', T.amount, 0, 1, 0.01) + slider('lift', T.lift, 0, 1, 0.01) + slider('drift', T.drift, 0, 1, 0.01) + slider('smoke', T.smoke, 0, 1, 0.01) : '') + `</section>` +
    `<section class="sec"><h2>${T.keyboard}</h2>${choice('range', T.range, [['full', T.full], ['fit', T.fit]])}` +
      onOff('octaveLabels', T.octaveLabels) + `</section>` +
    `<section class="sec"><h2>${T.edit}</h2>` + onOff('editHands', T.editHands) +
      (S.editHands ? `<p class="hint">${piece.tracks.length > 2 ? T.editHintMany : T.editHint} ${builtIn ? T.editsDemo : T.editsKept}</p>` : '') +
      `<button type="button" class="tb" id="copy">${T.saveCopy}</button></section>` +
    `<section class="sec"><h2>${T.sheet}</h2><button type="button" class="tb" id="sheetPdf"${busy ? ' disabled' : ''}>${T.savePdf}</button></section>` +
    `<section class="sec"><h2>${T.video}</h2>${choice('videoSize', T.videoSize, [['hd', T.hd], ['uhd', T.uhd]])}${choice('videoRate', T.videoRate, [['30', T.fps30], ['60', T.fps60]])}${choice('videoShape', T.videoShape, [['wide', T.wide], ['tall', T.tall]])}` +
      `<button type="button" class="tb" id="video"${busy ? ' disabled' : ''}>${T.saveVideo}</button></section>` +
    `<section class="sec"><h2>${T.playAlong}</h2><p class="hint">${T.hint}</p><p class="status" id="midiStatus" role="status">${esc(midiStatus)}</p></section>` +
    (web ? `<section class="sec"><h2>${T.offline}</h2><p class="status" id="offline" role="status">${esc(offlineText())}</p>` +
      `<button type="button" class="tb" id="install"${canInstall() ? '' : ' hidden'}>${T.install}</button><p class="status">${esc(installHint())}</p></section>` : '') +
    (folder && !web ? `<section class="sec"><h2>${T.songFolder}</h2><div class="place"><button type="button" class="where" id="where" title="${esc(fill(T.openFolder, {folder}))}"><bdi>${esc(folder)}</bdi></button><button type="button" class="tb" id="folderBtn">${T.changeFolder}</button></div></section>` : '') +
    (web ? '' : `<section class="sec"><h2>${T.transcribing}</h2><div class="row"><span class="lab" id="l-card">${T.card}</span>` +
      `<button type="button" class="sw" role="switch" aria-checked="${!!card && !!S.card}" aria-labelledby="l-card" data-sw="card"${card ? '' : ' disabled'}></button></div>` +
      `<p class="status" id="cardName">${esc(cardSays)}</p><p class="status" id="cardNow" role="status">${esc(cardNow || '')}</p></section>`);
}
