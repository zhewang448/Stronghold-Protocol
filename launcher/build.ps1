[CmdletBinding()]
param([string]$OutputDirectory = '')
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
if (-not $OutputDirectory) { $OutputDirectory = Join-Path $projectRoot 'dist/launcher-win-x64' }
& dotnet publish (Join-Path $PSScriptRoot 'StrongholdProtocolLauncher.csproj') -c Release -o $OutputDirectory --source https://api.nuget.org/v3/index.json --nologo
if ($LASTEXITCODE -ne 0) { throw 'Launcher publish failed.' }
$executable = Join-Path $OutputDirectory 'StrongholdProtocolLauncher.exe'
if (-not (Test-Path -LiteralPath $executable)) { throw 'Launcher executable missing.' }
[xml]$project = Get-Content -Raw -LiteralPath (Join-Path $PSScriptRoot 'StrongholdProtocolLauncher.csproj')
$launcherVersion = [string]$project.Project.PropertyGroup.Version
if ($launcherVersion -notmatch '^\d+\.\d+\.\d+$') { throw 'Invalid launcher version.' }
$releaseName = "StrongholdProtocolLauncher-v$launcherVersion-win-x64"
$releaseDirectory = Join-Path $projectRoot "dist/$releaseName"
New-Item -ItemType Directory -Force -Path $releaseDirectory | Out-Null
Copy-Item -LiteralPath $executable -Destination (Join-Path $releaseDirectory 'StrongholdProtocolLauncher.exe')
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'README.md') -Destination (Join-Path $releaseDirectory 'README.md')
$archive = Join-Path $projectRoot "dist/$releaseName.zip"
Compress-Archive -Path (Join-Path $releaseDirectory '*') -DestinationPath $archive -Force
Get-Item -LiteralPath $archive | Select-Object FullName,Length
Get-Item -LiteralPath $executable | Select-Object FullName,Length
Get-FileHash -LiteralPath $executable -Algorithm SHA256
