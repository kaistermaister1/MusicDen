/* Changes a person makes to a tab by hand: moving a note to another string, removing a note, and
   undoing either. Works on the tab's own note list; drawing and saving are the caller's. */

export const MAX_FRET = 24;

/* The fret that sounds `pitch` on a string, or null when that string cannot play it. `tuning` lists
   the open strings from string 1 (high E) to string 6. */
export function fretOn(pitch, string, tuning, capo = 0) {
  const open = tuning[string - 1];
  if (open == null) return null;
  const fret = pitch - open;
  return fret >= capo && fret <= MAX_FRET ? fret : null;
}

/* `song` is the open tab (its notes are changed in place); `changed()` is called after every change
   and every undo. */
export function createEditor(getSong, changed) {
  const undone = [];   /* what to do to take each change back, latest last */

  const find = id => getSong().notes.find(n => n.id === id);
  /* another note that starts with this one and already sits on that string */
  const taken = (note, string) => getSong().notes.some(n => n !== note && n.string === string && Math.abs(n.start_s - note.start_s) < 0.02);

  return {
    /* Where the note would land on `string`: {fret} when it can go there, or {why} when it cannot. */
    try(id, string) {
      const song = getSong(), note = find(id);
      if (!note) return {why: 'gone'};
      const fret = fretOn(note.pitch, string, song.tuning || [], song.capo || 0);
      if (fret == null) return {why: 'range'};
      if (taken(note, string)) return {why: 'taken'};
      return {fret};
    },
    /* Moves the note to `string`, at the fret that keeps its pitch. Returns true when it moved. */
    move(id, string) {
      const note = find(id), to = this.try(id, string);
      if (!note || to.fret == null || note.string === string) return false;
      const was = {string: note.string, fret: note.fret};
      note.string = string; note.fret = to.fret;
      undone.push(() => { note.string = was.string; note.fret = was.fret; });
      changed();
      return true;
    },
    remove(id) {
      const notes = getSong().notes, at = notes.findIndex(n => n.id === id);
      if (at < 0) return false;
      const [note] = notes.splice(at, 1);
      undone.push(() => { notes.push(note); notes.sort((a, b) => a.start_s - b.start_s || a.string - b.string); });
      changed();
      return true;
    },
    undo() {
      const back = undone.pop();
      if (!back) return false;
      back(); changed();
      return true;
    },
    canUndo: () => undone.length > 0,
    clear() { undone.length = 0; }
  };
}
