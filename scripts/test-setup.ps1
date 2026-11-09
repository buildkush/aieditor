# Mock-only Windows PowerShell tests. No packages/models are installed or fetched.
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'setup.ps1')

function Assert-SetupTest {
    param([bool]$Condition, [string]$Message)
    if (-not $Condition) { throw $Message }
}

$originalPackageInstaller = ${function:Install-SetupPackage}
$script:SetupCalls = New-Object 'System.Collections.Generic.List[object]'
$script:FakeToolReady = $true
$script:FakeRustReady = $true
function Get-SetupRequirements {
    param([bool]$IncludeSpeech)
    $script:CheckedSpeech = $IncludeSpeech
    return @(@{ Name = 'Mock tool'; Id = 'Mock.Package'; Test = { $script:FakeToolReady }; Extra = @() })
}
function Test-SetupRust { return $script:FakeRustReady }
function Get-SetupPython { return 'C:\mock python\python.exe' }
function Test-Path { param([string]$LiteralPath) return $true }
function Install-SetupPackage {
    param([string]$Id, [string[]]$ExtraArguments)
    $script:SetupCalls.Add(@{ Kind = 'package'; Exe = $Id; Args = $ExtraArguments })
    $script:FakeToolReady = $true
}
function Invoke-SetupNative {
    param([string]$Executable, [string[]]$Arguments)
    $script:SetupCalls.Add(@{ Kind = 'native'; Exe = $Executable; Args = $Arguments })
    if ($script:FailNpm -and $Executable -eq 'npm.cmd') { throw 'Simulated npm failure' }
}
function Install-SetupSpeechDependencies {
    param([string]$PythonExecutable)
    $script:SetupCalls.Add(@{ Kind = 'speech'; Exe = $PythonExecutable; Args = @() })
}

$Models = 'Both'; $AppOnly = $false; $Check = $true; $Launch = $false
Invoke-AiditorSetup
Assert-SetupTest ($script:SetupCalls.Count -eq 3) 'Check must only run npm/pip/model readiness commands.'
Assert-SetupTest ($script:SetupCalls[0].Args -join ' ' -eq 'ls --depth=0') 'Check must validate the installed app dependencies.'
Assert-SetupTest ($script:SetupCalls[1].Args -join ' ' -eq '-m pip check') 'Check must validate the speech environment.'
Assert-SetupTest ($script:SetupCalls[2].Args -contains '--check') 'Check must never run model installation.'
Assert-SetupTest ($script:SetupCalls[2].Args -contains 'both') 'Check must inspect selected models.'

$script:SetupCalls.Clear(); $Check = $false; $AppOnly = $true
Invoke-AiditorSetup
Assert-SetupTest (-not $script:CheckedSpeech) 'AppOnly must not require Python.'
Assert-SetupTest ($script:SetupCalls.Count -eq 2) 'AppOnly must only install npm dependencies and fetch locked Cargo dependencies.'
Assert-SetupTest ($script:SetupCalls[1].Args -contains '--locked') 'Cargo dependencies must honor Cargo.lock.'

$script:SetupCalls.Clear(); $AppOnly = $false; $Models = 'Shruti'
Invoke-AiditorSetup
Assert-SetupTest ($script:SetupCalls.Count -eq 4) 'Full setup must prepare app, speech dependencies and selected models.'
Assert-SetupTest ($script:SetupCalls[2].Exe -eq 'C:\mock python\python.exe') 'Speech setup must receive the resolved interpreter, including spaces.'
Assert-SetupTest ($script:SetupCalls[3].Args -contains 'shruti') 'Only the selected model should be requested.'
Assert-SetupTest (-not ($script:SetupCalls[3].Args -contains '--check')) 'An installation must not accidentally run a read-only model check.'

$script:SetupCalls.Clear(); $AppOnly = $true; $script:FakeToolReady = $false
Invoke-AiditorSetup
Assert-SetupTest ($script:SetupCalls[0].Kind -eq 'package') 'Missing prerequisites must be installed before npm.'

$script:SetupCalls.Clear(); $script:FakeToolReady = $false; $Check = $true
$failedAsExpected = $false
try { Invoke-AiditorSetup } catch { $failedAsExpected = $_ -match 'Missing prerequisites' }
Assert-SetupTest $failedAsExpected 'Check must report missing prerequisites.'
Assert-SetupTest ($script:SetupCalls.Count -eq 0) 'Check must not repair missing prerequisites.'

$script:SetupCalls.Clear(); $script:FakeToolReady = $true; $Check = $false; $script:FailNpm = $true
$failedAsExpected = $false
try { Invoke-AiditorSetup } catch { $failedAsExpected = $_ -match 'Simulated npm failure' }
Assert-SetupTest $failedAsExpected 'A failed install must stop setup.'
Assert-SetupTest ($script:SetupCalls.Count -eq 1) 'Setup must not continue after npm fails.'

$SkipSystemInstall = $true
$failedAsExpected = $false
try { & $originalPackageInstaller 'Mock.Package' } catch { $failedAsExpected = $_ -match 'Missing prerequisite: Mock.Package' }
Assert-SetupTest $failedAsExpected 'SkipSystemInstall must refuse package installation.'

$script:SetupCalls.Clear(); $script:FailNpm = $false; $script:FakeRustReady = $false
$failedAsExpected = $false
try { Invoke-AiditorSetup } catch { $failedAsExpected = $_ -match 'Missing prerequisite: Rust' }
Assert-SetupTest $failedAsExpected 'SkipSystemInstall must also refuse Rust toolchain changes.'
Assert-SetupTest ($script:SetupCalls.Count -eq 0) 'Rust prerequisite failure must happen before dependency/model installation.'

$Check = $true; $Launch = $true
$failedAsExpected = $false
try { Invoke-AiditorSetup } catch { $failedAsExpected = $_ -match 'cannot be combined' }
Assert-SetupTest $failedAsExpected 'A check must not launch the application.'
Assert-SetupTest ($script:SetupCalls.Count -eq 0) 'Invalid check/launch flags must not start work.'

Write-Host '9 mock-only setup scenarios passed.'
