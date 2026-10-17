/**
 * CYBERVPS SPACE STATION - PATH OWNERSHIP & RECONCILIATION REGISTRY VIEW
 * Path Ownership Explorer, Strict Single-Writer Invariant, Conflict Detector & Recovery History
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
          <h2>Backend & Filesystem Placement Registry</h2>
          <p class="subtitle">Enforces the Strict Single-Authoritative-Writer Invariant and tracks moving/missing resources</p>
        </div>
        <div class="registry-bar-actions">
          <button class="btn btn-primary" onclick="PathRegistryView.runReconciliationScan()">🔍 Scan & Reconcile</button>
          <button class="btn btn-secondary" onclick="PathRegistryView.refresh()">🔄 Refresh</button>
        </div>
      </div>

      <!-- Strict Single-Writer Invariant Banner -->
      <div class="invariant-banner card">
        <div class="banner-title">
          <span class="icon">⚖️</span>
          <strong>Strict Path Ownership Invariant: ACTIVE</strong>
        </div>
        <p>For any canonical writable filesystem path on a machine, exactly <strong>ONE</strong> authoritative primary writer may own it at a time. All secondary replicas, caches, or backups must explicitly declare their read-only role.</p>
      </div>

      <!-- Conflicts Alert Box (Hidden if none) -->
      <div id="conflicts-alert-container" class="card conflicts-card" style="display:none;">
        <div class="card-header">
          <h3>🚨 Active Path Ownership Conflicts</h3>
          <span class="badge badge-danger" id="conflicts-count-badge">0 Conflicts</span>
        </div>
        <div id="conflicts-list"></div>
      </div>

      <!-- Registry Tabs -->
      <div class="registry-tabs">
        <button class="tab-btn active" onclick="PathRegistryView.switchTab('paths')">📁 Registered Paths</button>
        <button class="tab-btn" onclick="PathRegistryView.switchTab('missing')">⚠️ Missing & Moved Resources</button>
        <button class="tab-btn" onclick="PathRegistryView.switchTab('history')">📜 Recovery & Movement History</button>
      </div>

      <!-- Tab 1: Registered Paths Table -->
      <div id="tab-paths" class="tab-content card">
        <div class="table-controls">
          <input type="text" id="registry-search" placeholder="Search by backend, canonical path or resource ID..." onkeyup="PathRegistryView.filterTable()" />
        </div>
        <table class="data-table">
          <thead>
            <tr>
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
            <tr><td colspan="8" class="text-center">Loading path registry...</td></tr>
          </tbody>
        </table>
      </div>

      <!-- Tab 2: Missing & Moved Resources Table -->
      <div id="tab-missing" class="tab-content card" style="display:none;">
        <h3>Discovered Missing or Relocated Resources</h3>
        <p>When a backend or file disappears, the station detects candidates across replicas and snapshots before offering recovery.</p>
        <div id="missing-resources-container">
          <div class="empty-state text-center">No missing resources detected. All paths are healthy.</div>
        </div>
      </div>

      <!-- Tab 3: History Timeline -->
      <div id="tab-history" class="tab-content card" style="display:none;">
        <h3>Audit Trail: Movement, Deletions & Recoveries</h3>
        <div class="timeline" id="history-timeline">
          <div class="text-center text-muted">Loading movement timeline...</div>
        </div>
      </div>
    `;

    PathRegistryView.loadRegistryData();
  }

  static async loadRegistryData() {
    const tableBody = document.getElementById('registry-table-body');
    const conflictsBox = document.getElementById('conflicts-alert-container');
    const conflictsList = document.getElementById('conflicts-list');
    const conflictsBadge = document.getElementById('conflicts-count-badge');

    try {
      const api = window.stationApp.api;
      const res = await api.request('/api/v1/registry/paths');
      const paths = res.records || [];
      const conflicts = res.conflicts || [];

      // Render Conflicts if any
      if (conflicts.length > 0) {
        conflictsBox.style.display = 'block';
        conflictsBadge.innerText = `${conflicts.length} Active Conflicts`;
        conflictsList.innerHTML = conflicts.map(c => `
          <div class="conflict-item border-fail">
            <div>
              <strong>Path:</strong> <code>${c.canonical_path}</code> on <strong>${c.machine_id}</strong><br/>
              <strong>Existing Owner:</strong> <span class="badge badge-primary">${c.existing_owner_backend}</span> vs 
              <strong>Competing Claim:</strong> <span class="badge badge-danger">${c.competing_owner_backend}</span>
            </div>
            <div class="conflict-actions">
              <button class="btn-sm btn-primary" onclick="PathRegistryView.resolveConflict('${c.conflict_id}', 'keep_existing')">Keep Existing</button>
              <button class="btn-sm btn-danger" onclick="PathRegistryView.resolveConflict('${c.conflict_id}', 'accept_competing')">Reassign</button>
            </div>
          </div>
        `).join('');
      } else {
        conflictsBox.style.display = 'none';
      }

      // Render Registered Paths
      if (paths.length === 0) {
        tableBody.innerHTML = `<tr><td colspan="8" class="text-center text-muted">No path ownership records registered yet.</td></tr>`;
        return;
      }

      tableBody.innerHTML = paths.map(r => `
        <tr class="path-row">
          <td><code>${r.resource_id}</code></td>
          <td><strong>${r.machine_id}</strong></td>
          <td><span class="badge badge-info">${r.backend_id}</span></td>
          <td><code>${r.canonical_path}</code></td>
          <td>
            <span class="role-badge role-${r.ownership_role}">
              ${r.ownership_role === 'primary' ? '★ Authoritative Primary' : r.ownership_role}
            </span>
          </td>
          <td>
            <span class="status-pill status-${(r.state || 'healthy').toLowerCase()}">
              ● ${r.state || 'healthy'}
            </span>
          </td>
          <td><small>${r.last_verified_at ? new Date(r.last_verified_at).toLocaleTimeString() : 'N/A'}</small></td>
          <td>
            <button class="btn-sm" onclick="PathRegistryView.inspectResource('${r.resource_id}')">Inspect</button>
            <button class="btn-sm btn-danger" onclick="PathRegistryView.releaseResource('${r.resource_id}', '${r.backend_id}')">Release</button>
          </td>
        </tr>
      `).join('');
    } catch (err) {
      tableBody.innerHTML = `<tr><td colspan="8" class="text-center text-danger">Failed to load registry: ${err.message}</td></tr>`;
    }
  }

  static switchTab(tabId) {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.style.display = 'none');

    const activeBtn = Array.from(document.querySelectorAll('.tab-btn')).find(b => b.innerText.toLowerCase().includes(tabId));
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
        historyContainer.innerHTML = '<div class="text-center text-muted">No history events recorded.</div>';
        return;
      }

      historyContainer.innerHTML = events.map(e => `
        <div class="timeline-item">
          <div class="timeline-badge badge-${e.event_type}">●</div>
          <div class="timeline-body card">
            <div class="timeline-header">
              <strong>${e.event_type.toUpperCase()}</strong>: Resource <code>${e.resource_id}</code>
              <small class="text-muted">${new Date(e.created_at).toLocaleString()}</small>
            </div>
            <p>Host: <strong>${e.machine_id}</strong> | Path: <code>${e.new_path || e.old_path || 'N/A'}</code></p>
            <small class="text-muted">Initiator: ${e.initiator} | Confidence: ${e.confidence_score}%</small>
          </div>
        </div>
      `).join('');
    } catch (err) {
      historyContainer.innerHTML = `<div class="text-danger">Failed to load history: ${err.message}</div>`;
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

  static filterTable() {
    const q = (document.getElementById('registry-search').value || '').toLowerCase();
    document.querySelectorAll('.path-row').forEach(r => {
      r.style.display = r.innerText.toLowerCase().includes(q) ? '' : 'none';
    });
  }

  static inspectResource(id) {
    alert(`Inspecting resource: ${id}`);
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
