<#
.SYNOPSIS
CyberVPS Space Station - Windows PowerShell 1-Line Self-Installer & Watchdog
Works on Windows 10/11 and Windows Server, with or without Administrator privileges.
#>

param(
    [string]$ServerUrl = "http://localhost:8080",
    [string]$Token = "cvps_enroll_master_token",
    [string]$MachineId = ""
)

Write-Host "================================================================" -ForegroundColor Cyan
Write-Host "   🚀 CyberVPS SPACE STATION - Windows PowerShell Installer      " -ForegroundColor Cyan
Write-Host "================================================================" -ForegroundColor Cyan

$cvpsDir = Join-Path $HOME ".cybervps"
if (-not (Test-Path $cvpsDir)) {
    New-Item -ItemType Directory -Path $cvpsDir -Force | Out-Null
}

Write-Host "`n[1/4] Checking Environment & Permissions..." -ForegroundColor Blue
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if ($isAdmin) {
    Write-Host "  • Privilege Level: ADMINISTRATOR (Elevated)" -ForegroundColor Green
} else {
    Write-Host "  • Privilege Level: STANDARD USER (User-level mode)" -ForegroundColor Yellow
}

# 2. Connectivity Check
Write-Host "`n[2/4] Testing Connectivity with Control Plane..." -ForegroundColor Blue
$healthUrl = "$ServerUrl/health"
try {
    $res = Invoke-WebRequest -Uri $healthUrl -TimeoutSec 5 -UseBasicParsing -ErrorAction SilentlyContinue
    if ($res.StatusCode -eq 200) {
        Write-Host "  • Control Plane Reachable: PASS ($healthUrl returned 200 OK)" -ForegroundColor Green
    } else {
        Write-Host "  • Control Plane Reachable: WARN ($healthUrl returned $($res.StatusCode))" -ForegroundColor Yellow
    }
} catch {
    Write-Host "  • Control Plane Reachable: WARN (Target unreachable or cold start: $($_.Exception.Message))" -ForegroundColor Yellow
}

# 3. Copy or Download Universal Agent
Write-Host "`n[3/4] Setting Up Agent Executable..." -ForegroundColor Blue
$agentScript = Join-Path $cvpsDir "universal-agent.py"
$installed = $false

# A. If running from local repository checkout
if ($PSScriptRoot) {
    try {
        $parentDir = Split-Path -Parent $PSScriptRoot
        if ($parentDir) {
            $sourceAgent = Join-Path $parentDir "agent\universal-agent.py"
            if (Test-Path $sourceAgent) {
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
    return
}

# 4. Launch Agent
Write-Host "`n[4/4] Launching CyberVPS Agent..." -ForegroundColor Blue

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
    $wrapperContent = "@echo off`r`n`"$pythonCmd`" `"$agentScript`" %*"
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
} catch {}
} catch {}

Write-Host "`n================================================================" -ForegroundColor Cyan
Write-Host "   🎉 Windows Installation Complete! Agent Active & Persistent  " -ForegroundColor Green
Write-Host "================================================================" -ForegroundColor Cyan
