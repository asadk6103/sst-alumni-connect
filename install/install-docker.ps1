<#
  SST Alumni Connect - Docker Compose installer (Windows, Docker Desktop)

  Builds and starts the whole stack with Docker Compose, waits until it is ready and prints
  the one-time setup code. Re-running it upgrades the installation; data volumes are kept.

    powershell -ExecutionPolicy Bypass -File .\install\install-docker.ps1
    powershell -ExecutionPolicy Bypass -File .\install\install-docker.ps1 -Port 80
    powershell -ExecutionPolicy Bypass -File .\install\install-docker.ps1 -Domain alumni.school.pk -Email it@school.pk

  -Port N            port that serves the site over plain HTTP (default 8080)
  -Domain / -Email   serve the site over HTTPS (ports 80/443) with an automatic Let's Encrypt
                     certificate; several names: -Domain "alumni.school.pk,www.alumni.school.pk"
  -Staging           use Let's Encrypt's test service (untrusted certificate, for trial runs)
  -NoHttps           turn HTTPS off again
  -Production        production sizing (docker-compose.prod.yml, 8 GB RAM or more)
  -NoProduction      back to the standard sizing
#>
param(
  [ValidateRange(1, 65535)][int]$Port = 0,
  [string]$Domain = '',
  [string]$Email = '',
  [switch]$Staging,
  [switch]$NoHttps,
  [switch]$Production,
  [switch]$NoProduction
)
$BaseFile = 'docker-compose.yml'
$ProdFile = 'docker-compose.prod.yml'
$LeFile = 'docker-compose.letsencrypt.yml'
$LeStaging = 'https://acme-staging-v02.api.letsencrypt.org/directory'
# Native commands are checked through $LASTEXITCODE (Windows PowerShell 5.1 turns redirected
# native stderr into errors under 'Stop').
$ErrorActionPreference = 'Continue'
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

function Step($t) { Write-Host ''; Write-Host "==> $t" -ForegroundColor Cyan }
function Info($t) { Write-Host "    $t" }
function Warn($t) { Write-Host "WARNING: $t" -ForegroundColor Yellow }
function Fail($t) { Write-Host "ERROR: $t" -ForegroundColor Red; exit 1 }

if (-not (Test-Path $BaseFile) -or -not (Select-String -Path $BaseFile -Pattern '^name: sst-alumni' -Quiet)) {
  Fail 'Run the script from inside the SST Alumni Connect project folder (install\install-docker.ps1).'
}
if ($Domain -and -not $Email) { Fail '-Domain needs -Email (Let''s Encrypt sends certificate notices there).' }
if ($Email -and -not $Domain) { Fail '-Email needs -Domain.' }
if ($Domain -and $NoHttps) { Fail '-Domain and -NoHttps cannot be combined.' }
if ($Production -and $NoProduction) { Fail '-Production and -NoProduction cannot be combined.' }
if ($Domain) {
  $Domain = (($Domain -replace '\s', '') -split ',' | Where-Object { $_ }) -join ', '
  if ($Domain -notmatch '^[A-Za-z0-9.,\- ]+$') { Fail '-Domain may only contain domain names separated by commas.' }
  if ($Email -notmatch '^[^@\s]+@[^@\s]+\.[^@\s]+$') { Fail '-Email is not a valid e-mail address.' }
}
Write-Host 'SST Alumni Connect - Docker Compose installer' -ForegroundColor White

# 1. Docker
Step 'Checking Docker'
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  Fail 'Docker is not installed. Install Docker Desktop: https://www.docker.com/products/docker-desktop/'
}
docker info *> $null
if ($LASTEXITCODE -ne 0) { Fail 'Docker is installed but not running. Start Docker Desktop and try again.' }
$cv = (docker compose version --short 2>$null | Out-String).Trim().TrimStart('v')
if ($LASTEXITCODE -ne 0 -or -not $cv) { Fail 'The Docker Compose plugin is missing. Update Docker Desktop.' }
try { if ([version]($cv -replace '[^0-9.].*$', '') -lt [version]'2.24.0') { Fail "Docker Compose $cv is too old; 2.24 or newer is required. Update Docker Desktop." } } catch { }
Info (docker --version)
Info "Docker Compose $cv"

# 2. .env (infrastructure settings only)
Step 'Preparing configuration'
$envFile = Join-Path $Root '.env'
if (-not (Test-Path $envFile)) {
  Copy-Item (Join-Path $Root '.env.example') $envFile
  Info 'Created .env from .env.example (optional settings only - passwords are generated automatically)'
}
function Get-EnvValue($key) {
  $line = Get-Content $envFile | Where-Object { $_ -match "^$key=" } | Select-Object -Last 1
  if ($line) { return ($line -replace "^$key=", '').Trim().Trim('"', "'") } else { return '' }
}
function Write-EnvLines($lines) {
  # ASCII without BOM so Docker Compose reads the first line correctly
  [IO.File]::WriteAllLines($envFile, [string[]]$lines, (New-Object Text.ASCIIEncoding))
}
function Set-EnvValue($key, $value) {
  $lines = @(Get-Content $envFile | Where-Object { $_ -notmatch "^$key=" })
  $lines += "$key=$value"
  Write-EnvLines $lines
}
function Remove-EnvValue($key) {
  Write-EnvLines @(Get-Content $envFile | Where-Object { $_ -notmatch "^$key=" })
}

if ($Port -gt 0) { Set-EnvValue 'HTTP_PORT' $Port }
$HttpPort = Get-EnvValue 'HTTP_PORT'
if (-not $HttpPort) { $HttpPort = '8080' }

# Which overlays are active: read from COMPOSE_FILE, then apply the options given now.
$cur = ":" + (Get-EnvValue 'COMPOSE_FILE') + ":"
$useProd = $cur.Contains(":${ProdFile}:")
$useLe = $cur.Contains(":${LeFile}:")
if ($Production) { $useProd = $true }
if ($NoProduction) { $useProd = $false }
if ($Domain) { $useLe = $true }
if ($NoHttps) { $useLe = $false }

if ($Domain) {
  Set-EnvValue 'DOMAIN' ('"' + $Domain + '"')
  Set-EnvValue 'ACME_EMAIL' $Email
  if ($Staging) { Set-EnvValue 'ACME_CA' $LeStaging } else { Remove-EnvValue 'ACME_CA' }
} elseif ($NoHttps) {
  foreach ($k in 'DOMAIN', 'ACME_EMAIL', 'ACME_CA') { Remove-EnvValue $k }
  Info 'HTTPS turned off'
}
$files = $BaseFile
if ($useProd) { $files += ":$ProdFile" }
if ($useLe) { $files += ":$LeFile" }
if ($files -eq $BaseFile) {
  Remove-EnvValue 'COMPOSE_FILE'; Remove-EnvValue 'COMPOSE_PATH_SEPARATOR'
} else {
  # Saved in .env so that every later "docker compose ..." command uses the same overlays.
  Set-EnvValue 'COMPOSE_FILE' $files
  Set-EnvValue 'COMPOSE_PATH_SEPARATOR' ':'
}
$env:COMPOSE_FILE = $files
$env:COMPOSE_PATH_SEPARATOR = ':'

$Domain = Get-EnvValue 'DOMAIN'
$FirstDomain = ($Domain -split ',')[0].Trim()
Info ("Sizing:   " + $(if ($useProd) { 'production (docker-compose.prod.yml)' } else { 'standard' }))
if ($useLe) {
  $note = if ((Get-EnvValue 'ACME_CA') -eq $LeStaging) { ' (staging)' } else { '' }
  Info "HTTPS:    Let's Encrypt for $Domain$note"
} else {
  Info "HTTP:     port $HttpPort"
}

$checkPorts = if ($useLe) { @(80, 443) } else { @([int]$HttpPort) }
foreach ($p in $checkPorts) {
  $busy = Get-NetTCPConnection -State Listen -LocalPort $p -ErrorAction SilentlyContinue
  if ($busy) {
    $owners = ($busy | ForEach-Object { (Get-Process -Id $_.OwningProcess -ErrorAction SilentlyContinue).ProcessName } | Sort-Object -Unique) -join ', '
    if ($owners -notmatch 'docker|com\.docker|wslrelay|vpnkit') { Warn "port $p is already in use by: $owners" }
  }
}

# 3. backup before an upgrade (uses the Bash backup script when Git Bash / WSL is available)
$running = (docker compose ps --status running -q postgres 2>$null | Out-String).Trim()
if ($running) {
  $bash = Get-Command bash -ErrorAction SilentlyContinue
  if ($bash) {
    Step 'Backing up the existing installation (backups\<timestamp>)'
    & bash ./infrastructure/scripts/backup.sh
    if ($LASTEXITCODE -ne 0) { Fail 'The backup failed. Fix the problem before upgrading.' }
  } else {
    Warn 'Existing installation found but bash is not available for the backup script. Back up first (make backup from Git Bash or WSL) if this is an upgrade.'
  }
}

# 4. build and start
Step 'Building and starting the containers (the first build takes several minutes)'
docker compose up -d --build --remove-orphans
if ($LASTEXITCODE -ne 0) { Fail 'docker compose up failed - see the output above.' }

Step 'Waiting for the API (the first start creates the database and default settings)'
$status = ''
for ($i = 0; $i -lt 120; $i++) {
  $apiId = (docker compose ps -q api | Select-Object -First 1 | Out-String).Trim()
  $status = (docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' $apiId 2>$null | Out-String).Trim()
  if ($status -eq 'healthy' -or $status -eq 'exited' -or $status -eq 'dead') { break }
  Start-Sleep -Seconds 5
}
if ($status -ne 'healthy') {
  docker compose logs --tail=80 api
  Fail "The API did not become healthy (status: $status). See the log above or: docker compose logs api"
}
Info 'API is healthy'

if ($useLe) {
  $base = "https://$FirstDomain"
  Step "Waiting for the Let's Encrypt certificate"
  $ok = $false
  for ($i = 0; $i -lt 36; $i++) {
    try { Invoke-WebRequest -Uri "$base/api/v1/health/live" -UseBasicParsing -TimeoutSec 10 | Out-Null; $ok = $true; break } catch { Start-Sleep -Seconds 5 }
  }
  if ($ok) { Info 'Certificate installed - renewed automatically before it expires' }
  elseif ((Get-EnvValue 'ACME_CA') -eq $LeStaging) { Info 'Staging certificate requested (browsers do not trust it). Re-run without -Staging when ready.' }
  else {
    docker compose logs --tail=40 https
    Warn "the certificate is not ready yet. Check that $FirstDomain points to this machine and ports 80/443 are reachable from the internet; it keeps retrying (docker compose logs -f https)."
  }
} else {
  $base = if ($HttpPort -eq '80') { 'http://localhost' } else { "http://localhost:$HttpPort" }
}

# done
$code = (docker compose exec -T api python -m app.cli setup-code 2>$null | Select-Object -Last 1 | Out-String).Trim()
Write-Host ''
Write-Host 'SST Alumni Connect is running.' -ForegroundColor Green
if ($code -and $code -notmatch 'complete') {
  Write-Host "    Setup wizard:  $base/setup"
  Write-Host ''
  Write-Host '    First-run setup: open the setup wizard and enter this setup code:'
  Write-Host ''
  Write-Host "        $code" -ForegroundColor White
  Write-Host ''
  Write-Host '    (shown again any time with:  docker compose exec api python -m app.cli setup-code)'
} else {
  Write-Host "    Sign in:       $base/login"
}
Write-Host ''
Write-Host '    Status:     docker compose ps'
Write-Host '    Logs:       docker compose logs -f api'
Write-Host '    Stop:       docker compose down          (data is kept in Docker volumes)'
Write-Host '    Upgrade:    pull the new version, then run this script again'
if ($useLe) {
  Write-Host '    HTTPS:      certificates renew automatically (docker compose logs https)'
  Write-Host "                In System Configuration > General, the application URL should be $base"
} else {
  Write-Host '    HTTPS:      re-run with  -Domain <your-domain> -Email <address>'
}
Write-Host "    Mobile app: on the app's sign-in screen, set the server to $base (use the PC's LAN IP from phones)"
