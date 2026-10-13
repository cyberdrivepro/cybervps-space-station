@echo off
REM ==============================================================================
REM CyberVPS SPACE STATION - Windows Command Prompt Bootstrap
REM ==============================================================================
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "& ([scriptblock]::Create((New-Object Net.WebClient).DownloadString('https://raw.githubusercontent.com/cyberdrivepro/cybervps-space-station/main/install.ps1')))"
