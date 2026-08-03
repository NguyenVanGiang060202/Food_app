param(
  [string]$District,
  [string]$City = 'Ho Chi Minh City',
  [int]$LimitPerQuery = 10,
  [string]$Queries = '',
  [int]$MaxReviewsPerPlace = 5,
  [switch]$Headless
)

$ErrorActionPreference = 'Stop'

$crawlerDir = Split-Path -Parent $PSScriptRoot
$districtsFile = Join-Path $PSScriptRoot 'districts.txt'
$districts = @(Get-Content -LiteralPath $districtsFile -Encoding UTF8 | Where-Object { $_.Trim() })

if ($District) {
  $selected = @($District.Trim())
} else {
  $selected = $districts
}

foreach ($name in $selected) {
  $env:CRAWL_CITY = $City
  $env:CRAWL_DISTRICTS = $name
  $env:CRAWL_LIMIT_PER_QUERY = [string]$LimitPerQuery
  $env:CRAWL_MAX_REVIEWS_PER_PLACE = [string]$MaxReviewsPerPlace
  $env:CRAWL_HEADLESS = if ($Headless) { 'true' } else { 'false' }
  if ($Queries) { $env:CRAWL_QUERIES = $Queries }
  else { Remove-Item Env:CRAWL_QUERIES -ErrorAction SilentlyContinue }

  Write-Host "== Crawling: $name =="
  & node "C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js" run crawl:playwright:batch --workspace crawler
  if ($LASTEXITCODE -ne 0) { Write-Host "!! Failed: $name" }
}
