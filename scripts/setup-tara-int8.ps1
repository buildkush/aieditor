$ErrorActionPreference = 'Stop'
$repo = Split-Path $PSScriptRoot -Parent
$python = Join-Path $repo '.speech-lab-venv\Scripts\python.exe'
& $python (Join-Path $PSScriptRoot 'build_tara_int8.py')
if ($LASTEXITCODE -ne 0) { throw 'Tara INT8 native runtime setup failed.' }
