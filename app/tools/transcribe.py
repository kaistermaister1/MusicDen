"""
transcribe.py - write out the piano notes of a recording as a MIDI file, with Transkun.

Usage:
    python transcribe.py recording.wav notes.mid [cuda|cpu]
    python transcribe.py --probe

Transcribes on the graphics card when asked for "cuda" (the default) and PyTorch can use
one, otherwise on the processor. The first line printed says which it is:

    device cuda <name of the graphics card>
    device cpu

While the graphics card is at work, a line "memory <bytes>" follows about once a second
with how much of the card's memory the transcription holds at that moment, which is the
plain sign that the work is on the card. A last line "peak <bytes>" gives the most it
held at one time. If the card gives up partway (out of memory, a driver fault), the
recording is transcribed over again on the processor, and a line "device cpu again"
says so.

--probe prints the device line and stops, to tell what a run would use.

Requires: transkun (pip install transkun)
"""
import sys
import threading


def card():
    """The name of the graphics card PyTorch can use, or '' when it can use none."""
    try:
        import torch
        return torch.cuda.get_device_name(0) if torch.cuda.is_available() else ''
    except Exception:
        return ''


def transcribe(recording, notes, device):
    """Runs Transkun's own command on the given device."""
    from transkun.transcribe import main
    sys.argv = ['transkun', recording, notes, '--device', device]
    main()


def report(done):
    """Prints the card's memory held by this transcription about once a second until `done` is set."""
    import torch
    while not done.wait(1.0):
        try:
            held = torch.cuda.memory_allocated()
        except Exception:
            return
        if held:
            print('memory %d' % held, flush=True)


def run(args):
    name = card()
    if args[:1] == ['--probe']:
        print('device cuda ' + name if name else 'device cpu', flush=True)
        return
    recording, notes = args[0], args[1]
    if (args[2] if len(args) > 2 else 'cuda') == 'cuda' and name:
        print('device cuda ' + name, flush=True)
        done = threading.Event()
        threading.Thread(target=report, args=(done,), daemon=True).start()
        try:
            transcribe(recording, notes, 'cuda')
            import torch
            done.set()
            print('peak %d' % torch.cuda.max_memory_allocated(), flush=True)
            return
        except Exception:
            done.set()
            print('device cpu again', flush=True)
    else:
        print('device cpu', flush=True)
    transcribe(recording, notes, 'cpu')


if __name__ == '__main__':
    run(sys.argv[1:])
