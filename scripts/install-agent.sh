#!/usr/bin/env bash
# ==============================================================================
# CyberVPS SPACE STATION - Universal 1-Line Agent Self-Installer
# Works on: Ubuntu, Debian, CentOS, Alpine, Arch, Root and Non-Root Environments
# ==============================================================================

set -e

SERVER_URL="${1:-${CYBERVPS_SERVER:-https://cybervps-space-station.up.railway.app}}"
TOKEN="${CYBERVPS_TOKEN:-cvps_enroll_master_token}"
MACHINE_ID=""

POS_1=""
POS_2=""
POS_3=""

while [ $# -gt 0 ]; do
  case "$1" in
    --server|-s)
      SERVER_URL="$2"
      shift 2
      ;;
    --token|-t)
      TOKEN="$2"
      shift 2
      ;;
    --machine-id|-m)
      MACHINE_ID="$2"
      shift 2
      ;;
    *)
      if [ -z "$POS_1" ]; then
        SERVER_URL="$1"
        POS_1="1"
      elif [ -z "$POS_2" ]; then
        TOKEN="$1"
        POS_2="1"
      elif [ -z "$POS_3" ]; then
        MACHINE_ID="$1"
        POS_3="1"
      fi
      shift
      ;;
  esac
done

RED='\033[0;31m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${CYAN}================================================================${NC}"
echo -e "${CYAN}   🚀 CyberVPS SPACE STATION - Universal Agent Installer        ${NC}"
echo -e "${CYAN}================================================================${NC}"

CVPS_DIR="$HOME/.cybervps"
LOG_DIR="$CVPS_DIR/logs"
mkdir -p "$CVPS_DIR" "$LOG_DIR"
ln -sf "$LOG_DIR/agent.log" "$CVPS_DIR/agent.log" 2>/dev/null || true
cd "$CVPS_DIR"

echo -e "\n${GREEN}[1/4] Preparing agent environment in $CVPS_DIR...${NC}"

# Check available runtimes
HAS_PYTHON=0
HAS_CARGO=0
command -v python3 >/dev/null 2>&1 && HAS_PYTHON=1
command -v cargo >/dev/null 2>&1 && HAS_CARGO=1

if [ $HAS_PYTHON -eq 0 ] && [ $HAS_CARGO -eq 0 ]; then
    echo -e "${YELLOW}Warning: Neither Python 3 nor Cargo found. Attempting package install...${NC}"
    if [ "$(id -u)" -eq 0 ]; then
        apt-get update -qq && apt-get install -y -qq python3 curl
    elif sudo -n true 2>/dev/null; then
        sudo apt-get update -qq && sudo apt-get install -y -qq python3 curl
    fi
fi

# Fetch or install the universal agent script into ~/.cybervps/universal-agent.py
# If local repo exists nearby, copy it; otherwise download from control plane or repo
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" 2>/dev/null && pwd || echo "")"
PARENT_DIR="$(dirname "$SCRIPT_DIR")"

if [ -f "$PARENT_DIR/agent/universal-agent.py" ]; then
    cp "$PARENT_DIR/agent/universal-agent.py" "$CVPS_DIR/universal-agent.py"
    cp "$PARENT_DIR/scripts/agent-watchdog.sh" "$CVPS_DIR/agent-watchdog.sh"
    cp "$PARENT_DIR/scripts/diagnostics/doctor.sh" "$CVPS_DIR/doctor.sh"
else
    echo "Downloading CyberVPS universal agent components from $SERVER_URL..."
    curl -fsSL "$SERVER_URL/agent/universal-agent.py" -o "$CVPS_DIR/universal-agent.py" 2>/dev/null || \
    curl -fsSL "https://raw.githubusercontent.com/cyberdrivepro/cybervps-space-station/main/agent/universal-agent.py" -o "$CVPS_DIR/universal-agent.py"

    curl -fsSL "$SERVER_URL/scripts/agent-watchdog.sh" -o "$CVPS_DIR/agent-watchdog.sh" 2>/dev/null || \
    curl -fsSL "https://raw.githubusercontent.com/cyberdrivepro/cybervps-space-station/main/scripts/agent-watchdog.sh" -o "$CVPS_DIR/agent-watchdog.sh"

    curl -fsSL "$SERVER_URL/doctor.sh" -o "$CVPS_DIR/doctor.sh" 2>/dev/null || true
fi

chmod +x "$CVPS_DIR/agent-watchdog.sh" 2>/dev/null || true
chmod +x "$CVPS_DIR/universal-agent.py" 2>/dev/null || true
chmod +x "$CVPS_DIR/doctor.sh" 2>/dev/null || true

# Generate durable configuration
cat <<EOF > "$CVPS_DIR/config.json"
{
  "server_url": "$SERVER_URL",
  "server_urls": ["$SERVER_URL", "https://cybervps-space-station.up.railway.app"],
  "token": "$TOKEN",
  "machine_id": "$MACHINE_ID",
  "updated_at": "$(date -u +'%Y-%m-%dT%H:%M:%SZ')"
}
EOF

# CLI Wrapper Setup
cat << 'EOF' > "$CVPS_DIR/cybervps"
#!/usr/bin/env bash
PY_BIN="$(command -v python3 2>/dev/null || command -v python 2>/dev/null || echo python3)"
if [ -f "$HOME/.cybervps/space-station/bin/cybervps.py" ]; then
  exec "$PY_BIN" "$HOME/.cybervps/space-station/bin/cybervps.py" "$@"
elif [ -f "$HOME/.cybervps/universal-agent.py" ]; then
  exec "$PY_BIN" "$HOME/.cybervps/universal-agent.py" "$@"
else
  echo "[!] Error: CyberVPS agent script not found in $HOME/.cybervps." >&2
  exit 1
fi
EOF
chmod +x "$CVPS_DIR/cybervps"
if [ "$(id -u)" -eq 0 ]; then
    ln -sf "$CVPS_DIR/cybervps" /usr/local/bin/cybervps 2>/dev/null || true
elif sudo -n true 2>/dev/null; then
    sudo ln -sf "$CVPS_DIR/cybervps" /usr/local/bin/cybervps 2>/dev/null || true
fi
mkdir -p "$HOME/.local/bin"
ln -sf "$CVPS_DIR/cybervps" "$HOME/.local/bin/cybervps" 2>/dev/null || true

echo -e "\n${GREEN}[2/4] Running System & Network Doctor...${NC}"
if [ -f "$CVPS_DIR/doctor.sh" ]; then
    bash "$CVPS_DIR/doctor.sh" || true
fi

echo -e "\n${GREEN}[3/4] Configuring Supervisor & Background Persistence...${NC}"
# Determine service mechanism
SERVICE_INSTALLED=0

# Detect if systemd is genuinely running as PID 1 (avoids container false starts)
IS_SYSTEMD_RUNNING=0
if [ -d "/run/systemd/system" ] && command -v systemctl >/dev/null 2>&1; then
    if systemctl is-system-running --quiet 2>/dev/null || [ $? -eq 0 ] || [ -S /run/systemd/private ]; then
        IS_SYSTEMD_RUNNING=1
    fi
fi

if [ "$(id -u)" -eq 0 ] && [ "$IS_SYSTEMD_RUNNING" -eq 1 ]; then
    echo "Configuring systemd system service..."
    cat <<EOF > /etc/systemd/system/cybervps-agent.service
[Unit]
Description=CyberVPS Space Station Agent
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=$CVPS_DIR
ExecStart=/bin/bash $CVPS_DIR/agent-watchdog.sh "$SERVER_URL" "$TOKEN" "$MACHINE_ID"
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
    if systemctl daemon-reload >/dev/null 2>&1 && \
       systemctl enable --now cybervps-agent.service >/dev/null 2>&1 && \
       sleep 1 && \
       systemctl is-active --quiet cybervps-agent.service 2>/dev/null; then
        SERVICE_INSTALLED=1
        echo -e "${GREEN}Systemd service installed and started!${NC}"
    else
        echo -e "${YELLOW}Systemd unit could not be activated; falling back to background daemon...${NC}"
        systemctl disable cybervps-agent.service >/dev/null 2>&1 || true
        rm -f /etc/systemd/system/cybervps-agent.service 2>/dev/null || true
    fi
fi

if [ $SERVICE_INSTALLED -eq 0 ] && [ "$IS_SYSTEMD_RUNNING" -eq 1 ] && command -v systemctl >/dev/null 2>&1 && [ -n "$XDG_RUNTIME_DIR" ]; then
    echo "Configuring systemd user service..."
    mkdir -p "$HOME/.config/systemd/user"
    cat <<EOF > "$HOME/.config/systemd/user/cybervps-agent.service"
[Unit]
Description=CyberVPS Space Station Agent (User Mode)
After=network.target

[Service]
Type=simple
WorkingDirectory=$CVPS_DIR
ExecStart=/bin/bash $CVPS_DIR/agent-watchdog.sh "$SERVER_URL" "$TOKEN" "$MACHINE_ID"
Restart=always
RestartSec=5

[Install]
WantedBy=default.target
EOF
    if systemctl --user daemon-reload >/dev/null 2>&1 && \
       systemctl --user enable --now cybervps-agent.service >/dev/null 2>&1 && \
       sleep 1 && \
       systemctl --user is-active --quiet cybervps-agent.service 2>/dev/null; then
        SERVICE_INSTALLED=1
        echo -e "${GREEN}Systemd user service installed and started!${NC}"
    else
        systemctl --user disable cybervps-agent.service >/dev/null 2>&1 || true
        rm -f "$HOME/.config/systemd/user/cybervps-agent.service" 2>/dev/null || true
    fi
fi

if [ $SERVICE_INSTALLED -eq 0 ]; then
    echo "Running in standalone background watchdog mode (nohup + crontab fallback)..."
    # Kill any existing watchdog
    pkill -f "agent-watchdog.sh" 2>/dev/null || true
    nohup /bin/bash "$CVPS_DIR/agent-watchdog.sh" "$SERVER_URL" "$TOKEN" "$MACHINE_ID" > "$CVPS_DIR/watchdog_boot.log" 2>&1 &
    WATCHDOG_PID=$!
    echo "$WATCHDOG_PID" > "$CVPS_DIR/watchdog.pid"

    # Add crontab @reboot if crontab is available
    if command -v crontab >/dev/null 2>&1; then
        (crontab -l 2>/dev/null | grep -v "cybervps"; echo "@reboot nohup /bin/bash $CVPS_DIR/agent-watchdog.sh '$SERVER_URL' '$TOKEN' '$MACHINE_ID' >/dev/null 2>&1 &") | crontab - 2>/dev/null || true
    fi
    echo -e "${GREEN}Watchdog spawned in background (PID: $WATCHDOG_PID)${NC}"
fi

echo -e "\n${GREEN}[4/4] Verifying Agent Status & Fleet Enrollment...${NC}"
sleep 2
if [ -f "$CVPS_DIR/agent.pid" ]; then
    APID=$(cat "$CVPS_DIR/agent.pid")
    echo -e "${GREEN}✅ CyberVPS Agent is ACTIVE and RUNNING (PID: $APID)${NC}"
else
    echo -e "${YELLOW}Agent starting up... Check logs at: $CVPS_DIR/agent.log${NC}"
fi

ENROLL_CHECK="$(curl --connect-timeout 3 --max-time 8 -fsSL "${SERVER_URL}/api/v1/machines" 2>/dev/null || true)"
if echo "${ENROLL_CHECK}" | grep -q "${MACHINE_ID}"; then
    echo -e "${GREEN}✅ Fleet enrollment confirmed with Control Plane!${NC}"
else
    echo -e "${YELLOW}ℹ️  Agent background service active. Telemetry will sync within 5 seconds.${NC}"
fi

echo -e "\n${CYAN}================================================================${NC}"
echo -e "${GREEN}   🎉 Installation Complete! Agent Running on Space Station     ${NC}"
echo -e "${CYAN}================================================================${NC}"
