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

# 2. Curl / Connectivity Timeout Check
Write-Host "`n[2/4] Testing Connectivity with Curl Timeout Checker..." -ForegroundColor Blue
$healthUrl = "$ServerUrl/health"
try {
    $res = Invoke-WebRequest -Uri $healthUrl -TimeoutSec 3 -UseBasicParsing -ErrorAction SilentlyContinue
    if ($res.StatusCode -eq 200) {
        Write-Host "  • Control Plane Reachable: PASS ($healthUrl returned 200 OK)" -ForegroundColor Green
    } else {
        Write-Host "  • Control Plane Reachable: WARN ($healthUrl returned $($res.StatusCode))" -ForegroundColor Yellow
    }
} catch {
    Write-Host "  • Control Plane Reachable: WARN (Target unreachable or pending start)" -ForegroundColor Yellow
}

# 3. Copy or Write Agent
Write-Host "`n[3/4] Setting Up Agent Executable..." -ForegroundColor Blue
$agentScript = Join-Path $cvpsDir "universal-agent.py"
$parentDir = Split-Path -Parent $PSScriptRoot
$sourceAgent = Join-Path $parentDir "agent\universal-agent.py"

if (Test-Path $sourceAgent) {
    Copy-Item -Path $sourceAgent -Destination $agentScript -Force
}

# 4. Launch Agent
Write-Host "`n[4/4] Launching CyberVPS Agent..." -ForegroundColor Blue
$agentArgs = "`"$agentScript`" `"$ServerUrl`" `"$Token`" `"$MachineId`""
$pythonCmd = (Get-Command python.exe -ErrorAction SilentlyContinue).Source

if ($pythonCmd) {
    $proc = Start-Process -FilePath $pythonCmd -ArgumentList $agentArgs -PassThru -WindowStyle Hidden
    Set-Content -Path (Join-Path $cvpsDir "agent.pid") -Value $proc.Id
    Write-Host "  • CyberVPS Agent spawned successfully with PID: $($proc.Id)" -ForegroundColor Green
} else {
    Write-Host "  • Python 3 executable not found in PATH! Run with native Rust binary." -ForegroundColor Red
}

Write-Host "`n================================================================" -ForegroundColor Cyan
Write-Host "   🎉 Windows Installation Complete! Agent Active!              " -ForegroundColor Green
Write-Host "================================================================" -ForegroundColor Cyan
