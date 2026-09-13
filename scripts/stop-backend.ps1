param(
  [string]$DataDir = ""
)

$ErrorActionPreference = "Stop"
$repositoryRoot = Split-Path -Parent $PSScriptRoot
$dataDirPath = if ($DataDir) {
  if ([IO.Path]::IsPathRooted($DataDir)) { $DataDir } else { Join-Path $repositoryRoot $DataDir }
} else {
  Join-Path $repositoryRoot "data"
}
$pidFile = Join-Path $dataDirPath "zut-backend-pids.json"
if (-not (Test-Path -LiteralPath $pidFile)) {
  Write-Host "No ZUT backend PID file found at $pidFile"
  exit 0
}

$pids = Get-Content -Raw -LiteralPath $pidFile | ConvertFrom-Json
foreach ($role in @('api', 'worker')) {
  $backendProcessId = $pids.$role
  if ($backendProcessId) {
    $process = Get-Process -Id ([int]$backendProcessId) -ErrorAction SilentlyContinue
    if ($process) {
      $expectedStart = $pids.($role + 'Start')
      $expectedPython = Join-Path $repositoryRoot 'server\.venv\Scripts\python.exe'
      if (-not $expectedStart -or $process.Path -ne $expectedPython -or $process.StartTime.ToUniversalTime().ToString('o') -ne $expectedStart) {
        throw "PID $backendProcessId does not match the recorded ZUT process. It was not stopped."
      }
      & taskkill.exe /PID $backendProcessId /T /F | Out-Null
      if ($LASTEXITCODE -ne 0) { throw "Failed to stop ZUT PID $backendProcessId" }
      Write-Host "Stopped ZUT $role"
    }
  }
}
Remove-Item -LiteralPath $pidFile -Force
