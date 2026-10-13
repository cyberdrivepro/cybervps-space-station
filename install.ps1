# ==============================================================================
# CyberVPS SPACE STATION - Windows PowerShell Bootstrap Installer
# Compatible with: Windows 10, Windows 11, PowerShell 5.1 & PowerShell 7+
# Official Repository: https://github.com/cyberdrivepro/cybervps-space-station
# ==============================================================================

$ErrorActionPreference = 'Stop'

$RepoUrl = "https://github.com/cyberdrivepro/cybervps-space-station.git"
$ZipUrl = "https://github.com/cyberdrivepro/cybervps-space-station/archive/refs/heads/main.zip"
$InstallBase = Join-Path $HOME ".cybervps"
$InstallDir = Join-Path $InstallBase "space-station"
$BinDir = Join-Path $InstallBase "bin"

Write-Host "================================================================" -ForegroundColor Cyan
Write-Host "🛰️  CYBERVPS SPACE STATION - WINDOWS POWERSHELL INSTALLER" -ForegroundColor Cyan
Write-Host "================================================================" -ForegroundColor Cyan

# 1. Check Node.js
$NodeCmd = Get-Command node -ErrorAction SilentlyContinue
if (-not $NodeCmd) {
    Write-Host "❌ Error: Node.js (v18+) is required to run CyberVPS Space Station." -ForegroundColor Red
    Write-Host "👉 Please install Node.js from https://nodejs.org/ or run:" -ForegroundColor Yellow
    Write-Host "   winget install OpenJS.NodeJS.LTS" -ForegroundColor White
    exit 1
}

$NodeVer = & node -v
Write-Host "[*] Active Node.js runtime: $NodeVer" -ForegroundColor Green

# 2. Prepare Directories
if (-not (Test-Path $InstallBase)) { New-Item -ItemType Directory -Path $InstallBase | Out-Null }
if (-not (Test-Path $BinDir)) { New-Item -ItemType Directory -Path $BinDir | Out-Null }
if (-not (Test-Path (Join-Path $InstallBase "run"))) { New-Item -ItemType Directory -Path (Join-Path $InstallBase "run") | Out-Null }
if (-not (Test-Path (Join-Path $InstallBase "logs"))) { New-Item -ItemType Directory -Path (Join-Path $InstallBase "logs") | Out-Null }

# 3. Clone or Download Codebase
$GitCmd = Get-Command git -ErrorAction SilentlyContinue
if (Test-Path (Join-Path $InstallDir ".git")) {
    Write-Host "[*] Existing installation found in $InstallDir. Updating..." -ForegroundColor Yellow
    Push-Location $InstallDir
    try {
        & git pull origin main
    } catch {
        Write-Warning "git pull warning: $_"
    }
    Pop-Location
} elseif ($GitCmd) {
    Write-Host "[*] Cloning repository via Git..." -ForegroundColor Cyan
    if (Test-Path $InstallDir) { Remove-Item -Recurse -Force $InstallDir }
    try {
        & git clone --depth 1 $RepoUrl $InstallDir
    } catch {
        Write-Host "❌ Git clone failed. Stopping installation; no project commands were executed." -ForegroundColor Red
        exit 1
    }
} else {
    Write-Host "[*] Git not found. Downloading repository archive from GitHub..." -ForegroundColor Cyan
    $ZipPath = Join-Path $InstallBase "cybervps.zip"
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    Invoke-WebRequest -Uri $ZipUrl -OutFile $ZipPath -UseBasicParsing
    
    if (Test-Path $InstallDir) { Remove-Item -Recurse -Force $InstallDir }
    Expand-Archive -Path $ZipPath -DestinationPath $InstallBase -Force
    $ExtractedDir = Join-Path $InstallBase "cybervps-space-station-main"
    if (Test-Path $ExtractedDir) {
        Rename-Item -Path $ExtractedDir -NewName "space-station"
    }
    Remove-Item $ZipPath -Force -ErrorAction SilentlyContinue
}

# Verify files
$PkgJson = Join-Path $InstallDir "package.json"
if (-not (Test-Path $PkgJson)) {
    Write-Host "❌ Verification failed: Application files missing in $InstallDir." -ForegroundColor Red
    exit 1
}

# 4. Install Dependencies (Bypass PowerShell npm.ps1 execution policy restrictions)
Write-Host "[*] Verifying production dependencies..." -ForegroundColor Cyan
Push-Location $InstallDir
try {
    $npmCmd = Get-Command npm.cmd -ErrorAction SilentlyContinue
    if ($npmCmd) {
        & npm.cmd install --omit=dev --no-audit --no-fund
    } else {
        & cmd.exe /c "npm install --omit=dev --no-audit --no-fund"
    }
} catch {
    Write-Warning "npm install note: $_"
}
Pop-Location

# 5. Setup CLI Executables in User PATH
# Copy both 'cybervps' and 'cybervps.cmd' to ~/.cybervps/bin
Copy-Item (Join-Path $InstallDir "bin\*") $BinDir -Force -Recurse

# Also create cybervps.ps1 wrapper in BinDir for seamless PowerShell invocation
$Ps1Wrapper = @"
`$ErrorActionPreference = 'Stop'
node "`$PSScriptRoot\cybervps" `$args
"@
Set-Content -Path (Join-Path $BinDir "cybervps.ps1") -Value $Ps1Wrapper -Force

$UserPath = [Environment]::GetEnvironmentVariable("Path", [EnvironmentVariableTarget]::User)
if ($UserPath -notlike "*$BinDir*") {
    Write-Host "[*] Adding $BinDir to User PATH..." -ForegroundColor Cyan
    [Environment]::SetEnvironmentVariable("Path", "$UserPath;$BinDir", [EnvironmentVariableTarget]::User)
    $env:Path = "$env:Path;$BinDir"
}

# 6. Run Self-Diagnostics
Write-Host ""
Write-Host "[*] Executing system health check..." -ForegroundColor Cyan
& node (Join-Path $InstallDir "bin\cybervps") doctor

# 7. AUTOMATICALLY LAUNCH SPACE STATION & BRIDGE IN BACKGROUND
Write-Host ""
Write-Host "================================================================" -ForegroundColor Cyan
Write-Host "🚀 LAUNCHING CYBERVPS SPACE STATION IN BACKGROUND..." -ForegroundColor Cyan
Write-Host "================================================================" -ForegroundColor Cyan

& node (Join-Path $InstallDir "bin\cybervps") start --daemon

# Poll for Control Plane readiness and tunnel URL
$Port = if ($env:PORT) { $env:PORT } else { "8080" }
$StatusUrl = "http://127.0.0.1:$Port/api/v1/access/status"
$LiveDashboard = "http://localhost:$Port"

for ($i = 0; $i -lt 14; $i++) {
    Start-Sleep -Milliseconds 500
    try {
        $AccessRes = Invoke-RestMethod -Uri $StatusUrl -TimeoutSec 2 -ErrorAction SilentlyContinue
        if ($AccessRes -and $AccessRes.public_url) {
            $RemoteUrl = $AccessRes.public_url
            if ($AccessRes.provider -ne "localhost") {
                $LiveDashboard = "https://cyberdrivepro.github.io/cybervps-space-station/?backend=$RemoteUrl"
                break
            }
        }
    } catch {}
}

# Display Status & URLs
& node (Join-Path $InstallDir "bin\cybervps") status

Write-Host ""
Write-Host "================================================================" -ForegroundColor Green
Write-Host "🎉 CYBERVPS SPACE STATION IS FULLY OPERATIONAL IN BACKGROUND!" -ForegroundColor Green
Write-Host "================================================================" -ForegroundColor Green
Write-Host "👉 Dashboard URL: $LiveDashboard" -ForegroundColor Yellow
Write-Host "   (Running 24/7 in background. You can close this terminal anytime!)" -ForegroundColor Gray
Write-Host "================================================================" -ForegroundColor Green

# Automatically open Dashboard in default browser!
try {
    Start-Process $LiveDashboard
} catch {}


