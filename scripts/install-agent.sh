#!/usr/bin/env bash
# ==============================================================================
# CyberVPS SPACE STATION - Universal 1-Line Agent Self-Installer
# Works on: Ubuntu, Debian, CentOS, Alpine, Arch, Root and Non-Root Environments
# ==============================================================================

set -e

SERVER_URL="http://localhost:8080"
TOKEN="cvps_enroll_master_token"
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
mkdir -p "$CVPS_DIR"
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

echo -e "\n${GREEN}[2/4] Running System & Network Doctor...${NC}"
if [ -f "$CVPS_DIR/doctor.sh" ]; then
    bash "$CVPS_DIR/doctor.sh" || true
fi

echo -e "\n${GREEN}[3/4] Configuring Supervisor & Background Persistence...${NC}"
# Determine service mechanism
SERVICE_INSTALLED=0

if [ "$(id -u)" -eq 0 ] && [ -d "/etc/systemd/system" ]; then
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
    systemctl daemon-reload
    systemctl enable --now cybervps-agent.service
    SERVICE_INSTALLED=1
    echo -e "${GREEN}Systemd service installed and started!${NC}"
fi

if [ $SERVICE_INSTALLED -eq 0 ] && command -v systemctl >/dev/null 2>&1 && [ -n "$XDG_RUNTIME_DIR" ]; then
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
    systemctl --user daemon-reload 2>/dev/null || true
    systemctl --user enable --now cybervps-agent.service 2>/dev/null && SERVICE_INSTALLED=1 || true
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

echo -e "\n${GREEN}[4/4] Verifying Agent Status...${NC}"
sleep 2
if [ -f "$CVPS_DIR/agent.pid" ]; then
    APID=$(cat "$CVPS_DIR/agent.pid")
    echo -e "${GREEN}âœ… CyberVPS Agent is ACTIVE and RUNNING (PID: $APID)${NC}"
else
    echo -e "${YELLOW}Agent starting up... Check logs at: $CVPS_DIR/agent.log${NC}"
fi

echo -e "\n${CYAN}================================================================${NC}"
echo -e "${GREEN}   ðŸŽ‰ Installation Complete! Agent Connected to Space Station   ${NC}"
echo -e "${CYAN}================================================================${NC}"
