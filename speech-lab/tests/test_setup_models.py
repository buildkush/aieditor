"""Setup orchestration tests: no downloads, native builds or model inference."""
import importlib.util
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO/'speech-lab/backend'))
spec = importlib.util.spec_from_file_location('aiditor_setup_models', REPO/'scripts/setup_models.py')
setup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(setup)
builder_spec = importlib.util.spec_from_file_location('aiditor_tara_builder', REPO/'scripts/build_tara_int8.py')
builder = importlib.util.module_from_spec(builder_spec)
builder_spec.loader.exec_module(builder)


class SetupModelTests(unittest.TestCase):
    def test_none_does_not_create_cache_or_download(self):
        with tempfile.TemporaryDirectory() as temp, patch('models.download') as download:
            cache = Path(temp)/'missing'
            setup.prepare_models(cache, 'none')
            self.assertFalse(cache.exists())
        download.assert_not_called()

    def test_check_never_repairs_or_creates_missing_models(self):
        with tempfile.TemporaryDirectory() as temp, patch('models.installed', return_value=False), \
             patch('tara_int8.installed', return_value=False), patch('models.download') as download, \
             patch('tara.install_runtime') as runtime, patch.object(setup.subprocess, 'run') as build, \
             patch('tara_int8.install') as convert, patch('models.catalog') as catalog:
            cache = Path(temp)/'missing'
            with self.assertRaisesRegex(RuntimeError, 'tara, shruti'):
                setup.prepare_models(cache, 'both', check=True)
            self.assertFalse(cache.exists())
        for operation in (download, runtime, build, convert, catalog):
            operation.assert_not_called()

    def test_verified_tara_does_not_rebuild_or_download_source(self):
        with tempfile.TemporaryDirectory() as temp, patch('tara_int8.installed', return_value=True) as installed, \
             patch('tara_int8.native_ready', return_value=True), patch('tara.install_runtime') as runtime, \
             patch.object(setup.subprocess, 'run') as build, patch('tara_int8.install') as convert:
            setup.prepare_models(Path(temp), 'tara')
        installed.assert_called_once_with(Path(temp), verify=True)
        for operation in (runtime, build, convert):
            operation.assert_not_called()

    def test_fresh_tara_builds_runtime_before_installing_conversion(self):
        operations = []
        with tempfile.TemporaryDirectory() as temp, \
             patch('tara_int8.installed', side_effect=[False, True]), \
             patch('tara_int8.native_ready', side_effect=[False, True]), \
             patch('tara.install_runtime', side_effect=lambda *_: operations.append('runtime')), \
             patch.object(setup.subprocess, 'run', side_effect=lambda *a, **kw: operations.append(('build', a[0], kw))), \
             patch('tara_int8.install', side_effect=lambda *_: operations.append('convert')):
            setup.prepare_models(Path(temp), 'tara')
        self.assertEqual(operations[0], 'runtime')
        self.assertEqual(operations[1][0], 'build')
        self.assertEqual(operations[1][1], [sys.executable, str(REPO/'scripts/build_tara_int8.py')])
        self.assertEqual(operations[1][2], {'check': True})
        self.assertEqual(operations[2], 'convert')

    def test_failed_native_build_does_not_start_model_conversion(self):
        with tempfile.TemporaryDirectory() as temp, patch('tara_int8.installed', return_value=False), \
             patch('tara_int8.native_ready', return_value=False), patch('tara.install_runtime'), \
             patch.object(setup.subprocess, 'run', side_effect=setup.subprocess.CalledProcessError(1, 'build')), \
             patch('tara_int8.install') as convert:
            with self.assertRaises(setup.subprocess.CalledProcessError):
                setup.prepare_models(Path(temp), 'tara')
        convert.assert_not_called()

    def test_shruti_reuses_verified_model_and_only_downloads_when_missing(self):
        for ready in (True, False):
            with self.subTest(ready=ready), tempfile.TemporaryDirectory() as temp, \
                 patch('models.installed', side_effect=[ready, True]), patch('models.download') as download, \
                 patch('tara.install_runtime') as runtime:
                setup.prepare_models(Path(temp), 'shruti')
                self.assertEqual(download.call_count, 0 if ready else 1)
                runtime.assert_not_called()

    def test_incomplete_install_fails_instead_of_claiming_success(self):
        with tempfile.TemporaryDirectory() as temp, patch('models.installed', return_value=False), \
             patch('models.download'):
            with self.assertRaisesRegex(RuntimeError, 'did not pass verification'):
                setup.prepare_models(Path(temp), 'shruti')

    def test_vswhere_supports_visual_studio_paths_with_spaces(self):
        with tempfile.TemporaryDirectory() as temp:
            base = Path(temp)/'Program Files (x86)'
            vswhere = base/'Microsoft Visual Studio/Installer/vswhere.exe'
            vswhere.parent.mkdir(parents=True)
            vswhere.touch()
            installation = Path(temp)/'Program Files/Microsoft Visual Studio/2022/Community'
            vcvars = installation/'VC/Auxiliary/Build/vcvars64.bat'
            vcvars.parent.mkdir(parents=True)
            vcvars.touch()
            with patch.dict(builder.os.environ, {'ProgramFiles(x86)': str(base), 'ProgramFiles': str(Path(temp)/'Other')}), \
                 patch.object(builder.subprocess, 'check_output', return_value=str(installation)+'\n'):
                self.assertEqual(builder.find_vcvars64(), vcvars)

    def test_native_build_raises_actionable_error_without_cpp_tools(self):
        with tempfile.TemporaryDirectory() as temp, patch.dict(builder.os.environ,
             {'ProgramFiles(x86)': temp, 'ProgramFiles': temp}):
            with self.assertRaisesRegex(RuntimeError, r'C\+\+ Build Tools'):
                builder.find_vcvars64()


if __name__ == '__main__':
    unittest.main()
