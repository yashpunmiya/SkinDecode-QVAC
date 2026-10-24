# Destructive remote replacement. Run only after confirming the compact CSV source.
$ErrorActionPreference = 'Stop'

$supabaseCli = (Get-Command .\node_modules\.bin\supabase.cmd -ErrorAction Stop).Source
$dryRun = (& $supabaseCli db dump --linked --schema skindecode_catalog --dry-run | Out-String)
$connection = @{
  PGHOST = [regex]::Match($dryRun, 'export PGHOST="([^"]+)"').Groups[1].Value
  PGPORT = [regex]::Match($dryRun, 'export PGPORT="([^"]+)"').Groups[1].Value
  PGUSER = [regex]::Match($dryRun, 'export PGUSER="([^"]+)"').Groups[1].Value
  PGPASSWORD = [regex]::Match($dryRun, 'export PGPASSWORD="([^"]+)"').Groups[1].Value
  PGDATABASE = [regex]::Match($dryRun, 'export PGDATABASE="([^"]+)"').Groups[1].Value
}

if ([string]::IsNullOrWhiteSpace($connection.PGHOST) -or
    [string]::IsNullOrWhiteSpace($connection.PGPORT) -or
    [string]::IsNullOrWhiteSpace($connection.PGUSER) -or
    [string]::IsNullOrWhiteSpace($connection.PGPASSWORD) -or
    [string]::IsNullOrWhiteSpace($connection.PGDATABASE)) {
  throw 'Could not prepare the linked database connection; no changes were made.'
}

$previous = @{}
foreach ($name in $connection.Keys) {
  $previous[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
  [Environment]::SetEnvironmentVariable($name, $connection[$name], 'Process')
}

try {
  $psql = (Get-Command psql -ErrorAction Stop).Source
  & $psql --host $connection.PGHOST --port $connection.PGPORT --username $connection.PGUSER `
    --dbname $connection.PGDATABASE --no-psqlrc --single-transaction `
    --set ON_ERROR_STOP=1 --file updated_db/install_compact_catalog.psql
  if ($LASTEXITCODE -ne 0) { throw 'Catalog replacement failed; the single transaction was rolled back.' }
}
finally {
  foreach ($name in $connection.Keys) {
    [Environment]::SetEnvironmentVariable($name, $previous[$name], 'Process')
  }
}
