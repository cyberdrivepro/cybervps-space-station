# 🔒 CyberVPS Space Station — Security Policy & Technical Threat Model

CyberVPS Space Station is designed for remote systems management and port tunneling. Because remote command execution and network forwarding represent high-privilege operations, the project enforces strict defense-in-depth principles.

---

## 1. Security Architecture & Threat Mitigations

### 🛡️ 1. Cross-Site WebSocket Hijacking (CSWSH) Protection
**Risk**: If an attacker hosts a malicious website, the victim's browser might open a WebSocket connection to the CyberVPS backend from an untrusted origin.  
**Mitigation**:
- In [`services/server.js`](../services/server.js), incoming WebSocket connections (`/api/v1/terminal/stream` and `/api/v1/relay/connect`) are checked against an explicit trusted Origin allowlist:
  - `cyberdrivepro.github.io`
  - `cybervps-space-station.up.railway.app`
  - Server `Host` header
  - `localhost` and `127.0.0.1` (local development)
  - Custom domains configured via `ALLOWED_ORIGINS` environment variable.
- Any request from an unlisted origin is immediately terminated with **HTTP 403 Forbidden**.
- Defense-in-depth check: Browser WebSocket upgrade attempts presenting fetch metadata headers (`sec-fetch-site`, `sec-fetch-mode`) without an `Origin` header are strictly rejected.

### 🔑 2. Single-Use, Short-Lived Terminal Token Flow
**Risk**: Long-lived API keys in WebSocket query parameters risk exposure in server access logs, browser history, and proxy traces.  
**Mitigation**:
1. Browsers cannot connect directly to `/api/v1/terminal/stream` using the master pairing key. Direct pairing keys on WebSocket streams are rejected with **HTTP 401 Unauthorized**.
2. Clients must execute an authenticated HTTP request:
   ```http
   POST /api/v1/terminal/token
   Authorization: Bearer <MASTER_PAIRING_KEY>
   Content-Type: application/json

   { "machine_id": "cvps_ubuntu_e2a91f", "profile": "standard" }
   ```
3. The server generates a cryptographically random, machine-scoped token valid for **60 seconds**.
4. Upon WebSocket connection, the token is **immediately invalidated and deleted** from memory. Subsequent connection attempts using the same token (replay attacks) fail with **HTTP 401**.

### 🪟 3. Windows Process Token De-Elevation & Lifecycle
**Risk**: When the host agent runs as an elevated Administrator, opening a "Standard User" terminal might accidentally inherit elevated system privileges.  
**Mitigation**:
- [`agent/universal-agent.py`](../agent/universal-agent.py) implements `TokenProcess` using Win32 API functions:
  - Opens the current process token.
  - Queries user token identity and duplicates it.
  - Sets token integrity level to `SECURITY_MANDATORY_MEDIUM_RID` (`0x2000`).
  - Spawns the child process (`cmd.exe` or `powershell.exe`) using `CreateProcessAsUserW` or restricted token assignment.
- Verified in [`tests/test-agent-security.py`](../tests/test-agent-security.py):
  - Token Integrity RID unconditionally asserts `0x2000` (Medium).
  - `TokenElevation` unconditionally asserts `False`.
  - Process handle remains open across `terminate()` and `kill()` until exit code is verified (`!= STILL_ACTIVE`).
  - If a non-privileged agent is asked to spawn an elevated profile, it strictly **fails closed** with exit code 1.

### 🐧 4. Linux Privilege Boundaries & UID Dropping
- Unprivileged agents running under non-root user accounts strictly reject requests to execute root shells.
- Root agents executing unprivileged terminal sessions drop privileges to the host user's UID and GID before executing the target shell.

### 📁 5. Root Directory Deletion Guard
- File Manager APIs (`/api/v1/files/delete`) validate target paths:
  - Resolves symlinks and canonical path strings.
  - Rejects attempts to delete root directories (`/`, `C:\`, `/boot`, `/etc`, `/sys`, `/proc`) with **HTTP 400 Bad Request**.

---

## 2. Best Practices for Operators

1. **Protect the Pairing Key**: Never commit your `PAIRING_KEY` to public Git repositories or paste it into public discussion channels.
2. **Restrict Public Endpoints**: If hosting the backend publicly, ensure `ALLOWED_ORIGINS` is restricted only to your trusted dashboard domain.
3. **Run Non-Root Agents**: Unless you specifically require Mode B Kernel TUN networking, run the host agent under a standard, unprivileged user account.

---

## 3. Reporting a Vulnerability

If you discover a security vulnerability in CyberVPS Space Station:
1. Please **do not** open a public GitHub issue.
2. Contact the maintainers privately via GitHub Security Advisories or direct communication.
3. Include a detailed reproduction script and proof-of-concept. Maintainers will review, verify, and publish a patch promptly.
