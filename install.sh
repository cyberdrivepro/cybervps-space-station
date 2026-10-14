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
  PY_CMD="$(command -v python3)"
elif command -v python >/dev/null 2>&1; then
  PY_CMD="$(command -v python)"
fi

NODE_CMD=""
if command -v node >/dev/null 2>&1; then
  NODE_CMD="$(command -v node)"
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
chmod +x "${INSTALL_DIR}/bin/cybervps"* 2>/dev/null || true
ln -sf "${INSTALL_DIR}/bin/cybervps" "${BIN_DIR}/cybervps"

# Symlink into system-wide standard PATH locations if root or writable
if [ "$(id -u)" = "0" ] || [ -w "/usr/local/bin" ]; then
  mkdir -p /usr/local/bin 2>/dev/null || true
  ln -sf "${INSTALL_DIR}/bin/cybervps" "/usr/local/bin/cybervps" 2>/dev/null || true
fi
if [ "$(id -u)" = "0" ] || [ -w "/usr/bin" ]; then
  ln -sf "${INSTALL_DIR}/bin/cybervps" "/usr/bin/cybervps" 2>/dev/null || true
fi

# Append to all present shell rc files (so bash, zsh, and profile have it)
for rc in "${HOME}/.bashrc" "${HOME}/.zshrc" "${HOME}/.profile"; do
  if [ -f "$rc" ] || [ "$rc" = "${HOME}/.bashrc" ]; then
    if ! grep -q "${BIN_DIR}" "$rc" 2>/dev/null; then
      echo "export PATH=\"${BIN_DIR}:\$PATH\"" >> "$rc"
    fi
  fi
done
export PATH="${BIN_DIR}:/usr/local/bin:${PATH}"
hash -r 2>/dev/null || rehash 2>/dev/null || true

# 8. Configure 24/7 Background Service (Single Clean Supervision Mechanism)
echo "[*] Configuring 24/7 background service..."

# Stop any pre-existing agent processes to ensure clean restart without PID collisions
pkill -f "universal-agent.py" >/dev/null 2>&1 || true
rm -f "${RUN_DIR}/agent.pid" 2>/dev/null || true

SERVICE_MODE="nohup"
SYSTEMD_CONFIGURED=0

if [ "$(id -u)" = "0" ] && [ -d "/etc/systemd/system" ] && command -v systemctl >/dev/null 2>&1; then
  SERVICE_FILE="/etc/systemd/system/cybervps-agent.service"
  cat <<EOF > "${SERVICE_FILE}"
[Unit]
Description=CyberVPS Space Station Host Agent
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=root
WorkingDirectory=${INSTALL_BASE}
ExecStart=${PY_CMD} -u ${INSTALL_DIR}/agent/universal-agent.py --config ${CONFIG_FILE} --log-dir ${LOG_DIR}
Restart=always
RestartSec=3s
LimitNOFILE=65535
StandardOutput=append:${LOG_DIR}/agent.log
StandardError=append:${LOG_DIR}/agent.log

[Install]
WantedBy=multi-user.target
EOF
  if systemctl daemon-reload >/dev/null 2>&1 && \
     systemctl enable cybervps-agent.service >/dev/null 2>&1 && \
     systemctl restart cybervps-agent.service >/dev/null 2>&1 && \
     sleep 1 && \
     systemctl is-active --quiet cybervps-agent.service 2>/dev/null; then
    SYSTEMD_CONFIGURED=1
    SERVICE_MODE="systemd (root)"
    # Remove redundant crontab entry so there is only one supervisor
    if command -v crontab >/dev/null 2>&1; then
      (crontab -l 2>/dev/null | grep -v "universal-agent.py" || true) | crontab - >/dev/null 2>&1 || true
    fi
    echo "  ✅ Registered and activated systemd service (Single mechanism): ${SERVICE_FILE}"
  else
    echo "  ⚠️ systemd root service could not be activated in this environment."
    echo "     Falling back to background supervisor (nohup + crontab @reboot)."
    systemctl disable cybervps-agent.service >/dev/null 2>&1 || true
    rm -f "${SERVICE_FILE}" 2>/dev/null || true
  fi
else
  # Non-root installation: check if systemd user unit + linger is truly supported
  HAS_USER_SYSTEMD=0
  HAS_LINGER=0
  if command -v systemctl >/dev/null 2>&1 && systemctl --user list-units >/dev/null 2>&1; then
    HAS_USER_SYSTEMD=1
  fi

  if command -v loginctl >/dev/null 2>&1; then
    loginctl enable-linger "${USER}" >/dev/null 2>&1 || true
    if loginctl show-user "${USER}" --property=Linger 2>/dev/null | grep -qi "Linger=yes"; then
      HAS_LINGER=1
    elif [ -f "/var/lib/systemd/linger/${USER}" ]; then
      HAS_LINGER=1
    fi
  fi

  if [ "$HAS_USER_SYSTEMD" -eq 1 ] && [ "$HAS_LINGER" -eq 1 ]; then
    USER_SERVICE_DIR="${HOME}/.config/systemd/user"
    USER_SERVICE="${USER_SERVICE_DIR}/cybervps-agent.service"
    mkdir -p "${USER_SERVICE_DIR}"
    cat <<EOF > "${USER_SERVICE}"
[Unit]
Description=CyberVPS Space Station Host Agent (User Service)
After=network.target

[Service]
Type=simple
WorkingDirectory=${INSTALL_BASE}
ExecStart=${PY_CMD} -u ${INSTALL_DIR}/agent/universal-agent.py --config ${CONFIG_FILE} --log-dir ${LOG_DIR}
Restart=always
RestartSec=3s
StandardOutput=append:${LOG_DIR}/agent.log
StandardError=append:${LOG_DIR}/agent.log

[Install]
WantedBy=default.target
EOF
    if systemctl --user daemon-reload >/dev/null 2>&1 && \
       systemctl --user enable --now cybervps-agent.service >/dev/null 2>&1 && \
       systemctl --user is-active --quiet cybervps-agent.service 2>/dev/null; then
      SYSTEMD_CONFIGURED=1
      SERVICE_MODE="systemd (user linger)"
      # Remove redundant crontab entry so there is only one supervisor
      if command -v crontab >/dev/null 2>&1; then
        (crontab -l 2>/dev/null | grep -v "universal-agent.py" || true) | crontab - >/dev/null 2>&1 || true
      fi
      echo "  ✅ Registered and activated systemd user service with 24/7 linger (Single mechanism): ${USER_SERVICE}"
    else
      echo "  ⚠️ systemd user service could not be activated in this session."
      echo "     Falling back to background daemon + crontab @reboot."
      systemctl --user stop cybervps-agent.service >/dev/null 2>&1 || true
      systemctl --user disable cybervps-agent.service >/dev/null 2>&1 || true
      rm -f "${USER_SERVICE}" 2>/dev/null || true
    fi
  fi
fi

if [ "$SYSTEMD_CONFIGURED" -eq 0 ]; then
  # Background supervisor via nohup and crontab @reboot (Single fallback mechanism)
  pkill -f "universal-agent.py" >/dev/null 2>&1 || true
  nohup ${PY_CMD} -u "${INSTALL_DIR}/agent/universal-agent.py" --config "${CONFIG_FILE}" --log-dir "${LOG_DIR}" >> "${LOG_DIR}/agent.log" 2>&1 &
  AGENT_PID=$!
  echo "${AGENT_PID}" > "${RUN_DIR}/agent.pid"
  SERVICE_MODE="background daemon (PID ${AGENT_PID})"

  if command -v crontab >/dev/null 2>&1; then
    (crontab -l 2>/dev/null | grep -v "universal-agent.py" || true; echo "@reboot ${PY_CMD} -u ${INSTALL_DIR}/agent/universal-agent.py --config ${CONFIG_FILE} --log-dir ${LOG_DIR} >> ${LOG_DIR}/agent.log 2>&1 &") | crontab - >/dev/null 2>&1 || true
    echo "  ✅ Registered crontab @reboot autostart (Single mechanism)."
  fi
fi

# 9. Verify Enrollment with Central Backend
echo "[*] Connecting and registering host with control plane..."

# Send immediate Auth registration from installer non-blocking in background
if [ "$DOWNLOAD_TOOL" = "curl" ]; then
  (curl -4 --connect-timeout 2 --max-time 4 -s -X POST -H "Content-Type: application/json" -H "X-Machine-ID: ${MACHINE_ID}" -H "X-Enrollment-Token: ${TOKEN}" \
    -d "{\"type\":\"Auth\",\"payload\":{\"machine_id\":\"${MACHINE_ID}\",\"token\":\"${TOKEN}\",\"hostname\":\"${HOSTNAME}\",\"username\":\"${USER_NAME}\",\"os\":\"${OS}\",\"arch\":\"${ARCH}\"}}" \
    "${SERVER_URL}/api/v1/relay/event" >/dev/null 2>&1 || \
   curl --connect-timeout 2 --max-time 4 -s -X POST -H "Content-Type: application/json" -H "X-Machine-ID: ${MACHINE_ID}" -H "X-Enrollment-Token: ${TOKEN}" \
    -d "{\"type\":\"Auth\",\"payload\":{\"machine_id\":\"${MACHINE_ID}\",\"token\":\"${TOKEN}\",\"hostname\":\"${HOSTNAME}\",\"username\":\"${USER_NAME}\",\"os\":\"${OS}\",\"arch\":\"${ARCH}\"}}" \
    "${SERVER_URL}/api/v1/relay/event" >/dev/null 2>&1 || true) &
elif [ "$DOWNLOAD_TOOL" = "wget" ]; then
  (wget -T 4 -t 1 -qO- --post-data="{\"type\":\"Auth\",\"payload\":{\"machine_id\":\"${MACHINE_ID}\",\"token\":\"${TOKEN}\",\"hostname\":\"${HOSTNAME}\",\"username\":\"${USER_NAME}\",\"os\":\"${OS}\",\"arch\":\"${ARCH}\"}}" \
    --header="Content-Type: application/json" --header="X-Machine-ID: ${MACHINE_ID}" --header="X-Enrollment-Token: ${TOKEN}" \
    "${SERVER_URL}/api/v1/relay/event" >/dev/null 2>&1 || true) &
fi

echo "[*] Waiting for fleet enrollment confirmation (up to 20s)..."

ENROLLED=0
for i in $(seq 1 10); do
  sleep 1.5
  if [ "$DOWNLOAD_TOOL" = "curl" ]; then
    ENROLL_CHECK="$(curl -4 --connect-timeout 2 --max-time 3 -fsSL "${SERVER_URL}/api/v1/machines" 2>/dev/null || curl --connect-timeout 2 --max-time 3 -fsSL "${SERVER_URL}/api/v1/machines" 2>/dev/null || true)"
  else
    ENROLL_CHECK="$(wget -T 3 -t 1 -qO- "${SERVER_URL}/api/v1/machines" 2>/dev/null || true)"
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
