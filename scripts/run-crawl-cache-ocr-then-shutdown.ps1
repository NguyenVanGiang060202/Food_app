$ErrorActionPreference = 'Continue'
$start = Get-Date
$deadline = $start.AddMinutes(90)
$log = Join-Path (Get-Location) 'tmp\crawl-cache-ocr-1h.log'
New-Item -ItemType Directory -Force (Split-Path $log) | Out-Null

$env:DATABASE_URL = 'postgresql://food_app:HoiBep2026StrongPwd@localhost:5432/food_app'
$env:IMAGE_STORAGE_DIR = Join-Path (Get-Location) 'storage\restaurant-images'
$env:AI_BASE_URL = 'http://localhost:11434/v1'
$env:AI_API_KEY = 'ollama'
$env:AI_VISION_MODEL = 'minicpm-v:latest'
$env:AI_DELAY_MS = '100'
$env:CRAWL_CITY = 'Ho Chi Minh City'
$env:CRAWL_DISTRICTS = ''
$env:CRAWL_LIMIT_PER_QUERY = '10'
$env:CRAWL_MAX_QUERIES = '6'
$env:CRAWL_MAX_SCROLL_ATTEMPTS = '8'
$env:CRAWL_MAX_REVIEWS_PER_PLACE = '0'
$env:CRAWL_HEADLESS = 'true'
$env:CRAWL_HEARTBEAT_SECONDS = '15'
$env:CRAWL_DELAY_MS = '700'
# ASCII query terms avoid legacy PowerShell child-process encoding corruption.
$env:CRAWL_QUERIES = 'restaurant,pho,bun,rice,noodles,vegan'

function Run-Step([string]$label, [string]$workspace, [string]$script, [string[]]$arguments) {
  $now = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
  Add-Content $log "[$now] START $label"
  Push-Location (Get-Location)
  try {
    & npm run $script '--workspace' $workspace '--' @arguments 2>&1 | Tee-Object -FilePath $log -Append
    Add-Content $log "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] END $label exit=$LASTEXITCODE"
  } catch {
    Add-Content $log "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] ERROR $label $($_.Exception.Message)"
  } finally {
    Pop-Location
  }
}

try {
  $cycle = 0
  while ((Get-Date) -lt $deadline) {
    $cycle++
    Add-Content $log "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] CYCLE $cycle remaining=$([int]($deadline - (Get-Date)).TotalMinutes)m"
    if ((Get-Date) -ge $deadline) { break }
    Run-Step "crawl-$cycle" 'crawler' 'crawl:playwright:batch' @()
    if ((Get-Date) -ge $deadline) { break }
    Run-Step "cache-$cycle" 'crawler' 'cache:images' @('--limit', '1000', '--concurrency', '8')
    if ((Get-Date) -ge $deadline) { break }
    Run-Step "ocr-$cycle" 'crawler' 'enrich:menu-images' @('--batch-size', '50', '--concurrency', '1')
  }
} finally {
  Add-Content $log "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] PIPELINE_FINISHED; scheduling shutdown"
  Start-Process -FilePath 'shutdown.exe' -ArgumentList '/s', '/t', '30', '/f'
}
