/**
 * CYBERVPS SPACE STATION - ULTRA PRODUCTION WEB TERMINAL COMPONENT
 * Full-Duplex Interactive xterm.js Emulator | Windows ConPTY + Linux PTY
 * Real-Time Bi-Directional Streaming, Resize Observation, Privilege Profiles
 */

class TerminalView {
  constructor(state, apiClient) {
    this.state = state || (typeof window !== 'undefined' ? window.stationApp?.state : null);
    this.api = apiClient || (typeof window !== 'undefined' ? window.stationApp?.api : null);
    this.activeWs = null;
    this.activeSessionToken = null;
    this.activeMachineId = null;
    this.term = null;
    this.fitAddon = null;
    this.isReady = false;
    this.fontSize = 13;
    this.logBuffer = [];
    this.resizeObserver = null;
  }

  render(container) {
    if (!container) return;
    this.container = container;
    const fleet = (this.state && this.state.get ? this.state.get('fleet') : []) || [];
    const activeMachineId = (this.state && this.state.get ? this.state.get('activeMachineId') : '') || (fleet[0] ? fleet[0].id : '');
    this.activeMachineId = activeMachineId;

    container.innerHTML = `
      <div class="module-header" style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:0.75rem; margin-bottom:1rem;">
        <div>
          <h2 style="margin:0; font-size:1.35rem; display:flex; align-items:center; gap:0.5rem;">
            <span>Web Terminal</span>
            <span class="term-badge" id="term-engine-badge" style="font-size:0.7rem; font-weight:600; padding:0.2rem 0.5rem; border-radius:4px; background:rgba(0,240,255,0.1); color:#00f0ff; border:1px solid rgba(0,240,255,0.3);">
              Windows ConPTY + Linux PTY
            </span>
          </h2>
          <p class="subtitle" style="margin:0.25rem 0 0; color:var(--text-secondary, #94a3b8); font-size:0.85rem;">
            Direct full-duplex interactive terminal emulator with native OS pseudo-terminal streaming
          </p>
        </div>

        <div class="terminal-bar-actions" style="display:flex; align-items:center; gap:0.5rem; flex-wrap:wrap;">
          <select id="term-machine-select" class="form-select" style="background:#0f172a; color:#f8fafc; border:1px solid #334155; padding:0.35rem 0.6rem; border-radius:4px; font-size:0.82rem;" onchange="TerminalView.getInstance().onSelectMachine(this.value)">
            ${fleet.length === 0 ? '<option value="">No enrolled machines</option>' : ''}
            ${fleet.map(m => `
              <option value="${m.id}" ${m.id === activeMachineId ? 'selected' : ''}>
                ${m.hostname || m.id} (${m.virtual_ip || 'No VIP'}) [${m.os || 'Host'}]
              </option>
            `).join('')}
          </select>

          <select id="term-profile-select" class="form-select" style="background:#0f172a; color:#f8fafc; border:1px solid #334155; padding:0.35rem 0.6rem; border-radius:4px; font-size:0.82rem;" title="Privilege Profile">
            <option value="auto">⚡ AUTO Privilege</option>
            <option value="standard">Standard User</option>
            <option value="privileged">Administrator / Root</option>
          </select>

          <select id="term-shell-select" class="form-select" style="background:#0f172a; color:#f8fafc; border:1px solid #334155; padding:0.35rem 0.6rem; border-radius:4px; font-size:0.82rem;" title="Shell Preference">
            <option value="auto">Auto Detect Shell</option>
            <option value="powershell">PowerShell</option>
            <option value="cmd">cmd.exe</option>
            <option value="pwsh">pwsh (Core)</option>
            <option value="bash">bash / sh</option>
          </select>

          <button id="term-btn-connect" class="btn btn-primary" style="padding:0.35rem 0.85rem; font-size:0.82rem; font-weight:600;" onclick="TerminalView.getInstance().toggleSession()">
            ⚡ Connect Shell
          </button>

          <button class="btn btn-secondary" style="padding:0.35rem 0.6rem; font-size:0.82rem;" onclick="TerminalView.getInstance().clearScreen()" title="Clear Screen">
            Clear
          </button>

          <button class="btn btn-secondary" style="padding:0.35rem 0.6rem; font-size:0.82rem;" onclick="TerminalView.getInstance().copyBuffer()" title="Copy Terminal Output">
            📋 Copy
          </button>

          <button class="btn btn-secondary" style="padding:0.35rem 0.6rem; font-size:0.82rem;" onclick="TerminalView.getInstance().downloadLog()" title="Download Session Log">
            💾 Log
          </button>

          <div style="display:inline-flex; border:1px solid #334155; border-radius:4px; overflow:hidden;">
            <button class="btn btn-secondary" style="border:none; padding:0.35rem 0.5rem; font-size:0.82rem;" onclick="TerminalView.getInstance().adjustFontSize(1)" title="Increase Font">A+</button>
            <button class="btn btn-secondary" style="border:none; padding:0.35rem 0.5rem; font-size:0.82rem;" onclick="TerminalView.getInstance().adjustFontSize(-1)" title="Decrease Font">A-</button>
          </div>
        </div>
      </div>

      <div class="terminal-container card" style="display:flex; flex-direction:column; background:#080b11; border:1px solid #1e293b; border-radius:8px; overflow:hidden; box-shadow:0 12px 32px rgba(0,0,0,0.5);">
        <!-- Status Bar -->
        <div class="terminal-status-bar" style="display:flex; justify-content:space-between; align-items:center; padding:0.5rem 0.85rem; background:#0d131f; border-bottom:1px solid #1e293b; font-size:0.8rem; font-family:'Geist Mono', Consolas, monospace;">
          <div style="display:flex; align-items:center; gap:0.65rem;">
            <span id="term-status-dot" style="width:8px; height:8px; border-radius:50%; background:#64748b; display:inline-block;"></span>
            <span id="term-status-text" style="color:#94a3b8; font-weight:500;">Idle · Disconnected</span>
            <span id="term-profile-badge" style="display:none; padding:0.15rem 0.45rem; border-radius:3px; font-size:0.7rem; font-weight:600;"></span>
          </div>
          <div style="display:flex; align-items:center; gap:0.75rem; color:#64748b; font-size:0.75rem;">
            <span id="term-session-id">Session: --</span>
            <span id="term-dimensions">Cols: -- × Rows: --</span>
          </div>
        </div>

        <!-- Terminal Screen Surface -->
        <div id="term-screen-wrapper" style="position:relative; flex:1 1 0%; min-height:450px; background:#080b11; padding:0.5rem; overflow:hidden;">
          <div id="term-xterm" style="width:100%; height:100%;"></div>
          <div id="term-fallback-output" style="display:none; width:100%; height:100%; overflow-y:auto; color:#e2e8f0; font-family:'Geist Mono', Consolas, monospace; font-size:13px; white-space:pre-wrap; word-break:break-all;"></div>
        </div>

        <!-- Quick Commands Strip -->
        <div class="terminal-quick-chips" style="display:flex; align-items:center; gap:0.4rem; padding:0.4rem 0.85rem; background:#0b101b; border-top:1px solid #1e293b; overflow-x:auto;">
          <span style="font-size:0.72rem; color:#64748b; font-weight:600; text-transform:uppercase; margin-right:0.3rem;">Quick:</span>
          <button class="quick-chip btn-sm" onclick="TerminalView.getInstance().sendQuickCmd('whoami')">whoami</button>
          <button class="quick-chip btn-sm" onclick="TerminalView.getInstance().sendQuickCmd('hostname')">hostname</button>
          <button class="quick-chip btn-sm" onclick="TerminalView.getInstance().sendQuickCmd('uptime || systeminfo')">uptime</button>
          <button class="quick-chip btn-sm" onclick="TerminalView.getInstance().sendQuickCmd('ipconfig || ip a')">net-info</button>
          <button class="quick-chip btn-sm" onclick="TerminalView.getInstance().sendQuickCmd('tasklist || ps aux')">ps</button>
          <button class="quick-chip btn-sm" onclick="TerminalView.getInstance().sendQuickCmd('cls || clear')">cls</button>
        </div>
      </div>
    `;

    this._initXterm();
  }

  static getInstance() {
    if (!window._stationTerminalViewInstance) {
      window._stationTerminalViewInstance = new TerminalView(
        window.stationApp?.state,
        window.stationApp?.api
      );
    }
    return window._stationTerminalViewInstance;
  }

  onSelectMachine(machineId) {
    this.activeMachineId = machineId;
    if (this.state && this.state.set) {
      this.state.set('activeMachineId', machineId);
    }
    if (this.activeWs) {
      this.disconnect();
    }
  }

  _initXterm() {
    const xtermWrapper = document.getElementById('term-xterm');
    const fallbackEl = document.getElementById('term-fallback-output');
    if (!xtermWrapper) return;

    if (typeof Terminal !== 'undefined') {
      if (fallbackEl) fallbackEl.style.display = 'none';
      xtermWrapper.style.display = 'block';

      if (!this.term) {
        this.term = new Terminal({
          cursorBlink: true,
          cursorStyle: 'block',
          fontSize: this.fontSize,
          fontFamily: 'Geist Mono, Consolas, "Courier New", monospace',
          scrollback: 10000,
          scrollOnUserInput: true,
          smoothScrollDuration: 0,
          theme: {
            background: '#080b11',
            foreground: '#e2e8f0',
            cursor: '#00f0ff',
            selectionBackground: 'rgba(0, 240, 255, 0.3)',
            black: '#080b11',
            red: '#ef4444',
            green: '#10b981',
            yellow: '#f59e0b',
            blue: '#3b82f6',
            magenta: '#8b5cf6',
            cyan: '#00f0ff',
            white: '#ffffff',
            brightBlack: '#475569',
            brightRed: '#f87171',
            brightGreen: '#34d399',
            brightYellow: '#fbbf24',
            brightBlue: '#60a5fa',
            brightMagenta: '#a78bfa',
            brightCyan: '#67e8f9',
            brightWhite: '#ffffff'
          },
          convertEol: true
        });

        if (typeof FitAddon !== 'undefined' && FitAddon.FitAddon) {
          this.fitAddon = new FitAddon.FitAddon();
          this.term.loadAddon(this.fitAddon);
        }

        this.term.open(xtermWrapper);

        // Forward raw user keystrokes over WebSocket
        this.term.onData(data => {
          if (this.activeWs && this.activeWs.readyState === WebSocket.OPEN) {
            this.activeWs.send(JSON.stringify({ type: 'input', data }));
          }
          try { this.term.scrollToBottom(); } catch (_) {}
        });

        // Forward viewport resize events over WebSocket
        this.term.onResize(size => {
          this._updateDimensionsLabel(size.cols, size.rows);
          if (this.activeWs && this.activeWs.readyState === WebSocket.OPEN) {
            this.activeWs.send(JSON.stringify({ type: 'resize', cols: size.cols, rows: size.rows }));
          }
        });

        // Observe container resize
        if (typeof ResizeObserver !== 'undefined' && !this.resizeObserver) {
          const screenWrap = document.getElementById('term-screen-wrapper');
          if (screenWrap) {
            this.resizeObserver = new ResizeObserver(() => {
              requestAnimationFrame(() => this.fit());
            });
            this.resizeObserver.observe(screenWrap);
          }
        }

        window.addEventListener('resize', () => this.fit());

        this.term.writeln('\x1b[90m[*] CyberVPS Space Station Ultra Web Terminal (v2.1.0)\x1b[0m');
        this.term.writeln('\x1b[90m[*] Select target host and click "⚡ Connect Shell" to establish live session.\x1b[0m\r\n');
        setTimeout(() => this.fit(), 50);
      }
    } else {
      if (fallbackEl) fallbackEl.style.display = 'block';
      xtermWrapper.style.display = 'none';
      fallbackEl.innerHTML = '[*] CyberVPS Space Station Web Terminal Console\n[*] Click "Connect Shell" to start.\n';
    }
  }

  fit() {
    if (this.fitAddon && this.term) {
      try {
        this.fitAddon.fit();
        this._updateDimensionsLabel(this.term.cols, this.term.rows);
        if (this.activeWs && this.activeWs.readyState === WebSocket.OPEN) {
          this.activeWs.send(JSON.stringify({
            type: 'resize',
            cols: this.term.cols,
            rows: this.term.rows
          }));
        }
      } catch (_) {}
    }
  }

  _updateDimensionsLabel(cols, rows) {
    const dimEl = document.getElementById('term-dimensions');
    if (dimEl) {
      dimEl.innerText = `Cols: ${cols} × Rows: ${rows}`;
    }
  }

  _setStatus(status, text, color = '#94a3b8') {
    const dotEl = document.getElementById('term-status-dot');
    const textEl = document.getElementById('term-status-text');
    const btnConnect = document.getElementById('term-btn-connect');

    if (dotEl) dotEl.style.background = color;
    if (textEl) {
      textEl.innerText = text;
      textEl.style.color = color;
    }

    if (btnConnect) {
      if (status === 'connected') {
        btnConnect.className = 'btn btn-danger';
        btnConnect.innerText = '🛑 Disconnect';
      } else if (status === 'connecting') {
        btnConnect.className = 'btn btn-warning';
        btnConnect.innerText = '⏳ Connecting...';
      } else {
        btnConnect.className = 'btn btn-primary';
        btnConnect.innerText = '⚡ Connect Shell';
      }
    }
  }

  toggleSession() {
    if (this.activeWs && (this.activeWs.readyState === WebSocket.OPEN || this.activeWs.readyState === WebSocket.CONNECTING)) {
      this.disconnect();
    } else {
      this.connect();
    }
  }

  async connect() {
    const machineSelect = document.getElementById('term-machine-select');
    const machineId = machineSelect ? machineSelect.value : this.activeMachineId;

    if (!machineId) {
      alert('Please select an enrolled machine first.');
      return;
    }

    if (this.isConnecting) return;
    this.isConnecting = true;

    const profilePref = document.getElementById('term-profile-select')?.value || 'auto';
    const shellPref = document.getElementById('term-shell-select')?.value || 'auto';

    this.disconnect();
    const sessionCorrelation = 'sess_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
    this.activeSessionToken = sessionCorrelation;
    this.isReady = false;

    this._setStatus('connecting', `Minting session token for ${machineId}...`, '#f59e0b');
    if (this.term) {
      this.term.writeln(`\r\n\x1b[90m[*] Authenticating terminal token for [${machineId}] (Profile: ${profilePref}, Shell: ${shellPref})...\x1b[0m`);
    }

    try {
      // 1. Acquire single-use scoped terminal token
      let token = null;
      if (this.api && typeof this.api.createTerminalSession === 'function') {
        const res = await this.api.createTerminalSession(machineId, shellPref, profilePref);
        token = res.token || res.session_token;
      } else {
        const baseUrl = (this.api && this.api.getBaseUrl ? this.api.getBaseUrl() : window.location.origin).replace(/\/$/, '');
        const pairingKey = this.state?.get ? this.state.get('pairingKey') : localStorage.getItem('cvps_pairing_key');
        const tokenRes = await fetch(`${baseUrl}/api/v1/terminal/token`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(pairingKey ? { 'X-CVPS-Pairing-Key': pairingKey } : {})
          },
          body: JSON.stringify({ machine_id: machineId, profile: profilePref, shell: shellPref })
        });
        if (!tokenRes.ok) {
          const errBody = await tokenRes.json().catch(() => ({}));
          throw new Error(errBody.error || `HTTP ${tokenRes.status} authentication failed`);
        }
        const data = await tokenRes.json();
        token = data.token;
      }

      if (!token) {
        throw new Error('Failed to acquire valid terminal token from Space Station');
      }

      if (this.activeSessionToken !== sessionCorrelation) return;

      // 2. Open authenticated WebSocket stream
      const cols = this.term ? this.term.cols : 80;
      const rows = this.term ? this.term.rows : 24;
      const baseUrl = (this.api && this.api.getBaseUrl ? this.api.getBaseUrl() : window.location.origin);
      const isHttps = baseUrl.startsWith('https');
      const wsProtocol = isHttps ? 'wss:' : 'ws:';
      const wsHost = baseUrl.replace(/^https?:\/\//, '').replace(/\/$/, '');
      const wsUrl = `${wsProtocol}//${wsHost}/api/v1/terminal/stream?machine_id=${encodeURIComponent(machineId)}&token=${encodeURIComponent(token)}&cols=${cols}&rows=${rows}&profile=${encodeURIComponent(profilePref)}&shell=${encodeURIComponent(shellPref)}`;

      this._setStatus('connecting', `Opening stream bridge to ${machineId}...`, '#f59e0b');
      const ws = new WebSocket(wsUrl);
      this.activeWs = ws;

      ws.onopen = () => {
        this.isConnecting = false;
        if (this.activeSessionToken !== sessionCorrelation) return;
        this._setStatus('connecting', 'Bridge established · Initializing shell...', '#00f0ff');
        const sessEl = document.getElementById('term-session-id');
        if (sessEl) sessEl.innerText = `Token: ${token.slice(0, 14)}...`;

        if (this.term) {
          this.term.writeln(`\x1b[90m[*] WebSocket transport established. Starting remote OS pseudo-console...\x1b[0m`);
          this.fit();
          this.term.focus();
        }
      };

      ws.onmessage = (event) => {
        if (this.activeSessionToken !== sessionCorrelation) return;
        let msg = event.data;
        try {
          const parsed = JSON.parse(msg);
          if (parsed && parsed.type === 'ready') {
            this.isReady = true;
            const backend = parsed.backend || parsed.shell || 'Native Shell';
            this._setStatus('connected', `Connected · ${backend}`, '#10b981');

            const profBadge = document.getElementById('term-profile-badge');
            if (profBadge) {
              profBadge.style.display = 'inline-block';
              if (parsed.is_elevated || parsed.profile === 'privileged') {
                profBadge.style.background = 'rgba(245,158,11,0.2)';
                profBadge.style.color = '#f59e0b';
                profBadge.innerText = 'Administrator (Elevated)';
              } else {
                profBadge.style.background = 'rgba(100,116,139,0.2)';
                profBadge.style.color = '#94a3b8';
                profBadge.innerText = 'Standard User';
              }
            }

            if (this.term) {
              this.term.writeln(`\r\n\x1b[32m[+] Pseudo-terminal ready [${backend} | PID: ${parsed.pid || 'running'} | User: ${parsed.user || 'host'}]. Interactive mode active.\x1b[0m\r\n`);
              this.fit();
              this.term.focus();
            }
            return;
          } else if (parsed && parsed.type === 'output' && parsed.data !== undefined) {
            msg = parsed.data;
          } else if (parsed && parsed.type === 'exit') {
            this.isReady = false;
            const code = parsed.exit_code !== undefined ? parsed.exit_code : 0;
            this._setStatus('idle', `Shell Exited (Code ${code})`, '#64748b');
            if (this.term) {
              this.term.writeln(`\r\n\x1b[33m[-] Process terminated with exit code ${code}\x1b[0m\r\n`);
            }
            return;
          } else if (parsed && parsed.type === 'status') {
            if (parsed.status === 'connecting') {
              this._setStatus('connecting', parsed.message || 'Connecting...', '#f59e0b');
              if (this.term && parsed.message) {
                this.term.writeln(`\x1b[90m[*] ${parsed.message}\x1b[0m\r\n`);
              }
              return;
            } else if (parsed.status === 'error' || parsed.status === 'timeout') {
              this.isReady = false;
              if (parsed.code === 'AGENT_OFFLINE') {
                this._setStatus('connecting', 'Agent link recovering... retrying in 2s', '#f59e0b');
                if (this.term) {
                  this.term.writeln(`\r\n\x1b[33m[*] Host machine agent relay bridge is recovering. Auto-retrying connection in 2s...\x1b[0m\r\n`);
                }
                setTimeout(() => {
                  if (!this.isReady && (document.getElementById('term-machine-select')?.value === machineId || this.activeMachineId === machineId)) {
                    this.connect();
                  }
                }, 2000);
                return;
              }
              this._setStatus('error', `Error: ${parsed.error || parsed.code}`, '#ef4444');
              if (this.term) {
                this.term.writeln(`\r\n\x1b[31m[!] Host Error: ${parsed.error || 'Connection failed'}\x1b[0m\r\n`);
              }
              return;
            }
          } else if (parsed && parsed.error) {
            this.isReady = false;
            this._setStatus('error', `Error: ${parsed.error}`, '#ef4444');
            if (this.term) {
              this.term.writeln(`\r\n\x1b[31m[!] Terminal stream error: ${parsed.error}\x1b[0m\r\n`);
            }
            return;
          }
        } catch (_) {}

        this.logBuffer.push(msg);
        if (this.term) {
          this.term.write(msg);
          try { this.term.scrollToBottom(); } catch (_) {}
        } else {
          const fallbackEl = document.getElementById('term-fallback-output');
          if (fallbackEl) {
            fallbackEl.innerText += msg;
            fallbackEl.scrollTop = fallbackEl.scrollHeight;
          }
        }
      };

      ws.onerror = (err) => {
        this.isConnecting = false;
        if (this.activeSessionToken !== sessionCorrelation) return;
        this.isReady = false;
        this._setStatus('error', 'WebSocket Transport Error', '#ef4444');
        if (this.term) {
          this.term.writeln(`\r\n\x1b[31m[!] WebSocket transport connection failure.\x1b[0m\r\n`);
        }
      };

      ws.onclose = (event) => {
        this.isConnecting = false;
        if (this.activeSessionToken !== sessionCorrelation) return;
        this.isReady = false;
        const reason = event.reason ? ` (${event.reason})` : '';
        this._setStatus('idle', `Disconnected · Code ${event.code}${reason}`, '#64748b');
        if (this.term) {
          this.term.writeln(`\r\n\x1b[90m[*] Terminal stream disconnected [Code ${event.code}${reason}].\x1b[0m\r\n`);
        }
      };

    } catch (err) {
      this.isConnecting = false;
      this.isReady = false;
      this._setStatus('error', `Connection Failed: ${err.message}`, '#ef4444');
      if (this.term) {
        this.term.writeln(`\r\n\x1b[31m[!] Connection failed: ${err.message}\x1b[0m\r\n`);
      }
    }
  }

  disconnect() {
    this.isConnecting = false;
    this.isReady = false;
    if (this.activeWs) {
      try {
        const ws = this.activeWs;
        this.activeWs = null;
        ws.onopen = null;
        ws.onmessage = null;
        ws.onerror = null;
        ws.onclose = null;
        ws.close(1000, 'User disconnected');
      } catch (_) {}
    }
    this._setStatus('idle', 'Disconnected', '#64748b');
    const profBadge = document.getElementById('term-profile-badge');
    if (profBadge) profBadge.style.display = 'none';
  }

  sendQuickCmd(cmd) {
    if (!this.activeWs || this.activeWs.readyState !== WebSocket.OPEN) {
      alert('Terminal is not currently connected. Please click "⚡ Connect Shell" first.');
      return;
    }
    this.activeWs.send(JSON.stringify({ type: 'input', data: cmd + '\r' }));
    if (this.term) this.term.focus();
  }

  clearScreen() {
    this.logBuffer = [];
    if (this.term) {
      this.term.clear();
      this.term.reset();
    }
    const fallbackEl = document.getElementById('term-fallback-output');
    if (fallbackEl) fallbackEl.innerHTML = '';
  }

  copyBuffer() {
    let textToCopy = '';
    if (this.term) {
      textToCopy = this.term.getSelection() || '';
    }
    if (!textToCopy) {
      textToCopy = this.logBuffer.join('');
    }
    if (!textToCopy.trim()) return;

    function execCommandCopy(str) {
      const ta = document.createElement('textarea');
      ta.value = str;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.top = '-9999px';
      ta.style.left = '-9999px';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch (_) {}
      document.body.removeChild(ta);
      return ok;
    }

    if (navigator.clipboard && window.isSecureContext && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(textToCopy).then(() => {
        if (typeof showToast === 'function') showToast('Terminal output copied to clipboard', 'success');
        else alert('Terminal output copied to clipboard!');
      }).catch(() => {
        if (execCommandCopy(textToCopy)) {
          if (typeof showToast === 'function') showToast('Terminal output copied to clipboard', 'success');
          else alert('Terminal output copied to clipboard!');
        } else {
          alert('Could not write to clipboard.');
        }
      });
    } else {
      if (execCommandCopy(textToCopy)) {
        if (typeof showToast === 'function') showToast('Terminal output copied to clipboard', 'success');
        else alert('Terminal output copied to clipboard!');
      } else {
        alert('Could not write to clipboard.');
      }
    }
  }

  downloadLog() {
    const content = this.logBuffer.join('');
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `terminal-session-${this.activeMachineId || 'cybervps'}-${Date.now()}.log`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  adjustFontSize(delta) {
    this.fontSize = Math.min(Math.max(this.fontSize + delta, 9), 24);
    if (this.term) {
      this.term.options.fontSize = this.fontSize;
      this.fit();
    }
  }
}

// Global hook for deterministic dashboard integration
if (typeof window !== 'undefined') {
  window.TerminalView = TerminalView;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = TerminalView;
}
