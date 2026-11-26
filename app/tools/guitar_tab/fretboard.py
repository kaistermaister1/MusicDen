"""Where on the neck a pitch can be played."""
from . import config


def candidates(pitch, tuning, capo=0, max_fret=config.MAX_FRET):
    """Every (string, fret) that sounds `pitch`. Strings count 1 = high E ... 6 = low E; frets are
    counted from the nut, so with a capo the lowest playable fret is the capo's."""
    out = []
    for i, open_pitch in enumerate(tuning):
        fret = pitch - open_pitch
        if capo <= fret <= max_fret:
            out.append((i + 1, fret))
    return out


def lowest_pitch(tuning, capo=0):
    return min(tuning) + capo


def highest_pitch(tuning, max_fret=config.MAX_FRET):
    return max(tuning) + max_fret


def guess_tuning(pitches):
    """Standard tuning unless enough notes fall below its lowest string, which points to a lowered
    sixth string (drop D) or the whole guitar tuned down a half step."""
    low = sorted(p for p in pitches if p < 40)
    if len(low) < max(3, len(pitches) // 200):
        return 'standard'
    return 'half_down' if sum(1 for p in low if p == 39) > sum(1 for p in low if p == 38) else 'drop_d'
