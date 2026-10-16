# ==============================================================================
# CyberVPS SPACE STATION - Native Windows PowerShell CLI
# Unified Host Agent & Network Control CLI (Works without Node.js)
# ==============================================================================

[CmdletBinding()]
param (
    [Parameter(Position = 0)]
    [string]$Command = "status",
    [Parameter(Position = 1, ValueFromRemainingArguments = $true)]
    [string[]]$ArgsList
)

$BaseDir = Join-Path $HOME ".cybervps"
$ProgramDataBase = if ($env:ProgramData) { Join-Path $env:ProgramData "CyberVPS" } else { "C:\ProgramData\CyberVPS" }
if ((Test-Path (Join-Path $ProgramDataBase "run\agent.pid")) -or ((-not (Test-Path (Join-Path $BaseDir "config.json"))) -and (Test-Path (Join-Path $ProgramDataBase "config.json")))) {
    $ActiveBase = $ProgramDataBase
} else {
    $ActiveBase = $BaseDir
}

$InstallDir = Join-Path $ActiveBase "space-station"
$RunDir = Join-Path $ActiveBase "run"
$LogsDir = Join-Path $ActiveBase "logs"
$ConfigFile = Join-Path $ActiveBase "config.json"
$AgentPidFile = Join-Path $RunDir "agent.pid"
$AgentLogFile = Join-Path $LogsDir "agent.log"
$AgentScript = Join-Path $InstallDir "agent\universal-agent.py"
if (-not (Test-Path $AgentScript)) {
    $AgentScript = Join-Path $ActiveBase "universal-agent.py"
}
if (-not (Test-Path $AgentScript)) {
    $AgentScript = Join-Path $BaseDir "universal-agent.py"
}

function Find-Python {
    try {
        $raw = where.exe python 2>$null
        if ($raw) {
            foreach ($line in ($raw -split "`r?`n")) {
                $trimmed = $line.Trim()
                if ($trimmed -and ($trimmed -notlike "*WindowsApps*") -and (Test-Path $trimmed)) {
                    return $trimmed
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
        "$BaseDir\python\python.exe",
        "$ProgramDataBase\python\python.exe"
    )
    foreach ($pat in $candidates) {
        $found = Get-Item $pat -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($found -and (Test-Path $found.FullName)) { return $found.FullName }
    }
    return $null
}

function Is-PidRunning([int]$pidToCheck) {
    if ($pidToCheck -le 0) { return $false }
    try {
        $p = Get-Process -Id $pidToCheck -ErrorAction Stop
        return ($p -ne $null)
    } catch {
        return $false
    }
}

function Load-Config {
    foreach ($cand in @($ConfigFile, (Join-Path $ProgramDataBase "config.json"), (Join-Path $BaseDir "config.json"))) {
        if (Test-Path $cand) {
            try {
                return Get-Content $cand -Raw | ConvertFrom-Json
            } catch {}
        }
    }
    return @{
        server_url = "https://cybervps-space-station.up.railway.app"
        token = "cvps_enroll_master_token"
        machine_id = "cvps_$env:COMPUTERNAME"
        hostname = $env:COMPUTERNAME
    }
}

function Assert-IsAdmin([string]$action) {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($identity)
    $isAdmin = $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

    $cfg = Load-Config
    $hasTokenAuth = $false
    if ($env:CYBERVPS_ADMIN_TOKEN -and ($env:CYBERVPS_ADMIN_TOKEN -eq $cfg.token)) {
        $hasTokenAuth = $true
    }
    if ($ArgsList -and ($ArgsList -contains "--force-auth")) {
        $idx = [array]::IndexOf($ArgsList, "--force-auth")
        if ($idx -ge 0 -and ($idx + 1) -lt $ArgsList.Length) {
            if ($ArgsList[$idx + 1] -eq $cfg.token) {
                $hasTokenAuth = $true
            }
        }
    }

    if (-not $isAdmin -and -not $hasTokenAuth) {
        Write-Host "================================================================" -ForegroundColor Red
        Write-Host "  [!] [ACCESS DENIED] Privileged Operation Prohibited           " -ForegroundColor Red
        Write-Host "================================================================" -ForegroundColor Red
        Write-Host "  The '$action' command requires elevated Administrator privileges." -ForegroundColor Yellow
        Write-Host ""
        Write-Host "  Standard or shared users cannot stop, restart, or reconfigure" -ForegroundColor White
        Write-Host "  the 24/7 background CyberVPS Host Agent service." -ForegroundColor White
        Write-Host '  To perform authorized maintenance:' -ForegroundColor Cyan
        Write-Host "    * Reopen PowerShell using 'Run as Administrator'" -ForegroundColor Cyan
        Write-Host '    * Or provide authorized admin token: --force-auth [TOKEN]' -ForegroundColor Gray
        Write-Host "================================================================" -ForegroundColor Red
        exit 5
    }
}

switch ($Command.ToLower()) {
    { $_ -in @("start", "ghost") } {
        $cfg = Load-Config
        $isGhost = ($Command.ToLower() -eq "ghost" -or ($ArgsList -contains "--ghost"))
        $py = Find-Python
        if (-not $py) {
            $ghostBridgePs1 = Join-Path $InstallDir "agent\ghost-bridge.ps1"
            if (-not (Test-Path $ghostBridgePs1)) {
                $ghostBridgePs1 = Join-Path $BaseDir "ghost-bridge.ps1"
            }
            if (Test-Path $ghostBridgePs1) {
                Write-Host "[!] Python 3 not detected. Activating Zero-Dependency PowerShell Ghost Bridge..." -ForegroundColor Yellow
                $ghostProc = Start-Process -FilePath powershell.exe -ArgumentList "-WindowStyle Hidden -NoProfile -ExecutionPolicy Bypass -File `"$ghostBridgePs1`" -Server `"$($cfg.server_url)`" -Token `"$($cfg.token)`" -MachineId `"$($cfg.machine_id)`"" -PassThru -WindowStyle Hidden
                Set-Content -Path (Join-Path $RunDir "ghost-bridge.pid") -Value $ghostProc.Id -Force
                Write-Host "[+] CyberVPS Zero-Dependency Ghost Bridge active in background (PID: $($ghostProc.Id))." -ForegroundColor Green
                Write-Host "    Connected to: $($cfg.server_url)"
                Write-Host "    Ghost Mode: 100% Invisible Background Operation"
                return
            }
            Write-Host "[X] Error: Python 3 runtime not found in PATH." -ForegroundColor Red
            exit 1
        }
        if (Test-Path $AgentPidFile) {
            $existingPid = [int](Get-Content $AgentPidFile -Raw).Trim()
            if (Is-PidRunning $existingPid) {
                Write-Host "[!] CyberVPS Host Agent is already running (PID: $existingPid)." -ForegroundColor Yellow
                Write-Host "    Target: $($cfg.server_url)"
                Write-Host "    Run 'cybervps status' to inspect or 'cybervps stop' to terminate."
                return
            }
            Remove-Item $AgentPidFile -Force -ErrorAction SilentlyContinue
        }
        Write-Host "[*] Starting CyberVPS Host Agent in background $(if ($isGhost) { '(Ghost Mode)' } else { '' })..." -ForegroundColor Cyan
        $ghostFlag = if ($isGhost) { " --ghost" } else { "" }
        $proc = Start-Process -FilePath $py -ArgumentList "-u `"$AgentScript`" --config `"$ConfigFile`" --log-dir `"$LogsDir`"$ghostFlag" -PassThru -WindowStyle Hidden
        Set-Content -Path $AgentPidFile -Value $proc.Id -Force
        Start-Sleep -Seconds 1
        if (Is-PidRunning $proc.Id) {
            Write-Host "[+] CyberVPS Host Agent started successfully (PID: $($proc.Id)) $(if ($isGhost) { '[Ghost Mode]' } else { '' })." -ForegroundColor Green
            Write-Host "    Connected to: $($cfg.server_url)"
            Write-Host "    View logs with: cybervps logs"
        } else {
            Write-Host "[X] Agent process exited immediately. Inspect logs at: $AgentLogFile" -ForegroundColor Red
        }
    }

    "stop" {
        Assert-IsAdmin "stop"
        if (-not (Test-Path $AgentPidFile)) {
            Write-Host "[*] CyberVPS Host Agent is not running (PID file not found)." -ForegroundColor Yellow
            return
        }
        $pidToKill = [int](Get-Content $AgentPidFile -Raw).Trim()
        if (Is-PidRunning $pidToKill) {
            Write-Host "[*] Stopping CyberVPS Agent (PID: $pidToKill)..." -ForegroundColor Cyan
            Stop-Process -Id $pidToKill -Force -ErrorAction SilentlyContinue
            Start-Sleep -Milliseconds 500
            Write-Host "[+] CyberVPS Agent stopped by authorized administrator." -ForegroundColor Green
        } else {
            Write-Host "[*] Agent PID $pidToKill was not active." -ForegroundColor Yellow
        }
        Remove-Item $AgentPidFile -Force -ErrorAction SilentlyContinue
    }

    "restart" {
        Assert-IsAdmin "restart"
        & $PSCommandPath stop
        Start-Sleep -Seconds 1
        & $PSCommandPath start
    }

    "status" {
        $cfg = Load-Config
        $isRunning = $false
        $activePid = 0
        if (Test-Path $AgentPidFile) {
            $activePid = [int](Get-Content $AgentPidFile -Raw).Trim()
            $isRunning = (Is-PidRunning $activePid)
        }

        Write-Host "================================================================" -ForegroundColor Cyan
        Write-Host "   CYBERVPS SPACE STATION - HOST AGENT STATUS" -ForegroundColor Cyan
        Write-Host "================================================================" -ForegroundColor Cyan
        Write-Host "  Host Name       : $env:COMPUTERNAME (Windows)" -ForegroundColor White
        if ($isRunning) {
            Write-Host "  Agent Status    : ACTIVE (PID: $activePid) [24/7 Background Daemon]" -ForegroundColor Green
        } else {
            Write-Host "  Agent Status    : STOPPED / OFFLINE" -ForegroundColor Red
        }
        Write-Host "  Server Target   : $($cfg.server_url)" -ForegroundColor White
        Write-Host "  Machine ID      : $($cfg.machine_id)" -ForegroundColor White

        # Test backend reachability
        try {
            $healthRes = Invoke-RestMethod -Uri "$($cfg.server_url.TrimEnd('/'))/health" -TimeoutSec 3 -ErrorAction Stop
            Write-Host "  Server Health   : ONLINE ($($healthRes.status))" -ForegroundColor Green
        } catch {
            Write-Host "  Server Health   : UNREACHABLE ($($_.Exception.Message))" -ForegroundColor Yellow
        }
        Write-Host "  Log File        : $AgentLogFile" -ForegroundColor Gray
        Write-Host "  Dashboard       : https://cyberdrivepro.github.io/cybervps-space-station/" -ForegroundColor Cyan
        Write-Host "================================================================" -ForegroundColor Cyan
    }

    "logs" {
        if (-not (Test-Path $AgentLogFile)) {
            Write-Host "[*] No log file found at: $AgentLogFile" -ForegroundColor Yellow
            return
        }
        $tail = 40
        Get-Content $AgentLogFile -Tail $tail
    }

    "doctor" {
        Write-Host "================================================================" -ForegroundColor Cyan
        Write-Host "   CYBERVPS SPACE STATION - SYSTEM DOCTOR" -ForegroundColor Cyan
        Write-Host "================================================================" -ForegroundColor Cyan
        $py = Find-Python
        if ($py) {
            $ver = & $py --version 2>&1
            Write-Host "  [OK] Python Runtime : $ver ($py)" -ForegroundColor Green
        } else {
            Write-Host "  [X]  Python Runtime : NOT FOUND" -ForegroundColor Red
        }
        $nodeCmd = Get-Command node -ErrorAction SilentlyContinue
        if ($nodeCmd) {
            $nver = & node -v
            Write-Host "  [OK] Node.js Runtime: $nver (Optional CLI engine)" -ForegroundColor Green
        } else {
            Write-Host "  [-]  Node.js Runtime: Not installed (Optional, pure Python mode active)" -ForegroundColor Gray
        }
        $cfg = Load-Config
        try {
            $t0 = [DateTime]::UtcNow
            $res = Invoke-RestMethod -Uri "$($cfg.server_url.TrimEnd('/'))/health" -TimeoutSec 5 -ErrorAction Stop
            $elapsed = [Math]::Round(([DateTime]::UtcNow - $t0).TotalMilliseconds)
            Write-Host "  [OK] Backend Network: Reached in ${elapsed}ms ($($cfg.server_url))" -ForegroundColor Green
        } catch {
            Write-Host "  [!]  Backend Network: Failed to reach $($cfg.server_url)" -ForegroundColor Yellow
        }
        Write-Host "================================================================" -ForegroundColor Cyan
    }

    "version" {
        Write-Host "CyberVPS Space Station v1.0.0 (win32-x64, powershell)"
    }

    { $_ -in "bridge", "tunnel", "sftp", "ssh" } {
        $nodeCmd = Get-Command node -ErrorAction SilentlyContinue
        $cliJs = Join-Path $InstallDir "bin\cybervps"
        if (-not (Test-Path $cliJs)) {
            $cliJs = Join-Path $BaseDir "space-station\bin\cybervps"
        }
        if (-not (Test-Path $cliJs)) {
            $cliJs = Join-Path (Split-Path -Parent $PSScriptRoot) "bin\cybervps"
        }
        if ($nodeCmd -and (Test-Path $cliJs)) {
            & node $cliJs $Command.ToLower() @ArgsList
        } else {
            Write-Host "[!] Node.js is required for local TCP port bridge daemon." -ForegroundColor Yellow
            Write-Host "    You can access files immediately using the Web File Manager in your browser:" -ForegroundColor Cyan
            Write-Host "    https://cyberdrivepro.github.io/cybervps-space-station/" -ForegroundColor Yellow
        }
    }

    default {
        Write-Host 'Usage: cybervps [start|stop|restart|status|bridge|sftp|ssh|doctor|logs|version]'
    }
}
