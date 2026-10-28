param(
  [Parameter(Mandatory = $true)][string]$Manifest,
  [Parameter(Mandatory = $true)][string]$ImageFile,
  [switch]$Apply
)

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$manifestPath = Join-Path $repo $Manifest
$review = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
$imagePath = (Resolve-Path -LiteralPath $ImageFile).Path
$hash = (Get-FileHash -LiteralPath $imagePath -Algorithm SHA256).Hash.ToLowerInvariant()
if ($hash -ne $review.sourceSha256) { throw 'Official menu image changed since visual review.' }
if (@($review.entries).Count -lt 1 -or @($review.entries).Count -gt 100) { throw 'Expected 1..100 individually reviewed menu entries.' }
if (@($review.entries | Select-Object -Unique).Count -ne @($review.entries).Count) { throw 'Duplicate reviewed entries.' }
$pageUri = [uri]$review.sourcePage
$imageUri = [uri]$review.sourceImage
$officialLinkedCdn = $pageUri.Host -eq 'alfrescos.com.vn' -and $imageUri.Host -eq 'core.afg.vn'
if ($pageUri.Scheme -ne 'https' -or $imageUri.Scheme -ne 'https' -or
    ($pageUri.Host -ne $imageUri.Host -and -not $officialLinkedCdn)) {
  throw 'The official page and menu image must use HTTPS on the same host or the verified AFG menu CDN.'
}
$page = Invoke-WebRequest -Uri $review.sourcePage -UseBasicParsing -TimeoutSec 25
$linkedImage = $page.Content.Contains($review.sourceImage) -or
  $page.Content.Contains($imageUri.AbsolutePath)
if (-not $linkedImage) { throw 'The reviewed image is no longer linked from the official menu page.' }

if (-not $Apply) {
  [pscustomobject]@{ Mode = 'dry-run'; Restaurant = $review.restaurant; Entries = @($review.entries).Count; SourceSha256 = $hash; SourcePage = $review.sourcePage }
  return
}

$settings = @{}
foreach ($line in Get-Content -LiteralPath (Join-Path $repo '.env')) {
  if ($line -match '^\s*(POSTGRES_DB|POSTGRES_USER|POSTGRES_PASSWORD|POSTGRES_PORT)=(.*)$') {
    $settings[$matches[1]] = $matches[2].Trim('"', "'")
  }
}
if (-not $settings.POSTGRES_PASSWORD) { throw 'Local database password is missing.' }
$database = if ($settings.POSTGRES_DB) { $settings.POSTGRES_DB } else { 'food_app' }
$user = if ($settings.POSTGRES_USER) { $settings.POSTGRES_USER } else { 'food_app' }
$port = if ($settings.POSTGRES_PORT) { $settings.POSTGRES_PORT } else { '5432' }
$previousDatabaseUrl = $env:DATABASE_URL
$previousImageStorageDir = $env:IMAGE_STORAGE_DIR
$env:DATABASE_URL = 'postgresql://{0}:{1}@127.0.0.1:{2}/{3}' -f [uri]::EscapeDataString($user), [uri]::EscapeDataString($settings.POSTGRES_PASSWORD), $port, $database
$env:IMAGE_STORAGE_DIR = Join-Path $repo 'storage/restaurant-images'

Push-Location $repo
try {
  $ingestOutput = & npm run ingest:local-menu --workspace crawler -- --restaurant-id $review.restaurantId --file $imagePath
  if ($LASTEXITCODE -ne 0) { throw 'Official menu image ingest failed.' }
  $joined = $ingestOutput -join "`n"
  $jsonStart = $joined.IndexOf('{')
  if ($jsonStart -lt 0) { throw 'Menu image ingest did not return an image ID.' }
  $result = $joined.Substring($jsonStart) | ConvertFrom-Json
  if ($result.event -ne 'local_menu_imported' -or @($result.images).Count -ne 1) { throw 'Unexpected menu image ingest result.' }
  $imageId = $result.images[0].imageId
  $curateArgs = @('run', 'curate:menu-image', '--workspace', 'crawler', '--',
    '--restaurant-id', $review.restaurantId, '--image-id', $imageId,
    '--official-menu-image-url', $review.sourceImage, '--official-menu-image-sha256', $review.sourceSha256)
  foreach ($entry in @($review.entries)) { $curateArgs += @('--entry', $entry) }
  & npm @curateArgs | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Official menu image curation failed.' }
  [pscustomobject]@{ Mode = 'applied'; RestaurantId = $review.restaurantId; ImageId = $imageId; Entries = @($review.entries).Count; SourceSha256 = $hash }
} finally {
  Pop-Location
  if ($null -eq $previousDatabaseUrl) { Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue }
  else { $env:DATABASE_URL = $previousDatabaseUrl }
  if ($null -eq $previousImageStorageDir) { Remove-Item Env:IMAGE_STORAGE_DIR -ErrorAction SilentlyContinue }
  else { $env:IMAGE_STORAGE_DIR = $previousImageStorageDir }
}
