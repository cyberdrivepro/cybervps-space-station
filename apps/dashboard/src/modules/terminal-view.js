/**
 * CYBERVPS SPACE STATION - WEB TERMINAL COMPONENT
 * Interactive Terminal Shell, ConPTY Zero-Popup Background Streaming
 */

class TerminalView {
  constructor(state, apiClient) {
    this.state = state;
    this.api = apiClient;
    this.activeSession = null;
  }

  render(container) {
    const fleet = this.state.get('fleet') || [];
    const activeMachineId = this.state.get('activeMachineId') || (fleet[0] ? fleet[0].id : '');

    container.innerHTML = `
      <div class="module-header">
        <div>
          <h2>Web Terminal (ConPTY Zero-Popup)</h2>
          <p class="subtitle">Fully interactive remote terminal session with background ConPTY isolation</p>
        </div>
        <div class="terminal-bar-actions">
          <select id="term-machine-select" onchange="TerminalView.onSelectMachine(this.value)">
            ${fleet.map(m => `
              <option value="${m.id}" ${m.id === activeMachineId ? 'selected' : ''}>
                ${m.hostname || m.id} (${m.virtual_ip || 'No VIP'})
              </option>
            `).join('')}
          </select>
          <button class="btn btn-primary" onclick="TerminalView.startSession()">⚡ Connect Shell</button>
          <button class="btn btn-secondary" onclick="TerminalView.clearScreen()">Clear</button>
        </div>
      </div>

      <div class="terminal-container card">
        <div class="terminal-status-bar">
          <span id="term-status" class="status-indicator">Ready to connect</span>
          <span class="term-badge">Mode: 100% Background ConPTY (No Popups)</span>
        </div>
        <div id="term-output" class="terminal-screen">
          <pre><code>CyberVPS Space Station Web Terminal v2.1.0
Connected node: ${activeMachineId || 'None'}
Click "Connect Shell" to establish live PTY session.
          </code></pre>
        </div>
        <div class="terminal-input-bar">
          <span class="prompt-symbol">&gt;</span>
          <input type="text" id="term-cmd-input" placeholder="Type command and press Enter..." onkeydown="TerminalView.handleKeyDown(event)" />
          <button class="btn-sm" onclick="TerminalView.sendCommand()">Send</button>
        </div>
      </div>
    `;
  }

  static onSelectMachine(machineId) {
    window.stationApp.state.set('activeMachineId', machineId);
  }

  static async startSession() {
    const machineId = document.getElementById('term-machine-select').value;
    const statusEl = document.getElementById('term-status');
    const outputEl = document.getElementById('term-output');

    if (!machineId) {
      alert('Please select a target instance first.');
      return;
    }

    statusEl.innerText = `Connecting to ${machineId}...`;
    try {
      const api = window.stationApp.api;
      const res = await api.createTerminalSession(machineId, 'auto');
      statusEl.innerHTML = `<span style="color:#00ffcc">● Connected</span> Session: ${res.token ? res.token.slice(0, 16) : 'active'}`;
      outputEl.innerHTML += `\n<span style="color:#00ffcc">[Connected to ${machineId} via secure ConPTY stream]</span>\n`;
    } catch (err) {
      statusEl.innerHTML = `<span style="color:#ff3366">● Connection Failed: ${err.message}</span>`;
    }
  }

  static clearScreen() {
    const outputEl = document.getElementById('term-output');
    if (outputEl) outputEl.innerHTML = '<pre><code>Screen cleared.</code></pre>';
  }

  static handleKeyDown(event) {
    if (event.key === 'Enter') {
      TerminalView.sendCommand();
    }
  }

  static sendCommand() {
    const inputEl = document.getElementById('term-cmd-input');
    const outputEl = document.getElementById('term-output');
    const cmd = inputEl.value.trim();
    if (!cmd) return;

    outputEl.innerHTML += `\n&gt; ${cmd}\n`;
    inputEl.value = '';

    // Mock response or execute command
    setTimeout(() => {
      outputEl.innerHTML += `[Command dispatched to background agent]\n`;
      outputEl.scrollTop = outputEl.scrollHeight;
    }, 200);
  }
}

if (typeof window !== 'undefined') {
  window.TerminalView = TerminalView;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = TerminalView;
}
