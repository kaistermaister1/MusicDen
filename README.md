# MusicDen

<!-- A note from the creator. Replace the line below with a paragraph of your own. -->
> *A note from the creator goes here.*

MusicDen plays piano music as notes falling onto a keyboard, with the sheet music running along above them. It plays MIDI files, shows what you play on a MIDI keyboard, and turns a YouTube link into a song: paste the link, and the piano notes in the recording are written out with a left and a right hand.

![MusicDen playing a Chopin prelude: the song list, the sheet music, and notes falling onto the keyboard](docs/musicden.png)

## Get it

- **Windows:** download [MusicDen-win32-x64.zip](../../releases/latest/download/MusicDen-win32-x64.zip), unzip it, and open `MusicDen.exe`. If Windows says it does not know the publisher, choose More info, then Run anyway.
- **Web:** open [piano-visualizer.piano-visualizer.workers.dev](https://piano-visualizer.piano-visualizer.workers.dev) in any browser.
- **Phone or tablet:** open the same address, then choose Install app in its Settings (Android), or tap Share, then Add to Home Screen (iPhone, iPad). After that it opens without a connection.

Sign in at the bottom of the Songs panel to have the same songs, folders, sheet music and videos on every device. Turning links into songs, writing sheet music and saving video happen in the Windows app, with the programs listed below.

## How it works

| Used for | Program or model |
| --- | --- |
| Fetching the recording behind a link | [yt-dlp](https://github.com/yt-dlp/yt-dlp) |
| Writing out its piano notes as MIDI | [Transkun](https://github.com/Yujia-Yan/Transkun) V2, a transformer trained on solo piano recordings. It runs in PyTorch, on the GPU when PyTorch can use one. |
| Sorting the notes into two hands | `app/tools/hand_split.py`, a beam search over where each hand can reach |
| Drawing and playing the song | Electron, with WebGL2 for the falling notes and Web Audio for a sampled grand piano |
| Engraving the sheet music | [MuseScore Studio 4](https://musescore.org) |
| Saving a video | [FFmpeg](https://ffmpeg.org) |
| Accounts and sync | [Supabase](https://supabase.com) sign-in and file storage |
| The web and phone version | The same interface, served by Cloudflare Workers and kept on the device by a service worker |

A link goes down that table from the top: the recording is fetched, transcribed, split into hands and saved as a MIDI file, which the app then plays, engraves and can save as video. If you're signed in, the song also goes to your account, where the web and phone versions find it.

yt-dlp, Transkun, MuseScore and FFmpeg are not included; the Windows app uses the ones it finds on the computer. Links need Python with `pip install transkun "yt-dlp[default]"`, and FFmpeg. Sheet music needs MuseScore Studio 4, and video needs FFmpeg.

To run from source:

```bash
npm install
npm run samples
npm start
```

`npm run samples` fetches the piano recordings, `npm run transcriber` sets up Transkun and yt-dlp, `npm run pack` builds the Windows app, and `npm test` and `npm run checks` test it. Accounts use the Supabase project named in `app/ui/cloud-config.js`; `supabase/setup.sql` sets up another.

## Citations

- Yujia Yan, Frank Cwitkowitz and Zhiyao Duan. "Skipping the Frame-Level: Event-Based Piano Transcription With Neural Semi-CRFs." *Advances in Neural Information Processing Systems*, 2021.
- Yujia Yan and Zhiyao Duan. "Scoring Time Intervals Using Non-Hierarchical Transformer for Automatic Piano Transcription." *Proc. International Society for Music Information Retrieval Conference (ISMIR)*, 2024.
- Piano: Salamander Grand Piano V3 by Alexander Holm, [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/), in the edition prepared for Tone.js Piano.
- Typefaces: IBM Plex Sans Condensed and Source Serif 4, both under the SIL Open Font License (see `app/assets/fonts`).
- Test pieces in `test/fixtures` are from the Mutopia Project.

## License

[MIT](LICENSE)
