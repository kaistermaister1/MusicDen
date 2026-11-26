"""Hears the notes in a recording: onset, offset, pitch and loudness of each. The model's
frame-by-frame output is kept on disk, so notes can be picked out of it again with other
thresholds, and later stages rerun, without listening a second time."""
import numpy as np

from . import config

_models = {}
FRAMES_PER_SECOND = 100
LOWEST_PITCH = 21
ROLLS = ('reg_onset_output', 'reg_offset_output', 'frame_output', 'velocity_output')


def _transcriber(device, checkpoint):
    key = (device, checkpoint)
    if key not in _models:
        from pathlib import Path
        from huggingface_hub import hf_hub_download
        from hf_midi_transcription import MidiTranscriptionModel
        # a file on this computer is used as it is; a name is fetched once, then read from the saved copy
        weights = checkpoint if Path(checkpoint).is_file() else hf_hub_download(
            repo_id='xavriley/midi-transcription-models', filename=checkpoint)
        _models.clear()   # one set of weights on the graphics card at a time
        _models[key] = MidiTranscriptionModel(device=device, instrument='guitar', checkpoint_path=weights)
    return _models[key].transcriptor


def hear(wav_path, cache_path, device, checkpoint=None):
    """Returns (rolls, seconds of audio). `rolls` holds the model's four outputs, each an array of
    frames x 88 pitches at 100 frames a second. Read from `cache_path` when it is there."""
    if cache_path.is_file():
        saved = np.load(cache_path)
        if all(name in saved for name in ROLLS):
            return {name: saved[name].astype(np.float32) for name in ROLLS}, float(saved['duration'])
    import soundfile as sf
    audio, rate = sf.read(str(wav_path), dtype='float32', always_2d=False)
    if audio.ndim > 1:
        audio = audio.mean(axis=1)
    assert rate == config.SAMPLE_RATE, f'expected {config.SAMPLE_RATE} Hz audio, got {rate}'
    duration = len(audio) / rate
    result = _transcriber(device, checkpoint or config.CHECKPOINT).transcribe(audio, None)
    rolls = {name: np.asarray(result['output_dict'][name], dtype=np.float16) for name in ROLLS}
    cache_path.parent.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(cache_path, duration=duration, **rolls)
    return {name: r.astype(np.float32) for name, r in rolls.items()}, duration


def _peaks(reg, threshold, neighbour):
    """Frames where a regression output peaks above `threshold` (rising for `neighbour` frames
    before and falling for as many after), and how far between frames each true peak lies."""
    frames = len(reg)
    peak = reg > threshold
    peak[:neighbour] = False
    peak[frames - neighbour:] = False
    inner = slice(neighbour, frames - neighbour)
    for i in range(neighbour):
        peak[inner] &= reg[neighbour - i:frames - neighbour - i] >= reg[neighbour - i - 1:frames - neighbour - i - 1]
        peak[inner] &= reg[neighbour + i:frames - neighbour + i] >= reg[neighbour + i + 1:frames - neighbour + i + 1]
    shift = np.zeros(reg.shape, dtype=np.float32)
    n, k = np.nonzero(peak)
    here, before, after = reg[n, k], reg[n - 1, k], reg[n + 1, k]
    drop = np.where(before > after, here - after, here - before)
    shift[n, k] = np.where(drop != 0, (after - before) / np.where(drop != 0, drop, 1) / 2, 0)
    return peak, shift


def _notes_of_pitch(frame, onset, onset_shift, offset, offset_shift, velocity, frame_threshold):
    """The notes of one pitch as [first frame, last frame, onset shift, offset shift, velocity]:
    each starts at an onset peak and ends at an offset peak or where the pitch stops sounding,
    whichever the timing favours, or at the next onset, or after six seconds."""
    out, bgn, gone, off = [], None, None, None
    last = len(onset) - 1
    if not onset.any():
        return out
    for i in range(int(np.argmax(onset)), last + 1):   # nothing happens before the first onset
        if onset[i]:
            if bgn:
                out.append([bgn, max(i - 1, 0), onset_shift[bgn], 0, velocity[bgn]])
                gone, off = None, None
            bgn = i
        if bgn and i > bgn:
            if frame[i] <= frame_threshold and not gone:
                gone = i
            if offset[i] and not off:
                off = i
            if gone:
                fin = off if off and off - bgn > gone - off else gone
                out.append([bgn, fin, onset_shift[bgn], offset_shift[fin], velocity[bgn]])
                bgn, gone, off = None, None, None
            if bgn and (i - bgn >= 600 or i == last):
                out.append([bgn, i, onset_shift[bgn], offset_shift[i], velocity[bgn]])
                bgn, gone, off = None, None, None
    return out


def pick_notes(rolls, onset_threshold=None, offset_threshold=None, frame_threshold=None):
    """Turns the model's output into notes: dicts of onset, offset, pitch, velocity, and conf (how
    sure the model was of the onset, 0 to 1). The same rules as the model's own note picker,
    written here so that thresholds can be tried without loading the model."""
    onset_threshold = config.ONSET_THRESHOLD if onset_threshold is None else onset_threshold
    offset_threshold = config.OFFSET_THRESHOLD if offset_threshold is None else offset_threshold
    frame_threshold = config.FRAME_THRESHOLD if frame_threshold is None else frame_threshold
    onset_roll, frame_roll, velocity_roll = rolls['reg_onset_output'], rolls['frame_output'], rolls['velocity_output']
    onsets, onset_shift = _peaks(onset_roll, onset_threshold, 2)
    offsets, offset_shift = _peaks(rolls['reg_offset_output'], offset_threshold, 4)
    notes = []
    for k in np.nonzero(onsets.any(axis=0))[0]:
        for bgn, fin, on_shift, off_shift, vel in _notes_of_pitch(
                frame_roll[:, k], onsets[:, k], onset_shift[:, k], offsets[:, k], offset_shift[:, k],
                velocity_roll[:, k], frame_threshold):
            lo, hi = max(0, bgn - 2), min(len(onset_roll), bgn + 3)
            notes.append({'onset': float((bgn + on_shift) / FRAMES_PER_SECOND), 'offset': float((fin + off_shift) / FRAMES_PER_SECOND),
                          'pitch': int(k) + LOWEST_PITCH, 'velocity': int(vel * 128), 'conf': float(onset_roll[lo:hi, k].max())})
    notes.sort(key=lambda n: (n['onset'], n['pitch']))
    return notes


def blend(roll_sets):
    """The mean of several models' outputs for the same recording, cut to the shortest."""
    if len(roll_sets) == 1:
        return roll_sets[0]
    frames = min(len(r['frame_output']) for r in roll_sets)
    return {name: np.mean([r[name][:frames] for r in roll_sets], axis=0) for name in ROLLS}


def listen(wav_path, cache_path, device, checkpoint=None):
    """Returns (notes, seconds of audio, rolls) for a recording. `checkpoint` may name several
    sets of weights joined by '+'; their outputs are averaged before notes are picked. Each set's
    output is kept in its own file beside `cache_path`."""
    from pathlib import Path
    heard = []
    for name in (checkpoint or config.CHECKPOINT).split('+'):
        stem = Path(name).stem
        path = cache_path if stem == 'guitar-gaps' else cache_path.with_name(f'{cache_path.stem}-{stem}.npz')
        heard.append(hear(wav_path, path, device, name))
    rolls = blend([r for r, _ in heard])
    return pick_notes(rolls), heard[0][1], rolls


def clean(notes):
    """Merges a note re-triggered within a few hundredths of a second into the one before it, and
    drops faint, very short blips that are not real plucks."""
    last, out = {}, []
    for n in sorted(notes, key=lambda n: n['onset']):
        before = last.get(n['pitch'])
        if before is not None and n['onset'] - before['onset'] <= config.MERGE_WINDOW_S:
            before['offset'] = max(before['offset'], n['offset'])
            before['velocity'] = max(before['velocity'], n['velocity'])
            continue
        if n['offset'] - n['onset'] < 0.04 and n['velocity'] < 25:
            continue
        last[n['pitch']] = n
        out.append(n)
    return out
