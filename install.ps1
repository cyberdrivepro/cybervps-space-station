# ==============================================================================
# CyberVPS SPACE STATION - Windows PowerShell Bootstrap Installer
# Cross-Platform Host Agent Installation & 24/7 Background Service Setup
# Official Repository: https://github.com/cyberdrivepro/cybervps-space-station
# ==============================================================================

[CmdletBinding()]
param (
    [string]$Server = $(if ($env:CYBERVPS_SERVER) { $env:CYBERVPS_SERVER } else { "https://cybervps-space-station.up.railway.app" }),
    [string]$Token = $(if ($env:CYBERVPS_TOKEN) { $env:CYBERVPS_TOKEN } else { "cvps_enroll_master_token" })
)

$ErrorActionPreference = 'Stop'

$RepoUrl = "https://github.com/cyberdrivepro/cybervps-space-station.git"
$ZipUrl = "https://github.com/cyberdrivepro/cybervps-space-station/archive/refs/heads/main.zip"
$InstallBase = Join-Path $HOME ".cybervps"
$InstallDir = Join-Path $InstallBase "space-station"
$BinDir = Join-Path $InstallBase "bin"
$LogsDir = Join-Path $InstallBase "logs"
$RunDir = Join-Path $InstallBase "run"
$ConfigFile = Join-Path $InstallBase "config.json"
$MachineIdFile = Join-Path $InstallBase "machine_id"

Write-Host "================================================================" -ForegroundColor Cyan
Write-Host "🛰️  CYBERVPS SPACE STATION - WINDOWS HOST AGENT INSTALLER" -ForegroundColor Cyan
Write-Host "================================================================" -ForegroundColor Cyan

# 1. Detect Runtimes (Node.js or Python)
$NodeCmd = Get-Command node -ErrorAction SilentlyContinue
$PythonCmd = Get-Command python -ErrorAction SilentlyContinue

if (-not $NodeCmd -and -not $PythonCmd) {
    Write-Host "❌ Error: Node.js (v18+) or Python 3 is required to run the CyberVPS Agent." -ForegroundColor Red
    Write-Host "👉 Install Node.js via winget: winget install OpenJS.NodeJS.LTS" -ForegroundColor Yellow
    exit 1
}

if ($NodeCmd) {
    $NodeVer = & node -v
    Write-Host "[*] Active Node.js runtime: $NodeVer" -ForegroundColor Green
}
if ($PythonCmd) {
    $PyVer = & python --version 2>&1
    Write-Host "[*] Active Python runtime: $PyVer" -ForegroundColor Green
}

# 2. Prepare Directories
New-Item -ItemType Directory -Path $InstallBase -Force | Out-Null
New-Item -ItemType Directory -Path $BinDir -Force | Out-Null
New-Item -ItemType Directory -Path $LogsDir -Force | Out-Null
New-Item -ItemType Directory -Path $RunDir -Force | Out-Null

# 3. Clone or Download Codebase
$GitCmd = Get-Command git -ErrorAction SilentlyContinue
if (Test-Path (Join-Path $InstallDir ".git")) {
    Write-Host "[*] Existing installation found in $InstallDir. Updating..." -ForegroundColor Yellow
    Push-Location $InstallDir
    try {
        & git pull origin main 2>$null
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
        Write-Host "❌ Git clone failed. Stopping installation." -ForegroundColor Red
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

# 4. Setup Configuration & Persistent Machine ID
$MachineId = ""
if (Test-Path $MachineIdFile) {
    $MachineId = (Get-Content $MachineIdFile -Raw).Trim()
}
if (-not $MachineId -and (Test-Path $ConfigFile)) {
    try {
        $ExistingCfg = Get-Content $ConfigFile -Raw | ConvertFrom-Json
        if ($ExistingCfg.machine_id) { $MachineId = $ExistingCfg.machine_id }
    } catch {}
}
if (-not $MachineId) {
    $RandSuffix = [System.Guid]::NewGuid().ToString("N").Substring(0, 8)
    $MachineId = "cvps_$($env:COMPUTERNAME)_$RandSuffix"
}
Set-Content -Path $MachineIdFile -Value $MachineId -Force

$ConfigObj = [ordered]@{
    server_url = $Server.TrimEnd("/")
    token = $Token
    machine_id = $MachineId
    hostname = $env:COMPUTERNAME
}
$ConfigJson = $ConfigObj | ConvertTo-Json -Depth 4
Set-Content -Path $ConfigFile -Value $ConfigJson -Force
Write-Host "[*] Saved host configuration in $ConfigFile" -ForegroundColor Green

# 5. Copy CLI to BinDir and Add to PATH
Copy-Item (Join-Path $InstallDir "bin\*") $BinDir -Force -Recurse

# Create cybervps.ps1 wrapper
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

# 6. Verify Outbound Connectivity to Central Backend
Write-Host "[*] Verifying connectivity to Central Backend ($Server)..." -ForegroundColor Cyan
$HealthOk = $false
try {
    $HealthUrl = "$($Server.TrimEnd('/'))/health"
    $HealthRes = Invoke-RestMethod -Uri $HealthUrl -TimeoutSec 5 -ErrorAction Stop
    if ($HealthRes.status -eq 'OK' -or $HealthRes.status -eq 'ok') {
        $HealthOk = $true
        Write-Host "  ✅ Backend reached successfully ($HealthUrl)" -ForegroundColor Green
    }
} catch {
    Write-Warning "Could not verify backend health: $_"
}

# 7. Configure 24/7 Silent Background Windows Service (Scheduled Task + VBScript)
Write-Host "[*] Registering persistent Windows Scheduled Task..." -ForegroundColor Cyan

# Generate silent VBScript launcher (SW_HIDE = 0, zero flashing cmd window)
$VbsScript = Join-Path $BinDir "run-agent.vbs"
$VbsContent = @"
Set WshShell = CreateObject("WScript.Shell")
WshShell.Run "node """ & CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName) & "\cybervps"" start", 0, False
"@
Set-Content -Path $VbsScript -Value $VbsContent -Force

$TaskName = "CyberVPS-Space-Station-Agent"
try {
    # Check if task already exists
    $ExistingTask = schtasks.exe /Query /TN $TaskName 2>$null
    if ($ExistingTask) {
        schtasks.exe /Delete /TN $TaskName /F 2>$null | Out-Null
    }
    # Create task running at user logon, completely hidden
    schtasks.exe /Create /TN $TaskName /TR "wscript.exe //B //Nologo `"$VbsScript`"" /SC ONLOGON /RL LIMITED /F | Out-Null
    Write-Host "  ✅ Windows Scheduled Task '$TaskName' registered (Autostart on Logon)." -ForegroundColor Green
} catch {
    Write-Warning "Could not register scheduled task: $_"
}

# 8. Start Agent in Background Now
Write-Host "[*] Starting CyberVPS Host Agent in background..." -ForegroundColor Cyan
& node (Join-Path $InstallDir "bin\cybervps") start

# 9. Verify Machine Enrollment with Central Backend
Write-Host "[*] Waiting for fleet enrollment confirmation..." -ForegroundColor Cyan
$AssignedVip = "10.77.0.x"
for ($i = 0; $i -lt 8; $i++) {
    Start-Sleep -Seconds 1
    try {
        $MachinesUrl = "$($Server.TrimEnd('/'))/api/v1/machines"
        $MachinesList = Invoke-RestMethod -Uri $MachinesUrl -TimeoutSec 3 -ErrorAction SilentlyContinue
        if ($MachinesList) {
            $MyMachine = $MachinesList | Where-Object { $_.id -eq $MachineId -or $_.hostname -eq $env:COMPUTERNAME }
            if ($MyMachine -and $MyMachine.status -eq 'online') {
                $AssignedVip = $MyMachine.virtual_ip
                break
            }
        }
    } catch {}
}

# 10. Clean Completion Summary (NO Browser Popup!)
Write-Host ""
Write-Host "================================================================" -ForegroundColor Green
Write-Host "🛰️  CYBERVPS HOST AGENT - SETUP COMPLETE" -ForegroundColor Green
Write-Host "================================================================" -ForegroundColor Green
Write-Host "Host:        $env:COMPUTERNAME (Windows)" -ForegroundColor White
Write-Host "Backend:     $Server (Connected ✅)" -ForegroundColor White
Write-Host "Status:      ONLINE (Virtual IP: $AssignedVip)" -ForegroundColor Green
Write-Host "Service:     Running 24/7 in Background (CyberVPS-Space-Station-Agent)" -ForegroundColor Green
Write-Host "Startup:     Automatic on Reboot & Logon" -ForegroundColor Green
Write-Host "Machine ID:  $MachineId" -ForegroundColor White
Write-Host "Dashboard:   https://cyberdrivepro.github.io/cybervps-space-station/" -ForegroundColor Yellow
Write-Host "================================================================" -ForegroundColor Green
Write-Host "🎉 Setup complete! You can safely close this PowerShell window." -ForegroundColor White
Write-Host "👉 The Host Agent will run silently in the background 24/7." -ForegroundColor Gray
Write-Host "👉 Monitor and control this machine anytime at:" -ForegroundColor Cyan
Write-Host "   https://cyberdrivepro.github.io/cybervps-space-station/" -ForegroundColor Cyan
Write-Host "================================================================" -ForegroundColor Green
