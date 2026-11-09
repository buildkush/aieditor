"""Original Whistle, pinned independently of Shruti; same verified Needle ABI."""
import contextlib
import json
import os
from pathlib import Path
import sys
import urllib.request
from shruti_runtime import manifest as engine_manifest, verified, extract_engine, package_error

ASSETS = json.loads(Path(__file__).with_name('whistle-assets.json').read_text(encoding='utf-8'))


def manifest():
    return ASSETS


def engine(root, emit, allow_download=False):
    info = engine_manifest()
    shared = Path(root) / 'models' / 'shruti'
    if verified(shared / info['library']['name'], info['library']):
        return shared / info['library']['name']
    folder = Path(root) / 'engines' / f"{info['engineRevision']}-{info['platform']}"
    library = folder / info['library']['name']
    if verified(library, info['library']):
        return library
    if not allow_download:
        raise ValueError('Whistle engine is missing or damaged; use Download / Verify to repair it')
    folder.mkdir(parents=True, exist_ok=True)
    asset = info['files'][1]
    archive = folder / asset['name']
    if not verified(archive, asset):
        url = f"https://huggingface.co/{asset['repo']}/resolve/{asset['revision']}/{asset['path']}"
        temp = archive.with_suffix('.part')
        with urllib.request.urlopen(url, timeout=60) as response, temp.open('wb') as output:
            count = 0
            while chunk := response.read(1024 * 1024):
                output.write(chunk); count += len(chunk)
                emit('progress', {'stage': 'download', 'message': 'Shared Needle engine', 'completed': count, 'total': asset['size']})
        if not verified(temp, asset):
            temp.unlink(missing_ok=True)
            raise ValueError('Needle engine checksum mismatch')
        os.replace(temp, archive)
    extract_engine(folder, info)
    return library


def ready(root):
    try:
        engine(root, lambda *_: None)
        return not package_error()
    except (ValueError, OSError, RuntimeError):
        return False


def initialize(root, emit):
    from models import model_dir
    if error := package_error():
        raise RuntimeError(error)
    folder = model_dir(root, 'whistle')
    if not all(verified(folder / asset['name'], asset) for asset in ASSETS['files']):
        raise ValueError('Whistle weights failed verification; download or repair Whistle')
    os.environ.update(NEEDLE_TELEMETRY='0', HF_HUB_DISABLE_TELEMETRY='1', HF_HUB_OFFLINE='1', NEEDLE3_LIB_PATH=str(engine(root, emit).resolve()))
    with contextlib.redirect_stdout(sys.stderr):
        from needle import Whistle
        return Whistle(str(folder / 'whistle.cact'))
