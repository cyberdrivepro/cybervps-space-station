#!/usr/bin/env sh
# ==============================================================================
# CyberVPS SPACE STATION - Universal Zero-Friction Bootstrap Installer
# Cross-Platform Host Agent Installation & 24/7 Background Service Setup
# Supports: Ubuntu, Debian, CentOS, Fedora, Termux, Non-Root SSH, Daytona
# Official Repository: https://github.com/cyberdrivepro/cybervps-space-station
# ==============================================================================

set -e

SERVER_URL="${1:-${CYBERVPS_SERVER:-https://cybervps-space-station.up.railway.app}}"
TOKEN="${CYBERVPS_TOKEN:-cvps_enroll_master_token}"

REPO_URL="https://github.com/cyberdrivepro/cybervps-space-station.git"
TARBALL_URL="https://github.com/cyberdrivepro/cybervps-space-station/archive/refs/heads/main.tar.gz"
INSTALL_BASE="${HOME}/.cybervps"
INSTALL_DIR="${INSTALL_BASE}/space-station"
BIN_DIR="${INSTALL_BASE}/bin"
RUN_DIR="${INSTALL_BASE}/run"
LOG_DIR="${INSTALL_BASE}/logs"
CONFIG_FILE="${INSTALL_BASE}/config.json"
MID_FILE="${INSTALL_BASE}/machine_id"

echo "================================================================"
echo "🛰️  CYBERVPS SPACE STATION - UNIVERSAL HOST AGENT INSTALLER"
echo "================================================================"

# 1. Environment & Architecture Detection
OS="$(uname -s 2>/dev/null || echo 'Unknown')"
ARCH="$(uname -m 2>/dev/null || echo 'Unknown')"
USER_NAME="$(whoami 2>/dev/null || echo 'user')"
HOSTNAME="$(hostname 2>/dev/null || echo 'node')"

echo "[*] Detected OS: ${OS} (${ARCH}) | Host: ${HOSTNAME} | User: ${USER_NAME}"

# 2. Check Download Tools
DOWNLOAD_TOOL=""
if command -v curl >/dev/null 2>&1; then
  DOWNLOAD_TOOL="curl"
elif command -v wget >/dev/null 2>&1; then
  DOWNLOAD_TOOL="wget"
else
  echo "❌ Error: Neither 'curl' nor 'wget' is available on this system."
  exit 1
fi

fetch_file() {
  url="$1"
  dest="$2"
  if [ "$DOWNLOAD_TOOL" = "curl" ]; then
    curl -fsSL -o "$dest" "$url"
  else
    wget -qO "$dest" "$url"
  fi
}

# 3. Create Directories
mkdir -p "${INSTALL_BASE}" "${BIN_DIR}" "${RUN_DIR}" "${LOG_DIR}"

# 4. Fetch Codebase
if [ -d "${INSTALL_DIR}/.git" ]; then
  echo "[*] Existing installation found in ${INSTALL_DIR}. Updating..."
  cd "${INSTALL_DIR}"
  git fetch origin main >/dev/null 2>&1 || true
  git reset --hard origin/main >/dev/null 2>&1 || true
elif command -v git >/dev/null 2>&1; then
  echo "[*] Cloning repository via Git..."
  rm -rf "${INSTALL_DIR}"
  git clone --depth 1 "${REPO_URL}" "${INSTALL_DIR}"
  cd "${INSTALL_DIR}"
else
  echo "[*] Downloading repository package from GitHub..."
  rm -rf "${INSTALL_DIR}"
  mkdir -p "${INSTALL_DIR}"
  TAR_FILE="${INSTALL_BASE}/cybervps.tar.gz"
  fetch_file "${TARBALL_URL}" "${TAR_FILE}"
  tar -xzf "${TAR_FILE}" -C "${INSTALL_DIR}" --strip-components=1
  rm -f "${TAR_FILE}"
  cd "${INSTALL_DIR}"
fi

# 5. Check Runtime (Python 3 or Node.js)
PY_CMD=""
if command -v python3 >/dev/null 2>&1; then
  PY_CMD="python3"
elif command -v python >/dev/null 2>&1; then
  PY_CMD="python"
fi

NODE_CMD=""
if command -v node >/dev/null 2>&1; then
  NODE_CMD="node"
fi

if [ -z "$PY_CMD" ] && [ -z "$NODE_CMD" ]; then
  echo "❌ Error: Python 3 or Node.js is required to run CyberVPS Agent."
  exit 1
fi

# 6. Persistent Machine ID & Configuration
MACHINE_ID=""
if [ -f "${MID_FILE}" ]; then
  MACHINE_ID="$(cat "${MID_FILE}" | tr -d ' \n\r')"
fi
if [ -z "${MACHINE_ID}" ] && [ -f "${CONFIG_FILE}" ]; then
  MACHINE_ID="$(grep -o '"machine_id": *"[^"]*"' "${CONFIG_FILE}" 2>/dev/null | cut -d'"' -f4 || true)"
fi
if [ -z "${MACHINE_ID}" ]; then
  RAND_HEX="$(od -vN 4 -An -tx1 /dev/urandom 2>/dev/null | tr -d ' \n' || echo '01234567')"
  MACHINE_ID="cvps_${HOSTNAME}_${RAND_HEX}"
fi
echo "${MACHINE_ID}" > "${MID_FILE}"

cat <<EOF > "${CONFIG_FILE}"
{
  "server_url": "${SERVER_URL}",
  "token": "${TOKEN}",
  "machine_id": "${MACHINE_ID}",
  "hostname": "${HOSTNAME}"
}
EOF
echo "[*] Configuration written to ${CONFIG_FILE}"

# 7. Setup CLI in PATH
chmod +x "${INSTALL_DIR}/bin/cybervps"
ln -sf "${INSTALL_DIR}/bin/cybervps" "${BIN_DIR}/cybervps"

SHELL_RC=""
if [ -f "${HOME}/.bashrc" ]; then
  SHELL_RC="${HOME}/.bashrc"
elif [ -f "${HOME}/.zshrc" ]; then
  SHELL_RC="${HOME}/.zshrc"
elif [ -f "${HOME}/.profile" ]; then
  SHELL_RC="${HOME}/.profile"
fi

if [ -n "${SHELL_RC}" ]; then
  if ! grep -q "${BIN_DIR}" "${SHELL_RC}" 2>/dev/null; then
    echo "export PATH=\"${BIN_DIR}:\$PATH\"" >> "${SHELL_RC}"
  fi
fi
export PATH="${BIN_DIR}:${PATH}"

# 8. Configure 24/7 Background Service (systemd or nohup supervisor)
echo "[*] Configuring 24/7 background service..."

SERVICE_MODE="nohup"
if [ "$(id -u)" = "0" ] && [ -d "/etc/systemd/system" ] && command -v systemctl >/dev/null 2>&1; then
  SERVICE_FILE="/etc/systemd/system/cybervps-agent.service"
  cat <<EOF > "${SERVICE_FILE}"
[Unit]
Description=CyberVPS Space Station Host Agent
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=${INSTALL_BASE}
ExecStart=${PY_CMD} ${INSTALL_DIR}/agent/universal-agent.py --config ${CONFIG_FILE}
Restart=always
RestartSec=5s
StandardOutput=append:${LOG_DIR}/agent.log
StandardError=append:${LOG_DIR}/agent.log

[Install]
WantedBy=multi-user.target
EOF
  systemctl daemon-reload
  systemctl enable cybervps-agent.service >/dev/null 2>&1 || true
  systemctl restart cybervps-agent.service >/dev/null 2>&1 || true
  SERVICE_MODE="systemd (root)"
  echo "  ✅ Registered systemd service: ${SERVICE_FILE}"
elif [ -d "${HOME}/.config/systemd/user" ] && command -v systemctl >/dev/null 2>&1; then
  USER_SERVICE="${HOME}/.config/systemd/user/cybervps-agent.service"
  mkdir -p "${HOME}/.config/systemd/user"
  cat <<EOF > "${USER_SERVICE}"
[Unit]
Description=CyberVPS Space Station Host Agent
After=network.target

[Service]
Type=simple
WorkingDirectory=${INSTALL_BASE}
ExecStart=${PY_CMD} ${INSTALL_DIR}/agent/universal-agent.py --config ${CONFIG_FILE}
Restart=always
RestartSec=5s
StandardOutput=append:${LOG_DIR}/agent.log
StandardError=append:${LOG_DIR}/agent.log

[Install]
WantedBy=default.target
EOF
  systemctl --user daemon-reload >/dev/null 2>&1 || true
  systemctl --user enable --now cybervps-agent.service >/dev/null 2>&1 || true
  SERVICE_MODE="systemd (user)"
  echo "  ✅ Registered systemd user service: ${USER_SERVICE}"
else
  # Background supervisor via nohup and crontab @reboot
  pkill -f "universal-agent.py" >/dev/null 2>&1 || true
  nohup ${PY_CMD} -u "${INSTALL_DIR}/agent/universal-agent.py" --config "${CONFIG_FILE}" >> "${LOG_DIR}/agent.log" 2>&1 &
  AGENT_PID=$!
  echo "${AGENT_PID}" > "${RUN_DIR}/agent.pid"
  SERVICE_MODE="background daemon (PID ${AGENT_PID})"

  # Setup crontab autostart if available
  if command -v crontab >/dev/null 2>&1; then
    (crontab -l 2>/dev/null | grep -v "universal-agent.py" || true; echo "@reboot ${PY_CMD} -u ${INSTALL_DIR}/agent/universal-agent.py --config ${CONFIG_FILE} >> ${LOG_DIR}/agent.log 2>&1 &") | crontab - >/dev/null 2>&1 || true
  fi
fi

# 9. Verify Enrollment with Central Backend
echo "[*] Waiting for fleet enrollment confirmation (up to 20s)..."

ENROLLED=0
for i in $(seq 1 10); do
  sleep 2
  if [ "$DOWNLOAD_TOOL" = "curl" ]; then
    ENROLL_CHECK="$(curl --connect-timeout 3 --max-time 6 -fsSL "${SERVER_URL}/api/v1/machines" 2>/dev/null || true)"
  else
    ENROLL_CHECK="$(wget -T 6 -t 1 -qO- "${SERVER_URL}/api/v1/machines" 2>/dev/null || true)"
  fi

  if echo "${ENROLL_CHECK}" | grep -q "${MACHINE_ID}"; then
    ENROLLED=1
    break
  fi
  printf "."
done
echo ""

if [ "$ENROLLED" -eq 1 ]; then
  echo "  ✅ Fleet enrollment verified: Machine [${MACHINE_ID}] is ONLINE!"
  BACKEND_STATUS="Connected & Verified ✅"
else
  echo "  ⚠️ Fleet enrollment NOT verified within 20s."
  echo "  👉 Recent agent logs:"
  tail -n 15 "${LOG_DIR}/agent.log" 2>/dev/null || true
  echo "  👉 To inspect logs manually: tail -f ~/.cybervps/logs/agent.log"
  echo "  👉 To restart agent: cybervps restart"
  BACKEND_STATUS="Enrollment Pending / Check Logs ⚠️"
fi

echo ""
echo "================================================================"
echo "🛰️  CYBERVPS HOST AGENT - SETUP COMPLETE"
echo "================================================================"
echo "Host:        ${HOSTNAME} (${OS} ${ARCH})"
echo "Backend:     ${SERVER_URL} (${BACKEND_STATUS})"
echo "Service:     Running 24/7 in Background (${SERVICE_MODE})"
echo "Startup:     Automatic on Reboot"
echo "Machine ID:  ${MACHINE_ID}"
echo "Dashboard:   https://cyberdrivepro.github.io/cybervps-space-station/"
echo "================================================================"
if [ "$ENROLLED" -eq 1 ]; then
  echo "🎉 Setup complete! You can safely close this terminal/SSH session."
  echo "👉 The Host Agent is running silently in the background 24/7."
else
  echo "⚠️ Installation completed, but agent is still completing first heartbeat."
  echo "👉 Check status in a few seconds: cybervps status"
fi
echo "👉 Monitor and control this machine at:"
echo "   https://cyberdrivepro.github.io/cybervps-space-station/"
echo "================================================================"
