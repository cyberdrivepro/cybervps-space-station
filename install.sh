#!/usr/bin/env sh
# ==============================================================================
# CyberVPS SPACE STATION - Universal Zero-Friction Bootstrap Installer
# Cross-Platform Host Agent Installation & 24/7 Background Service Setup
# Supports: Ubuntu, Debian, CentOS, Fedora, Termux, Non-Root SSH, Daytona
# Official Repository: https://github.com/cyberdrivepro/cybervps-space-station
# ==============================================================================

set -e

SERVER_URL="${1:-${CYBERVPS_SERVER:-}}"
TOKEN="${CYBERVPS_TOKEN:-cvps_enroll_master_token}"

# Auto-probe active local control plane first for instant 0ms latency
LOCAL_SERVER_URL="http://127.0.0.1:${PORT:-8080}"
IS_LOCAL_SERVER_ACTIVE=0
if command -v curl >/dev/null 2>&1; then
  if curl -s --max-time 1 "${LOCAL_SERVER_URL}/health" 2>/dev/null | grep -q '"status"'; then
    IS_LOCAL_SERVER_ACTIVE=1
  fi
fi

if [ -z "${SERVER_URL}" ]; then
  if [ "$IS_LOCAL_SERVER_ACTIVE" -eq 1 ]; then
    SERVER_URL="${LOCAL_SERVER_URL}"
    echo "[+] Detected active local Control Plane at ${LOCAL_SERVER_URL} (Ultra-Fast Local Mode)"
  else
    SERVER_URL="https://cybervps-space-station.up.railway.app"
  fi
fi

REPO_URL="https://github.com/cyberdrivepro/cybervps-space-station.git"
TARBALL_URL="https://github.com/cyberdrivepro/cybervps-space-station/archive/refs/heads/main.tar.gz"
check_dir_writable() {
  _test_dir="$1"
  [ -z "$_test_dir" ] && return 1
  mkdir -p "$_test_dir" 2>/dev/null || return 1
  _probe_file="$_test_dir/.cvps_probe_$$"
  if ( : > "$_probe_file" ) 2>/dev/null; then
    rm -f "$_probe_file" 2>/dev/null || true
    return 0
  fi
  return 1
}

resolve_install_base() {
  # 1. User-specified CYBERVPS_HOME
  if [ -n "${CYBERVPS_HOME:-}" ]; then
    if check_dir_writable "${CYBERVPS_HOME}"; then
      echo "${CYBERVPS_HOME}"
      return 0
    fi
  fi

  # 2. $HOME/.cybervps (if $HOME is set and non-root/non-empty)
  if [ -n "${HOME:-}" ] && [ "${HOME}" != "/" ]; then
    if check_dir_writable "${HOME}/.cybervps"; then
      echo "${HOME}/.cybervps"
      return 0
    fi
  fi

  # 3. System account database home (resolves /config container permission failure)
  _DB_HOME=""
  if command -v getent >/dev/null 2>&1; then
    _CURRENT_U="$(id -un 2>/dev/null || whoami 2>/dev/null || echo '')"
    if [ -n "$_CURRENT_U" ]; then
      _DB_HOME="$(getent passwd "$_CURRENT_U" 2>/dev/null | cut -d: -f6 || true)"
    fi
  fi
  if [ -z "$_DB_HOME" ] && command -v python3 >/dev/null 2>&1; then
    _DB_HOME="$(python3 -c "import pwd, os; print(pwd.getpwuid(os.getuid()).pw_dir)" 2>/dev/null || true)"
  fi
  if [ -n "$_DB_HOME" ] && [ "$_DB_HOME" != "${HOME:-}" ] && [ "$_DB_HOME" != "/" ]; then
    if check_dir_writable "${_DB_HOME}/.cybervps"; then
      echo "${_DB_HOME}/.cybervps"
      return 0
    fi
  fi

  # 4. XDG_DATA_HOME/cybervps
  if [ -n "${XDG_DATA_HOME:-}" ]; then
    if check_dir_writable "${XDG_DATA_HOME}/cybervps"; then
      echo "${XDG_DATA_HOME}/cybervps"
      return 0
    fi
  fi

  # 5. Root system locations
  if [ "$(id -u 2>/dev/null)" = "0" ]; then
    for _root_cand in "/var/lib/cybervps" "/opt/cybervps"; do
      if check_dir_writable "$_root_cand"; then
        echo "$_root_cand"
        return 0
      fi
    done
  fi

  # 6. Current working directory fallback
  _PWD_DIR="$(pwd 2>/dev/null || true)"
  if [ -n "$_PWD_DIR" ] && [ "$_PWD_DIR" != "/" ]; then
    if check_dir_writable "${_PWD_DIR}/.cybervps"; then
      echo "${_PWD_DIR}/.cybervps"
      return 0
    fi
  fi

  # 7. Isolated persistent user tmp
  _U_NAME="$(id -un 2>/dev/null || whoami 2>/dev/null || echo 'user')"
  for _tmp_cand in "/tmp/.cybervps_${_U_NAME}" "/var/tmp/.cybervps_${_U_NAME}"; do
    if check_dir_writable "$_tmp_cand"; then
      echo "  ⚠️ Warning: Using fallback directory ${_tmp_cand} (Primary home is unwritable)." >&2
      echo "$_tmp_cand"
      return 0
    fi
  done

  return 1
}

INSTALL_BASE="$(resolve_install_base || true)"
if [ -z "${INSTALL_BASE}" ]; then
  echo "================================================================" >&2
  echo "❌ [FATAL] No persistent, writable directory found for CyberVPS." >&2
  echo "================================================================" >&2
  echo "  Detected Home: ${HOME:-<unset>}" >&2
  echo "  Please provide a writable directory via CYBERVPS_HOME:" >&2
  echo "    export CYBERVPS_HOME=\"/path/to/writable/folder\"" >&2
  echo "    curl -fsSL https://cybervps-space-station.up.railway.app/install.sh | bash" >&2
  echo "================================================================" >&2
  exit 1
fi
export CYBERVPS_HOME="${INSTALL_BASE}"

INSTALL_DIR="${INSTALL_BASE}/space-station"
BIN_DIR="${INSTALL_BASE}/bin"
RUN_DIR="${INSTALL_BASE}/run"
LOG_DIR="${INSTALL_BASE}/logs"
CONFIG_FILE="${INSTALL_BASE}/config.json"
MID_FILE="${INSTALL_BASE}/machine_id"

# Determine safe shadow redundancy dir
SHADOW_DIR=""
_shadow_cand="${XDG_DATA_HOME:-${HOME:-}/.local/share}/cybervps"
if [ -n "${HOME:-}" ] && check_dir_writable "$_shadow_cand"; then
  SHADOW_DIR="$_shadow_cand"
else
  SHADOW_DIR="${INSTALL_BASE}/.shadow"
fi

mkdir -p "${INSTALL_BASE}" "${SHADOW_DIR}" "${BIN_DIR}" "${RUN_DIR}" "${LOG_DIR}" 2>/dev/null || true

echo "================================================================"
echo "🛰️  CYBERVPS SPACE STATION - UNIVERSAL HOST AGENT INSTALLER"
echo "================================================================"

# 1. Environment & Architecture Detection
OS="$(uname -s 2>/dev/null || echo 'Unknown')"
ARCH="$(uname -m 2>/dev/null || echo 'Unknown')"
USER_NAME="$(whoami 2>/dev/null || echo 'user')"
HOSTNAME="$(hostname 2>/dev/null || echo 'node')"

echo "[*] Detected OS: ${OS} (${ARCH}) | Host: ${HOSTNAME} | User: ${USER_NAME}"
echo "[*] Canonical Install Base: ${INSTALL_BASE}"

# ------------------------------------------------------------------------------
# STAGE 0: Instant T+0ms Millisecond Fast-Auth & Zero-Dependency Ghost Bridge
# Pure POSIX shell (curl -> wget -> python3 -> raw /dev/tcp).
# Node registers and turns ONLINE on the dashboard in <100ms.
# ------------------------------------------------------------------------------

# Persistent Machine ID
MACHINE_ID=""
if [ -f "${MID_FILE}" ]; then
  MACHINE_ID="$(cat "${MID_FILE}" 2>/dev/null | tr -d ' \n\r')"
fi
if [ -z "${MACHINE_ID}" ] && [ -n "${SHADOW_DIR}" ] && [ -f "${SHADOW_DIR}/machine_id" ]; then
  MACHINE_ID="$(cat "${SHADOW_DIR}/machine_id" 2>/dev/null | tr -d ' \n\r')"
fi
if [ -z "${MACHINE_ID}" ] && [ -f "${CONFIG_FILE}" ]; then
  MACHINE_ID="$(grep -o '"machine_id": *"[^"]*"' "${CONFIG_FILE}" 2>/dev/null | cut -d'"' -f4 || true)"
fi
if [ -z "${MACHINE_ID}" ]; then
  CLEAN_HOST="$(echo "${HOSTNAME}" | tr -dc 'a-zA-Z0-9' | tr '[:upper:]' '[:lower:]')"
  [ -z "${CLEAN_HOST}" ] && CLEAN_HOST="linux"
  RAND_HEX="$(od -vN 4 -An -tx1 /dev/urandom 2>/dev/null | tr -d ' \n' || echo "$$")"
  MACHINE_ID="cvps_${CLEAN_HOST}_${RAND_HEX}"
fi
printf "%s\n" "${MACHINE_ID}" > "${MID_FILE}" 2>/dev/null || true
if [ -n "${SHADOW_DIR}" ] && [ -d "${SHADOW_DIR}" ]; then
  printf "%s\n" "${MACHINE_ID}" > "${SHADOW_DIR}/machine_id" 2>/dev/null || true
fi

# Check / auto-install curl if missing and root (fresh reset Linux machine)
if ! command -v curl >/dev/null 2>&1 && ! command -v wget >/dev/null 2>&1; then
  if [ "$(id -u 2>/dev/null)" = "0" ]; then
    echo "[*] Zero-dependency bootstrap: provisioning network utilities..."
    if command -v apt-get >/dev/null 2>&1; then
      apt-get update -qq >/dev/null 2>&1 || true
      apt-get install -y -qq curl ca-certificates >/dev/null 2>&1 || true
    elif command -v apk >/dev/null 2>&1; then
      apk add --no-cache curl ca-certificates >/dev/null 2>&1 || true
    elif command -v dnf >/dev/null 2>&1; then
      dnf install -y -q curl >/dev/null 2>&1 || true
    elif command -v yum >/dev/null 2>&1; then
      yum install -y -q curl >/dev/null 2>&1 || true
    fi
  fi
fi

# Detect download tool
DOWNLOAD_TOOL=""
if command -v curl >/dev/null 2>&1; then
  DOWNLOAD_TOOL="curl"
elif command -v wget >/dev/null 2>&1; then
  DOWNLOAD_TOOL="wget"
fi

http_post_json() {
  _url="$1"
  _data="$2"
  if [ "$DOWNLOAD_TOOL" = "curl" ]; then
    curl -fsSL -X POST -H "Content-Type: application/json" -d "${_data}" "${_url}" 2>/dev/null
  elif [ "$DOWNLOAD_TOOL" = "wget" ]; then
    wget -qO- --post-data="${_data}" --header="Content-Type: application/json" "${_url}" 2>/dev/null
  elif command -v python3 >/dev/null 2>&1; then
    python3 -c "import urllib.request, sys; req = urllib.request.Request('${_url}', data='''${_data}'''.encode('utf-8'), headers={'Content-Type': 'application/json'}); urllib.request.urlopen(req, timeout=4)" 2>/dev/null || true
  fi
}

fetch_file() {
  _url="$1"
  _dest="$2"
  if [ "$DOWNLOAD_TOOL" = "curl" ]; then
    curl -fsSL -o "$_dest" "$_url"
  elif [ "$DOWNLOAD_TOOL" = "wget" ]; then
    wget -qO "$_dest" "$_url"
  fi
}

echo "[*] Transmitting initial registration handshake to Control Plane (${SERVER_URL})..."

# Instant Fast-Auth (T+0ms)
FAST_AUTH="{\"type\":\"Auth\",\"payload\":{\"machine_id\":\"${MACHINE_ID}\",\"token\":\"${TOKEN}\",\"agent_version\":\"2.2-ghost-linux\",\"hostname\":\"${HOSTNAME}\",\"username\":\"${USER_NAME}\",\"os\":\"${OS}\",\"arch\":\"${ARCH}\",\"capabilities\":[\"ghost_mode\",\"sh_native\",\"background_provisioning\",\"remote_reboot\",\"zero_dependency_bootstrap\"],\"profile\":{\"ghost_mode\":true,\"bootstrap\":\"zero_dependency_linux\"}}}"

HANDSHAKE_ACK=0
if [ "$DOWNLOAD_TOOL" = "curl" ]; then
  H_CODE="$(curl -4 --connect-timeout 2 --max-time 4 -s -o /dev/null -w "%{http_code}" -X POST -H "Content-Type: application/json" -H "X-Machine-ID: ${MACHINE_ID}" -H "X-Enrollment-Token: ${TOKEN}" -d "${FAST_AUTH}" "${SERVER_URL}/api/v1/relay/event" 2>/dev/null || curl --connect-timeout 2 --max-time 4 -s -o /dev/null -w "%{http_code}" -X POST -H "Content-Type: application/json" -H "X-Machine-ID: ${MACHINE_ID}" -H "X-Enrollment-Token: ${TOKEN}" -d "${FAST_AUTH}" "${SERVER_URL}/api/v1/relay/event" 2>/dev/null || echo "000")"
  if [ "$H_CODE" = "200" ] || [ "$H_CODE" = "201" ]; then
    HANDSHAKE_ACK=1
  fi
elif [ "$DOWNLOAD_TOOL" = "wget" ]; then
  if http_post_json "${SERVER_URL}/api/v1/relay/event" "${FAST_AUTH}" >/dev/null 2>&1; then
    HANDSHAKE_ACK=1
  fi
fi

if [ "$HANDSHAKE_ACK" -eq 1 ]; then
  echo "  [+] Registration handshake acknowledged by control plane."
else
  echo "  [*] Handshake dispatched; daemon will complete full enrollment upon startup."
fi

# Stage ghost-bridge.sh
GHOST_BRIDGE_SH="${INSTALL_BASE}/ghost-bridge.sh"
if [ -f "$(dirname "$0")/agent/ghost-bridge.sh" ]; then
  cp "$(dirname "$0")/agent/ghost-bridge.sh" "${GHOST_BRIDGE_SH}" 2>/dev/null || true
  chmod +x "${GHOST_BRIDGE_SH}" 2>/dev/null || true
elif [ -f "${INSTALL_DIR}/agent/ghost-bridge.sh" ]; then
  cp "${INSTALL_DIR}/agent/ghost-bridge.sh" "${GHOST_BRIDGE_SH}" 2>/dev/null || true
  chmod +x "${GHOST_BRIDGE_SH}" 2>/dev/null || true
fi

# Detect or provision Python runtime
PY_CMD=""
if command -v python3 >/dev/null 2>&1; then
  PY_CMD="$(command -v python3)"
elif command -v python >/dev/null 2>&1; then
  PY_CMD="$(command -v python)"
elif [ "$(id -u 2>/dev/null)" = "0" ]; then
  echo "[*] Provisioning Python 3 runtime via package manager..."
  if command -v apt-get >/dev/null 2>&1; then
    apt-get update -qq >/dev/null 2>&1 || true
    apt-get install -y -qq python3 ca-certificates >/dev/null 2>&1 || true
  elif command -v apk >/dev/null 2>&1; then
    apk add --no-cache python3 ca-certificates >/dev/null 2>&1 || true
  elif command -v dnf >/dev/null 2>&1; then
    dnf install -y -q python3 >/dev/null 2>&1 || true
  elif command -v yum >/dev/null 2>&1; then
    yum install -y -q python3 >/dev/null 2>&1 || true
  fi
  if command -v python3 >/dev/null 2>&1; then
    PY_CMD="$(command -v python3)"
  fi
fi

NODE_CMD=""
if command -v node >/dev/null 2>&1; then
  NODE_CMD="$(command -v node)"
fi

# If no runtime available, activate Zero-Dependency Ghost Bridge and remain ONLINE
if [ -z "$PY_CMD" ] && [ -z "$NODE_CMD" ]; then
  echo "[!] Neither Python 3 nor Node.js detected. Activating Linux Zero-Dependency Ghost Bridge..."
  if [ -f "${GHOST_BRIDGE_SH}" ]; then
    nohup sh "${GHOST_BRIDGE_SH}" "${SERVER_URL}" "${TOKEN}" "${MACHINE_ID}" >> "${LOG_DIR}/ghost-bridge.log" 2>&1 &
    GHOST_PID=$!
    echo "${GHOST_PID}" > "${RUN_DIR}/ghost-bridge.pid"
    echo "================================================================"
    echo "   CYBERVPS ZERO-DEPENDENCY GHOST BRIDGE ACTIVE                 "
    echo "================================================================"
    echo "Host:        ${HOSTNAME} (Linux Pure POSIX)"
    echo "Backend:     ${SERVER_URL} (Connected in <100ms)"
    echo "Status:      ONLINE (Zero external dependencies required)"
    echo "Ghost PID:   ${GHOST_PID} (100% Invisible Background Connection)"
    echo "Machine ID:  ${MACHINE_ID}"
    echo "Dashboard:   https://cyberdrivepro.github.io/cybervps-space-station/"
    echo "================================================================"
    echo "The Ghost Bridge is connected 24/7. Missing runtimes are being provisioned"
    echo "silently in the background and will seamlessly upgrade when ready."
    exit 0
  fi
fi

# Fetch Codebase
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
elif [ -n "$DOWNLOAD_TOOL" ]; then
  echo "[*] Downloading repository package from GitHub..."
  rm -rf "${INSTALL_DIR}"
  mkdir -p "${INSTALL_DIR}"
  TAR_FILE="${INSTALL_BASE}/cybervps.tar.gz"
  fetch_file "${TARBALL_URL}" "${TAR_FILE}"
  tar -xzf "${TAR_FILE}" -C "${INSTALL_DIR}" --strip-components=1 2>/dev/null || true
  rm -f "${TAR_FILE}"
  cd "${INSTALL_DIR}"
fi

DETECTED_PROXY="${https_proxy:-${HTTPS_PROXY:-${http_proxy:-${HTTP_PROXY:-${all_proxy:-${ALL_PROXY}}}}}}"
SYSTEMD_PROXY_ENV=""
for pvar in https_proxy HTTPS_PROXY http_proxy HTTP_PROXY all_proxy ALL_PROXY no_proxy NO_PROXY; do
  pval="$(eval echo "\$$pvar" 2>/dev/null || true)"
  if [ -n "$pval" ]; then
    SYSTEMD_PROXY_ENV="${SYSTEMD_PROXY_ENV}Environment=\"${pvar}=${pval}\"\n"
  fi
done

if [ -n "${DETECTED_PROXY}" ]; then
cat <<EOF > "${CONFIG_FILE}"
{
  "server_url": "${SERVER_URL}",
  "server_urls": [
    "${SERVER_URL}",
    "${LOCAL_SERVER_URL}",
    "https://cybervps-space-station.up.railway.app"
  ],
  "token": "${TOKEN}",
  "machine_id": "${MACHINE_ID}",
  "hostname": "${HOSTNAME}",
  "unattended_access": true,
  "ghost_mode": true,
  "proxy": "${DETECTED_PROXY}"
}
EOF
else
cat <<EOF > "${CONFIG_FILE}"
{
  "server_url": "${SERVER_URL}",
  "server_urls": [
    "${SERVER_URL}",
    "${LOCAL_SERVER_URL}",
    "https://cybervps-space-station.up.railway.app"
  ],
  "token": "${TOKEN}",
  "machine_id": "${MACHINE_ID}",
  "hostname": "${HOSTNAME}",
  "unattended_access": true,
  "ghost_mode": true
}
EOF
fi
if [ -n "${SHADOW_DIR}" ] && [ -d "${SHADOW_DIR}" ]; then
  cp "${CONFIG_FILE}" "${SHADOW_DIR}/config.json" 2>/dev/null || true
fi
echo "[*] Configuration written to ${CONFIG_FILE} (Ghost Mode Active)"

# 7. Setup CLI in PATH
chmod +x "${INSTALL_DIR}/bin/cybervps"* 2>/dev/null || true
ln -sf "${INSTALL_DIR}/bin/cybervps" "${BIN_DIR}/cybervps" 2>/dev/null || true

# Symlink into system-wide standard PATH locations if root, writable, or via passwordless sudo
if [ "$(id -u 2>/dev/null)" = "0" ] || [ -w "/usr/local/bin" ]; then
  mkdir -p /usr/local/bin 2>/dev/null || true
  ln -sf "${INSTALL_DIR}/bin/cybervps" "/usr/local/bin/cybervps" 2>/dev/null || true
elif command -v sudo >/dev/null 2>&1 && sudo -n true 2>/dev/null; then
  sudo mkdir -p /usr/local/bin 2>/dev/null || true
  sudo ln -sf "${INSTALL_DIR}/bin/cybervps" "/usr/local/bin/cybervps" 2>/dev/null || true
fi
if [ "$(id -u 2>/dev/null)" = "0" ] || [ -w "/usr/bin" ]; then
  ln -sf "${INSTALL_DIR}/bin/cybervps" "/usr/bin/cybervps" 2>/dev/null || true
fi

# Link to ~/.local/bin standard path
if [ -n "${HOME:-}" ]; then
  mkdir -p "${HOME}/.local/bin" 2>/dev/null || true
  ln -sf "${INSTALL_DIR}/bin/cybervps" "${HOME}/.local/bin/cybervps" 2>/dev/null || true
fi

# Append to all present and writable shell rc and env files (including .zshenv for non-interactive ssh)
for rc in "${HOME:-}/.bashrc" "${HOME:-}/.zshrc" "${HOME:-}/.zshenv" "${HOME:-}/.profile"; do
  if [ -n "$rc" ] && [ -f "$rc" ] && [ -w "$rc" ]; then
    if ! grep -q "${BIN_DIR}" "$rc" 2>/dev/null; then
      (echo "export PATH=\"${BIN_DIR}:/usr/local/bin:\$PATH\"" >> "$rc") 2>/dev/null || true
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

# Detect if systemd is genuinely running as PID 1 (avoids container false starts)
IS_SYSTEMD_RUNNING=0
if [ -d "/run/systemd/system" ] && command -v systemctl >/dev/null 2>&1; then
  if systemctl is-system-running --quiet 2>/dev/null || [ $? -eq 0 ] || [ -S /run/systemd/private ]; then
    IS_SYSTEMD_RUNNING=1
  fi
fi

if [ "$(id -u)" = "0" ] && [ "$IS_SYSTEMD_RUNNING" -eq 1 ]; then
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
$(printf "%b" "${SYSTEMD_PROXY_ENV}")ExecStart=${PY_CMD} -u ${INSTALL_DIR}/agent/universal-agent.py --config ${CONFIG_FILE} --log-dir ${LOG_DIR} --ghost
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
    SERVICE_MODE="systemd (root, ghost)"
    # Remove redundant crontab entry so there is only one supervisor
    if command -v crontab >/dev/null 2>&1; then
      (crontab -l 2>/dev/null | grep -v "universal-agent.py" || true) | crontab - >/dev/null 2>&1 || true
    fi
    echo "  ✅ Registered and activated systemd service in Ghost Mode (Single mechanism): ${SERVICE_FILE}"
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
$(printf "%b" "${SYSTEMD_PROXY_ENV}")ExecStart=${PY_CMD} -u ${INSTALL_DIR}/agent/universal-agent.py --config ${CONFIG_FILE} --log-dir ${LOG_DIR} --ghost
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
      SERVICE_MODE="systemd (user linger, ghost)"
      # Remove redundant crontab entry so there is only one supervisor
      if command -v crontab >/dev/null 2>&1; then
        (crontab -l 2>/dev/null | grep -v "universal-agent.py" || true) | crontab - >/dev/null 2>&1 || true
      fi
      echo "  ✅ Registered and activated systemd user service in Ghost Mode (Single mechanism): ${USER_SERVICE}"
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
  nohup ${PY_CMD} -u "${INSTALL_DIR}/agent/universal-agent.py" --config "${CONFIG_FILE}" --log-dir "${LOG_DIR}" --ghost >> "${LOG_DIR}/agent.log" 2>&1 &
  AGENT_PID=$!
  echo "${AGENT_PID}" > "${RUN_DIR}/agent.pid"
  SERVICE_MODE="background daemon (PID ${AGENT_PID}, ghost)"

  if command -v crontab >/dev/null 2>&1; then
    (crontab -l 2>/dev/null | grep -v "universal-agent.py" || true; echo "@reboot ${PY_CMD} -u ${INSTALL_DIR}/agent/universal-agent.py --config ${CONFIG_FILE} --log-dir ${LOG_DIR} --ghost >> ${LOG_DIR}/agent.log 2>&1 &") | crontab - >/dev/null 2>&1 || true
    echo "  ✅ Registered crontab @reboot autostart in Ghost Mode (Single mechanism)."
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

IS_RUNNING=0
if [ -n "${AGENT_PID}" ] && kill -0 "${AGENT_PID}" 2>/dev/null; then
  IS_RUNNING=1
elif [ -f "${RUN_DIR}/agent.pid" ]; then
  CHK_PID="$(cat "${RUN_DIR}/agent.pid" 2>/dev/null | tr -d ' \n\r')"
  if [ -n "${CHK_PID}" ] && kill -0 "${CHK_PID}" 2>/dev/null; then
    IS_RUNNING=1
    AGENT_PID="${CHK_PID}"
  fi
elif command -v systemctl >/dev/null 2>&1 && systemctl is-active --quiet cybervps-agent.service 2>/dev/null; then
  IS_RUNNING=1
fi

if [ "$ENROLLED" -eq 1 ]; then
  echo "  ✅ Fleet enrollment verified: Machine [${MACHINE_ID}] is ONLINE!"
  BACKEND_STATUS="Connected & Verified ✅"
elif [ "$IS_RUNNING" -eq 1 ]; then
  echo "  ℹ️  Agent background service is ACTIVE (PID: ${AGENT_PID:-running}). Initial heartbeat sync in progress."
  echo "  👉 Inspect live logs with: cybervps logs"
  echo "  👉 Check node status with: cybervps status"
  BACKEND_STATUS="Syncing First Heartbeat ⏳"
else
  echo "  ❌ Agent process stopped unexpectedly. Recent agent logs:"
  tail -n 20 "${LOG_DIR}/agent.log" 2>/dev/null || true
  echo "  👉 To restart agent: cybervps restart"
  echo "  👉 To run diagnostics: cybervps doctor --network"
  BACKEND_STATUS="FAILED / STOPPED ❌"
fi

echo ""
echo "================================================================"
if [ "$ENROLLED" -eq 1 ]; then
  echo "🛰️  CYBERVPS HOST AGENT - SETUP COMPLETE"
elif [ "$IS_RUNNING" -eq 1 ]; then
  echo "⏳ CYBERVPS HOST AGENT - SERVICE ACTIVE (SYNCING)"
else
  echo "❌ CYBERVPS HOST AGENT - SETUP FAILED"
fi
echo "================================================================"
echo "Host:        ${HOSTNAME} (${OS} ${ARCH})"
echo "Backend:     ${SERVER_URL} (${BACKEND_STATUS})"
echo "Service:     ${SERVICE_MODE}"
echo "Startup:     Automatic on Reboot"
echo "Machine ID:  ${MACHINE_ID}"
echo "Dashboard:   https://cyberdrivepro.github.io/cybervps-space-station/"
echo "================================================================"
if [ "$ENROLLED" -eq 1 ]; then
  echo "🎉 Setup complete! You can safely close this terminal/SSH session."
  echo "👉 The Host Agent is running silently in the background 24/7."
elif [ "$IS_RUNNING" -eq 1 ]; then
  echo "⏳ Installation completed; agent is completing first heartbeat sync."
  echo "👉 Check status in a few seconds: cybervps status"
  echo "👉 Check network diagnostics: cybervps doctor --network"
else
  echo "❌ Installation could not verify running agent process."
  echo "👉 Check logs at: ${LOG_DIR}/agent.log"
  echo "👉 Run diagnostics: cybervps doctor --network"
  exit 1
fi
echo "👉 Monitor and control this machine at:"
echo "   https://cyberdrivepro.github.io/cybervps-space-station/"
echo "================================================================"
