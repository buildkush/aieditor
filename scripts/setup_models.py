"""Prepare selected existing caption models; never transcribe or benchmark media."""
import argparse
import os
from pathlib import Path
import subprocess
import sys

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / 'speech-lab' / 'backend'))


def progress_reporter():
    previous = None

    def emit(kind, data):
        nonlocal previous
        if kind != 'progress':
            return
        message = data.get('message', data.get('stage', 'Working'))
        total = data.get('total') or 0
        percent = int(100 * data.get('completed', 0) / total) if total else None
        bucket = percent // 5 if percent is not None else None
        current = (message, bucket)
        if current != previous:
            suffix = f' ({percent}%)' if percent is not None else ''
            print(message + suffix, flush=True)
            previous = current

    return emit


def prepare_models(root, selection, check=False, emit=None):
    if selection == 'none':
        print('No model downloads selected.', flush=True)
        return
    import models
    import tara
    import tara_int8
    emit = emit or progress_reporter()
    selected = ['tara', 'shruti'] if selection == 'both' else [selection]
    # A check only reads existing markers/assets; it never calls catalog, creates
    # manifests, installs runtimes, downloads weights or runs native builds.
    if check:
        missing = []
        for model in selected:
            ready = (tara_int8.installed(root) and tara_int8.native_ready(root)) if model == 'tara' else models.installed(root, 'shruti')
            print(f'{model}: {"ready" if ready else "missing or incomplete"}', flush=True)
            if not ready:
                missing.append(model)
        if missing:
            raise RuntimeError('Run setup.cmd to prepare: ' + ', '.join(missing))
        return
    root.mkdir(parents=True, exist_ok=True)
    for model in selected:
        if model == 'shruti':
            if models.installed(root, 'shruti'):
                print('Reusing verified Shruti assets and runtime.', flush=True)
            else:
                models.download(root, 'shruti', emit)
            if not models.installed(root, 'shruti'):
                raise RuntimeError('Shruti installation did not pass verification')
        else:
            if tara_int8.installed(root, verify=True) and tara_int8.native_ready(root):
                print('Reusing verified Tara INT8 assets and runtime.', flush=True)
                continue
            # Build the runtime before requesting conversion. On a fresh machine
            # the normal Tara installer deliberately refuses an unpatched runtime.
            if not tara_int8.native_ready(root):
                tara.install_runtime(root, emit)
                print('Building the pinned Tara CPU runtime (no inference).', flush=True)
                subprocess.run([sys.executable, str(REPO / 'scripts' / 'build_tara_int8.py')], check=True)
            tara_int8.install(root, emit)
            if not (tara_int8.installed(root) and tara_int8.native_ready(root)):
                raise RuntimeError('Tara installation did not pass verification')
        print(f'{model}: ready', flush=True)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--models', choices=('both', 'tara', 'shruti', 'none'), default='both')
    parser.add_argument('--check', action='store_true', help='Read readiness without installing anything')
    args = parser.parse_args(argv)
    if args.models == 'none':
        print('No model downloads selected.')
        return
    if os.name != 'nt' or not os.environ.get('LOCALAPPDATA'):
        raise RuntimeError('Caption model setup requires Windows with LOCALAPPDATA available')
    os.environ['HF_HUB_DISABLE_TELEMETRY'] = '1'
    os.environ['NEEDLE_TELEMETRY'] = '0'
    root = Path(os.environ['LOCALAPPDATA']) / 'com.aiditor.app' / 'speech-lab'
    print(f'Model cache: {root}', flush=True)
    prepare_models(root, args.models, check=args.check)


if __name__ == '__main__':
    try:
        main()
    except (RuntimeError, OSError, ValueError, ImportError, subprocess.CalledProcessError) as error:
        print(f'Model setup failed: {error}', file=sys.stderr)
        sys.exit(1)
