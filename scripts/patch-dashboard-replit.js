const fs = require('fs');
const path = require('path');

const targetFile = path.resolve(__dirname, '../apps/dashboard/index.html');
const rootFile = path.resolve(__dirname, '../index.html');

let content = fs.readFileSync(targetFile, 'utf8');

// 1. Replit VPS Lab View HTML
const replitViewHtml = `      <!-- VIEW: REPLIT VPS LAB -->
      <div id="view-replit" class="view-panel" style="display:none;">
        <div class="card" style="margin-bottom: 1.25rem;">
          <div class="card-header">
            <div>
              <div class="card-title">
                <svg viewBox="0 0 24 24" style="width:18px; height:18px; stroke:var(--accent-cyan); fill:none; stroke-width:2;"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="8 10 12 14 8 18"/><line x1="14" x2="18" y1="18" y2="18"/></svg>
                Replit VPS Lab & Container Virtualization
              </div>
              <div class="card-desc">Capability-aware cloud container workstation with HTML5 noVNC desktop, collaborative sshx terminal, and 24/7 supervisor</div>
            </div>
            <div style="display:flex; align-items:center; gap:0.65rem;">
              <select id="replit-machine-select" class="form-control" style="font-size:0.82rem; padding:0.4rem 0.75rem; min-width:220px;" onchange="fetchReplitLabStatus(true)">
                <option value="">Select Target Machine...</option>
              </select>
              <button class="btn btn-secondary" onclick="fetchReplitLabStatus(true)" title="Refresh Lab Status">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
                Refresh
              </button>
              <button class="btn btn-primary" onclick="runReplitDoctor()">Run Lab Doctor</button>
            </div>
          </div>
          <div class="card-body">
            <!-- Sandbox Idle Warning Alert -->
            <div style="background:rgba(245, 158, 11, 0.08); border:1px solid rgba(245, 158, 11, 0.25); border-radius:var(--radius-md); padding:1rem 1.25rem; margin-bottom:1.25rem; display:flex; align-items:flex-start; gap:0.75rem;">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--status-warning)" stroke-width="2" style="flex-shrink:0; margin-top:2px;"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
              <div>
                <div style="font-weight:600; color:var(--text-primary); margin-bottom:0.25rem;">Cloud Sandbox Idle-Pause Awareness & 24/7 Resilience</div>
                <div style="font-size:0.83rem; color:var(--text-secondary); line-height:1.45;">
                  Developer sandboxes (such as Prepare.sh or Replit free containers) suspend execution after 10–30 minutes of external inactivity. To maintain 24/7 fleet availability, deploy the <strong>CyberVPS Process Supervisor</strong>, configure an external HTTP ping monitor against your exposed port, or upgrade to an always-on plan. Inactive RDP/VNC sessions will <em>never</em> terminate the host agent daemon.
                </div>
              </div>
            </div>

            <!-- Hardware & Virtualization Capability Cards -->
            <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(220px, 1fr)); gap:1rem; margin-bottom:1.25rem;">
              <div style="background:var(--bg-subtle); border:1px solid var(--border-subtle); border-radius:var(--radius-md); padding:1rem;">
                <div style="font-size:0.72rem; color:var(--text-muted); text-transform:uppercase; font-weight:600;">Genuine RAM Allocation</div>
                <div id="replit-ram-display" style="font-size:1.35rem; font-weight:700; color:var(--text-primary); margin:0.35rem 0;">-- MB</div>
                <div style="font-size:0.72rem; color:var(--text-muted);">Real /proc/meminfo capacity</div>
              </div>
              <div style="background:var(--bg-subtle); border:1px solid var(--border-subtle); border-radius:var(--radius-md); padding:1rem;">
                <div style="font-size:0.72rem; color:var(--text-muted); text-transform:uppercase; font-weight:600;">Hardware KVM Virtualization</div>
                <div id="replit-kvm-display" style="font-size:1.05rem; font-weight:700; color:var(--status-warning); margin:0.35rem 0;">Checking /dev/kvm...</div>
                <div style="font-size:0.72rem; color:var(--text-muted);">Software QEMU / PRoot fallback</div>
              </div>
              <div style="background:var(--bg-subtle); border:1px solid var(--border-subtle); border-radius:var(--radius-md); padding:1rem;">
                <div style="font-size:0.72rem; color:var(--text-muted); text-transform:uppercase; font-weight:600;">Docker / Container Runtime</div>
                <div id="replit-docker-display" style="font-size:1.05rem; font-weight:700; color:var(--text-primary); margin:0.35rem 0;">Checking Docker...</div>
                <div style="font-size:0.72rem; color:var(--text-muted);">Unprivileged container isolation</div>
              </div>
              <div style="background:var(--bg-subtle); border:1px solid var(--border-subtle); border-radius:var(--radius-md); padding:1rem;">
                <div style="font-size:0.72rem; color:var(--text-muted); text-transform:uppercase; font-weight:600;">noVNC Desktop Display</div>
                <div id="replit-desktop-display" style="font-size:1.05rem; font-weight:700; color:var(--text-primary); margin:0.35rem 0;">Display :1 (Port 8080)</div>
                <div style="font-size:0.72rem; color:var(--text-muted);">TigerVNC + Openbox + websockify</div>
              </div>
            </div>

            <!-- Actions & Integration Tabs -->
            <div style="display:flex; flex-wrap:wrap; gap:0.75rem; margin-bottom:1.25rem;">
              <button class="btn btn-primary" onclick="replitDesktopAction('start')">Launch Graphical Desktop</button>
              <button class="btn btn-secondary" onclick="replitDesktopAction('restart')">Restart Desktop</button>
              <button class="btn btn-secondary" onclick="replitDesktopAction('stop')">Stop Desktop</button>
              <button class="btn btn-secondary" onclick="toggleEmbeddedNoVNC()">Toggle Embedded noVNC</button>
              <a id="replit-external-vnc-btn" class="btn btn-secondary" href="http://localhost:8080/vnc.html" target="_blank" rel="noopener">Open noVNC in New Tab</a>
              <button class="btn btn-secondary" onclick="replitSshxAction('start')">Start sshx Collaborative Terminal</button>
            </div>

            <!-- Embedded noVNC Frame Container -->
            <div id="replit-novnc-container" style="display:none; margin-bottom:1.25rem; border:1px solid var(--border-subtle); border-radius:var(--radius-md); overflow:hidden; background:#000;">
              <div style="padding:0.6rem 1rem; background:var(--bg-surface-elevated); border-bottom:1px solid var(--border-subtle); display:flex; justify-content:space-between; align-items:center;">
                <span style="font-weight:600; font-size:0.85rem;">Interactive HTML5 noVNC Session</span>
                <button class="btn btn-sm btn-secondary" onclick="toggleEmbeddedNoVNC()">Close Frame</button>
              </div>
              <iframe id="replit-novnc-frame" src="about:blank" style="width:100%; height:620px; border:none; display:block;"></iframe>
            </div>

            <!-- Collaborative sshx Terminal Panel -->
            <div style="background:var(--bg-surface-elevated); border:1px solid var(--border-subtle); border-radius:var(--radius-md); padding:1rem 1.25rem; margin-bottom:1.25rem;">
              <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:0.6rem;">
                <div style="font-weight:600;">sshx Collaborative Web Terminal</div>
                <span id="replit-sshx-badge" class="badge badge-secondary">Ready</span>
              </div>
              <div style="display:flex; gap:0.5rem; align-items:center;">
                <input id="replit-sshx-url" type="text" class="form-control" readonly placeholder="Click 'Start sshx' to generate end-to-end encrypted web terminal link" style="font-family:var(--font-mono); font-size:0.82rem;" />
                <button class="btn btn-secondary" onclick="copyReplitSshxLink()">Copy Link</button>
                <button class="btn btn-primary" onclick="openReplitSshx()">Open Terminal</button>
              </div>
            </div>

            <!-- Quick Installer & Reproduction Ledger -->
            <div style="background:var(--bg-subtle); border:1px solid var(--border-subtle); border-radius:var(--radius-md); padding:1rem 1.25rem;">
              <div style="font-weight:600; margin-bottom:0.5rem;">Automated Replit Quickstart Command</div>
              <div style="font-size:0.82rem; color:var(--text-muted); margin-bottom:0.6rem;">Run this single command inside the Replit bash console to install all components:</div>
              <div style="display:flex; gap:0.5rem; align-items:center;">
                <code style="flex:1; background:var(--bg-base); border:1px solid var(--border-subtle); border-radius:var(--radius-sm); padding:0.6rem 0.8rem; font-family:var(--font-mono); font-size:0.82rem; word-break:break-all;">curl -fsSL https://raw.githubusercontent.com/cyberdrivepro/cybervps-space-station/main/installers/replit-vps/install.sh | bash</code>
                <button class="btn btn-secondary" onclick="navigator.clipboard.writeText('curl -fsSL https://raw.githubusercontent.com/cyberdrivepro/cybervps-space-station/main/installers/replit-vps/install.sh | bash'); showToast('Command copied to clipboard!', 'success');">Copy</button>
              </div>
            </div>

          </div>
        </div>
      </div>\n\n`;

if (!content.includes('id="view-replit"')) {
  content = content.replace(/<!-- VIEW: SYSTEM DOCTOR -->/g, `${replitViewHtml}      <!-- VIEW: SYSTEM DOCTOR -->`);
}

// 2. Replit Lab JavaScript Functions
const replitJsFunctions = `    // 9.5 REPLIT VPS LAB FUNCTIONS
    let replitLabState = {
      machineId: null,
      data: null
    };

    function populateReplitMachines() {
      const select = document.getElementById('replit-machine-select');
      if (!select) return;
      const current = select.value;
      select.innerHTML = '<option value="">Select Target Machine...</option>';
      if (appState && appState.machines) {
        appState.machines.forEach(m => {
          const opt = document.createElement('option');
          opt.value = m.id;
          const name = m.friendly_name || m.hostname || m.id;
          const status = m.status || 'unknown';
          opt.textContent = \`\${name} [\${status.toUpperCase()} - \${m.os || 'Linux'}]\`;
          select.appendChild(opt);
        });
      }
      if (current && Array.from(select.options).some(o => o.value === current)) {
        select.value = current;
      } else if (select.options.length > 1) {
        select.selectedIndex = 1;
      }
    }

    async function fetchReplitLabStatus(showToastMsg = false) {
      populateReplitMachines();
      const select = document.getElementById('replit-machine-select');
      const machineId = select ? select.value : null;
      const base = normalizeServerUrl(appConfig.serverUrl) || defaultRailway;

      try {
        const queryParam = machineId ? \`?machine_id=\${encodeURIComponent(machineId)}\` : '';
        const res = await fetch(\`\${base}/api/v1/replit/status\${queryParam}\`);
        if (!res.ok) throw new Error(\`HTTP \${res.status}\`);
        const data = await res.json();
        replitLabState.data = data;

        const ramEl = document.getElementById('replit-ram-display');
        if (ramEl) {
          ramEl.innerText = data.total_mem_mb ? \`\${data.total_mem_mb} MB\` : (data.memory_total_bytes ? \`\${Math.round(data.memory_total_bytes / (1024*1024))} MB\` : '1024 MB (Dynamic)');
        }

        const deskEl = document.getElementById('replit-desktop-display');
        if (deskEl) {
          deskEl.innerText = data.desktop_active ? 'Active (:1 / Port 8080) ✅' : 'Inactive (Stopped) ⏸️';
          deskEl.style.color = data.desktop_active ? 'var(--status-success)' : 'var(--text-muted)';
        }

        const sshxInput = document.getElementById('replit-sshx-url');
        const sshxBadge = document.getElementById('replit-sshx-badge');
        if (sshxInput && data.sshx_url) {
          sshxInput.value = data.sshx_url;
        }
        if (sshxBadge) {
          sshxBadge.innerText = data.sshx_url ? 'Running' : 'Ready';
          sshxBadge.className = data.sshx_url ? 'badge badge-success' : 'badge badge-secondary';
        }

        const extBtn = document.getElementById('replit-external-vnc-btn');
        if (extBtn) {
          const webPort = data.web_port || 8080;
          extBtn.href = \`http://\${window.location.hostname || 'localhost'}:\${webPort}/vnc.html\`;
        }

        if (showToastMsg) showToast('Replit Lab status updated', 'success');
      } catch (err) {
        if (showToastMsg) showToast(\`Replit Lab fetch failed: \${err.message}\`, 'error');
      }
    }

    async function runReplitDoctor() {
      const select = document.getElementById('replit-machine-select');
      const machineId = select ? select.value : null;
      const base = normalizeServerUrl(appConfig.serverUrl) || defaultRailway;
      showToast('Running capability diagnostics...', 'info');

      try {
        const queryParam = machineId ? \`?machine_id=\${encodeURIComponent(machineId)}\` : '';
        const res = await fetch(\`\${base}/api/v1/replit/doctor\${queryParam}\`);
        if (!res.ok) throw new Error(\`HTTP \${res.status}\`);
        const data = await res.json();
        const r = data.result || data;

        const kvmEl = document.getElementById('replit-kvm-display');
        if (kvmEl) {
          if (r.kvm_hardware_acceleration) {
            kvmEl.innerText = 'Hardware KVM Active ✅';
            kvmEl.style.color = 'var(--status-success)';
          } else {
            kvmEl.innerText = 'Emulated (No KVM) ⚠️';
            kvmEl.style.color = 'var(--status-warning)';
          }
        }

        const dockerEl = document.getElementById('replit-docker-display');
        if (dockerEl) {
          if (r.docker_available) {
            dockerEl.innerText = 'Running ✅';
            dockerEl.style.color = 'var(--status-success)';
          } else {
            dockerEl.innerText = 'Unavailable (Sandbox) ℹ️';
            dockerEl.style.color = 'var(--text-muted)';
          }
        }

        if (r.total_mem_mb) {
          const ramEl = document.getElementById('replit-ram-display');
          if (ramEl) ramEl.innerText = \`\${r.total_mem_mb} MB\`;
        }

        showToast('Diagnostics completed!', 'success');
      } catch (err) {
        showToast(\`Doctor diagnostic error: \${err.message}\`, 'error');
      }
    }

    async function replitDesktopAction(action) {
      const select = document.getElementById('replit-machine-select');
      const machineId = select ? select.value : null;
      const base = normalizeServerUrl(appConfig.serverUrl) || defaultRailway;

      try {
        showToast(\`Executing desktop \${action}...\`, 'info');
        const res = await fetch(\`\${base}/api/v1/replit/desktop\`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ machine_id: machineId, action, sub_action: action })
        });
        const data = await res.json();
        if (data.success) {
          showToast(\`Desktop action '\${action}' dispatched successfully\`, 'success');
          setTimeout(() => fetchReplitLabStatus(false), 2000);
        } else {
          showToast(\`Desktop action failed: \${data.error || 'Unknown error'}\`, 'error');
        }
      } catch (err) {
        showToast(err.message, 'error');
      }
    }

    async function replitSshxAction(action) {
      const select = document.getElementById('replit-machine-select');
      const machineId = select ? select.value : null;
      const base = normalizeServerUrl(appConfig.serverUrl) || defaultRailway;

      try {
        showToast(\`sshx \${action} initiated...\`, 'info');
        const res = await fetch(\`\${base}/api/v1/replit/sshx\`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ machine_id: machineId, action, sub_action: action })
        });
        const data = await res.json();
        if (data.success && data.result) {
          if (data.result.sshx_url) {
            const sshxInput = document.getElementById('replit-sshx-url');
            if (sshxInput) sshxInput.value = data.result.sshx_url;
            showToast('sshx collaborative session link ready!', 'success');
          } else {
            showToast(data.result.message || 'sshx action completed', 'info');
          }
          fetchReplitLabStatus(false);
        } else {
          showToast(\`sshx action failed: \${data.error || 'Unknown error'}\`, 'error');
        }
      } catch (err) {
        showToast(err.message, 'error');
      }
    }

    function toggleEmbeddedNoVNC() {
      const container = document.getElementById('replit-novnc-container');
      const iframe = document.getElementById('replit-novnc-frame');
      if (!container || !iframe) return;
      if (container.style.display === 'none' || !container.style.display) {
        container.style.display = 'block';
        const webPort = (replitLabState.data && replitLabState.data.web_port) || 8080;
        iframe.src = \`http://\${window.location.hostname || 'localhost'}:\${webPort}/vnc.html?autoconnect=true&resize=scale\`;
      } else {
        container.style.display = 'none';
        iframe.src = 'about:blank';
      }
    }

    function copyReplitSshxLink() {
      const input = document.getElementById('replit-sshx-url');
      if (input && input.value) {
        navigator.clipboard.writeText(input.value);
        showToast('sshx URL copied to clipboard!', 'success');
      } else {
        showToast('No active sshx link to copy', 'warning');
      }
    }

    function openReplitSshx() {
      const input = document.getElementById('replit-sshx-url');
      if (input && input.value) {
        window.open(input.value, '_blank', 'noopener,noreferrer');
      } else {
        showToast('Start an sshx session first', 'info');
      }
    }\n\n`;

if (!content.includes('function fetchReplitLabStatus')) {
  content = content.replace(/\/\/ 10\. NAVIGATION, MODALS & THEME TOGGLE/g, `${replitJsFunctions}    // 10. NAVIGATION, MODALS & THEME TOGGLE`);
}

// 3. Update navTitles
if (!content.includes("'replit': 'Replit VPS Lab & Container Virtualization'")) {
  content = content.replace(
    /'doctor': 'System Doctor & Diagnostics',/g,
    `'doctor': 'System Doctor & Diagnostics',\n        'replit': 'Replit VPS Lab & Container Virtualization',`
  );
}

// 4. Update navigate hook
if (!content.includes("if (viewName === 'replit') fetchReplitLabStatus(false);")) {
  content = content.replace(
    /document\.getElementById\('breadcrumb-title'\)\.innerText = navTitles\[viewName\] \|\| 'Space Station';/g,
    `document.getElementById('breadcrumb-title').innerText = navTitles[viewName] || 'Space Station';\n      if (viewName === 'replit') fetchReplitLabStatus(false);`
  );
}

fs.writeFileSync(targetFile, content, 'utf8');
fs.writeFileSync(rootFile, content, 'utf8');
console.log('Successfully patched apps/dashboard/index.html and index.html!');
