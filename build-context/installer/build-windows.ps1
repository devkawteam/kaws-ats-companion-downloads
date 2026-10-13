[CmdletBinding()]
param(
  [string]$BuildRoot = (Join-Path $PSScriptRoot '..\build\windows'),
  [string]$Output = (Join-Path $PSScriptRoot '..\dist'),
  [string]$NodeVersion = '22.23.3'
)
$ErrorActionPreference = 'Stop'
$repo = Split-Path $PSScriptRoot -Parent
$BuildRoot = [IO.Path]::GetFullPath($BuildRoot)
$Output = [IO.Path]::GetFullPath($Output)
$stage = Join-Path $BuildRoot 'stage'
$seed = Join-Path $BuildRoot 'seed'
if (Test-Path $BuildRoot) { throw 'Use an empty build directory to avoid packaging stale files.' }
New-Item -ItemType Directory -Path $stage, $Output -Force | Out-Null

# Reuse the launcher and SCS plugin from the existing official native installer.
# The exact release artifact hash is pinned; none of its old app/configuration ships.
$seedExe = Join-Path $BuildRoot 'seed-setup.exe'
Invoke-WebRequest 'https://github.com/devkawteam/kaws-ats-companion-downloads/releases/download/v1.6.1/KAW-ATS-Companion-Setup-v1.6.1.exe' -OutFile $seedExe
if ((Get-FileHash $seedExe -Algorithm SHA256).Hash.ToLowerInvariant() -ne '979deb7a56ef4108ccb9ce2e841082b092f2b72c41236aa67d98958e7cbc3027') { throw 'Seed installer checksum mismatch.' }
$installed = Start-Process $seedExe -ArgumentList "/VERYSILENT /SUPPRESSMSGBOXES /NORESTART /TASKS=`"`" /DIR=`"$seed`"" -Wait -PassThru
if ($installed.ExitCode -ne 0) { throw "Seed installer failed: $($installed.ExitCode)" }
foreach ($name in @('KAW-Companion-Launcher.exe', 'KAW-ATS-Companion.ico', 'plugin')) {
  if (!(Test-Path (Join-Path $seed $name))) { throw "Official installer is missing $name" }
  Copy-Item (Join-Path $seed $name) (Join-Path $stage $name) -Recurse
}
if (!(Test-Path (Join-Path $stage 'plugin\scs-telemetry.dll'))) { throw 'Telemetry plugin is missing.' }

# Download Node from its official distribution, validating the published checksum.
$archiveName = "node-v$NodeVersion-win-x64.zip"
$archive = Join-Path $BuildRoot $archiveName
$base = "https://nodejs.org/dist/v$NodeVersion"
$sums = (Invoke-WebRequest "$base/SHASUMS256.txt").Content
$entry = @($sums -split "`n" | Where-Object { $_.Trim().EndsWith("  $archiveName") })
if ($entry.Count -ne 1) { throw 'Official Node checksum entry is missing or ambiguous.' }
$expected = ($entry[0] -split '\s+')[0].ToLowerInvariant()
Invoke-WebRequest "$base/$archiveName" -OutFile $archive
if ((Get-FileHash $archive -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expected) { throw 'Node archive checksum mismatch.' }
Expand-Archive $archive (Join-Path $BuildRoot 'node')
$nodeDir = Join-Path $BuildRoot "node\node-v$NodeVersion-win-x64"
$runtime = Join-Path $stage 'runtime'
New-Item -ItemType Directory $runtime | Out-Null
Copy-Item (Join-Path $nodeDir 'node.exe'), (Join-Path $nodeDir 'LICENSE') $runtime
$node = Join-Path $runtime 'node.exe'

# Only tracked Companion files are staged, never local credentials or data.
$app = Join-Path $stage 'companion'
Push-Location $repo
try {
  $files = & git ls-files companion
  if ($LASTEXITCODE -ne 0) { throw 'Cannot enumerate Companion source.' }
  foreach ($relative in $files) {
    $destination = Join-Path $stage $relative
    New-Item -ItemType Directory (Split-Path $destination -Parent) -Force | Out-Null
    Copy-Item (Join-Path $repo $relative) $destination
  }
} finally { Pop-Location }

# Build on Windows with the same Node ABI that will ship to drivers.
$previousPath = $env:PATH
$env:PATH = "$nodeDir;$previousPath"
Push-Location $app
try {
  & (Join-Path $nodeDir 'npm.cmd') ci --omit=dev --no-audit --no-fund
  if ($LASTEXITCODE -ne 0) { throw 'Native Windows dependency installation failed.' }
  & $node -e "require('trucksim-telemetry'); console.log('Bundled native telemetry module loads')"
  if ($LASTEXITCODE -ne 0) { throw 'Bundled telemetry module failed to load.' }
  $testFiles = @(Get-ChildItem 'tests/*.test.js' | ForEach-Object { $_.FullName })
  if (!$testFiles.Count) { throw 'No Companion tests found.' }
  & $node --test @testFiles
  if ($LASTEXITCODE -ne 0) { throw 'Companion Windows tests failed.' }
} finally { Pop-Location; $env:PATH = $previousPath }

# Tests may produce local runtime files; none belong in the installer.
foreach ($name in @('config.json', 'data', 'logs', 'tests')) {
  $path = Join-Path $app $name
  if (Test-Path $path) { Remove-Item $path -Recurse -Force }
}
if (Get-ChildItem $app -Recurse -Force -File | Where-Object { $_.Name -in @('config.json', 'secrets.json', '.env') }) { throw 'Private configuration found in staging.' }
Copy-Item (Join-Path $PSScriptRoot 'native-QUICK-START.txt') (Join-Path $stage 'QUICK-START.txt')
Copy-Item (Join-Path $PSScriptRoot 'v1.5.1-payload\THIRD-PARTY-NOTICES.txt') (Join-Path $stage 'THIRD-PARTY-NOTICES.txt')
$manifest = [ordered]@{
  version = (Get-Content (Join-Path $app 'package.json') -Raw | ConvertFrom-Json).version
  sourceCommit = $(if (Test-Path (Join-Path $repo 'source-commit.txt')) { (Get-Content (Join-Path $repo 'source-commit.txt') -Raw).Trim() } else { & git -C $repo rev-parse HEAD })
  nodeVersion = $NodeVersion
  nodeArchiveSha256 = $expected
  seedInstallerSha256 = '979deb7a56ef4108ccb9ce2e841082b092f2b72c41236aa67d98958e7cbc3027'
}
$manifest | ConvertTo-Json | Set-Content (Join-Path $Output 'build-manifest.json') -Encoding utf8
$iscc = Join-Path ${env:ProgramFiles(x86)} 'Inno Setup 6\ISCC.exe'
if (!(Test-Path $iscc)) { throw 'Inno Setup 6 is required on the build machine.' }
& $iscc "/DStage=$stage" "/DOut=$Output" (Join-Path $PSScriptRoot 'KAW-ATS-Companion.iss')
if ($LASTEXITCODE -ne 0) { throw 'Inno Setup compilation failed.' }
$setup = Join-Path $Output "KAW-ATS-Companion-Setup-v$($manifest.version).exe"
if (!(Test-Path $setup)) { throw 'Expected Setup.exe was not produced.' }
$hash = (Get-FileHash $setup -Algorithm SHA256).Hash.ToLowerInvariant()
"$hash  $([IO.Path]::GetFileName($setup))" | Set-Content "$setup.sha256.txt" -Encoding ascii
Write-Host "Built $setup ($hash)"
