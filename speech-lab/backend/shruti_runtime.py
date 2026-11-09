"""Pinned Shruti/Needle assets. Installation is explicit; loading never fetches assets."""
import contextlib
import hashlib
from importlib.metadata import PackageNotFoundError, version
import json
import os
from pathlib import Path
import platform
import struct
import sys
import zipfile

ASSETS = json.loads(Path(__file__).with_name('shruti-assets.json').read_text(encoding='utf-8'))


def platform_tag():
    machine = platform.machine().lower()
    arch = {'amd64': 'x86_64', 'x86_64': 'x86_64', 'arm64': 'aarch64', 'aarch64': 'aarch64'}.get(machine)
    if not arch or struct.calcsize('P') != 8:
        raise RuntimeError('Shruti needs a 64-bit x86_64 or arm64 Python runtime')
    if sys.platform == 'win32':
        return 'win_amd64' if arch == 'x86_64' else 'win_arm64'
    if sys.platform == 'darwin':
        return 'macosx_11_0_' + ('arm64' if arch == 'aarch64' else 'x86_64')
    if sys.platform == 'linux':
        family = 'musllinux_1_2_' if platform.libc_ver()[0] == 'musl' or list(Path('/lib').glob('ld-musl-*.so.1')) else 'manylinux2014_'
        return family + arch
    raise RuntimeError('No pinned Shruti engine is available for this operating system')


def manifest():
    tag = platform_tag()
    engine = ASSETS['platforms'][tag]
    files = [
        {'name': ASSETS['modelFile'], 'size': ASSETS['modelSize'], 'sha256': ASSETS['modelSha256']},
        {'name': 'needle-engine.whl', 'path': engine['path'], 'repo': ASSETS['engineRepo'],
         'revision': ASSETS['engineRevision'], 'size': engine['size'], 'sha256': engine['sha256']},
    ]
    return {'repo': ASSETS['modelRepo'], 'revision': ASSETS['modelRevision'], 'engineRevision': ASSETS['engineRevision'],
            'platform': tag, 'library': {'name': engine['library'], 'size': engine['librarySize'], 'sha256': engine['librarySha256']},
            'files': files, 'totalBytes': sum(file['size'] for file in files)}


def verified(path, file):
    if path.is_symlink() or not path.is_file() or path.stat().st_size != file['size']:
        return False
    with path.open('rb') as handle:
        return hashlib.file_digest(handle, 'sha256').hexdigest() == file['sha256']


def package_error():
    try:
        if version('cactus-needle') == ASSETS['packageVersion']:
            return None
    except PackageNotFoundError:
        pass
    return f"Shruti requires cactus-needle=={ASSETS['packageVersion']}. Run powershell -File scripts/setup-speech-lab.ps1."


def extract_engine(folder, info):
    library = info['library']
    target = folder / library['name']
    if verified(target, library):
        return
    archive = folder / 'needle-engine.whl'
    if not verified(archive, info['files'][1]):
        raise ValueError('Needle engine archive failed verification; use Verify / repair')
    # Extract only the known library, never wheel code or arbitrary archive paths.
    with zipfile.ZipFile(archive) as wheel:
        data = wheel.read('needle/' + library['name'])
    if len(data) != library['size'] or hashlib.sha256(data).hexdigest() != library['sha256']:
        raise ValueError('Needle engine library checksum mismatch')
    temp = target.with_suffix(target.suffix + '.part')
    temp.write_bytes(data)
    os.replace(temp, target)


def initialize(root, emit):
    from models import model_dir
    error = package_error()
    if error:
        raise RuntimeError(error)
    folder, info = model_dir(root, 'shruti'), manifest()
    if not all(verified(folder / file['name'], file) for file in [*info['files'], info['library']]):
        raise ValueError('Shruti model or engine failed verification. Download or Verify / repair Shruti first.')
    # Configure these before importing needle. The supported library override
    # prevents the runtime from fetching its default engine or Whistle weights.
    os.environ['NEEDLE_TELEMETRY'] = '0'
    os.environ['HF_HUB_DISABLE_TELEMETRY'] = '1'
    os.environ['HF_HUB_OFFLINE'] = '1'
    os.environ['NEEDLE3_LIB_PATH'] = str((folder / info['library']['name']).resolve())
    emit('progress', {'stage': 'loading', 'message': 'Loading Shruti locally with the verified Needle engine'})
    with contextlib.redirect_stdout(sys.stderr):
        from needle import Whistle
        return Whistle(str(folder / ASSETS['modelFile']))
