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
$InstallDir = Join-Path $BaseDir "space-station"
$RunDir = Join-Path $BaseDir "run"
$LogsDir = Join-Path $BaseDir "logs"
$ConfigFile = Join-Path $BaseDir "config.json"
$AgentPidFile = Join-Path $RunDir "agent.pid"
$AgentLogFile = Join-Path $LogsDir "agent.log"
$AgentScript = Join-Path $InstallDir "agent\universal-agent.py"
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
        "$BaseDir\python\python.exe"
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
    if (Test-Path $ConfigFile) {
        try {
            return Get-Content $ConfigFile -Raw | ConvertFrom-Json
        } catch {}
    }
    return @{
        server_url = "https://cybervps-space-station.up.railway.app"
        token = "cvps_enroll_master_token"
        machine_id = "cvps_$env:COMPUTERNAME"
        hostname = $env:COMPUTERNAME
    }
}

switch ($Command.ToLower()) {
    "start" {
        $cfg = Load-Config
        $py = Find-Python
        if (-not $py) {
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
        Write-Host "[*] Starting CyberVPS Host Agent in background..." -ForegroundColor Cyan
        $proc = Start-Process -FilePath $py -ArgumentList "-u `"$AgentScript`" --config `"$ConfigFile`" --log-dir `"$LogsDir`"" -PassThru -WindowStyle Hidden
        Set-Content -Path $AgentPidFile -Value $proc.Id -Force
        Start-Sleep -Seconds 1
        if (Is-PidRunning $proc.Id) {
            Write-Host "[+] CyberVPS Host Agent started successfully (PID: $($proc.Id))." -ForegroundColor Green
            Write-Host "    Connected to: $($cfg.server_url)"
            Write-Host "    View logs with: cybervps logs"
        } else {
            Write-Host "[X] Agent process exited immediately. Inspect logs at: $AgentLogFile" -ForegroundColor Red
        }
    }

    "stop" {
        if (-not (Test-Path $AgentPidFile)) {
            Write-Host "[*] CyberVPS Host Agent is not running (PID file not found)." -ForegroundColor Yellow
            return
        }
        $pidToKill = [int](Get-Content $AgentPidFile -Raw).Trim()
        if (Is-PidRunning $pidToKill) {
            Write-Host "[*] Stopping CyberVPS Agent (PID: $pidToKill)..." -ForegroundColor Cyan
            Stop-Process -Id $pidToKill -Force -ErrorAction SilentlyContinue
            Start-Sleep -Milliseconds 500
            Write-Host "[+] CyberVPS Agent stopped." -ForegroundColor Green
        } else {
            Write-Host "[*] Agent PID $pidToKill was not active." -ForegroundColor Yellow
        }
        Remove-Item $AgentPidFile -Force -ErrorAction SilentlyContinue
    }

    "restart" {
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

    default {
        Write-Host "Usage: cybervps <start|stop|restart|status|doctor|logs|version>"
    }
}
