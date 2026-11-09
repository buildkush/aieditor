"""Build Tara-only CTranslate2 support on Windows. No recognition/inference calls."""
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO/'speech-lab/backend'))
import tara
from tara_int8 import PROFILE


def run(args, env=None):
    subprocess.run([str(a) for a in args], env=env, check=True)


def verify_release_flags(ninja):
    flags, compiler = [], False
    for line in ninja.splitlines():
        if line.startswith('build '):
            compiler = ' CXX_COMPILER' in line or ' C_COMPILER' in line
        if compiler and line.strip().startswith('FLAGS ='):
            flags.append(line)
    if not flags or any('/O2' not in line or '/DNDEBUG' not in line for line in flags):
        raise RuntimeError('Native build is missing required Release compiler optimization flags')


def find_vcvars64():
    roots = [Path(value) for key in ('ProgramFiles(x86)', 'ProgramFiles')
             if (value := os.environ.get(key))]
    for base in roots:
        vswhere = base/'Microsoft Visual Studio/Installer/vswhere.exe'
        if not vswhere.is_file():
            continue
        installation = subprocess.check_output([
            str(vswhere), '-latest', '-products', '*', '-requires',
            'Microsoft.VisualStudio.Component.VC.Tools.x86.x64', '-property',
            'installationPath'], text=True).strip()
        if installation:
            candidate = Path(installation)/'VC/Auxiliary/Build/vcvars64.bat'
            if candidate.is_file():
                return candidate
    # Also support an existing Community/Professional installation, not only
    # BuildTools in the original development machine's fixed directory.
    candidates = sorted(candidate for base in roots
                        for candidate in (base/'Microsoft Visual Studio').glob(
                            '*/*/VC/Auxiliary/Build/vcvars64.bat') if candidate.is_file())
    if not candidates:
        raise RuntimeError('Visual Studio C++ Build Tools and Windows SDK are required')
    return candidates[-1]


def main():
    if os.name != 'nt':
        raise RuntimeError('This native build is currently supported on Windows x64 only')
    root = Path(os.environ['LOCALAPPDATA'])/'com.aiditor.app/speech-lab'
    folder = tara.runtime_dir(root)
    python = tara.python_path(root)
    if not tara.runtime_ready(root):
        raise RuntimeError('Install original Tara in Audio Lab first')
    run([python,'-m','pip','install','--no-deps','ctranslate2==4.8.4'])
    run([python,'-m','pip','install','cmake==3.31.6','ninja==1.11.1.4','mkl-devel==2025.0.1'])
    source = REPO/'speech-lab/research/tara-ct2-source'
    if not source.exists():
        source.parent.mkdir(parents=True, exist_ok=True)
        run(['git','clone','--depth','1','--branch','v4.8.4','--recurse-submodules','--shallow-submodules',
             'https://github.com/OpenNMT/CTranslate2.git',source])
    commit = subprocess.check_output(['git','-C',str(source),'rev-parse','HEAD'],text=True).strip()
    if commit != '5de572ef60b67a0276c5989ee73d0072808ff4c3':
        raise RuntimeError('Unexpected CTranslate2 source revision')
    # Always derive patches from the pinned upstream blobs, not an arbitrary working file.
    native = subprocess.check_output(['git','-C',str(source),'show','HEAD:src/models/whisper.cc']).decode('utf-8')
    native = native.replace('prompt[index] >= sot_id && prompt[index] <= no_timestamps_id',
        '((prompt[index] >= sot_id && prompt[index] <= no_timestamps_id) || prompt[index] == 51866)')
    native = native.replace('std::min(total_max_length / 2, total_max_length - start_step)','total_max_length - start_step')
    native = native.replace('    class ApplyTimestampRules;', '''    // Pure parser probe: verifies the actual compiled prompt handling without inference.
    extern "C" __declspec(dllexport) size_t aiditor_tara_prompt_length() {
      return get_prompt_length({50258, 50276, 51866, 50360, 50364}, 50258, 50364);
    }
    class ApplyTimestampRules;''')
    (source/'src/models/whisper.cc').write_text(native,encoding='utf-8')
    cm = subprocess.check_output(['git','-C',str(source),'show','HEAD:CMakeLists.txt']).decode('utf-8')
    for name in ('mkl_core','mkl_intel_ilp64','mkl_intel_thread','mkl_sequential'):
        cm = cm.replace(name+'.lib',name+'_dll.lib')
    cm = cm.replace('NAMES mkl_core HINTS','NAMES mkl_core_dll HINTS')
    (source/'CMakeLists.txt').write_text(cm,encoding='utf-8')
    vcvars = find_vcvars64()
    batch = source.parent/'tara-build-env.cmd'
    batch.write_text(f'@echo off\ncall "{vcvars}" >nul\nif errorlevel 1 exit /b %errorlevel%\nset\n')
    result = subprocess.check_output(['cmd.exe','/c',str(batch)],text=True)
    # Never log or persist unrelated environment values.
    selected = {'PATH','INCLUDE','LIB','LIBPATH','VCTOOLSINSTALLDIR','WINDOWSSDKDIR','WINDOWSSDKVERSION'}
    env = dict(os.environ)
    for line in result.splitlines():
        if '=' in line:
            key,value = line.split('=',1)
            if key.upper() in selected: env[key] = value
    cmake = folder/'Scripts/cmake.exe'; build = source/'build-tara'
    run([cmake,'-S',source,'-B',build,'-G','Ninja','-DCMAKE_BUILD_TYPE=Release',
         '-DCMAKE_C_FLAGS_RELEASE=/O2 /DNDEBUG', '-DCMAKE_CXX_FLAGS_RELEASE=/O2 /DNDEBUG',
         '-DCMAKE_CXX_FLAGS=/EHsc /utf-8',f'-DCMAKE_MAKE_PROGRAM={folder/"Scripts/ninja.exe"}',
         '-DWITH_MKL=ON','-DWITH_CUDA=OFF','-DBUILD_CLI=OFF','-DBUILD_TESTS=OFF',
         f'-DMKL_ROOT={folder/"Library"}',f'-DIOMP5_LIBRARY={folder/"Library/lib/libiomp5md.lib"}'],env)
    run([cmake,'--build',build,'--parallel','4'],env)
    ninja = (build/'build.ninja').read_text(encoding='utf-8')
    verify_release_flags(ninja)
    target = folder/'Lib/site-packages/ctranslate2/ctranslate2.dll'
    shutil.copy2(build/'ctranslate2.dll',target)
    # Keep Torch's existing OpenMP DLL as the single provider. CT2's glob preload
    # and MKL's sibling-directory search otherwise initialize second copies.
    for duplicate in [target.with_name('libiomp5md.dll'), folder/'Library/bin/libiomp5md.dll']:
        if duplicate.exists():
            duplicate.replace(duplicate.with_suffix('.dll.stock'))
    marker_files = [target, *sorted((folder/'Library/bin').glob('mkl*.dll')),
                    folder/'Lib/site-packages/torch/lib/libiomp5md.dll',
                    *sorted((folder/'Lib/site-packages/ctranslate2').glob('_ext*.pyd'))]
    files = []
    for path in marker_files:
        if path.is_file():
            with path.open('rb') as stream: sha = hashlib.file_digest(stream,'sha256').hexdigest()
            files.append({'path':str(path.relative_to(folder)),'size':path.stat().st_size,'sha256':sha})
    run([python,'-c',"import sys;sys.path.insert(0,sys.argv[1]);from tara_int8 import activate_runtime; c,h=activate_runtime();print(c.__version__, 'CPU int8 ready; no inference')",REPO/'speech-lab/backend'])
    (folder/'tara-int8-native.json').write_text(json.dumps({'profile':PROFILE,'sourceCommit':commit,
        'compilerReleaseFlags':'/O2 /DNDEBUG',
        'patchedSourceSha256':hashlib.sha256(native.encode()).hexdigest(),'files':files},indent=2),encoding='utf-8')
    print('Tara-only native runtime installed. Original Tara and Shunya are unchanged.')


if __name__ == '__main__':
    main()
