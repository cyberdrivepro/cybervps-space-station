#!/usr/bin/env bash
# ==============================================================================
# CYBERVPS SPACE STATION — REPLIT VPS LAB AUTOMATED INSTALLER
# ==============================================================================
# Configures an unprivileged Linux container (Replit, Prepare.sh, or generic)
# with a graphical desktop (TigerVNC + Openbox), HTML5 noVNC bridge, sshx,
# CyberVPS fleet agent, and resilient process supervision.
# ==============================================================================

set -e

SERVER_URL="${CYBERVPS_SERVER_URL:-https://cybervps-space-station.up.railway.app}"
INSTALL_BASE="${HOME}/.cybervps"
LAB_DIR="${INSTALL_BASE}/replit"
LOG_DIR="${INSTALL_BASE}/logs"
RUN_DIR="${INSTALL_BASE}/run"
NOVNC_DIR="${LAB_DIR}/novnc"
WEB_PORT="${PORT:-8080}"
VNC_DISPLAY=":1"
VNC_PORT="5901"

echo "================================================================="
echo "  🚀 CYBERVPS SPACE STATION × REPLIT VPS LAB INSTALLER"
echo "================================================================="

mkdir -p "${LAB_DIR}" "${LOG_DIR}" "${RUN_DIR}"

# 1. Capability & Environment Diagnostics
echo "[*] Auditing host environment and hardware capabilities..."
OS="$(uname -s)"
ARCH="$(uname -m)"
USER_NAME="$(whoami)"
HOSTNAME_VAL="$(hostname 2>/dev/null || echo 'replit-node')"
TOTAL_MEM_KB="$(grep MemTotal /proc/meminfo 2>/dev/null | awk '{print $2}' || echo '0')"
TOTAL_MEM_MB=$((TOTAL_MEM_KB / 1024))

echo "  • Operating System: ${OS} (${ARCH})"
echo "  • User Context:     ${USER_NAME} (UID: $(id -u))"
echo "  • Memory Available: ${TOTAL_MEM_MB} MB"

if [ -e /dev/kvm ] && [ -w /dev/kvm ]; then
  echo "  • Virtualization:   ✅ Hardware KVM Accessible"
  KVM_STATUS="hardware_kvm"
else
  echo "  • Virtualization:   ⚠️ Hardware KVM Unavailable (Software TCG / PRoot fallback)"
  KVM_STATUS="emulated_only"
fi

# 2. Dependency Resolution
echo "[*] Verifying runtime dependencies..."

if command -v nix-env >/dev/null 2>&1; then
  echo "  [*] Detected Nix environment; checking packages..."
  for pkg in tigervnc openbox websockify novnc python3 curl wget; do
    if ! command -v "${pkg}" >/dev/null 2>&1; then
      echo "  [+] Installing missing package via Nix: ${pkg}..."
      nix-env -iA "nixpkgs.${pkg}" 2>/dev/null || true
    fi
  done
elif [ "$(id -u)" = "0" ] && command -v apt-get >/dev/null 2>&1; then
  echo "  [*] Debian/Ubuntu root environment detected; installing prerequisites..."
  apt-get update -qq >/dev/null 2>&1 || true
  apt-get install -y -qq tigervnc-standalone-server tigervnc-common openbox xterm python3 python3-pip curl wget ca-certificates >/dev/null 2>&1 || true
fi

# 3. Setup noVNC Web Interface if missing
if [ ! -d "${NOVNC_DIR}" ] || [ ! -f "${NOVNC_DIR}/vnc.html" ]; then
  if [ -d "/usr/share/novnc" ] && [ -f "/usr/share/novnc/vnc.html" ]; then
    echo "  [+] Using system-installed noVNC at /usr/share/novnc"
    ln -sfn /usr/share/novnc "${NOVNC_DIR}"
  else
    echo "  [*] Cloning noVNC HTML5 client..."
    rm -rf "${NOVNC_DIR}"
    git clone --depth 1 https://github.com/novnc/noVNC.git "${NOVNC_DIR}" >/dev/null 2>&1 || {
      mkdir -p "${NOVNC_DIR}"
      curl -fsSL -o "${NOVNC_DIR}/vnc.html" https://raw.githubusercontent.com/novnc/noVNC/master/vnc.html 2>/dev/null || true
    }
  fi
fi

# 4. Configure VNC Startup & Window Manager
mkdir -p "${HOME}/.vnc"
cat <<'EOF' > "${HOME}/.vnc/xstartup"
#!/bin/sh
unset SESSION_MANAGER
unset DBUS_SESSION_BUS_ADDRESS
[ -x /etc/vnc/xstartup ] && exec /etc/vnc/xstartup
[ -r $HOME/.Xresources ] && xrdb $HOME/.Xresources
if command -v openbox-session >/dev/null 2>&1; then
  exec openbox-session &
elif command -v openbox >/dev/null 2>&1; then
  exec openbox &
elif command -v xterm >/dev/null 2>&1; then
  xterm -geometry 80x24+10+10 -ls -title "$VNCDESKTOP Desktop" &
fi
EOF
chmod +x "${HOME}/.vnc/xstartup"

# 5. Copy or Link Helper Scripts
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cp "${SCRIPT_DIR}/start-desktop.sh" "${LAB_DIR}/start-desktop.sh" 2>/dev/null || true
cp "${SCRIPT_DIR}/start-browser.sh" "${LAB_DIR}/start-browser.sh" 2>/dev/null || true
cp "${SCRIPT_DIR}/supervise.sh" "${LAB_DIR}/supervise.sh" 2>/dev/null || true
chmod +x "${LAB_DIR}"/*.sh 2>/dev/null || true

# 6. Install or Verify CyberVPS Fleet Agent
echo "[*] Connecting node to CyberVPS Space Station Control Plane..."
if [ ! -f "${INSTALL_BASE}/space-station/agent/universal-agent.py" ]; then
  echo "  [*] Fetching CyberVPS Universal Agent..."
  mkdir -p "${INSTALL_BASE}/space-station"
  git clone --depth 1 https://github.com/cyberdrivepro/cybervps-space-station.git "${INSTALL_BASE}/space-station" 2>/dev/null || true
fi

# Write lab configuration
cat <<EOF > "${LAB_DIR}/replit-lab.json"
{
  "installed_at": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")",
  "server_url": "${SERVER_URL}",
  "web_port": ${WEB_PORT},
  "vnc_display": "${VNC_DISPLAY}",
  "vnc_port": ${VNC_PORT},
  "kvm_status": "${KVM_STATUS}",
  "total_mem_mb": ${TOTAL_MEM_MB},
  "novnc_dir": "${NOVNC_DIR}"
}
EOF

# 7. Start Services via Supervisor
echo "[*] Launching Replit VPS Lab services..."
pkill -f "supervise.sh" 2>/dev/null || true
nohup bash "${LAB_DIR}/supervise.sh" > "${LOG_DIR}/supervisor.log" 2>&1 &
SUP_PID=$!
echo "${SUP_PID}" > "${RUN_DIR}/supervisor.pid"

echo ""
echo "================================================================="
echo "  ✅ REPLIT VPS LAB INITIALIZED SUCCESSFULLY!"
echo "================================================================="
echo "  • noVNC Web Interface: http://localhost:${WEB_PORT}/vnc.html"
echo "  • Local RFB Display:   127.0.0.1:${VNC_PORT} (${VNC_DISPLAY})"
echo "  • Process Supervisor:  Running (PID: ${SUP_PID})"
echo "  • Control Plane:       ${SERVER_URL}"
echo "================================================================="
