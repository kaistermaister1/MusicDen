"""Defaults and the decoder's cost weights."""

CHECKPOINT = 'guitar-gaps.pth'   # which set of guitar weights hears the notes
SAMPLE_RATE = 16000          # what the note model listens at
ONSET_THRESHOLD = 0.3        # how sure the model must be that a note starts
OFFSET_THRESHOLD = 0.3       # ... that it ends
FRAME_THRESHOLD = 0.1        # ... that it is still sounding
GROUP_WINDOW_S = 0.035       # onsets closer than this are one chord
MERGE_WINDOW_S = 0.03        # a re-trigger of the same pitch inside this is one note
MIN_NOTES = 8                # fewer than this and the recording is treated as having no guitar
MAX_FRET = 22
MAX_SPAN = 5
MAX_VOICINGS = 24            # voicings kept per chord before the search
STRING_EVIDENCE = True       # listen for which string each note is on (standard tuning without a capo only)

TUNINGS = {                  # open-string pitches, string 1 (high E) to string 6
    'standard': [64, 59, 55, 50, 45, 40],
    'drop_d': [64, 59, 55, 50, 45, 38],
    'half_down': [63, 58, 54, 49, 44, 39],
    'dadgad': [62, 57, 55, 50, 45, 38],
    'open_g': [62, 59, 55, 50, 43, 38],
}

# Values from eval/tuned_weights.json: random search on GuitarSet dev takes (oracle Tab F1 0.734 on
# 300 dev takes, against 0.488 for the earlier hand-set values).
WEIGHTS = {
    'fret': -0.01,           # per fret of each fretted note
    'position': 0.153,       # per fret of hand position
    'open': 0.583,           # each open string
    'span': [0.0, 0.0, 0.05, 0.2, 0.9, 2.2, 4.5],   # by fretted span of a chord
    'stretch': 2.781,        # a note one fret beyond the hand's four-fret reach
    'move': 0.168,           # per fret the hand moves
    'move_fast': 0.525,      # extra per fret, divided by the seconds available to move
    'ring': 2.46,            # playing on a string whose previous note is still sounding
    'restring': 1.522,       # the same pitch repeated on a different string
    'home': 5.092,           # the fret the hand prefers to sit at; 'position' is charged per fret away from it
    'high': 0.178,           # extra per fret above the twelfth
    'span_scale': 1.398,     # multiplies the 'span' table
    'carry': 1,              # 1: remember the last note on every string through earlier chords, not just the one before
    'memory': 0.609,         # seconds a string's last pitch is remembered for 'restring' (with 'carry')
    'held': 1.527,           # per fret the hand would sit out of reach of a fretted note still held down (with 'carry')
    'roll_ring': 0.0,        # above 0: notes ring until the note model's frame output falls below this
    'evidence': 1.0,         # weight of what the sound says about which string a note is on (used when there is any)
    'both': 1,               # 1: with evidence, also try the OPEN_POSITION values and keep the better fit
}

# The values above suit playing up the neck, which is what most GuitarSet players do. These suit
# playing near the nut with open strings (the first, hand-set values). Players differ far more in
# this habit than in anything else the decoder weighs, so when the sound gives evidence about
# strings, both are tried on a recording and the one the evidence agrees with more is kept.
OPEN_POSITION = {'fret': 0.03, 'position': 0.05, 'open': -0.25, 'stretch': 1.2, 'move': 0.3, 'move_fast': 0.12,
                 'ring': 0.9, 'restring': 0.5, 'home': 0.0, 'high': 0.0, 'span_scale': 1.0, 'memory': 2.0, 'held': 1.0}
