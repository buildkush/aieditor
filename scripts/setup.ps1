[CmdletBinding()]
param(
    [ValidateSet('Both', 'Tara', 'Shruti', 'None')]
    [string]$Models = 'Both',
    [switch]$AppOnly,
    [switch]$Check,
    [switch]$SkipSystemInstall,
    [string]$SpeechBundle,
    [switch]$Launch
)

$ErrorActionPreference = 'Stop'
$script:SetupRoot = Split-Path -Parent $PSScriptRoot

function Invoke-SetupNative {
    param([string]$Executable, [string[]]$Arguments)
    & $Executable @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "$Executable failed (exit $LASTEXITCODE). Fix the error above and rerun setup."
    }
}

function Refresh-SetupPath {
    # Refresh only this process, so tools installed during setup are discoverable.
    $cargoBin = Join-Path ([Environment]::GetFolderPath('UserProfile')) '.cargo\bin'
    $env:Path = (@($cargoBin, [Environment]::GetEnvironmentVariable('Path', 'Machine'),
        [Environment]::GetEnvironmentVariable('Path', 'User'), $env:Path) |
        Where-Object { $_ }) -join ';'
}

function Test-SetupVersion {
    param([string]$Executable, [string]$Minimum)
    if (-not (Get-Command $Executable -ErrorAction SilentlyContinue)) { return $false }
    try {
        $reported = (& $Executable --version 2>$null | Out-String)
        return $LASTEXITCODE -eq 0 -and $reported -match '(\d+\.\d+\.\d+)' -and
            [version]$Matches[1] -ge [version]$Minimum
    } catch { return $false }
}

function Get-SetupVsInstallation {
    $programFilesX86 = [Environment]::GetFolderPath('ProgramFilesX86')
    if (-not $programFilesX86) { return $null }
    $vswhere = Join-Path $programFilesX86 'Microsoft Visual Studio\Installer\vswhere.exe'
    if (Test-Path -LiteralPath $vswhere) {
        $installation = (& $vswhere -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath | Out-String).Trim()
        if ($LASTEXITCODE -eq 0 -and $installation -and
            (Test-Path -LiteralPath (Join-Path $installation 'VC\Auxiliary\Build\vcvars64.bat'))) { return $installation }
    }
    # Some machines retain usable tools from an incomplete Installer registration.
    # Verify the actual compiler before requesting another large system install.
    foreach ($base in @($programFilesX86, $env:ProgramFiles)) {
        if (-not $base) { continue }
        $productsRoot = Join-Path $base 'Microsoft Visual Studio'
        if (-not (Test-Path -LiteralPath $productsRoot)) { continue }
        foreach ($year in Get-ChildItem -LiteralPath $productsRoot -Directory) {
            foreach ($product in Get-ChildItem -LiteralPath $year.FullName -Directory) {
                $vcvars = Join-Path $product.FullName 'VC\Auxiliary\Build\vcvars64.bat'
                $toolsets = Join-Path $product.FullName 'VC\Tools\MSVC'
                if (-not (Test-Path -LiteralPath $vcvars) -or -not (Test-Path -LiteralPath $toolsets)) { continue }
                foreach ($toolset in Get-ChildItem -LiteralPath $toolsets -Directory) {
                    if (Test-Path -LiteralPath (Join-Path $toolset.FullName 'bin\Hostx64\x64\cl.exe')) { return $product.FullName }
                }
            }
        }
    }
    return $null
}

function Test-SetupCpp {
    if (-not (Get-SetupVsInstallation)) { return $false }
    $programFilesX86 = [Environment]::GetFolderPath('ProgramFilesX86')
    $includes = Join-Path $programFilesX86 'Windows Kits\10\Include'
    if (-not (Test-Path -LiteralPath $includes)) { return $false }
    foreach ($sdk in Get-ChildItem -LiteralPath $includes -Directory) {
        if ((Test-Path -LiteralPath (Join-Path $sdk.FullName 'um\Windows.h')) -and
            (Test-Path -LiteralPath (Join-Path $sdk.FullName 'ucrt\stdlib.h'))) { return $true }
    }
    return $false
}

function Test-SetupWebView {
    foreach ($base in @([Environment]::GetFolderPath('ProgramFilesX86'),
        $env:ProgramFiles, [Environment]::GetFolderPath('LocalApplicationData'))) {
        if (-not $base) { continue }
        $application = Join-Path $base 'Microsoft\EdgeWebView\Application'
        if (-not (Test-Path -LiteralPath $application)) { continue }
        foreach ($versionFolder in Get-ChildItem -LiteralPath $application -Directory) {
            if (Test-Path -LiteralPath (Join-Path $versionFolder.FullName 'msedgewebview2.exe')) { return $true }
        }
    }
    return $false
}

function Test-SetupRust {
    if (-not (Test-SetupVersion 'rustc.exe' '1.90.0')) { return $false }
    if (-not (Get-Command cargo.exe -ErrorAction SilentlyContinue)) { return $false }
    $details = (& rustc.exe -vV 2>$null | Out-String)
    return $LASTEXITCODE -eq 0 -and $details -match 'host: x86_64-pc-windows-msvc'
}

function Install-SetupPackage {
    param([string]$Id, [string[]]$ExtraArguments = @())
    if ($SkipSystemInstall) { throw "Missing prerequisite: $Id. Install it and rerun setup (see docs/development.md)." }
    if (-not (Get-Command winget.exe -ErrorAction SilentlyContinue)) {
        throw 'WinGet is missing. Install/update Microsoft App Installer from the Microsoft Store, then rerun setup.cmd.'
    }
    Write-Host "Installing $Id. Windows may request administrator approval."
    $installArgs = @('install', '--id', $Id, '--exact', '--source', 'winget', '--silent',
        '--accept-source-agreements', '--accept-package-agreements', '--disable-interactivity') + $ExtraArguments
    & winget.exe @installArgs
    if ($LASTEXITCODE -eq 3010 -or $LASTEXITCODE -eq 1641) {
        throw "$Id requires a Windows restart. Restart, then rerun setup.cmd; completed installs will be reused."
    }
    if ($LASTEXITCODE -ne 0) { throw "Installing $Id failed (exit $LASTEXITCODE). Resolve the installer error and rerun setup.cmd." }
    Refresh-SetupPath
}

function Get-SetupRequirements {
    param([bool]$IncludeSpeech)
    $requirements = @(
        @{ Name = 'Git'; Id = 'Git.Git'; Test = { Test-SetupVersion 'git.exe' '2.0.0' }; Extra = @() },
        @{ Name = 'Node.js 22.18+ and npm'; Id = 'OpenJS.NodeJS.22'; Test = { (Test-SetupVersion 'node.exe' '22.18.0') -and [bool](Get-Command npm.cmd -ErrorAction SilentlyContinue) }; Extra = @() },
        @{ Name = 'C++ Build Tools and Windows SDK'; Id = 'Microsoft.VisualStudio.2022.BuildTools'; Test = { Test-SetupCpp }; Extra = @('--override', '--wait --passive --norestart --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended') },
        @{ Name = 'WebView2 Runtime'; Id = 'Microsoft.EdgeWebView2Runtime'; Test = { Test-SetupWebView }; Extra = @() }
    )
    $requirements += @{ Name = 'CMake'; Id = 'Kitware.CMake'; Test = { Test-SetupVersion 'cmake.exe' '3.20.0' }; Extra = @() }
    $requirements += @{ Name = 'FFmpeg'; Id = 'Gyan.FFmpeg'; Test = { [bool](Get-Command ffmpeg.exe -ErrorAction SilentlyContinue) }; Extra = @() }
    return $requirements
}

function Get-NativeModelStatus {
    param([string]$Executable, [string]$Model)
    $status = & $Executable models status $Model | ConvertFrom-Json
    if ($LASTEXITCODE -ne 0) { throw "Native $Model status check failed." }
    return $status
}
function Import-SetupSpeechBundle {
    param([string]$Source)
    Import-Module (Join-Path $PSScriptRoot 'speech-transfer.psm1') -Force
    Import-NativeSpeechTransfer -Source $Source | Format-List | Out-Host
}

function Invoke-AiditorSetup {
    if ($env:OS -ne 'Windows_NT' -or -not [Environment]::Is64BitOperatingSystem -or
        $env:PROCESSOR_ARCHITECTURE -eq 'ARM64' -or $env:PROCESSOR_ARCHITEW6432 -eq 'ARM64') {
        throw 'This setup targets Windows x64 (Intel/AMD). Other platforms need a separate native-runtime setup.'
    }
    if (-not [Environment]::Is64BitProcess) { throw 'Run setup.cmd from a 64-bit terminal.' }
    if ($Launch -and $Check) { throw '-Check cannot be combined with -Launch.' }
    if($SpeechBundle -and ($Check -or $AppOnly -or $Models -notin @('Both','Tara'))){
        throw '-SpeechBundle requires normal setup with -Models Both or Tara; it cannot be combined with -Check or -AppOnly.'
    }
    $includeSpeech = -not $AppOnly
    $selectedModels = if ($AppOnly) { 'none' } else { $Models.ToLowerInvariant() }
    Write-Host "aiditor Windows setup | speech=$includeSpeech | models=$selectedModels"
    Write-Host 'No recordings are processed. No GPU drivers or CUDA experiments are installed.'
    $missing = @()
    foreach ($requirement in Get-SetupRequirements $includeSpeech) {
        $ready = & $requirement.Test
        if (-not $ready -and -not $Check) {
            Install-SetupPackage $requirement.Id $requirement.Extra
            $ready = & $requirement.Test
        }
        Write-Host ("[{0}] {1}" -f $(if ($ready) { 'OK' } else { 'MISSING' }), $requirement.Name)
        if (-not $ready) { $missing += $requirement.Name }
    }
    $rustReady = Test-SetupRust
    if (-not $rustReady -and -not $Check) {
        if ($SkipSystemInstall) { throw 'Missing prerequisite: Rust 1.90+ Windows x64 MSVC. Install a compatible toolchain and rerun setup.' }
        if (-not (Get-Command rustup.exe -ErrorAction SilentlyContinue)) { Install-SetupPackage 'Rustlang.Rustup' }
        if (-not (Get-Command rustup.exe -ErrorAction SilentlyContinue)) { throw 'Rustup is not discoverable. Open a new terminal and rerun setup.cmd.' }
        Invoke-SetupNative 'rustup.exe' @('toolchain', 'install', 'stable-x86_64-pc-windows-msvc', '--profile', 'minimal')
        # A directory override leaves other projects' Rust selection unchanged.
        Invoke-SetupNative 'rustup.exe' @('override', 'set', 'stable-x86_64-pc-windows-msvc')
        $rustReady = Test-SetupRust
    }
    Write-Host ("[{0}] Rust 1.90+ / Cargo / Windows x64 MSVC" -f $(if ($rustReady) { 'OK' } else { 'MISSING' }))
    if (-not $rustReady) { $missing += 'Rust 1.90+ MSVC' }
    if ($missing.Count) {
        throw ('Missing prerequisites: ' + ($missing -join ', ') + '. For an existing Visual Studio installation, add Desktop development with C++ and a Windows SDK in Visual Studio Installer. Restart your terminal after installs, then rerun setup.cmd.')
    }
    $nativeCli = Join-Path $script:SetupRoot 'native\speech\target\release\aiditor.exe'
    if ($Check -and -not (Test-Path -LiteralPath $nativeCli)) {
        $developmentCli=Join-Path $script:SetupRoot 'native\speech\target\debug\aiditor.exe'
        if(Test-Path -LiteralPath $developmentCli){$nativeCli=$developmentCli}
    }
    $nativeManifest = Join-Path $script:SetupRoot 'native\speech\Cargo.toml'
    $requestedModels = switch ($selectedModels) { 'both' { @('tara','shruti') } 'none' { @() } default { @($selectedModels) } }
    if ($Check) {
        if (-not (Test-Path -LiteralPath (Join-Path $script:SetupRoot 'node_modules\@tauri-apps\cli'))) {
            throw 'App dependencies are missing. Run setup.cmd.'
        }
        Invoke-SetupNative 'npm.cmd' @('ls', '--depth=0')
        if ($includeSpeech) {
            if (-not (Test-Path -LiteralPath $nativeCli)) { throw 'Native caption CLI is missing. Run setup.cmd.' }
            foreach ($selected in $requestedModels) {
                $status = Get-NativeModelStatus $nativeCli $selected
                if (-not $status.installed) { throw "Native $selected is not ready. Run setup.cmd." }
            }
        }
        Write-Host 'Readiness checks passed; no packages or models were installed.'
        return
    }
    Invoke-SetupNative 'npm.cmd' @('ci')
    Invoke-SetupNative 'cargo.exe' @('fetch', '--locked', '--manifest-path', (Join-Path $script:SetupRoot 'src-tauri\Cargo.toml'))
    if ($includeSpeech) {
        Invoke-SetupNative 'cargo.exe' @('build', '--release', '--locked', '--manifest-path', $nativeManifest, '--bin', 'aiditor')
        if($SpeechBundle){Import-SetupSpeechBundle $SpeechBundle}
        Invoke-SetupNative $nativeCli @('runtime', 'auto')
        foreach ($selected in $requestedModels) { Invoke-SetupNative $nativeCli @('models', 'install', $selected) }
    }
    Write-Host ''
    Write-Host 'Setup complete. Run .\run-desktop.bat to launch aiditor.'
    if ($includeSpeech) { Write-Host "Caption models prepared: $selectedModels. Existing production speech profiles use CPU." }
    if (Get-Command nvidia-smi.exe -ErrorAction SilentlyContinue) {
        & nvidia-smi.exe --query-gpu=name,memory.total,driver_version --format=csv
    }
    if ($Launch) { Invoke-SetupNative 'npm.cmd' @('run', 'tauri', 'dev') }
}

# Dot-sourcing exposes functions for mock-only setup tests without running installs.
if ($MyInvocation.InvocationName -ne '.') {
    Push-Location $script:SetupRoot
    try { Invoke-AiditorSetup } catch { Write-Error $_ -ErrorAction Continue; exit 1 } finally { Pop-Location }
}
