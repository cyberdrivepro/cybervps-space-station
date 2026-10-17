#!/usr/bin/env bash
# ==============================================================================
# CYBERVPS SPACE STATION — REPLIT VPS LAB BROWSER LAUNCHER
# ==============================================================================
# Launches an unprivileged web browser inside the virtual X11 display.
# ==============================================================================

set -e

VNC_DISPLAY="${DISPLAY:-:1}"
TARGET_URL="${1:-http://localhost:8080/vnc.html}"
LOG_DIR="${HOME}/.cybervps/logs"

mkdir -p "${LOG_DIR}"

echo "[*] Launching web browser on display ${VNC_DISPLAY} -> ${TARGET_URL}..."

BROWSER_CMD=""
if command -v chromium >/dev/null 2>&1; then
  BROWSER_CMD="chromium --no-sandbox --disable-dev-shm-usage --disable-gpu"
elif command -v google-chrome >/dev/null 2>&1; then
  BROWSER_CMD="google-chrome --no-sandbox --disable-dev-shm-usage"
elif command -v firefox >/dev/null 2>&1; then
  BROWSER_CMD="firefox"
elif command -v surf >/dev/null 2>&1; then
  BROWSER_CMD="surf"
elif command -v midori >/dev/null 2>&1; then
  BROWSER_CMD="midori"
fi

if [ -z "${BROWSER_CMD}" ]; then
  echo "⚠️ No supported web browser binary found (chromium, firefox, surf, midori)."
  exit 1
fi

DISPLAY="${VNC_DISPLAY}" nohup ${BROWSER_CMD} "${TARGET_URL}" > "${LOG_DIR}/browser.log" 2>&1 &
echo "✅ Browser process launched on ${VNC_DISPLAY}."
