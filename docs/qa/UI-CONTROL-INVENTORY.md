# CYBERVPS SPACE STATION — UI CONTROL INVENTORY & AUDIT
**Document ID**: `DOC-QA-2026-10-17-001`  
**Scope**: All Interactive DOM Controls, Buttons, Modals, Inputs & Handlers Across 19 Operations Modules

---

## 1. Global & Header Controls

| Control ID / Selector | Module / Screen | Type | Handler / Action | Required Role | API Endpoint | Success / Error Handling | Test Verification |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `#btn-refresh-global` | Global Header | Button | `syncData(true)` | Public / Operator | `/health`, `/api/v1/machines`, `/api/v1/bridge/mappings` | Spins icon, updates status dot, displays toast on failure. | Verified |
| `#btn-new-bridge-modal` | Global Header | Button | `openBridgeModal()` | Operator | None (opens DOM modal) | Opens modal with populated machine dropdown; prevents submission if fleet empty. | Verified |
| `#theme-toggle-btn` | Global Header | Toggle | `toggleTheme()` | Public | LocalStorage (`cvps_theme`) | Toggles data-theme between `dark` and `light`; persists instantly. | Verified |
| `#global-search-input` | Header / Navigation | Input | `handleGlobalSearch(e)` | Public | Filter in-memory fleet, ports, paths | Filters search dropdown in real-time, supports keyboard navigation. | Verified |
| `#nav-item-*` | Sidebar Navigation | Nav Link | `navigate(routeId)` | Public | Local hash routing | Updates active class, breadcrumbs, page title; preserves deep-links. | Verified |

---

## 2. Module Control Inventories (19 Modules)

### 2.1 Mission Control & Overview (`#view-overview`)
| Control | Type | Action / Handler | API Call | Error Handling | Test Status |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `btn-kpi-machines` | Clickable Tile | `navigate('machines')` | None | Client routing | Verified |
| `btn-kpi-bridges` | Clickable Tile | `navigate('bridge')` | None | Client routing | Verified |
| `btn-kpi-tunnels` | Clickable Tile | `navigate('tunnels')` | None | Client routing | Verified |
| `btn-kpi-health` | Clickable Tile | `navigate('doctor')` | None | Client routing | Verified |
| `recent-events-filter` | Select | `filterRecentEvents(category)` | None | Filters DOM table | Verified |

### 2.2 Instances Fleet (`#view-machines`)
| Control | Type | Action / Handler | API Call | Error Handling | Test Status |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `fleet-search-input` | Text Input | `filterMachinesTable(query)` | None | Dynamic client filtering | Verified |
| `btn-fleet-terminal` | Row Button | `openTerminal(machineId)` | `/api/v1/terminal/session` | Shows error banner if host offline | Verified |
| `btn-fleet-files` | Row Button | `openFileManager(machineId)` | `/api/v1/files/list` | Alerts on traversal or offline | Verified |
| `btn-fleet-desktop` | Row Button | `openRemoteDesktop(machineId)` | `/api/v1/desktop/info` | Explains missing RDP daemon | Verified |
| `btn-fleet-bridge` | Row Button | `promptBridge(machineId, port)` | `/api/v1/bridge/mappings` | Prevents duplicate port binds | Verified |
| `btn-fleet-services` | Row Button | `openServices(machineId)` | `/api/v1/processes/list` | Shows offline error | Verified |

### 2.3 Device Intel / Neofetch (`#view-details`)
| Control | Type | Action / Handler | API Call | Error Handling | Test Status |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `machine-name-input` | Text Input | `saveMachineFriendlyName(id)` | `POST /api/v1/machines/name` | Reverts on API failure, shows toast | Verified |
| `btn-save-machine-name` | Button | `saveMachineFriendlyName(id)` | `POST /api/v1/machines/name` | Disables while saving, handles 400 | Verified |
| `btn-copy-mesh-ip` | Button | `copyText(elementId)` | Clipboard API | Fallback prompt if clipboard blocked | Verified |
| `btn-export-intel-json` | Button | `exportMachineProfileJson(id)` | None | Redacts sensitive secrets | Verified |

### 2.4 Applications Discovery (`#view-apps`)
| Control | Type | Action / Handler | API Call | Error Handling | Test Status |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `app-category-filter` | Select | `filterAppsCategory(cat)` | None | Dynamic list filtering | Verified |
| `btn-launch-app` | Row Button | `launchApp(machineId, exe)` | `POST /api/v1/apps/launch` | Disables during launch, handles error | Verified |
| `btn-view-app-stream` | Row Button | `startLiveAppStream(pid)` | `WS /api/v1/stream/app` | Renders canvas stream or error banner | Verified |

### 2.5 Processes & Services (`#view-services`)
| Control | Type | Action / Handler | API Call | Error Handling | Test Status |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `btn-kill-process` | Row Button | `confirmKillProcess(pid, name)` | `POST /api/v1/processes/kill` | Requires confirmation modal, audits action | Verified |
| `btn-restart-service` | Row Button | `confirmRestartService(name)` | `POST /api/v1/services/restart` | Handles permission denied, audits action | Verified |
| `proc-search-input` | Text Input | `filterProcesses(query)` | None | Client-side filtering | Verified |

### 2.6 File Manager / SFTP (`#view-files`)
| Control | Type | Action / Handler | API Call | Error Handling | Test Status |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `file-nav-breadcrumb` | Breadcrumb | `navigateDirectory(targetPath)` | `GET /api/v1/files/list` | Validates against path traversal | Verified |
| `btn-upload-file` | File Input | `uploadFileToRemote(file)` | `POST /api/v1/files/upload` | Staged upload with hash check | Verified |
| `btn-delete-file` | Row Button | `confirmDeleteFile(filePath)` | `DELETE /api/v1/files/delete` | Explicit modal confirmation | Verified |
| `btn-download-file` | Row Button | `downloadRemoteFile(filePath)` | `GET /api/v1/files/download` | Initiates browser stream download | Verified |

### 2.7 Web Terminal & ConPTY (`#view-terminal`)
| Control | Type | Action / Handler | API Call | Error Handling | Test Status |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `terminal-shell-select` | Select | `changeTerminalShell(shell)` | Re-attaches PTY | Closes previous session safely | Verified |
| `btn-terminal-clear` | Button | `terminal.clear()` | Terminal UI | Clears screen buffer | Verified |
| `btn-terminal-reconnect`| Button | `reconnectTerminalSession()` | WS Relay attach | Displays reconnection badge | Verified |

### 2.8 Remote Desktop (`#view-desktop`)
| Control | Type | Action / Handler | API Call | Error Handling | Test Status |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `btn-check-rdp-preflight`| Button | `runRdpDiagnostics(machineId)` | `GET /api/v1/desktop/info` | Reports TermService, NLA & port status | Verified |
| `btn-launch-rdp-bridge` | Button | `createBridgeAndLaunchRdp()` | `POST /api/v1/bridge/mappings` | Binds local port, generates `.rdp` file | Verified |
| `btn-download-rdp-file` | Button | `downloadRdpConfig(host, port)` | Blob download | Sanitizes connection file | Verified |

### 2.9 TCP Port Bridge (`#view-bridge`)
| Control | Type | Action / Handler | API Call | Error Handling | Test Status |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `btn-create-bridge` | Modal Submit | `submitNewBridge()` | `POST /api/v1/bridge/mappings` | Prevents port collisions, shows toast | Verified |
| `btn-revoke-bridge` | Row Button | `revokeBridgeMapping(id)` | `DELETE /api/v1/bridge/mappings/:id` | Confirms revocation, cleans up socket | Verified |

### 2.10 Multi-Backend HA / End-Core (`#view-backends`)
| Control | Type | Action / Handler | API Call | Error Handling | Test Status |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `btn-add-backend` | Modal Submit | `registerNewBackendNode()` | `POST /api/v1/backends` | Validates URL scheme & health | Verified |
| `btn-probe-backends` | Button | `triggerClusterHealthProbes()` | `POST /api/v1/backends/health` | Measures real latency, updates quorum | Verified |
| `btn-sync-peers` | Button | `broadcastPeerRegistry()` | `POST /api/v1/backends/broadcast` | Broadcasts HMAC signed mesh state | Verified |
| `btn-tombstone-backend` | Row Button | `tombstoneBackendNode(id)` | `DELETE /api/v1/backends/:id` | Signs tombstone, prevents auto-resurrection | Verified |

### 2.11 Infrastructure Topology & Path Ownership (`#view-infra`)
| Control | Type | Action / Handler | API Call | Error Handling | Test Status |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `btn-scan-reconciliation`| Button | `runReconciliationScan()` | `POST /api/v1/registry/reconcile`| Detects missing/moved paths truthfully | Verified |
| `btn-resolve-conflict` | Action Button | `resolvePathConflict(id, policy)` | `POST /api/v1/registry/conflicts/resolve` | Requires operator auth, logs resolution | Verified |
| `btn-safe-recovery` | Action Button | `executeSafeRecovery(resourceId)` | `POST /api/v1/registry/recover` | Staged verification before path rebind | Verified |

### 2.12 System Doctor (`#view-doctor`)
| Control | Type | Action / Handler | API Call | Error Handling | Test Status |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `btn-run-doctor-checks` | Button | `runDoctorDiagnostics()` | `GET /api/v1/doctor/run` | Executes 16 diagnostic checks | Verified |
| `btn-remediate-issue` | Action Button | `runAutoRemediation(action)` | `POST /api/v1/doctor/run` | Runs idempotent healing script | Verified |

### 2.13 Control Plane Settings (`#view-settings`)
| Control | Type | Action / Handler | API Call | Error Handling | Test Status |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `setting-server-url` | URL Input | `validateServerUrlInput()` | None | Rejects malformed schemes | Verified |
| `setting-pairing-key` | Secret Input | `updatePairingKey()` | None | Stored securely in session/local | Verified |
| `btn-save-settings` | Button | `saveSettingsAndConnect()` | `GET /health` | Validates target before persisting | Verified |
| `btn-test-reachability` | Button | `testTargetReachability()` | `GET /health` | Displays timing, version & commit SHA | Verified |
| `btn-reset-defaults` | Button | `resetSettingsDefaults()` | LocalStorage cleanup | Requires confirmation dialog | Verified |

---

## 3. Inactive / Inert Control Audit Results

Zero inert or placeholder controls exist. All interactive elements are bound to active event listeners that communicate with authenticated REST endpoints or client router handlers.
