param(
  [string]$Manifest = 'crawler/data/gochue-official-pdf-menu-2026-10-22.json',
  [string]$PdfFile = 'tmp/pdfs/gochue-official-menu-20261022.pdf',
  [string]$PageImagePattern = 'tmp/pdfs/gochue-page-{0}.png',
  [switch]$Apply
)

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$manifestPath = Join-Path $repo $Manifest
$review = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
$pdfPath = Join-Path $repo $PdfFile
if (-not (Test-Path -LiteralPath $pdfPath)) { throw "Reviewed PDF is missing: $pdfPath" }
$hash = (Get-FileHash -LiteralPath $pdfPath -Algorithm SHA256).Hash.ToLowerInvariant()
if ($hash -ne $review.sourceSha256) { throw 'Official PDF changed since visual review; re-review before import.' }

$pages = @($review.pages)
$files = @($pages | ForEach-Object {
  $file = Join-Path $repo ($PageImagePattern -f $_.number)
  if (-not (Test-Path -LiteralPath $file)) { throw "Rendered page is missing: $file" }
  $file
})
if (-not $Apply) {
  [pscustomobject]@{
    Mode = 'dry-run'
    Restaurants = @($review.restaurantIds).Count
    Pages = @($pages | ForEach-Object number)
    DishesPerRestaurant = @($pages | ForEach-Object entries).Count
    SourceSha256 = $hash
  }
  return
}

$settings = @{}
foreach ($line in Get-Content -LiteralPath (Join-Path $repo '.env')) {
  if ($line -match '^\s*(POSTGRES_DB|POSTGRES_USER|POSTGRES_PASSWORD|POSTGRES_PORT)=(.*)$') {
    $settings[$matches[1]] = $matches[2].Trim('"', "'")
  }
}
if (-not $settings.POSTGRES_PASSWORD) { throw 'POSTGRES_PASSWORD is missing from .env.' }
$database = if ($settings.POSTGRES_DB) { $settings.POSTGRES_DB } else { 'food_app' }
$user = if ($settings.POSTGRES_USER) { $settings.POSTGRES_USER } else { 'food_app' }
$port = if ($settings.POSTGRES_PORT) { $settings.POSTGRES_PORT } else { '5432' }
$previousDatabaseUrl = $env:DATABASE_URL
$previousImageStorageDir = $env:IMAGE_STORAGE_DIR
$env:DATABASE_URL = 'postgresql://{0}:{1}@127.0.0.1:{2}/{3}' -f [uri]::EscapeDataString($user), [uri]::EscapeDataString($settings.POSTGRES_PASSWORD), $port, $database
$env:IMAGE_STORAGE_DIR = Join-Path $repo 'storage/restaurant-images'

Push-Location $repo
try {
  foreach ($restaurantId in @($review.restaurantIds)) {
    $ingestArgs = @('run', 'ingest:local-menu', '--workspace', 'crawler', '--', '--restaurant-id', $restaurantId)
    foreach ($file in $files) { $ingestArgs += @('--file', $file) }
    $ingestOutput = & npm @ingestArgs
    if ($LASTEXITCODE -ne 0) { throw "Menu image import failed for $restaurantId." }
    $joined = $ingestOutput -join "`n"
    $jsonStart = $joined.IndexOf('{')
    if ($jsonStart -lt 0) { throw "Menu image import did not return image IDs for $restaurantId." }
    $result = $joined.Substring($jsonStart) | ConvertFrom-Json
    if ($result.event -ne 'local_menu_imported' -or @($result.images).Count -ne $pages.Count) {
      throw "Menu image import returned incomplete data for $restaurantId."
    }
    for ($index = 0; $index -lt $pages.Count; $index++) {
      $page = $pages[$index]
      $image = $result.images[$index]
      $curateArgs = @('run', 'curate:menu-image', '--workspace', 'crawler', '--',
        '--restaurant-id', $restaurantId, '--image-id', $image.imageId,
        '--official-pdf-url', $review.sourceUrl, '--official-pdf-page', [string]$page.number)
      foreach ($entry in @($page.entries)) { $curateArgs += @('--entry', $entry) }
      & npm @curateArgs | Out-Null
      if ($LASTEXITCODE -ne 0) { throw "Menu curation failed for $restaurantId page $($page.number)." }
      Write-Host "Curated official PDF page $($page.number) for ${restaurantId}: $(@($page.entries).Count) dishes"
    }
  }
} finally {
  Pop-Location
  if ($null -eq $previousDatabaseUrl) { Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue }
  else { $env:DATABASE_URL = $previousDatabaseUrl }
  if ($null -eq $previousImageStorageDir) { Remove-Item Env:IMAGE_STORAGE_DIR -ErrorAction SilentlyContinue }
  else { $env:IMAGE_STORAGE_DIR = $previousImageStorageDir }
}
