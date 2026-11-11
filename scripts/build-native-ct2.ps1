[CmdletBinding()]
param(
    [ValidateSet('mkl','dnnl','ruy','accelerate')][string]$Backend='mkl',
    [string]$SourceDirectory,
    [string]$MklRoot,
    [switch]$DownloadBuildDependencies,
    [string]$ReleaseBaseUrl
)
$ErrorActionPreference='Stop'
$repo=Split-Path -Parent $PSScriptRoot
$work=Join-Path $repo "tmp/ct2-build-$Backend"
$payload=Join-Path $work 'payload'
New-Item -ItemType Directory -Force -Path $work,$payload | Out-Null
if($DownloadBuildDependencies){
    if($env:OS -ne 'Windows_NT' -or $Backend -ne 'mkl' -or [Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString() -ne 'X64'){throw 'Automatic build dependency preparation supports Windows x64 MKL only.'}
    $MklRoot=Join-Path $work 'mkl'
    $archives=Get-Content -LiteralPath (Join-Path $repo 'native/ct2/windows-mkl-build.json') -Raw | ConvertFrom-Json
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    foreach($package in $archives.packages){
        $archive=Join-Path $work $package.name
        if(-not(Test-Path -LiteralPath $archive) -or (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant() -ne $package.sha256){
            & curl.exe --fail --location --retry 3 --silent --show-error --output $archive $package.url
            if($LASTEXITCODE -ne 0){throw "Cannot download build input $($package.name)"}
        }
        if((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant() -ne $package.sha256){throw 'Build input checksum mismatch'}
        $zip=[IO.Compression.ZipFile]::OpenRead($archive)
        try {
            foreach($entry in $zip.Entries){
                if($entry.FullName -match '^[^/]+\.data/data/Library/(.+)$' -and $entry.Name){
                    $relative=$Matches[1]
                    $target=[IO.Path]::GetFullPath((Join-Path $MklRoot $relative))
                    $prefix=[IO.Path]::GetFullPath($MklRoot)+[IO.Path]::DirectorySeparatorChar
                    if(-not $target.StartsWith($prefix,[StringComparison]::OrdinalIgnoreCase)){throw 'Unsafe build archive member'}
                    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $target) | Out-Null
                    [IO.Compression.ZipFileExtensions]::ExtractToFile($entry,$target,$true)
                }
                if($entry.FullName -match '\.dist-info/(LICENSE[^/]*|COPYING[^/]*)$'){
                    $licenseDir=Join-Path $payload 'licenses'
                    New-Item -ItemType Directory -Force -Path $licenseDir | Out-Null
                    [IO.Compression.ZipFileExtensions]::ExtractToFile($entry,(Join-Path $licenseDir ($package.name+'-'+$entry.Name)),$true)
                }
            }
        } finally {$zip.Dispose()}
    }
}
$cmake=if($env:CMAKE){$env:CMAKE}else{'cmake'}
$arguments=@('-S',(Join-Path $repo 'native/ct2'),'-B',(Join-Path $work 'build'),'-DCMAKE_BUILD_TYPE=Release',"-DAIDITOR_CT2_BACKEND=$Backend")
if($SourceDirectory){
    $revision=& git -C $SourceDirectory rev-parse HEAD
    if($LASTEXITCODE -ne 0 -or $revision -ne '5de572ef60b67a0276c5989ee73d0072808ff4c3'){throw 'Unexpected CT2 source revision'}
    $arguments += '-DFETCHCONTENT_SOURCE_DIR_CTRANSLATE2='+[IO.Path]::GetFullPath($SourceDirectory)
}
if($MklRoot){$arguments += @("-DMKL_ROOT=$MklRoot","-DIOMP5_LIBRARY=$MklRoot/lib/libiomp5md.lib")}
if($env:CMAKE_GENERATOR){$arguments += @('-G',$env:CMAKE_GENERATOR)}
if($env:CMAKE_MAKE_PROGRAM){$arguments += '-DCMAKE_MAKE_PROGRAM='+$env:CMAKE_MAKE_PROGRAM}
if($Backend -ne 'mkl'){$arguments += '-DOPENMP_RUNTIME=COMP'}
& $cmake @arguments
if($LASTEXITCODE -ne 0){throw 'CT2 configuration failed'}
& $cmake --build (Join-Path $work 'build') --config Release --target aiditor_ct2 aiditor_ct2_probe --parallel 4
if($LASTEXITCODE -ne 0){throw 'CT2 native bridge build failed'}
$originalSearchPath=$env:PATH
try {
    if($MklRoot){$env:PATH=(Join-Path $MklRoot 'bin')+[IO.Path]::PathSeparator+$env:PATH}
    $probe=Join-Path $work 'build/aiditor_ct2_probe.exe'
    if(-not(Test-Path -LiteralPath $probe)){$probe=Join-Path $work 'build/Release/aiditor_ct2_probe.exe'}
    if($env:OS -ne 'Windows_NT'){$probe=Join-Path $work 'build/aiditor_ct2_probe'}
    # The upstream DLL is in its sub-build directory on Windows.
    $env:PATH=(Join-Path $work 'build/_deps/ctranslate2-build')+[IO.Path]::PathSeparator+$env:PATH
    & $probe
    if($LASTEXITCODE -ne 0){throw 'Compiled Tara context/prompt probe failed'}
} finally {$env:PATH=$originalSearchPath}
& $cmake --install (Join-Path $work 'build') --config Release --prefix $payload
if($LASTEXITCODE -ne 0){throw 'CT2 pack installation failed'}
if($Backend -eq 'mkl'){
    Get-ChildItem -LiteralPath (Join-Path $MklRoot 'bin') -File | Where-Object { $_.Name -like 'mkl*.dll' -and $_.Name -notmatch '(tbb|blacs|scalapack)' -or $_.Name -eq 'libiomp5md.dll' } | ForEach-Object {
        Copy-Item -LiteralPath $_.FullName -Destination $payload -Force
    }
}
Copy-Item -LiteralPath (Join-Path $repo 'native/ct2/README.md') -Destination $payload -Force
$licenseDir=Join-Path $payload 'licenses'
New-Item -ItemType Directory -Force -Path $licenseDir | Out-Null
$actualSourceDirectory=if($SourceDirectory){$SourceDirectory}else{Join-Path $work 'build/_deps/ctranslate2-src'}
if(Test-Path -LiteralPath $actualSourceDirectory){
    foreach($entry in @(@('LICENSE','CTranslate2-LICENSE'),@('third_party/cpu_features/LICENSE','cpu_features-LICENSE'),@('third_party/spdlog/LICENSE','spdlog-LICENSE'),@('third_party/ruy/LICENSE','ruy-LICENSE'))){
        $source=Join-Path $actualSourceDirectory $entry[0]
        if(Test-Path -LiteralPath $source){Copy-Item -LiteralPath $source -Destination (Join-Path $licenseDir $entry[1]) -Force}
    }
}
$platform=if($env:OS -eq 'Windows_NT'){'windows-x86_64'}elseif((uname -s) -eq 'Darwin'){
    $arch=if((uname -m) -eq 'arm64'){'aarch64'}else{'x86_64'}
    'macos-'+$arch
}else{'linux-'+(uname -m)}
$files=@(Get-ChildItem -LiteralPath $payload -Recurse -File | Where-Object Name -ne 'manifest.json' | ForEach-Object {
    @{name=$_.FullName.Substring($payload.Length+1).Replace('\','/');size=$_.Length;sha256=(Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()}
})
$manifest=@{abi='aiditor-ct2-4.8.4-tara-v1';backend='ct2-cpu';platform=$platform;engine='ctranslate2';version='4.8.4';cpuBackend=$Backend;files=$files}
if($ReleaseBaseUrl){
    $archive=Join-Path $work "aiditor-ct2-cpu-$platform-$Backend.zip"
    Compress-Archive -Path (Join-Path $payload '*') -DestinationPath $archive -Force
    $manifest.archive=@{url=$ReleaseBaseUrl.TrimEnd('/')+'/'+(Split-Path -Leaf $archive);size=(Get-Item -LiteralPath $archive).Length;sha256=(Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant()}
}
[IO.File]::WriteAllText((Join-Path $payload 'manifest.json'),($manifest | ConvertTo-Json -Depth 8),(New-Object Text.UTF8Encoding($false)))
Write-Host "Native CT2 pack created: $payload"
Write-Host "Import locally: aiditor runtime import `"$payload`". Test before publishing or selecting production defaults."
