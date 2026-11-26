/* The settings column: flat sections of label-and-control rows. The two long ones, how the tracks
   are colored and how the notes look, are closed until their headings are pressed. */
import {S, PALETTES, PITCH} from './settings.js';
import {T, fill} from './strings.js';
import {canInstall, installHint} from './offline.js';

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
  zoom: '<svg viewBox="0 0 16 16" aria-hidden="true"><path class="ln" d="M1.5 8h13M4.5 5L1.5 8l3 3M11.5 5l3 3-3 3M8 4.5v7"/></svg>',
  caret: '<svg viewBox="0 0 8 8" aria-hidden="true"><path d="M2 1l4 3-4 3z"/></svg>'
};

/* `state`: the piece, whether it is the built-in one, the MIDI keyboard status line, whether a video
   is being saved, the folder on this computer where the songs are kept, and what transcription can
   run on here ({tools, card}, null until that is known). */
export function inspectorHtml({piece, builtIn, midiStatus, busy, folder, transcriber}) {
  const web = document.documentElement.classList.contains('web');
  /* the GPU can be chosen only where the transcriber can use one; the line under the switch names it, or says there is none */
  const card = transcriber && transcriber.tools ? transcriber.card : '';
  const slider = (k, label, min, max, step) =>
    `<div class="row"><label for="r-${k}">${label}</label><input id="r-${k}" type="range" data-k="${k}" min="${min}" max="${max}" step="${step}" value="${S[k]}" style="--p:${(S[k] - min) / (max - min) * 100}%"><output id="o-${k}" for="r-${k}">${shown(k, S[k])}</output></div>`;
  const choice = (k, label, opts) =>
    `<div class="row"><span class="lab" id="l-${k}">${label}</span><div class="seg" role="radiogroup" aria-labelledby="l-${k}">${opts.map(([v, text]) => `<button type="button" role="radio" aria-checked="${S[k] === v}" data-seg="${k}" data-v="${v}">${text}</button>`).join('')}</div></div>`;
  const toggle = k => `<button type="button" class="sw" role="switch" aria-checked="${!!S[k]}" aria-labelledby="l-${k}" data-sw="${k}"></button>`;
  const onOff = (k, label) => `<div class="row"><span class="lab" id="l-${k}">${label}</span>${toggle(k)}</div>`;
  /* a switch whose label is a whole phrase: the label takes the row's width, and `tip` says more on hovering */
  const phrase = (k, label, tip, sw) => `<div class="row wide"${tip ? ` title="${esc(tip)}"` : ''}><span class="lab" id="l-${k}">${label}</span>${sw || toggle(k)}</div>`;
  /* a section whose heading opens and closes it; `k` is the setting that remembers which, and its rows are made only while it is open */
  const group = (k, title, rows) => `<section class="sec grp"><h2><button type="button" class="grp-h" aria-expanded="${!!S[k]}" data-grp="${k}"><span class="tw">${ICON.caret}</span>${title}</button></h2>${S[k] ? rows() : ''}</section>`;

  const trackRows = () => piece.tracks.map((tr, i) => {
    const name = esc(tr.name);
    const swatch = S.colorBy === 'track' ? `<input type="color" id="tc-${i}" data-c="track:${i}" value="${tr.color}" aria-label="${fill(T.trackColor, {name})}">` : '';
    return `<div class="trk">${swatch}<span class="name">${name}</span><span class="cnt" id="cnt-${i}">${tr.count}</span><button type="button" class="ib" data-mute="${i}" aria-pressed="${tr.muted}" aria-label="${fill(T.mute, {name})}">${tr.muted ? ICON.muted : ICON.sound}</button></div>`;
  }).join('');
  const colorRows = () => {
    if (S.colorBy === 'track') return `<div class="row"><span class="lab">${T.palette}</span><div class="pals">${PALETTES.map((p, i) => `<button type="button" class="pal" data-pal="${i}" aria-pressed="${S.palette === i}" aria-label="${T.palette} ${i + 1}"><i style="background:${p[0]}"></i><i style="background:${p[1]}"></i></button>`).join('')}</div></div>`;
    if (S.colorBy === 'pitch') return `<div class="pcs">${S.pitch.map((c, i) => `<label><input type="color" id="pc-${i}" data-c="pitch:${i}" value="${c}">${PITCH[i]}</label>`).join('')}</div>`;
    return `<div class="row"><label for="c-single">${T.noteColor}</label><input class="end" type="color" id="c-single" data-c="single" value="${S.single}"></div>`;
  };
  const tracksAndColor = () => `<h3>${T.tracks}</h3>${trackRows()}` +
    `<h3>${T.color}</h3>${choice('colorBy', T.colorBy, [['track', T.byTrack], ['pitch', T.byPitch], ['one', T.byOne]])}${colorRows()}` +
    `<div class="row"><label for="c-bg">${T.background}</label><input class="end" type="color" id="c-bg" data-c="bg" value="${S.bg}"></div>`;
  const notesAndLight = () => `<h3>${T.notes}</h3>${choice('view', T.view, [['flat', T.flat], ['solid', T.solid]])}` +
    (S.view === 'solid' ? slider('tilt', T.tilt, 0, 1, 0.01) : '') +
    choice('shape', T.shape, [['bar', T.bar], ['pill', T.pill], ['outline', T.outline]]) + choice('finish', T.finish, [['matte', T.matte], ['gloss', T.gloss]]) + choice('motion', T.motion, [['fall', T.fall], ['rise', T.rise]]) +
    slider('window', T.onScreen, 1.5, 8, 0.1) + slider('width', T.width, 0.5, 1, 0.01) +
    (web ? slider('fineSpan', T.fineScrub, 1, 30, 1) : '') +
    onOff('octaveLines', T.guideLines) + onOff('noteNames', T.noteNames) +
    (S.noteNames ? choice('nameColor', T.nameColor, [['black', T.nameBlack], ['white', T.nameWhite]]) + slider('nameSize', T.nameSize, 0, 1, 0.01) : '') +
    `<h3>${T.light}</h3>` + slider('glow', T.glow, 0, 1, 0.01) + slider('spill', T.spill, 0, 1, 0.01) +
    onOff('edgeLight', T.edgeLight) + onOff('haze', T.haze) + onOff('keyLight', T.litKeys) +
    `<h3><span id="l-sparks">${T.sparks}</span>${toggle('sparks')}</h3>` +
    (S.sparks ? slider('amount', T.amount, 0, 1, 0.01) + slider('lift', T.lift, 0, 1, 0.01) + slider('drift', T.drift, 0, 1, 0.01) + slider('smoke', T.smoke, 0, 1, 0.01) : '');
  /* what a click on a note does, said in full on hovering over the switch's row */
  const editTip = `${piece.tracks.length > 2 ? T.editTipMany : T.editTip} ${builtIn ? T.editsDemo : T.editsKept}`;
  const install = canInstall() || installHint();

  return group('showLook', T.tracksColor, tracksAndColor) + group('showNotes', T.notesLight, notesAndLight) +
    `<section class="sec"><h2>${T.keyboard}</h2>${choice('range', T.range, [['full', T.full], ['fit', T.fit]])}` +
      onOff('octaveLabels', T.octaveLabels) + `</section>` +
    `<section class="sec"><h2>${T.edit}</h2>${phrase('editHands', T.editHands, editTip)}</section>` +
    `<section class="sec"><h2>${T.sheet}</h2><button type="button" class="tb" id="sheetPdf"${busy ? ' disabled' : ''}>${T.savePdf}</button></section>` +
    `<section class="sec"><h2>${T.video}</h2>${choice('videoSize', T.videoSize, [['hd', T.hd], ['uhd', T.uhd]])}${choice('videoRate', T.videoRate, [['30', T.fps30], ['60', T.fps60]])}${choice('videoShape', T.videoShape, [['wide', T.wide], ['tall', T.tall]])}` +
      `<button type="button" class="tb" id="video"${busy ? ' disabled' : ''}>${T.saveVideo}</button></section>` +
    (folder && !web ? `<section class="sec"><h2>${T.songFolder}</h2><p class="hint">${T.songFolderHint}</p><div class="place"><button type="button" class="where" id="where" title="${esc(fill(T.openFolder, {folder}))}"><bdi>${esc(folder)}</bdi></button><button type="button" class="tb" id="folderBtn">${T.changeFolder}</button></div></section>` : '') +
    (web ? '' : `<section class="sec"><h2>${T.transcription}</h2>` +
      phrase('card', T.useGpu, '', `<button type="button" class="sw" role="switch" aria-checked="${!!card && !!S.card}" aria-labelledby="l-card" data-sw="card"${card ? '' : ' disabled'}></button>`) +
      `<p class="status" id="gpuName">${esc(!transcriber ? '' : card || T.gpuNone)}</p></section>`) +
    /* in a browser that can put the app among the device's own: the button that does it, or where an iPhone keeps that */
    (web ? `<section class="sec" id="installRow"${install ? '' : ' hidden'}><button type="button" class="tb" id="install"${canInstall() ? '' : ' hidden'}>${T.install}</button><p class="status">${esc(installHint())}</p></section>` : '') +
    `<p class="status foot" id="midiStatus" role="status">${esc(midiStatus)}</p>`;
}
