/* Every string a person can see or hear from a screen reader. */
export const T = {
  appName: 'MusicDen',
  demoTitle: 'Prelude in C major', demoBy: 'J. S. Bach, BWV 846',

  play: 'Play', pause: 'Pause', restart: 'Back to start', position: 'Position',
  speed: 'Speed', volume: 'Volume', fullScreen: 'Full screen', exitFullScreen: 'Leave full screen',
  songs: 'Songs', settings: 'Settings', fineScrub: 'Fine scrub',

  add: 'Add songs', drop: 'Drop MIDI files to add them',
  rename: 'New name', renameTip: 'Right-click to rename',
  errNameTaken: 'That name is already in use.', errRename: "The name couldn't be changed. Try again.",
  remove: 'Remove {name}', removeConfirm: 'Remove', removeTip: 'Moves the file to the Recycle Bin',
  removeTipAccount: 'Removes the song from your account, on every device',
  addHint: 'Add MIDI files, or drop them anywhere on the window.',
  changeFolder: 'Change', openFolder: 'Open {folder}', songFolder: 'Song folder',
  songFolderHint: 'Select where your music is stored.',
  newFolder: 'New folder', folderName: 'Folder name', folderRemoveTip: 'Removes the folder, not the songs in it',
  folderDialog: 'Folder for your songs', folderPick: 'Use this folder',
  addDialog: 'Add songs', addPick: 'Add', midiFiles: 'MIDI files',
  errLoad: "That song couldn't be opened. If its file was moved or deleted, add the song again.",
  errSave: "The change couldn't be saved to the song's file. Close the file in other apps, then make the change again.",
  errNotMidi: "That isn't a MIDI file. Choose a file ending in .mid or .midi.",
  errEmpty: 'This MIDI file has no notes. Try a different file.',
  errRemove: "That song couldn't be removed. Close the file in other apps, then try again.",

  linkPlaceholder: 'YouTube link', linkGo: 'Transcribe',
  linkGetting: 'Getting the recording', linkWriting: 'Writing out the notes',
  linkWaiting: 'Waiting', linkAgain: 'Try again', linkDone: '{name} is in your songs.',
  errLinkBad: 'Paste a link that starts with https://.',
  errLinkTools: 'Transcribing needs yt-dlp and Transkun, and they were not found on this computer. Install them with "pip install yt-dlp[default] transkun", then try again.',
  errLinkDownload: "That recording couldn't be downloaded. Check the link, then try again.",
  errLinkNotes: 'No piano notes were found in that recording.',
  errLink: "The recording couldn't be transcribed. Try again.",
  transcription: 'Transcription', useGpu: 'Use GPU for transcription', gpuNone: 'No GPU detected',
  gpuWorking: 'Transcribing on the GPU, using {memory} of its memory', gpuWorkingPlain: 'Transcribing on the GPU',
  gpuGaveUp: "The GPU couldn't finish this recording. The processor is transcribing it from the start.",

  videos: 'Videos', videosEmpty: 'Videos you save on your computer while signed in appear here.',
  videosSignIn: 'Sign in to see your videos.', closeVideo: 'Close',
  removeVideoTip: 'Removes the video from your account',
  videoSending: 'Video saved. Sending it to your account',
  videoInAccount: 'Video saved, and in your account.',
  errVideoSend: "Video saved. It couldn't be sent to your account.",
  errVideoTooLong: 'Video saved. It is too long to keep in your account.',
  errVideoOpen: "That video couldn't be opened. Check the connection, then try again.",

  install: 'Install app', installIos: 'To keep MusicDen with your apps, tap Share, then Add to Home Screen.',
  more: 'More', renameIt: 'Rename', moveTo: 'Move to {folder}', takeOut: 'Take out of {folder}',

  accountHint: 'Songs on all your devices', signIn: 'Sign in', createAccount: 'Create account', signOut: 'Sign out',
  email: 'Email', password: 'Password', sync: 'Sync', syncing: 'Syncing',
  synced: 'Up to date',
  signedOut: 'You were signed out. Sign in again to sync.',
  confirmEmail: 'Check your email for a link to confirm the account, then sign in.',
  errAccountFields: 'Enter your email and a password of at least 6 characters.',
  errSignIn: "That email and password didn't work.",
  errCreate: "The account couldn't be created. If you already have one, sign in instead.",
  errOffline: "The account couldn't be reached. Check the connection, then try again.",
  errSync: "Syncing didn't finish. Check the connection, then sync again.",

  welcome: 'Welcome to MusicDen', welcomeStep: 'Step {n} of 2',
  welcomeCreate: 'Create an account', welcomeCreateNote: 'Music is saved and can be viewed by signing in on other platforms.',
  welcomeLocal: 'Continue without an account', welcomeLocalNote: 'Music is stored locally.',
  welcomeHave: 'Already have an account?', welcomeNew: 'No account yet?',
  welcomeChoose: 'Choose your instrument', back: 'Back',
  instrument: 'Instrument', piano: 'Piano', guitar: 'Guitar',
  pianoNote: 'Falling notes and sheet music from MIDI files and recordings.',
  guitarNote: 'Create tabs from your favorite audio recording.',
  moreSoon: 'More coming soon',

  /* the short tour a person is taken on after the welcome page: for each stop, its name and a line about it */
  tourSkip: 'Skip', tourNext: 'Next', tourDone: 'Done', tourCount: '{n} of {of}',
  tour: {
    piano: {
      play: ['Play', 'Press Play, or the space bar, to hear the piece.'],
      keys: ['Keyboard', 'Click a key to play it, or use the letter keys A to L. A MIDI keyboard plugged into this computer plays here too.'],
      keysTouch: ['Keyboard', 'Tap a key to play it.'],
      songs: ['Songs', 'Add MIDI files, or drop them anywhere on the window. A YouTube link to a piano recording becomes a song when you press Transcribe.'],
      songsWeb: ['Songs', 'Add MIDI files here. Sign in to see the songs from your other devices.'],
      sheet: ['Sheet music', 'Shows the sheet music above the keys, moving with the piece.'],
      settings: ['Settings', 'Change the colors, the notes and the light. Instrument switches between piano and guitar.']
    },
    guitar: {
      play: ['Play', 'Press Play, or the space bar. The line moves through the tab in time with the guitar.'],
      tab: ['Tab', 'Each line is a string and each number is a fret. Drag the tab to move through the song.'],
      songs: ['Songs', 'Paste a YouTube link to a solo guitar recording and press Transcribe, or use a file on this computer.'],
      songsWeb: ['Songs', 'Sign in to see the tabs made on your computer.'],
      edit: ['Edit', 'Drag a number up or down to move its note to another string.'],
      settings: ['Settings', 'Learning mode waits until you play each note. Instrument switches between guitar and piano.']
    }
  },

  tracksColor: 'Tracks and color', notesLight: 'Notes, light and sparks',
  tracks: 'Tracks', trackN: 'Track {n}', rightHand: 'Right hand', leftHand: 'Left hand',
  mute: 'Mute {name}', trackColor: 'Color for {name}',
  color: 'Color', colorBy: 'Color by', byTrack: 'Track', byPitch: 'Pitch', byOne: 'Single',
  palette: 'Palette', noteColor: 'Note color', background: 'Background',

  notes: 'Notes', view: 'View', flat: 'Flat', solid: '3D', tilt: 'Tilt',
  shape: 'Shape', bar: 'Bar', pill: 'Rounded', outline: 'Outline',
  finish: 'Finish', matte: 'Matte', gloss: 'Gloss',
  motion: 'Motion', fall: 'Fall', rise: 'Rise',
  onScreen: 'Time shown', width: 'Width', guideLines: 'Guide lines', noteNames: 'Note names',
  nameColor: 'Name color', nameBlack: 'Black', nameWhite: 'White', nameSize: 'Name size',

  light: 'Light', glow: 'Glow', edgeLight: 'Edge light', haze: 'Haze', litKeys: 'Lit keys', spill: 'Spill on keys',
  sparks: 'Sparks', amount: 'Amount', lift: 'Height', drift: 'Drift', smoke: 'Smoke',

  keyboard: 'Keyboard', range: 'Range', full: '88 keys', fit: 'Fit piece', octaveLabels: 'C key labels',

  edit: 'Edit', editHands: 'Click on a note to switch hands',
  editTip: 'Drag across notes to switch several. Ctrl+Z undoes the last note.',
  editTipMany: 'This song has more than two tracks, so a click moves the note to the next track. Drag across notes to move several. Ctrl+Z undoes the last note.',
  editsKept: "Changes are saved to the song's file as you make them.",
  editsDemo: "This piece comes with the app, so changes to it aren't kept.",

  sheet: 'Sheet music', sheetPreparing: 'Preparing the sheet music',
  sheets: 'Sheets', sheetsEmpty: 'Sheet music you save as PDF from Settings appears here.',
  sheetsEmptyWeb: 'Sheet music you save in the Windows app while signed in appears here.',
  sheetsSignIn: 'Sign in to see your sheet music.',
  savePdf: 'Save as PDF', pdfSaving: 'Writing the sheet music', pdfSaved: 'Sheet music saved. It is under Sheets.',
  errPdf: "The sheet music couldn't be saved as a PDF. Try again.",
  errPdfOpen: "That sheet music couldn't be opened. Save it again from Settings.",
  errSheetOpen: "That sheet music couldn't be opened. Save it again in the Windows app, then sync.",
  closeSheet: 'Close', downloadPdf: 'Download PDF', removeSheetTip: 'Deletes the PDF from this computer',
  removeSheetTipAccount: 'Removes the sheet music from your account, on every device', pagesN: '{n} pages', pages1: '1 page',
  errNoMuseScore: 'Sheet music needs MuseScore Studio 4, and it was not found on this computer. Install it from musescore.org, then open Sheet music again.',
  errSheet: "The sheet music for this song couldn't be drawn. Close Sheet music, then open it again.",

  connected: '{name} connected',
  noDevice: 'No MIDI keyboard found. Plug one in to connect.',
  midiFail: "MIDI keyboards can't be reached on this computer.",

  video: 'Video', videoSize: 'Size', hd: '1080p', uhd: '4K',
  videoRate: 'Frame rate', fps30: '30', fps60: '60',
  videoShape: 'Shape', wide: 'Wide', tall: 'Tall',
  saveVideo: 'Save video…', videoDialog: 'Save video', videoKind: 'MP4 video',
  videoSound: 'Preparing the sound', videoSaving: 'Saving video', videoLeft: '{time} left',
  cancel: 'Cancel', videoSaved: 'Video saved.', showFile: 'Show in folder', dismiss: 'Close',
  errNoEncoder: 'Saving video needs FFmpeg, and it was not found on this computer. Install FFmpeg, then try again.',
  errVideo: "The video couldn't be saved. Try again, or choose a smaller size."
};

export const fill = (s, o) => s.replace(/\{(\w+)\}/g, (_, k) => o[k]);
