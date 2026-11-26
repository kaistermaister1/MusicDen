"""Where a transcription keeps its files: the folder the finished tab is saved to, a folder for the
work files of the one recording, and a folder for model weights, which are fetched once and kept.
The app names all three through the environment when it starts the runner (run.py)."""
import datetime
import hashlib
import json
import os
import re
from pathlib import Path

_home = Path(os.environ.get('LOCALAPPDATA') or Path.home()) / 'MusicDen' / 'guitar'
SONGS = Path(os.environ.get('MUSICDEN_GUITAR_TABS') or _home / 'tabs')
WORK = Path(os.environ.get('MUSICDEN_GUITAR_WORK') or _home / 'work')
CACHE = Path(os.environ.get('MUSICDEN_GUITAR_MODELS') or _home)   # weights are kept in CACHE/models


def song_id(title, key):
    slug = re.sub(r'[^a-z0-9]+', '-', title.lower()).strip('-')[:48] or 'tab'
    return f'{slug}-{hashlib.sha1(key.encode("utf-8")).hexdigest()[:6]}'


def save(song, key):
    """Writes the tab into the folder of tabs and returns its id, which is also its file's name."""
    SONGS.mkdir(parents=True, exist_ok=True)
    sid = song_id(song['title'], key)
    song['added'] = datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
    # written beside the target first, then swapped in, so a tab is never left half written
    target = SONGS / f'{sid}.json'
    saving = SONGS / f'{sid}.json.saving'
    saving.write_text(json.dumps(song, separators=(',', ':')), encoding='utf-8')
    os.replace(saving, target)
    return sid
