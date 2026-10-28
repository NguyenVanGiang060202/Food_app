param(
  [int]$Limit = 25,
  [int]$Offset = 0,
  [string[]]$RestaurantId = @(),
  [string[]]$PageUrl = @(),
  [string[]]$Dish = @(),
  [string[]]$ExactDish = @(),
  [switch]$IncludeCovered,
  [switch]$ReviewAll,
  [switch]$Apply
)

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$envPath = Join-Path $repo '.env'
if (-not (Test-Path -LiteralPath $envPath)) { throw '.env is required for local database access.' }
if ($Apply -and $RestaurantId.Count -eq 0) { throw 'Apply requires explicit -RestaurantId values from a reviewed dry run.' }
if ($ReviewAll -and ($Apply -or $RestaurantId.Count -eq 0)) { throw 'ReviewAll is preview-only and requires explicit -RestaurantId.' }
if ($PageUrl.Count -gt 0 -and $RestaurantId.Count -eq 0) { throw 'PageUrl requires explicit -RestaurantId.' }

$settings = @{}
foreach ($line in Get-Content -LiteralPath $envPath) {
  if ($line -match '^\s*(POSTGRES_DB|POSTGRES_USER|POSTGRES_PASSWORD|POSTGRES_PORT)=(.*)$') {
    $settings[$matches[1]] = $matches[2].Trim('"', "'")
  }
}
if (-not $settings.POSTGRES_PASSWORD) { throw 'POSTGRES_PASSWORD is missing from .env.' }

$dbName = if ($settings.POSTGRES_DB) { $settings.POSTGRES_DB } else { 'food_app' }
$dbUser = if ($settings.POSTGRES_USER) { $settings.POSTGRES_USER } else { 'food_app' }
$dbPort = if ($settings.POSTGRES_PORT) { $settings.POSTGRES_PORT } else { '5432' }
$previousDatabaseUrl = $env:DATABASE_URL
$env:DATABASE_URL = 'postgresql://{0}:{1}@127.0.0.1:{2}/{3}' -f [uri]::EscapeDataString($dbUser), [uri]::EscapeDataString($settings.POSTGRES_PASSWORD), $dbPort, $dbName

$npmArgs = @('run', 'ingest:website-menu', '--workspace', 'crawler', '--', '--all-sites', '--limit', [string]$Limit, '--offset', [string]$Offset)
if (-not $Apply) { $npmArgs += '--dry-run' }
if ($ReviewAll) { $npmArgs += '--review-all' }
if (-not $Apply -and $RestaurantId.Count -eq 0 -and -not $IncludeCovered) { $npmArgs += '--uncovered-only' }
foreach ($id in $RestaurantId) { $npmArgs += @('--restaurant-id', $id) }
foreach ($url in $PageUrl) { $npmArgs += @('--page-url', $url) }
foreach ($name in $Dish) {
  $npmArgs += @($(if ($Apply) { '--exact-dish' } else { '--dish' }), $name)
}
foreach ($name in $ExactDish) { $npmArgs += @('--exact-dish', $name) }

Push-Location $repo
try {
  # The crawler emits per-site skip diagnostics on stderr. Windows PowerShell
  # turns native stderr into ErrorRecords; with Stop this would abort an entire
  # batch on the first harmless identity mismatch. The process exit code is
  # still checked below for actual failures.
  $previousErrorActionPreference = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try { & npm @npmArgs } finally { $ErrorActionPreference = $previousErrorActionPreference }
  if ($LASTEXITCODE -ne 0) { throw "Website menu import failed with exit code $LASTEXITCODE." }
} finally {
  Pop-Location
  if ($null -eq $previousDatabaseUrl) { Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue }
  else { $env:DATABASE_URL = $previousDatabaseUrl }
}
