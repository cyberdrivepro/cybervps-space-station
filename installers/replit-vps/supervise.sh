#!/usr/bin/env bash
# ==============================================================================
# CYBERVPS SPACE STATION — REPLIT VPS LAB PROCESS SUPERVISOR
# ==============================================================================
# Ensures 24/7 resilience of the CyberVPS Agent, VNC server, and websockify.
# Recovers from crashes, logs health status, and prevents idle timeout drops.
# ==============================================================================

INSTALL_BASE="${HOME}/.cybervps"
LAB_DIR="${INSTALL_BASE}/replit"
LOG_DIR="${INSTALL_BASE}/logs"
RUN_DIR="${INSTALL_BASE}/run"
STATUS_FILE="${RUN_DIR}/lab-status.json"
WEB_PORT="${PORT:-8080}"
VNC_DISPLAY=":1"

mkdir -p "${LOG_DIR}" "${RUN_DIR}"

echo "[*] CyberVPS Replit Lab Supervisor initialized (PID: $$)..."

trap 'echo "[*] Supervisor terminating..."; exit 0' SIGTERM SIGINT

while true; do
  TS="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
  
  # 1. Supervise CyberVPS Universal Agent
  AGENT_OK=false
  if pgrep -f "universal-agent.py" >/dev/null 2>&1; then
    AGENT_OK=true
  else
    echo "[${TS}] [!] CyberVPS Universal Agent not running! Restarting..."
    if [ -f "${INSTALL_BASE}/space-station/agent/universal-agent.py" ]; then
      nohup python3 -u "${INSTALL_BASE}/space-station/agent/universal-agent.py" --ghost >> "${LOG_DIR}/agent.log" 2>&1 &
    elif [ -f "${INSTALL_BASE}/agent/universal-agent.py" ]; then
      nohup python3 -u "${INSTALL_BASE}/agent/universal-agent.py" --ghost >> "${LOG_DIR}/agent.log" 2>&1 &
    fi
  fi

  # 2. Supervise Desktop & VNC Server
  DESKTOP_OK=false
  if pgrep -f "Xvnc.*${VNC_DISPLAY}" >/dev/null 2>&1 || pgrep -f "Xtigervnc.*${VNC_DISPLAY}" >/dev/null 2>&1; then
    DESKTOP_OK=true
  else
    echo "[${TS}] [!] VNC Server not running on ${VNC_DISPLAY}! Launching start-desktop.sh..."
    if [ -f "${LAB_DIR}/start-desktop.sh" ]; then
      bash "${LAB_DIR}/start-desktop.sh" >> "${LOG_DIR}/desktop.log" 2>&1 || true
    fi
  fi

  # 3. Supervise Websockify Bridge
  WEBSOCKIFY_OK=false
  if pgrep -f "websockify.*${WEB_PORT}" >/dev/null 2>&1; then
    WEBSOCKIFY_OK=true
  else
    echo "[${TS}] [!] Websockify bridge not running on port ${WEB_PORT}! Restarting..."
    if [ -f "${LAB_DIR}/start-desktop.sh" ]; then
      bash "${LAB_DIR}/start-desktop.sh" >> "${LOG_DIR}/desktop.log" 2>&1 || true
    fi
  fi

  # 4. Supervise sshx session (optional)
  SSHX_URL=""
  if [ -f "${LOG_DIR}/sshx.log" ]; then
    SSHX_URL="$(grep -o 'https://sshx.io/s/[^ ]*' "${LOG_DIR}/sshx.log" 2>/dev/null | tail -n 1 || echo "")"
  fi

  # 5. Emit JSON Heartbeat Status
  cat <<EOF > "${STATUS_FILE}.tmp"
{
  "timestamp": "${TS}",
  "supervisor_pid": $$,
  "agent_running": ${AGENT_OK},
  "desktop_running": ${DESKTOP_OK},
  "websockify_running": ${WEBSOCKIFY_OK},
  "web_port": ${WEB_PORT},
  "vnc_display": "${VNC_DISPLAY}",
  "sshx_url": "${SSHX_URL}"
}
EOF
  mv "${STATUS_FILE}.tmp" "${STATUS_FILE}"

  sleep 10
done
