param(
  [string]$DeadlineIso,
  [string]$LogDir = 'C:\Users\Admin\Downloads\food-app\tmp\recommendation-maintenance-3h',
  [ValidateRange(1, 1440)][int]$SinceMinutes = 20,
  [switch]$Once
)

$ErrorActionPreference = 'Continue'
$repo = 'C:\Users\Admin\Downloads\food-app'
$log = Join-Path $LogDir 'profile-sync.log'
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

function Log([string]$message) {
  Add-Content -LiteralPath $log -Value "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] $message"
}

function Load-Env([string]$name) {
  $line = Get-Content (Join-Path $repo '.env') | Where-Object { $_ -match ('^' + $name + '=') } | Select-Object -First 1
  if ($line) { Set-Item -Path ('Env:' + $name) -Value ($line.Split('=', 2)[1]) }
}

function Load-DotEnv {
  foreach ($name in @('DATABASE_URL', 'POSTGRES_DB', 'POSTGRES_USER', 'POSTGRES_PASSWORD', 'POSTGRES_PORT', 'EMBEDDING_BASE_URL', 'EMBEDDING_API_KEY', 'EMBEDDING_MODEL', 'EMBEDDING_DIMENSIONS', 'EMBEDDING_CONCURRENCY')) {
    Load-Env $name
  }
}

function Sync-ChangedRestaurants([datetime]$since) {
  $sinceSql = $since.ToUniversalTime().ToString('yyyy-MM-dd HH:mm:ss') + '+00'
  $query = "SELECT DISTINCT r.id FROM menu_image_extraction mie JOIN restaurant_image ri ON ri.id=mie.restaurant_image_id JOIN restaurant r ON r.id=ri.restaurant_id WHERE r.status='active' AND mie.updated_at >= '$sinceSql' AND (mie.model LIKE 'minicpm-v%' OR mie.model IN ('website:menu:v1','website:menu-image-curated:v1','google_maps:menu-curated:v1')) UNION SELECT r.id FROM restaurant r JOIN location l ON l.id=r.location_id WHERE r.status='active' AND l.updated_at >= '$sinceSql'"
  $dbUser = if ($env:POSTGRES_USER) { $env:POSTGRES_USER } else { 'food_app' }
  $dbName = if ($env:POSTGRES_DB) { $env:POSTGRES_DB } else { 'food_app' }
  $ids = @(docker exec food-discovery-platform-postgres-1 psql -U $dbUser -d $dbName -Atc $query 2>$null | ForEach-Object { $_.Trim() } | Where-Object { $_ -match '^[0-9a-f-]{36}$' })
  if ($ids.Count -eq 0) { Log 'NO_CHANGED_RESTAURANTS'; return }

  $rebuilt = 0
  foreach ($id in $ids) {
    try {
      Invoke-RestMethod -Method Post -Uri ("http://localhost:3000/api/v1/restaurants/$id/food-profile/rebuild") -ContentType 'application/json' -Body '{}' -TimeoutSec 90 | Out-Null
      $rebuilt++
    } catch { Log "PROFILE_REBUILD_FAILED id=$id error=$($_.Exception.Message)" }
  }

  Load-Env 'EMBEDDING_BASE_URL'
  Load-Env 'EMBEDDING_API_KEY'
  Load-Env 'EMBEDDING_MODEL'
  Load-Env 'EMBEDDING_DIMENSIONS'
  Load-Env 'EMBEDDING_CONCURRENCY'
  if (-not $env:DATABASE_URL) {
    $dbName = if ($env:POSTGRES_DB) { $env:POSTGRES_DB } else { 'food_app' }
    $dbUser = if ($env:POSTGRES_USER) { $env:POSTGRES_USER } else { 'food_app' }
    $dbPassword = if ($env:POSTGRES_PASSWORD) { $env:POSTGRES_PASSWORD } else { throw 'POSTGRES_PASSWORD or DATABASE_URL must be configured in .env.' }
    $dbPort = if ($env:POSTGRES_PORT) { $env:POSTGRES_PORT } else { '5432' }
    $env:DATABASE_URL = "postgresql://$([uri]::EscapeDataString($dbUser)):$([uri]::EscapeDataString($dbPassword))@localhost:$dbPort/$dbName"
  }
  $env:PGHOST = 'localhost'
  $env:PGPORT = if ($env:POSTGRES_PORT) { $env:POSTGRES_PORT } else { '5432' }
  $env:PGDATABASE = if ($env:POSTGRES_DB) { $env:POSTGRES_DB } else { 'food_app' }
  $env:PGUSER = if ($env:POSTGRES_USER) { $env:POSTGRES_USER } else { 'food_app' }
  $env:PGPASSWORD = $env:POSTGRES_PASSWORD
  $env:IMAGE_STORAGE_DIR = Join-Path $repo 'storage\restaurant-images'
  $npmArgs = @('run', 'embed:once', '--workspace', 'crawler', '--', '--refresh')
  foreach ($id in $ids) { $npmArgs += '--restaurant-id'; $npmArgs += $id }
  Push-Location $repo
  try {
    & npm @npmArgs 2>&1 | Out-File -FilePath $log -Append -Encoding utf8
    Log "SYNC_COMPLETE changed=$($ids.Count) profiles=$rebuilt embed_exit=$LASTEXITCODE"
  } finally { Pop-Location }
}

if (-not $DeadlineIso -and -not $Once) { throw 'DeadlineIso is required unless -Once is set.' }
$deadline = if ($DeadlineIso) { [datetime]::Parse($DeadlineIso) } else { (Get-Date).AddHours(1) }
Load-DotEnv
$lastSync = (Get-Date).AddMinutes(-$SinceMinutes)
Log "START deadline=$($deadline.ToString('o'))"
while ((Get-Date) -lt $deadline) {
  $cycleStart = Get-Date
  Sync-ChangedRestaurants $lastSync
  $lastSync = $cycleStart
  if ($Once) { break }
  Start-Sleep -Seconds 300
}
Log 'DEADLINE_REACHED'
