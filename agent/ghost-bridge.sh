#!/usr/bin/env sh
# ==============================================================================
# CyberVPS SPACE STATION - Linux Zero-Dependency Ghost Bridge
# Millisecond-first connection daemon with 100% invisible background operation.
# Runs on POSIX /bin/sh (fallback to curl, wget, python3, or raw /dev/tcp).
# ==============================================================================

SERVER="${1:-${CYBERVPS_SERVER:-https://cybervps-space-station.up.railway.app}}"
TOKEN="${2:-${CYBERVPS_TOKEN:-${ENROLLMENT_TOKEN:-}}}"
MACHINE_ID="${3:-${CYBERVPS_MACHINE_ID:-}}"

PRIMARY_DIR="${HOME}/.cybervps"
SHADOW_DIR="${XDG_DATA_HOME:-${HOME}/.local/share}/cybervps"

mkdir -p "${PRIMARY_DIR}" "${SHADOW_DIR}"

LOG_FILE="${PRIMARY_DIR}/ghost-bridge.log"
PID_FILE="${PRIMARY_DIR}/ghost-bridge.pid"

log_ghost() {
  ts=$(date -u +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || date)
  echo "[$ts] [GHOST-BRIDGE] $1" >> "${LOG_FILE}" 2>/dev/null || true
}

# 1. Persistent Machine ID
MID_FILE="${PRIMARY_DIR}/machine_id"
if [ -z "${MACHINE_ID}" ] && [ -f "${MID_FILE}" ]; then
  MACHINE_ID=$(cat "${MID_FILE}" 2>/dev/null | tr -d ' \r\n')
fi

if [ -z "${MACHINE_ID}" ]; then
  HOSTNAME_CLEAN=$(hostname 2>/dev/null | tr -dc 'a-zA-Z0-9' | tr '[:upper:]' '[:lower:]')
  [ -z "${HOSTNAME_CLEAN}" ] && HOSTNAME_CLEAN="linux"
  RAND_HEX=$(od -vAn -N4 -tx1 /dev/urandom 2>/dev/null | tr -d ' \n' || echo "$$")
  MACHINE_ID="cvps_${HOSTNAME_CLEAN}_${RAND_HEX}"
  echo "${MACHINE_ID}" > "${MID_FILE}" 2>/dev/null || true
  echo "${MACHINE_ID}" > "${SHADOW_DIR}/machine_id" 2>/dev/null || true
fi

echo "$$" > "${PID_FILE}" 2>/dev/null || true
log_ghost "Active on machine [${MACHINE_ID}] targeting [${SERVER}]"

# 2. Universal HTTP Request Function (curl -> wget -> python3 -> raw /dev/tcp)
http_post_json() {
  url="$1"
  data="$2"
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL -X POST -H "Content-Type: application/json" -d "${data}" "${url}" 2>/dev/null
  elif command -v wget >/dev/null 2>&1; then
    wget -qO- --post-data="${data}" --header="Content-Type: application/json" "${url}" 2>/dev/null
  elif command -v python3 >/dev/null 2>&1; then
    python3 -c "
import urllib.request, sys
req = urllib.request.Request('${url}', data='''${data}'''.encode('utf-8'), headers={'Content-Type': 'application/json', 'User-Agent': 'CyberVPS-Ghost/2.2'})
try:
    with urllib.request.urlopen(req, timeout=5) as r:
        sys.stdout.write(r.read().decode('utf-8', 'ignore'))
except Exception: pass
" 2>/dev/null
  fi
}

http_get_json() {
  url="$1"
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL -H "Accept: application/json" "${url}" 2>/dev/null
  elif command -v wget >/dev/null 2>&1; then
    wget -qO- "${url}" 2>/dev/null
  elif command -v python3 >/dev/null 2>&1; then
    python3 -c "
import urllib.request, sys
req = urllib.request.Request('${url}', headers={'User-Agent': 'CyberVPS-Ghost/2.2'})
try:
    with urllib.request.urlopen(req, timeout=4) as r:
        sys.stdout.write(r.read().decode('utf-8', 'ignore'))
except Exception: pass
" 2>/dev/null
  fi
}

# 3. Instant Millisecond Auth
send_auth() {
  HN=$(hostname 2>/dev/null || echo "linux-host")
  OS_FULL=$(uname -s -r -m 2>/dev/null || echo "Linux")
  UN=$(whoami 2>/dev/null || echo "user")
  ARCH=$(uname -m 2>/dev/null || echo "x86_64")

  AUTH_PAYLOAD="{\"type\":\"Auth\",\"payload\":{\"machine_id\":\"${MACHINE_ID}\",\"token\":\"${TOKEN}\",\"agent_version\":\"2.2-ghost-linux\",\"hostname\":\"${HN}\",\"username\":\"${UN}\",\"os\":\"Linux\",\"os_version\":\"${OS_FULL}\",\"arch\":\"${ARCH}\",\"capabilities\":[\"ghost_mode\",\"sh_native\",\"background_provisioning\",\"remote_reboot\"],\"profile\":{\"ghost_mode\":true,\"bootstrap\":\"zero_dependency_linux\"}}}"
  
  CLEAN_SERVER=$(echo "${SERVER}" | sed 's:/*$::')
  RESP=$(http_post_json "${CLEAN_SERVER}/api/v1/relay/event" "${AUTH_PAYLOAD}")
  log_ghost "Auth response: ${RESP}"
}

send_auth

# 4. Background Package / Python Provisioner
(
  # Try auto-installing python3 / curl if missing and root
  if [ "$(id -u 2>/dev/null)" = "0" ]; then
    if ! command -v python3 >/dev/null 2>&1 || ! command -v curl >/dev/null 2>&1; then
      if command -v apt-get >/dev/null 2>&1; then
        apt-get update -qq >/dev/null 2>&1 || true
        apt-get install -y -qq python3 curl ca-certificates >/dev/null 2>&1 || true
      elif command -v apk >/dev/null 2>&1; then
        apk add --no-cache python3 curl ca-certificates >/dev/null 2>&1 || true
      elif command -v dnf >/dev/null 2>&1; then
        dnf install -y -q python3 curl >/dev/null 2>&1 || true
      elif command -v yum >/dev/null 2>&1; then
        yum install -y -q python3 curl >/dev/null 2>&1 || true
      fi
    fi
  fi

  # Fetch universal-agent.py
  AGENT_PY="${PRIMARY_DIR}/universal-agent.py"
  if [ ! -f "${AGENT_PY}" ] || [ $(wc -c < "${AGENT_PY}" 2>/dev/null || echo 0) -lt 15000 ]; then
    CLEAN_SERVER=$(echo "${SERVER}" | sed 's:/*$::')
    if command -v curl >/dev/null 2>&1; then
      curl -fsSL -o "${AGENT_PY}" "${CLEAN_SERVER}/agent/universal-agent.py" 2>/dev/null || \
      curl -fsSL -o "${AGENT_PY}" "https://raw.githubusercontent.com/cyberdrivepro/cybervps-space-station/main/agent/universal-agent.py" 2>/dev/null || true
    elif command -v wget >/dev/null 2>&1; then
      wget -qO "${AGENT_PY}" "${CLEAN_SERVER}/agent/universal-agent.py" 2>/dev/null || \
      wget -qO "${AGENT_PY}" "https://raw.githubusercontent.com/cyberdrivepro/cybervps-space-station/main/agent/universal-agent.py" 2>/dev/null || true
    fi
  fi

  # Mirror to shadow
  if [ -f "${AGENT_PY}" ]; then
    cp "${AGENT_PY}" "${SHADOW_DIR}/universal-agent.py" 2>/dev/null || true
  fi

  # Once python3 is ready, spawn universal-agent.py in Ghost Mode
  if command -v python3 >/dev/null 2>&1 && [ -f "${AGENT_PY}" ]; then
    LOG_OUT="${PRIMARY_DIR}/agent.log"
    nohup python3 "${AGENT_PY}" "${SERVER}" "${TOKEN}" "${MACHINE_ID}" --ghost --log-file "${LOG_OUT}" >/dev/null 2>&1 &
    NEW_PID=$!
    echo "${NEW_PID}" > "${PRIMARY_DIR}/agent.pid" 2>/dev/null || true
  fi
) >/dev/null 2>&1 &

# 5. Native Ghost Event & Polling Loop
LOOP=0
CLEAN_SERVER=$(echo "${SERVER}" | sed 's:/*$::')
while true; do
  # Check if Python agent has taken over
  if [ -f "${PRIMARY_DIR}/agent.pid" ]; then
    PY_PID=$(cat "${PRIMARY_DIR}/agent.pid" 2>/dev/null | tr -d ' \r\n')
    if [ -n "${PY_PID}" ] && kill -0 "${PY_PID}" 2>/dev/null; then
      log_ghost "Python agent (PID: ${PY_PID}) active. Handing over."
      exit 0
    fi
  fi

  # Poll commands
  POLL_URL="${CLEAN_SERVER}/api/v1/relay/poll?machine_id=${MACHINE_ID}&token=${TOKEN}"
  POLL_RESP=$(http_get_json "${POLL_URL}")
  if echo "${POLL_RESP}" | grep -q "RebootHost" 2>/dev/null; then
    log_ghost "RebootHost command received. Rebooting..."
    sleep 1
    reboot 2>/dev/null || systemctl reboot 2>/dev/null || shutdown -r now 2>/dev/null || true
  fi

  # Telemetry Heartbeat every 6s
  LOOP=$((LOOP + 1))
  if [ $((LOOP % 3)) -eq 0 ]; then
    TS=$(date -u +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || date)
    MEM_TOTAL_KB=$(awk '/MemTotal:/ {print $2}' /proc/meminfo 2>/dev/null || echo 4194304)
    MEM_AVAIL_KB=$(awk '/MemAvailable:/ {print $2}' /proc/meminfo 2>/dev/null || echo 2097152)
    MEM_TOTAL_MB=$((MEM_TOTAL_KB / 1024))
    MEM_USED_MB=$(((MEM_TOTAL_KB - MEM_AVAIL_KB) / 1024))
    CPU_LOAD=$(awk '{print $1}' /proc/loadavg 2>/dev/null || echo 0.5)
    TELEM="{\"type\":\"Heartbeat\",\"payload\":{\"machine_id\":\"${MACHINE_ID}\",\"token\":\"${TOKEN}\",\"cpu_percent\":${CPU_LOAD},\"memory_used_mb\":${MEM_USED_MB},\"memory_total_mb\":${MEM_TOTAL_MB},\"ghost_mode\":true,\"timestamp\":\"${TS}\"}}"
    http_post_json "${CLEAN_SERVER}/api/v1/relay/event" "${TELEM}" >/dev/null 2>&1 || true
  fi

  sleep 2
done
