/**
 * CYBERVPS SPACE STATION - SYSTEM DOCTOR DIAGNOSTICS VIEW
 * 16-Point Deep Diagnostics Matrix, Health Score & Self-Healing Triggers
 */

class DoctorView {
  constructor(state, apiClient) {
    this.state = state;
    this.api = apiClient;
  }

  render(container) {
    const health = this.state.get('systemHealth') || { score: 100, status: 'HEALTHY' };

    container.innerHTML = `
      <div class="module-header">
        <div>
          <h2>System Doctor (16-Point Deep Diagnostics)</h2>
          <p class="subtitle">Real-time infrastructure health evaluation, resource headroom, and self-healing</p>
        </div>
        <div class="doctor-actions">
          <button class="btn btn-primary" onclick="DoctorView.runDiagnostics()">🩺 Run Diagnostics</button>
          <button class="btn btn-secondary" onclick="DoctorView.runSelfHealing()">🛠 Auto-Remediation</button>
        </div>
      </div>

      <div class="doctor-summary-card card">
        <div class="score-circle score-${health.score >= 90 ? 'good' : (health.score >= 70 ? 'warn' : 'bad')}">
          <span class="score-number">${health.score || 100}</span>
          <span class="score-label">HEALTH SCORE</span>
        </div>
        <div class="summary-details">
          <h3>Status: <span class="status-tag status-${(health.status || 'healthy').toLowerCase()}">${health.status || 'HEALTHY'}</span></h3>
          <p>Control plane, agent fleet VIPs, ConPTY bridge, database storage and multi-backend HA mesh verified.</p>
          <small class="text-muted" id="doctor-last-run">Last evaluated: Just now</small>
        </div>
      </div>

      <div class="checks-grid" id="doctor-checks-grid">
        <div class="card loading-card">Click "Run Diagnostics" to perform 16-point deep verification.</div>
      </div>
    `;

    DoctorView.runDiagnostics();
  }

  static async runDiagnostics() {
    const grid = document.getElementById('doctor-checks-grid');
    if (!grid) return;

    grid.innerHTML = `<div class="card"><p>Running 16 deep health probes...</p></div>`;

    try {
      const api = window.stationApp.api;
      const res = await api.runDoctorDiagnostics();
      const checks = res.checks || {};
      const checkKeys = Object.keys(checks);

      if (checkKeys.length === 0) {
        grid.innerHTML = `<div class="card"><p>No check data returned from server.</p></div>`;
        return;
      }

      grid.innerHTML = checkKeys.map(k => {
        const c = checks[k];
        const statusClass = c.status === 'PASS' ? 'pass' : (c.status === 'WARN' ? 'warn' : 'fail');
        return `
          <div class="check-card card border-${statusClass}">
            <div class="check-header">
              <strong>${c.title || k}</strong>
              <span class="badge badge-${statusClass}">${c.status} (${c.latency_ms || 0}ms)</span>
            </div>
            <p class="check-msg">${c.message || 'Operational'}</p>
            ${c.details ? `
              <pre class="check-details"><code>${JSON.stringify(c.details, null, 2)}</code></pre>
            ` : ''}
          </div>
        `;
      }).join('');

      // Update state health score
      if (res.health_score !== undefined) {
        window.stationApp.state.set('systemHealth', { score: res.health_score, status: res.overall_status });
      }
    } catch (err) {
      grid.innerHTML = `<div class="card"><p class="text-danger">Diagnostic probe error: ${err.message}</p></div>`;
    }
  }

  static async runSelfHealing() {
    try {
      const api = window.stationApp.api;
      const res = await api.runDoctorRemediation('all');
      alert(`Auto-remediation completed:\n${(res.remediated || []).join('\n') || 'All systems already optimal'}`);
      DoctorView.runDiagnostics();
    } catch (err) {
      alert(`Auto-remediation failed: ${err.message}`);
    }
  }
}

if (typeof window !== 'undefined') {
  window.DoctorView = DoctorView;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = DoctorView;
}
