"""
hand_split.py - split single-track piano MIDI into Right Hand / Left Hand tracks.

Usage:
    python hand_split.py input.mid [output.mid] [--split 60]

    Writes output.mid (default: "<input> (hands).mid") with two tracks named
    "Right Hand" and "Left Hand". Sustain/soft pedal events are copied to both.
    --split N uses a fixed split at MIDI pitch N instead (60 = middle C).

As a library:
    from hand_split import assign_hands, split_midi
    is_right = assign_hands(notes)        # notes: objects with .start, .end, .pitch
    split_midi("in.mid", "out.mid")

Requires: pretty_midi (pip install pretty_midi)

Method: notes starting within a short window form a chord, and each chord is
cut at a pitch boundary (lowest k notes -> left hand). A beam search keeps many
partial assignments alive, so a chord's hand can be revised once later notes
show which reading makes both hands move more plausibly. Each hand tracks a
smoothed register, its last note, and the keys it is still holding; costs
penalise leaps, stretches beyond a hand's reach, more than five keys per hand,
and the left hand sounding above the right.
"""
import argparse
import heapq
import math
from pathlib import Path



DEFAULTS = dict(
    chord_window=0.035,
    beam=24,
    w_center=1.0,       # pull toward the hand's recent register
    w_leap=0.6,         # pull toward the hand's last note (voice leading)
    leap_free=2.0,      # semitones of movement that cost nothing
    max_span=14,        # widest comfortable stretch, semitones
    w_span=40.0,        # cost per semitone beyond max_span
    w_count=60.0,       # cost per key beyond five held by one hand
    w_cross=25.0,       # cost per semitone the left hand sits above the right
    alpha=0.3,          # center smoothing per chord
    idle_tau=2.0,       # seconds for an idle hand's center to drift home
    home_r=67.0, home_l=50.0,
    min_gap=5.0,        # centers kept at least this far apart
)


class _Hand:
    __slots__ = ("c", "last", "t", "held")

    def __init__(self, c):
        self.c, self.last, self.t, self.held = c, None, None, ()

    def copy(self):
        h = _Hand(self.c)
        h.last, h.t, h.held = self.last, self.t, self.held
        return h


def _groups(notes, order, window):
    i, n = 0, len(order)
    while i < n:
        j, t0 = i, notes[order[i]].start
        while j + 1 < n and notes[order[j + 1]].start - t0 <= window:
            j += 1
        yield sorted(order[i:j + 1], key=lambda k: notes[k].pitch)
        i = j + 1


def assign_hands_v2(notes, **kw):
    P = {**DEFAULTS, **kw}
    n = len(notes)
    if n == 0:
        return []
    order = sorted(range(n), key=lambda i: (notes[i].start, notes[i].pitch))
    groups = list(_groups(notes, order, P["chord_window"]))

    # hypothesis: (cost, id, right_hand_state, left_hand_state, back_pointer)
    beam = [(0.0, 0, _Hand(P["home_r"]), _Hand(P["home_l"]), None)]
    uid = 1
    for g in groups:
        t = notes[g[0]].start
        ps = [notes[k].pitch for k in g]
        ends = [notes[k].end for k in g]
        cand = []
        for cost0, _, R, L, bp in beam:
            # release keys that are no longer held, relax idle hands toward home
            hands = []
            for H, home in ((R, P["home_r"]), (L, P["home_l"])):
                held = tuple(x for x in H.held if x[1] > t + 0.02)
                c = H.c
                if H.t is not None:
                    a = math.exp(-(t - H.t) / P["idle_tau"])
                    c = home + (c - home) * a if not held else c
                hands.append((c, held, H))
            (rc, rheld, Rh), (lc, lheld, Lh) = hands

            for k in range(len(ps) + 1):
                lp, rp = ps[:k], ps[k:]
                cost = 0.0
                for hp, c, held, H in ((rp, rc, rheld, Rh), (lp, lc, lheld, Lh)):
                    if not hp:
                        continue
                    cost += P["w_center"] * sum(abs(p - c) for p in hp) / len(hp) * min(len(hp), 3)
                    if H.last is not None:
                        ref = hp[-1] if H is Rh else hp[0]   # outer voice leads
                        cost += P["w_leap"] * max(0.0, abs(ref - H.last) - P["leap_free"])
                    allp = list(hp) + [x[0] for x in held]
                    span = max(allp) - min(allp)
                    if span > P["max_span"]:
                        cost += P["w_span"] * (span - P["max_span"])
                    if len(allp) > 5:
                        cost += P["w_count"] * (len(allp) - 5)
                # crossing: left-hand notes above right-hand notes sounding now
                rs = list(rp) + [x[0] for x in rheld]
                ls = list(lp) + [x[0] for x in lheld]
                if rs and ls and max(ls) > min(rs):
                    cost += P["w_cross"] * (max(ls) - min(rs))
                cand.append((cost0 + cost, k, rc, rheld, Rh, lc, lheld, Lh, bp, cost0))

        cand = heapq.nsmallest(P["beam"], cand, key=lambda x: x[0])
        new_beam = []
        for total, k, rc, rheld, Rh, lc, lheld, Lh, bp, _ in cand:
            lp, rp = ps[:k], ps[k:]
            R2, L2 = Rh.copy(), Lh.copy()
            for H, c, held, hp, he in ((R2, rc, rheld, rp, ends[k:]), (L2, lc, lheld, lp, ends[:k])):
                H.c = c
                H.held = held
                if hp:
                    H.c += P["alpha"] * (sum(hp) / len(hp) - H.c)
                    H.last = hp[-1] if H is R2 else hp[0]
                    H.t = t
                    H.held = held + tuple(zip(hp, he))
            gap = R2.c - L2.c
            if gap < P["min_gap"]:
                mid = (R2.c + L2.c) / 2
                R2.c, L2.c = mid + P["min_gap"] / 2, mid - P["min_gap"] / 2
            new_beam.append((total, uid, R2, L2, (k, bp)))
            uid += 1
        beam = new_beam

    best = min(beam, key=lambda x: x[0])
    cuts, bp = [], best[4]
    while bp is not None:
        cuts.append(bp[0])
        bp = bp[1]
    cuts.reverse()
    right = [True] * n
    for g, k in zip(groups, cuts):
        for idx, note_i in enumerate(g):
            right[note_i] = idx >= k
    return right


def assign_hands(notes, fixed_split=None, **params):
    """Returns list[bool] aligned with `notes`; True = right hand."""
    if fixed_split is not None:
        return [nt.pitch >= fixed_split for nt in notes]
    return assign_hands_v2(notes, **params)


def split_midi(in_path, out_path, fixed_split=None):
    """Read a MIDI file, split its piano notes into two hand tracks, write out_path.
    Returns (right_hand_note_count, left_hand_note_count)."""
    import pretty_midi

    pm = pretty_midi.PrettyMIDI(str(in_path))
    notes, ccs = [], []
    for inst in pm.instruments:
        if not inst.is_drum:
            notes.extend(inst.notes)
            ccs.extend(inst.control_changes)
    notes.sort(key=lambda nt: (nt.start, nt.pitch))
    ccs.sort(key=lambda c: c.time)

    is_right = assign_hands(notes, fixed_split)

    out = pretty_midi.PrettyMIDI(initial_tempo=120.0)
    rh = pretty_midi.Instrument(program=0, name="Right Hand")
    lh = pretty_midi.Instrument(program=0, name="Left Hand")
    for nt, r in zip(notes, is_right):
        (rh if r else lh).notes.append(
            pretty_midi.Note(velocity=nt.velocity, pitch=nt.pitch, start=nt.start, end=nt.end))
    for c in ccs:
        for inst in (rh, lh):
            inst.control_changes.append(pretty_midi.ControlChange(number=c.number, value=c.value, time=c.time))
    out.instruments.extend([rh, lh])
    out.write(str(out_path))
    return len(rh.notes), len(lh.notes)


def main():
    ap = argparse.ArgumentParser(description="Split piano MIDI into Right Hand / Left Hand tracks")
    ap.add_argument("input")
    ap.add_argument("output", nargs="?")
    ap.add_argument("--split", type=int, default=None, help="fixed split at this MIDI pitch (60 = middle C)")
    args = ap.parse_args()
    src = Path(args.input)
    dst = Path(args.output) if args.output else src.with_name(src.stem + " (hands).mid")
    n_r, n_l = split_midi(src, dst, args.split)
    print(f"{dst}  (right hand {n_r} notes, left hand {n_l} notes)")


if __name__ == "__main__":
    main()
