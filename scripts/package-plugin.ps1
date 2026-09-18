param(
  [switch]$SkipNpmInstall
)

$ErrorActionPreference = "Stop"
$repositoryRoot = Split-Path -Parent $PSScriptRoot
$pluginRoot = Join-Path $repositoryRoot "plugin"
$buildRoot = Join-Path $pluginRoot ".scaffold\build"
$xpi = Join-Path $buildRoot "zotero-unified-translator.xpi"
$releaseRoot = Join-Path $repositoryRoot "release"
$releaseXpi = Join-Path $releaseRoot "zotero-unified-translator.xpi"
$verifyScript = Join-Path $repositoryRoot "scripts\verify-updates.mjs"

if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
  throw "Node.js/npm is required to build the Zotero plugin."
}
Push-Location $pluginRoot
try {
  if (-not $SkipNpmInstall) {
    npm ci
    if ($LASTEXITCODE -ne 0) { throw "npm ci failed." }
  }
  npm run build
  if ($LASTEXITCODE -ne 0) { throw "Plugin build failed." }
  npm test
  if ($LASTEXITCODE -ne 0) { throw "Plugin regression tests failed." }
} finally {
  Pop-Location
}

if (-not (Test-Path -LiteralPath $xpi)) {
  throw "Plugin build did not produce $xpi"
}
New-Item -ItemType Directory -Force -Path $releaseRoot | Out-Null
Copy-Item -LiteralPath $xpi -Destination $releaseXpi -Force
Write-Host "XPI ready: $releaseXpi"
Write-Host "Install it from Zotero: Tools -> Plugins -> gear -> Install Plugin From File."

# A stale updates.json does not fail loudly in production: Zotero simply never
# offers the new version. Catch the mismatch here instead of after publishing.
if (Test-Path -LiteralPath $verifyScript) {
  Push-Location $repositoryRoot
  try {
    node $verifyScript
    if ($LASTEXITCODE -ne 0) {
      throw "updates.json does not match the built XPI. Fix updates.json before releasing."
    }
  } finally {
    Pop-Location
  }
} else {
  Write-Warning "scripts\verify-updates.mjs not found; skipping updates.json verification."
}
