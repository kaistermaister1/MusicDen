/* Renaming a row in one of the Songs panel's lists. Right-clicking a row puts a box in place of
   its name; Enter or clicking elsewhere keeps what was typed, and Escape leaves the name alone. */
import {T} from './strings.js';

/* `nameOf(li)` gives the name to start from, or null for a row that cannot be renamed.
   `rename(li, name)` is called with a new name, already rid of what a file name cannot hold. */
export function renaming(listEl, nameOf, rename) {
  listEl.addEventListener('contextmenu', e => {
    const li = e.target.closest('.song');
    if (!li || li.querySelector('.rename')) return;
    const was = nameOf(li), pick = li.querySelector('.pick');
    if (was == null) return;
    e.preventDefault();
    const box = Object.assign(document.createElement('input'), {className: 'rename', type: 'text', value: was, spellcheck: false});
    box.setAttribute('aria-label', T.rename);
    pick.hidden = true; li.insertBefore(box, pick);
    let over = false;
    const end = keep => {
      if (over) return;
      over = true;
      const name = box.value.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/\.+$/, '');
      box.remove(); pick.hidden = false;
      if (keep && name && name !== was) rename(li, name);
    };
    /* a click or a key in the box is not a click or a key for the row under it */
    box.addEventListener('click', ev => ev.stopPropagation());
    box.addEventListener('keydown', ev => {
      ev.stopPropagation();
      if (ev.key === 'Enter') end(true); else if (ev.key === 'Escape') end(false);
    });
    box.addEventListener('blur', () => end(true));
    box.focus(); box.select();
  });
}
