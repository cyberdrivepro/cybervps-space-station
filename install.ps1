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

# Enforce TLS 1.2
try {
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
} catch {}
$ProgressPreference = 'SilentlyContinue'

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
Write-Host "   CYBERVPS SPACE STATION - WINDOWS HOST AGENT INSTALLER        " -ForegroundColor Cyan
Write-Host "================================================================" -ForegroundColor Cyan

function Refresh-EnvPath {
    $machinePath = [Environment]::GetEnvironmentVariable("Path", "Machine")
    $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
    $env:Path = "$machinePath;$userPath"
}

# 1. Detect Python 3 (Primary Runtime for Universal Host Agent)
Write-Host "[*] Detecting Python runtime..." -ForegroundColor Cyan

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

    $candidates = @(
        "$env:LOCALAPPDATA\Programs\Python\Python3*\python.exe",
        "C:\Python3*\python.exe",
        "C:\Program Files\Python3*\python.exe",
        "$InstallBase\python\python.exe"
    )
    foreach ($pat in $candidates) {
        $found = Get-Item $pat -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($found -and (Test-Path $found.FullName)) {
            return $found.FullName
        }
    }
    return $null
}

function Exit-WithCode([int]$code = 1) {
    try {
        $host.SetShouldExit($code)
    } catch {}
    $global:LASTEXITCODE = $code
}


$PythonExe = Find-RealPython

if (-not $PythonExe) {
    Write-Host "[!] Python 3 not detected on system. Provisioning portable Python 3.12 (~10MB)..." -ForegroundColor Yellow
    $PyEmbedDir = Join-Path $InstallBase "python"
    $PyEmbedZip = Join-Path $env:TEMP "python-embed.zip"
    $PyEmbedUrl = "https://www.python.org/ftp/python/3.12.7/python-3.12.7-embed-amd64.zip"
    try {
        New-Item -ItemType Directory -Path $PyEmbedDir -Force | Out-Null
        Write-Host "[*] Downloading official portable Python 3.12 package from python.org..." -ForegroundColor Cyan
        Invoke-WebRequest -Uri $PyEmbedUrl -OutFile $PyEmbedZip -UseBasicParsing
        Write-Host "[*] Extracting portable Python runtime to $PyEmbedDir..." -ForegroundColor Cyan
        Expand-Archive -Path $PyEmbedZip -DestinationPath $PyEmbedDir -Force
        Remove-Item $PyEmbedZip -Force -ErrorAction SilentlyContinue

        # Enable site-packages and script paths in embed python
        $pthFile = Join-Path $PyEmbedDir "python312._pth"
        if (Test-Path $pthFile) {
            $pthContent = Get-Content $pthFile
            $pthContent = $pthContent -replace '^#import site', 'import site'
            $pthContent += "`n."
            $pthContent += "`n..`n..\space-station`n..\space-station\agent"
            Set-Content -Path $pthFile -Value $pthContent -Force
        }

        $CandidateExe = Join-Path $PyEmbedDir "python.exe"
        if (Test-Path $CandidateExe) {
            $PythonExe = $CandidateExe
            Write-Host "[+] Portable Python 3.12 runtime successfully provisioned." -ForegroundColor Green
        }
    } catch {
        Write-Host "[!] Portable Python download failed: $_" -ForegroundColor Yellow
    }

    if (-not $PythonExe) {
        $WingetCmd = Get-Command winget.exe -ErrorAction SilentlyContinue
        if ($WingetCmd) {
            Write-Host "[*] Attempting installation via WinGet..." -ForegroundColor Cyan
            try {
                & winget install -e --id Python.Python.3.12 --scope currentuser --accept-source-agreements --accept-package-agreements
                Refresh-EnvPath
                $PythonExe = Find-RealPython
            } catch {}
        }
    }
}

if (-not $PythonExe) {
    Write-Host "[X] Error: Python 3 is required to run the CyberVPS Host Agent." -ForegroundColor Red
    Write-Host "    Please install Python 3 (check 'Add python.exe to PATH'):" -ForegroundColor Yellow
    Write-Host "    https://www.python.org/downloads/windows/" -ForegroundColor White
    Exit-WithCode 1
    return
}

$PyVer = & $PythonExe --version 2>&1
Write-Host "[+] Python runtime active: $PyVer ($PythonExe)" -ForegroundColor Green

# 2. Check Node.js (Optional, used for full CLI)
$NodeCmd = Get-Command node.exe -ErrorAction SilentlyContinue
if ($NodeCmd) {
    $NodeVer = & node -v
    Write-Host "[+] Node.js runtime active: $NodeVer" -ForegroundColor Green
} else {
    Write-Host "[*] Node.js not detected (optional). Host agent will operate in pure Python mode." -ForegroundColor Gray
}

# 3. Prepare Directories
New-Item -ItemType Directory -Path $InstallBase -Force | Out-Null
New-Item -ItemType Directory -Path $BinDir -Force | Out-Null
New-Item -ItemType Directory -Path $LogsDir -Force | Out-Null
New-Item -ItemType Directory -Path $RunDir -Force | Out-Null

# 4. Clone or Download Codebase
$GitCmd = Get-Command git.exe -ErrorAction SilentlyContinue
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
    Write-Host "[*] Downloading repository via Git..." -ForegroundColor Cyan
    if (Test-Path $InstallDir) { Remove-Item -Recurse -Force $InstallDir }
    try {
        & git clone --depth 1 $RepoUrl $InstallDir
    } catch {
        Write-Host "[X] Git clone failed. Stopping installation." -ForegroundColor Red
        Exit-WithCode 1
        return
    }
} else {
    Write-Host "[*] Downloading repository archive from GitHub..." -ForegroundColor Cyan
    $ZipPath = Join-Path $InstallBase "cybervps.zip"
    try {
        Invoke-WebRequest -Uri $ZipUrl -OutFile $ZipPath -UseBasicParsing
        if (Test-Path $InstallDir) { Remove-Item -Recurse -Force $InstallDir }
        Expand-Archive -Path $ZipPath -DestinationPath $InstallBase -Force
        $ExtractedDir = Join-Path $InstallBase "cybervps-space-station-main"
        if (Test-Path $ExtractedDir) {
            Rename-Item -Path $ExtractedDir -NewName "space-station"
        }
        Remove-Item $ZipPath -Force -ErrorAction SilentlyContinue
    } catch {
        Write-Host "[X] Failed to download repository archive: $_" -ForegroundColor Red
        Exit-WithCode 1
        return
    }
}

# 5. Setup Configuration & Persistent Machine ID
$MachineId = ""
if (Test-Path $MachineIdFile) {
    $rawId = (Get-Content $MachineIdFile -Raw)
    $clean = ($rawId -replace '[^a-zA-Z0-9_\-]', '').Trim()
    if ($clean.Length -ge 4) {
        $MachineId = $clean
    }
}
if (($MachineId.Length -lt 4) -and (Test-Path $ConfigFile)) {
    try {
        $ExistingCfg = Get-Content $ConfigFile -Raw | ConvertFrom-Json
        $cleanCfg = ($ExistingCfg.machine_id -replace '[^a-zA-Z0-9_\-]', '').Trim()
        if ($cleanCfg.Length -ge 4) {
            $MachineId = $cleanCfg
        }
    } catch {}
}
if ($MachineId.Length -lt 4) {
    $RandSuffix = [System.Guid]::NewGuid().ToString("N").Substring(0, 8)
    $cleanHost = ($env:COMPUTERNAME -replace '[^a-zA-Z0-9_]', '').ToLower()
    $MachineId = "cvps_${cleanHost}_$RandSuffix"
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
Write-Host "[+] Saved host configuration in $ConfigFile" -ForegroundColor Green

# 6. Copy CLI to BinDir and Add to PATH
Copy-Item (Join-Path $InstallDir "bin\*") $BinDir -Force -Recurse

try {
    Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned -Force -ErrorAction SilentlyContinue
} catch {}

$UserPath = [Environment]::GetEnvironmentVariable("Path", [EnvironmentVariableTarget]::User)
if ($UserPath -notlike "*$BinDir*") {
    Write-Host "[*] Adding $BinDir to User PATH..." -ForegroundColor Cyan
    [Environment]::SetEnvironmentVariable("Path", "$UserPath;$BinDir", [EnvironmentVariableTarget]::User)
    $env:Path = "$env:Path;$BinDir"
}

# 7. Verify Outbound Connectivity to Central Backend
Write-Host "[*] Verifying connectivity to Central Backend ($Server)..." -ForegroundColor Cyan
$HealthOk = $false
try {
    $HealthUrl = "$($Server.TrimEnd('/'))/health"
    $HealthRes = Invoke-RestMethod -Uri $HealthUrl -TimeoutSec 5 -ErrorAction Stop
    if ($HealthRes.status -eq 'OK' -or $HealthRes.status -eq 'ok') {
        $HealthOk = $true
        Write-Host "  [OK] Backend reached successfully ($HealthUrl)" -ForegroundColor Green
    }
} catch {
    Write-Warning "Could not verify backend health: $_"
}

# 8. Configure 24/7 Silent Background Windows Service (Single Mechanism Supervision)
Write-Host "[*] Configuring silent background autostart..." -ForegroundColor Cyan

$TaskName = "CyberVPS-Space-Station-Agent"
$StartupShortcut = Join-Path ([Environment]::GetFolderPath([Environment+SpecialFolder]::Startup)) "CyberVPS-Agent.lnk"
$AgentScript = Join-Path $InstallDir "agent\universal-agent.py"
$VbsScript = Join-Path $BinDir "run-agent.vbs"

# Clean up any duplicate mechanisms
if (Test-Path $StartupShortcut) {
    Remove-Item -Path $StartupShortcut -Force -ErrorAction SilentlyContinue
}
try {
    Remove-ItemProperty -Path "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run" -Name "CyberVPS-Agent" -Force -ErrorAction SilentlyContinue
} catch {}
try {
    & schtasks.exe /Delete /TN $TaskName /F 2>$null | Out-Null
} catch {}

$IsElevated = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

if ($IsElevated) {
    # Elevated Admin: Scheduled Task running under SYSTEM
    $TaskRun = "`"$PythonExe`" -u `"$AgentScript`" --config `"$ConfigFile`" --log-dir `"$LogsDir`""
    $oldEap = $ErrorActionPreference
    $ErrorActionPreference = 'SilentlyContinue'
    try {
        & schtasks.exe /Create /TN $TaskName /TR $TaskRun /SC ONSTART /RU "SYSTEM" /RL HIGHEST /F 2>$null | Out-Null
        if ($LASTEXITCODE -eq 0) {
            Write-Host "  [+] Elevated Boot-Start Service registered (Starts on Boot via SYSTEM)." -ForegroundColor Green
        } else {
            & schtasks.exe /Create /TN $TaskName /TR $TaskRun /SC ONLOGON /RL HIGHEST /F 2>$null | Out-Null
            Write-Host "  [+] Elevated Task registered (Starts on Logon with HIGHEST privileges)." -ForegroundColor Green
        }
    } finally {
        $ErrorActionPreference = $oldEap
    }
} else {
    # Standard User: Silent background VBS launcher via HKCU Run (zero console popup)
    $EscPy = $PythonExe.Replace('"', '""')
    $EscAgent = $AgentScript.Replace('"', '""')
    $EscConfig = $ConfigFile.Replace('"', '""')
    $EscLogs = $LogsDir.Replace('"', '""')
    $VbsContent = @"
Set WshShell = CreateObject("WScript.Shell")
WshShell.Run """$EscPy"" -u ""$EscAgent"" --config ""$EscConfig"" --log-dir ""$EscLogs""", 0, False
"@
    Set-Content -Path $VbsScript -Value $VbsContent -Force
    try {
        Set-ItemProperty -Path "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run" -Name "CyberVPS-Agent" -Value "wscript.exe //B //Nologo `"$VbsScript`"" -Force
        Write-Host "  [+] User Registry autostart key registered (HKCU Run without UAC prompts)." -ForegroundColor Green
    } catch {
        Write-Warning "Could not register HKCU Run key: $_"
    }
}

# 9. Start Agent in Background Now
Write-Host "[*] Starting CyberVPS Host Agent in background..." -ForegroundColor Cyan

# Stop existing running agent if any
$AgentPidFile = Join-Path $RunDir "agent.pid"
if (Test-Path $AgentPidFile) {
    try {
        $oldPid = [int](Get-Content $AgentPidFile -Raw).Trim()
        Stop-Process -Id $oldPid -Force -ErrorAction SilentlyContinue
    } catch {}
    Remove-Item $AgentPidFile -Force -ErrorAction SilentlyContinue
}

$agentProc = Start-Process -FilePath $PythonExe -ArgumentList "-u `"$AgentScript`" --config `"$ConfigFile`" --log-dir `"$LogsDir`"" -PassThru -WindowStyle Hidden
Set-Content -Path $AgentPidFile -Value $agentProc.Id -Force
Write-Host "  [+] CyberVPS Agent spawned with PID: $($agentProc.Id)" -ForegroundColor Green

# 10. Verify Machine Enrollment with Central Backend
Write-Host "[*] Waiting for fleet enrollment confirmation (up to 15s)..." -ForegroundColor Cyan
$Enrolled = $false
$AssignedVip = "10.77.0.x"
for ($i = 0; $i -lt 8; $i++) {
    Start-Sleep -Seconds 2
    try {
        $MachinesUrl = "$($Server.TrimEnd('/'))/api/v1/machines"
        $MachinesList = Invoke-RestMethod -Uri $MachinesUrl -TimeoutSec 3 -ErrorAction SilentlyContinue
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

# 11. Clean Completion Summary
Write-Host ""
if ($Enrolled) {
    Write-Host "================================================================" -ForegroundColor Green
    Write-Host "   CYBERVPS HOST AGENT - SETUP COMPLETE" -ForegroundColor Green
    Write-Host "================================================================" -ForegroundColor Green
    Write-Host "Host:        $env:COMPUTERNAME (Windows)" -ForegroundColor White
    Write-Host "Backend:     $Server (Connected & Verified)" -ForegroundColor White
    Write-Host "Status:      ONLINE (Virtual IP: $AssignedVip)" -ForegroundColor Green
    Write-Host "Service:     Running 24/7 in Background (CyberVPS-Space-Station-Agent)" -ForegroundColor Green
    Write-Host "Startup:     Automatic on Reboot & Logon" -ForegroundColor Green
    Write-Host "Machine ID:  $MachineId" -ForegroundColor White
    Write-Host "Dashboard:   https://cyberdrivepro.github.io/cybervps-space-station/" -ForegroundColor Yellow
    Write-Host "================================================================" -ForegroundColor Green
    Write-Host "Setup complete! You can safely close this PowerShell window." -ForegroundColor White
    Write-Host "The Host Agent will run silently in the background 24/7." -ForegroundColor Gray
} else {
    Write-Host "================================================================" -ForegroundColor Yellow
    Write-Host "   CYBERVPS HOST AGENT - AGENT INITIALIZING" -ForegroundColor Yellow
    Write-Host "================================================================" -ForegroundColor Yellow
    Write-Host "Host:        $env:COMPUTERNAME (Windows)" -ForegroundColor White
    Write-Host "Backend:     $Server" -ForegroundColor Yellow
    Write-Host "Status:      Agent running in background (PID: $($agentProc.Id))" -ForegroundColor White
    Write-Host "Machine ID:  $MachineId" -ForegroundColor White
    Write-Host "Agent Logs:  $LogsDir\agent.log" -ForegroundColor Cyan
    Write-Host "Check State: cybervps status" -ForegroundColor Cyan
    Write-Host "================================================================" -ForegroundColor Yellow
}
Write-Host "Monitor and control this machine anytime at:" -ForegroundColor Cyan
Write-Host "https://cyberdrivepro.github.io/cybervps-space-station/" -ForegroundColor Cyan
Write-Host "================================================================" -ForegroundColor $(if ($Enrolled) { "Green" } else { "Yellow" })
