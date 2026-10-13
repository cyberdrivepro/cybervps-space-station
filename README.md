# 🛰️ CyberVPS SPACE STATION

### Universal Remote Fleet Control, All-Port Network Bridge & Virtual Mesh Network

**CyberVPS SPACE STATION** is a production-grade, self-hostable platform designed to solve a fundamental problem:
When you run websites, APIs, dev servers, or databases on remote servers (Ubuntu, Debian, Windows Server, Root or Non-Root VPS, restricted SSH shells behind NAT with blocked inbound ports), those services bind to `localhost` (e.g. `127.0.0.1:6767`, `3000`, `8080`, `22220`) and remain trapped inside the remote machine.

CyberVPS Space Station creates an **encrypted outbound virtual bridge** between all your remote systems and your Windows PC or central dashboard.

---

## 🌟 Core Capabilities

### 🌉 MODE A: Universal TCP Port Bridge (Any Port 1–65535)
- **Local PC Mapping**: Map ANY remote port (1 to 65535) directly to your Windows PC on `127.0.0.1:<local_port>`.
- **Transparent Local Access**: Open `http://127.0.0.1:16767` in your browser, database client, or Postman to communicate directly with `localhost:6767` on the remote VPS.
- **Conflict-Safe Binding**: If a requested local port is already occupied on your PC, the bridge automatically resolves the conflict to the next free ephemeral port.
- **Rootless & Non-Privileged**: Runs entirely in userspace without requiring root on Linux or Administrator privileges on Windows.

### 🪐 MODE B: Virtual Private Network (10.77.0.0/24 Mesh Network)
- **Virtual IP Addressing**: Allocates dedicated Virtual IPs (e.g., `10.77.0.2`, `10.77.0.3`, `10.77.0.4`) to every enrolled machine.
- **Private Subnet Routing**: Enables direct IP-level communication between compatible machines over an encrypted data plane.
- **Privilege-Aware Detection**: Automatically detects whether the host has TUN/TAP driver privileges (root / elevated administrator) or gracefully defaults to Mode A Port Bridge for non-root systems.

### 🔍 Universal All-Port & Process Discovery Engine
- **No Hardcoded Ports**: Dynamically scans and discovers listening endpoints across the full numeric spectrum (1 to 65535).
- **Process & Socket Inspection**: Resolves Process IDs (PIDs), process names, listening state, and protocol (TCP/UDP).
- **HTTP & WebSocket Probing**: Safely probes loopback services with strict timeouts to detect HTTP status codes, HTML titles, and WebSocket support.

### 🛡️ Self-Installing & Self-Healing Supervisor
- **Multi-Runtime Universal Agent**: Native compiled Rust binary, zero-dependency Python 3 standard library agent, Node.js agent, and Windows PowerShell script.
- **Watchdog Supervisor (`agent-watchdog.sh`)**: Background daemon with crash auto-restart, memory limit enforcement, and stale socket cleanup.
- **System Doctor (`doctor.sh`)**: Built-in curl timeout checker, DNS resolution test, network egress firewall diagnostic, and PTY allocator test.

---

## 🏗️ Architecture Overview

```
 ┌─────────────────────────────────────────────────────────────┐
 │                CYBERVPS SPACE STATION (Hub)                 │
 │                                                             │
 │  ┌──────────────────┐   ┌───────────────────────────────┐   │
 │  │ Mission Control  │   │  Virtual Network Controller   │   │
 │  │  Web Dashboard   │   │      (10.77.0.0/24 CIDR)      │   │
 │  └──────────────────┘   └───────────────────────────────┘   │
 │  ┌──────────────────┐   ┌───────────────────────────────┐   │
 │  │ Persistent Relay │   │   Public HTTP/WS Gateway      │   │
 │  │ (WebSocket/TLS)  │   │     (/tunnel/:id/ Routing)    │   │
 │  └──────────────────┘   └───────────────────────────────┘   │
 └──────────────────────────────┬──────────────────────────────┘
                                │ Persistent Outbound TLS
       ┌────────────────────────┼────────────────────────┐
       ▼                        ▼                        ▼
┌──────────────┐        ┌──────────────┐        ┌────────────────┐
│  WINDOWS PC  │        │  UBUNTU VPS  │        │ RESTRICTED SSH │
│ (Local Host) │        │ (Root/Non-R) │        │ (e.g. Daytona) │
│              │        │              │        │                │
│ Port Bridge  │        │ Port Bridge  │        │ Port Bridge    │
│ 127.0.0.1:   │        │ 127.0.0.1:   │        │ 127.0.0.1:     │
│ 16767 ◄──────┼────────┼────── 6767   │        │ 2280 / 6767    │
│ Virtual IP:  │        │ Virtual IP:  │        │ Virtual IP:    │
│ 10.77.0.1    │        │ 10.77.0.2    │        │ 10.77.0.3      │
└──────────────┘        └──────────────┘        └────────────────┘
```

---

## 🚀 Quick Start & Universal Zero-Friction Installers

### ⚡ Universal 1-Line Bootstrap Installers (No Git/Manual NPM Required)

#### 🐧 Linux & Remote VPS (Ubuntu, Debian, CentOS, Termux, Daytona):
```bash
curl -fsSL https://raw.githubusercontent.com/cyberdrivepro/cybervps-space-station/main/install.sh -o install.sh && sh install.sh
```

#### 🪟 Windows PowerShell (PowerShell 5.1 & PowerShell 7+):
> *Works out-of-the-box in standard Windows PowerShell 5.1 and modern PowerShell 7+ (no `&&` operator syntax errors):*
```powershell
$ProgressPreference = 'SilentlyContinue'; [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; $installer = Join-Path $env:TEMP 'cybervps-install.ps1'; Invoke-WebRequest -UseBasicParsing -Uri 'https://raw.githubusercontent.com/cyberdrivepro/cybervps-space-station/main/install.ps1' -OutFile $installer; & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $installer; Remove-Item $installer -Force -ErrorAction SilentlyContinue
```

#### 💻 Windows Command Prompt (CMD):
> *Safe from any working directory, including `C:\Windows\system32` Administrator prompts (downloads cleanly to `%TEMP%` without curl error 23):*
```cmd
curl.exe -fSL --retry 3 "https://raw.githubusercontent.com/cyberdrivepro/cybervps-space-station/main/install.cmd" -o "%TEMP%\cybervps-install.cmd" && call "%TEMP%\cybervps-install.cmd"
```

---

### 🛠️ Unified CLI: `cybervps`

Once installed, use the unified `cybervps` CLI across any operating system:

```bash
# Start Space Station with automatic HTTPS tunnel & live links
cybervps start

# Start as a 24/7 background daemon
cybervps start --daemon

# Check running status, connected fleet, and public URLs
cybervps status

# Comprehensive system doctor & egress network diagnostics
cybervps doctor

# View recent live logs
cybervps logs

# Stop running Space Station daemon
cybervps stop
```

---

### 🌐 Auto-Public HTTPS Links & Zero-IP Connectivity

When starting inside a remote VPS or cloud sandbox (such as Daytona, Railway, or VPS behind NAT with blocked inbound ports):
1. **Zero VPS IP Required**: CyberVPS Space Station automatically establishes or detects a reachable HTTPS endpoint (Daytona native preview proxy, Cloudflare Quick Tunnel, or Pinggy SSH tunnel).
2. **Instant Terminal Banner**: The actual public HTTPS link and cryptographic pairing key are printed right in your terminal.
3. **Frontend / Backend Separation**:
   - **Standalone Web Dashboard (The Body)**: Host anywhere, or access live at **[https://cyberdrivepro.github.io/cybervps-space-station/](https://cyberdrivepro.github.io/cybervps-space-station/)**.
   - **One-Click Connect**: Clicking the generated link `https://cyberdrivepro.github.io/cybervps-space-station/?backend=<YOUR_TUNNEL_URL>&pair=<PAIRING_KEY>` automatically connects the dashboard frontend to your remote backend with live telemetry and authenticated control!

---

### 2. Manual Git Clone (Development)
```bash
git clone https://github.com/cyberdrivepro/cybervps-space-station.git
cd cybervps-space-station
npm install
npm start
```
- Dashboard will be live at: **`http://localhost:8080`** (and via its generated remote public HTTPS URL).

---

### 3. Connect Remote Machines (Agents)

#### 🐧 On Remote Linux Machines (Ubuntu / Debian / Root / Non-Root):
```bash
curl -sSL <YOUR_BACKEND_URL>/install.sh | bash
```

#### 🪟 On Remote Windows Machines:
```powershell
irm <YOUR_BACKEND_URL>/install.ps1 | iex
```

#### 🩺 Run System Doctor & Curl Timeout Diagnostic:
```bash
curl -sSL <YOUR_BACKEND_URL>/doctor.sh | bash
```

### 4. Start the Windows Port Bridge Daemon
To map remote ports onto your local Windows PC:
```powershell
node apps/windows-client/bridge-daemon.js <YOUR_BACKEND_URL>
```


---

## 🔒 Privilege & Permission Matrix

| Feature | Linux (Non-Root) | Linux (Root) | Windows (User) | Windows (Admin) |
|---|:---:|:---:|:---:|:---:|
| **Outbound TLS Connection** | ✅ Full | ✅ Full | ✅ Full | ✅ Full |
| **Mode A: Port Bridge (1-65535)** | ✅ Full | ✅ Full | ✅ Full | ✅ Full |
| **Port Discovery (visible sockets)** | ✅ Full | ✅ Full | ✅ Full | ✅ Full |
| **Interactive Terminal (PTY / ConPTY)** | ✅ Full | ✅ Full | ✅ Full | ✅ Full |
| **Process Inspection (all processes)** | ⚠️ Current User | ✅ All PIDs | ⚠️ Current User | ✅ All PIDs |
| **Mode B: Kernel TUN Adapter / VPN** | ⚠️ Userspace only | ✅ Native TUN | ⚠️ Userspace only | ✅ Wintun Driver |
| **Systemd Service Autostart** | ✅ `systemctl --user` | ✅ `/etc/systemd` | ⚠️ Scheduled Task | ✅ Windows Service |

---

## 🧪 Automated Verification Suite

Run the full end-to-end test suite:
```bash
node tests/run-all-tests.js
```

### Verified Test Cases:
1. **Control Plane Health & Virtual Network Configuration** (10.77.0.0/24 CIDR)
2. **All-Port Numeric Boundaries** (Port 0 rejected, Port 65535 accepted)
3. **Live Target Application** on `127.0.0.1:6767`
4. **Remote Node Agent Authentication & Mode B Virtual IP Allocation** (`10.77.0.2`)
5. **All-Port Discovery Reporting** across low, mid, and high ports
6. **Mode A Port Bridge Creation** (`127.0.0.1:16767` <---> Remote `127.0.0.1:6767`)
7. **End-to-End Bidirectional HTTP Data Transmission** through the local Windows port
8. **Conflict-Safe Port Allocation** resolving occupied ports to ephemeral fallback ports

---

## 🐳 Docker Deployment

Run the complete stack with Docker Compose:
```bash
cd deploy/compose
docker compose up -d
```

---

## 📜 License
Apache-2.0 License.
