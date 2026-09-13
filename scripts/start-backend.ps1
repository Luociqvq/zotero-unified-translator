param(
  [string]$EnvFile = "",
  [switch]$Dev
)

$ErrorActionPreference = "Stop"
$repositoryRoot = Split-Path -Parent $PSScriptRoot
$serverRoot = Join-Path $repositoryRoot "server"
$python = Join-Path $serverRoot ".venv\Scripts\python.exe"

if (-not (Test-Path -LiteralPath $python)) {
  & (Join-Path $PSScriptRoot "setup-backend.ps1") -Dev:$Dev
}
if (-not (Test-Path -LiteralPath $python)) {
  throw "Backend Python environment was not created."
}

$resolvedEnvFile = if ($EnvFile) {
  if ([IO.Path]::IsPathRooted($EnvFile)) { $EnvFile } else { Join-Path $repositoryRoot $EnvFile }
} else {
  Join-Path $repositoryRoot ".env"
}
if ($EnvFile -and -not (Test-Path -LiteralPath $resolvedEnvFile)) {
  throw "Environment file not found: $resolvedEnvFile. Copy .env.example to .env and fill in the secrets first."
}

foreach ($line in $(if (Test-Path -LiteralPath $resolvedEnvFile) { Get-Content -LiteralPath $resolvedEnvFile })) {
  if ($line -match '^\s*(ZUT_[A-Z0-9_]+)\s*=\s*(.*)\s*$') {
    $name = $Matches[1]
    $value = $Matches[2].Trim()
    if ($value.Length -ge 2 -and (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'")))) {
      $value = $value.Substring(1, $value.Length - 2)
    }
    [Environment]::SetEnvironmentVariable($name, $value, "Process")
  }
}

$env:PYTHONPATH = $serverRoot
$dataDirValue = if ($env:ZUT_DATA_DIR) { $env:ZUT_DATA_DIR } else { "data" }
$dataDir = if ([IO.Path]::IsPathRooted($dataDirValue)) { $dataDirValue } else { Join-Path $repositoryRoot $dataDirValue }
New-Item -ItemType Directory -Force -Path $dataDir | Out-Null
$env:ZUT_DATA_DIR = [IO.Path]::GetFullPath($dataDir)
$env:ZUT_BIND_HOST = '127.0.0.1'
if (-not $env:ZUT_PORT) { $env:ZUT_PORT = '8890' }

function Read-Secret([string]$prompt) {
  $secretValue = Read-Host $prompt -AsSecureString
  return [Net.NetworkCredential]::new('', $secretValue).Password
}

if (-not $env:ZUT_AUTH_TOKEN -or $env:ZUT_AUTH_TOKEN -eq "replace-with-a-long-random-token") {
  $env:ZUT_AUTH_TOKEN = Read-Secret 'Backend token (enter the same token in Zotero settings)'
}
$engine = if ($env:ZUT_ENGINE) { $env:ZUT_ENGINE } else { "pdf2zh_next" }
if ($engine -eq "pdf2zh_next" -and (-not $env:ZUT_LLM_API_KEY)) {
  $env:ZUT_LLM_API_KEY = Read-Secret 'LLM API Key'
}
if (-not $env:ZUT_AUTH_TOKEN) { throw "Backend token cannot be empty." }
if ($engine -eq 'pdf2zh_next' -and -not $env:ZUT_LLM_API_KEY) { throw "LLM API Key cannot be empty." }
if (-not $env:ZUT_LLM_ENDPOINT) { $env:ZUT_LLM_ENDPOINT = 'https://api.openai.com/v1' }
if (-not $env:ZUT_LLM_MODEL) { $env:ZUT_LLM_MODEL = 'gpt-4o-mini' }
& $python -c "from zut_server.config import Settings; Settings.from_env().validate()"
if ($LASTEXITCODE -ne 0) { throw "Backend configuration is invalid." }
& $python -c "import os,socket; s=socket.socket(); s.bind(('127.0.0.1',int(os.environ['ZUT_PORT']))); s.close()"
if ($LASTEXITCODE -ne 0) { throw "The backend port is already in use. Stop the existing backend first." }

$pidFile = Join-Path $dataDir "zut-backend-pids.json"
if (Test-Path -LiteralPath $pidFile) {
  $oldPids = Get-Content -Raw -LiteralPath $pidFile | ConvertFrom-Json
  $running = @($oldPids.api, $oldPids.worker) | Where-Object {
    $_ -and (Get-Process -Id ([int]$_) -ErrorAction SilentlyContinue)
  }
  if ($running.Count -gt 0) {
    throw "ZUT backend is already running (PID $($running -join ', ')). Use scripts/stop-backend.ps1 first."
  }
  Remove-Item -LiteralPath $pidFile -Force
}

$apiLog = Join-Path $dataDir "zut-api.log"
$workerLog = Join-Path $dataDir "zut-worker.log"
$api = Start-Process -FilePath $python -ArgumentList @("-m", "zut_server") -WorkingDirectory $serverRoot -WindowStyle Hidden -RedirectStandardOutput $apiLog -RedirectStandardError ($apiLog + ".error") -PassThru
try {
  $worker = Start-Process -FilePath $python -ArgumentList @("-m", "zut_server.worker") -WorkingDirectory $serverRoot -WindowStyle Hidden -RedirectStandardOutput $workerLog -RedirectStandardError ($workerLog + ".error") -PassThru
  $ready = $false
  for ($attempt = 0; $attempt -lt 20; $attempt++) {
    Start-Sleep -Milliseconds 500
    $api.Refresh()
    $worker.Refresh()
    if ($api.HasExited -or $worker.HasExited) { throw "Backend exited. Check logs in $dataDir" }
    try {
      $health = Invoke-RestMethod "http://127.0.0.1:$($env:ZUT_PORT)/api/v1/health" -TimeoutSec 2
      if ($health.service -eq 'zut-backend') { $ready = $true; break }
    } catch { }
  }
  if (-not $ready) { throw "Backend did not become ready. Check logs in $dataDir" }
  @{ api = $api.Id; worker = $worker.Id; apiStart = $api.StartTime.ToUniversalTime().ToString('o'); workerStart = $worker.StartTime.ToUniversalTime().ToString('o') } | ConvertTo-Json | Set-Content -LiteralPath $pidFile -Encoding UTF8
} catch {
  foreach ($ownedProcess in @($api, $worker)) {
    if ($ownedProcess -and -not $ownedProcess.HasExited) { $ownedProcess.Kill() }
  }
  throw
}

Write-Host "ZUT backend started."
Write-Host "API PID: $($api.Id); Worker PID: $($worker.Id)"
Write-Host "API: http://127.0.0.1:$($env:ZUT_PORT)"
Write-Host "Engine check: $($health.engine.reason) (does not test LLM credentials or output quality)"
Write-Host "Logs: $dataDir"
Write-Host "Stop: powershell -ExecutionPolicy Bypass -File scripts/stop-backend.ps1"
