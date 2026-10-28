param(
  [switch]$Uninstall,
  [switch]$TaskScheduler
)

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$script = Join-Path $repo 'scripts\start-coverage-on-login.ps1'
$taskName = '\FoodApp\CoverageAutostart'
$identity = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$runKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
$runName = 'FoodAppCoverageAutostart'
$runCommand = "powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$script`""

if ($Uninstall) {
  Remove-ItemProperty -Path $runKey -Name $runName -ErrorAction SilentlyContinue
  if ($TaskScheduler) { schtasks.exe /Delete /TN $taskName /F | Out-Null }
  Write-Output 'Removed FoodApp coverage autostart.'
  exit 0
}

if ($TaskScheduler) {
  $action = $runCommand
  schtasks.exe /Create /TN $taskName /SC ONLOGON /TR $action /RU $identity /RL LIMITED /F
  if ($LASTEXITCODE -ne 0) { throw "Could not register scheduled task: $taskName" }
} else {
  New-Item -Path $runKey -Force | Out-Null
  New-ItemProperty -Path $runKey -Name $runName -Value $runCommand -PropertyType String -Force | Out-Null
  Write-Output "Installed per-user Startup entry: $runName"
}

Write-Output 'It waits for Docker Desktop and Ollama, then starts the local stack, dashboard, and coverage workers.'
