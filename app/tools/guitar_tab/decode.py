"""Chooses a string and fret for every note: a search over chord shapes and hand positions that
keeps each chord playable and the hand moving as little as the music allows."""
import numpy as np

from . import config
from .fretboard import candidates

RING_MARGIN_S = 0.06     # a note counts as still sounding at a later onset only if it lasts this much past it
FRAMES_PER_SECOND = 100
LOWEST_ROLL_PITCH = 21


def group_onsets(notes, window=config.GROUP_WINDOW_S):
    """Notes (dicts with 'onset') sorted by onset, split into chords: runs whose onsets fall within
    `window` of the run's first note."""
    groups = []
    for n in notes:
        if groups and n['onset'] - groups[-1][0]['onset'] <= window:
            groups[-1].append(n)
        else:
            groups.append([n])
    return groups


def fingers_needed(voicing, capo):
    """Fretting fingers a chord shape takes. Several notes on the shape's lowest fret count as one
    finger laid across the strings, unless an open string sits between them."""
    fretted = [(s, f) for s, f in voicing if f > capo]
    if not fretted:
        return 0
    low = min(f for _, f in fretted)
    at_low = sorted(s for s, f in fretted if f == low)
    others = len(fretted) - len(at_low)
    if len(at_low) > 1:
        open_between = any(f == capo and at_low[0] < s < at_low[-1] for s, f in voicing)
        return others + (len(at_low) if open_between else 1)
    return others + 1


def voicings(pitches, tuning, capo):
    """Every playable way to finger these simultaneous pitches: one note per string, fretted span
    within reach, at most four fingers."""
    options = [candidates(p, tuning, capo) for p in pitches]
    if any(not o for o in options):
        return []
    order = sorted(range(len(pitches)), key=lambda i: len(options[i]))
    out, chosen = [], [None] * len(pitches)

    def place(k, used, lo, hi):
        if k == len(order):
            v = tuple(chosen)
            if fingers_needed(v, capo) <= 4:
                out.append(v)
            return
        i = order[k]
        for s, f in options[i]:
            if used & (1 << s):
                continue
            nlo, nhi = lo, hi
            if f > capo:
                nlo, nhi = min(lo, f), max(hi, f)
                if nhi - nlo > config.MAX_SPAN:
                    continue
            chosen[i] = (s, f)
            place(k + 1, used | (1 << s), nlo, nhi)

    place(0, 0, 99, -1)
    return out


def shape_cost(voicing, capo, w, chord=None):
    """What a chord shape costs on its own: frets, open strings, stretch, and, when the notes carry
    it, how unlikely the sound makes each chosen string ('string_logp', one value per string)."""
    fretted = [f for _, f in voicing if f > capo]
    cost = w['open'] * (len(voicing) - len(fretted)) + w['fret'] * sum(f - capo for f in fretted)
    if w['high']:
        cost += w['high'] * sum(max(0, f - capo - 12) for f in fretted)
    if fretted:
        cost += w['span_scale'] * w['span'][min(max(fretted) - min(fretted), len(w['span']) - 1)]
    if w['evidence'] and chord is not None:
        for (s, _), n in zip(voicing, chord):
            logp = n.get('string_logp')
            if logp is not None:
                cost -= w['evidence'] * logp[s - 1]
    return cost


def extend_ringing(notes, rolls, threshold):
    """Sets 'ring' on each note: when it stops sounding, read from the note model's frame-by-frame
    output rather than from the note's own end, which tends to come early. A note rings until its
    pitch drops below `threshold` in that output or is struck again."""
    frame = rolls['frame_output']
    next_onset = {}
    for n in sorted(notes, key=lambda n: -n['onset']):
        k = n['pitch'] - LOWEST_ROLL_PITCH
        end = int(n['offset'] * FRAMES_PER_SECOND)
        if 0 <= k < frame.shape[1]:
            stop = min(len(frame), int(next_onset.get(n['pitch'], 1e9) * FRAMES_PER_SECOND) - 2, end + 6 * FRAMES_PER_SECOND)
            below = np.nonzero(frame[end:stop, k] < threshold)[0] if stop > end else np.array([0])
            end = end + (int(below[0]) if len(below) else max(0, stop - end))
        n['ring'] = max(n['offset'], end / FRAMES_PER_SECOND)
        next_onset[n['pitch']] = n['onset']


def decode(notes, tuning, capo=0, weights=None, rolls=None):
    """Sets 'string' and 'fret' on each note in place. Returns the notes that could not be placed
    (out of the instrument's range, or one too many for a playable chord).

    `rolls` is the note model's frame-by-frame output, used to judge how long notes ring. Notes
    that carry 'string_logp' (what the sound says about their string) have it weighed in."""
    w = dict(config.WEIGHTS, **(weights or {}))
    notes.sort(key=lambda n: (n['onset'], n['pitch']))
    if rolls is not None and w['roll_ring'] > 0:
        extend_ringing(notes, rolls, w['roll_ring'])
    carry = bool(w['carry'])
    unplaced, groups = [], []
    for g in group_onsets(notes):
        g = sorted(g, key=lambda n: -n['velocity'])
        # an unplayable chord loses its quietest notes until a shape exists
        while g:
            shapes = voicings([n['pitch'] for n in g], tuning, capo)
            if shapes:
                break
            unplaced.append(g.pop())
        if g:
            costs = [shape_cost(v, capo, w, g) for v in shapes]
            keep = sorted(range(len(shapes)), key=costs.__getitem__)[:config.MAX_VOICINGS]
            groups.append((g, [shapes[i] for i in keep], [costs[i] for i in keep]))
    if not groups:
        return unplaced

    home = capo + w['home']
    layers, prev = [], None
    for g, shapes, costs in groups:
        onset = min(n['onset'] for n in g)
        states = []   # (shape index, hand position, cost of the shape at that position)
        for vi, v in enumerate(shapes):
            fretted = [f for _, f in v if f > capo]
            base = costs[vi]
            if not fretted:
                # open strings leave the hand wherever it was
                for p in (sorted(set(prev['pos'].tolist())) if prev else [capo + max(1, int(round(w['home'])))]):
                    states.append((vi, p, base))
                continue
            lo, hi = min(fretted), max(fretted)
            if hi - lo <= 3:
                for p in range(max(capo + 1, hi - 3), lo + 1):
                    states.append((vi, p, base + w['position'] * abs(p - home)))
            else:
                states.append((vi, lo, base + w['position'] * abs(lo - home) + w['stretch'] * (hi - lo - 3)))
        n_states = len(states)
        which = np.array([s[0] for s in states])
        pos = np.array([s[1] for s in states], dtype=np.float64)
        local = np.array([s[2] for s in states], dtype=np.float64)
        # per shape, what sits on each string (index 1..6): fret, when it stops sounding, its pitch
        s_fret = np.full((len(shapes), 7), -1, dtype=np.int64)
        s_off = np.zeros((len(shapes), 7))
        s_pitch = np.full((len(shapes), 7), -1, dtype=np.int64)
        for vi, v in enumerate(shapes):
            for (s, f), n in zip(v, g):
                s_fret[vi, s], s_off[vi, s], s_pitch[vi, s] = f, n.get('ring', n['offset']), n['pitch']
        own_fret, own_off, own_pitch = s_fret[which], s_off[which], s_pitch[which]
        used = own_fret >= 0
        layer = {'states': states, 'pos': pos, 'onset': onset, 'shapes': shapes, 'notes': g}
        if prev is None:
            layer['cost'], layer['back'] = local, np.full(n_states, -1)
            back = None
        else:
            dt = max(onset - prev['onset'], 0.05)
            trans = np.abs(pos[None, :] - prev['pos'][:, None]) * (w['move'] + w['move_fast'] / dt)
            p_fret, p_off, p_pitch, p_on = prev['c_fret'], prev['c_off'], prev['c_pitch'], prev['c_on']
            # strings whose earlier note is still sounding when this chord starts
            ringing = (p_fret >= 0) & (p_off > onset + RING_MARGIN_S)
            trans += w['ring'] * (ringing.astype(np.float64) @ used.T.astype(np.float64))
            # a pitch heard again prefers the string it was last played on
            if w['restring']:
                known = p_pitch if not carry else np.where(onset - p_on < w['memory'], p_pitch, -1)
                seen = set(np.unique(known).tolist())
                for vi, v in enumerate(shapes):
                    extra = None
                    for (s, _), n in zip(v, g):
                        if n['pitch'] in seen:
                            moved = (known == n['pitch']).any(axis=1) & (known[:, s] != n['pitch'])
                            extra = moved.astype(np.float64) if extra is None else extra + moved
                    if extra is not None and extra.any():
                        trans[:, which == vi] += w['restring'] * extra[:, None]
            # fretted notes still held down keep the hand within reach of them
            if carry and w['held']:
                held = (ringing & (p_fret > capo))[:, None, :] & ~used[None, :, :]
                if held.any():
                    frets = np.broadcast_to(p_fret[:, None, :], held.shape)
                    lo3 = np.where(held, frets, 99).min(axis=-1)
                    hi3 = np.where(held, frets, -1).max(axis=-1)
                    beyond = np.clip(pos[None, :] - lo3, 0, None) * (lo3 < 99) + np.clip(hi3 - pos[None, :] - 3, 0, None) * (hi3 >= 0)
                    trans += w['held'] * beyond
            total = prev['cost'][:, None] + trans
            back = np.argmin(total, axis=0)
            layer['back'] = back
            layer['cost'] = total[back, np.arange(n_states)] + local
        if carry and back is not None:
            # each state remembers, along its best path so far, the last note on every string
            layer['c_fret'] = np.where(used, own_fret, prev['c_fret'][back])
            layer['c_off'] = np.where(used, own_off, prev['c_off'][back])
            layer['c_pitch'] = np.where(used, own_pitch, prev['c_pitch'][back])
            layer['c_on'] = np.where(used, onset, prev['c_on'][back])
        else:
            layer['c_fret'], layer['c_off'], layer['c_pitch'] = own_fret, own_off, own_pitch
            layer['c_on'] = np.where(used, onset, -1e9)
        layers.append(layer)
        prev = layer

    k = int(np.argmin(layers[-1]['cost']))
    for layer in reversed(layers):
        shape = layer['shapes'][layer['states'][k][0]]
        for n, (s, f) in zip(layer['notes'], shape):
            n['string'], n['fret'] = s, f
        k = int(layer['back'][k])
    return unplaced


def playability(notes, capo=0):
    """Largest fretted span and finger count over all chords, for checking the result."""
    worst_span, worst_fingers = 0, 0
    placed = sorted((n for n in notes if n.get('string')), key=lambda n: n['onset'])
    for g in group_onsets(placed):
        v = [(n['string'], n['fret']) for n in g]
        fretted = [f for _, f in v if f > capo]
        if fretted:
            worst_span = max(worst_span, max(fretted) - min(fretted))
        worst_fingers = max(worst_fingers, fingers_needed(v, capo))
    return {'max_span': worst_span, 'max_fingers': worst_fingers}
