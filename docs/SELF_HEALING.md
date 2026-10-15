# CyberVPS Space Station - Autonomous Multi-Backend Mesh & Self-Healing Redundancy

## 1. Overview & Core Guarantees

CyberVPS Space Station is designed for resilient, unattended operation across distributed cloud instances, dev sandboxes, and **multi-tenant shared RDP hosts** (e.g., rdphostings.com). In shared RDP environments, other users often kill processes, delete user-profile files, or clean up temporary files. 

The Autonomous Self-Healing and Multi-Backend Mesh architecture guarantees:
1. **Zero Disconnection via 3-Backend Redundancy**: Fleet nodes maintain synchronized access to at least 3 distributed backend endpoints (e.g., Railway, Render, custom VPS nodes). If any backend fails or spins down, nodes instantly rotate to another healthy backend in the pool without dropping agent state.
2. **Instant Fleet-Wide Auto-Provisioning**: When any new backend is added or modified via the CyberVPS Control Plane (`POST /api/v1/backends` or the Dashboard), the control plane immediately dispatches `SyncBackendPool` across all active nodes, updating their local configuration and shadow mirrors.
3. **Dual-Location Shadow Redundancy**: The agent executable and configuration are maintained in two isolated, safe locations:
   - **Primary**: `~/.cybervps/` (User home directory)
   - **Shadow**: `%LOCALAPPDATA%\CyberVPS` (Windows) or `~/.local/share/cybervps` (Linux)
   If another user on a shared RDP deletes or corrupts the primary agent executable, the running process or supervisor detects the modification within 30 seconds and restores it from the shadow copy (and vice-versa).
4. **Strict Safety Path Boundaries**: Redundancy and shadow copies are **strictly forbidden** from writing to user personal folders:
   - 🚫 `Desktop`
   - 🚫 `Downloads`
   - 🚫 `Documents`
   - 🚫 `Videos`
   - 🚫 `Music`
   - 🚫 `Pictures`
   All redundancy files are contained exclusively in dedicated application directories.
5. **Cryptographic & Syntax Validation**: Any restored or rebuilt code is compiled with `py_compile` before replacement. If code is invalid or smaller than 15 KB, it is rejected and external recovery is triggered from GitHub or the control plane.
6. **Legitimate, Auditable Operator Controls**: Every self-healing and redundancy action is logged. A clean CLI (`cybervps`) provides operator management including graceful restart, one-click healing, and uninstallation.

---

## 2. Multi-Backend HA Mesh Architecture

```
                  ┌─────────────────────────────────────┐
                  │ CyberVPS Control Plane Dashboard   │
                  │   (Admin registers new backend)     │
                  └──────────────────┬──────────────────┘
                                     │
                    Auto-Broadcasts 'SyncBackendPool'
                                     │
             ┌───────────────────────┼───────────────────────┐
             ▼                       ▼                       ▼
   ┌───────────────────┐   ┌───────────────────┐   ┌───────────────────┐
   │ Fleet Node: Win10 │   │ Fleet Node: Ubuntu│   │ Fleet Node: RDP   │
   │ 3-Backend Mesh:   │   │ 3-Backend Mesh:   │   │ 3-Backend Mesh:   │
   │ - Railway Cloud   │   │ - Railway Cloud   │   │ - Railway Cloud   │
   │ - Render Cloud    │   │ - Render Cloud    │   │ - Render Cloud    │
   │ - Custom VPS      │   │ - Custom VPS      │   │ - Custom VPS      │
   └───────────────────┘   └───────────────────┘   └───────────────────┘
```

### Dynamic Mesh Rebalancing
- Fleet nodes dynamically rotate through `self.backend_pool` when WebSocket ping timeouts or TCP resets occur.
- When `AuthAck` is returned by any control plane, the payload includes the current active backend cluster and synchronizes both primary and shadow `backends.json`.

---

## 3. Dual-Location Shadow Redundancy Workflow

```
[Agent Active] <────── Every 30 seconds ──────> [_reconcile_shadow_mirror]
       │                                                      │
       ├─► Check Primary: ~/.cybervps/universal-agent.py      │
       ├─► Check Shadow:  %LOCALAPPDATA%/CyberVPS/universal-agent.py
       │                                                      │
       ├── Case A: Primary deleted by shared RDP user ────────┼─► Copy Shadow ──► Primary
       ├── Case B: Shadow deleted or missing ────────────────┼─► Copy Primary ─► Shadow
       └── Case C: Both missing/damaged ──────────────────────┼─► Download from GitHub ──► Verify (py_compile) ──► Rebuilt
```

---

## 4. CLI Operator Commands (`cybervps`)

The agent includes a unified command-line tool accessible on both Windows (`cybervps.cmd`) and Linux (`cybervps`):

| Command | Purpose |
|---|---|
| `cybervps status` | Inspects agent process PID, primary path, shadow redundancy status, Windows autostart state, and live reachability of all configured backends. |
| `cybervps heal` | Runs a complete self-healing verification: checks script integrity, restores missing shadow/primary files, verifies the 3-backend policy, validates the Windows autostart Run key, and re-spawns the agent if stopped. |
| `cybervps restart` | Gracefully terminates and re-spawns the agent daemon. |
| `cybervps start` | Starts the agent in background mode. |
| `cybervps stop` | Stops the running agent process cleanly. |
| `cybervps rebuild` | Downloads the authoritative latest agent from GitHub, validates syntax, updates primary and shadow copies, and restarts the agent. |
| `cybervps uninstall` | Terminates the agent process and removes the Windows autostart Run key (`HKCU:\Software\Microsoft\Windows\CurrentVersion\Run\CyberVPSAgent`). |
| `cybervps reboot` | Gracefully dispatches a host machine reboot. |

---

## 5. Control Plane Remote Actions

From the CyberVPS Space Station Dashboard, operators can trigger actions directly against any fleet machine:

1. **Reboot Host**: Dispatches `RebootHost` via WebSocket. The control plane marks the node as `restarting` for 120s to prevent false offline alarms.
2. **Restart Agent**: Dispatches `RestartAgent`. The agent safely re-spawns itself detached and re-establishes the WebSocket link.
3. **Rebuild Agent**: Dispatches `RebuildAgent`. The agent pulls authoritative code from GitHub, validates syntax with `py_compile`, updates both primary and shadow copies, and re-launches.
4. **Sync Mesh to Fleet**: Dispatches `SyncBackendPool` with all registered backend endpoints to every enrolled machine.
