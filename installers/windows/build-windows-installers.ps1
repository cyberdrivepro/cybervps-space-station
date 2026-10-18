<#
.SYNOPSIS
    Builds the official Windows installer distribution for CyberVPS Space Station.
.DESCRIPTION
    Compiles native x64 executables and generates the MSI package:
      1. CyberVPS-Setup-x64.exe       - Universal dual-mode setup (interactive & silent)
      2. CyberVPS-Setup-Admin-x64.exe - High-privilege 24/7 background Windows Service setup
      3. CyberVPS-Setup-User-x64.exe  - Standard non-elevated user setup (%LOCALAPPDATA%)
      4. CyberVPS-Host-Agent-x64.msi  - Standard Windows Installer package for GPO / Intune
    Produces SHA-256 checksums and release-manifest.json.
#>

param(
    [string]$Version = "1.0.0",
    [string]$OutputDir = (Join-Path $PSScriptRoot "..\..\dist\windows")
)

$ErrorActionPreference = 'Stop'

Write-Host "================================================================"
Write-Host "🚀 CYBERVPS SPACE STATION - WINDOWS PACKAGING & RELEASE PIPELINE"
Write-Host "================================================================"
Write-Host "  * Version    : $Version"
Write-Host "  * Output Dir : $OutputDir"
Write-Host "================================================================"

# 1. Resolve 64-bit C# Compiler
$cscCandidates = @(
    "C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe",
    "C:\Windows\Microsoft.NET\Framework\v4.0.30319\csc.exe"
)
$cscPath = $null
foreach ($cand in $cscCandidates) {
    if (Test-Path $cand) {
        $cscPath = $cand
        break
    }
}
if (-not $cscPath) {
    $cmdCsc = Get-Command "csc.exe" -ErrorAction SilentlyContinue
    if ($cmdCsc) { $cscPath = $cmdCsc.Source }
}
if (-not $cscPath) {
    Write-Error "Could not locate C# compiler (csc.exe). .NET Framework 4.0+ is required."
    exit 1
}
Write-Host "  [+] Found C# Compiler: $cscPath"

# 2. Prepare Output Directory
if (-not (Test-Path $OutputDir)) {
    New-Item -ItemType Directory -Path $OutputDir -Force | Out-Null
}

$setupSource = Join-Path $PSScriptRoot "CyberVPS-Setup.cs"
$adminManifest = Join-Path $PSScriptRoot "app.admin.manifest"
$userManifest = Join-Path $PSScriptRoot "app.user.manifest"

if (-not (Test-Path $setupSource)) {
    Write-Error "Setup source file not found at: $setupSource"
    exit 1
}

# 3. Compile CyberVPS-Setup-x64.exe (Universal Dual-Mode with asInvoker Manifest)
$universalExe = Join-Path $OutputDir "CyberVPS-Setup-x64.exe"
Write-Host "`n[*] Compiling CyberVPS-Setup-x64.exe (Universal Dual-Mode asInvoker)..."
& $cscPath /nologo /optimize+ /target:exe /platform:x64 "/win32manifest:$userManifest" "/out:$universalExe" $setupSource
if ($LASTEXITCODE -ne 0) {
    Write-Error "Failed to compile CyberVPS-Setup-x64.exe"
    exit 1
}
Write-Host "  [+] Built: $universalExe ($([math]::Round((Get-Item $universalExe).Length / 1KB, 1)) KB)"

# 4. Compile CyberVPS-Setup-Admin-x64.exe (Explicit UAC requireAdministrator)
$adminExe = Join-Path $OutputDir "CyberVPS-Setup-Admin-x64.exe"
Write-Host "`n[*] Compiling CyberVPS-Setup-Admin-x64.exe (Admin Mode UAC Manifest)..."
& $cscPath /nologo /optimize+ /target:exe /platform:x64 "/win32manifest:$adminManifest" "/out:$adminExe" $setupSource
if ($LASTEXITCODE -ne 0) {
    Write-Error "Failed to compile CyberVPS-Setup-Admin-x64.exe"
    exit 1
}
Write-Host "  [+] Built: $adminExe ($([math]::Round((Get-Item $adminExe).Length / 1KB, 1)) KB)"

# 5. Compile CyberVPS-Setup-User-x64.exe (Standard asInvoker User Mode)
$userExe = Join-Path $OutputDir "CyberVPS-Setup-User-x64.exe"
Write-Host "`n[*] Compiling CyberVPS-Setup-User-x64.exe (Standard User Manifest)..."
& $cscPath /nologo /optimize+ /target:exe /platform:x64 "/win32manifest:$userManifest" "/out:$userExe" $setupSource
if ($LASTEXITCODE -ne 0) {
    Write-Error "Failed to compile CyberVPS-Setup-User-x64.exe"
    exit 1
}
Write-Host "  [+] Built: $userExe ($([math]::Round((Get-Item $userExe).Length / 1KB, 1)) KB)"

# 6. Generate CyberVPS-Host-Agent-x64.msi
$msiFile = Join-Path $OutputDir "CyberVPS-Host-Agent-x64.msi"
$genMsiScript = Join-Path $PSScriptRoot "generate-msi.ps1"
Write-Host "`n[*] Generating CyberVPS-Host-Agent-x64.msi..."
& powershell -NoProfile -ExecutionPolicy Bypass -File $genMsiScript -OutputPath $msiFile -Version $Version
if ($LASTEXITCODE -ne 0 -or -not (Test-Path $msiFile)) {
    Write-Error "Failed to generate CyberVPS-Host-Agent-x64.msi"
    exit 1
}
Write-Host "  [+] Built: $msiFile ($([math]::Round((Get-Item $msiFile).Length / 1KB, 1)) KB)"

# 7. Compute SHA-256 Checksums
Write-Host "`n[*] Computing SHA-256 Checksums..."
$checksumsFile = Join-Path $OutputDir "checksums.sha256"
$builtFiles = @($universalExe, $adminExe, $userExe, $msiFile)
$checksumLines = @()
$manifestArtifacts = @()

foreach ($file in $builtFiles) {
    $hash = (Get-FileHash -Path $file -Algorithm SHA256).Hash.ToLowerInvariant()
    $fileName = Split-Path $file -Leaf
    $fileSize = (Get-Item $file).Length
    $checksumLines += "$hash  $fileName"

    $desc = switch ($fileName) {
        "CyberVPS-Setup-x64.exe" { "Universal Dual-Mode Bootstrapper (Auto-detects privilege, prompts UAC with graceful user fallback)" }
        "CyberVPS-Setup-Admin-x64.exe" { "Administrator Setup (Embedded requireAdministrator manifest, registers 24/7 background Windows Service)" }
        "CyberVPS-Setup-User-x64.exe" { "Standard User Setup (Embedded asInvoker manifest, installs to %LOCALAPPDATA% without UAC prompt)" }
        "CyberVPS-Host-Agent-x64.msi" { "Enterprise Windows Installer Package for GPO, Intune, SCCM, and Silent Cloud Provisioning" }
        Default { "CyberVPS Host Agent Package" }
    }

    $targetMode = switch ($fileName) {
        "CyberVPS-Setup-Admin-x64.exe" { "administrator" }
        "CyberVPS-Setup-User-x64.exe" { "user" }
        "CyberVPS-Host-Agent-x64.msi" { "enterprise_msi" }
        Default { "dual_mode" }
    }

    $installCmd = switch ($fileName) {
        "CyberVPS-Host-Agent-x64.msi" { "msiexec /i $fileName /qn" }
        Default { ".\$fileName --silent" }
    }

    $manifestArtifacts += [PSCustomObject]@{
        filename = $fileName
        size_bytes = $fileSize
        sha256 = $hash
        target_mode = $targetMode
        description = $desc
        install_command = $installCmd
    }

    Write-Host "  * $fileName : $hash"
}

$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllLines($checksumsFile, $checksumLines, $utf8NoBom)
Write-Host "  [+] Written: $checksumsFile"

# 8. Generate Release Manifest JSON
$manifestFile = Join-Path $OutputDir "release-manifest.json"
$manifestData = [PSCustomObject]@{
    product = "CyberVPS Space Station"
    version = $Version
    build_timestamp = [DateTime]::UtcNow.ToString("o")
    platform = "windows"
    architecture = "x64"
    artifacts = $manifestArtifacts
    installation_instructions = [PSCustomObject]@{
        admin_interactive = "Double-click CyberVPS-Setup-Admin-x64.exe and accept UAC prompt."
        admin_silent = "CyberVPS-Setup-x64.exe --admin --silent --server https://cybervps-space-station.up.railway.app"
        user_silent = "CyberVPS-Setup-User-x64.exe --silent"
        msi_silent = "msiexec /i CyberVPS-Host-Agent-x64.msi /qn ALLUSERS=1"
        uninstall = "CyberVPS-Setup-x64.exe --uninstall"
    }
}

$manifestJson = $manifestData | ConvertTo-Json -Depth 4
[System.IO.File]::WriteAllText($manifestFile, $manifestJson, $utf8NoBom)
Write-Host "  [+] Written: $manifestFile"

Write-Host "`n================================================================"
Write-Host "🎉 ALL WINDOWS INSTALLERS BUILT AND VERIFIED SUCCESSFULLY!"
Write-Host "================================================================"
Write-Host "Dist Directory: $OutputDir"
Get-ChildItem -Path $OutputDir | Select-Object Name, Length, LastWriteTime | Format-Table -AutoSize
Write-Host "================================================================"
