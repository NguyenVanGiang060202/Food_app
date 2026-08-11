# ci-local.ps1
# Chạy toàn bộ các bước của CI (.github/workflows/ci.yml) trên máy local,
# để kiểm tra trước khi push lên GitHub Actions.
#
# Cách dùng (từ thư mục gốc repo):
#   powershell -ExecutionPolicy Bypass -File scripts/ci-local.ps1
#   powershell -ExecutionPolicy Bypass -File scripts/ci-local.ps1 -SkipE2E
#   powershell -ExecutionPolicy Bypass -File scripts/ci-local.ps1 -SkipFrontendImage
#
# Nếu một bước fail, script vẫn chạy hết các bước còn lại, in bảng tổng kết
# ở cuối và trả exit code != 0 khi có bất kỳ bước nào fail.

param(
  [switch]$SkipE2E,
  [switch]$SkipFrontendImage,
  [switch]$SkipDatabase
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$passed = @()
$failed = @()

function Invoke-Step {
  param(
    [string]$Name,
    [ScriptBlock]$Body
  )
  Write-Host "`n===== $Name ====="
  try {
    & $Body
    if ($LASTEXITCODE -is [int] -and $LASTEXITCODE -ne 0) { throw "exit code $LASTEXITCODE" }
    $script:passed += $Name
    Write-Host "[PASS] $Name"
  } catch {
    $script:failed += $Name
    Write-Host "[FAIL] $Name :: $($_.Exception.Message)"
  }
}

$containerName = 'food-app-postgres-ci-local'

Invoke-Step 'Install/cache check (npm ci not repeated; node_modules present)' {
  if (-not (Test-Path node_modules)) { throw 'node_modules missing - run npm install first' }
  Write-Host 'node_modules present'
}

Invoke-Step 'Workspace typechecks (npm run check)' {
  npm run check
}

Invoke-Step 'Backend tests' {
  npm test --workspace backend
}

Invoke-Step 'Crawler tests' {
  npm test --workspace crawler
}

Invoke-Step 'Build backend' {
  npm run build --workspace backend
}

Invoke-Step 'Build crawler' {
  npm run build --workspace crawler
}

Invoke-Step 'Build frontend' {
  npm run build --workspace frontend
}

Invoke-Step 'Frontend unit tests' {
  npm test --workspace frontend
}

if (-not $SkipE2E) {
  Invoke-Step 'Install Playwright browser' {
    npx playwright install chromium
  }

  Invoke-Step 'Frontend browser tests (test:e2e)' {
    npm run test:e2e --workspace frontend
  }
} else {
  Write-Host "`n[SKIP] Install Playwright browser + Frontend browser tests (da dung -SkipE2E)"
}

if (-not $SkipFrontendImage) {
  Invoke-Step 'Build frontend production image + validate nginx (canh bao: can Docker)' {
    docker build --file frontend/Dockerfile --tag food-app-frontend-local:ci .
  }

  Invoke-Step 'Validate frontend Nginx configuration' {
    docker run --rm --add-host backend:127.0.0.1 food-app-frontend-local:ci nginx -t
    if ($LASTEXITCODE -ne 0) { throw 'nginx -t failed' }
  }
} else {
  Write-Host "`n[SKIP] Build frontend production image (da dung -SkipFrontendImage)"
}

if (-not $SkipDatabase) {
  Invoke-Step 'Database: build postgres image' {
    docker build --file database/docker/Dockerfile --tag food-app-postgres-local:ci .
  }

  Invoke-Step 'Database: start clean database' {
    docker rm --force $containerName | Out-Null
    docker run --detach --name $containerName `
      --env POSTGRES_DB=food_app `
      --env POSTGRES_USER=food_app `
      --env POSTGRES_PASSWORD=ci-only-password `
      food-app-postgres-local:ci
    if ($LASTEXITCODE -ne 0) { throw 'docker run failed' }
  }

  Invoke-Step 'Database: wait for readiness + validate schema' {
    $pgReady = $false
    for ($i = 1; $i -le 30; $i++) {
      docker exec $containerName pg_isready -U food_app -d food_app 2>$null | Out-Null
      if ($LASTEXITCODE -eq 0) { $pgReady = $true; break }
      Start-Sleep -Seconds 2
    }
    if (-not $pgReady) {
      docker logs $containerName
      throw 'database did not become ready'
    }

    $schemaReady = $false
    for ($i = 1; $i -le 30; $i++) {
      $haveIndex = docker exec $containerName psql -U food_app -d food_app -tAc `
        "SELECT 1 FROM pg_indexes WHERE indexname = 'restaurant_image_source_url_uidx'" 2>$null
      if ("$haveIndex".Trim() -eq '1') { $schemaReady = $true; break }
      Start-Sleep -Seconds 2
    }
    if (-not $schemaReady) {
      docker logs $containerName
      docker exec $containerName psql -U food_app -d food_app -c "SELECT schemaname, tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename;"
      throw 'schema not ready (restaurant_image_source_url_uidx missing)'
    }

    $validateSql = @'
DO $verify$
DECLARE
  extension_count integer;
BEGIN
  SELECT count(*) INTO extension_count
  FROM pg_extension
  WHERE extname IN ('postgis', 'vector', 'pg_trgm', 'unaccent', 'pgcrypto');
  IF extension_count <> 5 THEN
    RAISE EXCEPTION 'Expected 5 required extensions, found %', extension_count;
  END IF;

  IF to_regclass('public.restaurant') IS NULL
     OR to_regclass('public.app_user') IS NULL
     OR to_regclass('public.restaurant_image') IS NULL THEN
    RAISE EXCEPTION 'One or more core tables are missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'app_user_role_check'
  ) THEN
    RAISE EXCEPTION 'app_user_role_check is missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE indexname = 'restaurant_image_source_url_uidx'
  ) THEN
    RAISE EXCEPTION 'restaurant_image_source_url_uidx is missing';
  END IF;
END
$verify$;
'@
    $tmpSql = Join-Path $env:TEMP 'food-app-validate-schema.sql'
    [System.IO.File]::WriteAllText($tmpSql, $validateSql, (New-Object System.Text.UTF8Encoding($false)))
    $null = Get-Content -Raw $tmpSql | docker exec -i $containerName psql -v ON_ERROR_STOP=1 -U food_app -d food_app
    if ($LASTEXITCODE -ne 0) {
      docker logs $containerName
      throw 'schema validation failed'
    }
  }

  Invoke-Step 'Database: remove container' {
    docker rm --force $containerName | Out-Null
  }
} else {
  Write-Host "`n[SKIP] Database job (da dung -SkipDatabase)"
}

Set-Location $root

Write-Host "`n========== TONG KET =========="
Write-Host "PASS: $($passed.Count)"
$passed | ForEach-Object { Write-Host "  [PASS] $_" }
if ($failed.Count -gt 0) {
  Write-Host "FAIL: $($failed.Count)"
  $failed | ForEach-Object { Write-Host "  [FAIL] $_" }
} else {
  Write-Host "Khong co buoc nao fail - san de push."
}

if ($failed.Count -gt 0) { exit 1 }
exit 0