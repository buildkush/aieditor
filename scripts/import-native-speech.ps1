[CmdletBinding()]
param([Parameter(Mandatory=$true)][string]$Source)
$ErrorActionPreference='Stop'
Import-Module (Join-Path $PSScriptRoot 'speech-transfer.psm1') -Force
Import-NativeSpeechTransfer -Source $Source | ConvertTo-Json -Depth 4
