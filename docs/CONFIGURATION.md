# ⚙️ CyberVPS Space Station — Configuration Reference

This guide documents all environment variables, configuration files, and default file paths used by CyberVPS Space Station.

---

## 1. Central Control Plane Environment Variables

When running `services/server.js` directly or via Docker Compose, configure these variables:

| Variable | Type | Default | Description |
|---|---|---|---|
| `PORT` | Integer | `8080` | Port for the HTTP and WebSocket server. |
| `PAIRING_KEY` | String | *(Auto-generated)* | Cryptographic master key required for pairing clients and authenticating agents. |
| `ALLOWED_ORIGINS` | String (CSV) | *(Standard domains)* | Comma-separated list of additional trusted WebSocket `Origin` header values. |
| `ENABLE_TUNNEL` | Boolean | `true` | When true, attempts to initialize public HTTPS tunneling (Pinggy / Cloudflare / Daytona). |
| `TUNNEL_PROVIDER`| String | `auto` | Preferred tunnel provider: `auto`, `pinggy`, `cloudflare`, `daytona`, or `none`. |
| `BASE_DOMAIN` | String | `localhost` | Base domain name used for virtual host routing. |
| `VIRTUAL_SUBNET` | String | `10.77.0.0/24` | CIDR block for Mode B virtual IP address assignment. |
| `DATA_DIR` | String | `~/.cybervps/data` | Directory where persistent machine state and sessions are stored. |

---

## 2. Host Agent Configuration File (`~/.cybervps/config.json`)

The host agent reads and writes configuration in JSON format at:
- **Linux / macOS**: `~/.cybervps/config.json`
- **Windows**: `C:\Users\<User>\.cybervps\config.json`

### Example `config.json`:
```json
{
  "server_url": "https://cybervps-space-station.up.railway.app",
  "token": "cvps_enroll_master_token",
  "machine_id": "cvps_ubuntu_e2a91f",
  "hostname": "vps-ubuntu-01"
}
```

### Fields:
- `server_url`: HTTPS or WSS target URL of the central control plane.
- `token`: Enrollment pairing key matching the server's `PAIRING_KEY`.
- `machine_id`: Unique identifier assigned to the host during initial enrollment.
- `hostname`: Friendly hostname reported to the fleet dashboard.

---

## 3. Runtime Files & Log Paths

| File Path | Description |
|---|---|
| `~/.cybervps/run/space-station.pid` | Process ID file for the running control plane server. |
| `~/.cybervps/run/agent.pid` | Process ID file for the background host agent daemon. |
| `~/.cybervps/logs/space-station.log`| Output log for server requests, connections, and tunnel events. |
| `~/.cybervps/logs/agent.log` | Output log for host agent telemetry, port discovery, and relay events. |
| `~/.cybervps/data/fleet.json` | Persistent state file maintaining enrolled node profiles across restarts. |
