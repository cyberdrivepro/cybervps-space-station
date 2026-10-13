@echo off
if exist "%~dp0cybervps" (
    node "%~dp0cybervps" %*
) else if exist "%~dp0..\space-station\bin\cybervps" (
    node "%~dp0..\space-station\bin\cybervps" %*
) else (
    echo [!] CyberVPS script not found at %~dp0cybervps. Please run install.ps1.
    exit /b 1
)
