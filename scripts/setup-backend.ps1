param(
  [switch]$UpgradePip,
  [switch]$Dev
)

$ErrorActionPreference = "Stop"
$repositoryRoot = Split-Path -Parent $PSScriptRoot
$serverRoot = Join-Path $repositoryRoot "server"
$python = Join-Path $serverRoot ".venv\Scripts\python.exe"
$pythonCommand = Get-Command python -ErrorAction SilentlyContinue

if (-not $pythonCommand) {
  throw "Python 3.12 is required but was not found on PATH."
}

$pythonVersion = & $pythonCommand.Source -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')"
if ($pythonVersion.Trim() -ne "3.12") {
  throw "Python 3.12 is required. Found Python $($pythonVersion.Trim())."
}

if (-not (Test-Path -LiteralPath $python)) {
  Write-Host "Creating server/.venv..."
  & $pythonCommand.Source -m venv (Join-Path $serverRoot ".venv")
  if ($LASTEXITCODE -ne 0) { throw "Failed to create the virtual environment." }
}

if ($UpgradePip) {
  & $python -m pip install --upgrade pip
  if ($LASTEXITCODE -ne 0) { throw "pip upgrade failed." }
}

Write-Host "Installing ZUT backend dependencies..."
$requirementsFile = if ($Dev) {
  Join-Path $serverRoot "requirements-dev.txt"
} else {
  Join-Path $serverRoot "requirements.txt"
}
& $python -m pip install -r $requirementsFile
if ($LASTEXITCODE -ne 0) { throw "Dependency installation failed. Check the pip error above." }
& $python -m pip check
if ($LASTEXITCODE -ne 0) { throw "Dependency validation failed." }
$installedVersion = & $python -c "from importlib.metadata import version; print(version('pdf2zh-next'))"
if ($LASTEXITCODE -ne 0) { throw "PDF engine is missing." }
if ($installedVersion.Trim() -ne "2.9.0") {
  throw "pdf2zh-next 2.9.0 was not installed correctly. Found $($installedVersion.Trim())."
}
Write-Host "Backend setup complete: $python"
