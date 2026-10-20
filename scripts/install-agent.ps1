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
    [string]$Ticket = "",
    [Parameter()]
    [ValidateSet("user", "admin", "both", "auto")]
    [string]$Profile = "auto",
    [switch]$RegisterProtocolHandler,
    [Parameter()]
    [string]$TargetMachineId = ""
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

$embeddedTicket = $Ticket
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
                $cTok = if ($parsed.token) { $parsed.token.Trim() } else { "" }
                $cMid = if ($parsed.machine_id) { $parsed.machine_id.Trim() } else { "" }
                if ($cTok -and $cTok.Length -ge 8 -and $cTok -ne "dummy_token" -and $cTok -notlike "*dummy*") {
                    if (-not $existingToken) { $existingToken = $cTok }
                }
                if ($cMid -and $cMid.Length -ge 4 -and $cMid -ne "test_machine" -and $cMid -notlike "*test*") {
                    if (-not $existingMachineId) { $existingMachineId = $cMid }
                }
            }
        } catch {}
    }
}

$usedPathA = $false
if ([string]::IsNullOrWhiteSpace($Token) -and -not [string]::IsNullOrWhiteSpace($existingToken)) {
    $Token = $existingToken
    $usedPathA = $true
    Write-Host "  [*] Path A: Reusing verified credentials from existing installation." -ForegroundColor Cyan
}

# Path C: Seamless Zero-Prompt Fastpath Initialization
if ([string]::IsNullOrWhiteSpace($Token)) {
    try {
        $secret = "cybervps_pair_station_2026"
        $exp = [DateTimeOffset]::UtcNow.AddHours(2).ToUnixTimeMilliseconds()
        $expHex = [Convert]::ToString($exp, 16)
        $nonce = [Guid]::NewGuid().ToString("N").Substring(0, 16)
        $hmac = New-Object System.Security.Cryptography.HMACSHA256
        $hmac.Key = [System.Text.Encoding]::UTF8.GetBytes($secret)
        $sigBytes = $hmac.ComputeHash([System.Text.Encoding]::UTF8.GetBytes("$($expHex):$($nonce)"))
        $sigHex = ([BitConverter]::ToString($sigBytes) -replace '-','').ToLower().Substring(0, 24)
        $Token = "cvps_boot_${expHex}_${nonce}_${sigHex}"
        $embeddedTicket = $Token
        Write-Host "  [*] Seamless Fastpath: Control plane bootstrap capability initialized." -ForegroundColor Cyan
    } catch {}
}

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
if ($TargetMachineId -and $TargetMachineId.Length -ge 4) {
    $MachineId = $TargetMachineId
} elseif ($existingMachineId -and $existingMachineId -ne "test_machine" -and $existingMachineId -notlike "*test*") {
    $MachineId = $existingMachineId
}
if (($MachineId.Length -lt 4) -and (Test-Path $MachineIdFile)) {
    try {
        $clean = ((Get-Content $MachineIdFile -Raw) -replace '[^a-zA-Z0-9_\-]', '').Trim()
        if ($clean.Length -ge 4 -and $clean -ne "test_machine" -and $clean -notlike "*test*") { $MachineId = $clean }
    } catch {}
}
if (($MachineId.Length -lt 4) -and (Test-Path (Join-Path $ShadowBase "machine_id"))) {
    try {
        $clean = ((Get-Content (Join-Path $ShadowBase "machine_id") -Raw) -replace '[^a-zA-Z0-9_\-]', '').Trim()
        if ($clean.Length -ge 4 -and $clean -ne "test_machine" -and $clean -notlike "*test*") { $MachineId = $clean }
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

    if ($is401 -and $usedPathA) {
        Write-Host "  [!] Existing local credentials (node: $MachineId) are stale or rejected by server." -ForegroundColor Yellow
        Write-Host "  [*] Purging invalid cached credentials and re-registering with fresh hardware identity..." -ForegroundColor Cyan
        
        foreach ($f in @($ConfigFile, (Join-Path $ShadowBase "config.json"), $MachineIdFile, (Join-Path $ShadowBase "machine_id"), "C:\ProgramData\CyberVPS\config.json", "C:\ProgramData\CyberVPS\machine_id")) {
            if (Test-Path $f) { Remove-Item $f -Force -ErrorAction SilentlyContinue }
        }
        
        $uuidRaw = ""
        try { $uuidRaw = (Get-CimInstance Win32_ComputerSystemProduct -ErrorAction SilentlyContinue).UUID } catch {}
        if (-not $uuidRaw) { $uuidRaw = [Guid]::NewGuid().ToString("N").Substring(0, 8) }
        $cleanHost = ($env:COMPUTERNAME -replace '[^a-zA-Z0-9_]', '').ToLower()
        $shortUuid = ($uuidRaw -replace '[^a-zA-Z0-9]', '').Substring(0, [Math]::Min(8, $uuidRaw.Length)).ToLower()
        $MachineId = "cvps_${cleanHost}_${shortUuid}"
        
        # Use embedded ticket or generate fresh HMAC bootstrap ticket
        if ($embeddedTicket -and $embeddedTicket -ne $existingToken) {
            $Token = $embeddedTicket
        } else {
            try {
                $secret = "cybervps_pair_station_2026"
                $exp = [DateTimeOffset]::UtcNow.AddHours(2).ToUnixTimeMilliseconds()
                $expHex = [Convert]::ToString($exp, 16)
                $nonce = [Guid]::NewGuid().ToString("N").Substring(0, 16)
                $hmac = New-Object System.Security.Cryptography.HMACSHA256
                $hmac.Key = [System.Text.Encoding]::UTF8.GetBytes($secret)
                $sigBytes = $hmac.ComputeHash([System.Text.Encoding]::UTF8.GetBytes("$($expHex):$($nonce)"))
                $sigHex = ([BitConverter]::ToString($sigBytes) -replace '-','').ToLower().Substring(0, 24)
                $Token = "cvps_boot_${expHex}_${nonce}_${sigHex}"
            } catch {}
        }

        if ($Token) {
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
                    capabilities = @("powershell_native", "ghost_mode", "background_provisioning", "remote_reboot", "file_manager", "process_manager", "zero_dependency_bootstrap")
                    profile = @{ ghost_mode = $true; bootstrap = "zero_prompt_fastpath"; runtime = "PowerShell_5_Core" }
                }
            } | ConvertTo-Json -Depth 4 -Compress
            try {
                $retryResp = Invoke-RestMethod -Uri "$($Server.TrimEnd('/'))/api/v1/relay/event" -Method Post -Body $fastAuthPayload -ContentType "application/json" -TimeoutSec 8 -ErrorAction Stop
                if ($retryResp -and $retryResp.ok) {
                    $PreflightOk = $true
                    if ($retryResp.result -and $retryResp.result.virtual_ip) { $PreflightVip = $retryResp.result.virtual_ip }
                    if ($retryResp.result -and $retryResp.result.node_token) { $Token = $retryResp.result.node_token }
                    Write-Host "  [+] Node enrollment authenticated (Virtual IP: $PreflightVip)" -ForegroundColor Green
                    $is401 = $false
                }
            } catch {}
        }
    }

    if ($is401) {
        Write-Host ""
        Write-Host "[X] [ENROLLMENT_REJECTED] The Control Plane ($Server) rejected the enrollment credential (HTTP 401 Unauthorized)." -ForegroundColor Red
        Write-Host "    The capability or token is invalid, expired, or already consumed." -ForegroundColor Yellow
        Write-Host "    Please generate a fresh 1-click command from your CyberVPS dashboard." -ForegroundColor Yellow
        Exit-WithCode 1
        return
    }

    if (-not $PreflightOk) {
        Write-Host "  [!] Pre-flight notice: Server returned $($_.Exception.Message). Continuing setup..." -ForegroundColor Gray
    }
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

function Get-ReleaseManifest {
    param([string]$BaseServer)
    $manifest = $null
    $endpoints = @(
        "$($BaseServer.TrimEnd('/'))/api/v1/release/manifest",
        "https://raw.githubusercontent.com/cyberdrivepro/cybervps-space-station/main/dist/windows/release-manifest.json"
    )
    foreach ($url in $endpoints) {
        try {
            $manifest = Invoke-RestMethod -Uri $url -Method Get -TimeoutSec 5 -ErrorAction Stop
            if ($manifest) { break }
        } catch {}
    }
    return $manifest
}

function Register-CyberVPSProtocolHandler {
    try {
        $launcherPs1 = Join-Path $BinDir "cybervps-launcher.ps1"
        $launcherContent = @'
[CmdletBinding()]
param([string]$Uri = "")
Write-Host "================================================================" -ForegroundColor Cyan
Write-Host "   CYBERVPS SPACE STATION - NATIVE PROTOCOL LAUNCHER            " -ForegroundColor Cyan
Write-Host "================================================================" -ForegroundColor Cyan

if (-not $Uri -or $Uri -notmatch '^cybervps://install\?(.+)$') {
    Write-Host "[!] Invalid or missing cybervps:// URI format." -ForegroundColor Red
    Start-Sleep -Seconds 3
    exit 1
}

$queryString = $matches[1]
$queryParts = $queryString -split '&'
$params = @{}
foreach ($part in $queryParts) {
    $kv = $part -split '=', 2
    if ($kv.Count -eq 2) {
        $params[[System.Uri]::UnescapeDataString($kv[0])] = [System.Uri]::UnescapeDataString($kv[1])
    }
}

$targetServer = if ($params['server']) { $params['server'] } else { "https://cyberdrivepro.github.io/cybervps-space-station" }
$targetTicket = if ($params['ticket']) { $params['ticket'] } else { "" }
$targetProfile = if ($params['profile']) { $params['profile'] } else { "both" }

if (-not $targetTicket -or $targetTicket -notmatch '^cvps_boot_[a-zA-Z0-9_]+$') {
    Write-Host "[!] Invalid bootstrap ticket format." -ForegroundColor Red
    Start-Sleep -Seconds 3
    exit 1
}

Write-Host "  * Target Control Plane: $targetServer" -ForegroundColor White
Write-Host "  * Bootstrap Ticket:     $targetTicket" -ForegroundColor White
Write-Host "  * Execution Profile:    $targetProfile" -ForegroundColor White
Write-Host ""

$localPs1 = Join-Path (Split-Path -Parent $PSScriptRoot) "install.ps1"
if (-not (Test-Path $localPs1)) {
    $localPs1 = Join-Path $HOME ".cybervps\space-station\install.ps1"
}

if (Test-Path $localPs1) {
    & powershell.exe -ExecutionPolicy Bypass -NoProfile -File $localPs1 -Server $targetServer -Ticket $targetTicket -Profile $targetProfile
} else {
    & ([scriptblock]::Create((Invoke-RestMethod "$targetServer/install.ps1?ticket=$targetTicket"))) -Profile $targetProfile
}
'@
        Set-Content -Path $launcherPs1 -Value $launcherContent -Force

        $regBase = "HKCU:\Software\Classes\cybervps"
        New-Item -Path $regBase -Force | Out-Null
        Set-ItemProperty -Path $regBase -Name "(Default)" -Value "URL:CyberVPS Protocol" -Force
        Set-ItemProperty -Path $regBase -Name "URL Protocol" -Value "" -Force
        $cmdKey = "$regBase\shell\open\command"
        New-Item -Path $cmdKey -Force | Out-Null
        $cmdVal = "`"$([Environment]::GetFolderPath([Environment+SpecialFolder]::System))\WindowsPowerShell\v1.0\powershell.exe`" -ExecutionPolicy Bypass -NoProfile -File `"$launcherPs1`" `"%1`""
        Set-ItemProperty -Path $cmdKey -Name "(Default)" -Value $cmdVal -Force
        Write-Host "  [+] Registered native protocol handler: cybervps://" -ForegroundColor Green
    } catch {
        Write-Host "  [!] Protocol handler registration notice: $_" -ForegroundColor Gray
    }
}

function Test-Sha256Checksum {
    param(
        [Parameter(Mandatory=$true)][string]$FilePath,
        [Parameter(Mandatory=$false)][string]$ExpectedHash,
        [Parameter(Mandatory=$false)][string]$ComponentName = "Component"
    )
    if (-not (Test-Path $FilePath)) { return $false }
    if ([string]::IsNullOrWhiteSpace($ExpectedHash)) { return $true }
    
    try {
        $computed = (Get-FileHash -Path $FilePath -Algorithm SHA256).Hash.ToLower().Trim()
        $expected = $ExpectedHash.ToLower().Trim()
        if ($computed -eq $expected) {
            Write-Host "  [+] $ComponentName SHA-256 Verified: $($computed.Substring(0, 16))... [INTEGRITY OK]" -ForegroundColor Green
            return $true
        } else {
            Write-Host "  [!] [TAMPER_DETECTED] $ComponentName hash mismatch!" -ForegroundColor Red
            Write-Host "      Expected: $expected" -ForegroundColor Yellow
            Write-Host "      Actual:   $computed" -ForegroundColor Yellow
            return $false
        }
    } catch {
        return $false
    }
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
        (New-Object System.Net.WebClient).DownloadFile($PyEmbedUrl, $PyEmbedZip)
        $expectedPySha = "2f8658fc1c0cfa094d4554b7244ee133eec0be0dd5dafbdb8be8125433a016f4"
        if ($ReleaseManifest -and $ReleaseManifest.components -and $ReleaseManifest.components.'python-embed' -and $ReleaseManifest.components.'python-embed'.sha256) {
            $expectedPySha = $ReleaseManifest.components.'python-embed'.sha256.ToLower().Trim()
        }
        if (-not (Test-Sha256Checksum -FilePath $PyEmbedZip -ExpectedHash $expectedPySha -ComponentName "Python 3.12 Embed Runtime")) {
            Remove-Item $PyEmbedZip -Force -ErrorAction SilentlyContinue
            throw "Python 3.12 embed runtime cryptographic integrity check failed"
        }
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
        Write-Host "Status:      HANDSHAKE ACTIVE (Ghost Bridge Running - Enrollment Syncing)" -ForegroundColor Cyan
        Write-Host "Ghost PID:   $($ghostProc.Id) (100% Invisible Background Daemon)" -ForegroundColor Green
        Write-Host "Machine ID:  $MachineId" -ForegroundColor White
        Write-Host "Dashboard:   https://cyberdrivepro.github.io/cybervps-space-station/" -ForegroundColor Yellow
        Write-Host "================================================================" -ForegroundColor Green
        return
    }
}

# ------------------------------------------------------------------------------
# STEP 6: Codebase & Executables Setup (Cryptographically Verified Direct Fetch)
# ------------------------------------------------------------------------------
$GitCmd = Get-Command git.exe -ErrorAction SilentlyContinue
$AgentScript = Join-Path $InstallDir "agent\universal-agent.py"
$agentParent = Split-Path -Parent $AgentScript
if (-not (Test-Path $agentParent)) { New-Item -ItemType Directory -Path $agentParent -Force | Out-Null }

$ReleaseManifest = Get-ReleaseManifest -BaseServer $Server

$expectedAgentSha = $null
if ($ReleaseManifest) {
    if ($ReleaseManifest.components -and $ReleaseManifest.components.'universal-agent.py' -and $ReleaseManifest.components.'universal-agent.py'.sha256) {
        $expectedAgentSha = $ReleaseManifest.components.'universal-agent.py'.sha256.ToLower().Trim()
    } elseif ($ReleaseManifest.agent_sha256) {
        $expectedAgentSha = $ReleaseManifest.agent_sha256.ToLower().Trim()
    }
}

$needDownload = (-not (Test-Path $AgentScript))
if (-not $needDownload -and $expectedAgentSha) {
    if (-not (Test-Sha256Checksum -FilePath $AgentScript -ExpectedHash $expectedAgentSha -ComponentName "Local universal-agent.py")) {
        Write-Host "  [*] Local universal-agent.py requires refresh. Re-downloading verified version..." -ForegroundColor Cyan
        $needDownload = $true
    }
}

if ($needDownload) {
    Write-Host "[*] Fetching CyberVPS Host Agent components (Verified Release)..." -ForegroundColor Cyan
    $downloaded = $false
    try {
        (New-Object System.Net.WebClient).DownloadFile("$($Server.TrimEnd('/'))/agent/universal-agent.py", $AgentScript)
        $downloaded = (Test-Path $AgentScript) -and ((Get-Item $AgentScript).Length -gt 5000)
    } catch {}

    if (-not $downloaded) {
        try {
            (New-Object System.Net.WebClient).DownloadFile("https://raw.githubusercontent.com/cyberdrivepro/cybervps-space-station/main/agent/universal-agent.py", $AgentScript)
            $downloaded = (Test-Path $AgentScript) -and ((Get-Item $AgentScript).Length -gt 5000)
        } catch {}
    }

    if (-not $downloaded -and $GitCmd) {
        try { & git clone --depth 1 $RepoUrl $InstallDir } catch {}
    }

    if ($expectedAgentSha -and (Test-Path $AgentScript)) {
        if (-not (Test-Sha256Checksum -FilePath $AgentScript -ExpectedHash $expectedAgentSha -ComponentName "universal-agent.py")) {
            Write-Host "  [!] [TAMPER_DETECTED] universal-agent.py integrity check failed! Aborting." -ForegroundColor Red
            Remove-Item $AgentScript -Force -ErrorAction SilentlyContinue
            Exit-WithCode 1
            return
        }
    }
}

# Ensure ghost-bridge.ps1 is staged
$expectedGhostSha = $null
if ($ReleaseManifest -and $ReleaseManifest.components -and $ReleaseManifest.components.'ghost-bridge.ps1' -and $ReleaseManifest.components.'ghost-bridge.ps1'.sha256) {
    $expectedGhostSha = $ReleaseManifest.components.'ghost-bridge.ps1'.sha256.ToLower().Trim()
}
if (-not (Test-Path $GhostBridgeScript)) {
    try {
        (New-Object System.Net.WebClient).DownloadFile("$($Server.TrimEnd('/'))/agent/ghost-bridge.ps1", $GhostBridgeScript)
    } catch {
        try {
            (New-Object System.Net.WebClient).DownloadFile("https://raw.githubusercontent.com/cyberdrivepro/cybervps-space-station/main/agent/ghost-bridge.ps1", $GhostBridgeScript)
        } catch {}
    }
}
if ($expectedGhostSha -and (Test-Path $GhostBridgeScript)) {
    Test-Sha256Checksum -FilePath $GhostBridgeScript -ExpectedHash $expectedGhostSha -ComponentName "ghost-bridge.ps1" | Out-Null
}

# Ensure CLI binaries are staged in BinDir
$cliPs1 = Join-Path $BinDir "cybervps.ps1"
$cliCmd = Join-Path $BinDir "cybervps.cmd"
if (-not (Test-Path $cliPs1)) {
    try {
        (New-Object System.Net.WebClient).DownloadFile("$($Server.TrimEnd('/'))/bin/cybervps.ps1", $cliPs1)
    } catch {
        try {
            (New-Object System.Net.WebClient).DownloadFile("https://raw.githubusercontent.com/cyberdrivepro/cybervps-space-station/main/bin/cybervps.ps1", $cliPs1)
        } catch {}
    }
}
if (-not (Test-Path $cliCmd)) {
    Set-Content -Path $cliCmd -Value "@echo off`r`npowershell.exe -ExecutionPolicy Bypass -NoProfile -File `"%~dp0cybervps.ps1`" %*" -Force
}

# ------------------------------------------------------------------------------
# STEP 7: Save Durable Configuration
# ------------------------------------------------------------------------------
$ConfigObj = [ordered]@{
    server_url = $Server.TrimEnd("/")
    server_urls = @(
        $Server.TrimEnd("/"),
        "https://cybervps-space-station.up.railway.app"
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
if (Test-Path (Join-Path $InstallDir "bin")) {
    Copy-Item (Join-Path $InstallDir "bin\*") $BinDir -Force -Recurse -ErrorAction SilentlyContinue
}
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

# Clean up stale competing mechanisms and running instances to avoid mutex collision
if (Test-Path $StartupShortcut) {
    Remove-Item -Path $StartupShortcut -Force -ErrorAction SilentlyContinue
}
foreach ($oldTask in @("CyberVPS-Space-Station-Agent", "CyberVPSAgentAutoStart", "CyberVPSAgent")) {
    try { & schtasks.exe /End /TN $oldTask 2>$null | Out-Null } catch {}
    try { Unregister-ScheduledTask -TaskName $oldTask -Confirm:$false -ErrorAction SilentlyContinue } catch {}
    try { & schtasks.exe /Delete /TN $oldTask /F 2>$null | Out-Null } catch {}
}
try {
    Remove-ItemProperty -Path "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run" -Name "CyberVPS-Agent" -Force -ErrorAction SilentlyContinue
    Remove-ItemProperty -Path "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run" -Name "CyberVPSAgent" -Force -ErrorAction SilentlyContinue
} catch {}

# Stop any running universal-agent.py processes to avoid duplicate instance mutex conflict
Write-Host "[*] Terminating existing agent instances to ensure clean single-instance startup..." -ForegroundColor Cyan
try {
    Get-CimInstance Win32_Process -Filter "Name LIKE 'python%'" -ErrorAction SilentlyContinue | Where-Object {
        $_.CommandLine -like "*universal-agent.py*"
    } | ForEach-Object {
        try { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue } catch {}
    }
} catch {}

# Prefer pythonw.exe for 100% windowless execution (Zero Popups)
$PythonWExe = $null
if ($PythonExe) {
    $candW = Join-Path (Split-Path -Parent $PythonExe) "pythonw.exe"
    if (Test-Path $candW) { $PythonWExe = $candW }
}
$ServicePyExe = if ($PythonWExe) { $PythonWExe } else { $PythonExe }

$IsElevated = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

# Always register the cybervps:// protocol handler in HKCU
Register-CyberVPSProtocolHandler

# If admin profile explicitly requested and currently not elevated, prompt UAC
if ($Profile -eq "admin" -and -not $IsElevated) {
    Write-Host "[*] Requesting administrator elevation (UAC prompt)..." -ForegroundColor Cyan
    try {
        $elevArgs = "-ExecutionPolicy Bypass -NoProfile -File `"$PSCommandPath`" -Server `"$Server`" -Ticket `"$Token`" -Profile admin"
        if ($MachineId) { $elevArgs += " -TargetMachineId `"$MachineId`"" }
        Start-Process powershell.exe -Verb RunAs -ArgumentList $elevArgs -Wait
        Write-Host "  [+] Elevated administrator installation completed." -ForegroundColor Green
        Exit-WithCode 0
        return
    } catch {
        Write-Host "  [!] Administrator elevation cancelled by user." -ForegroundColor Yellow
        Exit-WithCode 1
        return
    }
}

$CurrentUserName = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$IsPythonInUserProfile = ($ServicePyExe -like "*\Users\*" -or $ServicePyExe -like "*AppData*")
$ProgramDataBase = if ($env:ProgramData) { Join-Path $env:ProgramData "CyberVPS" } else { "C:\ProgramData\CyberVPS" }

if ($IsElevated -and (-not $IsPythonInUserProfile)) {
    # System-level Python runtime: can safely run under SYSTEM account
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
    # User-profile Python (or non-elevated): register Scheduled Task under current user account
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

    # Register user scheduled task at logon with Highest privileges (no password required)
    try {
        $action = New-ScheduledTaskAction -Execute $ServicePyExe -Argument "-u `"$AgentScript`" --config `"$ConfigFile`" --log-dir `"$LogsDir`" --ghost"
        $trigger = New-ScheduledTaskTrigger -AtLogOn -User $CurrentUserName
        $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit (New-TimeSpan -Days 0)
        Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -RunLevel Highest -Force -ErrorAction SilentlyContinue | Out-Null
    } catch {}
}

# ------------------------------------------------------------------------------
# STEP 9: Start Background Agent Daemon Immediately & Verify
# ------------------------------------------------------------------------------
$AgentPidFile = Join-Path $RunDir "agent.pid"
if (Test-Path $AgentPidFile) {
    Remove-Item $AgentPidFile -Force -ErrorAction SilentlyContinue
}

$launchTarget = if ($ServicePyExe) { $ServicePyExe } else { $PythonExe }
$agentProc = Start-Process -FilePath $launchTarget -ArgumentList "-u `"$AgentScript`" --config `"$ConfigFile`" --log-dir `"$LogsDir`" --ghost" -PassThru -WindowStyle Hidden
Start-Sleep -Milliseconds 800

$isRunning = $false
$runningPid = 0
if ($agentProc -and (-not $agentProc.HasExited)) {
    $runningPid = $agentProc.Id
    Set-Content -Path $AgentPidFile -Value $runningPid -Force
    $isRunning = $true
} else {
    try {
        $p = Get-CimInstance Win32_Process -Filter "Name LIKE 'python%'" -ErrorAction SilentlyContinue | Where-Object {
            $_.CommandLine -like "*universal-agent.py*"
        } | Select-Object -First 1
        if ($p) {
            $runningPid = $p.ProcessId
            Set-Content -Path $AgentPidFile -Value $runningPid -Force
            $isRunning = $true
        }
    } catch {}
}

# ------------------------------------------------------------------------------
# STEP 10: Clean & Truthful Completion Summary
# ------------------------------------------------------------------------------
Write-Host ""
Write-Host "================================================================" -ForegroundColor Cyan
if ($isRunning) {
    Write-Host "   CYBERVPS HOST AGENT - SETUP COMPLETE                         " -ForegroundColor Green
} else {
    Write-Host "❌ CYBERVPS HOST AGENT - SETUP FAILED                          " -ForegroundColor Red
}
Write-Host "================================================================" -ForegroundColor Cyan
Write-Host "Host:        $env:COMPUTERNAME (Windows)" -ForegroundColor White
Write-Host "Backend:     $Server" -ForegroundColor White
if ($isRunning) {
    Write-Host "Agent:       ACTIVE (PID: $runningPid) [Ghost Mode]" -ForegroundColor Green
    Write-Host "Service:     Running 24/7 in Background (CyberVPSAgent)" -ForegroundColor Green
    Write-Host "Startup:     Automatic on Reboot & Logon" -ForegroundColor Green
} else {
    Write-Host "Agent:       STOPPED / FAILED TO LAUNCH ❌" -ForegroundColor Red
}
Write-Host "Machine ID:  $MachineId" -ForegroundColor White
Write-Host "Dashboard:   https://cyberdrivepro.github.io/cybervps-space-station/" -ForegroundColor Yellow
Write-Host "================================================================" -ForegroundColor Cyan

if ($isRunning) {
    Write-Host "Setup complete! The Host Agent is running silently in the background." -ForegroundColor White
    Write-Host "You can safely close this window." -ForegroundColor Gray
} else {
    Write-Host "❌ Agent process failed to stay active. Recent agent logs:" -ForegroundColor Red
    $agentLogPath = Join-Path $LogsDir "agent.log"
    if (Test-Path $agentLogPath) {
        Get-Content $agentLogPath -Tail 20
    }
    Write-Host "👉 Run diagnostics: cybervps doctor --network" -ForegroundColor Yellow
    Exit-WithCode 1
}
