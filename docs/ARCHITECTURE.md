# 🛰️ CyberVPS Space Station — Architecture & System Topology

This document details the architectural design, networking planes, security boundaries, and data flow mechanisms of **CyberVPS Space Station**.

---

## 1. System Overview & The Core Problem

When developing or operating services on remote infrastructure (Ubuntu, Debian, Windows Server, restricted SSH shells behind NAT, or cloud sandboxes like Daytona and Railway), applications frequently bind to loopback addresses:
- `127.0.0.1:3000` (Node.js dev servers)
- `127.0.0.1:5432` (PostgreSQL databases)
- `127.0.0.1:6767` (Internal APIs)
- `127.0.0.1:8080` (Management interfaces)

In typical environments, firewalls block incoming connections, the server lacks a public IPv4 address, or carrier-grade NAT prevents direct inbound access.

**CyberVPS Space Station** solves this by establishing **persistent outbound TLS connections** from the agent host to a central control plane. No inbound ports ever need to be opened on the agent machine.

```
+-----------------------------------------------------------------------------------+
|                            CYBERVPS SPACE STATION                                 |
|                                                                                   |
|  +--------------------+  +----------------------+  +---------------------------+  |
|  | Web Dashboard (UI) |  | WebSocket Relay Core |  | Terminal Token Authenticator|  |
|  |   (Static/CDN)     |  | (/api/v1/relay/conn) |  |   (Single-use / 60s TTL)  |  |
|  +--------------------+  +----------------------+  +---------------------------+  |
|  +----------------------------------------------+  +---------------------------+  |
|  | Public Gateway Proxy (/tunnel/:id/:port/)    |  | Virtual Subnet 10.77.0.0/24|  |
|  +----------------------------------------------+  +---------------------------+  |
+------------------------------------------+----------------------------------------+
                                           | Persistent Outbound TLS 1.3
          +--------------------------------+-------------------------------+
          |                                |                               |
          v                                v                               v
+--------------------+           +--------------------+           +--------------------+
|  LOCAL WINDOWS PC  |           |   UBUNTU/DEBIAN    |           |   CLOUD SANDBOX    |
| Mode A Port Bridge |           | Mode A + B Agent   |           | (Daytona / Docker) |
| 127.0.0.1:16767    |           | Discovers 1-65535  |           | Loopback services  |
| ConPTY Terminal    |           | Dual PTY Shell     |           | File & Process RPC |
+--------------------+           +--------------------+           +--------------------+
```

---

## 2. Networking Models: Mode A vs. Mode B

CyberVPS Space Station implements two distinct networking approaches to balance security, portability, and network capability.

### 🌉 MODE A: Universal TCP Port Bridge (Ports 1–65535)
- **Mechanism**: Pure userspace TCP stream multiplexing over the persistent WebSocket relay.
- **Privilege Requirement**: **None**. Runs as a standard non-root Linux user or unprivileged Windows user account.
- **Local Access Pattern**: Maps remote endpoints to loopback ports on your local client machine (e.g., `127.0.0.1:16767` on your Windows PC pipes data transparently to `127.0.0.1:6767` on the remote server).
- **Conflict-Safe Port Resolution**: If a requested local port (e.g., `16767`) is already bound by another application on the client machine, the bridge automatically catches `EADDRINUSE`, allocates the next available ephemeral port, and updates the dashboard without interrupting existing services.
- **Scope**: Supports any TCP application (HTTP, WebSockets, SSH, PostgreSQL, MySQL, Redis, custom binary protocols).

### 🪐 MODE B: Virtual Private Network (10.77.0.0/24 Mesh Network)
- **Mechanism**: Layer 3 IP packet tunneling over a dedicated virtual network subnet.
- **Addressing**: Allocates virtual IPs (e.g. `10.77.0.1` for Windows, `10.77.0.2` for Linux node, `10.77.0.3` for sandbox).
- **Privilege Requirement**: Requires TUN/TAP driver privileges (`root` on Linux, `Administrator` with Wintun on Windows).
- **Graceful Fallback**: If the agent detects unprivileged execution, it automatically defaults to **Mode A** without crashing or aborting connection.

---

## 3. Component Architecture

### 1. Control Plane & Public Gateway (`services/server.js`)
- **Node.js HTTP & WebSocket Server**: Listens on port `8080` (or `PORT` environment variable).
- **WebSocket Relay Endpoint** (`/api/v1/relay/connect`): Multiplexes bidirectional command frames, data packets, terminal I/O, and telemetry streams.
- **Origin Validation Engine**: Enforces strict CSWSH (Cross-Site WebSocket Hijacking) protection against an explicit allowlist.
- **Terminal Authorization Gateway**: Issues cryptographically random, single-use, 60-second machine-scoped tokens.
- **Loopback Proxy** (`/tunnel/:machineId/:port/`): Dynamically routes incoming HTTP requests to target ports on connected agents.

### 2. Universal Host Agent (`agent/universal-agent.py`)
- **Zero-Dependency Architecture**: Uses only Python 3 standard library modules (`socket`, `urllib`, `ctypes`, `subprocess`, `threading`, `json`).
- **Dynamic Port & Socket Discovery**: Inspects active TCP and UDP listening sockets across the full port range (1–65535) and probes HTTP headers/titles.
- **Host Telemetry Provider**: Reports CPU utilization, memory consumption, disk usage, active PIDs, and systemd services.
- **Remote Terminal Server**:
  - **Linux**: Spawns native pseudo-terminals (`pty.openpty()`) with support for root vs. unprivileged user execution profiles.
  - **Windows**: Implements `TokenProcess` managing ConPTY pseudo-consoles and Win32 process tokens. Automatically enforces Medium Integrity Level de-elevation (`0x2000`) for standard user terminals.
- **RPC Dispatcher**: Safely handles file listing, file reading, file editing, and process management with a built-in root directory deletion guard (`/`).

### 3. Windows Client Port Bridge (`apps/windows-client/bridge-daemon.js`)
- Runs locally on the user's Windows PC.
- Listens on `127.0.0.1:<port>` for incoming connections from local browsers, database tools, or CLI utilities.
- Tunnels TCP stream bytes over WebSocket frames to the remote agent, delivering sub-millisecond loopback forwarding.

### 4. Mission Control Dashboard (`index.html` & `apps/dashboard/`)
- Single-page application built with vanilla JavaScript, modern CSS, and xterm.js terminal integration.
- Connects to the backend via URL parameters (`?backend=...&pair=...`) or direct host detection.
- Displays real-time SSE telemetry, active port bridges, system file manager, process table, and terminal console.

---

## 4. End-to-End Execution Flow

1. **Server Initialization**: The control plane starts on a reachable server (e.g. Railway or self-hosted VPS) and prints its endpoint and cryptographic pairing key.
2. **Agent Outbound Connection**: The host agent starts on a remote machine, reads `~/.cybervps/config.json`, and dials out to `wss://<server>/api/v1/relay/connect`.
3. **Fleet Registration**: The server assigns a Virtual IP (`10.77.0.X`), registers the machine ID, and begins broadcasting health metrics via SSE.
4. **Port Scanning & Discovery**: The agent scans listening ports (e.g. `22`, `3000`, `6767`, `8080`), probes HTTP titles, and reports the topology to the control plane.
5. **Interactive Terminal Access**:
   - The user opens the dashboard and requests a terminal session.
   - Dashboard calls `POST /api/v1/terminal/token` with the master pairing key.
   - Server returns a single-use token valid for 60 seconds.
   - Dashboard connects WebSocket to `/api/v1/terminal/stream?token=<token>&machine_id=<id>`.
   - Server consumes the token immediately (preventing replay attacks) and streams PTY bytes bidirectionally.
