#!/usr/bin/env bash
# ==============================================================================
# CYBERVPS SPACE STATION — REPLIT VPS LAB DESKTOP LAUNCHER
# ==============================================================================
# Starts TigerVNC server on display :1 and bridges RFB to noVNC via websockify.
# ==============================================================================

set -e

INSTALL_BASE="${HOME}/.cybervps"
LAB_DIR="${INSTALL_BASE}/replit"
LOG_DIR="${INSTALL_BASE}/logs"
NOVNC_DIR="${LAB_DIR}/novnc"
WEB_PORT="${PORT:-8080}"
VNC_DISPLAY=":1"
VNC_PORT="5901"

mkdir -p "${LOG_DIR}"

echo "[*] Initializing graphical desktop session on display ${VNC_DISPLAY}..."

# 1. Clean up stale locks
rm -f /tmp/.X1-lock /tmp/.X11-unix/X1 "${HOME}/.vnc/"*:"${VNC_DISPLAY:1}".pid 2>/dev/null || true

# 2. Check and start TigerVNC
if ! pgrep -f "Xvnc.*${VNC_DISPLAY}" >/dev/null 2>&1 && ! pgrep -f "Xtigervnc.*${VNC_DISPLAY}" >/dev/null 2>&1; then
  echo "  [+] Starting VNC server on ${VNC_DISPLAY} (127.0.0.1:${VNC_PORT})..."
  if command -v vncserver >/dev/null 2>&1; then
    vncserver "${VNC_DISPLAY}" -geometry 1280x720 -depth 24 -localhost yes -SecurityTypes None > "${LOG_DIR}/vncserver.log" 2>&1 || {
      # Fallback to direct Xvfb or Xvnc if vncserver wrapper wrapper fails
      echo "  [*] Fallback to Xvnc direct invocation..."
      Xvnc "${VNC_DISPLAY}" -geometry 1280x720 -depth 24 -rfbport "${VNC_PORT}" -SecurityTypes None > "${LOG_DIR}/vncserver.log" 2>&1 &
    }
  elif command -v Xvnc >/dev/null 2>&1; then
    Xvnc "${VNC_DISPLAY}" -geometry 1280x720 -depth 24 -rfbport "${VNC_PORT}" -SecurityTypes None > "${LOG_DIR}/vncserver.log" 2>&1 &
  fi
  sleep 1
else
  echo "  [ℹ️] VNC server already active on ${VNC_DISPLAY}."
fi

# 3. Ensure Openbox window manager is running on the display
if ! DISPLAY="${VNC_DISPLAY}" pgrep -f "openbox" >/dev/null 2>&1; then
  if command -v openbox >/dev/null 2>&1; then
    echo "  [+] Launching Openbox window manager on display ${VNC_DISPLAY}..."
    DISPLAY="${VNC_DISPLAY}" nohup openbox > "${LOG_DIR}/openbox.log" 2>&1 &
  fi
fi

# 4. Check and start websockify bridge
if ! pgrep -f "websockify.*${WEB_PORT}" >/dev/null 2>&1; then
  echo "  [+] Starting websockify bridge on port ${WEB_PORT} -> 127.0.0.1:${VNC_PORT}..."
  WEB_ARG=""
  if [ -d "${NOVNC_DIR}" ] && [ -f "${NOVNC_DIR}/vnc.html" ]; then
    WEB_ARG="--web ${NOVNC_DIR}"
  elif [ -d "/usr/share/novnc" ]; then
    WEB_ARG="--web /usr/share/novnc"
  fi

  nohup websockify ${WEB_ARG} "${WEB_PORT}" "127.0.0.1:${VNC_PORT}" > "${LOG_DIR}/websockify.log" 2>&1 &
  sleep 1
else
  echo "  [ℹ️] Websockify bridge already listening on port ${WEB_PORT}."
fi

echo "  ✅ Desktop environment ready: http://localhost:${WEB_PORT}/vnc.html"
