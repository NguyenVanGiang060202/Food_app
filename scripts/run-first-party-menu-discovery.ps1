param(
  [string]$DeadlineIso,
  [string]$LogDir = '',
  [int]$BatchSize = 25,
  [int]$MaxOffset = 650
)

# The underlying npm command reports per-site skips on stderr; those are
# expected diagnostics in Windows PowerShell, not batch-fatal exceptions.
$ErrorActionPreference = 'Continue'
$utf8 = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = $utf8
$OutputEncoding = $utf8
$repo = Split-Path -Parent $PSScriptRoot
if (-not $LogDir) { $LogDir = Join-Path $repo 'tmp\verified-menu-coverage-20261021' }
New-Item -ItemType Directory -Path $LogDir -Force | Out-Null
$deadline = [datetime]::Parse($DeadlineIso)
$candidatesPath = Join-Path $LogDir 'first-party-candidates.ndjson'
$progressPath = Join-Path $LogDir 'discovery.log'
$summaryPath = Join-Path $LogDir 'first-party-sites.csv'
$terms = @('pho','bun','mi','com','ga','bo','ca','hai san','lau','che','banh','sup','goi','salad','pizza')
$seen = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
$byHost = @{}

for ($offset = 0; $offset -lt $MaxOffset -and (Get-Date) -lt $deadline; $offset += $BatchSize) {
  $batchCount = 0
  try {
    & (Join-Path $repo 'scripts\run-bulk-website-menu.ps1') -Limit $BatchSize -Offset $offset -IncludeCovered -Dish $terms 2>&1 |
      ForEach-Object {
        if ($_ -is [System.Management.Automation.ErrorRecord]) { return }
        $line = [string]$_
        if (-not $line.StartsWith('{"event":"website_menu_candidate"')) { return }
        try { $candidate = $line | ConvertFrom-Json } catch { return }
        $key = "$($candidate.pageUrl)|$($candidate.dish)"
        if (-not $seen.Add($key)) { return }
        try { $hostName = ([uri]$candidate.pageUrl).Host } catch { return }
        $candidate | ConvertTo-Json -Compress -Depth 4 | Add-Content -LiteralPath $candidatesPath -Encoding UTF8
        if (-not $byHost.ContainsKey($hostName)) {
          $byHost[$hostName] = [pscustomobject]@{ Host = $hostName; Count = 0; Restaurant = $candidate.restaurant; Page = $candidate.pageUrl; Samples = @() }
        }
        $site = $byHost[$hostName]
        $site.Count++
        if ($site.Samples.Count -lt 8) { $site.Samples += $candidate.dish }
        $batchCount++
      }
    Add-Content -LiteralPath $progressPath -Encoding UTF8 -Value "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] offset=$offset unique_candidates=$batchCount sites=$($byHost.Count)"
  } catch {
    Add-Content -LiteralPath $progressPath -Encoding UTF8 -Value "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] offset=$offset error=$($_.Exception.Message)"
  }
  $byHost.Values | Sort-Object Count -Descending | ForEach-Object {
    [pscustomobject]@{ Host = $_.Host; Count = $_.Count; Restaurant = $_.Restaurant; Page = $_.Page; Samples = ($_.Samples -join '; ') }
  } | Export-Csv -LiteralPath $summaryPath -NoTypeInformation -Encoding UTF8
}

Add-Content -LiteralPath $progressPath -Encoding UTF8 -Value "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] FINISHED sites=$($byHost.Count) candidates=$($seen.Count)"
