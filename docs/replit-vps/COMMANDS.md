# CYBERVPS SPACE STATION × REPLIT VPS LAB: VERIFIED COMMAND LEDGER

This document provides clean, verifiable, copy-paste shell commands for deploying and managing the **Replit VPS Lab** and integrating it into the **CyberVPS Space Station** fleet.

---

## 1. REPLIT / UNPRIVILEGED CONTAINER QUICKSTART

Run this single command inside the Replit bash console to install all components, start the graphical desktop, spin up noVNC websockify, and connect to CyberVPS Space Station:

```bash
curl -fsSL https://raw.githubusercontent.com/cyberdrivepro/cybervps-space-station/main/installers/replit-vps/install.sh | bash
```

Alternatively, if cloning the repository locally:

```bash
git clone https://github.com/cyberdrivepro/cybervps-space-station.git ~/.cybervps/space-station
cd ~/.cybervps/space-station
bash installers/replit-vps/install.sh
```

---

## 2. INDIVIDUAL COMPONENT COMMANDS

### A. Environment & Capability Diagnostics

Inspect hardware, virtualization nodes, and cgroup limits honestly:

```bash
# Check memory allocation
free -h

# Check storage capacity
df -h /home /

# Check CPU count and model
nproc && lscpu | grep "Model name"

# Inspect KVM hardware acceleration node
if [ -e /dev/kvm ] && [ -w /dev/kvm ]; then
  echo "✅ KVM Hardware Acceleration: ACTIVE (/dev/kvm accessible)"
else
  echo "⚠️ KVM Hardware Acceleration: UNAVAILABLE (Software QEMU / PRoot fallback only)"
fi

# Check Docker / LXD container capability
if command -v docker >/dev/null 2>&1 && docker ps >/dev/null 2>&1; then
  echo "✅ Docker: RUNNING & ACCESSIBLE"
else
  echo "ℹ️ Docker daemon not accessible in this unprivileged container sandbox"
fi
```

### B. Installing Nix Dependencies (`replit.nix`)

Ensure the following packages are present in `replit.nix`:

```nix
{ pkgs }: {
  deps = [
    pkgs.bashInteractive
    pkgs.tigervnc
    pkgs.openbox
    pkgs.xterm
    pkgs.novnc
    pkgs.python3
    pkgs.python3Packages.websockify
    pkgs.curl
    pkgs.wget
    pkgs.procps
    pkgs.nettools
    pkgs.git
  ];
}
```

### C. Desktop Lifecycle Management

#### Start VNC Server (Display `:1`)
```bash
# Clean up any stale X11 lock files
rm -rf /tmp/.X1-lock /tmp/.X11-unix/X1

# Launch TigerVNC server listening on 127.0.0.1:5901 with Openbox
vncserver :1 -geometry 1280x720 -depth 24 -localhost yes -SecurityTypes None
```

#### Start noVNC Websockify Bridge
```bash
# Bridges local RFB 5901 to HTTP port 8080 (serving noVNC)
websockify --web /usr/share/novnc 8080 127.0.0.1:5901 &
```

#### Launch Desktop Browser inside X11 Display
```bash
# Launch lightweight browser inside the active display
DISPLAY=:1 nohup chromium --no-sandbox --disable-dev-shm-usage http://localhost:8080 >/dev/null 2>&1 &
```

#### Stop Desktop & Clean Up
```bash
vncserver -kill :1
pkill -f "websockify"
pkill -f "openbox"
```

---

## 3. COLLABORATIVE TERMINAL SHARING (SSHX)

Launch a collaborative browser terminal with end-to-end encryption:

```bash
# Install and run sshx in headless session
curl -sSf https://sshx.io/get | sh -s run
```

---

## 4. CYBERVPS CLI REPLIT COMMAND REFERENCE

Once installed, use the unified `cybervps replit` CLI commands:

| Command | Action |
|---|---|
| `cybervps replit doctor` | Run comprehensive capability, memory, disk, KVM, and port diagnostics |
| `cybervps replit setup` | Set up VNC, Openbox, noVNC websockify, and process supervisor |
| `cybervps replit status` | Check live status of agent, desktop, VNC port 5901, and websockify port 8080 |
| `cybervps replit desktop start` | Start X11 display `:1` and Openbox window manager |
| `cybervps replit desktop stop` | Terminate active display session safely |
| `cybervps replit desktop restart` | Restart desktop display session |
| `cybervps replit vnc` | Display noVNC web address and RFB connection coordinates |
| `cybervps replit browser` | Launch browser inside the desktop session |
| `cybervps replit kvm` | Test `/dev/kvm` access and inspect QEMU capabilities |
| `cybervps replit docker` | Inspect Docker socket and container runtime status |
| `cybervps replit logs` | Tail agent and desktop supervisor logs in real-time |
| `cybervps replit uninstall` | Stop all processes and clean up temporary state |

---

## 5. 24/7 KEEP-ALIVE & PROCESS SUPERVISOR

To keep the agent and desktop services running and recover from container restarts:

```bash
# Run supervisor in background
nohup bash ~/.cybervps/space-station/installers/replit-vps/supervise.sh > ~/.cybervps/logs/supervisor.log 2>&1 &
```
