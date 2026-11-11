[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)][ValidateSet('Cuda','Vulkan','Metal')][string]$Backend,
    [Parameter(Mandatory=$true)][ValidatePattern('^https://')][string]$ReleaseBaseUrl
)
$ErrorActionPreference='Stop'
$buildRoot=Split-Path -Parent $PSScriptRoot
$backendName=$Backend.ToLowerInvariant()
if($Backend -eq 'Cuda' -and (-not $env:CUDA_PATH)){throw 'Pack builders need a CUDA 12 toolkit. End users need only the resulting runtime pack.'}
if($Backend -eq 'Vulkan' -and (-not $env:VULKAN_SDK)){throw 'Pack builders need the Vulkan SDK. End users use their display driver.'}
if($Backend -eq 'Metal' -and (($env:OS -eq 'Windows_NT') -or (uname -s) -ne 'Darwin')){throw 'Metal packs must be built on macOS.'}
$platform=if($env:OS -eq 'Windows_NT'){'windows-x86_64'}elseif((uname -s) -eq 'Darwin'){
    $arch=if((uname -m) -eq 'arm64'){'aarch64'}else{'x86_64'}
    'macos-'+$arch
}else{'linux-'+(uname -m)}
$plugin=if($env:OS -eq 'Windows_NT'){'aiditor_speech.dll'}elseif($platform -like 'macos-*'){'libaiditor_speech.dylib'}else{'libaiditor_speech.so'}
$target=Join-Path $buildRoot "native/speech/target/pack-$backendName"
$payload=Join-Path $target 'payload'
New-Item -ItemType Directory -Force $payload | Out-Null
Push-Location $buildRoot
try {
    & cargo.exe build --release --locked --manifest-path (Join-Path $buildRoot 'native/speech/Cargo.toml') --lib --features $backendName --target-dir $target
    if($LASTEXITCODE -ne 0){throw 'GPU plugin build failed'}
} finally { Pop-Location }
Copy-Item -LiteralPath (Join-Path $target "release/$plugin") -Destination $payload -Force
if($Backend -eq 'Cuda'){
    if($env:OS -ne 'Windows_NT'){throw 'Linux CUDA redistribution needs a platform-specific library manifest; do not publish an incomplete pack.'}
    foreach($name in @('cublas64_12.dll','cublasLt64_12.dll','cudart64_12.dll')){
        $source=Join-Path $env:CUDA_PATH "bin/$name"
        if(-not(Test-Path -LiteralPath $source)){throw "Missing CUDA 12 runtime: $source"}
        Copy-Item -LiteralPath $source -Destination $payload -Force
    }
}
$files=@(Get-ChildItem -LiteralPath $payload -File | ForEach-Object {
    @{name=$_.Name;size=$_.Length;sha256=(Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()}
})
$archive=Join-Path $target "aiditor-$backendName-$platform.zip"
Compress-Archive -Path (Join-Path $payload '*') -DestinationPath $archive -Force
$archiveInfo=Get-Item -LiteralPath $archive
$manifest=@{abi='aiditor-whisper-rs-0.16-tara-v1';backend=$backendName;platform=$platform;files=$files;
    archive=@{url=$ReleaseBaseUrl.TrimEnd('/')+'/'+$archiveInfo.Name;size=$archiveInfo.Length;sha256=(Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant()}}
[IO.File]::WriteAllText((Join-Path $target 'manifest.json'), ($manifest | ConvertTo-Json -Depth 6), (New-Object Text.UTF8Encoding($false)))
Write-Host "Pack created in $target. Test it on matching hardware, publish it, then pin its manifest in native/speech/runtime-packs.json."
