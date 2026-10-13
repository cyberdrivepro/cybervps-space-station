#!/usr/bin/env bash
# ==============================================================================
# CyberVPS SPACE STATION - System Doctor & Network Egress Diagnostic Tool
# Verifies system capabilities, curl timeouts, egress firewall, ports, and PTY
# ==============================================================================

set -u

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

echo -e "${CYAN}================================================================${NC}"
echo -e "${CYAN}   ðŸš€ CyberVPS SPACE STATION - SYSTEM & NETWORK DOCTOR          ${NC}"
echo -e "${CYAN}================================================================${NC}"

# 1. System Identity
echo -e "\n${BLUE}[1/7] Inspecting Host Identity...${NC}"
OS_NAME=$(uname -s 2>/dev/null || echo "Unknown")
KERNEL_VER=$(uname -r 2>/dev/null || echo "Unknown")
ARCH=$(uname -m 2>/dev/null || echo "Unknown")
USER_NAME=$(whoami 2>/dev/null || echo "Unknown")
UID_NUM=$(id -u 2>/dev/null || echo "Unknown")

echo "  â€¢ Operating System: $OS_NAME ($ARCH)"
echo "  â€¢ Kernel Version  : $KERNEL_VER"
echo "  â€¢ Current User    : $USER_NAME (UID: $UID_NUM)"

if [ "$UID_NUM" -eq 0 ]; then
    echo -e "  â€¢ ${GREEN}Privilege Level: ROOT (Full system administration)${NC}"
else
    echo -e "  â€¢ ${YELLOW}Privilege Level: NON-ROOT (User-level execution mode)${NC}"
    if sudo -n true 2>/dev/null; then
        echo -e "  â€¢ ${GREEN}Passwordless sudo: AVAILABLE${NC}"
    else
        echo -e "  â€¢ ${YELLOW}Passwordless sudo: NOT AVAILABLE (Operating in non-privileged mode)${NC}"
    fi
fi

# 2. Filesystem & Storage
echo -e "\n${BLUE}[2/7] Checking Storage & Write Permissions...${NC}"
TEST_DIR="/tmp"
[ ! -w "/tmp" ] && TEST_DIR="$HOME"
TEST_FILE="$TEST_DIR/.cybervps_doctor_test_$$"

if touch "$TEST_FILE" 2>/dev/null && rm -f "$TEST_FILE" 2>/dev/null; then
    echo -e "  â€¢ ${GREEN}Filesystem Write: PASS (Writable in $TEST_DIR)${NC}"
else
    echo -e "  â€¢ ${RED}Filesystem Write: FAIL (Cannot write temporary files in $TEST_DIR)${NC}"
fi

# 3. Available Runtimes
echo -e "\n${BLUE}[3/7] Checking Available Compilers & Runtimes...${NC}"
check_tool() {
    local name="$1"
    local cmd="$2"
    if command -v "$cmd" >/dev/null 2>&1; then
        local ver=$($cmd --version 2>&1 | head -n 1)
        echo -e "  â€¢ ${GREEN}[FOUND]${NC} $name: $ver"
        return 0
    else
        echo -e "  â€¢ ${YELLOW}[MISSING]${NC} $name"
        return 1
    fi
}

check_tool "Bash Shell" "bash"
check_tool "cURL HTTP Client" "curl"
check_tool "Wget Client" "wget"
check_tool "Python 3" "python3"
check_tool "Node.js" "node"
check_tool "Rust Cargo" "cargo"

# 4. Network Egress & Curl Timeout Checker
echo -e "\n${BLUE}[4/7] Testing Outbound Network & cURL Timeout Checker...${NC}"
TIMEOUT_SECS=3

test_egress() {
    local target_name="$1"
    local target_url="$2"
    echo -n "  â€¢ Testing egress to $target_name ($target_url) with ${TIMEOUT_SECS}s timeout: "
    
    if command -v curl >/dev/null 2>&1; then
        local curl_out
        curl_out=$(curl -s -m "$TIMEOUT_SECS" -I "$target_url" 2>&1)
        local exit_code=$?
        
        if [ $exit_code -eq 0 ]; then
            echo -e "${GREEN}SUCCESS (HTTP Connected)${NC}"
            return 0
        elif [ $exit_code -eq 28 ]; then
            echo -e "${RED}TIMEOUT (Connection timed out after ${TIMEOUT_SECS}s)${NC}"
            return 1
        elif echo "$curl_out" | grep -qi "restricted"; then
            echo -e "${YELLOW}RESTRICTED FIREWALL (Upstream firewall returned restricted policy)${NC}"
            return 2
        else
            echo -e "${RED}FAILED (curl exit code: $exit_code)${NC}"
            return 1
        fi
    elif command -v wget >/dev/null 2>&1; then
        if wget -q --spider --timeout="$TIMEOUT_SECS" "$target_url" 2>/dev/null; then
            echo -e "${GREEN}SUCCESS (Wget Connected)${NC}"
            return 0
        else
            echo -e "${RED}FAILED (Wget egress failed)${NC}"
            return 1
        fi
    else
        echo -e "${YELLOW}SKIPPED (Neither curl nor wget installed)${NC}"
        return 3
    fi
}

test_egress "Cloudflare (1.1.1.1)" "https://1.1.1.1"
test_egress "Google DNS (8.8.8.8)" "https://8.8.8.8"
test_egress "Public HTTPS Gateway" "https://cloudflare.com"

# 5. PTY & Interactive Shell Capabilities
echo -e "\n${BLUE}[5/7] Checking PTY & Terminal Allocation...${NC}"
if [ -c /dev/ptmx ] || [ -d /dev/pts ]; then
    echo -e "  â€¢ ${GREEN}PTY Device Nodes: PRESENT (/dev/ptmx or /dev/pts available)${NC}"
else
    echo -e "  â€¢ ${YELLOW}PTY Device Nodes: LIMITED OR RESTRICTED${NC}"
fi

if command -v python3 >/dev/null 2>&1; then
    if python3 -c "import pty; print('PTY module import OK')" 2>/dev/null; then
        echo -e "  â€¢ ${GREEN}Python PTY Support: AVAILABLE${NC}"
    fi
fi

# 6. Port Discovery & Socket Inspection
echo -e "\n${BLUE}[6/7] Inspecting Listening Local Ports...${NC}"
if command -v ss >/dev/null 2>&1; then
    echo -e "  â€¢ ${GREEN}Active TCP Listening Ports (via ss):${NC}"
    ss -tulpn 2>/dev/null | grep -E "LISTEN" | awk '{print "    -> " $1, $5, $7}' | head -n 10
elif command -v netstat >/dev/null 2>&1; then
    echo -e "  â€¢ ${GREEN}Active TCP Listening Ports (via netstat):${NC}"
    netstat -tulpn 2>/dev/null | grep -E "LISTEN" | awk '{print "    -> " $1, $4, $7}' | head -n 10
elif [ -r /proc/net/tcp ]; then
    echo -e "  â€¢ ${GREEN}Reading /proc/net/tcp directly:${NC}"
    awk 'NR>1 && $4=="0A" {split($2,a,":"); printf "    -> Port: %d (Hex: %s)\n", "0x" a[2], a[2]}' /proc/net/tcp | head -n 10
else
    echo -e "  â€¢ ${YELLOW}Port inspection tools restricted for current user${NC}"
fi

# 7. Background Process Survival
echo -e "\n${BLUE}[7/7] Testing Background Process & Nohup Persistence...${NC}"
if command -v nohup >/dev/null 2>&1; then
    nohup sleep 2 >/dev/null 2>&1 &
    PID=$!
    if kill -0 "$PID" 2>/dev/null; then
        echo -e "  â€¢ ${GREEN}Nohup Background Spawning: PASS (Process $PID running)${NC}"
        kill "$PID" 2>/dev/null || true
    else
        echo -e "  â€¢ ${RED}Nohup Background Spawning: FAIL${NC}"
    fi
fi

echo -e "\n${CYAN}================================================================${NC}"
echo -e "${GREEN}   âœ… CyberVPS Space Station Doctor Diagnostic Complete!       ${NC}"
echo -e "${CYAN}================================================================${NC}"
