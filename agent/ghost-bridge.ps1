# ==============================================================================
# CyberVPS SPACE STATION - Windows Native Zero-Dependency Ghost Bridge
# Millisecond-first connection daemon with 100% invisible background operation.
# Runs on pure built-in Windows PowerShell 5.1+ (zero Python/Git/Node requirement).
# ==============================================================================

[CmdletBinding()]
param (
    [string]$Server = $(if ($env:CYBERVPS_SERVER) { $env:CYBERVPS_SERVER } else { "https://cybervps-space-station.up.railway.app" }),
    [string]$Token = $(if ($env:CYBERVPS_TOKEN) { $env:CYBERVPS_TOKEN } elseif ($env:ENROLLMENT_TOKEN) { $env:ENROLLMENT_TOKEN } else { "" }),
    [string]$MachineId = $(if ($env:CYBERVPS_MACHINE_ID) { $env:CYBERVPS_MACHINE_ID } else { "" }),
    [switch]$Ghost = $true
)

# 1. Enforce TLS 1.2
try {
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 -bor [Net.SecurityProtocolType]::Tls11 -bor [Net.SecurityProtocolType]::Tls
} catch {}

# 2. Strict Safe Paths: ~/.cybervps and %LOCALAPPDATA%\CyberVPS (NEVER Desktop/Downloads)
$HomeDir = [Environment]::GetFolderPath("UserProfile")
$PrimaryDir = Join-Path $HomeDir ".cybervps"
$ShadowDir = Join-Path $env:LOCALAPPDATA "CyberVPS"

foreach ($dir in @($PrimaryDir, $ShadowDir)) {
    if (-not (Test-Path $dir)) {
        New-Item -ItemType Directory -Path $dir -Force | Out-Null
    }
}

$LogFile = Join-Path $PrimaryDir "ghost-bridge.log"
$PidFile = Join-Path $PrimaryDir "ghost-bridge.pid"

function Log-Ghost([string]$msg) {
    $ts = [DateTime]::UtcNow.ToString("yyyy-MM-ddTHH:mm:ssZ")
    $line = "[$ts] [GHOST-BRIDGE] $msg"
    try {
        [System.IO.File]::AppendAllText($LogFile, $line + "`r`n", [System.Text.Encoding]::UTF8)
    } catch {}
}

# 3. Persistent Machine ID
$MidFile = Join-Path $PrimaryDir "machine_id"
if (-not $MachineId) {
    if (Test-Path $MidFile) {
        try {
            $MachineId = (Get-Content $MidFile -Raw).Trim()
        } catch {}
    }
}
if (-not $MachineId) {
    $uuidRaw = ""
    try {
        $uuidRaw = (Get-CimInstance Win32_ComputerSystemProduct -ErrorAction SilentlyContinue).UUID
    } catch {}
    if (-not $uuidRaw) {
        $uuidRaw = [Guid]::NewGuid().ToString("N").Substring(0, 8)
    }
    $cleanHost = ($env:COMPUTERNAME -replace '[^a-zA-Z0-9]', '').ToLower()
    $shortUuid = ($uuidRaw -replace '[^a-zA-Z0-9]', '').Substring(0, [Math]::Min(8, $uuidRaw.Length)).ToLower()
    $MachineId = "cvps_${cleanHost}_${shortUuid}"
    Set-Content -Path $MidFile -Value $MachineId -Force
    Set-Content -Path (Join-Path $ShadowDir "machine_id") -Value $MachineId -Force
}

# Save PID
Set-Content -Path $PidFile -Value $PID -Force

Log-Ghost "Active on machine [$MachineId] connecting to [$Server]"

# 4. Instant Connection: Auth Handshake (T+0 ms)
function Send-Auth {
    $osInfo = ""
    try {
        $osInfo = (Get-CimInstance Win32_OperatingSystem -ErrorAction SilentlyContinue).Caption
    } catch {
        $osInfo = "Microsoft Windows"
    }

    $authObj = @{
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
                bootstrap = "millisecond_zero_dependency"
                runtime = "PowerShell_5_Core"
            }
        }
    }

    $json = $authObj | ConvertTo-Json -Depth 4 -Compress
    try {
        $resp = Invoke-RestMethod -Uri "$($Server.TrimEnd('/'))/api/v1/relay/event" -Method Post -Body $json -ContentType "application/json" -TimeoutSec 5 -ErrorAction Stop
        Log-Ghost "Auth registered successfully with control plane. Result: $($resp | ConvertTo-Json -Compress)"
        return $true
    } catch {
        Log-Ghost "Auth attempt failed: $_"
        return $false
    }
}

# Send immediate Auth
$authed = Send-Auth

# 5. Background Dependency Provisioner (Spawns silently without blocking)
$ProvisionerScript = {
    param($PrimaryDir, $ShadowDir, $Server, $Token, $MachineId)
    $Log = Join-Path $PrimaryDir "provisioner.log"
    function PLog($m) {
        $t = [DateTime]::UtcNow.ToString("yyyy-MM-ddTHH:mm:ssZ")
        [System.IO.File]::AppendAllText($Log, "[$t] $m`r`n")
    }

    PLog "Background provisioner started."

    # Check if universal-agent.py exists
    $agentPy = Join-Path $PrimaryDir "universal-agent.py"
    if (-not (Test-Path $agentPy)) {
        PLog "Fetching universal-agent.py from Control Plane / GitHub..."
        try {
            $web = New-Object System.Net.WebClient
            $web.DownloadFile("$($Server.TrimEnd('/'))/agent/universal-agent.py", $agentPy)
            PLog "Downloaded universal-agent.py from server."
        } catch {
            try {
                $gh = "https://raw.githubusercontent.com/cyberdrivepro/cybervps-space-station/main/agent/universal-agent.py"
                $web.DownloadFile($gh, $agentPy)
                PLog "Downloaded universal-agent.py from GitHub."
            } catch {
                PLog "Error downloading agent: $_"
            }
        }
    }

    # Mirror to shadow
    if (Test-Path $agentPy) {
        try {
            Copy-Item $agentPy (Join-Path $ShadowDir "universal-agent.py") -Force
        } catch {}
    }

    # Detect or provision portable Python
    $py = $null
    try {
        $found = (where.exe python 2>$null) | Where-Object { $_ -notlike "*WindowsApps*" } | Select-Object -First 1
        if ($found) { $py = $found }
    } catch {}

    if (-not $py) {
        $pyEmbedDir = Join-Path $PrimaryDir "python"
        $pyEmbedExe = Join-Path $pyEmbedDir "python.exe"
        if (Test-Path $pyEmbedExe) {
            $py = $pyEmbedExe
        } else {
            PLog "Provisioning portable Python 3..."
            try {
                $zip = Join-Path $env:TEMP "cvps-py-embed.zip"
                $url = "https://www.python.org/ftp/python/3.12.7/python-3.12.7-embed-amd64.zip"
                $web = New-Object System.Net.WebClient
                $web.DownloadFile($url, $zip)
                New-Item -ItemType Directory -Path $pyEmbedDir -Force | Out-Null
                Expand-Archive -Path $zip -DestinationPath $pyEmbedDir -Force
                Remove-Item $zip -Force -ErrorAction SilentlyContinue
                $py = $pyEmbedExe
                PLog "Portable Python 3 provisioned successfully."
            } catch {
                PLog "Failed provisioning portable Python: $_"
            }
        }
    }

    if ($py -and (Test-Path $agentPy)) {
        PLog "Upgrading ghost bridge to full universal-agent.py..."
        try {
            # Start full universal-agent in Ghost Mode
            $logArg = Join-Path $PrimaryDir "agent.log"
            $pyw = Join-Path (Split-Path -Parent $py) "pythonw.exe"
            $launchPy = if (Test-Path $pyw) { $pyw } else { $py }
            $psi.FileName = $launchPy
            $psi.Arguments = "`"$agentPy`" `"$Server`" `"$Token`" `"$MachineId`" --ghost --log-file `"$logArg`""
            $psi.WindowStyle = [System.Diagnostics.ProcessWindowStyle]::Hidden
            $psi.CreateNoWindow = $true
            $psi.UseShellExecute = $false
            $proc = [System.Diagnostics.Process]::Start($psi)
            PLog "Universal Agent spawned with PID: $($proc.Id)"

            # Ensure Autostart Run Persistence
            try {
                $regKey = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey("Software\Microsoft\Windows\CurrentVersion\Run", $true)
                $cmdVal = "`"$launchPy`" `"$agentPy`" `"$Server`" `"$Token`" `"$MachineId`" --ghost --log-file `"$logArg`""
                $regKey.SetValue("CyberVPSAgent", $cmdVal)
                $regKey.Close()
                PLog "Registry Autostart Run key confirmed."
            } catch {}
        } catch {
            PLog "Failed to spawn universal agent: $_"
        }
    }
}

Start-Job -ScriptBlock $ProvisionerScript -ArgumentList @($PrimaryDir, $ShadowDir, $Server, $Token, $MachineId) | Out-Null

# 6. Native Ghost Event & Command Polling Loop (Milliseconds 24/7)
$loopCounter = 0
while ($true) {
    try {
        # Check if full universal-agent.py took over
        $agentLog = Join-Path $PrimaryDir "agent.log"
        $pyAgentPid = Join-Path $PrimaryDir "agent.pid"
        if (Test-Path $pyAgentPid) {
            try {
                $pidVal = [int](Get-Content $pyAgentPid -Raw).Trim()
                $chk = Get-Process -Id $pidVal -ErrorAction SilentlyContinue
                if ($chk) {
                    Log-Ghost "Universal Python Agent (PID: $pidVal) is now active. Ghost bridge completed handoff."
                    break
                }
            } catch {}
        }

        # Poll incoming commands from Space Station
        $pollUrl = "$($Server.TrimEnd('/'))/api/v1/relay/poll?machine_id=$MachineId&token=$Token"
        $cmds = Invoke-RestMethod -Uri $pollUrl -Method Get -TimeoutSec 4 -ErrorAction SilentlyContinue
        if ($cmds -and $cmds.commands) {
            foreach ($cmd in $cmds.commands) {
                Log-Ghost "Command received: $($cmd.type)"
                if ($cmd.type -eq "RebootHost") {
                    Log-Ghost "Executing graceful remote machine reboot..."
                    shutdown.exe /r /t 2 /f /c "CyberVPS Remote Reboot"
                }
            }
        }

        # Heartbeat telemetry every 6 seconds (every 3rd loop)
        $loopCounter++
        if ($loopCounter % 3 -eq 0) {
            $totMb = 8192
            $usedMb = 512
            $cpuPct = 2.0
            try {
                $osInfo = Get-CimInstance Win32_OperatingSystem -ErrorAction SilentlyContinue
                if ($osInfo) {
                    $totMb = [Math]::Round($osInfo.TotalVisibleMemorySize / 1024)
                    $freeMb = [Math]::Round($osInfo.FreePhysicalMemory / 1024)
                    $usedMb = [Math]::Max(1, $totMb - $freeMb)
                }
                $procInfo = Get-CimInstance Win32_Processor -ErrorAction SilentlyContinue | Measure-Object -Property LoadPercentage -Average
                if ($procInfo -and $procInfo.Average -ne $null) {
                    $cpuPct = [double]$procInfo.Average
                }
            } catch {}

            $telemetry = @{
                type = "Heartbeat"
                payload = @{
                    machine_id = $MachineId
                    token = $Token
                    cpu_percent = $cpuPct
                    memory_used_mb = $usedMb
                    memory_total_mb = $totMb
                    ghost_mode = $true
                    timestamp = [DateTime]::UtcNow.ToString("yyyy-MM-ddTHH:mm:ssZ")
                }
            } | ConvertTo-Json -Compress

            Invoke-RestMethod -Uri "$($Server.TrimEnd('/'))/api/v1/relay/event" -Method Post -Body $telemetry -ContentType "application/json" -TimeoutSec 3 -ErrorAction SilentlyContinue
        }
    } catch {
        # Re-auth on errors
        Start-Sleep -Seconds 2
        Send-Auth | Out-Null
    }
    Start-Sleep -Seconds 2
}
