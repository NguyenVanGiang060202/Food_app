param([int]$Hours = 3)

$ErrorActionPreference = 'Continue'
$repo = 'C:\Users\Admin\Downloads\food-app'
$logDir = Join-Path $repo 'tmp\recommendation-maintenance-ocr-20261005'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$deadline = (Get-Date).AddHours($Hours)

$env:DATABASE_URL = 'postgresql://food_app:HoiBep2026StrongPwd@localhost:5432/food_app'
$env:IMAGE_STORAGE_DIR = Join-Path $repo 'storage\restaurant-images'
$env:AI_BASE_URL = 'http://localhost:11434/v1'
$env:AI_API_KEY = 'ollama'
$env:AI_VISION_MODEL = 'minicpm-v:latest'
$env:AI_MAX_OUTPUT_TOKENS = '384'
$env:AI_REQUEST_TIMEOUT_MS = '90000'
# Requests are already serialized with concurrency=1. A per-image delay only
# adds idle time without protecting Ollama from concurrent requests.
$env:AI_DELAY_MS = '0'
$interBatchDelaySeconds = 5

function Log([string]$message) {
  Add-Content -LiteralPath (Join-Path $logDir 'ocr.log') -Value "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] $message"
}

Log "START deadline=$($deadline.ToString('o'))"
while ((Get-Date) -lt $deadline) {
  Push-Location $repo
  try {
    Log 'BATCH_START batchSize=100 concurrency=1 menuOnly=true'
    & npm run enrich:menu-images --workspace crawler -- --menu-only --batch-size 100 --concurrency 1 2>&1 | Tee-Object -FilePath (Join-Path $logDir 'ocr.log') -Append
    Log "BATCH_END exit=$LASTEXITCODE"
  } catch {
    Log "BATCH_ERROR $($_.Exception.Message)"
  } finally {
    Pop-Location
  }
  if ((Get-Date) -ge $deadline) { break }
  # The next batch re-reads the database and naturally skips completed images.
  # Keep only a short breathing room instead of idling for a full minute.
  Start-Sleep -Seconds $interBatchDelaySeconds
}
Log 'FINISHED'
