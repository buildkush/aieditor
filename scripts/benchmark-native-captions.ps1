[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)][ValidateScript({Test-Path -LiteralPath $_ -PathType Leaf})][string]$InputPath,
    [ValidateSet('tara','tara-q5_0','shruti')][string]$Model='tara',
    [ValidateSet('auto','cpu','cuda','vulkan','metal')][string]$Device='auto',
    [ValidateSet('auto','ctranslate2','whisper-cpp')][string]$Engine='auto',
    [ValidateSet('hi','en','auto')][string]$Language='hi',
    [ValidateRange(0,86400)][double]$MaxSeconds=0,
    [switch]$RequireCuda,
    [ValidateSet('any','cpu','cuda','vulkan','metal')][string]$RequiredDevice='any',
    [ValidateRange(1,10)][int]$Runs=1,
    [string]$CliPath,
    [string]$OutputDirectory
)
$ErrorActionPreference='Stop'

function Assert-BenchmarkBackend {
    param($Transcript,[string]$WantedEngine='auto',[string]$WantedDevice='any')
    $metadata=$Transcript.processingMetadata
    if($WantedEngine -ne 'auto' -and $metadata.inferenceEngine -ne $WantedEngine){
        throw "Requested engine $WantedEngine, but the run used $($metadata.inferenceEngine)."
    }
    if($WantedDevice -ne 'any' -and $metadata.device -ne $WantedDevice){
        throw "Required $WantedDevice, but the run used $($metadata.device). Fallback: $($metadata.fallback)"
    }
    if($metadata.device -in @('cuda','vulkan','metal') -and $metadata.nativeProfile.gpuModelBuffers -ne $true){
        throw 'The run did not confirm GPU-resident model buffers. Do not count it as a GPU benchmark.'
    }
}

function Invoke-NativeCaptionBenchmark {
    $previousConsoleEncoding=[Console]::OutputEncoding
    try {
    # Native JSON is UTF-8, including on Windows PowerShell 5.1.
    [Console]::OutputEncoding=New-Object Text.UTF8Encoding($false)
    $repoRoot=Split-Path -Parent $PSScriptRoot
    $cli=if($CliPath){(Resolve-Path -LiteralPath $CliPath).Path}else{Join-Path $repoRoot 'native/speech/target/release/aiditor.exe'}
    if(-not(Test-Path -LiteralPath $cli)){throw 'Build the native release CLI with setup.cmd, or pass -CliPath to a copied compatible CLI.'}
    $source=(Resolve-Path -LiteralPath $InputPath).Path
    $before=(Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash
    $folder=if($OutputDirectory){[IO.Path]::GetFullPath($OutputDirectory)}else{Join-Path $env:LOCALAPPDATA 'com.aiditor.app/speech-lab/benchmarks'}
    $wanted=$RequiredDevice
    if($RequireCuda){
        if($wanted -notin @('any','cuda')){throw '-RequireCuda conflicts with -RequiredDevice.'}
        $wanted='cuda'
    }
    if($wanted -eq 'any' -and $Device -ne 'auto'){$wanted=$Device}
    if($Device -eq 'cpu' -and $wanted -in @('cuda','vulkan','metal')){throw 'A CPU-only request cannot satisfy a required GPU device.'}
    if($Engine -eq 'ctranslate2' -and ($Device -notin @('auto','cpu') -or $wanted -in @('cuda','vulkan','metal'))){throw 'The current CT2 pack is CPU-only.'}
    $hardwareOutput=& $cli hardware
    if($LASTEXITCODE -ne 0){throw 'Native hardware detection failed.'}
    $hardware=($hardwareOutput -join "`n") | ConvertFrom-Json
    # Reject an obviously missing GPU pack before spending minutes on a CPU fallback.
    $gpu=if($wanted -in @('cuda','vulkan','metal')){$wanted}elseif($Device -in @('cuda','vulkan','metal')){$Device}else{$null}
    if($gpu){
        $manifest=Join-Path $env:LOCALAPPDATA "com.aiditor.app/speech-lab/runtime/$gpu/manifest.json"
        if(-not(Test-Path -LiteralPath $manifest)){throw "No $gpu runtime pack is installed. Install a compatible verified pack before GPU benchmarking; the base CLI alone uses CPU."}
        if($gpu -eq 'cuda' -and ($null -eq $hardware.cuda.devices -or @($hardware.cuda.devices).Count -eq 0)){throw 'The CUDA driver probe found no usable device.'}
    }
    New-Item -ItemType Directory -Force -Path $folder | Out-Null
    $machine=if($env:OS -eq 'Windows_NT'){
        @(Get-CimInstance Win32_Processor | Select-Object Name,NumberOfCores,NumberOfLogicalProcessors)
    }else{@()}
    $batchId=[Guid]::NewGuid().ToString('N')
    $summaries=@()
    for($iteration=1;$iteration -le $Runs;$iteration++){
        $runId="$batchId-$iteration"
        $diagnostics=Join-Path $folder "$runId.log"
        $timer=[Diagnostics.Stopwatch]::StartNew()
        $previousPreference=$ErrorActionPreference
        $ErrorActionPreference='Continue' # Windows PowerShell 5 wraps redirected native stderr as error records.
        try {
            $output=& $cli transcribe $source --model $Model --device $Device --engine $Engine --language $Language --output-format json 2>$diagnostics
            $code=$LASTEXITCODE
        } finally { $ErrorActionPreference=$previousPreference }
        $timer.Stop()
        if($code -ne 0){throw "Native transcription failed. Diagnostics: $diagnostics"}
        $transcript=($output -join "`n") | ConvertFrom-Json
        $after=(Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash
        if($before -ne $after){throw 'Source immutability check failed.'}
        $resultPath=Join-Path $folder "$runId.json"
        [IO.File]::WriteAllText($resultPath,($output -join "`n"),(New-Object Text.UTF8Encoding($false)))
        # Retain the transcript and diagnostics even when qualification fails.
        Assert-BenchmarkBackend -Transcript $transcript -WantedEngine $Engine -WantedDevice $wanted
        $metadata=$transcript.processingMetadata
        $summary=[ordered]@{
            iteration=$iteration;model=$Model;requestedEngine=$Engine;reportedEngine=$metadata.inferenceEngine
            reportedDevice=$metadata.device;computeType=$metadata.computeType
            wallSeconds=$timer.Elapsed.TotalSeconds;processingSeconds=$metadata.processingSec
            inferenceSeconds=$metadata.inferenceSec;audioSeconds=$transcript.source.duration
            audioSha256=$transcript.source.audioSha256;inputSha256=$before
            wordCount=@($transcript.words).Count;sourceUnchanged=$true
            meetsTimeTarget=if($MaxSeconds -gt 0){$timer.Elapsed.TotalSeconds -lt $MaxSeconds}else{$null}
            fallback=$metadata.fallback;nativeProfile=$metadata.nativeProfile
            transcriptPath=$resultPath;diagnosticsPath=$diagnostics
        }
        $summaries+=,$summary
        if($MaxSeconds -gt 0 -and -not $summary.meetsTimeTarget){throw "Transcription exceeded the explicit $MaxSeconds second target. Transcript: $resultPath"}
    }
    $report=[ordered]@{batchId=$batchId;machine=$machine;hardware=$hardware;runs=$summaries;
        note='Each run starts a fresh CLI/model context. Later runs may benefit from OS disk caches. CPU and GPU engines/precision can differ; compare transcript and timestamp quality too. GPU buffer evidence does not replace utilization telemetry.'}
    $reportPath=Join-Path $folder "$batchId-summary.json"
    $report.reportPath=$reportPath
    [IO.File]::WriteAllText($reportPath,($report | ConvertTo-Json -Depth 18),(New-Object Text.UTF8Encoding($false)))
    $report | ConvertTo-Json -Depth 18
    } finally { [Console]::OutputEncoding=$previousConsoleEncoding }
}

# Dot-sourcing makes the backend qualification checks testable without inference.
if($MyInvocation.InvocationName -ne '.') { Invoke-NativeCaptionBenchmark }
