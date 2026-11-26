/* Every string a person can see or hear from a screen reader. */
export const T = {
  appName: 'MusicDen',

  play: 'Play', pause: 'Pause', restart: 'Back to start', position: 'Position',
  speed: 'Speed', percent: '{n}%', volume: 'Volume', songs: 'Songs', capo: 'Capo {n}',

  remove: 'Remove {name}', removeConfirm: 'Remove',
  empty: 'Paste a YouTube link to a solo guitar recording, then choose Transcribe. The tab opens here.',
  emptyPhone: 'Sign in to see the tabs from your computer.',
  emptyAccount: 'No tabs in your account yet. Transcribe one on your computer, then sync.',
  errLoad: "That tab couldn't be opened. Check the connection, then try again.",
  errRemove: "That song couldn't be removed. Try again.",

  linkPlaceholder: 'YouTube link', linkGo: 'Transcribe', fileGo: 'Use a file on this computer',
  fileDialog: 'Choose a recording', filePick: 'Transcribe', fileKind: 'Recordings',
  stage: {
    download: 'Getting the recording',
    listen: 'Writing out the notes',
    arrange: 'Placing the notes on strings',
    rhythm: 'Finding the beat',
    save: 'Saving the tab'
  },
  errLinkBad: 'Paste a link that starts with https://.',
  errDownload: "That recording couldn't be downloaded. Check the link, then try again.",
  errNoGuitar: 'No guitar notes were found in that recording.',
  errFailed: "The recording couldn't be transcribed. Try again.",
  errTools: 'Transcribing guitar needs FFmpeg and a few Python packages, and they were not found on this computer. Install the packages with "pip install torch torchaudio beat-this librosa soundfile yt-dlp[default] git+https://github.com/xavriley/hf_midi_transcription.git", then try again.',

  accountHint: 'Tabs on all your devices', signIn: 'Sign in', createAccount: 'Create account', signOut: 'Sign out', cancel: 'Cancel',
  email: 'Email', password: 'Password', sync: 'Sync', syncing: 'Syncing',
  synced: 'Tabs are in sync.', syncedCounts: '{up} sent, {down} received.',
  signedOut: 'You were signed out. Sign in again to sync.',
  confirmEmail: 'Check your email for a link to confirm the account, then sign in.',
  errAccountFields: 'Enter your email and a password of at least 6 characters.',
  errSignIn: "That email and password didn't work.",
  errCreate: "The account couldn't be created. If you already have one, sign in instead.",
  errOffline: "The account couldn't be reached. Check the connection, then try again.",
  errSync: "Syncing didn't finish. Check the connection, then sync again.",

  settings: 'Settings', setInstrument: 'Instrument', instruments: {piano: 'Piano', guitar: 'Guitar'}, setLook: 'Look', setTheme: 'Theme', themes: {dark: 'Dark', black: 'Black', light: 'Light', paper: 'Paper'},
  setAccent: 'Highlight color', setTab: 'Tab', setSize: 'Number size', setSpacing: 'Note spacing',
  setLowOnTop: 'Low E string on top', setBarNumbers: 'Bar numbers', setStringNames: 'String names',
  setSound: 'Sound', setRing: 'Let notes ring', setClick: 'Click on each beat', setReset: 'Reset settings',

  edit: 'Edit', undo: 'Undo', removeNote: 'Remove note',
  editHint: 'Drag a number up or down to move it to another string. Its fret changes so the note stays the same.',
  editNoRoom: "That note can't be played on that string.",
  errSave: "That change couldn't be saved. Try again.",

  learn: {
    head: 'Learning mode', name: 'Wait until I play each note',
    note: "The tab stops at each note until it hears you play it. It listens through the microphone, and the app's own guitar stays silent.",
    allow: 'Allow the microphone to start',
    blocked: "The microphone is blocked for this page. Allow it in the browser's site settings, then try again.",
    none: 'No microphone was found. Connect one, then try again.',
    cannot: "This browser can't use the microphone on this page.",
    lost: 'The microphone stopped. Press Play to carry on.'
  },

  soundLoading: 'Loading the guitar sound'
};

export const fill = (s, o) => s.replace(/\{(\w+)\}/g, (_, k) => o[k]);
