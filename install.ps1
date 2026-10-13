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

# 4. Install Dependencies
Write-Host "[*] Verifying production dependencies..." -ForegroundColor Cyan
Push-Location $InstallDir
try {
    & npm install --omit=dev --no-audit --no-fund
} catch {
    Write-Warning "npm install warning: $_"
}
Pop-Location

# 5. Setup CLI Executable in User PATH
$CybervpsCmdSrc = Join-Path $InstallDir "bin\cybervps.cmd"
$CybervpsCmdDest = Join-Path $BinDir "cybervps.cmd"
Copy-Item $CybervpsCmdSrc $CybervpsCmdDest -Force

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

Write-Host ""
Write-Host "================================================================" -ForegroundColor Green
Write-Host "🎉 CYBERVPS SPACE STATION INSTALLED SUCCESSFULLY!" -ForegroundColor Green
Write-Host "================================================================" -ForegroundColor Green
Write-Host "👉 Start Space Station (Interactive):" -ForegroundColor White
Write-Host "   cybervps start" -ForegroundColor Yellow
Write-Host ""
Write-Host "👉 Start in Background (Daemon):" -ForegroundColor White
Write-Host "   cybervps start --daemon" -ForegroundColor Yellow
Write-Host ""
Write-Host "👉 Check Status & Live URLs:" -ForegroundColor White
Write-Host "   cybervps status" -ForegroundColor Yellow
Write-Host "================================================================" -ForegroundColor Green
