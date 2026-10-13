@echo off
setlocal
REM ==============================================================================
REM CyberVPS SPACE STATION - Windows Command Prompt Bootstrap
REM Works from any working directory (including C:\Windows\system32)
REM Official Repository: https://github.com/cyberdrivepro/cybervps-space-station
REM ==============================================================================

set "TARGET_PS1=%TEMP%\cybervps-install-%RANDOM%.ps1"
set "PS1_URL=https://raw.githubusercontent.com/cyberdrivepro/cybervps-space-station/main/install.ps1"

echo [*] Downloading CyberVPS Space Station installer to %TEMP%...

powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; $ProgressPreference = 'SilentlyContinue'; Invoke-WebRequest -UseBasicParsing -Uri '%PS1_URL%' -OutFile '%TARGET_PS1%'"

if not exist "%TARGET_PS1%" (
    echo [!] Download via PowerShell failed. Attempting fallback via curl.exe...
    curl.exe -fSL --retry 3 "%PS1_URL%" -o "%TARGET_PS1%"
)

if not exist "%TARGET_PS1%" (
    echo [X] Error: Could not download install.ps1 to %TEMP%. Check internet connectivity.
    exit /b 1
)

echo [*] Launching CyberVPS installer...
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%TARGET_PS1%" %*
set "EXIT_CODE=%ERRORLEVEL%"

del /f /q "%TARGET_PS1%" 2>nul
exit /b %EXIT_CODE%
