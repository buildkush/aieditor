[CmdletBinding(SupportsShouldProcess=$true)]
param([switch]$CurrentOnly,[switch]$RemoveBuildInputs)
$ErrorActionPreference='Stop'
$repoRoot=[IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
$cacheRoot=[IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA 'com.aiditor.app/speech-lab'))
Import-Module (Join-Path $PSScriptRoot 'speech-transfer.psm1') -Force
if($CurrentOnly -or $RemoveBuildInputs){
    # Never remove the old fallback or conversion inputs before the new native
    # model and runtime have passed integrity checks.
    Test-SpeechTransferMetadata $cacheRoot
}
$targets=@(
    (Join-Path $repoRoot '.speech-lab-venv'),
    (Join-Path $cacheRoot 'experimental-models'),
    (Join-Path $cacheRoot 'experimental-runtimes'),
    (Join-Path $cacheRoot 'runtimes'),
    (Join-Path $cacheRoot 'r')
)
$modelsRoot=Join-Path $cacheRoot 'models'
$targets+=@('installed.json','manifest.json','needle-engine.whl','needle-runtime.zip' | ForEach-Object {Join-Path $modelsRoot "shruti/$_"})
$keep=@('shruti','preprocessing','tara-ct2-int8','ggml-tara-q5_0.bin','ggml-tara-q5_0.json')
$gpuInstalled=@('cuda','vulkan','metal' | Where-Object {Test-Path -LiteralPath (Join-Path $cacheRoot "runtime/$_/manifest.json")}).Count -gt 0
if(-not $CurrentOnly -or $gpuInstalled){$keep+=@('ggml-tara-q8_0.bin','ggml-tara-q8_0.json')}
if(Test-Path -LiteralPath $modelsRoot){
    $targets+=@(Get-ChildItem -LiteralPath $modelsRoot -Force | Where-Object {$_.Name -notin $keep} | Select-Object -ExpandProperty FullName)
}
if($RemoveBuildInputs){
    $targets+=@('tmp/tara-ct2-source','tmp/ct2-build-mkl','tmp/ctranslate2-src' | ForEach-Object {Join-Path $repoRoot $_})
}
$freed=0L
$lease=Get-SpeechTransferLease $cacheRoot
try{
foreach($target in $targets){
    $resolved=[IO.Path]::GetFullPath($target)
    if(-not($resolved.StartsWith($repoRoot+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase) -or $resolved.StartsWith($cacheRoot+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase))){throw "Unsafe cleanup target: $resolved"}
    if(-not(Test-Path -LiteralPath $resolved)){continue}
    $item=Get-Item -LiteralPath $resolved -Force
    if($item.Attributes -band [IO.FileAttributes]::ReparsePoint){throw "Refusing linked cleanup target: $resolved"}
    if($item.PSIsContainer){
        $queue=New-Object 'Collections.Generic.Queue[string]';$queue.Enqueue($resolved)
        while($queue.Count){foreach($child in Get-ChildItem -LiteralPath $queue.Dequeue() -Force){
            if($child.Attributes -band [IO.FileAttributes]::ReparsePoint){throw "Refusing nested linked cleanup target: $($child.FullName)"}
            if($child.PSIsContainer){$queue.Enqueue($child.FullName)}elseif($child.Extension -in @('.wav','.mp3','.m4a','.aac','.flac','.ogg','.mp4','.mov','.mkv','.webm','.avi','.m4v','.aiditor','.srt','.vtt')){
                throw "Refusing cleanup of a directory containing media/project data: $($child.FullName)"
            }
        }}
    }
    if($PSCmdlet.ShouldProcess($resolved,'Delete obsolete speech model/runtime/configuration')){
        $size=if($item.PSIsContainer){(Get-ChildItem -LiteralPath $resolved -Recurse -File -Force | Measure-Object -Property Length -Sum).Sum}else{$item.Length}
        Remove-Item -LiteralPath $resolved -Recurse -Force
        $freed+=$size
    }
}
}finally{$lease.Dispose()}
Write-Host ('Speech cleanup finished. Removed approximately {0:N2} GB. CT2, Shruti, optional Q5, runtime packs, recordings, projects, and benchmark evidence retained.' -f ($freed/1e9))
