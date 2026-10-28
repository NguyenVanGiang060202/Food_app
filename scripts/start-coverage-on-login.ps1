param(
  [int]$WorkerHours = 24
)

$ErrorActionPreference = 'Continue'
$repo = Split-Path -Parent $PSScriptRoot
$logDir = Join-Path $repo 'tmp\targeted-menu-coverage'
$logFile = Join-Path $logDir 'autostart.log'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

# A registry Startup entry and a manual launch can coexist after a reboot.
# Keep one watchdog so it cannot create competing dashboards/supervisors.
$mutex = New-Object System.Threading.Mutex($false, 'Local\FoodAppCoverageAutostart')
if (-not $mutex.WaitOne(0, $false)) { exit 0 }

function Write-Log([string]$message) {
  Add-Content -LiteralPath $logFile -Value "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] $message"
}

function Test-DockerReady {
  docker info *> $null
  return $LASTEXITCODE -eq 0
}

function Test-OllamaReady {
  try {
    $tags = Invoke-RestMethod -Uri 'http://127.0.0.1:11434/api/tags' -TimeoutSec 5
    return @($tags.models | Where-Object { $_.name -match '^minicpm-v(?::latest)?$' }).Count -gt 0
  } catch {
    return $false
  }
}

function Test-PortOpen([int]$port) {
  return @(Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue).Count -gt 0
}

function Ensure-LocalStack {
  if (-not (Test-DockerReady)) { return $false }
  Push-Location $repo
  try {
    docker compose --profile production up -d *> (Join-Path $logDir 'docker-autostart.log')
    if ($LASTEXITCODE -ne 0) {
      Write-Log 'Docker Compose failed; retrying on the next watchdog pass.'
      return $false
    }
  } finally {
    Pop-Location
  }
  return $true
}

function Ensure-Dashboard {
  if (Test-PortOpen 8766) { return }
  Write-Log 'Starting coverage dashboard.'
  Start-Process -FilePath 'npm.cmd' -ArgumentList @('run', 'coverage:dashboard', '--workspace', 'crawler') -WorkingDirectory $repo -WindowStyle Hidden
}

function Ensure-CoverageSupervisor {
  $running = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -match 'run-targeted-menu-coverage\.ps1' -and $_.CommandLine -match '-Mode\s+supervisor' }
  if ($running) { return }
  $deadline = (Get-Date).AddHours([Math]::Max(1, $WorkerHours)).ToString('o')
  Write-Log "Starting coverage supervisor; deadline=$deadline."
  Start-Process -FilePath 'powershell.exe' -ArgumentList @(
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden',
    '-File', (Join-Path $repo 'scripts\run-targeted-menu-coverage.ps1'),
    '-Mode', 'supervisor', '-DeadlineIso', $deadline, '-LogDir', $logDir
  ) -WorkingDirectory $repo -WindowStyle Hidden
}

Write-Log 'Autostart watchdog started.'
try {
  while ($true) {
    if (-not (Test-DockerReady)) {
      Write-Log 'Waiting for Docker Desktop.'
      Start-Sleep -Seconds 30
      continue
    }
    if (-not (Test-OllamaReady)) {
      Write-Log 'Waiting for Ollama minicpm-v:latest.'
      Start-Sleep -Seconds 30
      continue
    }
    if (Ensure-LocalStack) {
      Ensure-Dashboard
      Ensure-CoverageSupervisor
    }
    Start-Sleep -Seconds 60
  }
} finally {
  $mutex.ReleaseMutex()
  $mutex.Dispose()
}
