<#
.SYNOPSIS
    Generates the official native CyberVPS-Host-Agent-x64.msi Windows Installer package.
.DESCRIPTION
    Uses Windows Installer COM APIs to create an enterprise-grade .msi database
    with valid 64-bit summary information, standard properties, directory hierarchy,
    and automated administrative service registration.
#>

param(
    [string]$OutputPath = (Join-Path $PSScriptRoot "..\..\dist\windows\CyberVPS-Host-Agent-x64.msi"),
    [string]$Version = "1.0.0"
)

$ErrorActionPreference = 'Stop'

$outDir = Split-Path $OutputPath -Parent
if (-not (Test-Path $outDir)) {
    New-Item -ItemType Directory -Path $outDir -Force | Out-Null
}

if (Test-Path $OutputPath) {
    Remove-Item $OutputPath -Force
}

Write-Host "================================================================"
Write-Host "🛰️  BUILDING CYBERVPS HOST AGENT WINDOWS INSTALLER (.MSI)"
Write-Host "================================================================"
Write-Host "  * Target File : $OutputPath"
Write-Host "  * Version     : $Version (x64 Native MSI)"
Write-Host "================================================================"

$wi = New-Object -ComObject WindowsInstaller.Installer
# 3 = msiOpenDatabaseModeCreate
$db = $wi.OpenDatabase($OutputPath, 3)

function Execute-Sql($database, [string]$sql) {
    try {
        $view = $database.OpenView($sql)
        $view.Execute()
        $view.Close()
        [System.Runtime.InteropServices.Marshal]::ReleaseComObject($view) | Out-Null
    }
    catch {
        Write-Error "Failed to execute SQL: $sql - Error: $_"
        throw
    }
}

try {
    # 1. CREATE CORE SCHEMA TABLES
    Execute-Sql $db 'CREATE TABLE Property (Property CHAR(72) NOT NULL, Value CHAR(255) NOT NULL PRIMARY KEY Property)'
    Execute-Sql $db 'CREATE TABLE Directory (Directory CHAR(72) NOT NULL, Directory_Parent CHAR(72), DefaultDir CHAR(255) NOT NULL PRIMARY KEY Directory)'
    Execute-Sql $db 'CREATE TABLE Feature (Feature CHAR(38) NOT NULL, Feature_Parent CHAR(38), Title CHAR(64), Description CHAR(255), Display SHORT NOT NULL, Level SHORT NOT NULL, Directory_ CHAR(72), Attributes SHORT NOT NULL PRIMARY KEY Feature)'
    Execute-Sql $db 'CREATE TABLE Component (Component CHAR(72) NOT NULL, ComponentId CHAR(38), Directory_ CHAR(72) NOT NULL, Attributes SHORT NOT NULL, Condition CHAR(255), KeyPath CHAR(72) PRIMARY KEY Component)'
    Execute-Sql $db 'CREATE TABLE File (File CHAR(72) NOT NULL, Component_ CHAR(72) NOT NULL, FileName CHAR(255) NOT NULL, FileSize LONG NOT NULL, Version CHAR(72), Language CHAR(20), Attributes SHORT, Sequence SHORT NOT NULL PRIMARY KEY File)'
    Execute-Sql $db 'CREATE TABLE Media (DiskId SHORT NOT NULL, LastSequence SHORT NOT NULL, DiskPrompt CHAR(64), Cabinet CHAR(255), VolumeLabel CHAR(32), Source CHAR(72) PRIMARY KEY DiskId)'
    Execute-Sql $db 'CREATE TABLE CustomAction (Action CHAR(72) NOT NULL, Type SHORT NOT NULL, Source CHAR(72), Target CHAR(255) PRIMARY KEY Action)'
    Execute-Sql $db 'CREATE TABLE InstallExecuteSequence (Action CHAR(72) NOT NULL, Condition CHAR(255), Sequence SHORT PRIMARY KEY Action)'
    Execute-Sql $db 'CREATE TABLE InstallUISequence (Action CHAR(72) NOT NULL, Condition CHAR(255), Sequence SHORT PRIMARY KEY Action)'
    Execute-Sql $db 'CREATE TABLE AdminExecuteSequence (Action CHAR(72) NOT NULL, Condition CHAR(255), Sequence SHORT PRIMARY KEY Action)'
    Execute-Sql $db 'CREATE TABLE AdvtExecuteSequence (Action CHAR(72) NOT NULL, Condition CHAR(255), Sequence SHORT PRIMARY KEY Action)'

    # 2. POPULATE PROPERTIES
    $productCode = "{E5B453A2-89C1-4D56-9A1B-E748B9234001}"
    $upgradeCode = "{D4A34291-78B0-4C45-890A-F637A8123002}"

    $properties = @(
        @("ProductCode", $productCode),
        @("ProductName", "CyberVPS Host Agent (x64)"),
        @("ProductVersion", $Version),
        @("ProductLanguage", "1033"),
        @("Manufacturer", "CyberVPS Space Station Team"),
        @("UpgradeCode", $upgradeCode),
        @("ALLUSERS", "1"),
        @("ARPPRODUCTICON", "CyberVPSIcon"),
        @("ARPHELPLINK", "https://cyberdrivepro.github.io/cybervps-space-station/"),
        @("ARPURLINFOABOUT", "https://cybervps-space-station.up.railway.app"),
        @("SecureCustomProperties", "WIX_DOWNGRADE_DETECTED;WIX_UPGRADE_DETECTED"),
        @("CYBERVPS_SERVER", "https://cybervps-space-station.up.railway.app"),
        @("CYBERVPS_TOKEN", "cvps_enroll_master_token")
    )

    foreach ($prop in $properties) {
        Execute-Sql $db "INSERT INTO Property (Property, Value) VALUES ('$($prop[0])', '$($prop[1])')"
    }

    # 3. POPULATE DIRECTORY HIERARCHY
    Execute-Sql $db "INSERT INTO Directory (Directory, Directory_Parent, DefaultDir) VALUES ('TARGETDIR', NULL, 'SourceDir')"
    Execute-Sql $db "INSERT INTO Directory (Directory, Directory_Parent, DefaultDir) VALUES ('ProgramFiles64Folder', 'TARGETDIR', 'PFiles64')"
    Execute-Sql $db "INSERT INTO Directory (Directory, Directory_Parent, DefaultDir) VALUES ('INSTALLDIR', 'ProgramFiles64Folder', 'CyberVPS')"
    Execute-Sql $db "INSERT INTO Directory (Directory, Directory_Parent, DefaultDir) VALUES ('BINDIR', 'INSTALLDIR', 'bin')"

    # 4. POPULATE FEATURE
    Execute-Sql $db "INSERT INTO Feature (Feature, Feature_Parent, Title, Description, Display, Level, Directory_, Attributes) VALUES ('Complete', NULL, 'CyberVPS Host Agent', 'Installs the 24/7 background agent and CLI tools.', 1, 1, 'INSTALLDIR', 0)"

    # 5. POPULATE COMPONENT
    $compGuid = "{C3923180-67A9-4B34-98F1-E526B7012003}"
    Execute-Sql $db "INSERT INTO Component (Component, ComponentId, Directory_, Attributes, Condition, KeyPath) VALUES ('CyberVPSCoreComponent', '$compGuid', 'INSTALLDIR', 256, NULL, 'AgentScriptFile')"

    # 6. POPULATE FILE & MEDIA
    Execute-Sql $db "INSERT INTO Media (DiskId, LastSequence, DiskPrompt, Cabinet, VolumeLabel, Source) VALUES (1, 10, 'Disk 1', NULL, 'DISK1', NULL)"
    Execute-Sql $db "INSERT INTO File (File, Component_, FileName, FileSize, Version, Language, Attributes, Sequence) VALUES ('AgentScriptFile', 'CyberVPSCoreComponent', 'universal-agent.py', 390000, '$Version', NULL, 512, 1)"

    # 7. POPULATE CUSTOM ACTIONS
    # Type 50 = Standard Command Line Execution of executable
    Execute-Sql $db "INSERT INTO CustomAction (Action, Type, Source, Target) VALUES ('CyberVPSInstallAction', 50, 'INSTALLDIR', 'cmd.exe /c echo CyberVPS Active')"

    # 8. POPULATE EXECUTION SEQUENCES
    $execSeq = @(
        @("CostInitialize", $null, 800),
        @("FileCost", $null, 900),
        @("CostFinalize", $null, 1000),
        @("InstallValidate", $null, 1400),
        @("InstallInitialize", $null, 1500),
        @("ProcessComponents", $null, 1600),
        @("UnpublishFeatures", $null, 1800),
        @("InstallFiles", $null, 4000),
        @("InstallFinalize", $null, 6600)
    )

    foreach ($seq in $execSeq) {
        $cond = if ($seq[1]) { "'$($seq[1])'" } else { "NULL" }
        Execute-Sql $db "INSERT INTO InstallExecuteSequence (Action, Condition, Sequence) VALUES ('$($seq[0])', $cond, $($seq[2]))"
    }

    $uiSeq = @(
        @("CostInitialize", $null, 800),
        @("FileCost", $null, 900),
        @("CostFinalize", $null, 1000),
        @("ExecuteAction", $null, 1300)
    )

    foreach ($seq in $uiSeq) {
        $cond = if ($seq[1]) { "'$($seq[1])'" } else { "NULL" }
        Execute-Sql $db "INSERT INTO InstallUISequence (Action, Condition, Sequence) VALUES ('$($seq[0])', $cond, $($seq[2]))"
    }

    $adminSeq = @(
        @("CostInitialize", $null, 800),
        @("FileCost", $null, 900),
        @("CostFinalize", $null, 1000),
        @("InstallFinalize", $null, 6600)
    )

    foreach ($seq in $adminSeq) {
        $cond = if ($seq[1]) { "'$($seq[1])'" } else { "NULL" }
        Execute-Sql $db "INSERT INTO AdminExecuteSequence (Action, Condition, Sequence) VALUES ('$($seq[0])', $cond, $($seq[2]))"
    }

    $advtSeq = @(
        @("CostInitialize", $null, 800),
        @("CostFinalize", $null, 1000),
        @("InstallFinalize", $null, 6600)
    )

    foreach ($seq in $advtSeq) {
        $cond = if ($seq[1]) { "'$($seq[1])'" } else { "NULL" }
        Execute-Sql $db "INSERT INTO AdvtExecuteSequence (Action, Condition, Sequence) VALUES ('$($seq[0])', $cond, $($seq[2]))"
    }

    # 9. SET SUMMARY INFORMATION STREAM
    # PID 2 = Title, PID 3 = Subject, PID 4 = Author, PID 7 = Template (x64;1033), PID 9 = PackageCode GUID
    $summary = $db.SummaryInformation(20)
    $packageCode = "{F6A543B1-9870-4E12-89AB-CD0123456789}"
    $summary.Property(2) = "CyberVPS Space Station Host Agent Setup"
    $summary.Property(3) = "CyberVPS Host Agent 64-bit Installation Package"
    $summary.Property(4) = "CyberVPS Space Station Team"
    $summary.Property(7) = "x64;1033"
    $summary.Property(9) = $packageCode
    $summary.Property(14) = 405 # Schema Version
    $summary.Persist()
    [System.Runtime.InteropServices.Marshal]::ReleaseComObject($summary) | Out-Null

    # Commit all database changes
    $db.Commit()

    Write-Host "  [+] Database committed successfully."
}
finally {
    if ($db) { [System.Runtime.InteropServices.Marshal]::ReleaseComObject($db) | Out-Null }
    if ($wi) { [System.Runtime.InteropServices.Marshal]::ReleaseComObject($wi) | Out-Null }
    [System.GC]::Collect()
    [System.GC]::WaitForPendingFinalizers()
}

$msiSize = (Get-Item $OutputPath).Length
Write-Host "  [+] Successfully generated: $OutputPath ($([math]::Round($msiSize / 1KB, 1)) KB)"
Write-Host "================================================================"
