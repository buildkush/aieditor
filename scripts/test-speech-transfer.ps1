$ErrorActionPreference='Stop'
Import-Module (Join-Path $PSScriptRoot 'speech-transfer.psm1') -Force
function Expect-TransferFailure([scriptblock]$Action){
    $failed=$false;try{& $Action | Out-Null}catch{$failed=$true}
    if(-not $failed){throw 'Expected transfer validation failure'}
}
$root=Join-Path ([IO.Path]::GetTempPath()) ('aiditor-transfer-test-'+[Guid]::NewGuid().ToString('N'))
[IO.Directory]::CreateDirectory($root) | Out-Null
foreach($bad in @('../model.bin','models/tara-ct2-int8/../../project.aiditor','C:/model.bin','runtime\ct2-cpu\test.dll','audio/recording.wav','models/ggml-tara-q5_0.bin')){
    Expect-TransferFailure {Resolve-SpeechTransferPath $root $bad}
}
$source=Join-Path $root 'source.txt'
[IO.File]::WriteAllText($source,'verified fixture')
$size=(Get-Item -LiteralPath $source).Length;$hash=(Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash
$target=Resolve-SpeechTransferPath $root 'models/tara-ct2-int8/config.json'
if(-not(Copy-SpeechTransferFile $source $target $size $hash)){throw 'Initial verified copy was skipped'}
if(Copy-SpeechTransferFile $source $target $size $hash){throw 'An unchanged verified file was copied again'}
[IO.File]::WriteAllText($source,'tampered fixture')
Expect-TransferFailure {Copy-SpeechTransferFile $source $target $size $hash}
if([IO.File]::ReadAllText($target) -ne 'verified fixture'){throw 'A tampered source changed the destination'}
$newSize=(Get-Item -LiteralPath $source).Length;$newHash=(Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash
if(-not(Copy-SpeechTransferFile $source $target $newSize $newHash)){throw 'Verified replacement was not applied'}
if([IO.File]::ReadAllText($target) -ne 'tampered fixture'){throw 'Atomic replacement did not preserve the verified bytes'}
Write-Host "Speech transfer path, checksum, cache reuse, and atomic replacement checks passed. Tiny fixtures: $root"
