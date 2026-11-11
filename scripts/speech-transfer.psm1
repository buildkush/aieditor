Set-StrictMode -Version 2
$ErrorActionPreference='Stop'
$script:SpeechAbi='aiditor-ct2-4.8.4-tara-v1'
$script:TaraRevision='4dd4782d65ed8c9690b52478e4419d577fff40be'

function Get-SpeechCacheRoot {
    if($env:OS -ne 'Windows_NT' -or -not [Environment]::Is64BitProcess){throw 'This transfer helper targets Windows x64.'}
    Join-Path $env:LOCALAPPDATA 'com.aiditor.app/speech-lab'
}
function Resolve-SpeechTransferPath {
    param([string]$Root,[string]$Relative)
    if(-not $Relative -or $Relative -match '[:\\\x00]' -or ($Relative -split '/' | Where-Object {$_ -in @('','.', '..')})){
        throw "Unsafe transfer path: $Relative"
    }
    $allowed=$Relative -match '^models/tara-ct2-int8/(model\.bin|config\.json|vocabulary\.json|installed\.json|README\.tara\.md)$' -or
        $Relative -eq 'models/preprocessing/silero-v5.1.2.bin' -or $Relative -match '^runtime/ct2-cpu/.+'
    if(-not $allowed){throw "Transfer cannot write projects, recordings, or unrelated models: $Relative"}
    $rootFull=[IO.Path]::GetFullPath($Root).TrimEnd([IO.Path]::DirectorySeparatorChar)
    $target=[IO.Path]::GetFullPath((Join-Path $rootFull $Relative))
    if(-not $target.StartsWith($rootFull+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)){throw 'Transfer path escaped its root'}
    $cursor=$rootFull
    foreach($part in @('')+@($Relative -split '/')){
        if($part){$cursor=Join-Path $cursor $part}
        if((Test-Path -LiteralPath $cursor) -and ((Get-Item -LiteralPath $cursor -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)){
            throw "Transfer refuses linked paths: $cursor"
        }
    }
    $target
}
function Test-SpeechTransferFile {
    param([string]$Path,[long]$Size,[string]$Sha256)
    if($Sha256 -notmatch '^[a-fA-F0-9]{64}$' -or -not(Test-Path -LiteralPath $Path -PathType Leaf)){return $false}
    (Get-Item -LiteralPath $Path).Length -eq $Size -and (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash -eq $Sha256
}
function Copy-SpeechTransferFile {
    param([string]$Source,[string]$Target,[long]$Size,[string]$Sha256)
    if(-not(Test-SpeechTransferFile $Source $Size $Sha256)){throw "Transfer source checksum/size mismatch: $Source"}
    if(Test-SpeechTransferFile $Target $Size $Sha256){return $false}
    [IO.Directory]::CreateDirectory((Split-Path -Parent $Target)) | Out-Null
    $part=$Target+'.transfer.part'
    [IO.File]::Copy($Source,$part,$true)
    if(-not(Test-SpeechTransferFile $part $Size $Sha256)){throw "Transfer copy verification failed: $Target"}
    if(Test-Path -LiteralPath $Target){[IO.File]::Replace($part,$Target,[System.Management.Automation.Language.NullString]::Value)}else{[IO.File]::Move($part,$Target)}
    $true
}
function Get-SpeechTransferLease {
    param([string]$Root)
    [IO.Directory]::CreateDirectory($Root) | Out-Null
    $stream=New-Object IO.FileStream((Join-Path $Root 'speech-inference.lock'),[IO.FileMode]::OpenOrCreate,[IO.FileAccess]::ReadWrite,[IO.FileShare]::ReadWrite)
    try{$stream.Lock(0,1)}catch{$stream.Dispose();throw 'Close aiditor and active speech jobs before transferring model/runtime files.'}
    $stream
}
function Test-SpeechTransferMetadata {
    param([string]$Root)
    $model=Get-Content -LiteralPath (Join-Path $Root 'models/tara-ct2-int8/installed.json') -Raw | ConvertFrom-Json
    $runtime=Get-Content -LiteralPath (Join-Path $Root 'runtime/ct2-cpu/manifest.json') -Raw | ConvertFrom-Json
    if($model.format -ne 'aiditor-tara-ct2-v1' -or $model.sourceRevision -ne $script:TaraRevision -or
        $model.computeType -ne 'int8_float32' -or $model.mixedcodeToken -ne 51866 -or $model.nMels -ne 128){throw 'Unsupported native Tara artifact. Original Python/GGML files cannot substitute for this CT2 artifact.'}
    if($runtime.abi -ne $script:SpeechAbi -or $runtime.backend -ne 'ct2-cpu' -or $runtime.platform -ne 'windows-x86_64'){
        throw 'Native CT2 runtime version/platform does not match this build.'
    }
    foreach($section in @(@{prefix='models/tara-ct2-int8/';files=@($model.files)},@{prefix='runtime/ct2-cpu/';files=@($runtime.files)})){
        foreach($file in $section.files){
            $path=Resolve-SpeechTransferPath $Root ($section.prefix+$file.name)
            if(-not(Test-SpeechTransferFile $path $file.size $file.sha256)){throw "Native asset checksum mismatch: $path"}
        }
    }
}
function Export-NativeSpeechTransfer {
    param([string]$Destination,[string]$CacheRoot=(Get-SpeechCacheRoot))
    $source=[IO.Path]::GetFullPath($CacheRoot)
    $output=[IO.Path]::GetFullPath($Destination)
    if($output.StartsWith($source+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase) -or $output -eq $source){throw 'Place the transfer folder outside the live speech cache.'}
    if((Test-Path -LiteralPath $output) -and @(Get-ChildItem -LiteralPath $output -Force).Count){throw 'Choose a new or empty transfer folder; existing files are never deleted.'}
    $lease=Get-SpeechTransferLease $source
    try{
        Test-SpeechTransferMetadata $source
        $model=Get-Content -LiteralPath (Join-Path $source 'models/tara-ct2-int8/installed.json') -Raw | ConvertFrom-Json
        $runtime=Get-Content -LiteralPath (Join-Path $source 'runtime/ct2-cpu/manifest.json') -Raw | ConvertFrom-Json
        $names=@('models/tara-ct2-int8/installed.json','runtime/ct2-cpu/manifest.json','models/preprocessing/silero-v5.1.2.bin')
        $names+=@($model.files | ForEach-Object {'models/tara-ct2-int8/'+$_.name})
        $names+=@($runtime.files | ForEach-Object {'runtime/ct2-cpu/'+$_.name})
        if(Test-Path -LiteralPath (Join-Path $source 'models/tara-ct2-int8/README.tara.md')){$names+='models/tara-ct2-int8/README.tara.md'}
        $files=@()
        foreach($name in ($names | Sort-Object -Unique)){
            $from=Resolve-SpeechTransferPath $source $name
            $to=Resolve-SpeechTransferPath $output $name
            $size=(Get-Item -LiteralPath $from).Length
            $sha=(Get-FileHash -LiteralPath $from -Algorithm SHA256).Hash.ToLowerInvariant()
            Copy-SpeechTransferFile $from $to $size $sha | Out-Null
            $files+=@{name=$name;size=$size;sha256=$sha}
        }
        $manifest=[ordered]@{format='aiditor-native-speech-transfer-v1';platform='windows-x86_64';runtimeAbi=$script:SpeechAbi;modelRevision=$script:TaraRevision;files=$files}
        [IO.File]::WriteAllText((Join-Path $output 'bundle-manifest.json'),($manifest | ConvertTo-Json -Depth 8),(New-Object Text.UTF8Encoding($false)))
        [pscustomobject]@{bundlePath=$output;files=$files.Count;totalBytes=($files|Measure-Object size -Sum).Sum;includes='Tara CT2 INT8, native CPU runtime, preprocessing only; no media, projects, Python, GGML Q8/Q5 or build tools.'}
    }finally{$lease.Dispose()}
}
function Import-NativeSpeechTransfer {
    param([string]$Source,[string]$CacheRoot=(Get-SpeechCacheRoot))
    $sourceRoot=(Resolve-Path -LiteralPath $Source).Path
    $manifest=Get-Content -LiteralPath (Join-Path $sourceRoot 'bundle-manifest.json') -Raw | ConvertFrom-Json
    if($manifest.format -ne 'aiditor-native-speech-transfer-v1' -or $manifest.platform -ne 'windows-x86_64' -or
        $manifest.runtimeAbi -ne $script:SpeechAbi -or $manifest.modelRevision -ne $script:TaraRevision){throw 'Transfer bundle is not compatible with this native build.'}
    $seen=@{}
    foreach($file in $manifest.files){
        $path=Resolve-SpeechTransferPath $sourceRoot $file.name
        if($seen.ContainsKey($file.name)){throw 'Duplicate transfer member'};$seen[$file.name]=$true
        if(-not(Test-SpeechTransferFile $path $file.size $file.sha256)){throw "Transfer checksum/size mismatch: $($file.name). No active files were changed."}
    }
    foreach($required in @('models/tara-ct2-int8/installed.json','models/tara-ct2-int8/model.bin','models/tara-ct2-int8/config.json','models/tara-ct2-int8/vocabulary.json','models/preprocessing/silero-v5.1.2.bin','runtime/ct2-cpu/manifest.json','runtime/ct2-cpu/aiditor_ct2.dll','runtime/ct2-cpu/ctranslate2.dll')){
        if(-not $seen.ContainsKey($required)){throw "Incomplete transfer bundle: $required"}
    }
    Test-SpeechTransferMetadata $sourceRoot
    # Every manifest member must actually be included in the handoff list.
    foreach($entry in @(@{name='models/tara-ct2-int8/installed.json';prefix='models/tara-ct2-int8/'},@{name='runtime/ct2-cpu/manifest.json';prefix='runtime/ct2-cpu/'})){
        $metadata=Get-Content -LiteralPath (Join-Path $sourceRoot $entry.name) -Raw | ConvertFrom-Json
        foreach($file in $metadata.files){if(-not $seen.ContainsKey($entry.prefix+$file.name)){throw 'Transfer omitted a declared runtime/model dependency'}}
    }
    $lease=Get-SpeechTransferLease $CacheRoot
    try{
        $copied=0;$skipped=0
        # Ready markers are committed after all payloads have verified successfully.
        $ordered=@($manifest.files | Sort-Object @{Expression={if($_.name -in @('models/tara-ct2-int8/installed.json','runtime/ct2-cpu/manifest.json')){1}else{0}}},name)
        foreach($file in $ordered){
            $from=Resolve-SpeechTransferPath $sourceRoot $file.name
            $to=Resolve-SpeechTransferPath $CacheRoot $file.name
            if(Copy-SpeechTransferFile $from $to $file.size $file.sha256){$copied++}else{$skipped++}
        }
        [pscustomobject]@{cacheRoot=[IO.Path]::GetFullPath($CacheRoot);copiedFiles=$copied;reusedFiles=$skipped;downloads=0}
    }finally{$lease.Dispose()}
}
Export-ModuleMember -Function Get-SpeechCacheRoot,Resolve-SpeechTransferPath,Test-SpeechTransferFile,Copy-SpeechTransferFile,Get-SpeechTransferLease,Test-SpeechTransferMetadata,Export-NativeSpeechTransfer,Import-NativeSpeechTransfer
