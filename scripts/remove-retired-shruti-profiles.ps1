# Close Audio Lab first. Deletes only retired duplicate Shruti profiles and experiment sources.
$ErrorActionPreference = 'Stop'
$storageRoot = Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'com.aiditor.app/speech-lab'
$retiredPaths = @(
    'experimental-models/shruti-needle-3210'
    'experimental-models/shruti-fp32'
    'experimental-runtimes/shruti-needle-3210'
    'experimental-runtimes/shruti-fp32'
    'r/fp32'
)
$resolvedRoot = [IO.Path]::GetFullPath($storageRoot).TrimEnd('\') + '\'
$cleanupFailures = @()
foreach ($relativePath in $retiredPaths) {
    $targetPath = [IO.Path]::GetFullPath((Join-Path $storageRoot $relativePath))
    if (-not $targetPath.StartsWith($resolvedRoot, [StringComparison]::OrdinalIgnoreCase)) { throw 'Target escaped Speech Lab storage' }
    if (Test-Path -LiteralPath $targetPath) {
        try {
            $target = Get-Item -LiteralPath $targetPath -Force
            if ($target.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw "Refusing linked target: $targetPath" }
            Remove-Item -LiteralPath $targetPath -Recurse -Force
            Write-Host "Removed $targetPath"
        } catch {
            $cleanupFailures += $targetPath
            Write-Warning $_.Exception.Message
        }
    }
}
$repoRoot = [IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot)).TrimEnd('\') + '\'
$researchPath = [IO.Path]::GetFullPath((Join-Path $repoRoot 'speech-lab/research/shruti-variants'))
if (-not $researchPath.StartsWith($repoRoot, [StringComparison]::OrdinalIgnoreCase)) { throw 'Research cleanup escaped workspace' }
if (Test-Path -LiteralPath $researchPath) {
    try {
        $target = Get-Item -LiteralPath $researchPath -Force
        if ($target.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw "Refusing linked target: $researchPath" }
        Remove-Item -LiteralPath $researchPath -Recurse -Force
        Write-Host "Removed $researchPath"
    } catch { $cleanupFailures += $researchPath; Write-Warning $_.Exception.Message }
}
if ($cleanupFailures.Count) { throw ('Some folders remain: ' + ($cleanupFailures -join ', ')) }
Write-Host 'Cleanup complete. Canonical Shruti 3.2.10, Shunya INT8 and Whistle are retained.'
