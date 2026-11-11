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
function Get-NativeModelStatus { param([string]$Executable,[string]$Model) return [pscustomobject]@{installed=$true} }
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
function Import-SetupSpeechBundle {
    param([string]$Source)
    $script:SetupCalls.Add(@{Kind='speech-import';Source=$Source})
}
$Models = 'Both'; $AppOnly = $false; $Check = $true; $Launch = $false
Invoke-AiditorSetup
Assert-SetupTest ($script:SetupCalls.Count -eq 1) 'Check must only inspect app dependencies and model status.'
Assert-SetupTest ($script:SetupCalls[0].Args -join ' ' -eq 'ls --depth=0') 'Check must validate the installed app dependencies.'

$script:SetupCalls.Clear(); $Check = $false; $AppOnly = $true
Invoke-AiditorSetup
Assert-SetupTest (-not $script:CheckedSpeech) 'AppOnly must not require Python.'
Assert-SetupTest ($script:SetupCalls.Count -eq 2) 'AppOnly must only install npm dependencies and fetch locked Cargo dependencies.'
Assert-SetupTest ($script:SetupCalls[1].Args -contains '--locked') 'Cargo dependencies must honor Cargo.lock.'

$script:SetupCalls.Clear(); $AppOnly = $false; $Models = 'Shruti'
Invoke-AiditorSetup
Assert-SetupTest ($script:SetupCalls.Count -eq 5) 'Full setup must build native CLI, select acceleration, and install the selected model.'
Assert-SetupTest ($script:SetupCalls[4].Args -contains 'shruti') 'Only the selected model should be requested.'
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

$script:SetupCalls.Clear(); $Check=$false; $Launch=$false; $AppOnly=$false; $Models='Tara'; $script:FakeRustReady=$true; $SpeechBundle='D:\trusted-speech-transfer'
Invoke-AiditorSetup
Assert-SetupTest ($script:SetupCalls[3].Kind -eq 'speech-import') 'Speech transfer must be imported after the current CLI builds and before model installation.'
Assert-SetupTest ($script:SetupCalls[5].Args -join ' ' -eq 'models install tara') 'Verified CT2 files must be present before normal model readiness/install handling.'
$script:SetupCalls.Clear(); $Check=$true
$failedAsExpected=$false
try{Invoke-AiditorSetup}catch{$failedAsExpected=$_ -match 'SpeechBundle requires'}
Assert-SetupTest $failedAsExpected 'Read-only setup checks must not import a transfer bundle.'
Assert-SetupTest ($script:SetupCalls.Count -eq 0) 'Invalid speech transfer flags must fail before downloads or mutations.'

Write-Host '11 mock-only setup scenarios passed.'
