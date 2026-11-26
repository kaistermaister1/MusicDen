"""Finds the beat of a recording and places each note within its bar."""
from fractions import Fraction

import numpy as np

_tracker = None


def find_beats(wav_path, device):
    """Beat and downbeat times in seconds, with missed beats filled in and stray ones removed.
    Empty arrays when the beat cannot be found."""
    global _tracker
    try:
        if _tracker is None:
            from beat_this.inference import File2Beats
            _tracker = File2Beats(checkpoint_path='final0', device=device, dbn=False)
        beats, downbeats = _tracker(str(wav_path))
        return repair_beats(beats), np.asarray(downbeats, dtype=float)
    except Exception as e:  # a tab without bar lines is still worth having
        print(f'beat tracking failed: {e}')
        return np.array([]), np.array([])


SHORT, LONG = 0.6, 1.6   # a gap under SHORT beats holds a stray beat; one of LONG beats or more has beats missing


def _usual_gap(gaps, i, reach=6):
    """The beat length around gap i: the middle value of the gaps near it."""
    return float(np.median(gaps[max(0, i - reach):i + reach + 1]))


def repair_beats(beats):
    """Evens out a run of beat times. Where two beats stand much closer than the beats around
    them, the one that fits its neighbours worse is dropped. Where a gap is about two, three or
    more beats long, the missing beats are put in at even spacing. A beat merely played late or
    early, and a change of pace, are left as they are."""
    t = [float(x) for x in np.asarray(beats, dtype=float)]
    while len(t) >= 4:
        gaps = np.diff(t)
        short = next((i for i, g in enumerate(gaps) if g < SHORT * _usual_gap(gaps, i)), None)
        if short is None:
            break
        usual = _usual_gap(gaps, short)

        def unevenness(j):
            """How far from a beat the gap left by removing beat j would be."""
            if j == 0:
                return abs(t[2] - t[1] - usual)
            if j == len(t) - 1:
                return abs(t[-2] - t[-3] - usual)
            return abs(t[j + 1] - t[j - 1] - usual)

        del t[short if unevenness(short) < unevenness(short + 1) else short + 1]
    if len(t) < 4:
        return np.asarray(t, dtype=float)
    gaps = np.diff(t)
    out = [t[0]]
    for i, g in enumerate(gaps):
        usual = _usual_gap(gaps, i)
        count = int(round(g / usual)) if usual > 0 else 1
        if g >= LONG * usual and 2 <= count <= 32:
            out.extend(t[i] + g * k / count for k in range(1, count))
        out.append(t[i + 1])
    return np.asarray(out, dtype=float)


def steady_downbeats(heard):
    """Evens out the heard downbeats (one flag per beat) into bars of the piece's usual length.
    A bar of another length is allowed where the evidence for it is strong, such as a held note
    or an added beat; a single stray downbeat is not enough to move the bar lines."""
    marks = [i for i, d in enumerate(heard) if d]
    if len(marks) < 3:
        return list(heard)
    gaps = [b - a for a, b in zip(marks, marks[1:]) if 2 <= b - a <= 7]
    if not gaps:
        return list(heard)
    m = max(set(gaps), key=gaps.count)
    jump, miss = 2.5, 1.0
    cost = np.array([(miss if (p == 0) != bool(heard[0]) else 0.0) for p in range(m)])
    back = []
    for i in range(1, len(heard)):
        stay = np.roll(cost, 1)                       # the place in the bar simply advances
        best_any = int(np.argmin(cost))
        step = np.where(stay <= cost[best_any] + jump, stay, cost[best_any] + jump)
        came = np.where(stay <= cost[best_any] + jump, (np.arange(m) - 1) % m, best_any)
        emit = np.array([(miss if (p == 0) != bool(heard[i]) else 0.0) for p in range(m)])
        cost = step + emit
        back.append(came)
    p = int(np.argmin(cost))
    places = [p]
    for came in reversed(back):
        p = int(came[p])
        places.append(p)
    places.reverse()
    return [p == 0 for p in places]


def label_beats(beats, downbeats):
    """Numbers every beat by bar and place in the bar. Beats before the first downbeat form a
    pickup bar numbered 0."""
    out, bar, beat = [], 0, 0
    heard = [bool(len(downbeats)) and float(np.min(np.abs(downbeats - t))) < 0.035 for t in beats]
    for t, down in zip(beats, steady_downbeats(heard)):
        if down:
            bar, beat = bar + 1, 1
        else:
            beat += 1
        out.append({'time_s': round(float(t), 4), 'bar': bar, 'beat': max(beat, 1), 'downbeat': down})
    if out and not len(downbeats):
        for b in out:
            b['bar'] = 1
    return out


def tempo_map(beats):
    """Tempo at the start, then again wherever it has drifted more than 4% from the last entry."""
    if len(beats) < 3:
        return []
    gaps = np.diff(beats)
    out, last = [], None
    for i in range(len(gaps)):
        local = float(np.median(gaps[max(0, i - 2):i + 3]))
        bpm = 60.0 / local if local > 0 else 0
        if last is None or abs(bpm - last) / last > 0.04:
            out.append({'time_s': round(float(beats[i]), 4), 'bpm': round(bpm, 1)})
            last = bpm
    return out


GRIDS = [(2, 0.0), (4, 0.004), (3, 0.006), (6, 0.012), (8, 0.014)]   # divisions of a beat, and what each costs


def place_in_bars(notes, labelled):
    """Sets 'bar' and 'beat_pos' (beats from the start of the bar, as a fraction string) on each note,
    snapping onsets inside each beat to the simplest grid that fits them."""
    if len(labelled) < 2:
        for n in notes:
            n['bar'], n['beat_pos'] = None, None
        return
    times = np.array([b['time_s'] for b in labelled])
    by_beat = {}
    for n in notes:
        i = int(np.clip(np.searchsorted(times, n['onset'], side='right') - 1, 0, len(times) - 2))
        frac = (n['onset'] - times[i]) / (times[i + 1] - times[i])
        by_beat.setdefault(i, []).append((n, frac))
    for i, items in by_beat.items():
        fracs = np.array([f for _, f in items])
        inside = np.clip(fracs, 0, 1)
        best = min(GRIDS, key=lambda g: float(np.mean((inside - np.round(inside * g[0]) / g[0]) ** 2)) + g[1])[0]
        for n, f in items:
            if f < 0 or f > 1:      # before the first beat or after the last: keep the measured place
                pos = Fraction(f).limit_denominator(8)
            else:
                pos = Fraction(int(round(f * best)), best)
            b = labelled[i]
            n['bar'] = b['bar']
            n['beat_pos'] = str(Fraction(b['beat'] - 1) + pos)
