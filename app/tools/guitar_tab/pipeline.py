"""Recording in, saved tab out: fetch, listen for notes, place them on strings, find the beat, save."""
import hashlib
import os
from pathlib import Path

from . import config, decode, ingest, library, notes as note_stage, rhythm
from .errors import TabError
from .fretboard import guess_tuning, highest_pitch, lowest_pitch


def device():
    import torch
    return 'cuda' if torch.cuda.is_available() else 'cpu'


def transcribe(source, is_url, title=None, on_stage=lambda stage: None, tuning=None, capo=0, report=None):
    """Runs every stage on a link or a local file and saves the tab. Returns the saved tab's id.
    `report`, when given, is filled with counts for the caller to show."""
    if is_url:
        key = source
    else:
        path = Path(source)
        if not path.is_file():
            raise TabError('failed', f'no such file: {source}')
        key = f'{path.resolve()}:{os.path.getmtime(path)}'
    work = library.WORK / hashlib.sha1(key.encode('utf-8')).hexdigest()[:12]
    work.mkdir(parents=True, exist_ok=True)

    on_stage('download')
    if is_url:
        found = [p for p in work.glob('source.*')]
        title_file = work / 'title.txt'
        if found and title_file.is_file():
            src, fetched_title = found[0], title_file.read_text(encoding='utf-8')
        else:
            src, fetched_title = ingest.fetch(source, work)
            title_file.write_text(fetched_title, encoding='utf-8')
        title = title or fetched_title
    else:
        src, title = path, title or path.stem
    wav16 = work / 'audio16k.wav'
    wav44 = work / 'audio44k.wav'
    if not wav16.is_file():
        ingest.to_wav(src, wav16, config.SAMPLE_RATE)
    if not wav44.is_file():
        ingest.to_wav(src, wav44, 44100)

    on_stage('listen')
    dev = device()
    heard, duration, rolls = note_stage.listen(wav16, work / 'notes.npz', dev)
    heard = note_stage.clean(heard)
    if len(heard) < config.MIN_NOTES:
        raise TabError('no_guitar', f'only {len(heard)} notes heard')

    on_stage('arrange')
    tuning_name = tuning or guess_tuning([n['pitch'] for n in heard])
    open_strings = config.TUNINGS[tuning_name]
    evidence = None
    if config.STRING_EVIDENCE:
        from .emissions import noise2fret
        if noise2fret.applies(open_strings, capo):
            # the string model was trained on sound as recorded, so it gets a copy without loudness evening
            plain = work / 'audio_plain.wav'
            try:
                if not plain.is_file():
                    ingest.to_wav(src, plain, noise2fret.SAMPLE_RATE, level=False)
                evidence = noise2fret.for_recording(plain, dev, open_strings, capo)
            except TabError as e:
                print(f'string evidence unavailable: {e}')
    placed, unplaced, out_of_range = arrange(heard, open_strings, capo, rolls=rolls, evidence=evidence)

    on_stage('rhythm')
    beats, downbeats = rhythm.find_beats(wav44, dev)
    labelled = rhythm.label_beats(beats, downbeats)
    rhythm.place_in_bars(placed, labelled)

    on_stage('save')
    song = build_song(placed, title, src.name, duration, open_strings, capo, labelled, rhythm.tempo_map(beats))
    if report is not None:
        report.update(notes=len(placed), out_of_range=out_of_range, unplaced=len(unplaced),
                      tuning=tuning_name, bars=max((b['bar'] for b in labelled), default=0),
                      **decode.playability(placed, capo))
    return library.save(song, key)


def arrange(heard, open_strings, capo=0, rolls=None, wav_path=None, weights=None, evidence=None, weight_sets=None):
    """Gives every note a string and fret. Returns (placed notes, notes left out of a chord that
    had one too many, count of notes outside the instrument's range). `rolls` (the note model's
    frame-by-frame output) and `evidence` (what the sound says about which string was played) are
    used when given; `wav_path` is the recording such evidence can be worked out from."""
    lo, hi = lowest_pitch(open_strings, capo), highest_pitch(open_strings)
    playable = [n for n in heard if lo <= n['pitch'] <= hi]
    if evidence is not None:
        from .emissions import noise2fret
        noise2fret.attach(playable, evidence, open_strings, capo)
    judged = [n for n in playable if n.get('string_logp') is not None]
    if weight_sets is None:
        base = dict(config.WEIGHTS, **(weights or {}))
        # with evidence from the sound, the up-the-neck and near-the-nut settings are both tried
        weight_sets = [base, dict(base, **config.OPEN_POSITION)] if judged and base['evidence'] and base.get('both', 1) else [base]
    best = None
    for w in weight_sets:
        trial = [dict(n) for n in playable]
        unplaced = decode.decode(trial, open_strings, capo, weights=w, rolls=rolls)
        placed = [n for n in trial if n.get('string')]
        # how well this arrangement agrees with the sound: mean log-likelihood of the strings it chose
        agree = [n['string_logp'][n['string'] - 1] for n in placed if n.get('string_logp') is not None]
        score = sum(agree) / len(agree) if agree and len(weight_sets) > 1 else 0.0
        if best is None or score > best[0]:
            best = (score, placed, unplaced)
    _, placed, unplaced = best
    return placed, unplaced, len(heard) - len(playable)


def build_song(placed, title, file_name, duration, open_strings, capo, labelled, tempo):
    """The saved tab: the note list with strings and frets, the beats, and the tuning."""
    placed.sort(key=lambda n: (n['onset'], n['string']))
    # the notes of one chord share a start, so they line up on the page
    for group in decode.group_onsets(placed):
        start = min(n['onset'] for n in group)
        for n in group:
            n['start'] = start
    # a string can sound one note at a time: each note ends when the next one on its string starts
    last_on_string = {}
    for n in placed:
        before = last_on_string.get(n['string'])
        if before is not None and before['offset'] > n['start']:
            before['offset'] = n['start']
        last_on_string[n['string']] = n
    out = []
    for i, n in enumerate(placed):
        out.append({'id': i, 'start_s': round(n['start'], 4), 'end_s': round(max(n['offset'], n['start'] + 0.03), 4),
                    'pitch': int(n['pitch']), 'string': int(n['string']), 'fret': int(n['fret']),
                    'velocity': int(n['velocity']), 'confidence': round(float(n.get('conf', 1.0)), 3),
                    'techniques': [], 'bar': n.get('bar'), 'beat_pos': n.get('beat_pos')})
    return {'version': 1, 'title': title, 'source': {'file': file_name, 'duration_s': round(float(duration), 2)},
            'tuning': list(open_strings), 'capo': capo, 'tempo_map': tempo, 'beats': labelled, 'notes': out}
