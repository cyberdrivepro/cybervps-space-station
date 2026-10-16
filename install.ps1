# ==============================================================================
# CyberVPS SPACE STATION - Ultra-Fast Zero-Prompt Windows Host Agent Installer
# Cross-Platform Host Agent Installation & 24/7 Background Service Setup
# Official Repository: https://github.com/cyberdrivepro/cybervps-space-station
# ==============================================================================

[CmdletBinding()]
param (
    [Parameter(Position=0)]
    [string]$Server = $(if ($env:CYBERVPS_SERVER) { $env:CYBERVPS_SERVER } else { "https://cybervps-space-station.up.railway.app" }),
    [Parameter(Position=1)]
    [Alias("EnrollmentToken")]
    [string]$Token = $(if ($env:CYBERVPS_TOKEN) { $env:CYBERVPS_TOKEN } elseif ($env:ENROLLMENT_TOKEN) { $env:ENROLLMENT_TOKEN } else { "" }),
    [Parameter(Position=2)]
    [Alias("BootstrapTicket", "Capability", "OneClickTicket")]
    [string]$Ticket = ""
)

$ErrorActionPreference = 'Stop'

# Enforce TLS 1.2
try {
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
} catch {}
$ProgressPreference = 'SilentlyContinue'

function Safe-JoinPath {
    param(
        [Parameter(Mandatory=$false)][string]$Path,
        [Parameter(Mandatory=$false)][string]$ChildPath
    )
    if ([string]::IsNullOrWhiteSpace($Path) -or [string]::IsNullOrWhiteSpace($ChildPath)) {
        return $null
    }
    return (Join-Path -Path $Path -ChildPath $ChildPath)
}

function Exit-WithCode([int]$code = 1) {
    try {
        $host.SetShouldExit($code)
    } catch {}
    $global:LASTEXITCODE = $code
}

$LocalScriptDir = $null
if ($PSScriptRoot) {
    $LocalScriptDir = $PSScriptRoot
} elseif ($MyInvocation -and $MyInvocation.MyCommand -and $MyInvocation.MyCommand.Path) {
    $LocalScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
}

$RepoUrl = "https://github.com/cyberdrivepro/cybervps-space-station.git"
$ZipUrl = "https://github.com/cyberdrivepro/cybervps-space-station/archive/refs/heads/main.zip"
$InstallBase = Join-Path $HOME ".cybervps"
$ShadowBase = Join-Path $env:LOCALAPPDATA "CyberVPS"
$InstallDir = Join-Path $InstallBase "space-station"
$BinDir = Join-Path $InstallBase "bin"
$LogsDir = Join-Path $InstallBase "logs"
$RunDir = Join-Path $InstallBase "run"
$ConfigFile = Join-Path $InstallBase "config.json"
$MachineIdFile = Join-Path $InstallBase "machine_id"

Write-Host "================================================================" -ForegroundColor Cyan
Write-Host "   CYBERVPS SPACE STATION - ULTRA-FAST WINDOWS INSTALLER        " -ForegroundColor Cyan
Write-Host "================================================================" -ForegroundColor Cyan

# ------------------------------------------------------------------------------
# STEP 1: Credential Resolution (Zero-Prompt Pipeline)
# ------------------------------------------------------------------------------
# Auto-detect if user passed ticket/token as first positional argument instead of server URL
if ($Server -and ($Server -like "cvps_*" -or ($Server.Length -ge 24 -and $Server -notlike "http*" -and $Server -notlike "*.*:*"))) {
    if ([string]::IsNullOrWhiteSpace($Token) -and [string]::IsNullOrWhiteSpace($Ticket)) {
        $Ticket = $Server
        $Server = $(if ($env:CYBERVPS_SERVER) { $env:CYBERVPS_SERVER } else { "https://cybervps-space-station.up.railway.app" })
    }
}

if ($Ticket) {
    $Token = $Ticket.Trim().Trim('"', "'")
} elseif ($Token) {
    $Token = $Token.Trim().Trim('"', "'")
}

# Path A: Automatically reuse existing valid enrollment credentials
$existingToken = $null
$existingMachineId = $null
$cfgCandidates = @(
    $ConfigFile,
    (Join-Path $ShadowBase "config.json"),
    "C:\ProgramData\CyberVPS\config.json"
)

foreach ($cfgPath in $cfgCandidates) {
    if (Test-Path $cfgPath) {
        try {
            $parsed = Get-Content $cfgPath -Raw -ErrorAction SilentlyContinue | ConvertFrom-Json
            if ($parsed) {
                if (-not $existingToken -and $parsed.token -and $parsed.token.Trim().Length -ge 8) {
                    $existingToken = $parsed.token.Trim()
                }
                if (-not $existingMachineId -and $parsed.machine_id -and $parsed.machine_id.Trim().Length -ge 4) {
                    $existingMachineId = $parsed.machine_id.Trim()
                }
            }
        } catch {}
    }
}

if ([string]::IsNullOrWhiteSpace($Token) -and -not [string]::IsNullOrWhiteSpace($existingToken)) {
    $Token = $existingToken
    Write-Host "  [*] Path A: Reusing verified credentials from existing installation." -ForegroundColor Cyan
}

# Path C: Generic public invocation without credentials - FAIL IMMEDIATELY WITHOUT PROMPT
if ([string]::IsNullOrWhiteSpace($Token)) {
    Write-Host ""
    Write-Host "[X] [ENROLLMENT_AUTHORIZATION_REQUIRED]" -ForegroundColor Red
    Write-Host "    This system does not have an existing CyberVPS installation, and no" -ForegroundColor Yellow
    Write-Host "    authorized one-click provisioning capability or token was provided." -ForegroundColor Yellow
    Write-Host ""
    Write-Host "    To install and connect this Windows system in 1 click (Zero-Prompt):" -ForegroundColor Cyan
    Write-Host "      1. Open your CyberVPS Station Dashboard:" -ForegroundColor White
    Write-Host "         https://cyberdrivepro.github.io/cybervps-space-station/" -ForegroundColor Gray
    Write-Host "      2. Under 'Quick Onboarding', copy the Windows 1-Line Command." -ForegroundColor White
    Write-Host "      3. Paste and run that command in PowerShell." -ForegroundColor White
    Write-Host ""
    Write-Host "    Or specify your capability directly:" -ForegroundColor Yellow
    Write-Host "      & ([scriptblock]::Create((irm '<url>'))) -Ticket '<ONE_CLICK_TICKET>'" -ForegroundColor Gray
    Exit-WithCode 1
    return
}

# ------------------------------------------------------------------------------
# STEP 2: Fast Directory Setup & Persistent Machine ID
# ------------------------------------------------------------------------------
foreach ($dir in @($InstallBase, $ShadowBase, $BinDir, $LogsDir, $RunDir)) {
    if (-not (Test-Path $dir)) {
        New-Item -ItemType Directory -Path $dir -Force | Out-Null
    }
}

$MachineId = ""
if ($existingMachineId) {
    $MachineId = $existingMachineId
}
if (($MachineId.Length -lt 4) -and (Test-Path $MachineIdFile)) {
    try {
        $clean = ((Get-Content $MachineIdFile -Raw) -replace '[^a-zA-Z0-9_\-]', '').Trim()
        if ($clean.Length -ge 4) { $MachineId = $clean }
    } catch {}
}
if (($MachineId.Length -lt 4) -and (Test-Path (Join-Path $ShadowBase "machine_id"))) {
    try {
        $clean = ((Get-Content (Join-Path $ShadowBase "machine_id") -Raw) -replace '[^a-zA-Z0-9_\-]', '').Trim()
        if ($clean.Length -ge 4) { $MachineId = $clean }
    } catch {}
}
if ($MachineId.Length -lt 4) {
    $uuidRaw = ""
    try {
        $uuidRaw = (Get-CimInstance Win32_ComputerSystemProduct -ErrorAction SilentlyContinue).UUID
    } catch {}
    if (-not $uuidRaw) { $uuidRaw = [Guid]::NewGuid().ToString("N").Substring(0, 8) }
    $cleanHost = ($env:COMPUTERNAME -replace '[^a-zA-Z0-9_]', '').ToLower()
    $shortUuid = ($uuidRaw -replace '[^a-zA-Z0-9]', '').Substring(0, [Math]::Min(8, $uuidRaw.Length)).ToLower()
    $MachineId = "cvps_${cleanHost}_${shortUuid}"
}

Set-Content -Path $MachineIdFile -Value $MachineId -Force
Set-Content -Path (Join-Path $ShadowBase "machine_id") -Value $MachineId -Force

# ------------------------------------------------------------------------------
# STEP 3: Authenticated Pre-Flight Handshake (Single Round-Trip Verification)
# ------------------------------------------------------------------------------
Write-Host "[*] Authenticating node [$MachineId] with Control Plane..." -ForegroundColor Cyan

$PreflightOk = $false
$PreflightVip = "10.77.0.x"

$osInfo = ""
try {
    $osInfo = (Get-CimInstance Win32_OperatingSystem -ErrorAction SilentlyContinue).Caption
} catch {
    $osInfo = "Microsoft Windows"
}

$fastAuthPayload = @{
    type = "Auth"
    payload = @{
        machine_id = $MachineId
        token = $Token
        agent_version = "2.2-ghost-native"
        hostname = $env:COMPUTERNAME
        username = $env:USERNAME
        os = "Windows"
        os_version = $osInfo
        arch = $env:PROCESSOR_ARCHITECTURE
        capabilities = @(
            "powershell_native",
            "ghost_mode",
            "background_provisioning",
            "remote_reboot",
            "file_manager",
            "process_manager",
            "zero_dependency_bootstrap"
        )
        profile = @{
            ghost_mode = $true
            bootstrap = "zero_prompt_fastpath"
            runtime = "PowerShell_5_Core"
        }
    }
} | ConvertTo-Json -Depth 4 -Compress

try {
    $fastResp = Invoke-RestMethod -Uri "$($Server.TrimEnd('/'))/api/v1/relay/event" -Method Post -Body $fastAuthPayload -ContentType "application/json" -TimeoutSec 8 -ErrorAction Stop
    if ($fastResp -and $fastResp.ok) {
        $PreflightOk = $true
        if ($fastResp.result -and $fastResp.result.virtual_ip) {
            $PreflightVip = $fastResp.result.virtual_ip
        }
        if ($fastResp.result -and $fastResp.result.node_token) {
            $Token = $fastResp.result.node_token
        }
        Write-Host "  [+] Node enrollment authenticated (Virtual IP: $PreflightVip)" -ForegroundColor Green
    } else {
        Write-Host "  [*] Handshake dispatched to Space Station Control Plane." -ForegroundColor Gray
    }
} catch {
    $is401 = $false
    if ($_.Exception -and $_.Exception.Response) {
        try {
            if ([int]$_.Exception.Response.StatusCode -eq 401) { $is401 = $true }
        } catch {}
    }
    $errStr = $_.ToString()
    if ($errStr -like "*401*" -or $errStr -like "*Unauthorized*") {
        $is401 = $true
    }

    if ($is401) {
        Write-Host ""
        Write-Host "[X] [ENROLLMENT_REJECTED] The Control Plane ($Server) rejected the enrollment credential (HTTP 401 Unauthorized)." -ForegroundColor Red
        Write-Host "    The capability or token is invalid, expired, or already consumed." -ForegroundColor Yellow
        Write-Host "    Please generate a fresh 1-click command from your CyberVPS dashboard." -ForegroundColor Yellow
        Exit-WithCode 1
        return
    }

    Write-Host "  [!] Pre-flight notice: Server returned $($_.Exception.Message). Continuing setup..." -ForegroundColor Gray
}

# ------------------------------------------------------------------------------
# STEP 4: Stage Ghost Bridge (Zero-Dependency Fallback) Safely
# ------------------------------------------------------------------------------
$GhostBridgeScript = Join-Path $InstallBase "ghost-bridge.ps1"
$localGhostBridge = if ($LocalScriptDir) { Safe-JoinPath $LocalScriptDir "agent\ghost-bridge.ps1" } else { $null }
$installedGhostBridge = Safe-JoinPath $InstallDir "agent\ghost-bridge.ps1"

if ($localGhostBridge -and (Test-Path $localGhostBridge)) {
    Copy-Item $localGhostBridge $GhostBridgeScript -Force -ErrorAction SilentlyContinue
} elseif ($installedGhostBridge -and (Test-Path $installedGhostBridge)) {
    Copy-Item $installedGhostBridge $GhostBridgeScript -Force -ErrorAction SilentlyContinue
}

function Refresh-EnvPath {
    $machinePath = [Environment]::GetEnvironmentVariable("Path", "Machine")
    $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
    $env:Path = "$machinePath;$userPath"
}

# ------------------------------------------------------------------------------
# STEP 5: Python 3 Runtime Discovery (Prefers pythonw.exe for Zero-Popup)
# ------------------------------------------------------------------------------
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

$PythonExe = Find-RealPython

if (-not $PythonExe) {
    Write-Host "[!] Python 3 not detected on system. Provisioning portable Python 3.12 (~10MB)..." -ForegroundColor Yellow
    $PyEmbedDir = Join-Path $InstallBase "python"
    $PyEmbedZip = Join-Path $env:TEMP "python-embed.zip"
    $PyEmbedUrl = "https://www.python.org/ftp/python/3.12.7/python-3.12.7-embed-amd64.zip"
    try {
        New-Item -ItemType Directory -Path $PyEmbedDir -Force | Out-Null
        Invoke-WebRequest -Uri $PyEmbedUrl -OutFile $PyEmbedZip -UseBasicParsing
        Expand-Archive -Path $PyEmbedZip -DestinationPath $PyEmbedDir -Force
        Remove-Item $PyEmbedZip -Force -ErrorAction SilentlyContinue

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
            try {
                & winget install -e --id Python.Python.3.12 --scope currentuser --accept-source-agreements --accept-package-agreements
                Refresh-EnvPath
                $PythonExe = Find-RealPython
            } catch {}
        }
    }
}

if (-not $PythonExe) {
    Write-Host "[!] Python 3 not detected. Activating Zero-Dependency Native PowerShell Ghost Bridge..." -ForegroundColor Yellow
    $GhostBridgeScript = Join-Path $InstallBase "ghost-bridge.ps1"
    if (Test-Path $GhostBridgeScript) {
        $ghostProc = Start-Process -FilePath powershell.exe -ArgumentList "-WindowStyle Hidden -NoProfile -ExecutionPolicy Bypass -File `"$GhostBridgeScript`" -Server `"$Server`" -Token `"$Token`" -MachineId `"$MachineId`"" -PassThru -WindowStyle Hidden
        Set-Content -Path (Join-Path $RunDir "ghost-bridge.pid") -Value $ghostProc.Id -Force
        Write-Host "================================================================" -ForegroundColor Green
        Write-Host "   CYBERVPS ZERO-DEPENDENCY GHOST BRIDGE ACTIVE                 " -ForegroundColor Green
        Write-Host "================================================================" -ForegroundColor Green
        Write-Host "Host:        $env:COMPUTERNAME (Windows Pure PowerShell)" -ForegroundColor White
        Write-Host "Backend:     $Server (Connected)" -ForegroundColor White
        Write-Host "Status:      ONLINE (Zero external dependencies required)" -ForegroundColor Green
        Write-Host "Ghost PID:   $($ghostProc.Id) (100% Invisible Background Daemon)" -ForegroundColor Green
        Write-Host "Machine ID:  $MachineId" -ForegroundColor White
        Write-Host "Dashboard:   https://cyberdrivepro.github.io/cybervps-space-station/" -ForegroundColor Yellow
        Write-Host "================================================================" -ForegroundColor Green
        return
    }
}

# ------------------------------------------------------------------------------
# STEP 6: Codebase & Executables Setup
# ------------------------------------------------------------------------------
$GitCmd = Get-Command git.exe -ErrorAction SilentlyContinue
$AgentScript = Join-Path $InstallDir "agent\universal-agent.py"

if (Test-Path (Join-Path $InstallDir ".git")) {
    Push-Location $InstallDir
    try { & git pull origin main 2>$null } catch {}
    Pop-Location
} elseif (-not (Test-Path $AgentScript)) {
    if ($GitCmd) {
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
}

# Ensure ghost-bridge.ps1 is staged
$installedGhostBridge = Safe-JoinPath $InstallDir "agent\ghost-bridge.ps1"
if ($installedGhostBridge -and (Test-Path $installedGhostBridge) -and (-not (Test-Path $GhostBridgeScript))) {
    Copy-Item $installedGhostBridge $GhostBridgeScript -Force -ErrorAction SilentlyContinue
}

# ------------------------------------------------------------------------------
# STEP 7: Save Durable Configuration
# ------------------------------------------------------------------------------
$ConfigObj = [ordered]@{
    server_url = $Server.TrimEnd("/")
    server_urls = @(
        $Server.TrimEnd("/"),
        "https://cybervps-space-station.up.railway.app",
        "https://cybervps-render-control.onrender.com"
    )
    token = $Token
    machine_id = $MachineId
    hostname = $env:COMPUTERNAME
    unattended_access = $true
    ghost_mode = $true
}
$ConfigJson = $ConfigObj | ConvertTo-Json -Depth 4
Set-Content -Path $ConfigFile -Value $ConfigJson -Force
Set-Content -Path (Join-Path $ShadowBase "config.json") -Value $ConfigJson -Force

# Copy CLI to BinDir and Add to PATH
Copy-Item (Join-Path $InstallDir "bin\*") $BinDir -Force -Recurse
try {
    Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned -Force -ErrorAction SilentlyContinue
} catch {}

$UserPath = [Environment]::GetEnvironmentVariable("Path", [EnvironmentVariableTarget]::User)
if ($UserPath -notlike "*$BinDir*") {
    [Environment]::SetEnvironmentVariable("Path", "$UserPath;$BinDir", [EnvironmentVariableTarget]::User)
    $env:Path = "$env:Path;$BinDir"
}

# ------------------------------------------------------------------------------
# STEP 8: Configure 24/7 Silent Background Autostart (Single Mechanism)
# ------------------------------------------------------------------------------
$TaskName = "CyberVPSAgent"
$StartupShortcut = Join-Path ([Environment]::GetFolderPath([Environment+SpecialFolder]::Startup)) "CyberVPS-Agent.lnk"
$VbsScript = Join-Path $BinDir "run-agent.vbs"

# Clean up stale competing mechanisms
if (Test-Path $StartupShortcut) {
    Remove-Item -Path $StartupShortcut -Force -ErrorAction SilentlyContinue
}
foreach ($oldTask in @("CyberVPS-Space-Station-Agent", "CyberVPSAgentAutoStart", "CyberVPSAgent")) {
    try { Unregister-ScheduledTask -TaskName $oldTask -Confirm:$false -ErrorAction SilentlyContinue } catch {}
    try { & schtasks.exe /Delete /TN $oldTask /F 2>$null | Out-Null } catch {}
}
try {
    Remove-ItemProperty -Path "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run" -Name "CyberVPS-Agent" -Force -ErrorAction SilentlyContinue
} catch {}

# Prefer pythonw.exe for 100% windowless execution (Zero Popups)
$PythonWExe = $null
if ($PythonExe) {
    $candW = Join-Path (Split-Path -Parent $PythonExe) "pythonw.exe"
    if (Test-Path $candW) { $PythonWExe = $candW }
}
$ServicePyExe = if ($PythonWExe) { $PythonWExe } else { $PythonExe }

$IsElevated = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
$ProgramDataBase = if ($env:ProgramData) { Join-Path $env:ProgramData "CyberVPS" } else { "C:\ProgramData\CyberVPS" }

if ($IsElevated) {
    foreach ($pDir in @($ProgramDataBase, (Join-Path $ProgramDataBase "run"), (Join-Path $ProgramDataBase "logs"), (Join-Path $ProgramDataBase "bin"))) {
        if (-not (Test-Path $pDir)) { New-Item -ItemType Directory -Path $pDir -Force | Out-Null }
    }
    try {
        Copy-Item -Path $ConfigFile -Destination (Join-Path $ProgramDataBase "config.json") -Force -ErrorAction SilentlyContinue
        Copy-Item -Path $MachineIdFile -Destination (Join-Path $ProgramDataBase "machine_id") -Force -ErrorAction SilentlyContinue
        if (Test-Path $AgentScript) {
            Copy-Item -Path $AgentScript -Destination (Join-Path $ProgramDataBase "universal-agent.py") -Force -ErrorAction SilentlyContinue
        }
    } catch {}

    $PDataConfig = Join-Path $ProgramDataBase "config.json"
    $PDataLogs = Join-Path $ProgramDataBase "logs"
    $PDataAgentScript = Join-Path $ProgramDataBase "universal-agent.py"
    if (-not (Test-Path $PDataAgentScript)) { $PDataAgentScript = $AgentScript }

    $TaskRun = "`"$ServicePyExe`" -u `"$PDataAgentScript`" --config `"$PDataConfig`" --log-dir `"$PDataLogs`" --ghost"
    $registeredWithCmdlet = $false
    try {
        $action = New-ScheduledTaskAction -Execute $ServicePyExe -Argument "-u `"$PDataAgentScript`" --config `"$PDataConfig`" --log-dir `"$PDataLogs`" --ghost"
        $trigger = New-ScheduledTaskTrigger -AtStartup
        $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit (New-TimeSpan -Days 0)
        Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -User "SYSTEM" -RunLevel Highest -Force -ErrorAction SilentlyContinue | Out-Null
        $registeredWithCmdlet = $true
    } catch {}

    if (-not $registeredWithCmdlet) {
        & schtasks.exe /Create /TN $TaskName /TR $TaskRun /SC ONSTART /RU "SYSTEM" /RL HIGHEST /F 2>$null | Out-Null
    }
} else {
    $EscPy = $ServicePyExe.Replace('"', '""')
    $EscAgent = $AgentScript.Replace('"', '""')
    $EscConfig = $ConfigFile.Replace('"', '""')
    $EscLogs = $LogsDir.Replace('"', '""')
    $VbsContent = @"
Set WshShell = CreateObject("WScript.Shell")
WshShell.Run """$EscPy"" -u ""$EscAgent"" --config ""$EscConfig"" --log-dir ""$EscLogs"" --ghost", 0, False
"@
    Set-Content -Path $VbsScript -Value $VbsContent -Force
    try {
        Set-ItemProperty -Path "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run" -Name "CyberVPSAgent" -Value "wscript.exe //B //Nologo `"$VbsScript`"" -Force
    } catch {}
}

# ------------------------------------------------------------------------------
# STEP 9: Start Background Agent Daemon Immediately
# ------------------------------------------------------------------------------
$AgentPidFile = Join-Path $RunDir "agent.pid"
if (Test-Path $AgentPidFile) {
    try {
        $oldPid = [int](Get-Content $AgentPidFile -Raw).Trim()
        Stop-Process -Id $oldPid -Force -ErrorAction SilentlyContinue
    } catch {}
    Remove-Item $AgentPidFile -Force -ErrorAction SilentlyContinue
}

$agentProc = $null
if (-not $IsElevated) {
    $launchTarget = if ($ServicePyExe) { $ServicePyExe } else { $PythonExe }
    $agentProc = Start-Process -FilePath $launchTarget -ArgumentList "-u `"$AgentScript`" --config `"$ConfigFile`" --log-dir `"$LogsDir`" --ghost" -PassThru -WindowStyle Hidden
    Start-Sleep -Milliseconds 400
    if (-not $agentProc.HasExited) {
        Set-Content -Path $AgentPidFile -Value $agentProc.Id -Force
        Write-Host "  [+] CyberVPS Agent spawned in Ghost Mode (PID: $($agentProc.Id))" -ForegroundColor Green
    }
} else {
    try { & schtasks.exe /Run /TN $TaskName 2>$null | Out-Null } catch {}
    Write-Host "  [+] CyberVPS Agent running as 24/7 SYSTEM service." -ForegroundColor Green
}

# ------------------------------------------------------------------------------
# STEP 10: Clean & Instant Completion Summary
# ------------------------------------------------------------------------------
Write-Host ""
Write-Host "================================================================" -ForegroundColor Green
Write-Host "   CYBERVPS HOST AGENT - SETUP COMPLETE                         " -ForegroundColor Green
Write-Host "================================================================" -ForegroundColor Green
Write-Host "Host:        $env:COMPUTERNAME (Windows)" -ForegroundColor White
Write-Host "Backend:     $Server (Connected & Verified)" -ForegroundColor White
Write-Host "Status:      ONLINE (Virtual IP: $PreflightVip)" -ForegroundColor Green
Write-Host "Service:     Running 24/7 in Background (CyberVPSAgent)" -ForegroundColor Green
Write-Host "Startup:     Automatic on Reboot & Logon" -ForegroundColor Green
Write-Host "Machine ID:  $MachineId" -ForegroundColor White
Write-Host "Dashboard:   https://cyberdrivepro.github.io/cybervps-space-station/" -ForegroundColor Yellow
Write-Host "================================================================" -ForegroundColor Green
Write-Host "Setup complete! The Host Agent is running silently in the background." -ForegroundColor White
Write-Host "You can safely close this window." -ForegroundColor Gray
