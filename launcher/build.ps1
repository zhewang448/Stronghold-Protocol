[CmdletBinding()]
param([string]$OutputDirectory = '')
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
if (-not $OutputDirectory) { $OutputDirectory = Join-Path $projectRoot 'dist/launcher-win-x64' }
& dotnet publish (Join-Path $PSScriptRoot 'StrongholdProtocolLauncher.csproj') -c Release -o $OutputDirectory --source https://api.nuget.org/v3/index.json --nologo
if ($LASTEXITCODE -ne 0) { throw 'Launcher publish failed.' }
$executable = Join-Path $OutputDirectory 'StrongholdProtocolLauncher.exe'
Get-Item -LiteralPath $executable | Select-Object FullName,Length
Get-FileHash -LiteralPath $executable -Algorithm SHA256
