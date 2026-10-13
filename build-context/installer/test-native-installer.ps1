[CmdletBinding()]
param([Parameter(Mandatory)][string]$Setup, [Parameter(Mandatory)][string]$TestRoot)
$ErrorActionPreference = 'Stop'
$Setup = (Resolve-Path $Setup).Path
$previousPath = $env:PATH
$legacy = Join-Path $env:LOCALAPPDATA 'KAW-ATS-Companion'
if (Test-Path $legacy) { throw 'Smoke tests require a clean Windows runner, not a driver PC.' }
if (Test-Path $TestRoot) { throw 'Smoke-test destination must be empty.' }
New-Item -ItemType Directory $TestRoot | Out-Null

function Install-To([string]$Destination) {
  $log = "$Destination-install.log"
  $process = Start-Process $Setup -ArgumentList "/VERYSILENT /SUPPRESSMSGBOXES /NORESTART /TASKS=`"`" /DIR=`"$Destination`" /LOG=`"$log`"" -Wait -PassThru
  if ($process.ExitCode -ne 0) {
    if (Test-Path $log) { Get-Content $log }
    throw "Installer failed: $($process.ExitCode)"
  }
}
function Stop-TestCompanion([string]$Destination) {
  Get-CimInstance Win32_Process | Where-Object {
    $_.ExecutablePath -and $_.ExecutablePath.StartsWith($Destination + '\', [StringComparison]::OrdinalIgnoreCase) -and
    $_.Name -in @('node.exe', 'KAW-Companion-Launcher.exe')
  } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  Start-Sleep -Milliseconds 800
}
function Test-InstalledApp([string]$Destination, [string]$ExpectedDriver) {
  $runtime = Join-Path $Destination 'runtime\node.exe'
  $app = Join-Path $Destination 'companion'
  Push-Location $app
  try {
    & $runtime -e "require('trucksim-telemetry'); console.log('Installed telemetry module loads')"
    if ($LASTEXITCODE -ne 0) { throw 'Installed native module is broken.' }
  } finally { Pop-Location }
  Start-Process (Join-Path $Destination 'KAW-Companion-Launcher.exe') -ArgumentList '--no-browser' -WorkingDirectory $Destination | Out-Null
  $health = $null
  for ($attempt = 0; $attempt -lt 60; $attempt++) {
    try { $health = Invoke-RestMethod 'http://127.0.0.1:4280/api/health' -TimeoutSec 2; break }
    catch { Start-Sleep -Milliseconds 500 }
  }
  if (!$health -or !$health.ok -or $health.service -ne 'kaws-ats-companion' -or $health.version -ne '1.7.2') {
    Get-ChildItem $Destination -Recurse -Filter '*.log' | ForEach-Object { Get-Content $_.FullName -Tail 40 }
    throw 'Installed launcher did not start Companion v1.7.2.'
  }
  $process = Get-CimInstance Win32_Process -Filter "ProcessId = $($health.pid)"
  if ($process.ExecutablePath -ine $runtime) { throw 'Launcher used system Node instead of its bundled runtime.' }
  $settings = Invoke-RestMethod 'http://127.0.0.1:4280/api/settings'
  $config = Get-Content (Join-Path $app 'config.json') -Raw | ConvertFrom-Json
  if ($config.driverName -ne $ExpectedDriver -or $settings.relay.enabled -ne $false -or !$settings.relay.endpoint) {
    throw 'Driver settings or blank relay migration failed.'
  }
  $controls = (Invoke-WebRequest 'http://127.0.0.1:4280/app-hub.js').Content
  if (!$controls.Contains('id="relayMainUrl"') -or !$controls.Contains('id="relaySharingEnabled"')) { throw 'CB relay controls missing from installed dashboard.' }
  Write-Host "PASS: private runtime, native module, dashboard and CB controls ($ExpectedDriver)."
}
try {
  # Simulate a PC without Node.js, npm, Python or build tools in PATH.
  $env:PATH = "$env:WINDIR\System32;$env:WINDIR;$env:WINDIR\System32\WindowsPowerShell\v1.0"
  if (Get-Command node, npm, python -ErrorAction SilentlyContinue) { throw 'A development tool is still visible in the clean PATH.' }

  $clean = Join-Path $TestRoot 'clean'
  Install-To $clean
  if (!(Test-Path (Join-Path $clean 'plugin\scs-telemetry.dll'))) { throw 'Bundled ATS plugin is missing.' }
  $configPath = Join-Path $clean 'companion\config.json'
  $config = Get-Content $configPath -Raw | ConvertFrom-Json
  if (!$config.remote.endpoint) { throw 'Fresh installer wrote a blank relay URL.' }
  $config.driverName = 'Clean Windows smoke'
  $config | Add-Member -NotePropertyName jarvis -NotePropertyValue @{enabled = $false} -Force
  $config | ConvertTo-Json -Depth 30 | Set-Content $configPath -Encoding utf8
  Test-InstalledApp $clean 'Clean Windows smoke'
  Stop-TestCompanion $clean

  # Updating the native installer must not overwrite settings or trip data.
  New-Item -ItemType Directory (Join-Path $clean 'companion\data') -Force | Out-Null
  Set-Content (Join-Path $clean 'companion\data\preserved.txt') 'keep native data'
  $before = (Get-FileHash $configPath).Hash
  Install-To $clean
  if ((Get-FileHash $configPath).Hash -ne $before) { throw 'Native update overwrote config.json.' }
  if ((Get-Content (Join-Path $clean 'companion\data\preserved.txt')) -ne 'keep native data') { throw 'Native update lost driver data.' }
  Write-Host 'PASS: native update preserves configuration and data.'

  # Drivers moving from the script installer keep their settings and data.
  New-Item -ItemType Directory (Join-Path $legacy 'data') -Force | Out-Null
  @{driverName='Script installer smoke'; dashboardPort=4280; dashboardHost='127.0.0.1';
    remote=@{enabled=$false; endpoint=''; apiKey='test-only-preserved-key'};
    jarvis=@{enabled=$false}} | ConvertTo-Json -Depth 10 | Set-Content (Join-Path $legacy 'config.json') -Encoding utf8
  Set-Content (Join-Path $legacy 'data\preserved.txt') 'keep script data'
  $migrated = Join-Path $TestRoot 'migrated'
  Install-To $migrated
  if ((Get-Content (Join-Path $migrated 'companion\data\preserved.txt')) -ne 'keep script data') { throw 'Script installer data was not migrated.' }
  Test-InstalledApp $migrated 'Script installer smoke'
  $migratedConfig = Get-Content (Join-Path $migrated 'companion\config.json') -Raw | ConvertFrom-Json
  if ($migratedConfig.remote.apiKey -ne 'test-only-preserved-key') { throw 'Saved relay key changed during migration.' }
  if (!(Test-Path (Join-Path $legacy 'config.json'))) { throw 'Legacy configuration was removed.' }
  Write-Host 'PASS: script installer migration, blank relay repair, saved key and sharing preference.'
} finally {
  foreach ($destination in @((Join-Path $TestRoot 'clean'), (Join-Path $TestRoot 'migrated'))) { Stop-TestCompanion $destination }
  $env:PATH = $previousPath
}
