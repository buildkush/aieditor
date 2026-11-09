param([switch]$AppData, [string]$PythonExecutable = 'python')
$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent $PSScriptRoot
$taskVenv = Join-Path $taskRoot '.speech-lab-venv'
if ($AppData) { $taskVenv = Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'com.aiditor.app/speech-lab/runtime' }
& $PythonExecutable -c "import struct,sys; assert (3,12) <= sys.version_info[:2] < (3,14) and struct.calcsize('P')==8, 'Python 3.12/3.13 x64 is required'"
if ($LASTEXITCODE -ne 0) { throw 'Install Python 3.12/3.13 x64 before running Speech Lab setup.' }
$taskPython = Join-Path $taskVenv 'Scripts/python.exe'
if (-not (Test-Path -LiteralPath $taskPython)) {
    & $PythonExecutable -m venv $taskVenv
    if ($LASTEXITCODE -ne 0) { throw 'Could not create the Python environment.' }
}
& $taskPython -c "import struct,sys; assert (3,12) <= sys.version_info[:2] < (3,14) and struct.calcsize('P')==8, 'Existing environment uses an unsupported Python version/architecture'"
if ($LASTEXITCODE -ne 0) { throw 'The existing speech environment is incompatible. Move it aside and rerun setup to recreate it; model weights are stored separately.' }
& (Join-Path $taskVenv 'Scripts/python.exe') -m pip install -r (Join-Path $taskRoot 'speech-lab/requirements-lock.txt')
if ($LASTEXITCODE -ne 0) { throw 'Speech Lab dependency installation failed.' }
& $taskPython -m pip check
if ($LASTEXITCODE -ne 0) { throw 'Speech Lab has incompatible dependencies. Repair the environment before continuing.' }
Write-Host 'Speech Lab is ready. Run npm run tauri dev, then press Ctrl+Shift+L.'
Write-Host 'For Shruti, select Shruti in Audio Lab and click Download to install the pinned model and Needle 3.2.10 configuration.'
