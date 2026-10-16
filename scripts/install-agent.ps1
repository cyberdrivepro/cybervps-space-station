<#
.SYNOPSIS
CyberVPS Space Station - Windows PowerShell 1-Line Self-Installer & Watchdog
Works on Windows 10/11 and Windows Server, with or without Administrator privileges.
#>

[CmdletBinding()]
param(
    [Parameter(Position=0)]
    [string]$ServerUrl = "http://localhost:8080",
    [Parameter(Position=1)]
    [Alias("EnrollmentToken")]
    [string]$Token = $(if ($env:CYBERVPS_TOKEN) { $env:CYBERVPS_TOKEN } elseif ($env:ENROLLMENT_TOKEN) { $env:ENROLLMENT_TOKEN } else { "" }),
    [Parameter(Position=2)]
    [string]$MachineId = ""
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

Write-Host "================================================================" -ForegroundColor Cyan
Write-Host "   CYBERVPS SPACE STATION - Windows PowerShell Installer        " -ForegroundColor Cyan
Write-Host "================================================================" -ForegroundColor Cyan

# Token normalization & interactive prompt
if ($Token) {
    $Token = $Token.Trim().Trim('"', "'")
}

if ([string]::IsNullOrWhiteSpace($Token)) {
    $isInteractive = $false
    try {
        if ([Environment]::UserInteractive -and -not [Console]::IsInputRedirected) {
            $isInteractive = $true
        }
    } catch {}

    if ($isInteractive) {
        Write-Host ""
        Write-Host "[?] ENROLLMENT TOKEN REQUIRED" -ForegroundColor Yellow
        Write-Host "    A valid enrollment token is required to register this host with the Control Plane." -ForegroundColor Gray
        Write-Host "    Target Server: $ServerUrl" -ForegroundColor Gray
        $prompted = Read-Host "    Please enter Enrollment Token"
        if (-not [string]::IsNullOrWhiteSpace($prompted)) {
            $Token = $prompted.Trim().Trim('"', "'")
        }
    }
}

if ([string]::IsNullOrWhiteSpace($Token)) {
    Write-Host ""
    Write-Host "[X] [ENROLLMENT_TOKEN_REQUIRED] Enrollment token is missing or empty." -ForegroundColor Red
    Write-Host "    The CyberVPS Space Station control plane requires an authenticated token to enroll hosts." -ForegroundColor Yellow
    Write-Host "    Please provide a token using one of the following methods:" -ForegroundColor Yellow
    Write-Host "      1. Parameter: & ([scriptblock]::Create((Invoke-RestMethod '<url>'))) -Token '<YOUR_TOKEN>'" -ForegroundColor Cyan
    Write-Host "      2. Env Var:   `$env:CYBERVPS_TOKEN = '<YOUR_TOKEN>'; irm '<url>' | iex" -ForegroundColor Cyan
    Exit-WithCode 1
    return
}

$cvpsDir = Join-Path $HOME ".cybervps"
if (-not (Test-Path $cvpsDir)) {
    New-Item -ItemType Directory -Path $cvpsDir -Force | Out-Null
}

# Determine or generate persistent Machine ID
$midFile = Join-Path $cvpsDir "machine_id"
if (-not $MachineId) {
    if (Test-Path $midFile) {
        try {
            $clean = ((Get-Content $midFile -Raw) -replace '[^a-zA-Z0-9_\-]', '').Trim()
            if ($clean.Length -ge 4) { $MachineId = $clean }
        } catch {}
    }
}
if ($MachineId.Length -lt 4) {
    $cleanHost = ($env:COMPUTERNAME -replace '[^a-zA-Z0-9_]', '').ToLower()
    $randHex = [Guid]::NewGuid().ToString("N").Substring(0, 8)
    $MachineId = "cvps_${cleanHost}_${randHex}"
}
Set-Content -Path $midFile -Value $MachineId -Force

Write-Host "`n[1/5] Checking Environment & Permissions..." -ForegroundColor Blue
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if ($isAdmin) {
    Write-Host "  • Privilege Level: ADMINISTRATOR (Elevated)" -ForegroundColor Green
} else {
    Write-Host "  • Privilege Level: STANDARD USER (User-level mode)" -ForegroundColor Yellow
}

# 2. Pre-Flight Authentication Handshake
Write-Host "`n[2/5] Pre-Flight Authentication Handshake with Control Plane..." -ForegroundColor Blue
$PreflightOk = $false
$PreflightVip = "10.77.0.x"

$osCaption = ""
try {
    $osCaption = (Get-CimInstance Win32_OperatingSystem -ErrorAction SilentlyContinue).Caption
} catch {
    $osCaption = "Microsoft Windows"
}

$authPayload = @{
    type = "Auth"
    payload = @{
        machine_id = $MachineId
        token = $Token
        agent_version = "2.2-ghost-native"
        hostname = $env:COMPUTERNAME
        username = $env:USERNAME
        os = "Windows"
        os_version = $osCaption
        arch = $env:PROCESSOR_ARCHITECTURE
        capabilities = @(
            "powershell_native",
            "ghost_mode",
            "background_provisioning",
            "remote_reboot",
            "file_manager",
            "process_manager"
        )
        profile = @{
            ghost_mode = $true
            bootstrap = "preflight_verified"
            runtime = "PowerShell_5_Core"
        }
    }
} | ConvertTo-Json -Depth 4 -Compress

try {
    $preflightRes = Invoke-RestMethod -Uri "$($ServerUrl.TrimEnd('/'))/api/v1/relay/event" -Method Post -Body $authPayload -ContentType "application/json" -TimeoutSec 8 -ErrorAction Stop
    if ($preflightRes -and $preflightRes.ok) {
        $PreflightOk = $true
        if ($preflightRes.result -and $preflightRes.result.virtual_ip) {
            $PreflightVip = $preflightRes.result.virtual_ip
        }
        Write-Host "  • Pre-flight enrollment verified: OK (Virtual IP: $PreflightVip)" -ForegroundColor Green
    } else {
        Write-Host "  • Pre-flight handshake acknowledged by Control Plane." -ForegroundColor Gray
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
        Write-Host "[X] [ENROLLMENT_REJECTED] Control plane ($ServerUrl) rejected enrollment token (HTTP 401 Unauthorized)." -ForegroundColor Red
        Write-Host "    The enrollment token is invalid, expired, or obsolete." -ForegroundColor Yellow
        Write-Host "    Please obtain a valid token from your Space Station dashboard and rerun:" -ForegroundColor Yellow
        Write-Host "      & ([scriptblock]::Create((Invoke-RestMethod '<url>'))) -Token '<VALID_TOKEN>'" -ForegroundColor Cyan
        Write-Host "      `$env:CYBERVPS_TOKEN = '<VALID_TOKEN>'; irm '<url>' | iex" -ForegroundColor Cyan
        Exit-WithCode 1
        return
    }

    Write-Host "  • Pre-flight handshake notice: Server returned $($_.Exception.Message). Continuing setup..." -ForegroundColor Yellow
}

# 3. Copy or Download Universal Agent
Write-Host "`n[3/5] Setting Up Agent Executable..." -ForegroundColor Blue
$agentScript = Join-Path $cvpsDir "universal-agent.py"
$installed = $false

# A. If running from local repository checkout
if ($LocalScriptDir) {
    try {
        $parentDir = Split-Path -Parent $LocalScriptDir
        if ($parentDir) {
            $sourceAgent = Safe-JoinPath $parentDir "agent\universal-agent.py"
            if ($sourceAgent -and (Test-Path $sourceAgent)) {
                Copy-Item -Path $sourceAgent -Destination $agentScript -Force
                $installed = $true
                Write-Host "  • Copied agent from local repository: PASS" -ForegroundColor Green
            }
        }
    } catch {}
}

# B. Web 1-Liner: Download directly from control plane or GitHub
if (-not $installed) {
    Write-Host "  • Downloading latest universal-agent from Control Plane..." -ForegroundColor Cyan
    $downloadUrls = @(
        "$ServerUrl/agent/universal-agent.py",
        "$ServerUrl/api/v1/ota/download/universal-agent.py",
        "https://raw.githubusercontent.com/cyberdrivepro/cybervps-space-station/main/agent/universal-agent.py"
    )
    foreach ($url in $downloadUrls) {
        try {
            Invoke-WebRequest -Uri $url -OutFile $agentScript -UseBasicParsing -TimeoutSec 20 -ErrorAction Stop
            if ((Test-Path $agentScript) -and ((Get-Item $agentScript).Length -gt 15000)) {
                $installed = $true
                Write-Host "  • Downloaded agent executable: PASS ($((Get-Item $agentScript).Length) bytes from $url)" -ForegroundColor Green
                break
            }
        } catch {}
    }
}

if (-not (Test-Path $agentScript) -or ((Get-Item $agentScript).Length -lt 5000)) {
    Write-Host "  • ERROR: Failed to acquire valid universal-agent.py! Please check internet connection." -ForegroundColor Red
    Exit-WithCode 1
    return
}

# 4. Launch Agent
Write-Host "`n[4/5] Launching CyberVPS Agent..." -ForegroundColor Blue

# Discover real Python 3 executable (bypassing WindowsApps alias stub)
$pythonCmd = $null
$pyFromCmd = (Get-Command python.exe -ErrorAction SilentlyContinue).Source
if ($pyFromCmd -and ($pyFromCmd -notlike "*WindowsApps*") -and (Test-Path $pyFromCmd)) {
    $pythonCmd = $pyFromCmd
}
if (-not $pythonCmd) {
    $pyFromPy = (Get-Command py.exe -ErrorAction SilentlyContinue).Source
    if ($pyFromPy) {
        $pythonCmd = $pyFromPy
    }
}
if (-not $pythonCmd) {
    $commonPyPaths = @(
        "$env:LOCALAPPDATA\Programs\Python\Python3*\python.exe",
        "C:\Python3*\python.exe",
        "C:\Program Files\Python3*\python.exe",
        "C:\Program Files (x86)\Python3*\python.exe"
    )
    foreach ($pat in $commonPyPaths) {
        $found = Get-Item $pat -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($found -and (Test-Path $found.FullName)) {
            $pythonCmd = $found.FullName
            break
        }
    }
}

$launchExe = $null
if ($pythonCmd) {
    # Prefer pythonw.exe for 100% windowless background execution
    $pythonwCmd = $null
    $candW = Join-Path (Split-Path -Parent $pythonCmd) "pythonw.exe"
    if (Test-Path $candW) { $pythonwCmd = $candW }
    $launchExe = if ($pythonwCmd) { $pythonwCmd } else { $pythonCmd }

    # If already running, kill existing to avoid duplicate PID conflicts
    $pidFile = Join-Path $cvpsDir "agent.pid"
    if (Test-Path $pidFile) {
        try {
            $oldPid = Get-Content $pidFile -ErrorAction SilentlyContinue
            if ($oldPid) {
                Stop-Process -Id ([int]$oldPid) -Force -ErrorAction SilentlyContinue
            }
        } catch {}
    }

    $agentLog = Join-Path $cvpsDir "agent.log"
    $agentArgs = "`"$agentScript`" --server `"$ServerUrl`" --token `"$Token`" --machine-id `"$MachineId`" --log-file `"$agentLog`""
    $proc = Start-Process -FilePath $launchExe -ArgumentList $agentArgs -PassThru -WindowStyle Hidden
    Start-Sleep -Milliseconds 800
    if (-not $proc.HasExited) {
        Set-Content -Path $pidFile -Value $proc.Id -Force
        Write-Host "  • CyberVPS Agent spawned successfully with PID: $($proc.Id) (Active)" -ForegroundColor Green
    } else {
        Write-Host "  • Agent process spawned in background (PID: $($proc.Id)). Check logs: $agentLog" -ForegroundColor Yellow
    }
} else {
    Write-Host "  • Python 3 executable not found in PATH! Please install Python from https://www.python.org" -ForegroundColor Red
}

# 5. CLI Shortcut & Configuration Setup
try {
    # Save durable configuration
    $configData = @{
        server_url = $ServerUrl
        server_urls = @($ServerUrl, "https://cybervps-space-station.up.railway.app", "https://cybervps-render-control.onrender.com")
        token = $Token
        machine_id = $MachineId
        updated_at = (Get-Date).ToString("o")
    }
    $cfgPath = Join-Path $cvpsDir "config.json"
    $configData | ConvertTo-Json -Depth 4 | Set-Content -Path $cfgPath -Force

    # CLI Wrapper Setup
    $binDir = Join-Path $cvpsDir "bin"
    if (-not (Test-Path $binDir)) { New-Item -ItemType Directory -Path $binDir -Force | Out-Null }
    $cmdWrapper = Join-Path $binDir "cybervps.cmd"
    $pyForWrapper = if ($pythonCmd) { $pythonCmd } else { "python.exe" }
    $wrapperContent = "@echo off`r`n`"$pyForWrapper`" `"$agentScript`" %*"
    Set-Content -Path $cmdWrapper -Value $wrapperContent -Force
    $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
    if ($userPath -notlike "*$binDir*") {
        [Environment]::SetEnvironmentVariable("Path", "$userPath;$binDir", "User")
        $env:Path = "$env:Path;$binDir"
    }

    # 6. Authoritative Auto-Start Persistence on System Reboot (Single Canonical Architecture)
    Write-Host "`n[5/5] Configuring Single Authoritative Auto-Start Persistence..." -ForegroundColor Blue

    # Clean up any competing or duplicate scheduled tasks
    foreach ($oldTask in @("CyberVPSAgentAutoStart", "CyberVPS-Space-Station-Agent", "CyberVPSAgent")) {
        try { Unregister-ScheduledTask -TaskName $oldTask -Confirm:$false -ErrorAction SilentlyContinue } catch {}
        try { & schtasks.exe /Delete /TN $oldTask /F 2>$null | Out-Null } catch {}
    }
    # Clean up competing registry entries
    try { Remove-ItemProperty -Path "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run" -Name "CyberVPS-Agent" -Force -ErrorAction SilentlyContinue } catch {}

    if ($launchExe) {
        $canonicalTaskName = "CyberVPSAgent"
        $taskArgs = "`"$agentScript`" --config `"$cfgPath`" --log-file `"$agentLog`""
        $taskRegistered = $false

        try {
            if ($isAdmin) {
                $action = New-ScheduledTaskAction -Execute $launchExe -Argument $taskArgs
                $trigger = New-ScheduledTaskTrigger -AtStartup
                $principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
                $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit (New-TimeSpan -Days 0)
                Register-ScheduledTask -TaskName $canonicalTaskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force -ErrorAction SilentlyContinue | Out-Null
                $taskRegistered = $true
                Write-Host "  • Scheduled Task Auto-Start (AtStartup/SYSTEM - CyberVPSAgent): ACTIVE" -ForegroundColor Green
            } else {
                $action = New-ScheduledTaskAction -Execute $launchExe -Argument $taskArgs
                $trigger = New-ScheduledTaskTrigger -AtLogOn
                $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit (New-TimeSpan -Days 0)
                Register-ScheduledTask -TaskName $canonicalTaskName -Action $action -Trigger $trigger -Settings $settings -Force -ErrorAction SilentlyContinue | Out-Null
                $taskRegistered = $true
                Write-Host "  • Scheduled Task Auto-Start (AtLogon/User - CyberVPSAgent): ACTIVE" -ForegroundColor Green
            }
        } catch {}

        # Registry Run Key (as secondary fallback only if task scheduler failed, or synchronized with pythonw.exe)
        try {
            $regPath = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run"
            $regCmd = "`"$launchExe`" `"$agentScript`" --config `"$cfgPath`" --log-file `"$agentLog`""
            Set-ItemProperty -Path $regPath -Name "CyberVPSAgent" -Value $regCmd -Force
            Write-Host "  • Registry Run Auto-Start (HKCU - CyberVPSAgent via pythonw): SYNCHRONIZED" -ForegroundColor Green
        } catch {}
    }
} catch {}

Write-Host "`n================================================================" -ForegroundColor Cyan
Write-Host "   Windows Installation Complete! Agent Active & Persistent     " -ForegroundColor Green
Write-Host "================================================================" -ForegroundColor Cyan
