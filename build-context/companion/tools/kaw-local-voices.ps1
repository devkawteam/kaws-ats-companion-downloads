<#
  KAW Local Natural Voices - owner-side manager for the optional Kokoro speech engine (CPU).
  Only the PC that SERVES shared voices needs this (about 0.4 GB download, ~0.7 GB RAM while running).
  Drivers using shared voices through KAW's relay do NOT install it.

    powershell -ExecutionPolicy Bypass -File kaw-local-voices.ps1 -Action Install [-ModelDir <folder with existing model files>]
    ... -Action Verify | Start | Stop | Status | Restart | Autostart -Enable / -Disable | Uninstall -Yes

  - Installs to a durable folder (default %LOCALAPPDATA%\KAW\LocalVoices), not inside the Companion folder.
  - Python packages are pinned with SHA-256 hashes (pip --require-hashes); model files are checked by size + SHA-256.
  - The engine listens on 127.0.0.1:4312 only. Start never creates a second listener; Stop only stops this engine.
  - Nothing is played aloud: the install self-test only checks that WAV audio comes back.
  Author: Kaw.
#>
[CmdletBinding()]
param(
  [ValidateSet('Install', 'Verify', 'Start', 'Stop', 'Status', 'Restart', 'Autostart', 'Uninstall')][string]$Action = 'Status',
  [string]$Root = (Join-Path $env:LOCALAPPDATA 'KAW\LocalVoices'),
  [string]$Python = '',
  [string]$ModelDir = '',
  [switch]$Enable, [switch]$Disable, [switch]$Yes
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$Port = 4312
$Here = Split-Path -Parent $MyInvocation.MyCommand.Path
$Models = @(
  @{ Name = 'kokoro-v1.0.onnx'; Size = 325532387; Sha = '7d5df8ecf7d4b1878015a32686053fd0eebe2bc377234608764cc0ef3636a6c5' },
  @{ Name = 'voices-v1.0.bin';  Size = 28214398;  Sha = 'bca610b8308e8d99f32e6fe4197e7ec01679264efed0cac9140fe9c29f1fbf7d' }
)
$ModelBase = 'https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/'
$ShortcutName = 'KAW Local Natural Voices.lnk'
$Venv = Join-Path $Root 'venv'; $App = Join-Path $Root 'app'; $ModelPath = Join-Path $Root 'models'
$Pyw = Join-Path $Venv 'Scripts\pythonw.exe'; $Py = Join-Path $Venv 'Scripts\python.exe'

function Say($m) { Write-Host "[KAW voices] $m" }
function Sha256($f) { (Get-FileHash -Algorithm SHA256 -LiteralPath $f).Hash.ToLower() }
function ModelOk($f, $m) { (Test-Path -LiteralPath $f) -and ((Get-Item -LiteralPath $f).Length -eq $m.Size) -and ((Sha256 $f) -eq $m.Sha) }

function Find-Python {
  if ($Python) { return $Python }
  try { $p = (& py -3.12 -c "import sys;print(sys.executable)" 2>$null); if ($LASTEXITCODE -eq 0 -and $p) { return $p.Trim() } } catch {}
  throw 'Python 3.12 (64-bit) is required. Install it from python.org (tick "py launcher"), or pass -Python <path to python.exe 3.12>.'
}

# The engine process listening on 4312, if any, and whether it is ours (command line runs local-voices.py).
function Get-Engine {
  $c = Get-NetTCPConnection -LocalAddress 127.0.0.1 -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $c) { return $null }
  $p = Get-CimInstance Win32_Process -Filter "ProcessId=$($c.OwningProcess)" -ErrorAction SilentlyContinue
  [pscustomobject]@{ Pid = $c.OwningProcess; Ours = [bool]($p -and $p.CommandLine -match 'local-voices\.py'); CommandLine = $p.CommandLine; MemoryMB = [math]::Round(((Get-Process -Id $c.OwningProcess -ErrorAction SilentlyContinue).WorkingSet64) / 1MB) }
}
function Get-Voices { try { Invoke-RestMethod -Uri "http://127.0.0.1:$Port/voices" -TimeoutSec 3 } catch { $null } }

function Install {
  New-Item -ItemType Directory -Force -Path $Root, $App, $ModelPath | Out-Null
  $base = Find-Python
  $ver = & $base -c "import sys,struct;print('%d.%d %d' % (sys.version_info[0], sys.version_info[1], struct.calcsize('P')*8))"
  if ($ver -ne '3.12 64') { throw "Python 3.12 64-bit is required (found $ver at $base)." }
  if (-not (Test-Path $Py)) { Say "Creating Python environment in $Venv"; & $base -m venv $Venv; if ($LASTEXITCODE) { throw 'Could not create the Python environment.' } }
  Copy-Item -Force (Join-Path $Here 'local-voices-requirements.txt') (Join-Path $Root 'requirements.txt')
  Say 'Installing pinned, hash-checked packages (pip --require-hashes)...'
  & $Py -m pip install --disable-pip-version-check --no-input --require-hashes --only-binary=:all: -r (Join-Path $Root 'requirements.txt')
  if ($LASTEXITCODE) { throw 'Package install failed (a hash mismatch also stops here).' }
  foreach ($m in $Models) {
    $dest = Join-Path $ModelPath $m.Name
    if (ModelOk $dest $m) { Say "$($m.Name): already present and verified"; continue }
    $src = if ($ModelDir) { Join-Path $ModelDir $m.Name } else { '' }
    if ($src -and (Test-Path -LiteralPath $src) -and (ModelOk $src $m)) { Say "$($m.Name): copying your verified existing file"; Copy-Item -Force -LiteralPath $src $dest; continue }
    Say "$($m.Name): downloading $([math]::Round($m.Size / 1MB)) MB..."
    $part = "$dest.part"
    Invoke-WebRequest -UseBasicParsing -Uri ($ModelBase + $m.Name) -OutFile $part
    if (-not (ModelOk $part $m)) { Remove-Item -Force $part; throw "$($m.Name): download did not match the expected size/SHA-256 - not used." }
    Move-Item -Force $part $dest
  }
  Copy-Item -Force (Join-Path $Here 'local-voices.py') (Join-Path $App 'local-voices.py')
  Copy-Item -Force (Join-Path $Here 'LOCAL-VOICES-LICENSES.md') (Join-Path $Root 'THIRD-PARTY-LICENSES.md')
  if ($PSCommandPath -ne (Join-Path $Root 'kaw-local-voices.ps1')) { Copy-Item -Force $PSCommandPath (Join-Path $Root 'kaw-local-voices.ps1'); Copy-Item -Force (Join-Path $Here 'local-voices-requirements.txt') (Join-Path $Root 'local-voices-requirements.txt'); Copy-Item -Force (Join-Path $Here 'local-voices.py') (Join-Path $Root 'local-voices.py'); Copy-Item -Force (Join-Path $Here 'LOCAL-VOICES-LICENSES.md') (Join-Path $Root 'LOCAL-VOICES-LICENSES.md') }
  Say 'Self-test (no sound is played)...'
  $was = Get-Engine
  if (-not $was) { Start-Engine | Out-Null }
  try {
    $v = Get-Voices; if (-not $v -or $v.voices.Count -lt 1) { throw 'The engine started but listed no voices.' }
    $body = '{"text":"Test.","voice":"' + $v.voices[0].id + '","rate":1}'
    $t = [Diagnostics.Stopwatch]::StartNew()
    $r = Invoke-WebRequest -UseBasicParsing -Method Post -Uri "http://127.0.0.1:$Port/speak" -ContentType 'application/json' -Body $body -TimeoutSec 60
    $bytes = $r.RawContentStream.ToArray()
    if ($r.Headers['Content-Type'] -notmatch 'audio/wav' -or [Text.Encoding]::ASCII.GetString($bytes, 0, 4) -ne 'RIFF') { throw 'Self-test did not return WAV audio.' }
    Say "Self-test OK: $($v.voices.Count) voices, $([math]::Round($bytes.Length / 1KB)) KB of audio in $([math]::Round($t.Elapsed.TotalSeconds, 1)) s."
  } finally { if (-not $was) { Stop-Engine | Out-Null } }
  Say "Installed in $Root. Start it with -Action Start (or -Action Autostart -Enable to start at sign-in)."
}

function Verify {
  $ok = $true
  if (-not (Test-Path $Py)) { Say 'Python environment: missing'; $ok = $false } else { & $Py -c "import kokoro_onnx, onnxruntime, soundfile" 2>$null; Say "Python packages: $(if ($LASTEXITCODE) { $ok = $false; 'NOT importable' } else { 'OK' })" }
  foreach ($m in $Models) { $f = Join-Path $ModelPath $m.Name; $good = ModelOk $f $m; if (-not $good) { $ok = $false }; Say "$($m.Name): $(if ($good) { 'verified' } else { 'missing or changed' })" }
  if (-not (Test-Path (Join-Path $App 'local-voices.py'))) { Say 'Engine script: missing'; $ok = $false }
  if ($ok) { Say 'Install verified.' } else { Say 'Install incomplete - run -Action Install.' }
  return $ok
}

function Start-Engine {
  $e = Get-Engine
  if ($e) { if ($e.Ours) { Say "Already running (PID $($e.Pid))."; return $true } throw "Port $Port is used by another program (PID $($e.Pid)); not starting a second listener." }
  foreach ($m in $Models) { if (-not (Test-Path (Join-Path $ModelPath $m.Name))) { throw 'Not installed - run -Action Install first.' } }
  $argList = @("`"$(Join-Path $App 'local-voices.py')`"", '--model', "`"$(Join-Path $ModelPath 'kokoro-v1.0.onnx')`"", '--voices', "`"$(Join-Path $ModelPath 'voices-v1.0.bin')`"")
  $p = Start-Process -FilePath $Pyw -ArgumentList $argList -WindowStyle Hidden -PassThru
  for ($i = 0; $i -lt 90; $i++) { Start-Sleep -Seconds 1; if (Get-Voices) { Say "Started (PID $((Get-Engine).Pid)) after $($i + 1) s."; return $true }; if ($p.HasExited) { throw "The engine stopped during start (exit $($p.ExitCode)). Run -Action Verify." } }
  throw 'The engine did not answer within 90 s.'
}

function Stop-Engine {
  $e = Get-Engine
  if (-not $e) { Say 'Not running.'; return $true }
  if (-not $e.Ours) { throw "Port $Port belongs to another program (PID $($e.Pid)); not stopping it." }
  Stop-Process -Id $e.Pid -Force
  for ($i = 0; $i -lt 10 -and (Get-Engine); $i++) { Start-Sleep -Milliseconds 300 }
  Say "Stopped (PID $($e.Pid))."; return $true
}

function Status {
  $e = Get-Engine; $v = Get-Voices
  $startup = Join-Path ([Environment]::GetFolderPath('Startup')) $ShortcutName
  Say "Install folder : $Root $(if (Test-Path $Py) { '(installed)' } else { '(not installed)' })"
  Say "Engine         : $(if ($e) { "running, PID $($e.Pid), $($e.MemoryMB) MB$(if (-not $e.Ours) { ' - NOT this engine' })" } else { 'stopped' })"
  Say "Voices         : $(if ($v) { "$($v.voices.Count) available on 127.0.0.1:$Port" } else { 'not answering' })"
  Say "Start at sign-in: $(if (Test-Path $startup) { "yes ($startup)" } else { 'no' })"
  if (-not $e) { Say 'When the engine is off (or this PC is off), drivers automatically use their browser voice.' }
}

function Autostart {
  $startup = Join-Path ([Environment]::GetFolderPath('Startup')) $ShortcutName
  if ($Disable) { if (Test-Path $startup) { Remove-Item -Force $startup; Say 'Start at sign-in turned off.' } else { Say 'Start at sign-in was already off.' }; return }
  if (-not $Enable) { throw 'Use -Enable or -Disable.' }
  # Same name as the preview shortcut, so it REPLACES it rather than adding a second starter.
  $s = (New-Object -ComObject WScript.Shell).CreateShortcut($startup)
  $s.TargetPath = (Get-Command powershell.exe).Source
  $s.Arguments = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$(Join-Path $Root 'kaw-local-voices.ps1')`" -Action Start -Root `"$Root`""
  $s.WindowStyle = 7; $s.Description = 'Starts KAW Local Natural Voices (127.0.0.1:4312) at sign-in'; $s.Save()
  if (-not (Test-Path (Join-Path $Root 'kaw-local-voices.ps1'))) { throw 'Install first (-Action Install).' }
  Say "Start at sign-in turned on ($startup)."
}

function Uninstall {
  if (-not $Yes) { throw "This removes $Root (environment and model files). Re-run with -Yes to confirm." }
  Stop-Engine | Out-Null
  $startup = Join-Path ([Environment]::GetFolderPath('Startup')) $ShortcutName
  if ((Test-Path $startup) -and ((New-Object -ComObject WScript.Shell).CreateShortcut($startup).Arguments -match [regex]::Escape($Root))) { Remove-Item -Force $startup }
  Remove-Item -Recurse -Force -LiteralPath $Root
  Say "Removed $Root."
}

switch ($Action) {
  'Install' { Install }
  'Verify' { if (-not (Verify)) { exit 1 } }
  'Start' { Start-Engine | Out-Null }
  'Stop' { Stop-Engine | Out-Null }
  'Restart' { Stop-Engine | Out-Null; Start-Engine | Out-Null }
  'Status' { Status }
  'Autostart' { Autostart }
  'Uninstall' { Uninstall }
}
