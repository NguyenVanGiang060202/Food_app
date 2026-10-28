param(
  [ValidateSet('supervisor', 'website', 'crawl', 'menu-refresh', 'cache', 'ocr', 'profile-sync')]
  [string]$Mode = 'supervisor',
  [string]$DeadlineIso = '',
  [string]$LogDir = ''
)

$ErrorActionPreference = 'Continue'
$utf8 = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = $utf8
$OutputEncoding = $utf8
$repo = Split-Path -Parent $PSScriptRoot
if (-not $LogDir) { $LogDir = Join-Path $repo 'tmp\recommendation-maintenance-3h' }
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

function Import-DotEnv {
  $envFile = Join-Path $repo '.env'
  if (-not (Test-Path -LiteralPath $envFile)) { return }
  foreach ($line in Get-Content -LiteralPath $envFile) {
    if ($line -match '^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$') {
      $name = $Matches[1]
      $value = $Matches[2].Trim()
      if ($value.Length -ge 2 -and (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'")))) {
        $value = $value.Substring(1, $value.Length - 2)
      }
      if (-not [Environment]::GetEnvironmentVariable($name)) {
        [Environment]::SetEnvironmentVariable($name, $value, 'Process')
      }
    }
  }
}

Import-DotEnv

function Write-Log([string]$name, [string]$line) {
  Add-Content -LiteralPath (Join-Path $LogDir "$name.log") -Encoding UTF8 -Value "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] $line"
}

function Set-WorkerEnvironment {
  if (-not $env:DATABASE_URL) {
    $dbName = if ($env:POSTGRES_DB) { $env:POSTGRES_DB } else { 'food_app' }
    $dbUser = if ($env:POSTGRES_USER) { $env:POSTGRES_USER } else { 'food_app' }
    $dbPassword = if ($env:POSTGRES_PASSWORD) { $env:POSTGRES_PASSWORD } else { throw 'POSTGRES_PASSWORD or DATABASE_URL must be configured in .env.' }
    $dbPort = if ($env:POSTGRES_PORT) { $env:POSTGRES_PORT } else { '5432' }
    $env:DATABASE_URL = "postgresql://$([uri]::EscapeDataString($dbUser)):$([uri]::EscapeDataString($dbPassword))@localhost:$dbPort/$dbName"
  }
  $env:IMAGE_STORAGE_DIR = Join-Path $repo 'storage\restaurant-images'
  $env:AI_BASE_URL = 'http://localhost:11434/v1'
  $env:AI_API_KEY = 'ollama'
  $env:AI_VISION_MODEL = 'minicpm-v:latest'
  # Keep MiniCPM-V from entering a repetitive generation loop on noisy menu
  # photos. Raw OCR remains auditable; only curated evidence can affect exact
  # recommendation retrieval.
  $env:AI_MAX_OUTPUT_TOKENS = '384'
  $env:AI_REQUEST_TIMEOUT_MS = '90000'
  $env:AI_DELAY_MS = '100'
  $env:CRAWL_CITY = 'Ho Chi Minh City'
  $env:CRAWL_DISTRICTS = ''
  $env:CRAWL_LIMIT_PER_QUERY = '6'
  # Keep the high-value dish-first coverage focused. These are deliberately
  # ASCII because Windows PowerShell 5.1 can corrupt Vietnamese CLI/env text
  # before Node receives it; the batch crawler also normalizes its built-in
  # district list at the browser boundary.
  $env:CRAWL_QUERIES = 'bun bo hue,bun rieu,bun thit nuong,bun dau mam tom,pho bo,pho ga,hu tieu nam vang,mi quang,banh canh cua,banh mi thit,banh mi thit nuong,mi xao hai san,banh xeo,com tam suon,com ga,com nieu,lau bo,lau Thai,ga nuong,vit quay,oc,hai san nuong,pizza hai san,sushi ca hoi,mi cay,chao long,che,ca phe trung'
  $env:CRAWL_MAX_QUERIES = '350'
  $env:CRAWL_MAX_SCROLL_ATTEMPTS = '8'
  $env:CRAWL_MAX_REVIEWS_PER_PLACE = '0'
  $env:CRAWL_HEADLESS = 'true'
  $env:CRAWL_HEARTBEAT_SECONDS = '15'
  $env:CRAWL_DELAY_MS = '700'
}

function Invoke-Worker([string]$workerMode, [datetime]$deadline) {
  Set-WorkerEnvironment
  $name = $workerMode
  $logPath = Join-Path $LogDir "$name.log"
  $siteOffset = 0
  while ((Get-Date) -lt $deadline) {
    if ($workerMode -eq 'website') {
      $label = "first-party structured menu sweep offset=$siteOffset"
      $npmArgs = @('run', 'ingest:website-menu', '--workspace', 'crawler', '--',
        '--all-sites', '--auto-structured-only', '--dry-run', '--limit', '40', '--offset', [string]$siteOffset)
    } elseif ($workerMode -eq 'crawl') {
      $label = 'crawl:playwright:batch'
      $npmArgs = @('run', 'crawl:playwright:batch', '--workspace', 'crawler')
    } elseif ($workerMode -eq 'menu-refresh') {
      $label = 'refresh:menu --limit 200 --concurrency 2'
      $npmArgs = @('run', 'refresh:menu', '--workspace', 'crawler', '--', '--limit', '200', '--concurrency', '2', '--delay-ms', '700')
    } elseif ($workerMode -eq 'cache') {
      $label = 'cache:images --menu-only'
      $npmArgs = @('run', 'cache:images', '--workspace', 'crawler', '--', '--menu-only', '--limit', '500', '--concurrency', '8', '--retry-failed')
    } elseif ($workerMode -eq 'ocr') {
      $label = 'enrich:menu-images --menu-only'
      $npmArgs = @('run', 'enrich:menu-images', '--workspace', 'crawler', '--', '--menu-only', '--batch-size', '50', '--concurrency', '1')
    } else {
      $label = 'sync recommendation profiles and embeddings'
      $npmArgs = @('powershell', '-ExecutionPolicy', 'Bypass', '-File', (Join-Path $repo 'scripts\sync-recommendation-derived.ps1'), '-DeadlineIso', $deadline.ToString('o'), '-LogDir', $LogDir)
    }
    Write-Log $name "START $label"
    Push-Location $repo
    try {
      if ($workerMode -eq 'profile-sync') {
        & $npmArgs[0] @($npmArgs | Select-Object -Skip 1) 2>&1 | Out-File -LiteralPath $logPath -Append -Encoding UTF8
      } else {
        & npm @npmArgs 2>&1 | Out-File -LiteralPath $logPath -Append -Encoding UTF8
      }
    $exitCode = $LASTEXITCODE
    Write-Log $name "END exit=$exitCode"
    } catch {
      Write-Log $name "ERROR $($_.Exception.Message)"
    } finally {
      Pop-Location
    }
    if ((Get-Date) -ge $deadline) { break }
    # The batch crawler is a finite 350-query sweep. Re-running it every
    # 15 seconds only repeats already-completed queries and starves the
    # menu/image workers, so release that worker after one successful pass.
    if ($workerMode -eq 'crawl') { break }
    if ($workerMode -eq 'website') {
      $siteOffset += 40
      if ($siteOffset -ge 1600) { break }
      continue
    }
    if ($workerMode -eq 'profile-sync') { break }
    if ($workerMode -eq 'ocr') { Start-Sleep -Seconds 60 } else { Start-Sleep -Seconds 15 }
  }
  Write-Log $name 'WORKER_FINISHED'
}

if ($Mode -ne 'supervisor') {
  if (-not $DeadlineIso) { throw 'DeadlineIso is required for worker mode.' }
  Invoke-Worker $Mode ([datetime]::Parse($DeadlineIso))
  exit 0
}

$started = Get-Date
$deadline = $started.AddHours(3)
Write-Log 'supervisor' "STARTED deadline=$($deadline.ToString('o'))"
$workerProcesses = @()
try {
  foreach ($workerMode in @('website', 'crawl', 'menu-refresh', 'cache', 'ocr', 'profile-sync')) {
    $arguments = @(
      '-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden',
      '-File', $PSCommandPath,
      '-Mode', $workerMode,
      '-DeadlineIso', $deadline.ToString('o'),
      '-LogDir', $LogDir
    )
    $worker = Start-Process -FilePath 'powershell.exe' -ArgumentList $arguments -WorkingDirectory $repo -WindowStyle Hidden -PassThru
    $workerProcesses += $worker
    Write-Log 'supervisor' "STARTED worker=$workerMode pid=$($worker.Id)"
  }

  while ((Get-Date) -lt $deadline) {
    $running = @($workerProcesses | Where-Object { -not $_.HasExited }).Count
    Write-Log 'supervisor' "RUNNING remaining_minutes=$([int]($deadline - (Get-Date)).TotalMinutes) workers=$running"
    Start-Sleep -Seconds 60
  }
} finally {
  Write-Log 'supervisor' 'DEADLINE_REACHED stopping workers'
  foreach ($worker in $workerProcesses) {
    if (-not $worker.HasExited) {
      & taskkill.exe /PID $worker.Id /T /F 2>&1 | Out-Null
    }
  }
  Write-Log 'supervisor' 'WORKERS_STOPPED shutdown_is_scheduled_by_windows'
}
