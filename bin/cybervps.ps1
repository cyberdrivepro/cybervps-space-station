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
    $InstallScope = "Machine-Wide (ProgramData)"
} else {
    $ActiveBase = $BaseDir
    $InstallScope = "User-Profile ($HOME\.cybervps)"
}

$InstallDir = Join-Path $ActiveBase "space-station"
$RunDir = Join-Path $ActiveBase "run"
$LogsDir = Join-Path $ActiveBase "logs"
$ConfigFile = Join-Path $ActiveBase "config.json"
$AgentPidFile = Join-Path $RunDir "agent.pid"
$AgentLogFile = Join-Path $LogsDir "agent.log"
$BootstrapLogFile = Join-Path $LogsDir "startup-bootstrap.log"

$AgentScript = Join-Path $InstallDir "agent\universal-agent.py"
if (-not (Test-Path $AgentScript)) {
    $AgentScript = Join-Path $ActiveBase "universal-agent.py"
}
if (-not (Test-Path $AgentScript)) {
    $AgentScript = Join-Path $BaseDir "universal-agent.py"
}

function Find-PythonRuntime {
    $pyExe = $null
    $pywExe = $null
    $versionStr = $null

    # 1. Check 'where.exe python' skipping WindowsApps stubs
    try {
        $raw = where.exe python 2>$null
        if ($raw) {
            foreach ($line in ($raw -split "`r?`n")) {
                $trimmed = $line.Trim()
                if ($trimmed -and ($trimmed -notlike "*WindowsApps*") -and (Test-Path $trimmed)) {
                    $item = Get-Item $trimmed -ErrorAction SilentlyContinue
                    if ($item -and $item.Length -gt 0) {
                        $pyExe = $trimmed
                        break
                    }
                }
            }
        }
    } catch {}

    # 2. Check Python Launcher 'py -3' to resolve exact executable path
    if (-not $pyExe) {
        try {
            $resolvedFromPy = & py -3 -c "import sys; print(sys.executable)" 2>$null
            if ($resolvedFromPy -and (Test-Path $resolvedFromPy.Trim())) {
                $pyExe = $resolvedFromPy.Trim()
            }
        } catch {}
    }

    # 3. Known installation path candidates
    if (-not $pyExe) {
        $candidates = @(
            "$env:LOCALAPPDATA\Programs\Python\Python3*\python.exe",
            "$env:LOCALAPPDATA\Python\pythoncore-3*\python.exe",
            "$env:LOCALAPPDATA\Python\bin\python.exe",
            "C:\Python3*\python.exe",
            "C:\Program Files\Python3*\python.exe",
            "$BaseDir\python\python.exe",
            "$ProgramDataBase\python\python.exe"
        )
        foreach ($pat in $candidates) {
            $found = Get-Item $pat -ErrorAction SilentlyContinue | Select-Object -First 1
            if ($found -and (Test-Path $found.FullName) -and ($found.Length -gt 0)) {
                $pyExe = $found.FullName
                break
            }
        }
    }

    if ($pyExe) {
        # Discover companion pythonw.exe for 100% windowless execution
        $parentDir = Split-Path -Parent $pyExe
        $candW = Join-Path $parentDir "pythonw.exe"
        if (Test-Path $candW) {
            $pywExe = $candW
        } else {
            $pywExe = $pyExe
        }

        try {
            $verOutput = & $pyExe -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}')" 2>$null
            $versionStr = "Python " + $verOutput.Trim()
        } catch {
            $versionStr = "Python 3 (Detected)"
        }

        return @{
            Python = $pyExe
            PythonW = $pywExe
            Version = $versionStr
            Valid = $true
        }
    }

    return @{
        Python = $null
        PythonW = $null
        Version = "Not Found"
        Valid = $false
    }
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
    $cfgPathUsed = $null
    foreach ($cand in @($ConfigFile, (Join-Path $ProgramDataBase "config.json"), (Join-Path $BaseDir "config.json"))) {
        if (Test-Path $cand) {
            try {
                $parsed = Get-Content $cand -Raw | ConvertFrom-Json
                $script:LoadedConfigPath = $cand
                return $parsed
            } catch {}
        }
    }
    $defaultTok = if ($env:CYBERVPS_AGENT_TOKEN) { $env:CYBERVPS_AGENT_TOKEN } elseif ($env:CYBERVPS_TOKEN) { $env:CYBERVPS_TOKEN } elseif ($env:ENROLLMENT_TOKEN) { $env:ENROLLMENT_TOKEN } else { "" }
    $script:LoadedConfigPath = "Default (In-Memory)"
    return [PSCustomObject]@{
        server_url = if ($env:CYBERVPS_SERVER) { $env:CYBERVPS_SERVER } else { "https://cybervps-space-station.up.railway.app" }
        token = $defaultTok
        machine_id = if ($env:CYBERVPS_MACHINE_ID) { $env:CYBERVPS_MACHINE_ID } else { "cvps_$env:COMPUTERNAME" }
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

        # 1. Resolve Python Runtime
        $pyInfo = Find-PythonRuntime
        if (-not $pyInfo.Valid) {
            # Check Zero-Dependency PowerShell Ghost Bridge fallback
            $ghostBridgePs1 = Join-Path $InstallDir "agent\ghost-bridge.ps1"
            if (-not (Test-Path $ghostBridgePs1)) { $ghostBridgePs1 = Join-Path $BaseDir "ghost-bridge.ps1" }
            if (Test-Path $ghostBridgePs1) {
                Write-Host "[!] Python 3 not detected. Activating Zero-Dependency PowerShell Ghost Bridge..." -ForegroundColor Yellow
                $ghostProc = Start-Process -FilePath powershell.exe -ArgumentList "-WindowStyle Hidden -NoProfile -ExecutionPolicy Bypass -File `"$ghostBridgePs1`" -Server `"$($cfg.server_url)`" -Token `"$($cfg.token)`" -MachineId `"$($cfg.machine_id)`"" -PassThru -WindowStyle Hidden
                Set-Content -Path (Join-Path $RunDir "ghost-bridge.pid") -Value $ghostProc.Id -Force
                Write-Host "[+] CyberVPS Zero-Dependency Ghost Bridge active in background (PID: $($ghostProc.Id))." -ForegroundColor Green
                Write-Host "    Connected to: $($cfg.server_url)"
                Write-Host "    Ghost Mode: 100% Invisible Background Operation"
                return
            }
            Write-Host "[X] [PYTHON_RUNTIME_NOT_FOUND] Error: Python 3 runtime not found in PATH or standard directories." -ForegroundColor Red
            exit 1
        }

        # 2. Validate Agent Script Existence
        if (-not (Test-Path $AgentScript)) {
            Write-Host "[X] [AGENT_SCRIPT_MISSING] Error: Agent script universal-agent.py not found at $AgentScript" -ForegroundColor Red
            exit 1
        }

        # 3. Pre-flight Syntax Compilation Validation
        try {
            $compileRes = & $pyInfo.Python -m py_compile "$AgentScript" 2>&1
            if ($LASTEXITCODE -ne 0) {
                Write-Host "[X] [AGENT_SYNTAX_ERROR] Python syntax error in agent script: $compileRes" -ForegroundColor Red
                exit 1
            }
        } catch {
            Write-Host "[!] Warning: Could not pre-compile agent script. Proceeding..." -ForegroundColor Yellow
        }

        # 4. Validate Configuration & Token Credential
        if (-not $cfg.token -or $cfg.token -eq "cvps_enroll_master_token") {
            Write-Host "[!] [MISSING_ENROLLMENT_CREDENTIAL] No valid enrollment token configured." -ForegroundColor Yellow
            Write-Host "    An enrollment token from your Space Station dashboard or administrator is required." -ForegroundColor White
            Write-Host "    Set token in $ConfigFile or via environment: `$env:CYBERVPS_TOKEN = 'your_token'" -ForegroundColor Cyan
        }

        # 5. Prevent Duplicate Instances
        if (Test-Path $AgentPidFile) {
            try {
                $existingPid = [int](Get-Content $AgentPidFile -Raw).Trim()
                if (Is-PidRunning $existingPid) {
                    Write-Host "[!] [DUPLICATE_INSTANCE] CyberVPS Host Agent is already running (PID: $existingPid)." -ForegroundColor Yellow
                    Write-Host "    Target: $($cfg.server_url)"
                    Write-Host "    Run 'cybervps status' to inspect or 'cybervps stop' to terminate."
                    return
                }
            } catch {}
            Remove-Item $AgentPidFile -Force -ErrorAction SilentlyContinue
        }

        # 6. Ensure Directories Exist
        foreach ($d in @($RunDir, $LogsDir)) {
            if (-not (Test-Path $d)) { New-Item -ItemType Directory -Path $d -Force | Out-Null }
        }

        # 7. Start Agent with Race-Safe Bootstrap Logging
        Write-Host "[*] Starting CyberVPS Host Agent in background $(if ($isGhost) { '(Ghost Mode)' } else { '' })..." -ForegroundColor Cyan
        $ghostFlag = if ($isGhost) { " --ghost" } else { "" }
        $launchExe = $pyInfo.PythonW

        # Prepare correlation and clean bootstrap log
        $attemptId = "start_" + [Guid]::NewGuid().ToString("N").Substring(0, 8)
        $initLine = "[$([DateTime]::UtcNow.ToString('o'))] [$attemptId] Spawning CyberVPS agent: $launchExe `"$AgentScript`""
        Set-Content -Path $BootstrapLogFile -Value $initLine -Force

        $BootstrapErrFile = Join-Path $LogsDir "bootstrap.err.log"
        $agentArgs = "-u `"$AgentScript`" --config `"$ConfigFile`" --log-dir `"$LogsDir`"$ghostFlag"
        $proc = Start-Process -FilePath $launchExe -ArgumentList $agentArgs -PassThru -WindowStyle Hidden -RedirectStandardOutput $BootstrapLogFile -RedirectStandardError $BootstrapErrFile
        Set-Content -Path $AgentPidFile -Value $proc.Id -Force

        # Poll readiness for up to 1.5 seconds
        $startedOk = $false
        for ($i = 0; $i -lt 15; $i++) {
            Start-Sleep -Milliseconds 100
            if ($proc.HasExited) { break }
            if (Is-PidRunning $proc.Id) {
                $startedOk = $true
                break
            }
        }

        if ($startedOk -and (-not $proc.HasExited)) {
            Write-Host "[+] CyberVPS Host Agent started successfully (PID: $($proc.Id)) $(if ($isGhost) { '[Ghost Mode]' } else { '' })." -ForegroundColor Green
            Write-Host "    Connected to: $($cfg.server_url)"
            Write-Host "    View logs with: cybervps logs"
        } else {
            $exitCode = if ($proc.HasExited) { $proc.ExitCode } else { "Unknown" }
            Write-Host "[X] [PROCESS_EXITED_EARLY] Agent process exited immediately (Exit code: $exitCode)." -ForegroundColor Red
            if (Test-Path $BootstrapLogFile) {
                $recentErrors = Get-Content $BootstrapLogFile -Tail 10 -ErrorAction SilentlyContinue
                if ($recentErrors) {
                    Write-Host "    Startup Output:" -ForegroundColor Yellow
                    foreach ($line in $recentErrors) {
                        Write-Host "      $line" -ForegroundColor Gray
                    }
                }
            }
            Write-Host "    Inspect full application logs at: $AgentLogFile" -ForegroundColor Cyan
            exit 1
        }
    }

    "stop" {
        Assert-IsAdmin "stop"
        $stoppedAny = $false

        # Stop Scheduled Task if active
        try {
            & schtasks.exe /End /TN "CyberVPSAgent" 2>$null | Out-Null
        } catch {}

        # Kill by PID file
        $pidsToKill = @()
        foreach ($pf in @($AgentPidFile, (Join-Path $ProgramDataBase "run\agent.pid"), (Join-Path $BaseDir "run\agent.pid"))) {
            if (Test-Path $pf) {
                try {
                    $pidVal = [int](Get-Content $pf -Raw).Trim()
                    if ($pidVal -gt 0) { $pidsToKill += $pidVal }
                } catch {}
                Remove-Item $pf -Force -ErrorAction SilentlyContinue
            }
        }

        foreach ($p in $pidsToKill) {
            if (Is-PidRunning $p) {
                Write-Host "[*] Stopping CyberVPS Agent (PID: $p)..." -ForegroundColor Cyan
                Stop-Process -Id $p -Force -ErrorAction SilentlyContinue
                $stoppedAny = $true
            }
        }

        # Clean up any stray universal-agent.py processes to avoid mutex collisions
        try {
            Get-CimInstance Win32_Process -Filter "Name LIKE 'python%'" -ErrorAction SilentlyContinue | Where-Object {
                $_.CommandLine -like "*universal-agent.py*"
            } | ForEach-Object {
                Write-Host "[*] Stopping stray agent process (PID: $($_.ProcessId))..." -ForegroundColor Cyan
                try { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue } catch {}
                $stoppedAny = $true
            }
        } catch {}

        if ($stoppedAny) {
            Write-Host "[+] CyberVPS Agent stopped cleanly." -ForegroundColor Green
        } else {
            Write-Host "[*] No active CyberVPS Agent process was running." -ForegroundColor Yellow
        }
    }

    "restart" {
        Assert-IsAdmin "restart"
        & $PSCommandPath stop
        Start-Sleep -Milliseconds 800
        & $PSCommandPath start
    }

    "status" {
        $cfg = Load-Config
        $isRunning = $false
        $activePid = 0
        if (Test-Path $AgentPidFile) {
            try {
                $activePid = [int](Get-Content $AgentPidFile -Raw).Trim()
                $isRunning = (Is-PidRunning $activePid)
            } catch {}
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

        # Test backend reachability and enrollment state
        try {
            $healthRes = Invoke-RestMethod -Uri "$($cfg.server_url.TrimEnd('/'))/health" -TimeoutSec 3 -ErrorAction Stop
            Write-Host "  Server Health   : ONLINE ($($healthRes.status))" -ForegroundColor Green
        } catch {
            Write-Host "  Server Health   : UNREACHABLE ($($_.Exception.Message))" -ForegroundColor Yellow
        }

        # Check if machine ID is registered on the control plane
        try {
            $machinesRes = Invoke-RestMethod -Uri "$($cfg.server_url.TrimEnd('/'))/api/v1/system/info" -TimeoutSec 3 -ErrorAction Stop
            $cpStatus = if ($machinesRes.status) { $machinesRes.status } else { "OK" }
            Write-Host "  Control Plane   : Connected ($cpStatus)" -ForegroundColor Green
        } catch {}

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
        Write-Host "   CYBERVPS SPACE STATION - WINDOWS SYSTEM DOCTOR" -ForegroundColor Cyan
        Write-Host "================================================================" -ForegroundColor Cyan

        # 1. Python Runtime
        $pyInfo = Find-PythonRuntime
        if ($pyInfo.Valid) {
            Write-Host "  [PASS] Python Runtime     : $($pyInfo.Version) ($($pyInfo.Python))" -ForegroundColor Green
            if ($pyInfo.PythonW -and (Test-Path $pyInfo.PythonW)) {
                Write-Host "  [PASS] Windowless Runtime : $($pyInfo.PythonW) (Zero Popups)" -ForegroundColor Green
            } else {
                Write-Host "  [WARN] Windowless Runtime : pythonw.exe not found alongside python.exe" -ForegroundColor Yellow
            }
        } else {
            Write-Host "  [FAIL] Python Runtime     : NOT FOUND in PATH or standard installation directories" -ForegroundColor Red
        }

        # 2. Agent Script & Compilation
        if (Test-Path $AgentScript) {
            $scriptItem = Get-Item $AgentScript
            $sizeKb = [Math]::Round($scriptItem.Length / 1024)
            if ($pyInfo.Valid) {
                try {
                    $comp = & $pyInfo.Python -m py_compile "$AgentScript" 2>&1
                    if ($LASTEXITCODE -eq 0) {
                        Write-Host "  [PASS] Agent Script       : $AgentScript (${sizeKb}KB, Valid Bytecode)" -ForegroundColor Green
                    } else {
                        Write-Host "  [FAIL] Agent Script       : Syntax error during py_compile ($comp)" -ForegroundColor Red
                    }
                } catch {
                    Write-Host "  [WARN] Agent Script       : $AgentScript (${sizeKb}KB, Syntax check skipped)" -ForegroundColor Yellow
                }
            } else {
                Write-Host "  [PASS] Agent Script       : $AgentScript (${sizeKb}KB)" -ForegroundColor Green
            }
        } else {
            Write-Host "  [FAIL] Agent Script       : MISSING (Expected at $AgentScript)" -ForegroundColor Red
        }

        # 3. Active Configuration
        $cfg = Load-Config
        Write-Host "  [INFO] Config Source      : $script:LoadedConfigPath" -ForegroundColor Gray
        Write-Host "  [INFO] Installation Scope : $InstallScope" -ForegroundColor Gray
        if ($cfg.server_url) {
            Write-Host "  [PASS] Server Target      : $($cfg.server_url)" -ForegroundColor Green
        } else {
            Write-Host "  [FAIL] Server Target      : Missing server_url" -ForegroundColor Red
        }

        if ($cfg.machine_id) {
            Write-Host "  [PASS] Machine Identity   : $($cfg.machine_id)" -ForegroundColor Green
        } else {
            Write-Host "  [WARN] Machine Identity   : Missing machine_id" -ForegroundColor Yellow
        }

        # Redacted Token Security Check
        $tok = $cfg.token
        if (-not $tok) {
            Write-Host "  [FAIL] Enrollment Token   : MISSING (Agent will not authenticate)" -ForegroundColor Red
        } elseif ($tok -eq "cvps_enroll_master_token" -or $tok -eq "dummy_token") {
            Write-Host "  [FAIL] Enrollment Token   : OBSOLETE / PLACEHOLDER (Rejected by backend)" -ForegroundColor Red
        } else {
            $tokLen = $tok.Length
            $redacted = if ($tokLen -gt 10) { $tok.Substring(0, 6) + "..." + $tok.Substring($tokLen - 4) } else { "********" }
            Write-Host "  [PASS] Enrollment Token   : Configured ($redacted, $tokLen chars)" -ForegroundColor Green
        }

        # 4. Agent Process & Mutex State
        $isRunning = $false
        $activePid = 0
        if (Test-Path $AgentPidFile) {
            try {
                $activePid = [int](Get-Content $AgentPidFile -Raw).Trim()
                $isRunning = (Is-PidRunning $activePid)
            } catch {}
        }
        if ($isRunning) {
            $procName = (Get-Process -Id $activePid -ErrorAction SilentlyContinue).ProcessName
            Write-Host "  [PASS] Agent Process      : Running (PID $activePid, $procName)" -ForegroundColor Green
        } else {
            Write-Host "  [INFO] Agent Process      : Inactive (Offline)" -ForegroundColor Gray
        }

        # 5. Last Startup Bootstrap Status
        if (Test-Path $BootstrapLogFile) {
            $bootLines = Get-Content $BootstrapLogFile -Tail 2 -ErrorAction SilentlyContinue
            if ($bootLines) {
                Write-Host "  [INFO] Last Startup Log   : $($bootLines[-1])" -ForegroundColor Gray
            }
        }

        # 6. Backend Network Connectivity & HA Mesh
        $isNetMode = ($ArgsList -and ($ArgsList -contains "--network" -or $ArgsList -contains "-n" -or $ArgsList -contains "--net"))
        try {
            $t0 = [DateTime]::UtcNow
            $res = Invoke-RestMethod -Uri "$($cfg.server_url.TrimEnd('/'))/health" -TimeoutSec 5 -ErrorAction Stop
            $elapsed = [Math]::Round(([DateTime]::UtcNow - $t0).TotalMilliseconds)
            Write-Host "  [PASS] Backend Network    : Reached in ${elapsed}ms ($($cfg.server_url))" -ForegroundColor Green
        } catch {
            Write-Host "  [FAIL] Backend Network    : Failed to reach $($cfg.server_url) ($($_.Exception.Message))" -ForegroundColor Red
        }

        # Multi-Backend HA Mesh
        $meshBackends = if ($cfg.server_urls) { $cfg.server_urls } else { @($cfg.server_url, "https://cybervps-space-station.up.railway.app") }
        $meshBackends = @($meshBackends | Where-Object { $_ -notlike "*cybervps-render-control*" })
        Write-Host "  [INFO] HA Backend Mesh    : $($meshBackends.Count) backends configured" -ForegroundColor Cyan
        foreach ($b in $meshBackends) {
            try {
                $tB = [DateTime]::UtcNow
                $bRes = Invoke-RestMethod -Uri "$($b.TrimEnd('/'))/health" -TimeoutSec 3 -ErrorAction Stop
                $bLat = [Math]::Round(([DateTime]::UtcNow - $tB).TotalMilliseconds)
                Write-Host "    - $b : ONLINE (${bLat}ms)" -ForegroundColor Green
            } catch {
                Write-Host "    - $b : UNREACHABLE ($($_.Exception.Message))" -ForegroundColor Yellow
            }
        }

        # 7. Autostart Scheduled Task & Registry
        try {
            $taskQ = & schtasks.exe /Query /TN "CyberVPSAgent" /FO CSV /NH 2>$null
            if ($taskQ -and $taskQ -like "*CyberVPSAgent*") {
                Write-Host "  [PASS] Scheduled Task     : Installed (CyberVPSAgent) ✅" -ForegroundColor Green
            } else {
                Write-Host "  [INFO] Scheduled Task     : Not installed or registered under user" -ForegroundColor Gray
            }
        } catch {}

        try {
            $regVal = (Get-ItemProperty -Path "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run" -Name "CyberVPSAgent" -ErrorAction SilentlyContinue).CyberVPSAgent
            if ($regVal) {
                $hasPythonw = $regVal -like "*pythonw.exe*"
                if ($hasPythonw) {
                    Write-Host "  [PASS] Autostart (RunKey) : Configured with pythonw.exe (Zero Popups)" -ForegroundColor Green
                } else {
                    Write-Host "  [WARN] Autostart (RunKey) : Configured with console python.exe (May flash window)" -ForegroundColor Yellow
                }
            } else {
                Write-Host "  [INFO] Autostart (RunKey) : Not registered in HKCU Run" -ForegroundColor Gray
            }
        } catch {}

        if ($isNetMode) {
            Write-Host "`n  [Local Network Interfaces]" -ForegroundColor Cyan
            try {
                $ips = [System.Net.Dns]::GetHostAddresses([System.Net.Dns]::GetHostName()) | ForEach-Object { $_.IPAddressToString }
                Write-Host "  * Host Name       : $env:COMPUTERNAME" -ForegroundColor White
                Write-Host "  * IP Addresses    : $($ips -join ', ')" -ForegroundColor White
            } catch {}
        } else {
            Write-Host "`n  👉 Run 'cybervps doctor --network' for deep interface and socket checks." -ForegroundColor Gray
        }

        Write-Host "================================================================" -ForegroundColor Cyan
    }

    "version" {
        Write-Host "CyberVPS Space Station v2.1.1 (win32-x64, powershell 5.1+)"
    }

    { $_ -in "bridge", "tunnel", "sftp", "ssh" } {
        $nodeCmd = Get-Command node -ErrorAction SilentlyContinue
        $cliJs = Join-Path $InstallDir "bin\cybervps"
        if (-not (Test-Path $cliJs)) { $cliJs = Join-Path $BaseDir "space-station\bin\cybervps" }
        if (-not (Test-Path $cliJs)) { $cliJs = Join-Path (Split-Path -Parent $PSScriptRoot) "bin\cybervps" }
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
