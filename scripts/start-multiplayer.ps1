param(
  [ValidateRange(1024, 65535)][int]$Port = 3188,
  [ValidateRange(1024, 65535)][int]$AdminPort = 3288,
  [string]$BindAddress = '127.0.0.1'
)
$ErrorActionPreference = 'Stop'
if ($Port -in 3000,3100 -or $AdminPort -in 3000,3100 -or $Port -eq $AdminPort) {
  throw 'Experimental servers must use separate ports, excluding 3000 and 3100.'
}
$root = Split-Path -Parent $PSScriptRoot
foreach ($candidate in @($Port, $AdminPort)) {
  if (Get-NetTCPConnection -State Listen -LocalPort $candidate -ErrorAction SilentlyContinue) {
    throw "Port $candidate is already in use; no process has been stopped."
  }
}
$env:PORT = [string]$Port
$env:HOST = $BindAddress
$env:SP_ADMIN_PORT = [string]$AdminPort
Push-Location $root
try { & node server/index.js; exit $LASTEXITCODE }
finally { Pop-Location }
