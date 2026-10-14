# 🛰️ CyberVPS Space Station — REST & WebSocket API Reference

This document provides a comprehensive reference of all endpoints exposed by the CyberVPS Control Plane (`services/server.js`).

---

## 1. System Health & Configuration

### `GET /health`
Returns the status of the control plane and virtual network allocation.
- **Auth**: None
- **Response `200 OK`**:
```json
{
  "status": "healthy",
  "version": "1.0.0",
  "uptime": 1248.5,
  "virtual_network": {
    "cidr": "10.77.0.0/24",
    "allocated_ips": 3
  }
}
```

### `GET /api/v1/config`
Returns public server configuration parameters for the frontend dashboard.
- **Auth**: None
- **Response `200 OK`**:
```json
{
  "base_domain": "cybervps-space-station.up.railway.app",
  "tunnel_enabled": true,
  "virtual_subnet": "10.77.0.0/24",
  "pairing_required": true
}
```

---

## 2. Remote Access & Pairing Management

### `GET /api/v1/access/status`
Returns remote access URLs, active tunnel providers, and pairing state.
- **Auth**: Bearer token (`PAIRING_KEY`)

### `POST /api/v1/access/pair`
Validates a pairing key provided by the web client.
- **Body**: `{ "token": "<PAIRING_KEY>" }`
- **Response `200 OK`**: `{ "paired": true, "session": "<UUID>" }`
- **Error `401 Unauthorized`**: `{ "error": "Invalid pairing token" }`

---

## 3. Fleet & Node Inventory

### `GET /api/v1/nodes`
Lists all enrolled remote host agents, their virtual IPs, discovered ports, and online state.
- **Auth**: Bearer token (`PAIRING_KEY`)
- **Response `200 OK`**:
```json
[
  {
    "id": "cvps_ubuntu_e2a91f",
    "hostname": "vps-ubuntu-01",
    "os": "linux",
    "arch": "x86_64",
    "virtual_ip": "10.77.0.2",
    "status": "online",
    "last_seen": 1728892000000,
    "ports": [
      { "port": 22, "protocol": "tcp", "service": "ssh" },
      { "port": 6767, "protocol": "tcp", "title": "Internal API" }
    ]
  }
]
```

### `PATCH /api/v1/nodes/:id`
Updates friendly display name and metadata for a specific machine.
- **Auth**: Bearer token (`PAIRING_KEY`)
- **Body**: `{ "friendly_name": "Production Master Node" }`

---

## 4. Real-Time Telemetry Stream (SSE)

### `GET /api/v1/telemetry/stream`
Server-Sent Events (SSE) stream providing real-time CPU, RAM, disk, and network stats updated every 2 seconds.
- **Auth**: Query parameter `token=<PAIRING_KEY>`
- **Event format**:
```
event: telemetry
data: {"machine_id":"cvps_ubuntu_e2a91f","cpu":14.2,"ram_used_mb":1024,"ram_total_mb":4096,"disk_used_pct":42}
```

---

## 5. Remote Terminal & Streaming

### `POST /api/v1/terminal/token`
Generates a short-lived, single-use, machine-scoped terminal access token.
- **Auth**: Bearer token (`PAIRING_KEY`)
- **Body**:
```json
{
  "machine_id": "cvps_ubuntu_e2a91f",
  "profile": "standard"
}
```
- **Response `200 OK`**:
```json
{
  "token": "term_sec_a8f9c011e42d",
  "machine_id": "cvps_ubuntu_e2a91f",
  "profile": "standard",
  "expires_in": 60
}
```

### `WebSocket /api/v1/terminal/stream`
Interactive bi-directional terminal stream.
- **Query Parameters**:
  - `token`: Single-use token acquired from `POST /api/v1/terminal/token`.
  - `machine_id`: Target machine ID.
  - `cols`: Terminal columns (default `80`).
  - `rows`: Terminal rows (default `24`).
- **Headers**: Checked against Origin allowlist (`cyberdrivepro.github.io`, etc.).
- **Security**: The token is invalidated on first use. Direct master pairing keys are rejected with `401`.

---

## 6. Remote Host RPCs (Files, Processes, Services)

All RPC endpoints require Bearer authentication with the master pairing key.

| Method | Endpoint | Purpose |
|---|---|---|
| `POST` | `/api/v1/files/list` | List directory contents (`{ "machine_id": "...", "path": "/home" }`) |
| `POST` | `/api/v1/files/read` | Read text file contents (`{ "path": "/path/to/file" }`) |
| `POST` | `/api/v1/files/write` | Write content to remote file |
| `POST` | `/api/v1/files/delete` | Delete file/directory (**Guarded**: root `/` blocked) |
| `POST` | `/api/v1/processes/list` | Inspect active PIDs, CPU %, memory usage |
| `POST` | `/api/v1/processes/kill` | Terminate process by PID |
| `POST` | `/api/v1/services/list` | List systemd / Windows services |
| `POST` | `/api/v1/services/action` | Start, stop, or restart a system service |

---

## 7. Public Gateway Loopback Proxy

### `GET /tunnel/:machineId/:port/*`
Proxies web traffic directly to the target port on the remote agent machine over the persistent WebSocket relay.
- Example: `https://cybervps-space-station.up.railway.app/tunnel/cvps_ubuntu_e2a91f/6767/api/v1/status`
- Transparently routes loopback HTTP responses back to the browser.
