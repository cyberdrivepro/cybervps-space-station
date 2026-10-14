# 🩺 CyberVPS Space Station — Troubleshooting & Diagnostic Guide

This guide covers common errors, diagnostic commands, and verified fixes across Windows, Linux, and Cloud environments.

---

## 1. Quick Diagnostic: System Doctor

Run the built-in diagnostic tool on any platform:

```bash
cybervps doctor
```
Or via script:
```bash
curl -sSL https://raw.githubusercontent.com/cyberdrivepro/cybervps-space-station/main/scripts/diagnostics/doctor.sh | bash
```

The doctor tests:
1. Python 3 runtime availability and version (3.8+ required).
2. Outbound HTTPS connectivity to the control plane.
3. DNS resolution of GitHub, Railway, and tunnel endpoints.
4. WebSocket protocol upgrade capabilities.
5. PTY allocator / ConPTY subsystem readiness.

---

## 2. Common Issues & Solutions

### 1. Port Already in Use (`EADDRINUSE` / Port Conflict)
- **Symptom**: Local port bridge fails to bind `127.0.0.1:16767` or `8080`.
- **Cause**: Another local development process (e.g., an existing server or Vite instance) is listening on that port.
- **Fix**: CyberVPS automatically resolves client bridge conflicts by allocating an ephemeral port. To manually find and terminate an unwanted process:
  - **Windows**:
    ```powershell
    netstat -ano | findstr :16767
    taskkill /PID <PID> /F
    ```
  - **Linux**:
    ```bash
    ss -tulpn | grep :16767
    kill -9 <PID>
    ```

### 2. PowerShell Execution Policy Restriction
- **Symptom**: `File ... cannot be loaded because running scripts is disabled on this system.`
- **Cause**: Windows client machine has default restrictive execution policy (`Restricted`).
- **Fix**: Bypass execution policy for the installer process only (safe, does not weaken global machine security):
  ```powershell
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\install.ps1
  ```

### 3. Windows CMD `curl: (23) Failed writing body`
- **Symptom**: Running `curl` inside `C:\Windows\system32` errors out with code 23.
- **Cause**: Ordinary users and non-elevated prompts cannot write files directly into `system32`.
- **Fix**: Use the official installer command that downloads to `%TEMP%`:
  ```cmd
  curl.exe -fSL --retry 3 "https://raw.githubusercontent.com/cyberdrivepro/cybervps-space-station/main/install.cmd" -o "%TEMP%\cybervps-install.cmd" && call "%TEMP%\cybervps-install.cmd"
  ```

### 4. Terminal WebSocket Rejected with HTTP 403 Forbidden
- **Symptom**: Interactive terminal in browser displays `WebSocket connection closed with code 1008 / HTTP 403`.
- **Cause**: CSWSH (Cross-Site WebSocket Hijacking) protection blocked an untrusted browser origin.
- **Fix**: Verify you are opening the terminal from an authorized domain:
  - Live Dashboard: `https://cyberdrivepro.github.io/cybervps-space-station/`
  - Railway Deployment: `https://cybervps-space-station.up.railway.app`
  - Local: `http://localhost:8080`
  If hosting on a custom domain, pass `ALLOWED_ORIGINS="yourdomain.com"` in server environment variables.

### 5. Terminal WebSocket Rejected with HTTP 401 Unauthorized
- **Symptom**: Terminal connection fails with 401 immediately upon opening.
- **Cause**: Attempting to use the master pairing key directly in the WebSocket URL, or using an expired/replayed single-use token.
- **Fix**: Ensure the frontend requests a fresh token via `POST /api/v1/terminal/token` before opening the WebSocket stream. Tokens are single-use and expire in 60 seconds.

### 6. Linux Background Daemon Stops When SSH Disconnects
- **Symptom**: Agent is online during SSH session, but goes offline after disconnecting SSH.
- **Cause**: Systemd user sessions terminate when user logs out unless lingering is enabled.
- **Fix**: Enable user lingering:
  ```bash
  loginctl enable-linger $USER
  ```
  The official `install.sh` automatically configures this, or falls back to a background watchdog daemon with `@reboot` crontab if systemd is unavailable.

### 7. Duplicate Agent Instance Warning
- **Symptom**: Log displays: `Another CyberVPS agent instance is already active (PID xxxx). Exiting to prevent duplicate running instances.`
- **Cause**: CyberVPS agent uses atomic lockfiles and PID liveness detection to prevent multiple agents fighting over the same machine UUID.
- **Fix**: If an orphaned process exists:
  ```bash
  cybervps stop
  cybervps start
  ```
