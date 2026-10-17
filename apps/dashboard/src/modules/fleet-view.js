/**
 * CYBERVPS SPACE STATION - FLEET VIEW COMPONENT
 * Renders Enrolled Instances Fleet, VIPs, OS Badges, and Quick Action Triggers
 */

class FleetView {
  constructor(state, apiClient, router) {
    this.state = state;
    this.api = apiClient;
    this.router = router;
  }

  render(container) {
    const fleet = this.state.get('fleet') || [];
    const backendUrl = this.state.get('backendUrl');
    const pairingKey = this.state.get('pairingKey');

    container.innerHTML = `
      <div class="module-header">
        <div>
          <h2>Enrolled Instances Fleet</h2>
          <p class="subtitle">Remote systems, cloud VPS, and development sandboxes linked to this station</p>
        </div>
        <div class="actions">
          <button class="btn btn-primary" onclick="FleetView.showEnrollModal()">+ Enroll New Node</button>
          <button class="btn btn-secondary" onclick="FleetView.refresh()">🔄 Refresh</button>
        </div>
      </div>

      <div class="fleet-controls card">
        <input type="text" id="fleet-search" placeholder="Search by hostname, machine ID or virtual IP..." onkeyup="FleetView.filterFleet()" />
        <div class="filter-pills">
          <button class="pill active" onclick="FleetView.setFilter('all')">All Nodes (${fleet.length})</button>
          <button class="pill" onclick="FleetView.setFilter('online')">Online (${fleet.filter(m => m.status === 'online' || m.status === 'ONLINE').length})</button>
          <button class="pill" onclick="FleetView.setFilter('windows')">Windows</button>
          <button class="pill" onclick="FleetView.setFilter('linux')">Linux</button>
        </div>
      </div>

      <div class="fleet-table-container card">
        <table class="data-table">
          <thead>
            <tr>
              <th>Instance</th>
              <th>Platform / Arch</th>
              <th>Virtual IP</th>
              <th>Status</th>
              <th>Last Heartbeat</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody id="fleet-table-body">
            ${fleet.length === 0 ? `
              <tr>
                <td colspan="6" class="text-center empty-state">
                  <p>No instances enrolled yet.</p>
                  <code>& ([scriptblock]::Create((Invoke-RestMethod '${backendUrl}/install.ps1')))</code>
                </td>
              </tr>
            ` : fleet.map(node => `
              <tr class="fleet-row" data-platform="${(node.os || '').toLowerCase()}" data-status="${(node.status || '').toLowerCase()}">
                <td>
                  <strong>${node.hostname || node.id}</strong><br/>
                  <small class="text-muted">${node.id}</small>
                </td>
                <td>
                  <span class="badge ${String(node.os).toLowerCase().includes('win') ? 'badge-win' : 'badge-linux'}">
                    ${node.os || 'Unknown OS'} (${node.arch || 'x86_64'})
                  </span>
                </td>
                <td>
                  <code class="vip-code">${node.virtual_ip || 'Unassigned'}</code>
                </td>
                <td>
                  <span class="status-pill status-${(node.status || 'offline').toLowerCase()}">
                    ● ${node.status || 'OFFLINE'}
                  </span>
                </td>
                <td>
                  <small>${node.last_seen ? new Date(node.last_seen).toLocaleTimeString() : 'Never'}</small>
                </td>
                <td class="action-buttons">
                  <button class="btn-sm" onclick="FleetView.openTerminal('${node.id}')">Terminal</button>
                  <button class="btn-sm" onclick="FleetView.openFiles('${node.id}')">Files</button>
                  <button class="btn-sm" onclick="FleetView.openApps('${node.id}')">Apps</button>
                  <button class="btn-sm btn-danger" onclick="FleetView.revoke('${node.id}')">Revoke</button>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  static openTerminal(machineId) {
    window.location.hash = `#terminal?machine_id=${machineId}`;
  }

  static openFiles(machineId) {
    window.location.hash = `#files?machine_id=${machineId}`;
  }

  static openApps(machineId) {
    window.location.hash = `#apps?machine_id=${machineId}`;
  }

  static async revoke(machineId) {
    if (!confirm(`Are you sure you want to permanently revoke node [${machineId}]?`)) return;
    try {
      const api = window.stationApp.api;
      await api.request('/api/v1/machines/revoke', {
        method: 'POST',
        body: JSON.stringify({ machine_id: machineId, reason: 'Dashboard user action' })
      });
      window.stationApp.state.addNotification('success', `Node ${machineId} successfully revoked.`);
      window.stationApp.refreshFleet();
    } catch (err) {
      alert(`Revocation failed: ${err.message}`);
    }
  }

  static filterFleet() {
    const q = (document.getElementById('fleet-search').value || '').toLowerCase();
    const rows = document.querySelectorAll('.fleet-row');
    rows.forEach(r => {
      const text = r.innerText.toLowerCase();
      r.style.display = text.includes(q) ? '' : 'none';
    });
  }

  static setFilter(type) {
    const rows = document.querySelectorAll('.fleet-row');
    rows.forEach(r => {
      if (type === 'all') {
        r.style.display = '';
      } else if (type === 'online') {
        r.style.display = r.getAttribute('data-status') === 'online' ? '' : 'none';
      } else {
        r.style.display = r.getAttribute('data-platform').includes(type) ? '' : 'none';
      }
    });
  }
}

if (typeof window !== 'undefined') {
  window.FleetView = FleetView;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = FleetView;
}
