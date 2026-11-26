"""What the sound says about which string a note was played on.

A model that listens to a tenth of a second of guitar and names the fret sounding on each string
(Noise2Fret, Simionato & Bigo, ISMIR 2026) is run over the whole recording once. For each note,
its answers in the windows around the note's onset are read off for the strings that could play
that pitch, and become a likelihood per string.

The published weights used here were trained on acoustic guitar in standard tuning, so the
evidence is only offered for standard tuning without a capo."""
import zipfile
from pathlib import Path

import numpy as np

from .. import config, library
from ..fretboard import candidates

SAMPLE_RATE = 22050
HOP = 512                     # samples between the model's feature frames
N_FFT = 1024
WINDOW_FRAMES = 4             # the model hears four frames (93 ms) at a time
WINDOW = WINDOW_FRAMES * HOP
FLOOR = 0.02                  # no string is ever ruled out entirely by the sound
WEIGHTS_URL = 'https://zenodo.org/api/records/23361924/files/CheckpointsGuitarSet.zip/content'
WEIGHTS_MEMBER = 'CheckpointsGuitarSet/GuitarSet_N2F_Laux/my_checkpoints/best_checkpoint.pth'
STANDARD = config.TUNINGS['standard']

_model = {}


def model_string(tab_string):
    """The model counts strings 0 = low E ... 5 = high E; tabs count 1 = high E ... 6 = low E."""
    if not 1 <= tab_string <= 6:
        raise ValueError(f'string out of range: {tab_string}')
    return 6 - tab_string


def model_class(fret):
    """The model's classes in the published GuitarSet weights: class k = fret k (0 = open string),
    and the last class = string not played. Unused event slots are filled with class 0 on every
    string, so class 0 means "open" only in a slot that holds a real event. (The authors' code
    comments describe another layout; this one was read off the weights' output on the takes they
    were trained on, where it picks the true string for 92% of notes against 75% for the other.)"""
    return fret


def weights_path():
    """The weights on this computer, fetched (106 MB, once) when they are not there yet."""
    target = library.CACHE / 'models' / 'noise2fret' / 'GuitarSet_N2F_Laux.pth'
    if target.is_file():
        return target
    import shutil
    import urllib.request
    target.parent.mkdir(parents=True, exist_ok=True)
    archive = target.with_suffix('.zip')
    request = urllib.request.Request(WEIGHTS_URL, headers={'User-Agent': 'guitar-tabs/0.1'})
    # a stalled connection gives up after a minute rather than holding up the tab
    with urllib.request.urlopen(request, timeout=60) as response, archive.open('wb') as out:
        shutil.copyfileobj(response, out, length=1 << 20)
    with zipfile.ZipFile(archive) as z:
        target.write_bytes(z.read(WEIGHTS_MEMBER))
    archive.unlink()
    return target


def load(device, path=None):
    key = (device, str(path or 'default'))
    if key not in _model:
        import torch
        from .noise2fret_net import Noise2Fret
        checkpoint = torch.load(str(path or weights_path()), map_location='cpu', weights_only=False)
        _model.clear()
        _model[key] = Noise2Fret(checkpoint).to(device).eval()
    return _model[key]


def features(audio_path):
    """The recording as the model was trained to hear it: peak-levelled audio at 22.05 kHz, and per
    frame its spectrum, how much the spectrum grew since the last frame, and how bright it is."""
    import librosa
    import soundfile as sf
    audio, rate = sf.read(str(audio_path), dtype='float64', always_2d=False)
    if audio.ndim > 1:
        audio = audio.mean(axis=1)
    audio = librosa.resample(y=librosa.util.normalize(audio), orig_sr=rate, target_sr=SAMPLE_RATE)
    mag = np.abs(librosa.stft(y=audio, n_fft=N_FFT, hop_length=HOP))            # (bins, frames)
    flux = np.pad(np.maximum(np.diff(mag, axis=-1), 0.0).sum(axis=0), (1, 0))
    bright = librosa.fft_frequencies(sr=SAMPLE_RATE, n_fft=N_FFT) >= 1500.0
    power = mag ** 2
    brightness = power[bright].sum(axis=0) / np.maximum(power.sum(axis=0), 1e-8)
    cond = np.concatenate([mag.T, flux[:, None], brightness[:, None]], axis=1).astype(np.float32)
    return audio.astype(np.float32), cond


def evidence_roll(audio_path, device, path=None, draws=2, batch=1024):
    """Runs the model on every window of the recording (one starting at each frame). Returns an
    array (windows, 6 strings, classes): how likely each string plays each class in some event of
    the window, averaged over `draws` runs from different starting noise."""
    import torch
    model = load(device, path)
    audio, cond = features(audio_path)
    n = max(1, len(cond) - WINDOW_FRAMES + 1)
    audio = np.pad(audio, (0, max(0, (n - 1) * HOP + WINDOW - len(audio))))
    cond = np.pad(cond, ((0, max(0, n + WINDOW_FRAMES - 1 - len(cond))), (0, 0)))
    starts = np.arange(n)
    out = np.zeros((n, 6, model.n_classes), dtype=np.float32)
    generator = torch.Generator(device=device).manual_seed(0)
    for lo in range(0, n, batch):
        idx = starts[lo:lo + batch]
        a = torch.from_numpy(np.stack([audio[i * HOP:i * HOP + WINDOW] for i in idx])).unsqueeze(-1).to(device)
        c = torch.from_numpy(np.stack([cond[i:i + WINDOW_FRAMES] for i in idx])).to(device)
        total = 0
        for _ in range(draws):
            probs = torch.softmax(model.sample(a, c, generator=generator), dim=-1)   # (B, events, 6, classes)
            # a slot holds a real event when most strings are "not played"; the rest are filler
            real = probs[..., -1].mean(dim=2) > 0.4
            probs[..., 0] = probs[..., 0] * real.unsqueeze(-1)
            total = total + probs.max(dim=1).values
        out[lo:lo + batch] = (total / draws).cpu().numpy()
    return out


def attach(notes, roll, tuning=STANDARD, capo=0):
    """Sets 'string_logp' on each note: for strings 1..6, the log of how likely the sound makes that
    string, among the strings that can play the note's pitch (minus infinity for the others)."""
    if roll is None or not applies(tuning, capo):
        return
    n_windows, _, n_classes = roll.shape
    for n in notes:
        frame = int(round(n['onset'] * SAMPLE_RATE / HOP))
        windows = [w for w in range(frame - WINDOW_FRAMES + 1, frame + 1) if 0 <= w < n_windows]
        places = [(s, f) for s, f in candidates(n['pitch'], tuning, capo) if model_class(f) < n_classes - 1]
        if not windows or len(places) < 2:
            continue
        seen = roll[windows].mean(axis=0)
        score = np.array([seen[model_string(s), model_class(f)] for s, f in places], dtype=np.float64) + FLOOR
        logp = [float('-inf')] * 6
        for (s, _), p in zip(places, score / score.sum()):
            logp[s - 1] = float(np.log(p))
        n['string_logp'] = logp


def applies(tuning, capo=0):
    """Whether the evidence can be used: standard tuning and no capo, as the model was trained."""
    return list(tuning) == STANDARD and not capo


def for_recording(audio_path, device, tuning, capo=0):
    """The evidence for one recording, or None when it does not apply or cannot be had."""
    if not applies(tuning, capo):
        return None
    try:
        return evidence_roll(audio_path, device)
    except Exception as e:   # the tab is still made, from playability alone
        print(f'string evidence unavailable: {e}')
        return None
