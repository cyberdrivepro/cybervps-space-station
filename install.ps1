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

[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$ProgressPreference = 'SilentlyContinue'

# 1. Detect Runtimes (Node.js LTS and Python 3)
function Refresh-EnvPath {
    $machinePath = [Environment]::GetEnvironmentVariable("Path", "Machine")
    $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
    $env:Path = "$machinePath;$userPath"
}

# 1a. Detect Node.js
$NodeCmd = Get-Command node -ErrorAction SilentlyContinue
if (-not $NodeCmd) {
    $WingetCmd = Get-Command winget -ErrorAction SilentlyContinue
    if ($WingetCmd) {
        Write-Host "[*] Node.js not detected. Auto-installing Node.js LTS via WinGet..." -ForegroundColor Cyan
        try {
            & winget install -e --id OpenJS.NodeJS.LTS --scope currentuser --silent --accept-source-agreements --accept-package-agreements | Out-Null
            Refresh-EnvPath
            $NodeCmd = Get-Command node -ErrorAction SilentlyContinue
        } catch {}
    }
}

if (-not $NodeCmd) {
    Write-Host "❌ Error: Node.js (v18+) is required to run CyberVPS Space Station CLI." -ForegroundColor Red
    Write-Host "👉 Install Node.js LTS from: https://nodejs.org/en/download" -ForegroundColor Yellow
    exit 1
}
$NodeVer = & node -v
Write-Host "[*] Active Node.js runtime: $NodeVer" -ForegroundColor Green

# 1b. Detect Python 3 (Excluding WindowsApps placeholder)
function Find-RealPython {
    try {
        $raw = where.exe python 2>$null
        if ($raw) {
            foreach ($line in ($raw -split "`r?`n")) {
                $trimmed = $line.Trim()
                if ($trimmed -and ($trimmed -notlike "*WindowsApps*") -and (Test-Path $trimmed)) {
                    $ver = & $trimmed --version 2>&1
                    if ($ver -like "*Python 3*") { return $trimmed }
                }
            }
        }
    } catch {}
    try {
        $pyVer = & py -3 --version 2>&1
        if ($pyVer -like "*Python 3*") { return "py" }
    } catch {}
    return $null
}

$PythonExe = Find-RealPython
if (-not $PythonExe) {
    $WingetCmd = Get-Command winget -ErrorAction SilentlyContinue
    if ($WingetCmd) {
        Write-Host "[*] Python 3 not detected. Auto-installing Python 3.12 via WinGet..." -ForegroundColor Cyan
        try {
            & winget install -e --id Python.Python.3.12 --scope currentuser --silent --accept-source-agreements --accept-package-agreements | Out-Null
            Refresh-EnvPath
            $PythonExe = Find-RealPython
        } catch {}
    }
}

if (-not $PythonExe) {
    Write-Host "❌ Error: Python 3 runtime is required to run the CyberVPS Host Agent." -ForegroundColor Red
    Write-Host "👉 Download and install Python 3 (check 'Add to PATH'): https://www.python.org/downloads/windows/" -ForegroundColor Yellow
    exit 1
}
$PyVer = & $PythonExe --version 2>&1
Write-Host "[*] Active Python runtime: $PyVer" -ForegroundColor Green

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

try {
    Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned -Force -ErrorAction SilentlyContinue
} catch {}

# Create cybervps.cmd wrapper for universal Command Prompt & PowerShell compatibility
$CmdWrapper = @"
@echo off
node "%~dp0cybervps" %*
"@
Set-Content -Path (Join-Path $BinDir "cybervps.cmd") -Value $CmdWrapper -Force

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

# 7. Configure 24/7 Silent Background Windows Service (Startup Shortcut + Registry Run Key + Task Scheduler)
Write-Host "[*] Configuring silent background autostart on logon..." -ForegroundColor Cyan

# Generate silent VBScript launcher (SW_HIDE = 0, zero flashing cmd window)
$VbsScript = Join-Path $BinDir "run-agent.vbs"
$VbsContent = @"
Set WshShell = CreateObject("WScript.Shell")
WshShell.Run "node """ & CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName) & "\cybervps"" start", 0, False
"@
Set-Content -Path $VbsScript -Value $VbsContent -Force

# Method A: User Startup Shortcut (Non-Admin & Standard Users)
try {
    $StartupDir = [Environment]::GetFolderPath([Environment+SpecialFolder]::Startup)
    if (Test-Path $StartupDir) {
        $WshShell = New-Object -ComObject WScript.Shell
        $Shortcut = $WshShell.CreateShortcut((Join-Path $StartupDir "CyberVPS-Agent.lnk"))
        $Shortcut.TargetPath = "wscript.exe"
        $Shortcut.Arguments = "//B //Nologo `"$VbsScript`""
        $Shortcut.WindowStyle = 7
        $Shortcut.Save()
        Write-Host "  ✅ User Startup shortcut registered (Autostart on Logon)." -ForegroundColor Green
    }
} catch {}

# Method B: HKCU Run Registry Key (Standard User, zero UAC prompt)
try {
    Set-ItemProperty -Path "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run" -Name "CyberVPS-Agent" -Value "wscript.exe //B //Nologo `"$VbsScript`"" -Force
    Write-Host "  ✅ User Registry autostart key registered (HKCU Run)." -ForegroundColor Green
} catch {}

# Method C: Autonomous Boot-Start & Logon Task
$TaskName = "CyberVPS-Space-Station-Agent"
$IsElevated = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
$oldEap = $ErrorActionPreference
$ErrorActionPreference = 'SilentlyContinue'
try {
    & schtasks.exe /Query /TN $TaskName 2>$null | Out-Null
    if ($LASTEXITCODE -eq 0) {
        & schtasks.exe /Delete /TN $TaskName /F 2>$null | Out-Null
    }
    $TaskRun = "`"wscript.exe`" //B //Nologo `"$VbsScript`""
    if ($IsElevated) {
        # Elevated Admin: Start at system boot (autonomous 24/7 service before user login)
        & schtasks.exe /Create /TN $TaskName /TR $TaskRun /SC ONSTART /RU "SYSTEM" /RL HIGHEST /F 2>$null | Out-Null
        if ($LASTEXITCODE -eq 0) {
            Write-Host "  ✅ Elevated Boot-Start Service registered (Starts on Boot via SYSTEM)." -ForegroundColor Green
        } else {
            & schtasks.exe /Create /TN $TaskName /TR $TaskRun /SC ONLOGON /RL HIGHEST /F 2>$null | Out-Null
            Write-Host "  ✅ Elevated Task registered (Starts on Logon with HIGHEST privileges)." -ForegroundColor Green
        }
    } else {
        # Standard User: Autostart on user logon without UAC prompts
        & schtasks.exe /Create /TN $TaskName /TR $TaskRun /SC ONLOGON /RL LIMITED /F 2>$null | Out-Null
        Write-Host "  ✅ User Scheduled Task registered (Autostart on Logon)." -ForegroundColor Green
    }
} catch {} finally {
    $ErrorActionPreference = $oldEap
}

# 8. Start Agent in Background Now
Write-Host "[*] Starting CyberVPS Host Agent in background..." -ForegroundColor Cyan
& node (Join-Path $InstallDir "bin\cybervps") start

# 9. Verify Machine Enrollment with Central Backend
Write-Host "[*] Waiting for fleet enrollment confirmation (up to 20s)..." -ForegroundColor Cyan
$Enrolled = $false
$AssignedVip = "10.77.0.x"
for ($i = 0; $i -lt 10; $i++) {
    Start-Sleep -Seconds 2
    try {
        $MachinesUrl = "$($Server.TrimEnd('/'))/api/v1/machines"
        $MachinesList = Invoke-RestMethod -Uri $MachinesUrl -TimeoutSec 4 -ErrorAction SilentlyContinue
        if ($MachinesList) {
            $MyMachine = $MachinesList | Where-Object { $_.id -eq $MachineId }
            if ($MyMachine -and $MyMachine.status -eq 'online') {
                $AssignedVip = $MyMachine.virtual_ip
                $Enrolled = $true
                break
            }
        }
    } catch {}
    Write-Host -NoNewline "."
}
Write-Host ""

# 10. Clean Completion Summary
Write-Host ""
if ($Enrolled) {
    Write-Host "================================================================" -ForegroundColor Green
    Write-Host "🛰️  CYBERVPS HOST AGENT - SETUP COMPLETE" -ForegroundColor Green
    Write-Host "================================================================" -ForegroundColor Green
    Write-Host "Host:        $env:COMPUTERNAME (Windows)" -ForegroundColor White
    Write-Host "Backend:     $Server (Connected & Verified ✅)" -ForegroundColor White
    Write-Host "Status:      ONLINE (Virtual IP: $AssignedVip)" -ForegroundColor Green
    Write-Host "Service:     Running 24/7 in Background (CyberVPS-Space-Station-Agent)" -ForegroundColor Green
    Write-Host "Startup:     Automatic on Reboot & Logon" -ForegroundColor Green
    Write-Host "Machine ID:  $MachineId" -ForegroundColor White
    Write-Host "Dashboard:   https://cyberdrivepro.github.io/cybervps-space-station/" -ForegroundColor Yellow
    Write-Host "================================================================" -ForegroundColor Green
    Write-Host "🎉 Setup complete! You can safely close this PowerShell window." -ForegroundColor White
    Write-Host "👉 The Host Agent will run silently in the background 24/7." -ForegroundColor Gray
} else {
    Write-Host "================================================================" -ForegroundColor Yellow
    Write-Host "⚠️  CYBERVPS HOST AGENT - ENROLLMENT PENDING" -ForegroundColor Yellow
    Write-Host "================================================================" -ForegroundColor Yellow
    Write-Host "Host:        $env:COMPUTERNAME (Windows)" -ForegroundColor White
    Write-Host "Backend:     $Server (Enrollment Pending / Check Logs ⚠️)" -ForegroundColor Yellow
    Write-Host "Status:      Awaiting initial heartbeat confirmation" -ForegroundColor Yellow
    Write-Host "Service:     Running 24/7 in Background (CyberVPS-Space-Station-Agent)" -ForegroundColor White
    Write-Host "Machine ID:  $MachineId" -ForegroundColor White
    Write-Host "Agent Logs:  $LogsDir\agent.log" -ForegroundColor Cyan
    Write-Host "Check State: cybervps status" -ForegroundColor Cyan
    Write-Host "================================================================" -ForegroundColor Yellow
    Write-Host "👉 If enrollment takes more than a minute, run: cybervps restart" -ForegroundColor Gray
}
Write-Host "👉 Monitor and control this machine anytime at:" -ForegroundColor Cyan
Write-Host "   https://cyberdrivepro.github.io/cybervps-space-station/" -ForegroundColor Cyan
Write-Host "================================================================" -ForegroundColor $(if ($Enrolled) { "Green" } else { "Yellow" })
