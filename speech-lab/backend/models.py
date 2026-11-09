"""Speech Lab model cache. Network operations only download explicitly requested assets."""
import hashlib
import json
import os
from pathlib import Path
import shutil
import time
import urllib.request

MODELS = {
    'shruti': ('Shruti', 'udgamlabs/Shruti'),
    'whistle': ('Whistle (English)', 'Cactus-Compute/whistle'),
    'tara': ('Tara – Original (CPU FP32)', 'Trelis/tara'),
    'tara-int8': ('Tara – CTranslate2 INT8', 'Trelis/tara'),
}
ALLOWED = {'model.bin', 'config.json', 'tokenizer.json', 'vocabulary.json', 'vocabulary.txt', 'preprocessor_config.json'}


def finalize_download(part, final):
    # Windows scanners can briefly retain a large completed file after verification.
    # Preserve it for resume if the lock persists; never start another download.
    for attempt in range(6):
        try:
            os.replace(part, final)
            return
        except PermissionError as error:
            if getattr(error, 'winerror', None) not in (32, 33) or attempt == 5:
                raise
            time.sleep(0.2 * (attempt + 1))



def model_dir(root, model):
    if model not in MODELS:
        raise ValueError('Unsupported model')
    folder = Path(root) / 'models' / model
    if folder.is_symlink() or not folder.resolve().is_relative_to(Path(root).resolve()):
        raise ValueError('Model directory must remain inside Speech Lab storage')
    return folder


def write_json(path, value):
    temp = path.with_suffix('.tmp')
    temp.write_text(json.dumps(value, ensure_ascii=False), encoding='utf-8')
    os.replace(temp, path)


def load_manifest(root, model, refresh=False):
    folder = model_dir(root, model)
    saved = folder / 'manifest.json'
    if model == 'tara':
        from tara import ASSETS
        folder.mkdir(parents=True, exist_ok=True)
        write_json(saved, ASSETS)
        return ASSETS
    if model == 'whistle':
        from whistle_runtime import manifest
        folder.mkdir(parents=True, exist_ok=True)
        pinned = manifest(); write_json(saved, pinned)
        return pinned
    if model == 'shruti':
        from shruti_runtime import manifest
        pinned = manifest()
        folder.mkdir(parents=True, exist_ok=True)
        try:
            previous = json.loads(saved.read_text(encoding='utf-8'))
        except (OSError, ValueError):
            previous = None
        if previous != pinned:
            write_json(saved, pinned)
        return pinned
    if saved.exists() and not refresh:
        return json.loads(saved.read_text(encoding='utf-8'))
    repo = MODELS[model][1]
    request = urllib.request.Request(f'https://huggingface.co/api/models/{repo}?blobs=true', headers={'User-Agent': 'aiditor-speech-lab'})
    with urllib.request.urlopen(request, timeout=30) as response:
        metadata = json.load(response)
    files = []
    for item in metadata['siblings']:
        if item['rfilename'] in ALLOWED:
            files.append({'name': item['rfilename'], 'size': item['size'], 'sha256': (item.get('lfs') or {}).get('sha256')})
    if not {'model.bin', 'config.json', 'tokenizer.json'}.issubset({f['name'] for f in files}):
        raise ValueError('Model manifest does not contain the required CTranslate2 files')
    manifest = {'repo': repo, 'revision': metadata['sha'], 'files': files, 'totalBytes': sum(f['size'] for f in files)}
    folder.mkdir(parents=True, exist_ok=True)
    write_json(saved, manifest)
    return manifest


def installed(root, model):
    if model == 'tara-int8':
        from tara_int8 import installed as ready
        return ready(root)
    folder = model_dir(root, model)
    try:
        manifest = json.loads((folder / 'manifest.json').read_text(encoding='utf-8'))
        marker = json.loads((folder / 'installed.json').read_text(encoding='utf-8'))
        if model == 'tara':
            from tara import ASSETS
            return manifest == ASSETS and marker == {'revision': ASSETS['revision']} and all(
                (folder / f['name']).is_file() and (folder / f['name']).stat().st_size == f['size'] for f in ASSETS['files'])
        if model == 'whistle':
            from whistle_runtime import ASSETS, ready, verified
            return manifest == ASSETS and marker == {'revision': ASSETS['revision']} and ready(root) and all(verified(folder / f['name'], f) for f in ASSETS['files'])
        if model == 'shruti':
            from shruti_runtime import manifest as pinned_manifest, verified, package_error
            pinned = pinned_manifest()
            return manifest == pinned and marker == {'revision': pinned['revision'], 'engineRevision': pinned['engineRevision'], 'platform': pinned['platform']} and not package_error() and all(
                verified(folder / file['name'], file) for file in [*pinned['files'], pinned['library']])
        return marker['revision'] == manifest['revision'] and all(
            (folder / f['name']).is_file() and (folder / f['name']).stat().st_size == f['size'] for f in manifest['files'])
    except (OSError, ValueError, KeyError):
        return False


def catalog(root, online=False):
    rows = []
    for model, (label, repo) in MODELS.items():
        if model == 'tara':
            continue  # Internal source checkpoint for INT8 conversion, not a runnable profile.
        if model == 'tara-int8':
            from tara_int8 import status
            rows.append(status(root))
            continue
        folder = model_dir(root, model)
        error, manifest = None, None
        try:
            if model == 'shruti':
                from shruti_runtime import package_error, manifest as pinned_manifest
                manifest = pinned_manifest()
                error = package_error()
            elif model in ('whistle', 'tara') or online or (folder / 'manifest.json').exists():
                manifest = load_manifest(root, model)
        except Exception as exc:
            error = str(exc)
        ready = installed(root, model)
        partial = sum(p.stat().st_size for p in folder.glob('*.part')) if folder.exists() else 0
        if manifest and not ready:
            partial += sum((folder / file['name']).stat().st_size for file in manifest['files'] if (folder / file['name']).is_file())
        rows.append({'id': model, 'name': label, 'repo': repo, 'installed': ready,
                     'totalBytes': manifest['totalBytes'] if manifest else None, 'partialBytes': partial, 'error': error})
        if model == 'tara':
            from tara import runtime_ready
            rows[-1]['runtimeInstalled'] = runtime_ready(root)
    standard=next((row for row in rows if row['id']=='tara-int8'),None)
    if standard:
        rows=[row for row in rows if row['id']!='tara-int8']
        rows.append({**standard,'id':'tara-int8-speech-aware-parallel','name':'Tara – Speech-aware · Parallel'})
    return rows


def download(root, model, emit):
    if model == 'tara-int8':
        from tara_int8 import install
        install(root, emit)
        return catalog(root)
    if model == 'tara':
        from tara import install_runtime
        install_runtime(root, emit)
        (model_dir(root, model) / 'installed.json').unlink(missing_ok=True)
    if model == 'whistle':
        from whistle_runtime import package_error
        if error := package_error(): raise RuntimeError(error)
        (model_dir(root, model) / 'installed.json').unlink(missing_ok=True)
    if model == 'shruti':
        from shruti_runtime import package_error
        if error := package_error():
            raise RuntimeError(error)
    manifest = load_manifest(root, model)
    folder = model_dir(root, model)
    if model == 'shruti':
        (folder / 'installed.json').unlink(missing_ok=True)
    total, completed = manifest['totalBytes'], 0
    for file in manifest['files']:
        final = folder / file['name']
        part = folder / (file['name'] + '.part')
        if final.exists() and final.stat().st_size == file['size']:
            with final.open('rb') as source:
                valid = not file['sha256'] or hashlib.file_digest(source, 'sha256').hexdigest() == file['sha256']
            if valid:
                completed += file['size']
                emit('progress', {'stage': 'download', 'completed': completed, 'total': total, 'message': file['name']})
                continue
            # A previously installed file failed verification. Never advertise it as reusable.
            (folder / 'installed.json').unlink(missing_ok=True)
        offset = part.stat().st_size if part.exists() else 0
        if offset > file['size']:
            part.unlink()
            offset = 0
        # Resolve a pinned revision, so a resumed download cannot combine two model versions.
        url = f"https://huggingface.co/{file.get('repo', manifest['repo'])}/resolve/{file.get('revision', manifest['revision'])}/{file.get('path', file['name'])}"
        headers = {'User-Agent': 'aiditor-speech-lab'}
        if offset:
            headers['Range'] = f'bytes={offset}-'
        if offset < file['size']:
            with urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=60) as response:
                if offset and (response.status != 206 or not response.headers.get('Content-Range', '').startswith(f'bytes {offset}-')):
                    offset = 0
                with part.open('ab' if offset else 'wb') as output:
                    while chunk := response.read(1024 * 1024):
                        output.write(chunk)
                        offset += len(chunk)
                        emit('progress', {'stage': 'download', 'completed': completed + offset, 'total': total, 'message': file['name']})
        if not part.exists() or part.stat().st_size != file['size']:
            raise ValueError('Incomplete model download; retry to resume')
        if file['sha256']:
            with part.open('rb') as source:
                digest = hashlib.file_digest(source, 'sha256').hexdigest()
            if digest != file['sha256']:
                part.unlink()
                raise ValueError('Model checksum mismatch; retry to download a clean copy')
        finalize_download(part, final)
        completed += file['size']
    marker = {'revision': manifest['revision']}
    if model == 'tara':
        from tara import command, python_path
        command([python_path(root), Path(__file__).with_name('tara.py'), root, 'check-assets'], emit)
    if model == 'whistle':
        from whistle_runtime import engine, initialize
        engine(root, emit, allow_download=True)
        initialize(root, emit)  # Installation load check only; no inference.
    if model == 'shruti':
        from shruti_runtime import extract_engine, initialize
        emit('progress', {'stage': 'installing', 'message': 'Verifying and installing the Shruti runtime'})
        extract_engine(folder, manifest)
        initialize(root, emit)  # Load only; never transcribe during installation.
        marker.update({'engineRevision': manifest['engineRevision'], 'platform': manifest['platform']})
    write_json(folder / 'installed.json', marker)
    return catalog(root)


def remove(root, model):
    folder = model_dir(root, model)
    if folder.exists():
        shutil.rmtree(folder)
    if model in ('tara', 'tara-int8') and not installed(root, 'tara') and not installed(root, 'tara-int8'):
        from tara import runtime_dir
        runtime = runtime_dir(root)
        if runtime.exists():
            shutil.rmtree(runtime)
    return catalog(root)
