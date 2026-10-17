# CYBERVPS SPACE STATION × REPLIT VPS LAB: TROUBLESHOOTING GUIDE

This guide details resolutions for edge cases, common pitfalls, and environmental restrictions encountered when deploying the Replit VPS Lab and CyberVPS Space Station.

---

## 1. IDLE DISCONNECTS & HOST SUSPENSION (ROOT CAUSE ANALYSIS)

### Problem Description
Nodes hosted on cloud developer sandboxes (such as Prepare.sh or Replit) lose connectivity after periods of inactivity, with the dashboard marking the machine `OFFLINE` or `RECONNECTING`.

### Root Cause
1. **Cloud Hypervisor Sleep:** Free tiers on Prepare.sh and Replit spin down containers when no HTTP ingress or active browser tab is detected for 10–30 minutes. An in-guest script cannot physically stop an external cloud hypervisor from freezing an unprivileged container.
2. **Reverse Proxy Stream Drop:** Intermediate reverse proxies (Cloudflare, Railway Ingress, Prepare.sh Web Gateway) drop idle WebSocket/TCP streams after 60–120 seconds if no frames are transmitted.
3. **Half-Open Socket Hang:** Without an active client-side WebSocket PING heartbeat, the agent process remains blocked on `recv()` with no knowledge that the connection has been terminated.

### Solution Implemented
1. **Active Heartbeat Thread:** The CyberVPS Agent now starts an active heartbeat thread in `RelayWebSocket`, transmitting an RFC 6455 Ping frame (`0x9`) every 15 seconds.
2. **Socket Keepalive Options:** `SO_KEEPALIVE` and `TCP_KEEPIDLE` (20s), `TCP_KEEPINTVL` (10s), and `TCP_KEEPCNT` (3) are set on the underlying socket.
3. **Socket Read Timeout:** Replaced `s.settimeout(None)` with a 25-second read timeout, catching dead connections immediately and triggering exponential backoff reconnection with random jitter.
4. **Honest Provider State:** When a node hosted on Prepare.sh or Replit stops responding for >40 seconds, the Space Station reports `PROVIDER_PAUSED_OR_UNREACHABLE` with instructions rather than a confusing generic failure.

---

## 2. NOVNC & WEBSOCKIFY PORT CONFLICTS

### Symptom: `Failed to open port 8080` or `Address already in use`
- **Cause:** Another process (e.g., Replit web server or a previous websockify instance) is already listening on port 8080.
- **Resolution:**
  ```bash
  # Check which process holds the port
  lsof -i :8080 || netstat -tulnp | grep 8080

  # Kill stale websockify processes
  pkill -f "websockify"

  # Or launch on an alternate port
  websockify --web /usr/share/novnc 6080 127.0.0.1:5901 &
  ```

---

## 3. DISPLAY & X11 LOCK FAILURES

### Symptom: `A VNC server is already running as :1`
- **Cause:** Previous VNC server crashed or terminated without cleaning up its lock file in `/tmp`.
- **Resolution:**
  ```bash
  vncserver -kill :1 2>/dev/null || true
  rm -f /tmp/.X1-lock /tmp/.X11-unix/X1
  vncserver :1 -geometry 1280x720 -depth 24 -localhost yes -SecurityTypes None
  ```

---

## 4. SSHX TERMINAL SESSION TERMINATION

### Symptom: `sshx link expired or disconnected`
- **Cause:** `sshx` runs interactively in the terminal foreground and terminates when the console window closes.
- **Resolution:**
  Run `sshx` under the CyberVPS supervisor daemon or nohup:
  ```bash
  nohup sshx run > ~/.cybervps/logs/sshx.log 2>&1 &
  # Retrieve the generated URL from the log
  grep -o 'https://sshx.io/s/[^ ]*' ~/.cybervps/logs/sshx.log | tail -n 1
  ```

---

## 5. HARDWARE KVM ACCELERATION MISSING

### Symptom: `Could not access KVM kernel module: No such file or directory`
- **Cause:** Cloud container sandboxes run inside shared Linux namespaces and do not pass through `/dev/kvm` hardware virtualization extensions to unprivileged users.
- **Resolution:**
  Do not attempt to force KVM. Use QEMU with software TCG emulation:
  ```bash
  qemu-system-x86_64 -m 512M -accel tcg -nographic ...
  ```
  CyberVPS Space Station automatically detects this condition and reports `EMULATED_ONLY` without crashing.
