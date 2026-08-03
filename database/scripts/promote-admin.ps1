param(
  [Parameter(Mandatory = $true)]
  [string]$Email,
  [string]$Database = 'food_app',
  [string]$User = 'food_app'
)

$ErrorActionPreference = 'Stop'
$normalizedEmail = $Email.Trim().ToLowerInvariant()
if ($normalizedEmail -notmatch '^[^\s@]+@[^\s@]+\.[^\s@]+$') {
  throw 'Email must be a valid address.'
}

docker compose exec -T postgres pg_isready -U $User -d $Database *> $null
if ($LASTEXITCODE -ne 0) {
  throw 'The postgres service is not ready. Start the database before promoting an admin.'
}

$sql = @'
UPDATE app_user
SET role = 'admin'
WHERE email = :'admin_email'
  AND email_verified_at IS NOT NULL;

SELECT id, email, role
FROM app_user
WHERE email = :'admin_email';
'@

$output = $sql | docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -v admin_email="$normalizedEmail" -U $User -d $Database
if ($LASTEXITCODE -ne 0) {
  throw 'Could not promote the requested user.'
}

Write-Output $output
if ($output -notmatch 'admin') {
  throw 'No verified user was promoted. Check the email address and verification status.'
}