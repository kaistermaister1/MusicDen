"""
run.py - turn one link or recording of solo guitar into a saved tab, for the app.

Usage:
    python run.py <link or file> [title]
    python run.py --probe

The app starts this and reads what it prints, a line at a time:

    stage download        each step as it begins: download, listen, arrange, rhythm, save
    saved <id>            the tab is in the folder of tabs, in the file <id>.json
    error <why>           no tab was saved: tools, download_failed, no_guitar or failed

"error tools" is followed on the same line by the names of what is missing: Python packages,
or ffmpeg. --probe prints "ready" when nothing is missing, and stops. Anything else printed
(a model saying it fell back to the processor, a beat that could not be found) is for whoever
reads the log.

Where the tab, the work files and the model weights go is named through the environment:
see library.py.

Requires: torch, torchaudio, hf_midi_transcription, beat-this, librosa, soundfile, yt-dlp; ffmpeg
"""
import importlib.util
import sys
import traceback
from pathlib import Path

NEEDS = ('torch', 'torchaudio', 'numpy', 'soundfile', 'librosa', 'huggingface_hub', 'hf_midi_transcription', 'beat_this', 'yt_dlp')


def missing():
    """What transcribing needs and this Python cannot find."""
    from guitar_tab import ingest
    out = [name for name in NEEDS if importlib.util.find_spec(name) is None]
    if not ingest.ffmpeg_path():
        out.append('ffmpeg')
    return out


def run(args):
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, 'reconfigure'):
            stream.reconfigure(encoding='utf-8', errors='replace')
    # the package is found from the folder above this file; this file's own folder leaves the
    # search path, so that none of the package's modules is mistaken for a library of the same name
    sys.path[0] = str(Path(__file__).resolve().parent.parent)
    lacking = missing()
    if lacking:
        print('error tools ' + ' '.join(lacking), flush=True)
        return 3
    if args[:1] == ['--probe']:
        print('ready', flush=True)
        return 0
    if not args:
        print('error failed', flush=True)
        return 2
    from guitar_tab import pipeline
    from guitar_tab.errors import TabError
    source, title = args[0], (args[1] if len(args) > 1 and args[1] else None)
    is_url = source.lower().startswith(('http://', 'https://'))
    try:
        saved = pipeline.transcribe(source, is_url, title=title, on_stage=lambda s: print('stage ' + s, flush=True))
    except TabError as e:
        print(str(e), file=sys.stderr, flush=True)
        print('error ' + e.code, flush=True)
        return 1
    except Exception:
        traceback.print_exc()
        print('error failed', flush=True)
        return 1
    print('saved ' + saved, flush=True)
    return 0


if __name__ == '__main__':
    sys.exit(run(sys.argv[1:]))
