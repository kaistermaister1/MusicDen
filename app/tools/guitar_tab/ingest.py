"""Gets a recording ready to listen to: fetches it from a link, and extracts its sound track as
mono audio at an even loudness."""
import os
import shutil
import subprocess
import sys
from pathlib import Path

from .errors import TabError

MEDIA = {'.mp4', '.mov', '.mkv', '.webm', '.m4a', '.mp3', '.wav', '.flac', '.ogg', '.opus', '.aac'}


def _run(cmd):
    return subprocess.run(cmd, capture_output=True, text=True, encoding='utf-8', errors='replace')


def fetch(url, folder):
    """Downloads the best sound track of a link into `folder`. Returns (file, title)."""
    folder.mkdir(parents=True, exist_ok=True)
    cmd = [sys.executable, '-m', 'yt_dlp', '--no-playlist', '--no-warnings', '--encoding', 'utf-8', '-f', 'bestaudio/best',
           '-o', str(folder / 'source.%(ext)s'), '--print', 'after_move:%(title)s', '--print', 'after_move:%(filepath)s',
           '--no-simulate']
    # YouTube links need a JavaScript engine to be read; the app offers itself as one
    engine = os.environ.get('MUSICDEN_JS_RUNTIME')
    if engine:
        cmd += ['--js-runtimes', 'node:' + engine]
    r = _run(cmd + ['--', url])
    lines = [ln for ln in r.stdout.splitlines() if ln.strip()]
    if r.returncode != 0 or len(lines) < 2 or not Path(lines[-1]).is_file():
        raise TabError('download_failed', (r.stderr or r.stdout).strip()[-400:])
    return Path(lines[-1]), lines[-2].strip()


def ffmpeg_path():
    """The FFmpeg the app found beside itself, or the one on the PATH; None when there is neither."""
    return os.environ.get('MUSICDEN_FFMPEG') or shutil.which('ffmpeg')


def to_wav(source, target, rate, level=True):
    """Writes the sound of `source` as a mono WAV at `rate`, evened out to a standard loudness
    unless `level` is False."""
    ffmpeg = ffmpeg_path()
    if not ffmpeg:
        raise TabError('failed', 'ffmpeg is not installed')
    r = _run([ffmpeg, '-y', '-v', 'error', '-i', str(source), '-vn', '-ac', '1', '-ar', str(rate)]
             + (['-af', 'loudnorm=I=-23:TP=-2:LRA=11'] if level else []) + ['-c:a', 'pcm_s16le', str(target)])
    if r.returncode != 0 or not target.is_file() or target.stat().st_size < 2000:
        raise TabError('failed', r.stderr.strip()[-400:] or 'no sound track found')
    return target
