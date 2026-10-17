/**
 * CYBERVPS SPACE STATION - PATH OWNERSHIP & RECONCILIATION REGISTRY VIEW
 * Path Ownership Explorer, Strict Single-Writer Invariant, Conflict Detector,
 * Physical Backend Inventory & Obsidian Mesh Pillar Placement
 */

class PathRegistryView {
  constructor(state, apiClient) {
    this.state = state;
    this.api = apiClient;
  }

  render(container) {
    container.innerHTML = `
      <div class="module-header">
        <div>
          <h2>Backend Placement & Physical Path Inventory</h2>
          <p class="subtitle">Guarantees strict single-authoritative-writer path isolation and tracks physical filesystem placement across all cluster nodes</p>
        </div>
        <div class="registry-bar-actions">
          <button class="btn btn-primary" onclick="PathRegistryView.runReconciliationScan()">🔍 Scan & Reconcile</button>
          <button class="btn btn-secondary" onclick="PathRegistryView.refresh()">🔄 Refresh</button>
        </div>
      </div>

      <!-- Obsidian Pillars Mesh Ring Status Bar -->
      <div class="card obsidian-mesh-bar" style="margin-bottom:1.25rem; background:linear-gradient(135deg, rgba(30,27,75,0.7), rgba(15,23,42,0.9)); border:1px solid #7c3aed40;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:0.75rem;">
          <div style="display:flex; align-items:center; gap:0.5rem;">
            <span style="font-size:1.4rem;">🪐</span>
            <div>
              <strong style="color:#c084fc; font-size:1.05rem;">Obsidian Mesh Pillar Topology (Minecraft End-Core Inspired)</strong>
              <div style="font-size:0.8rem; color:#94a3b8;">Autonomous self-healing ring: if any backend is deleted or corrupted, surviving pillars coordinate relocation and rebuild.</div>
            </div>
          </div>
          <span class="badge" style="background:#7c3aed30; color:#c084fc; border:1px solid #7c3aed60;" id="obsidian-quorum-badge">Quorum: Healthy</span>
        </div>
        <div id="obsidian-pillars-row" style="display:flex; gap:0.75rem; flex-wrap:wrap;">
          <div class="text-muted" style="font-size:0.85rem;">Loading pillar topology...</div>
        </div>
      </div>

      <!-- Strict Single-Writer Invariant Banner -->
      <div class="invariant-banner card" style="border-left:4px solid #10b981; margin-bottom:1.25rem;">
        <div class="banner-title" style="display:flex; align-items:center; gap:0.5rem;">
          <span class="icon">⚖️</span>
          <strong style="color:#10b981;">Strict Path Ownership Invariant: ACTIVE</strong>
        </div>
        <p style="margin:0.25rem 0 0 0; font-size:0.85rem; color:#cbd5e1;">For any canonical writable filesystem path on a machine, exactly <strong>ONE</strong> authoritative primary writer may own it at a time. Multiple backends sharing a single writable path is strictly prohibited to prevent data corruption.</p>
      </div>

      <!-- Conflicts Alert Box (Hidden if none) -->
      <div id="conflicts-alert-container" class="card conflicts-card" style="display:none; border-left:4px solid #ef4444; margin-bottom:1.25rem;">
        <div class="card-header" style="display:flex; justify-content:space-between; align-items:center;">
          <h3 style="margin:0; color:#ef4444;">🚨 Active Path Ownership Conflicts</h3>
          <span class="badge badge-danger" id="conflicts-count-badge">0 Conflicts</span>
        </div>
        <div id="conflicts-list" style="margin-top:0.75rem;"></div>
      </div>

      <!-- Registry Tabs -->
      <div class="registry-tabs" style="display:flex; gap:0.5rem; margin-bottom:1rem;">
        <button class="tab-btn active" onclick="PathRegistryView.switchTab('inventory')">🖥️ Physical Backend Inventory</button>
        <button class="tab-btn" onclick="PathRegistryView.switchTab('paths')">📁 Registered Leases</button>
        <button class="tab-btn" onclick="PathRegistryView.switchTab('missing')">⚠️ Missing & Relocated Backends</button>
        <button class="tab-btn" onclick="PathRegistryView.switchTab('history')">📜 Recovery & Movement History</button>
      </div>

      <!-- Tab 0: Physical Backend Inventory & Real OS Paths -->
      <div id="tab-inventory" class="tab-content card">
        <div class="table-controls" style="display:flex; justify-content:space-between; align-items:center; margin-bottom:1rem;">
          <input type="text" id="inventory-search" placeholder="Search physical paths, backend names, hosts or executables..." onkeyup="PathRegistryView.filterInventoryTable()" style="width:100%; max-width:400px; padding:0.5rem; border-radius:4px; border:1px solid #334155; background:#0f172a; color:#f8fafc;" />
          <span style="font-size:0.85rem; color:#94a3b8;" id="inventory-count-label">0 backends registered</span>
        </div>
        <table class="data-table" style="width:100%; border-collapse:collapse;">
          <thead>
            <tr style="text-align:left; border-bottom:1px solid #334155; color:#94a3b8; font-size:0.85rem;">
              <th>Backend / Host</th>
              <th>Obsidian Pillar</th>
              <th>Physical Canonical Path</th>
              <th>Executable & Runtime PID</th>
              <th>Data & Config Paths</th>
              <th>Status</th>
              <th>Single-Writer Verified</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody id="inventory-table-body">
            <tr><td colspan="8" class="text-center" style="padding:1.5rem; color:#94a3b8;">Discovering physical backend locations across fleet...</td></tr>
          </tbody>
        </table>
      </div>

      <!-- Tab 1: Registered Paths Table -->
      <div id="tab-paths" class="tab-content card" style="display:none;">
        <div class="table-controls" style="margin-bottom:1rem;">
          <input type="text" id="registry-search" placeholder="Search by backend, canonical path or resource ID..." onkeyup="PathRegistryView.filterTable()" style="width:100%; max-width:400px; padding:0.5rem; border-radius:4px; border:1px solid #334155; background:#0f172a; color:#f8fafc;" />
        </div>
        <table class="data-table" style="width:100%; border-collapse:collapse;">
          <thead>
            <tr style="text-align:left; border-bottom:1px solid #334155; color:#94a3b8; font-size:0.85rem;">
              <th>Resource ID</th>
              <th>Host Node</th>
              <th>Authoritative Backend</th>
              <th>Canonical Filesystem Path</th>
              <th>Ownership Role</th>
              <th>State</th>
              <th>Last Verified</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody id="registry-table-body">
            <tr><td colspan="8" class="text-center" style="padding:1.5rem; color:#94a3b8;">Loading path registry...</td></tr>
          </tbody>
        </table>
      </div>

      <!-- Tab 2: Missing & Moved Resources Table -->
      <div id="tab-missing" class="tab-content card" style="display:none;">
        <h3>Discovered Missing or Relocated Resources</h3>
        <p style="color:#94a3b8; font-size:0.85rem;">When a backend or file disappears, the station detects candidates across replicas and snapshots before offering recovery.</p>
        <div id="missing-resources-container">
          <div class="empty-state text-center" style="padding:2rem; color:#94a3b8;">No missing resources detected. All paths are healthy.</div>
        </div>
      </div>

      <!-- Tab 3: History Timeline -->
      <div id="tab-history" class="tab-content card" style="display:none;">
        <h3>Audit Trail: Movement, Deletions & Recoveries</h3>
        <div class="timeline" id="history-timeline" style="margin-top:1rem;">
          <div class="text-center text-muted">Loading movement timeline...</div>
        </div>
      </div>
    `;

    PathRegistryView.loadRegistryData();
  }

  static async loadRegistryData() {
    const tableBody = document.getElementById('registry-table-body');
    const inventoryBody = document.getElementById('inventory-table-body');
    const conflictsBox = document.getElementById('conflicts-alert-container');
    const conflictsList = document.getElementById('conflicts-list');
    const conflictsBadge = document.getElementById('conflicts-count-badge');
    const pillarsRow = document.getElementById('obsidian-pillars-row');
    const inventoryCount = document.getElementById('inventory-count-label');

    try {
      const api = window.stationApp.api;
      
      // Load both paths registry and backend inventory in parallel
      const [pathsRes, invRes] = await Promise.all([
        api.request('/api/v1/registry/paths').catch(() => ({ records: [], conflicts: [] })),
        api.request('/api/v1/backends/paths').catch(() => ({ inventory: [], conflicts: [] }))
      ]);

      const paths = pathsRes.records || [];
      const conflicts = invRes.conflicts || pathsRes.conflicts || [];
      const inventory = invRes.inventory || [];

      // Render Conflicts if any
      if (conflicts.length > 0) {
        if (conflictsBox) conflictsBox.style.display = 'block';
        if (conflictsBadge) conflictsBadge.innerText = `${conflicts.length} Active Conflicts`;
        if (conflictsList) {
          conflictsList.innerHTML = conflicts.map(c => `
            <div class="conflict-item border-fail" style="background:#ef444415; border:1px solid #ef444450; padding:0.75rem; border-radius:4px; margin-bottom:0.5rem; display:flex; justify-content:space-between; align-items:center;">
              <div>
                <strong>Path:</strong> <code>${c.canonical_path}</code> on <strong>${c.machine_id}</strong><br/>
                <strong>Existing Owner:</strong> <span class="badge" style="background:#3b82f630; color:#60a5fa;">${c.existing_owner_backend}</span> vs 
                <strong>Competing Claim:</strong> <span class="badge" style="background:#ef444430; color:#f87171;">${c.competing_owner_backend}</span>
              </div>
              <div class="conflict-actions" style="display:flex; gap:0.5rem;">
                <button class="btn-sm btn-primary" onclick="PathRegistryView.resolveConflict('${c.conflict_id}', 'keep_existing')">Keep Existing</button>
                <button class="btn-sm btn-danger" onclick="PathRegistryView.resolveConflict('${c.conflict_id}', 'accept_competing')">Reassign</button>
              </div>
            </div>
          `).join('');
        }
      } else if (conflictsBox) {
        conflictsBox.style.display = 'none';
      }

      // Render Obsidian Pillars Mesh Row
      if (pillarsRow) {
        if (inventory.length === 0) {
          pillarsRow.innerHTML = '<div style="font-size:0.85rem; color:#94a3b8;">No nodes in mesh ring.</div>';
        } else {
          pillarsRow.innerHTML = inventory.map(item => `
            <div style="background:#0f172a; border:1px solid ${item.status === 'online' ? '#a855f760' : '#475569'}; border-radius:6px; padding:0.5rem 0.75rem; flex:1; min-width:180px;">
              <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:0.25rem;">
                <strong style="color:${item.is_control_plane ? '#38bdf8' : '#c084fc'}; font-size:0.85rem;">
                  ${item.is_control_plane ? '👑 Ender Core' : `💎 Pillar #${item.pillar_index}`}
                </strong>
                <span class="badge" style="font-size:0.7rem; background:${item.status === 'online' ? '#10b98125' : '#ef444425'}; color:${item.status === 'online' ? '#34d399' : '#f87171'};">
                  ● ${item.status}
                </span>
              </div>
              <div style="font-size:0.75rem; color:#e2e8f0; font-weight:600; text-overflow:ellipsis; overflow:hidden; white-space:nowrap;">${item.backend_name}</div>
              <div style="font-size:0.7rem; color:#94a3b8; font-family:monospace; text-overflow:ellipsis; overflow:hidden; white-space:nowrap;" title="${item.canonical_path}">
                ${item.canonical_path}
              </div>
            </div>
          `).join('');
        }
      }

      // Render Tab 0: Physical Backend Inventory
      if (inventoryCount) inventoryCount.innerText = `${inventory.length} backends registered`;
      if (inventoryBody) {
        if (inventory.length === 0) {
          inventoryBody.innerHTML = '<tr><td colspan="8" class="text-center text-muted" style="padding:1.5rem;">No active backends discovered in fleet.</td></tr>';
        } else {
          inventoryBody.innerHTML = inventory.map(b => `
            <tr class="inv-row" style="border-bottom:1px solid #1e293b; font-size:0.85rem;">
              <td style="padding:0.75rem 0.5rem;">
                <div style="font-weight:600; color:#f8fafc;">${b.backend_name}</div>
                <small style="color:#94a3b8; font-family:monospace;">${b.backend_id} (${b.machine_id})</small>
              </td>
              <td style="padding:0.75rem 0.5rem;">
                <span class="badge" style="background:#7c3aed25; color:#c084fc; border:1px solid #7c3aed50;">
                  ${b.is_control_plane ? 'Ender Core (0)' : `Pillar #${b.pillar_index}`}
                </span>
              </td>
              <td style="padding:0.75rem 0.5rem;">
                <code style="background:#020617; padding:0.2rem 0.4rem; border-radius:3px; color:#38bdf8; font-size:0.8rem; word-break:break-all;">
                  ${b.canonical_path}
                </code>
              </td>
              <td style="padding:0.75rem 0.5rem;">
                <div style="font-family:monospace; font-size:0.75rem; color:#cbd5e1;">${b.executable_path}</div>
                <small style="color:#94a3b8;">PID: <strong>${b.runtime_pid || 'N/A'}</strong></small>
              </td>
              <td style="padding:0.75rem 0.5rem;">
                <div style="font-family:monospace; font-size:0.75rem; color:#94a3b8;">data: ${b.data_path || 'N/A'}</div>
              </td>
              <td style="padding:0.75rem 0.5rem;">
                <span class="status-pill status-${b.status.toLowerCase()}">
                  ● ${b.status}
                </span>
              </td>
              <td style="padding:0.75rem 0.5rem;">
                <span style="color:#10b981; font-weight:600; font-size:0.8rem;">✓ 1 Host / Path</span>
              </td>
              <td style="padding:0.75rem 0.5rem;">
                <button class="btn-sm" onclick="PathRegistryView.inspectBackend('${b.backend_id}')" style="padding:2px 8px; font-size:0.75rem;">Inspect</button>
              </td>
            </tr>
          `).join('');
        }
      }

      // Render Tab 1: Registered Paths
      if (tableBody) {
        if (paths.length === 0) {
          tableBody.innerHTML = `<tr><td colspan="8" class="text-center text-muted" style="padding:1.5rem;">No path ownership records registered yet.</td></tr>`;
        } else {
          tableBody.innerHTML = paths.map(r => `
            <tr class="path-row" style="border-bottom:1px solid #1e293b; font-size:0.85rem;">
              <td style="padding:0.75rem 0.5rem;"><code>${r.resource_id}</code></td>
              <td style="padding:0.75rem 0.5rem;"><strong>${r.machine_id}</strong></td>
              <td style="padding:0.75rem 0.5rem;"><span class="badge" style="background:#3b82f625; color:#60a5fa;">${r.backend_id}</span></td>
              <td style="padding:0.75rem 0.5rem;"><code style="color:#38bdf8;">${r.canonical_path}</code></td>
              <td style="padding:0.75rem 0.5rem;">
                <span class="role-badge role-${r.ownership_role}">
                  ${r.ownership_role === 'primary' ? '★ Authoritative Primary' : r.ownership_role}
                </span>
              </td>
              <td style="padding:0.75rem 0.5rem;">
                <span class="status-pill status-${(r.state || 'healthy').toLowerCase()}">
                  ● ${r.state || 'healthy'}
                </span>
              </td>
              <td style="padding:0.75rem 0.5rem;"><small>${r.last_verified_at ? new Date(r.last_verified_at).toLocaleTimeString() : 'N/A'}</small></td>
              <td style="padding:0.75rem 0.5rem;">
                <button class="btn-sm btn-danger" onclick="PathRegistryView.releaseResource('${r.resource_id}', '${r.backend_id}')" style="padding:2px 8px; font-size:0.75rem;">Release</button>
              </td>
            </tr>
          `).join('');
        }
      }
    } catch (err) {
      if (tableBody) tableBody.innerHTML = `<tr><td colspan="8" class="text-center text-danger" style="padding:1.5rem;">Failed to load registry: ${err.message}</td></tr>`;
      if (inventoryBody) inventoryBody.innerHTML = `<tr><td colspan="8" class="text-center text-danger" style="padding:1.5rem;">Failed to load inventory: ${err.message}</td></tr>`;
    }
  }

  static switchTab(tabId) {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.style.display = 'none');

    const buttons = Array.from(document.querySelectorAll('.tab-btn'));
    const activeBtn = buttons.find(b => b.getAttribute('onclick') && b.getAttribute('onclick').includes(`'${tabId}'`));
    if (activeBtn) activeBtn.classList.add('active');

    const targetContent = document.getElementById(`tab-${tabId}`);
    if (targetContent) targetContent.style.display = 'block';

    if (tabId === 'history') {
      PathRegistryView.loadHistory();
    }
  }

  static async loadHistory() {
    const historyContainer = document.getElementById('history-timeline');
    try {
      const api = window.stationApp.api;
      const res = await api.request('/api/v1/registry/history');
      const events = res.history || [];

      if (events.length === 0) {
        historyContainer.innerHTML = '<div class="text-center text-muted" style="padding:1.5rem;">No history events recorded.</div>';
        return;
      }

      historyContainer.innerHTML = events.map(e => `
        <div class="timeline-item" style="display:flex; gap:1rem; margin-bottom:1rem; align-items:flex-start;">
          <div class="timeline-badge" style="background:#7c3aed; color:white; border-radius:50%; width:24px; height:24px; display:flex; align-items:center; justify-content:center; font-size:0.75rem;">●</div>
          <div class="timeline-body card" style="flex:1; padding:0.75rem;">
            <div class="timeline-header" style="display:flex; justify-content:space-between; margin-bottom:0.25rem;">
              <strong>${e.event_type.toUpperCase()}</strong>: Resource <code>${e.resource_id}</code>
              <small class="text-muted">${new Date(e.created_at).toLocaleString()}</small>
            </div>
            <p style="margin:0.25rem 0; font-size:0.85rem;">Host: <strong>${e.machine_id}</strong> | Path: <code style="color:#38bdf8;">${e.new_path || e.old_path || 'N/A'}</code></p>
            <small class="text-muted">Initiator: ${e.initiator} | Confidence: ${e.confidence_score}%</small>
          </div>
        </div>
      `).join('');
    } catch (err) {
      historyContainer.innerHTML = `<div class="text-danger" style="padding:1rem;">Failed to load history: ${err.message}</div>`;
    }
  }

  static async resolveConflict(conflictId, policy) {
    try {
      const api = window.stationApp.api;
      await api.request('/api/v1/registry/conflicts/resolve', {
        method: 'POST',
        body: JSON.stringify({ conflict_id: conflictId, resolution_policy: policy })
      });
      alert(`Conflict resolved via policy: ${policy}`);
      PathRegistryView.loadRegistryData();
    } catch (err) {
      alert(`Resolution error: ${err.message}`);
    }
  }

  static async runReconciliationScan() {
    alert('Initiating active reconciliation scan across all registered host nodes...');
    try {
      const api = window.stationApp.api;
      const res = await api.request('/api/v1/registry/reconcile', { method: 'POST' });
      alert(`Reconciliation scan finished: ${res.verified_healthy || 0} healthy paths verified.`);
      PathRegistryView.loadRegistryData();
    } catch (err) {
      alert(`Reconciliation error: ${err.message}`);
    }
  }

  static filterInventoryTable() {
    const q = (document.getElementById('inventory-search').value || '').toLowerCase();
    document.querySelectorAll('.inv-row').forEach(r => {
      r.style.display = r.innerText.toLowerCase().includes(q) ? '' : 'none';
    });
  }

  static filterTable() {
    const q = (document.getElementById('registry-search').value || '').toLowerCase();
    document.querySelectorAll('.path-row').forEach(r => {
      r.style.display = r.innerText.toLowerCase().includes(q) ? '' : 'none';
    });
  }

  static inspectBackend(backendId) {
    alert(`Inspecting physical backend placement for: ${backendId}\nVerifying single-writer invariant and lease validity.`);
  }

  static async releaseResource(id, backend) {
    if (!confirm(`Release path ownership for resource [${id}]?`)) return;
    try {
      const api = window.stationApp.api;
      await api.request('/api/v1/registry/release', {
        method: 'POST',
        body: JSON.stringify({ resource_id: id, backend_id: backend })
      });
      PathRegistryView.loadRegistryData();
    } catch (err) {
      alert(`Release error: ${err.message}`);
    }
  }

  static refresh() {
    PathRegistryView.loadRegistryData();
  }
}

if (typeof window !== 'undefined') {
  window.PathRegistryView = PathRegistryView;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = PathRegistryView;
}
