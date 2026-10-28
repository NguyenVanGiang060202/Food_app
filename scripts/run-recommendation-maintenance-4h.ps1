param(
  [int]$Hours = 4,
  [string]$LogDir = ''
)

$ErrorActionPreference = 'Continue'
$repo = 'C:\Users\Admin\Downloads\food-app'
$workerScript = Join-Path $repo 'scripts\run-recommendation-maintenance-3h.ps1'
if (-not $LogDir) { $LogDir = Join-Path $repo 'tmp\recommendation-maintenance-4h-20261004' }
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

function Write-Log([string]$name, [string]$line) {
  Add-Content -LiteralPath (Join-Path $LogDir "$name.log") -Value "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] $line"
}

$deadline = (Get-Date).AddHours($Hours)
Write-Log 'supervisor' "STARTED deadline=$($deadline.ToString('o'))"

# The user explicitly requested an automatic shutdown window. Schedule it now
# so it still happens if this supervisor process is interrupted.
& shutdown.exe /a 2>$null | Out-Null
Start-Process -FilePath 'shutdown.exe' -ArgumentList '/s', '/t', ([int]($Hours * 3600)), '/f', '/c', 'Food recommendation maintenance window finished.' -WindowStyle Hidden
Write-Log 'supervisor' "SHUTDOWN_SCHEDULED seconds=$([int]($Hours * 3600))"

$workerModes = @('website', 'menu-refresh', 'cache', 'ocr', 'profile-sync')
$workers = @()
try {
  foreach ($mode in $workerModes) {
    $args = @(
      '-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden',
      '-File', $workerScript,
      '-Mode', $mode,
      '-DeadlineIso', $deadline.ToString('o'),
      '-LogDir', $LogDir
    )
    $p = Start-Process -FilePath 'powershell.exe' -ArgumentList $args -WorkingDirectory $repo -WindowStyle Hidden -PassThru
    $workers += $p
    Write-Log 'supervisor' "STARTED worker=$mode pid=$($p.Id)"
  }

  while ((Get-Date) -lt $deadline) {
    $running = @($workers | Where-Object { -not $_.HasExited }).Count
    Write-Log 'supervisor' "RUNNING remaining_minutes=$([int]($deadline - (Get-Date)).TotalMinutes) workers=$running"
    Start-Sleep -Seconds 60
  }
} finally {
  Write-Log 'supervisor' 'SUPERVISOR_FINISHED; scheduled shutdown remains active'
}
