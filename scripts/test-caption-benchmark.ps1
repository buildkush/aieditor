# Backend qualification tests; no model, GPU, Python, or transcription required.
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'benchmark-native-captions.ps1') -InputPath $PSCommandPath
function Expect-Rejected([scriptblock]$Action){
    $rejected=$false
    try{& $Action}catch{$rejected=$true}
    if(-not $rejected){throw 'Expected backend qualification to reject this result.'}
}
$cpu=[pscustomobject]@{processingMetadata=[pscustomobject]@{
    device='cpu';inferenceEngine='ctranslate2';fallback=$null;nativeProfile=$null
}}
Assert-BenchmarkBackend $cpu 'ctranslate2' 'cpu'
Expect-Rejected {Assert-BenchmarkBackend $cpu 'whisper-cpp' 'cpu'}
Expect-Rejected {Assert-BenchmarkBackend $cpu 'auto' 'cuda'}
$gpu=[pscustomobject]@{processingMetadata=[pscustomobject]@{
    device='cuda';inferenceEngine='whisper-cpp';fallback=$null;nativeProfile=[pscustomobject]@{gpuModelBuffers=$false}
}}
Expect-Rejected {Assert-BenchmarkBackend $gpu 'whisper-cpp' 'cuda'}
$gpu.processingMetadata.nativeProfile.gpuModelBuffers=$true
Assert-BenchmarkBackend $gpu 'whisper-cpp' 'cuda'
$gpu.processingMetadata.device='vulkan'
Expect-Rejected {Assert-BenchmarkBackend $gpu 'whisper-cpp' 'cuda'}
Assert-BenchmarkBackend $gpu 'whisper-cpp' 'vulkan'
Write-Host 'Caption benchmark backend qualification passed: engine mismatch, CPU fallback, GPU proof, and device selection.'
