# Run locally after closing Audio Lab. Keeps recordings, reports and retained models.
$ErrorActionPreference = 'Stop'
$storageRoot = Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'com.aiditor.app/speech-lab'
$retiredPaths = @(
    'models/small'
    'models/large-v3-turbo'
    'models/tiny-hinglish'
    'models/srota'
    'models/shunya'
    'runtimes/srota'
    'runtimes/shunya'
    'experiments/cpu-hinglish-2026-11-04/srota-native-hf'
    'experiments/cpu-hinglish-2026-11-04/srota-native-hf-tied-alias'
    'experiments/cpu-hinglish-2026-11-04/direct-hf-overlay'
)
$resolvedRoot = [IO.Path]::GetFullPath($storageRoot).TrimEnd('\') + '\'
foreach ($relativePath in $retiredPaths) {
    $targetPath = [IO.Path]::GetFullPath((Join-Path $storageRoot $relativePath))
    if (-not $targetPath.StartsWith($resolvedRoot, [StringComparison]::OrdinalIgnoreCase)) { throw 'Target escaped Speech Lab storage' }
    if (Test-Path -LiteralPath $targetPath) {
        $target = Get-Item -LiteralPath $targetPath -Force
        if ($target.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw "Refusing linked target: $targetPath" }
        Remove-Item -LiteralPath $targetPath -Recurse -Force
        Write-Host "Removed $targetPath"
    }
}
Write-Host 'Cleanup complete. Shruti, Shunya and Whistle are retained.'
