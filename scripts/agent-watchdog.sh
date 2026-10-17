#!/usr/bin/env bash
# ==============================================================================
# CyberVPS SPACE STATION - Self-Healing Agent Supervisor & Watchdog
# Ensures 24/7 continuous operation, crash recovery, and multi-backend failover
# ==============================================================================

SERVER_URL="${1:-${CYBERVPS_SERVER:-https://cybervps-space-station.up.railway.app}}"
TOKEN="${2:-cvps_enroll_master_token}"
MACHINE_ID="${3:-}"

CVPS_DIR="$HOME/.cybervps"
LOG_DIR="$CVPS_DIR/logs"
mkdir -p "$CVPS_DIR" "$LOG_DIR"
LOG_FILE="$LOG_DIR/agent.log"
ln -sf "$LOG_FILE" "$CVPS_DIR/agent.log" 2>/dev/null || true
WATCHDOG_LOG="$LOG_DIR/watchdog.log"
PID_FILE="$CVPS_DIR/agent.pid"

log() {
    echo "[$(date -u +'%Y-%m-%d %H:%M:%SZ')] [WATCHDOG] $1" | tee -a "$WATCHDOG_LOG"
}

log "[*] Starting CyberVPS Self-Healing Watchdog..."
log "Target Server: $SERVER_URL"
log "Working Directory: $CVPS_DIR"

# Clean up stale locks
if [ -f "$PID_FILE" ]; then
    OLD_PID=$(cat "$PID_FILE" 2>/dev/null)
    if [ -n "$OLD_PID" ] && ! kill -0 "$OLD_PID" 2>/dev/null; then
        log "Removing stale PID file ($OLD_PID)"
        rm -f "$PID_FILE"
    fi
fi

# Locate Agent Executable (Cargo native binary, or python3 universal agent)
AGENT_CMD=""
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PARENT_DIR="$(dirname "$SCRIPT_DIR")"

if [ -x "$PARENT_DIR/target/release/cybervps-agent" ]; then
    AGENT_CMD="$PARENT_DIR/target/release/cybervps-agent --server $SERVER_URL --token $TOKEN"
    [ -n "$MACHINE_ID" ] && AGENT_CMD="$AGENT_CMD --machine-id $MACHINE_ID"
elif command -v python3 >/dev/null 2>&1 && [ -f "$PARENT_DIR/agent/universal-agent.py" ]; then
    AGENT_CMD="python3 $PARENT_DIR/agent/universal-agent.py $SERVER_URL $TOKEN $MACHINE_ID"
elif command -v python3 >/dev/null 2>&1 && [ -f "$CVPS_DIR/universal-agent.py" ]; then
    AGENT_CMD="python3 $CVPS_DIR/universal-agent.py $SERVER_URL $TOKEN $MACHINE_ID"
else
    log "[!] Error: No runnable CyberVPS agent binary or Python script found!"
    exit 1
fi

log "Identified Agent Runner: $AGENT_CMD"

BACKOFF=2
MAX_BACKOFF=30

while true; do
    # 1. Check if agent process is alive
    IS_RUNNING=0
    if [ -f "$PID_FILE" ]; then
        AGENT_PID=$(cat "$PID_FILE" 2>/dev/null)
        if [ -n "$AGENT_PID" ] && kill -0 "$AGENT_PID" 2>/dev/null; then
            IS_RUNNING=1
        fi
    fi

    # 2. If not running, perform health check & spawn
    if [ $IS_RUNNING -eq 0 ]; then
        log "[*] Agent is NOT running. Performing pre-launch network diagnostic..."

        # Curl timeout check across registered control plane backends
        if command -v curl >/dev/null 2>&1; then
            CHECKED=0
            for TARGET in "$SERVER_URL" "https://cybervps-space-station.up.railway.app" "https://cybervps-render-control.onrender.com"; do
                HTTP_TARGET=$(echo "$TARGET" | sed 's/ws:\/\//http:\/\//' | sed 's/wss:\/\//https:\/\//')
                HEALTH_URL="$HTTP_TARGET/health"
                if curl -s -m 4 "$HEALTH_URL" >/dev/null 2>&1; then
                    log "[+] Control plane connectivity verified ($HEALTH_URL reachable)"
                    CHECKED=1
                    BACKOFF=2
                    break
                fi
            done
            if [ $CHECKED -eq 0 ]; then
                log "[*] Target servers sleeping or cold-starting. Launching agent with auto-failover..."
            fi
        fi

        log "Spawning Agent process..."
        nohup $AGENT_CMD >> "$LOG_FILE" 2>&1 &
        NEW_PID=$!
        echo "$NEW_PID" > "$PID_FILE"
        log "[+] Agent successfully spawned with PID: $NEW_PID"
    else
        # 3. Agent is running, verify memory and health
        if [ -n "$AGENT_PID" ]; then
            RSS_KB=$(ps -o rss= -p "$AGENT_PID" 2>/dev/null | tr -d ' ')
            if [ -n "$RSS_KB" ] && [ "$RSS_KB" -gt 300000 ]; then # > 300MB
                log "[!] Agent memory usage exceeded limit ($RSS_KB KB). Gracefully restarting..."
                kill -15 "$AGENT_PID" 2>/dev/null
                sleep 2
                kill -9 "$AGENT_PID" 2>/dev/null || true
                rm -f "$PID_FILE"
                continue
            fi
        fi
    fi

    sleep 5
done
