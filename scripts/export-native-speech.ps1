[CmdletBinding()]
param([Parameter(Mandatory=$true)][string]$Destination)
$ErrorActionPreference='Stop'
Import-Module (Join-Path $PSScriptRoot 'speech-transfer.psm1') -Force
Export-NativeSpeechTransfer -Destination $Destination | ConvertTo-Json -Depth 4
