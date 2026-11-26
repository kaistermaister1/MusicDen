/* Coming from the welcome page, the guitar's page comes up as the piano's does: from under a dark
   sheet that lifts off it (../arrive.js). The sheet has to be up before anything of the page
   shows, so this is the first thing the page runs; the page lifts it once it has started. Opened
   any other way, there is no sheet and nothing to lift. */
import {arriving} from '../arrive.js';

export const arrival = arriving();
/* nothing of the page shows before this */
document.documentElement.classList.add('started');
