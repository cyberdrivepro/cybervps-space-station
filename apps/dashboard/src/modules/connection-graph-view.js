/**
 * CYBERVPS SPACE STATION - CONNECTION TOPOLOGY & OBSIDIAN GRAPH VIEW
 * Interactive SVG Mesh Topology, Broken Link Detection, and Circular Routing Loop Inspector
 */

class ConnectionGraphView {
  constructor(state, apiClient) {
    this.state = state;
    this.api = apiClient;
  }

  render(container) {
    container.innerHTML = `
      <div class="module-header">
        <div>
          <h2>Connection Topology & Obsidian Pillars Graph</h2>
          <p class="subtitle">Live interactive network graph, routing loop detection, and End-Core consensus state</p>
        </div>
        <div class="graph-actions">
          <button class="btn btn-primary" onclick="ConnectionGraphView.refreshGraph()">⚡ Probe & Refresh Graph</button>
        </div>
      </div>

      <!-- Graph Summary Banner -->
      <div class="graph-summary card">
        <div class="summary-stat">
          <small>Obsidian Pillars:</small>
          <strong>5/5 Quorum Active</strong>
        </div>
        <div class="summary-stat">
          <small>Mesh Transport:</small>
          <strong>TLS 1.3 / Gossip / WireGuard</strong>
        </div>
        <div class="summary-stat">
          <small>Routing Loops:</small>
          <strong id="graph-loops-count" style="color:#00ffcc">0 Detected (Clean)</strong>
        </div>
        <div class="summary-stat">
          <small>Broken Links:</small>
          <strong id="graph-broken-count" style="color:#00ffcc">0 Detected</strong>
        </div>
      </div>

      <!-- Interactive SVG Graph Container -->
      <div class="graph-canvas-container card">
        <div class="graph-legend">
          <span><span class="dot dot-hub"></span> Control Plane</span>
          <span><span class="dot dot-pillar"></span> Obsidian Pillar</span>
          <span><span class="dot dot-machine"></span> Fleet Machine</span>
          <span><span class="dot dot-backend"></span> Authoritative Backend</span>
        </div>
        <svg id="topology-svg" width="100%" height="520" viewBox="0 0 900 520">
          <defs>
            <marker id="arrow" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" fill="#00ffcc" />
            </marker>
          </defs>
          <g id="svg-edges"></g>
          <g id="svg-nodes"></g>
        </svg>
      </div>

      <!-- Graph Nodes Details Table -->
      <div class="card graph-nodes-card">
        <h3>Topology Graph Nodes & Verification State</h3>
        <table class="data-table">
          <thead>
            <tr>
              <th>Node ID</th>
              <th>Type</th>
              <th>Endpoint / Location</th>
              <th>Role</th>
              <th>5-State Lifecycle</th>
            </tr>
          </thead>
          <tbody id="graph-nodes-table-body">
            <tr><td colspan="5" class="text-center">Loading topology data...</td></tr>
          </tbody>
        </table>
      </div>
    `;

    ConnectionGraphView.refreshGraph();
  }

  static async refreshGraph() {
    const tableBody = document.getElementById('graph-nodes-table-body');
    const svgNodes = document.getElementById('svg-nodes');
    const svgEdges = document.getElementById('svg-edges');
    const loopsEl = document.getElementById('graph-loops-count');
    const brokenEl = document.getElementById('graph-broken-count');

    try {
      const api = window.stationApp.api;
      const res = await api.request('/api/v1/topology/graph');
      const nodes = res.nodes || [];
      const edges = res.edges || [];
      const broken = res.broken_links || [];
      const loops = res.routing_loops || [];

      if (brokenEl) brokenEl.innerText = `${broken.length} Detected`;
      if (loopsEl) loopsEl.innerText = `${loops.length} Detected`;

      // Render table
      if (tableBody) {
        tableBody.innerHTML = nodes.map(n => `
          <tr>
            <td><strong>${n.name || n.id}</strong><br/><small class="text-muted">${n.id}</small></td>
            <td><span class="badge badge-secondary">${n.type}</span></td>
            <td><code>${n.endpoint || n.canonical_path || 'Internal IPC'}</code></td>
            <td>${n.role || 'Peer'}</td>
            <td>
              <span class="badge ${n.status === 'VERIFIED' ? 'badge-success' : 'badge-warning'}">
                ${n.status || 'CONFIGURED'}
              </span>
            </td>
          </tr>
        `).join('');
      }

      // Render SVG Topology
      if (svgNodes && svgEdges) {
        svgNodes.innerHTML = '';
        svgEdges.innerHTML = '';

        // Center hub
        const cx = 450;
        const cy = 260;
        const pillarRadius = 150;
        const fleetRadius = 230;

        const nodeCoords = new Map();
        nodeCoords.set('node_control_plane', { x: cx, y: cy });

        // Position Obsidian Pillars in circle
        const pillars = nodes.filter(n => n.type === 'obsidian_pillar');
        pillars.forEach((p, idx) => {
          const angle = (idx / pillars.length) * 2 * Math.PI - Math.PI / 2;
          const px = cx + pillarRadius * Math.cos(angle);
          const py = cy + pillarRadius * Math.sin(angle);
          nodeCoords.set(p.id, { x: px, y: py });
        });

        // Position Fleet Machines on outer ring
        const fleetMachines = nodes.filter(n => n.type === 'fleet_machine');
        fleetMachines.forEach((m, idx) => {
          const angle = (idx / Math.max(1, fleetMachines.length)) * 2 * Math.PI;
          const mx = cx + fleetRadius * Math.cos(angle);
          const my = cy + fleetRadius * Math.sin(angle);
          nodeCoords.set(m.id, { x: mx, y: my });
        });

        // Draw Edges
        let edgesHtml = '';
        for (const e of edges) {
          const src = nodeCoords.get(e.source);
          const dst = nodeCoords.get(e.target);
          if (src && dst) {
            const strokeColor = e.is_mesh_cycle ? '#a855f7' : (e.status === 'healthy' ? '#00ffcc' : '#ff3366');
            const dashArray = e.is_mesh_cycle ? '4 4' : 'none';
            edgesHtml += `<line x1="${src.x}" y1="${src.y}" x2="${dst.x}" y2="${dst.y}" stroke="${strokeColor}" stroke-width="2" stroke-dasharray="${dashArray}" opacity="0.6"/>`;
          }
        }
        svgEdges.innerHTML = edgesHtml;

        // Draw Nodes
        let nodesHtml = '';
        for (const [id, coord] of nodeCoords.entries()) {
          const nodeData = nodes.find(n => n.id === id) || {};
          let color = '#00ffcc';
          let r = 14;
          if (nodeData.type === 'control_plane') { color = '#38bdf8'; r = 20; }
          else if (nodeData.type === 'obsidian_pillar') { color = '#a855f7'; r = 16; }
          else if (nodeData.type === 'fleet_machine') { color = '#22c55e'; r = 12; }

          nodesHtml += `
            <g transform="translate(${coord.x}, ${coord.y})">
              <circle r="${r}" fill="${color}" stroke="#fff" stroke-width="2" opacity="0.9"/>
              <text y="${r + 14}" text-anchor="middle" fill="#e2e8f0" font-size="11" font-family="monospace">
                ${(nodeData.name || id).slice(0, 18)}
              </text>
            </g>
          `;
        }
        svgNodes.innerHTML = nodesHtml;
      }
    } catch (err) {
      if (tableBody) tableBody.innerHTML = `<tr><td colspan="5" class="text-center text-danger">Error: ${err.message}</td></tr>`;
    }
  }
}

if (typeof window !== 'undefined') {
  window.ConnectionGraphView = ConnectionGraphView;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = ConnectionGraphView;
}
