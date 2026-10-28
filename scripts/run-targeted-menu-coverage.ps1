param(
  [ValidateSet('supervisor', 'refresh', 'ocr', 'cache')]
  [string]$Mode = 'supervisor',
  [string]$DeadlineIso = '',
  [string]$LogDir = ''
)

$ErrorActionPreference = 'Continue'
$repo = Split-Path -Parent $PSScriptRoot
if (-not $LogDir) { $LogDir = Join-Path $repo 'tmp\targeted-menu-coverage' }
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

if (-not $env:DATABASE_URL) {
  $dbName = if ($env:POSTGRES_DB) { $env:POSTGRES_DB } else { 'food_app' }
  $dbUser = if ($env:POSTGRES_USER) { $env:POSTGRES_USER } else { 'food_app' }
  $dbPassword = if ($env:POSTGRES_PASSWORD) { $env:POSTGRES_PASSWORD } else { throw 'POSTGRES_PASSWORD is required.' }
  $dbPort = if ($env:POSTGRES_PORT) { $env:POSTGRES_PORT } else { '5432' }
  $env:DATABASE_URL = "postgresql://$([uri]::EscapeDataString($dbUser)):$([uri]::EscapeDataString($dbPassword))@localhost:$dbPort/$dbName"
}

$env:IMAGE_STORAGE_DIR = Join-Path $repo 'storage\restaurant-images'
$env:AI_BASE_URL = 'http://localhost:11434/v1'
$env:AI_API_KEY = 'ollama'
$env:AI_VISION_MODEL = 'minicpm-v:latest'
$env:AI_MAX_OUTPUT_TOKENS = '384'
$env:AI_REQUEST_TIMEOUT_MS = '90000'
$env:AI_DELAY_MS = '150'

$dishes = @('pho bo', 'bun bo hue', 'bun rieu', 'bun thit nuong', 'com ga', 'banh mi thit nuong', 'mi xao hai san', 'mon chay', 'thanh dam')

function Write-Log([string]$name, [string]$line) {
  Add-Content -LiteralPath (Join-Path $LogDir "$name.log") -Value "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] $line"
}

function Invoke-TargetedWorker([string]$workerMode, [datetime]$deadline) {
  $firstPass = $true
  $logPath = Join-Path $LogDir "$workerMode.log"
  while ((Get-Date) -lt $deadline) {
    if ($workerMode -eq 'refresh') {
      $npmArgs = @('run', 'refresh:menu', '--workspace', 'crawler', '--',
        '--dish', 'pho bo', '--dish', 'bun bo hue', '--dish', 'bun rieu', '--dish', 'bun thit nuong',
        '--dish', 'com ga', '--dish', 'banh mi thit nuong', '--dish', 'mi xao hai san', '--dish', 'mon chay',
        '--limit', '160', '--concurrency', '2', '--delay-ms', '900')
      $label = 'Google Maps menu-tab refresh: priority test-case dishes'
    } elseif ($workerMode -eq 'ocr') {
      $npmArgs = @('run', 'enrich:menu-images', '--workspace', 'crawler', '--',
        '--targeted', '--menu-only', '--per-restaurant', '2', '--limit', '300', '--concurrency', '1')
      foreach ($dish in $dishes) { $npmArgs += @('--dish', $dish) }
      if ($firstPass) { $npmArgs += '--refresh' }
      $label = 'Ollama targeted menu OCR: priority test-case dishes'
    } else {
      $npmArgs = @('run', 'cache:images', '--workspace', 'crawler', '--',
        '--menu-only', '--concurrency', '8')
      $label = 'Local cache refresh for newly crawled menu images'
    }
    Write-Log $workerMode "START $label firstPass=$firstPass"
    Push-Location $repo
    try {
      & npm.cmd @npmArgs 2>&1 | Tee-Object -FilePath $logPath -Append
      $exitCode = $LASTEXITCODE
      Write-Log $workerMode "END exit=$exitCode"
    } catch {
      Write-Log $workerMode "ERROR $($_.Exception.Message)"
    } finally {
      Pop-Location
    }
    $firstPass = $false
    if ((Get-Date) -ge $deadline) { break }
    Start-Sleep -Seconds 30
  }
  Write-Log $workerMode 'WORKER_FINISHED'
}

if ($Mode -ne 'supervisor') {
  if (-not $DeadlineIso) { throw 'DeadlineIso is required for worker mode.' }
  Invoke-TargetedWorker $Mode ([datetime]::Parse($DeadlineIso))
  exit 0
}

$deadline = if ($DeadlineIso) { [datetime]::Parse($DeadlineIso) } else { (Get-Date).AddHours(3) }
Write-Log 'supervisor' "STARTED deadline=$($deadline.ToString('o'))"
$workers = @()
try {
  foreach ($workerMode in @('refresh', 'cache', 'ocr')) {
    $arguments = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden',
      '-File', $PSCommandPath, '-Mode', $workerMode,
      '-DeadlineIso', $deadline.ToString('o'), '-LogDir', $LogDir)
    $worker = Start-Process -FilePath 'powershell.exe' -ArgumentList $arguments -WorkingDirectory $repo -WindowStyle Hidden -PassThru
    $workers += $worker
    Write-Log 'supervisor' "STARTED worker=$workerMode pid=$($worker.Id)"
  }
  while ((Get-Date) -lt $deadline) {
    $running = @($workers | Where-Object { -not $_.HasExited }).Count
    Write-Log 'supervisor' "RUNNING remaining_minutes=$([int]($deadline - (Get-Date)).TotalMinutes) workers=$running"
    Start-Sleep -Seconds 60
  }
} finally {
  foreach ($worker in $workers) {
    if (-not $worker.HasExited) { & taskkill.exe /PID $worker.Id /T /F 2>&1 | Out-Null }
  }
  Write-Log 'supervisor' 'DEADLINE_REACHED workers_stopped'
}
