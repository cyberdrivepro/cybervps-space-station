@echo off
setlocal
where node.exe >nul 2>&1
if %ERRORLEVEL% equ 0 (
    if exist "%~dp0cybervps" (
        node "%~dp0cybervps" %*
    ) else if exist "%~dp0..\space-station\bin\cybervps" (
        node "%~dp0..\space-station\bin\cybervps" %*
    ) else (
        powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0cybervps.ps1" %*
    )
) else (
    powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0cybervps.ps1" %*
)
