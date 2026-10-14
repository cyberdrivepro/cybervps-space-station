/**
 * CyberVPS SPACE STATION - Unified Control Plane, Relay & Universal Network Bridge
 * Mode A: Universal TCP Port Bridge (1-65535 on demand, conflict-safe local binding)
 * Mode B: Virtual Private Network (10.77.0.0/24 Virtual IP allocator, peer routing)
 */

const http = require('http');
const url = require('url');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer, WebSocket } = require('ws');
const TunnelManager = require('./tunnel-manager');

const PORT = process.env.PORT || 8080;
const BASE_DOMAIN = process.env.BASE_DOMAIN || 'localhost';
const tunnelManager = new TunnelManager({ port: PORT, pairingKey: process.env.PAIRING_KEY });

// Daemon file logging support
if (process.env.CYBERVPS_LOG_FILE) {
  try {
    const logDir = path.dirname(process.env.CYBERVPS_LOG_FILE);
    if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
    const logStream = fs.createWriteStream(process.env.CYBERVPS_LOG_FILE, { flags: 'a' });
    const origLog = console.log;
    const origErr = console.error;
    console.log = (...a) => {
      origLog(...a);
      logStream.write(a.map(x => typeof x === 'object' ? JSON.stringify(x) : x).join(' ') + '\n');
    };
    console.error = (...a) => {
      origErr(...a);
      logStream.write('[ERR] ' + a.map(x => typeof x === 'object' ? JSON.stringify(x) : x).join(' ') + '\n');
    };
  } catch (_) {}
}

// Virtual IP Pool for Mode B (10.77.0.0/24)

class VirtualIpPool {
  constructor() {
    this.allocated = new Map(); // machine_id -> '10.77.0.X'
    this.used = new Set([0, 1, 255]); // 10.77.0.1 reserved for Station Gateway
  }
  allocate(machineId) {
    if (this.allocated.has(machineId)) return this.allocated.get(machineId);
    for (let host = 2; host < 255; host++) {
      if (!this.used.has(host)) {
        this.used.add(host);
        const ip = `10.77.0.${host}`;
        this.allocated.set(machineId, ip);
        return ip;
      }
    }
    throw new Error('Virtual IP address pool exhausted (253 peers limit)');
  }
  release(machineId) {
    const ip = this.allocated.get(machineId);
    if (ip) {
      const host = parseInt(ip.split('.')[3], 10);
      this.used.delete(host);
      this.allocated.delete(machineId);
    }
  }
}

const vpnPool = new VirtualIpPool();

// In-Memory Data Store with Durable Persistence
const db = {
  machines: new Map(),
  ports: new Map(), // machine_id -> [PortObservation]
  tunnels: new Map(), // tunnel_id -> TunnelConfig (Public Gateway)
  bridgeMappings: new Map(), // mapping_id -> BridgeMapping (Local PC -> Remote Port)
  enrollmentTokens: new Set(['cvps_enroll_master_token']),
  auditLogs: [],
  pendingCommands: new Map(), // machine_id -> [ServerCommand]
  connectedAgents: new Map(), // machine_id -> ws
  tunnelStreams: new Map(), // stream_id -> { res, req, buffer, isWsUpgrade, ... }
  bridgeStreamSockets: new Map(), // stream_id -> { clientWs, agentWs }
  terminalSessions: new Map(), // session_id -> { machine_id, wsBrowser }
  terminalAuthTokens: new Map(), // token -> { machine_id, profile, expires_at }
  pendingRequests: new Map(), // request_id -> { resolve, reject, timer }
  telemetrySubscribers: new Set() // active SSE client responses for 2-second real-time fan-out
};

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const STATE_FILE = path.join(DATA_DIR, 'server-state.json');

function loadPersistentState() {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    if (fs.existsSync(STATE_FILE)) {
      const raw = fs.readFileSync(STATE_FILE, 'utf8');
      const data = JSON.parse(raw);
      if (Array.isArray(data.machines)) {
        for (const m of data.machines) {
          db.machines.set(m.id, m);
          if (m.virtual_ip) {
            vpnPool.allocated.set(m.id, m.virtual_ip);
            const host = parseInt(m.virtual_ip.split('.')[3], 10);
            if (!isNaN(host)) vpnPool.used.add(host);
          }
        }
      }
      if (Array.isArray(data.ports)) {
        for (const p of data.ports) {
          db.ports.set(p.machine_id, p.ports || []);
        }
      }
      if (Array.isArray(data.bridgeMappings)) {
        for (const b of data.bridgeMappings) {
          db.bridgeMappings.set(b.id, b);
        }
      }
      if (Array.isArray(data.tunnels)) {
        for (const t of data.tunnels) {
          db.tunnels.set(t.id, t);
        }
      }
      if (Array.isArray(data.auditLogs)) {
        db.auditLogs = data.auditLogs.slice(0, 500);
      }
      console.log(`[*] Loaded persistent state: ${db.machines.size} machines, ${db.bridgeMappings.size} bridges, ${db.tunnels.size} tunnels`);
    }
  } catch (err) {
    console.warn(`[WARN] Could not load persistent state: ${err.message}`);
  }
}

let saveStateTimeout = null;
function savePersistentState() {
  if (saveStateTimeout) return;
  saveStateTimeout = setTimeout(() => {
    saveStateTimeout = null;
    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }
      const data = {
        machines: Array.from(db.machines.values()),
        ports: Array.from(db.ports.entries()).map(([mid, pts]) => ({ machine_id: mid, ports: pts })),
        bridgeMappings: Array.from(db.bridgeMappings.values()),
        tunnels: Array.from(db.tunnels.values()),
        auditLogs: db.auditLogs.slice(0, 300)
      };
      fs.writeFileSync(STATE_FILE, JSON.stringify(data, null, 2), 'utf8');
    } catch (err) {
      console.warn(`[WARN] Could not save persistent state: ${err.message}`);
    }
  }, 500);
}

// Load state immediately on startup
loadPersistentState();

function logAudit(eventType, actor, machineId, details, severity = 'info') {
  const event = {
    id: 'aud_' + crypto.randomUUID().slice(0, 8),
    timestamp: new Date().toISOString(),
    event_type: eventType,
    actor,
    machine_id: machineId || null,
    details,
    severity
  };
  db.auditLogs.unshift(event);
  if (db.auditLogs.length > 500) db.auditLogs.pop();
  console.log(`[AUDIT] [${event.severity.toUpperCase()}] ${eventType}: ${details}`);
  savePersistentState();
}

function getMachineStatus(m) {
  if (!m) return 'offline';
  if (db.connectedAgents.has(m.id)) {
    const ws = db.connectedAgents.get(m.id);
    if (ws && ws.readyState === WebSocket.OPEN) return 'online';
  }
  const lastSeenMs = m.last_seen ? new Date(m.last_seen).getTime() : 0;
  const diff = Date.now() - lastSeenMs;
  if (diff < 40000) return 'online';
  if (diff < 90000) return 'reconnecting';
  return 'offline';
}

function broadcastTelemetry(machine) {
  if (db.telemetrySubscribers.size === 0) return;
  const status = getMachineStatus(machine);
  const virtualIp = vpnPool.allocated.get(machine.id) || null;
  const payload = JSON.stringify({
    type: 'telemetry',
    machine: { ...machine, status, virtual_ip: virtualIp }
  });
  const data = `data: ${payload}\n\n`;
  for (const res of db.telemetrySubscribers) {
    try {
      res.write(data);
    } catch (_) {
      db.telemetrySubscribers.delete(res);
    }
  }
}

function sendHttpError(res, err) {
  let status = 500;
  let code = 'INTERNAL_ERROR';
  const msg = (err && err.message) ? err.message : String(err || 'Unknown error');
  if (msg.includes('offline') || msg.includes('not found in fleet') || msg.includes('disconnected')) {
    status = 503;
    code = 'MACHINE_OFFLINE';
  } else if (msg.includes('timed out')) {
    status = 504;
    code = 'RPC_TIMEOUT';
  } else if (msg.includes('not found') || msg.includes('Directory not found') || msg.includes('File not found')) {
    status = 404;
    code = 'NOT_FOUND';
  } else if (msg.includes('Permission denied') || msg.includes('Access is denied')) {
    status = 403;
    code = 'PERMISSION_DENIED';
  } else if (msg.includes('required') || msg.includes('Safety guard') || msg.includes('invalid')) {
    status = 400;
    code = 'BAD_REQUEST';
  }
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: msg, code, status }));
}

function sendAgentRequest(machineId, type, payload = {}, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const machine = db.machines.get(machineId);
    if (!machine) return reject(new Error(`Machine '${machineId}' not found in fleet`));
    const status = getMachineStatus(machine);
    if (status === 'offline') return reject(new Error(`Machine '${machineId}' is offline`));

    const requestId = 'req_' + crypto.randomUUID().slice(0, 10);
    const timer = setTimeout(() => {
      db.pendingRequests.delete(requestId);
      reject(new Error(`Host request '${type}' timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    db.pendingRequests.set(requestId, { resolve, reject, timer, machineId, type, createdAt: Date.now() });

    sendServerCommand(machineId, {
      type,
      payload: { ...payload, request_id: requestId }
    });
  });
}

// HTTP Server
const server = http.createServer(async (req, res) => {
  const parsedUrl = new URL(req.url, 'http://' + (req.headers.host || 'localhost'));
  const pathname = parsedUrl.pathname;
  const method = req.method;

  // CORS Headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Machine-ID, X-Enrollment-Token, X-CVPS-Pairing-Key');

  if (method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // 1. PUBLIC TUNNEL REVERSE PROXY GATEWAY (/tunnel/:tunnel_id/*)
  if (pathname.startsWith('/tunnel/')) {
    handleTunnelProxyRequest(req, res, pathname, parsedUrl);
    return;
  }

  // 2. HEALTH & DOWNLOAD ENDPOINTS
  if (pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'OK',
      version: '1.0.0',
      service: 'CyberVPS Space Station Universal Network Bridge',
      timestamp: new Date().toISOString(),
      active_machines: db.connectedAgents.size,
      active_bridge_mappings: Array.from(db.bridgeMappings.values()).filter(m => m.status === 'active').length,
      active_public_tunnels: Array.from(db.tunnels.values()).filter(t => t.status === 'active').length,
      virtual_network_cidr: '10.77.0.0/24'
    }));
    return;
  }

  if (pathname === '/install.sh') {
    const installScriptPath = path.join(__dirname, '../scripts/install-agent.sh');
    fs.readFile(installScriptPath, 'utf8', (err, data) => {
      res.writeHead(200, { 'Content-Type': 'text/x-shellscript' });
      const hostProto = req.headers['x-forwarded-proto'] || (req.connection.encrypted ? 'https' : 'http');
      const targetHost = (tunnelManager.publicUrl && tunnelManager.providerName !== 'localhost')
        ? tunnelManager.publicUrl
        : `${hostProto}://${req.headers.host || 'localhost:' + PORT}`;
      const customized = (data || '').replace('SERVER_URL="${1:-http://localhost:8080}"', `SERVER_URL="\${1:-${targetHost}}"`);
      res.end(customized);
    });
    return;
  }

  if (pathname === '/install.ps1') {
    const scriptPath = path.join(__dirname, '../scripts/install-agent.ps1');
    fs.readFile(scriptPath, 'utf8', (err, data) => {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      const hostProto = req.headers['x-forwarded-proto'] || (req.connection.encrypted ? 'https' : 'http');
      const targetHost = (tunnelManager.publicUrl && tunnelManager.providerName !== 'localhost')
        ? tunnelManager.publicUrl
        : `${hostProto}://${req.headers.host || 'localhost:' + PORT}`;
      const customized = (data || '').replace('[string]$ServerUrl = "http://localhost:8080"', `[string]$ServerUrl = "${targetHost}"`);
      res.end(customized);
    });
    return;
  }

  if (pathname === '/agent/universal-agent.py') {
    const agentPath = path.join(__dirname, '../agent/universal-agent.py');
    fs.readFile(agentPath, 'utf8', (err, data) => {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end(data || '# Error loading universal-agent.py');
    });
    return;
  }

  if (pathname === '/scripts/agent-watchdog.sh') {
    const watchdogPath = path.join(__dirname, '../scripts/agent-watchdog.sh');
    fs.readFile(watchdogPath, 'utf8', (err, data) => {
      res.writeHead(200, { 'Content-Type': 'text/x-shellscript' });
      res.end(data || '# Error loading agent-watchdog.sh');
    });
    return;
  }

  if (pathname === '/doctor.sh') {
    const docPath = path.join(__dirname, '../scripts/diagnostics/doctor.sh');
    fs.readFile(docPath, 'utf8', (err, data) => {
      res.writeHead(200, { 'Content-Type': 'text/x-shellscript' });
      res.end(data || '# Error loading script');
    });
    return;
  }

  if (pathname.startsWith('/vendor/')) {
    const safeRel = path.normalize(pathname).replace(/^(\.\.[\/\\])+/, '');
    const safePath = path.join(__dirname, '..', safeRel);
    const vendorBase = path.join(__dirname, '..', 'vendor');
    if (safePath.startsWith(vendorBase) && fs.existsSync(safePath) && fs.statSync(safePath).isFile()) {
      const ext = path.extname(safePath).toLowerCase();
      const mimeTypes = { '.css': 'text/css', '.js': 'application/javascript', '.map': 'application/json' };
      res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'application/octet-stream', 'Cache-Control': 'public, max-age=86400' });
      fs.createReadStream(safePath).pipe(res);
      return;
    }
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
    return;
  }

  // 2B. RELAY HTTP EVENT & POLLING ENDPOINTS (Agent Fallback)
  if (pathname === '/api/v1/relay/event' && method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const msg = JSON.parse(body || '{}');
        if (!msg || typeof msg !== 'object' || !msg.type) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid event format. "type" field is required.' }));
          return;
        }

        const machineId = req.headers['x-machine-id'] || (msg.payload && msg.payload.machine_id);
        const token = req.headers['x-enrollment-token'] || (msg.payload && msg.payload.token);

        // Security check for non-Auth events
        const configuredMaster = process.env.ENROLLMENT_TOKEN || 'cvps_enroll_master_token';
        if (msg.type !== 'Auth') {
          if (!machineId || !db.machines.has(machineId)) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Machine not enrolled. Please send Auth event first.' }));
            return;
          }
          if (token && !db.enrollmentTokens.has(token) && token !== configuredMaster) {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Invalid enrollment token' }));
            return;
          }
        }

        const resResult = handleAgentMessage(null, msg);
        if (resResult && !resResult.success) {
          const statusCode = resResult.error && resResult.error.toLowerCase().includes('token') ? 401 : 400;
          res.writeHead(statusCode, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: resResult.error }));
          return;
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, result: resResult ? resResult.result : null }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  if (pathname === '/api/v1/relay/poll' && method === 'GET') {
    const machineId = parsedUrl.searchParams.get('machine_id') || req.headers['x-machine-id'];
    const token = parsedUrl.searchParams.get('token') || req.headers['x-enrollment-token'];

    if (!machineId) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'machine_id parameter required' }));
      return;
    }

    const configuredMaster = process.env.ENROLLMENT_TOKEN || 'cvps_enroll_master_token';
    if (!token || (!db.enrollmentTokens.has(token) && token !== configuredMaster)) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid or missing enrollment token' }));
      return;
    }

    if (!db.machines.has(machineId)) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Machine not found' }));
      return;
    }

    // Touch last_seen on successful poll
    const m = db.machines.get(machineId);
    if (m) m.last_seen = new Date().toISOString();

    const cmds = db.pendingCommands.get(machineId) || [];
    db.pendingCommands.set(machineId, []);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ commands: cmds }));
    return;
  }

  // 2B. REMOTE ACCESS & PAIRING ENDPOINTS
  if (pathname === '/api/v1/access/status' && method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(tunnelManager.getInfo()));
    return;
  }

  if (pathname === '/api/v1/access/pairing' && method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const payload = JSON.parse(body || '{}');
        const token = tunnelManager.verifyPairingKey(payload.pairing_key);
        if (token) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, session_token: token }));
        } else {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'Invalid pairing key' }));
        }
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  if (pathname === '/api/v1/terminal/token' && method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const payload = JSON.parse(body || '{}');
        const { machine_id, profile } = payload;
        const pairing_key = payload.pairing_key || req.headers['x-cvps-pairing-key'] || req.headers['x-pairing-key'];
        const session_token = payload.session_token || req.headers['x-session-token'];
        let bearerToken = null;
        const authHdr = req.headers['authorization'];
        if (authHdr && authHdr.toLowerCase().startsWith('bearer ')) {
          bearerToken = authHdr.slice(7).trim();
        }
        
        // Authenticate client identity
        const configuredMaster = process.env.PAIRING_KEY || process.env.CYBERVPS_TOKEN || process.env.ENROLLMENT_TOKEN || 'cvps_enroll_master_token';
        const isKeyValid = (pairing_key && (pairing_key === tunnelManager.pairingKey || pairing_key === configuredMaster)) ||
                           (bearerToken && (bearerToken === tunnelManager.pairingKey || bearerToken === configuredMaster));
        const isSessionValid = (session_token && tunnelManager.isValidSession(session_token)) ||
                               (bearerToken && tunnelManager.isValidSession(bearerToken));
        
        if (!isKeyValid && !isSessionValid) {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'Unauthorized: Valid pairing key or session token required' }));
          return;
        }
        
        if (!machine_id || !db.machines.has(machine_id)) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'Machine not found in fleet' }));
          return;
        }

        const selectedProfile = profile || 'privileged';
        const termToken = 'term_tok_' + crypto.randomBytes(16).toString('hex');
        db.terminalAuthTokens.set(termToken, {
          machine_id,
          profile: selectedProfile,
          created_at: Date.now(),
          expires_at: Date.now() + 60000 // 60s single-use token
        });

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: true,
          token: termToken,
          machine_id,
          profile: selectedProfile,
          expires_in: 60
        }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // 3. MACHINES & PORTS API
  if (pathname === '/api/v1/machines' && method === 'GET') {
    const list = Array.from(db.machines.values()).map(m => {
      const status = getMachineStatus(m);
      const virtualIp = vpnPool.allocated.get(m.id) || null;
      const username = m.username || m.capabilities?.username || m.capabilities?.user || m.profile?.username || (m.capabilities?.is_root ? 'root' : (m.os === 'Windows' ? 'expert' : 'user'));
      return { ...m, username, status, virtual_ip: virtualIp };
    });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(list));
    return;
  }

  if (pathname.startsWith('/api/v1/machines/') && pathname.endsWith('/ports') && method === 'GET') {
    const parts = pathname.split('/');
    const mId = parts[4];
    const ports = db.ports.get(mId) || [];
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(ports));
    return;
  }

  // 3B. REAL-TIME 2-SECOND TELEMETRY FAN-OUT STREAM (SSE)
  if (pathname === '/api/v1/telemetry/stream' && method === 'GET') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*'
    });
    res.write('retry: 2000\n\n');
    db.telemetrySubscribers.add(res);
    req.on('close', () => { db.telemetrySubscribers.delete(res); });
    return;
  }

  // 3C. MACHINE PROFILE & MANAGEMENT ACTIONS (Neofetch & Tailscale-Style Profile)
  if (pathname.startsWith('/api/v1/machines/') && pathname.endsWith('/profile') && method === 'GET') {
    const parts = pathname.split('/');
    const mId = parts[4];
    const m = db.machines.get(mId);
    if (!m) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Machine not found' }));
      return;
    }
    const status = getMachineStatus(m);
    const virtualIp = vpnPool.allocated.get(m.id) || null;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      ...m,
      status,
      virtual_ip: virtualIp,
      profile: m.profile || {}
    }));
    return;
  }

  if (pathname.startsWith('/api/v1/machines/') && pathname.endsWith('/name') && method === 'POST') {
    const parts = pathname.split('/');
    const mId = parts[4];
    const m = db.machines.get(mId);
    if (!m) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Machine not found' }));
      return;
    }
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        const parsed = JSON.parse(body || '{}');
        const friendly_name = parsed.friendly_name || parsed.name || '';
        m.friendly_name = (friendly_name || '').trim();
        savePersistentState();
        broadcastTelemetry(m);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, friendly_name: m.friendly_name }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  if (pathname.startsWith('/api/v1/machines/') && pathname.endsWith('/refresh') && method === 'POST') {
    const parts = pathname.split('/');
    const mId = parts[4];
    sendServerCommand(mId, { type: 'TriggerDiscovery', payload: {} });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, message: 'Discovery triggered' }));
    return;
  }

  if (pathname.startsWith('/api/v1/machines/') && pathname.endsWith('/revoke') && method === 'POST') {
    const parts = pathname.split('/');
    const mId = parts[4];
    const m = db.machines.get(mId);
    if (m) {
      m.status = 'revoked';
      db.machines.delete(mId);
      vpnPool.release(mId);
      logAudit('machine_revoked', 'admin', mId, `Revoked machine ${mId}`);
      savePersistentState();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, status: 'revoked' }));
    } else {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Machine not found' }));
    }
    return;
  }

  // 3D. ADVANCED FILE MANAGER API (FTP/SFTP-Like Capabilities)
  if (pathname === '/api/v1/files/list' && method === 'GET') {
    const machineId = parsedUrl.searchParams.get('machine_id');
    const dirPath = parsedUrl.searchParams.get('path') || '';
    const showHidden = parsedUrl.searchParams.get('show_hidden') === 'true';
    if (!machineId) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'machine_id parameter required', code: 'BAD_REQUEST' }));
      return;
    }
    try {
      const data = await sendAgentRequest(machineId, 'FileList', { path: dirPath, show_hidden: showHidden }, 18000);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(data));
    } catch (err) {
      sendHttpError(res, err);
    }
    return;
  }

  if (pathname === '/api/v1/files/read' && method === 'GET') {
    const machineId = parsedUrl.searchParams.get('machine_id');
    const filePath = parsedUrl.searchParams.get('path');
    if (!machineId || !filePath) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'machine_id and path required', code: 'BAD_REQUEST' }));
      return;
    }
    try {
      const data = await sendAgentRequest(machineId, 'FileRead', { path: filePath }, 18000);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(data));
    } catch (err) {
      sendHttpError(res, err);
    }
    return;
  }

  if (pathname === '/api/v1/files/write' && method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        const { machine_id, path: filePath, content, is_base64 } = JSON.parse(body || '{}');
        if (!machine_id || !filePath) throw new Error('machine_id and path required');
        const data = await sendAgentRequest(machine_id, 'FileWrite', { path: filePath, content, is_base64 }, 18000);
        logAudit('file_saved', 'user', machine_id, `Saved file: ${filePath}`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(data));
      } catch (err) {
        sendHttpError(res, err);
      }
    });
    return;
  }

  if (pathname === '/api/v1/files/upload' && method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        const { machine_id, path: destPath, filename, content_base64 } = JSON.parse(body || '{}');
        if (!machine_id || !destPath || !filename) throw new Error('machine_id, path and filename required');
        const sep = destPath.includes('\\') ? '\\' : '/';
        const targetFile = destPath.endsWith(sep) ? destPath + filename : destPath + sep + filename;
        const data = await sendAgentRequest(machine_id, 'FileWrite', { path: targetFile, content: content_base64, is_base64: true }, 25000);
        logAudit('file_uploaded', 'user', machine_id, `Uploaded file: ${targetFile}`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, path: targetFile, filename }));
      } catch (err) {
        sendHttpError(res, err);
      }
    });
    return;
  }

  if (pathname === '/api/v1/files/download' && method === 'GET') {
    const machineId = parsedUrl.searchParams.get('machine_id');
    const filePath = parsedUrl.searchParams.get('path');
    if (!machineId || !filePath) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'machine_id and path required', code: 'BAD_REQUEST' }));
      return;
    }
    try {
      const data = await sendAgentRequest(machineId, 'FileRead', { path: filePath, download: true, max_bytes: 500 * 1024 * 1024 }, 60000);
      const filename = data.filename || 'download';
      res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
      if (data.is_binary && data.content_base64) {
        res.setHeader('Content-Type', 'application/octet-stream');
        res.end(Buffer.from(data.content_base64, 'base64'));
      } else {
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.end(data.content || '');
      }
      logAudit('file_downloaded', 'user', machineId, `Downloaded file: ${filePath}`);
    } catch (err) {
      sendHttpError(res, err);
    }
    return;
  }

  if (pathname === '/api/v1/files/delete' && method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        const { machine_id, path: targetPath, recursive } = JSON.parse(body || '{}');
        if (!machine_id || !targetPath) throw new Error('machine_id and path required');

        const norm = targetPath.trim().replace(/[\\/]+$/, '').toLowerCase();
        if (norm === '' || norm === '/' || norm === 'c:' || norm === 'c:\\' || norm === 'c:\\windows' || norm === '/etc' || norm === '/boot') {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Safety guard: Root or critical system directory deletion is blocked!', code: 'BAD_REQUEST' }));
          return;
        }

        const data = await sendAgentRequest(machine_id, 'FileDelete', { path: targetPath, recursive }, 18000);
        logAudit('file_deleted', 'user', machine_id, `Deleted path: ${targetPath}`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(data));
      } catch (err) {
        sendHttpError(res, err);
      }
    });
    return;
  }

  if (pathname === '/api/v1/files/rename' && method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        const { machine_id, old_path, new_path } = JSON.parse(body || '{}');
        if (!machine_id || !old_path || !new_path) throw new Error('machine_id, old_path and new_path required');
        const data = await sendAgentRequest(machine_id, 'FileRename', { old_path, new_path }, 18000);
        logAudit('file_renamed', 'user', machine_id, `Renamed ${old_path} -> ${new_path}`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(data));
      } catch (err) {
        sendHttpError(res, err);
      }
    });
    return;
  }

  if (pathname === '/api/v1/files/mkdir' && method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        const { machine_id, path: targetPath } = JSON.parse(body || '{}');
        if (!machine_id || !targetPath) throw new Error('machine_id and path required');
        const data = await sendAgentRequest(machine_id, 'FileMkdir', { path: targetPath }, 18000);
        logAudit('folder_created', 'user', machine_id, `Created folder: ${targetPath}`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(data));
      } catch (err) {
        sendHttpError(res, err);
      }
    });
    return;
  }

  if (pathname === '/api/v1/files/disk' && method === 'GET') {
    const machineId = parsedUrl.searchParams.get('machine_id');
    const targetPath = parsedUrl.searchParams.get('path') || '.';
    if (!machineId) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'machine_id parameter required' }));
      return;
    }
    try {
      const data = await sendAgentRequest(machineId, 'FileStat', { path: targetPath });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(data));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // 3E. PROCESSES & SERVICES MANAGEMENT API
  if (pathname === '/api/v1/processes' && method === 'GET') {
    const machineId = parsedUrl.searchParams.get('machine_id');
    const search = parsedUrl.searchParams.get('search') || '';
    const sort = parsedUrl.searchParams.get('sort') || 'memory';
    const limit = parseInt(parsedUrl.searchParams.get('limit') || '150', 10);
    if (!machineId) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'machine_id parameter required' }));
      return;
    }
    try {
      const data = await sendAgentRequest(machineId, 'ProcessList', { search, sort, limit }, 15000);
      const m = db.machines.get(machineId);
      if (m && m.telemetry) {
        if (!data.host_cpu_percent && m.telemetry.cpu_percent) data.host_cpu_percent = m.telemetry.cpu_percent;
        if (!data.host_mem_used_mb && m.telemetry.memory_used_mb) data.host_mem_used_mb = m.telemetry.memory_used_mb;
        if (!data.host_mem_total_mb && m.telemetry.memory_total_mb) data.host_mem_total_mb = m.telemetry.memory_total_mb;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(data));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  if (pathname === '/api/v1/processes/kill' && method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        const { machine_id, pid, force } = JSON.parse(body || '{}');
        if (!machine_id || pid === undefined) throw new Error('machine_id and pid required');
        const data = await sendAgentRequest(machine_id, 'ProcessKill', { pid: parseInt(pid, 10), force: Boolean(force) }, 12000);
        logAudit('process_kill', 'user', machine_id, `Killed PID ${pid} (force=${Boolean(force)})`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(data));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  if (pathname === '/api/v1/processes/start' && method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        const { machine_id, command, args, cwd } = JSON.parse(body || '{}');
        if (!machine_id || !command) throw new Error('machine_id and command required');
        const data = await sendAgentRequest(machine_id, 'ProcessStart', { command, args: args || [], cwd }, 12000);
        logAudit('process_start', 'user', machine_id, `Started process: ${command}`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(data));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  if (pathname === '/api/v1/processes/details' && method === 'GET') {
    const machineId = parsedUrl.searchParams.get('machine_id');
    const pid = parsedUrl.searchParams.get('pid');
    if (!machineId || !pid) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'machine_id and pid required' }));
      return;
    }
    try {
      const data = await sendAgentRequest(machineId, 'ProcessDetails', { pid: parseInt(pid, 10) }, 10000);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(data));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  if (pathname === '/api/v1/services' && method === 'GET') {
    const machineId = parsedUrl.searchParams.get('machine_id');
    const search = parsedUrl.searchParams.get('search') || '';
    const status = parsedUrl.searchParams.get('status') || 'all';
    if (!machineId) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'machine_id parameter required' }));
      return;
    }
    try {
      const data = await sendAgentRequest(machineId, 'ServiceList', { search, status }, 15000);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(data));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  if (pathname === '/api/v1/services/action' && method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        const { machine_id, service_name, action } = JSON.parse(body || '{}');
        if (!machine_id || !service_name || !action) throw new Error('machine_id, service_name and action required');
        const data = await sendAgentRequest(machine_id, 'ServiceAction', { service_name, action }, 15000);
        logAudit('service_action', 'user', machine_id, `Service ${action}: ${service_name}`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(data));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  if (pathname === '/api/v1/sftp/status' && method === 'GET') {
    const machineId = parsedUrl.searchParams.get('machine_id');
    if (!machineId) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'ready',
        protocol: 'SFTP / SSH',
        port: 22,
        info: 'SFTP available across enrolled fleet via port 22'
      }));
      return;
    }
    const m = db.machines.get(machineId);
    if (!m) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Machine not found' }));
      return;
    }
    const ports = db.ports.get(machineId) || [];
    const hasSsh = ports.some(p => p.port === 22 || p.process_name?.toLowerCase().includes('ssh'));
    const host = vpnPool.allocated.get(machineId) || m.hostname;
      const username = m.username || m.capabilities?.username || m.capabilities?.user || m.profile?.username || (m.capabilities?.is_root ? 'root' : (m.os === 'Windows' ? 'expert' : 'user'));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'ready',
        available: hasSsh || true,
        protocol: 'SFTP / SSH',
        port: 22,
        host,
        username,
        encryption: 'AES-256-GCM / ChaCha20-Poly1305 (TLS Bridged)',
        command: `sftp -P 22 ${username}@${host}`,
        sftp_command: `sftp -P 22 ${username}@${host}`
      }));
    return;
  }

  if (pathname === '/api/v1/enrollment/token' && method === 'POST') {
    const token = 'cvps_enroll_' + crypto.randomUUID().replace(/-/g, '').slice(0, 16);
    db.enrollmentTokens.add(token);
    logAudit('token_created', 'admin', null, `Created enrollment token ${token}`);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ token, expires_in_seconds: 3600 }));
    return;
  }

  // 4. MODE A: UNIVERSAL TCP PORT BRIDGE API (PC <---> Remote VPS Port Mapping)
  if (pathname === '/api/v1/bridge/mappings' && method === 'GET') {
    const list = Array.from(db.bridgeMappings.values());
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(list));
    return;
  }

  if (pathname === '/api/v1/bridge/mappings' && method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const payload = JSON.parse(body);
        const { machine_id, remote_port, local_port } = payload;
        
        if (!machine_id || !remote_port) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'machine_id and remote_port are required' }));
          return;
        }

        const rPort = parseInt(remote_port, 10);
        if (rPort < 1 || rPort > 65535) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Port must be between 1 and 65535' }));
          return;
        }

        const mappingId = 'bridge_' + crypto.randomUUID().slice(0, 8);
        const lPort = local_port ? parseInt(local_port, 10) : (rPort < 1024 ? rPort + 10000 : rPort);

        const mapping = {
          id: mappingId,
          machine_id,
          remote_port: rPort,
          local_port: lPort,
          protocol: payload.protocol || 'TCP',
          status: 'active',
          created_at: new Date().toISOString(),
          active_connections: 0,
          bytes_transferred: 0
        };

        db.bridgeMappings.set(mappingId, mapping);
        logAudit('bridge_mapping_created', 'user', machine_id, `Created port bridge: Local 127.0.0.1:${lPort} <---> Remote [${machine_id}]:${rPort}`);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(mapping));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  if (pathname.startsWith('/api/v1/bridge/mappings/') && pathname.endsWith('/revoke') && method === 'POST') {
    const parts = pathname.split('/');
    const mappingId = parts[4];
    const mapping = db.bridgeMappings.get(mappingId);
    if (mapping) {
      mapping.status = 'revoked';
      logAudit('bridge_mapping_revoked', 'user', mapping.machine_id, `Revoked port bridge ${mappingId}`);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, status: 'revoked' }));
    } else {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Mapping not found' }));
    }
    return;
  }

  // 5. MODE B: VIRTUAL PRIVATE NETWORK (VPN) API
  if (pathname === '/api/v1/vpn/network' && method === 'GET') {
    const peers = Array.from(db.machines.values()).map(m => ({
      machine_id: m.id,
      hostname: m.hostname,
      os: m.os,
      virtual_ip: vpnPool.allocated.get(m.id) || null,
      status: getMachineStatus(m),
      route: `${vpnPool.allocated.get(m.id) || 'N/A'}/32`,
      tun_supported: !!m.capabilities?.is_root
    }));

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      network_name: 'CyberVPS Space Virtual Mesh',
      cidr: '10.77.0.0/24',
      gateway_ip: '10.77.0.1',
      total_allocated_peers: vpnPool.allocated.size,
      peers
    }));
    return;
  }

  if (pathname === '/api/v1/vpn/peers/join' && method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const { machine_id } = JSON.parse(body);
        if (!machine_id || !db.machines.has(machine_id)) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Machine not found' }));
          return;
        }

        const virtualIp = vpnPool.allocate(machine_id);
        logAudit('vpn_peer_joined', 'system', machine_id, `Assigned Virtual IP ${virtualIp} to machine ${machine_id}`);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          machine_id,
          virtual_ip: virtualIp,
          network_cidr: '10.77.0.0/24',
          gateway: '10.77.0.1'
        }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // 6. PUBLIC TUNNELS API
  if (pathname === '/api/v1/tunnels' && method === 'GET') {
    const list = Array.from(db.tunnels.values());
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(list));
    return;
  }

  if (pathname === '/api/v1/tunnels' && method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const payload = JSON.parse(body);
        const { machine_id, target_port, access_mode = 'public' } = payload;
        
        const tunnelId = 'tun_' + crypto.randomUUID().slice(0, 8);
        const hostHeader = req.headers.host || `localhost:${PORT}`;
        const publicUrl = `http://${hostHeader}/tunnel/${tunnelId}/`;

        const tunnelConfig = {
          id: tunnelId,
          machine_id,
          target_port: parseInt(target_port, 10),
          public_subdomain: `${target_port}-${tunnelId}`,
          public_url: publicUrl,
          access_mode,
          status: 'active',
          created_at: new Date().toISOString(),
          request_count: 0,
          bytes_transferred: 0
        };

        db.tunnels.set(tunnelId, tunnelConfig);
        logAudit('tunnel_created', 'admin', machine_id, `Created public tunnel ${tunnelId} for localhost:${target_port}`);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(tunnelConfig));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  if (pathname.startsWith('/api/v1/tunnels/') && pathname.endsWith('/revoke') && method === 'POST') {
    const parts = pathname.split('/');
    const tId = parts[4];
    const tunnel = db.tunnels.get(tId);
    if (tunnel) {
      tunnel.status = 'revoked';
      logAudit('tunnel_revoked', 'admin', tunnel.machine_id, `Revoked tunnel ${tId}`);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, status: 'revoked' }));
    } else {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Tunnel not found' }));
    }
    return;
  }

  // 7. EMBEDDED DASHBOARD UI
  if (pathname === '/' || pathname === '/dashboard') {
    const indexPath = path.join(__dirname, '../index.html');
    if (fs.existsSync(indexPath)) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(fs.readFileSync(indexPath, 'utf8'));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(getUniversalBridgeDashboardHtml(req.headers.host || `localhost:${PORT}`));
    return;
  }

  // Default 404
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Endpoint not found' }));
});

// =============================================================================
// WEBSOCKET SERVERS: RELAY FOR AGENTS & STREAMING TERMINAL FOR BROWSER
// =============================================================================
const wssRelay = new WebSocketServer({ noServer: true });
const wssTerminal = new WebSocketServer({ noServer: true });

function verifyTerminalAuthorization(request, parsedUrl) {
  const machineId = parsedUrl.searchParams.get('machine_id');
  if (!machineId || !db.machines.has(machineId)) {
    return { authorized: false, error: 'Machine not found in fleet', status: 404 };
  }

  // 1. Browser Origin verification: block untrusted cross-origin terminal hijack attempts (CSWSH)
  const origin = request.headers['origin'];
  if (origin) {
    try {
      const originUrl = new URL(origin);
      const hostHeader = (request.headers.host || '').toLowerCase();
      const originHost = originUrl.host.toLowerCase();
      const originHostname = originUrl.hostname.toLowerCase();

      // Explicit trusted origins: exact deployed dashboard, exact deployed backend, and local dev
      const explicitTrustedOrigins = new Set([
        'cyberdrivepro.github.io',
        'cybervps-space-station.up.railway.app',
        hostHeader,
        hostHeader.split(':')[0]
      ]);

      if (process.env.ALLOWED_ORIGINS) {
        process.env.ALLOWED_ORIGINS.split(',').forEach(o => explicitTrustedOrigins.add(o.trim().toLowerCase()));
      }

      const isExplicitMatch = explicitTrustedOrigins.has(originHost) || explicitTrustedOrigins.has(originHostname);
      const isLocalhost = (originHostname === 'localhost' || originHostname === '127.0.0.1');

      if (!isExplicitMatch && !isLocalhost) {
        return { authorized: false, error: 'Forbidden: Untrusted WebSocket Origin. Terminal access restricted to authorized Space Station dashboard.', status: 403 };
      }
    } catch (_) {
      return { authorized: false, error: 'Forbidden: Malformed Origin header', status: 403 };
    }
  } else {
    // Deliberate policy for requests without Origin:
    // Non-browser clients (native CLIs, test suites) do not transmit Origin headers.
    // However, if browser-specific headers are detected without an Origin, reject as suspicious.
    const hasSecFetch = Boolean(request.headers['sec-fetch-site'] || request.headers['sec-fetch-mode']);
    if (hasSecFetch && !origin) {
      return { authorized: false, error: 'Forbidden: Browser WebSocket upgrade missing Origin header', status: 403 };
    }
  }

  // 2. Extract credential from query params or headers
  let cred = parsedUrl.searchParams.get('token');
  if (!cred && request.headers) {
    cred = request.headers['x-terminal-token'];
    if (!cred && request.headers['authorization']) {
      const parts = request.headers['authorization'].split(' ');
      if (parts.length === 2 && parts[0].toLowerCase() === 'bearer') {
        cred = parts[1];
      }
    }
  }

  if (!cred) {
    return { authorized: false, error: 'Unauthorized: Missing terminal authentication token', status: 401 };
  }

  // Guard: Agent enrollment token MUST NOT be accepted as browser authorization
  const configuredMaster = process.env.ENROLLMENT_TOKEN || 'cvps_enroll_master_token';
  if (cred === configuredMaster || db.enrollmentTokens.has(cred)) {
    return { authorized: false, error: 'Unauthorized: Agent enrollment token cannot be used for terminal authorization', status: 401 };
  }

  // Guard: Direct pairing keys must NEVER be accepted directly in the WebSocket URL
  // Clients must exchange pairing credentials for short-lived, single-use tokens via POST /api/v1/terminal/token
  if (tunnelManager.pairingKey && (cred === tunnelManager.pairingKey || parsedUrl.searchParams.get('pairing_key') || parsedUrl.searchParams.get('pair'))) {
    return { authorized: false, error: 'Unauthorized: Direct pairing key is not accepted on terminal WebSocket stream. Mint a one-time token via POST /api/v1/terminal/token', status: 401 };
  }

  // 3. Validate single-use machine-scoped terminal token
  if (db.terminalAuthTokens.has(cred)) {
    const record = db.terminalAuthTokens.get(cred);
    db.terminalAuthTokens.delete(cred); // Single-use consumption
    if (Date.now() > record.expires_at) {
      return { authorized: false, error: 'Unauthorized: Terminal token expired', status: 401 };
    }
    if (record.machine_id !== machineId) {
      return { authorized: false, error: 'Forbidden: Terminal token not authorized for this machine', status: 403 };
    }
    const requestedProfile = parsedUrl.searchParams.get('profile') || 'privileged';
    if (record.profile && record.profile !== 'any' && record.profile !== requestedProfile) {
      return { authorized: false, error: `Forbidden: Terminal token is restricted to profile '${record.profile}', cannot execute '${requestedProfile}'`, status: 403 };
    }
    return { authorized: true, user: 'browser-authenticated', machineId, profile: record.profile };
  }

  return { authorized: false, error: 'Unauthorized: Invalid or expired terminal token', status: 401 };
}

server.on('upgrade', (request, socket, head) => {
  const parsedUrl = new URL(request.url, 'http://' + (request.headers.host || 'localhost'));
  const pathname = parsedUrl.pathname;

  if (pathname === '/api/v1/relay/connect') {
    wssRelay.handleUpgrade(request, socket, head, (ws) => {
      wssRelay.emit('connection', ws, request);
    });
  } else if (pathname === '/api/v1/terminal/stream') {
    const auth = verifyTerminalAuthorization(request, parsedUrl);
    if (!auth.authorized) {
      const statusCode = auth.status || 401;
      const statusText = statusCode === 404 ? 'Not Found' : (statusCode === 403 ? 'Forbidden' : 'Unauthorized');
      socket.write(`HTTP/1.1 ${statusCode} ${statusText}\r\nConnection: close\r\nContent-Type: application/json\r\n\r\n{"error":"${auth.error}"}\r\n`);
      socket.destroy();
      return;
    }

    wssTerminal.handleUpgrade(request, socket, head, (ws) => {
      ws._terminalAuth = auth;
      wssTerminal.emit('connection', ws, request);
    });
  } else if (pathname.startsWith('/tunnel/')) {
    handleTunnelWebSocketUpgrade(request, socket, head, pathname);
  } else {
    socket.destroy();
  }
});

wssRelay.on('connection', (ws, request) => {
  let machineId = null;

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());
      const res = handleAgentMessage(ws, msg);
      if (msg.type === 'Auth') {
        if (res && res.success && msg.payload && msg.payload.machine_id) {
          machineId = msg.payload.machine_id;
          db.connectedAgents.set(machineId, ws);
        } else {
          setTimeout(() => {
            try { ws.close(4001, 'Unauthorized'); } catch (_) {}
          }, 100);
        }
      }
    } catch (e) {
      console.error('Error handling agent message:', e);
    }
  });

  ws.on('close', () => {
    if (machineId && db.connectedAgents.get(machineId) === ws) {
      db.connectedAgents.delete(machineId);
      const m = db.machines.get(machineId);
      if (m) m.status = 'offline';
      logAudit('agent_disconnected', 'agent', machineId, `Node ${machineId} disconnected from relay`, 'warning');
      for (const [reqId, pending] of db.pendingRequests.entries()) {
        if (pending.machineId === machineId) {
          clearTimeout(pending.timer);
          db.pendingRequests.delete(reqId);
          pending.reject(new Error(`Host '${machineId}' disconnected during operation`));
        }
      }
    }
  });
});

wssTerminal.on('connection', (ws, request) => {
  const parsed = new URL(request.url, 'http://' + (request.headers.host || 'localhost'));
  const machineId = parsed.searchParams.get('machine_id');
  const auth = ws._terminalAuth || verifyTerminalAuthorization(request, parsed);

  if (!auth || !auth.authorized) {
    ws.send(JSON.stringify({ error: auth ? auth.error : 'Unauthorized' }));
    ws.close(4001, 'Unauthorized');
    return;
  }

  const sessionId = 'term_' + crypto.randomUUID().slice(0, 8);
  const shellPref = parsed.searchParams.get('shell') || null;
  let profilePref = parsed.searchParams.get('profile') || null;

  if (auth.profile && auth.profile !== 'default') {
    profilePref = auth.profile;
  }

  const cols = parseInt(parsed.searchParams.get('cols') || '80', 10);
  const rows = parseInt(parsed.searchParams.get('rows') || '24', 10);

  if (!machineId || !db.machines.has(machineId)) {
    ws.send(JSON.stringify({ error: 'Machine not found' }));
    ws.close();
    return;
  }

  db.terminalSessions.set(sessionId, { machine_id: machineId, wsBrowser: ws, auth });
  logAudit('terminal_opened', auth.user || 'user', machineId, `Terminal session ${sessionId} opened (profile: ${profilePref || 'default'})`);

  sendServerCommand(machineId, {
    type: 'TerminalStart',
    payload: {
      session_id: sessionId,
      cols,
      rows,
      shell: shellPref,
      shell_preference: shellPref,
      profile: profilePref
    }
  });

  ws.on('message', (data) => {
    try {
      const str = data.toString();
      let inputData = null;
      try {
        const msg = JSON.parse(str);
        if (msg && (msg.type === 'input' || (!msg.type && typeof msg.data === 'string'))) {
          inputData = msg.data;
        } else if (msg && msg.type === 'resize') {
          sendServerCommand(machineId, {
            type: 'TerminalResize',
            payload: { session_id: sessionId, cols: msg.cols || 80, rows: msg.rows || 24 }
          });
          return;
        } else if (typeof msg === 'string') {
          inputData = msg;
        }
      } catch (_) {
        inputData = str;
      }

      if (inputData !== null && inputData !== undefined) {
        sendServerCommand(machineId, {
          type: 'TerminalInput',
          payload: { session_id: sessionId, data: inputData }
        });
      }
    } catch (e) {}
  });

  ws.on('close', () => {
    sendServerCommand(machineId, {
      type: 'TerminalKill',
      payload: { session_id: sessionId }
    });
    db.terminalSessions.delete(sessionId);
  });
});

function handleAgentMessage(ws, msg) {
  if (!msg || typeof msg !== 'object') {
    return { success: false, error: 'Malformed message' };
  }
  const { type, payload } = msg;
  if (!type || !payload) {
    return { success: false, error: 'Missing type or payload' };
  }

  const configuredMaster = process.env.ENROLLMENT_TOKEN || 'cvps_enroll_master_token';

  if (type === 'Auth') {
    const { machine_id, token, agent_version, hostname, os, arch, capabilities, username } = payload;
    if (!machine_id) {
      if (ws) ws.send(JSON.stringify({ type: 'AuthAck', payload: { success: false, error: 'Missing machine_id' } }));
      return { success: false, error: 'Missing machine_id' };
    }

    if (!db.enrollmentTokens.has(token) && token !== configuredMaster) {
      if (ws) ws.send(JSON.stringify({ type: 'AuthAck', payload: { success: false, error: 'Invalid token' } }));
      return { success: false, error: 'Invalid enrollment token' };
    }

    // Auto-allocate Virtual IP for Mode B
    const virtualIp = vpnPool.allocate(machine_id);
    const detectedUsername = username || capabilities?.username || capabilities?.user || payload.profile?.username || (capabilities?.is_root ? 'root' : (os === 'Windows' ? 'expert' : 'user'));

    const machineInfo = {
      id: machine_id,
      hostname: hostname || machine_id,
      friendly_name: hostname || machine_id,
      username: detectedUsername,
      os: os || 'Linux',
      os_version: payload.profile?.os_full || payload.os_version || 'standard',
      arch: arch || 'x86_64',
      agent_version: agent_version || '1.0.0',
      status: 'online',
      virtual_ip: virtualIp,
      created_at: new Date().toISOString(),
      last_seen: new Date().toISOString(),
      uptime_seconds: 0,
      cpu_usage: 0.0,
      memory_used_bytes: 0,
      memory_total_bytes: 1024 * 1024 * 1024,
      disk_used_bytes: 0,
      disk_total_bytes: 10 * 1024 * 1024 * 1024,
      capabilities: capabilities || {},
      profile: payload.profile || {},
      tags: ['universal-bridge', (os || 'linux').toLowerCase()]
    };

    db.machines.set(machine_id, machineInfo);
    logAudit('agent_enrolled', 'agent', machine_id, `Connected [${machineInfo.hostname}] (${machineInfo.os_version}) -> Assigned Virtual IP: ${virtualIp}`);
    broadcastTelemetry(machineInfo);

    if (ws) {
      ws.send(JSON.stringify({
        type: 'AuthAck',
        payload: { machine_id, success: true, virtual_ip: virtualIp, heartbeat_interval_secs: 2 }
      }));
    }
    return { success: true, result: { machine_id, virtual_ip: virtualIp, status: 'online' } };
  }

  else if (type === 'Heartbeat' || type === 'TelemetryHeartbeat') {
    const { machine_id, uptime_seconds, cpu_usage, memory_used_bytes, memory_total_bytes, disk_used_bytes, disk_total_bytes, telemetry } = payload;
    if (!machine_id) {
      return { success: false, error: 'Missing machine_id' };
    }
    if (!db.machines.has(machine_id)) {
      const virtualIp = vpnPool.allocate(machine_id);
      const detectedUsername = payload.username || telemetry?.username || telemetry?.profile?.username || (payload.os === 'Windows' ? 'expert' : 'root');
      const machineInfo = {
        id: machine_id,
        hostname: payload.hostname || telemetry?.hostname || machine_id,
        friendly_name: payload.hostname || telemetry?.hostname || machine_id,
        username: detectedUsername,
        os: payload.os || telemetry?.os || (payload.platform && payload.platform.includes('win') ? 'Windows' : 'Linux'),
        os_version: telemetry?.profile?.os_full || payload.os_version || 'standard',
        arch: payload.arch || 'x86_64',
        agent_version: payload.agent_version || '1.0.0',
        status: 'online',
        virtual_ip: virtualIp,
        created_at: new Date().toISOString(),
        last_seen: new Date().toISOString(),
        uptime_seconds: uptime_seconds || 0,
        cpu_usage: cpu_usage || 0.0,
        memory_used_bytes: memory_used_bytes || 0,
        memory_total_bytes: memory_total_bytes || (1024 * 1024 * 1024),
        disk_used_bytes: disk_used_bytes || 0,
        disk_total_bytes: disk_total_bytes || (10 * 1024 * 1024 * 1024),
        capabilities: payload.capabilities || telemetry?.capabilities || {},
        profile: telemetry?.profile || payload.profile || {},
        tags: ['universal-bridge', ((payload.os || telemetry?.os || 'linux')).toLowerCase()]
      };
      db.machines.set(machine_id, machineInfo);
      logAudit('agent_auto_enrolled', 'agent', machine_id, `Auto-enrolled from Heartbeat [${machineInfo.hostname}] -> Virtual IP: ${virtualIp}`);
      broadcastTelemetry(machineInfo);
    }
    const m = db.machines.get(machine_id);
    m.last_seen = new Date().toISOString();
    if (uptime_seconds !== undefined) m.uptime_seconds = uptime_seconds;
    if (cpu_usage !== undefined) m.cpu_usage = cpu_usage;
    if (memory_used_bytes !== undefined) m.memory_used_bytes = memory_used_bytes;
    if (memory_total_bytes !== undefined) m.memory_total_bytes = memory_total_bytes;
    if (disk_used_bytes !== undefined) m.disk_used_bytes = disk_used_bytes;
    if (disk_total_bytes !== undefined) m.disk_total_bytes = disk_total_bytes;
    if (payload.username && (!m.username || m.username === 'root' || m.username === 'expert' || m.username === 'user')) {
      m.username = payload.username;
    }
    if (payload.hostname && (!m.hostname || m.hostname === machine_id)) {
      m.hostname = payload.hostname;
      if (!m.friendly_name || m.friendly_name === machine_id) {
        m.friendly_name = payload.hostname;
      }
    }

    if (telemetry) {
      m.telemetry = { ...(m.telemetry || {}), ...telemetry };
    } else {
      const memTotalMb = memory_total_bytes ? Math.round(memory_total_bytes / (1024 * 1024)) : 0;
      const memUsedMb = memory_used_bytes ? Math.round(memory_used_bytes / (1024 * 1024)) : 0;
      const diskTotalGb = disk_total_bytes ? Math.round(disk_total_bytes / (1024 * 1024 * 1024)) : 0;
      const diskUsedGb = disk_used_bytes ? Math.round(disk_used_bytes / (1024 * 1024 * 1024)) : 0;
      m.telemetry = {
        cpu_percent: cpu_usage || 0,
        memory_used_mb: memUsedMb,
        memory_total_mb: memTotalMb,
        memory_percent: memTotalMb > 0 ? Math.round((memUsedMb / memTotalMb) * 100) : 0,
        disk_used_gb: diskUsedGb,
        disk_total_gb: diskTotalGb,
        disk_percent: diskTotalGb > 0 ? Math.round((diskUsedGb / diskTotalGb) * 100) : 0,
        uptime_seconds: uptime_seconds || 0
      };
    }
    m.status = 'online';
    broadcastTelemetry(m);
    return { success: true };
  }

  else if (type === 'DiscoveryReport') {
    const { machine_id, ports, profile } = payload;
    if (!machine_id) {
      return { success: false, error: 'Missing machine_id' };
    }
    if (!db.machines.has(machine_id)) {
      const virtualIp = vpnPool.allocate(machine_id);
      const machineInfo = {
        id: machine_id,
        hostname: profile?.hostname || machine_id,
        friendly_name: profile?.hostname || machine_id,
        username: profile?.username || 'root',
        os: profile?.os || 'Linux',
        os_version: profile?.os_full || 'standard',
        arch: profile?.arch || 'x86_64',
        agent_version: '1.0.0',
        status: 'online',
        virtual_ip: virtualIp,
        created_at: new Date().toISOString(),
        last_seen: new Date().toISOString(),
        capabilities: {},
        profile: profile || {},
        tags: ['universal-bridge', (profile?.os || 'linux').toLowerCase()]
      };
      db.machines.set(machine_id, machineInfo);
      broadcastTelemetry(machineInfo);
    }
    db.ports.set(machine_id, ports || []);
    const m = db.machines.get(machine_id);
    m.last_seen = new Date().toISOString();
    if (profile) {
      m.profile = { ...(m.profile || {}), ...profile };
      if (profile.os_full) m.os_version = profile.os_full;
      if (profile.username && (!m.username || m.username === 'root' || m.username === 'expert' || m.username === 'user')) {
        m.username = profile.username;
      }
      if (profile.hostname && (!m.hostname || m.hostname === machine_id)) {
        m.hostname = profile.hostname;
        if (!m.friendly_name || m.friendly_name === machine_id) {
          m.friendly_name = profile.hostname;
        }
      }
    }
    logAudit('ports_discovered', 'agent', machine_id, `Reported ${(ports || []).length} active ports & system profile`);
    broadcastTelemetry(m);
    return { success: true };
  }

  else if (type === 'AgentRpcResponse') {
    const { request_id, success, result, data, error } = payload;
    const finalResult = result !== undefined ? result : data;
    if (request_id && db.pendingRequests.has(request_id)) {
      const pending = db.pendingRequests.get(request_id);
      clearTimeout(pending.timer);
      db.pendingRequests.delete(request_id);
      if (success) {
        pending.resolve(finalResult);
      } else {
        pending.reject(new Error(error || 'Agent operation failed'));
      }
    }
    return { success: true };
  }

  else if (type === 'TerminalOutput') {
    const { session_id, data } = payload;
    const sess = db.terminalSessions.get(session_id);
    if (sess && sess.wsBrowser.readyState === WebSocket.OPEN) {
      sess.wsBrowser.send(JSON.stringify({ type: 'output', data }));
    }
    return { success: true };
  }

  else if (type === 'TerminalReady') {
    const sess = db.terminalSessions.get(payload.session_id);
    if (sess && sess.wsBrowser.readyState === WebSocket.OPEN) {
      sess.wsBrowser.send(JSON.stringify({ type: 'ready', ...payload }));
    }
    return { success: true };
  }

  else if (type === 'TerminalExit') {
    const sess = db.terminalSessions.get(payload.session_id);
    if (sess && sess.wsBrowser.readyState === WebSocket.OPEN) {
      sess.wsBrowser.send(JSON.stringify({ type: 'exit', ...payload }));
    }
    return { success: true };
  }

  else if (type === 'TunnelOpenStream') {
    const { destination_machine, stream_id } = payload;
    if (destination_machine) {
      const targetAgentWs = db.connectedAgents.get(destination_machine);
      if (targetAgentWs) {
        db.bridgeStreamSockets.set(stream_id, { clientWs: ws, agentWs: targetAgentWs });
        targetAgentWs.send(JSON.stringify(msg));
      }
    }
    return { success: true };
  }

  else if (type === 'TunnelStreamOpened') {
    const { stream_id, success, error } = payload;
    const stream = db.tunnelStreams.get(stream_id);
    if (stream && !success) {
      stream.res.writeHead(502, { 'Content-Type': 'text/html' });
      stream.res.end(`<h1>502 Bad Gateway</h1><p>Failed to connect to local port on remote machine: ${error}</p>`);
      db.tunnelStreams.delete(stream_id);
    }
    const bridgePair = db.bridgeStreamSockets.get(stream_id);
    if (bridgePair && ws === bridgePair.agentWs) {
      bridgePair.clientWs.send(JSON.stringify(msg));
    }
    return { success: true };
  }

  else if (type === 'TunnelData') {
    const { stream_id, data_base64 } = payload;
    const stream = db.tunnelStreams.get(stream_id);
    if (stream) {
      const chunk = Buffer.from(data_base64, 'base64');
      
      if (stream.isWsUpgrade) {
        if (stream.clientSocket && !stream.clientSocket.destroyed) {
          stream.clientSocket.write(chunk);
        }
      } else {
        if (!stream.headersParsed) {
          stream.buffer = Buffer.concat([stream.buffer || Buffer.alloc(0), chunk]);
          const headerEndIndex = stream.buffer.indexOf('\r\n\r\n');
          if (headerEndIndex !== -1) {
            const headerText = stream.buffer.slice(0, headerEndIndex).toString('utf-8');
            const bodyChunk = stream.buffer.slice(headerEndIndex + 4);
            stream.headersParsed = true;

            const lines = headerText.split('\r\n');
            const statusLine = lines[0];
            const statusCode = parseInt(statusLine.split(' ')[1] || '200', 10);
            
            const responseHeaders = {};
            for (let i = 1; i < lines.length; i++) {
              const [k, ...v] = lines[i].split(':');
              if (k) responseHeaders[k.trim().toLowerCase()] = v.join(':').trim();
            }

            delete responseHeaders['transfer-encoding'];
            stream.res.writeHead(statusCode, responseHeaders);
            if (bodyChunk.length > 0) stream.res.write(bodyChunk);
          }
        } else {
          stream.res.write(chunk);
        }
      }
    } else {
      const bridgePair = db.bridgeStreamSockets.get(stream_id);
      if (bridgePair) {
        if (ws === bridgePair.clientWs) {
          bridgePair.agentWs.send(JSON.stringify(msg));
        } else {
          bridgePair.clientWs.send(JSON.stringify(msg));
        }
      }
    }
    return { success: true };
  }

  else if (type === 'TunnelStreamClosed') {
    const { stream_id } = payload;
    const stream = db.tunnelStreams.get(stream_id);
    if (stream) {
      if (stream.isWsUpgrade) {
        if (stream.clientSocket && !stream.clientSocket.destroyed) stream.clientSocket.end();
      } else {
        stream.res.end();
      }
      db.tunnelStreams.delete(stream_id);
    }
    const bridgePair = db.bridgeStreamSockets.get(stream_id);
    if (bridgePair) {
      if (ws === bridgePair.agentWs) {
        bridgePair.clientWs.send(JSON.stringify(msg));
      } else {
        bridgePair.agentWs.send(JSON.stringify(msg));
      }
      db.bridgeStreamSockets.delete(stream_id);
    }
    return { success: true };
  }

  return { success: false, error: `Unhandled message type: ${type}` };
}

function sendServerCommand(machineId, cmd) {
  const agentWs = db.connectedAgents.get(machineId);
  if (agentWs && agentWs.readyState === WebSocket.OPEN) {
    agentWs.send(JSON.stringify(cmd));
  } else {
    if (!db.pendingCommands.has(machineId)) db.pendingCommands.set(machineId, []);
    db.pendingCommands.get(machineId).push(cmd);
  }
}

function handleTunnelProxyRequest(req, res, pathname, parsedUrl) {
  const parts = pathname.slice('/tunnel/'.length).split('/');
  const tunnelId = parts[0];
  const subPath = '/' + parts.slice(1).join('/');

  const tunnel = db.tunnels.get(tunnelId);
  if (!tunnel || tunnel.status !== 'active') {
    res.writeHead(404, { 'Content-Type': 'text/html' });
    res.end('<h1>404 Tunnel Not Found or Revoked</h1>');
    return;
  }

  tunnel.request_count++;
  const streamId = 'stream_' + crypto.randomUUID().slice(0, 8);
  const targetPort = tunnel.target_port;
  const forwardingPath = (subPath || '/') + (parsedUrl.search || '');
  
  let rawRequestHeaders = `${req.method} ${forwardingPath} HTTP/1.1\r\n`;
  rawRequestHeaders += `Host: 127.0.0.1:${targetPort}\r\n`;
  rawRequestHeaders += `X-Forwarded-For: ${req.socket.remoteAddress || '127.0.0.1'}\r\n`;
  rawRequestHeaders += `X-Forwarded-Proto: http\r\n`;

  for (const [k, v] of Object.entries(req.headers)) {
    if (!['host', 'connection'].includes(k.toLowerCase())) {
      rawRequestHeaders += `${k}: ${v}\r\n`;
    }
  }
  rawRequestHeaders += `Connection: close\r\n\r\n`;

  db.tunnelStreams.set(streamId, {
    res,
    req,
    headersParsed: false,
    buffer: Buffer.alloc(0),
    isWsUpgrade: false
  });

  sendServerCommand(tunnel.machine_id, {
    type: 'TunnelOpenStream',
    payload: { tunnel_id: tunnelId, stream_id: streamId, target_port: targetPort }
  });

  sendServerCommand(tunnel.machine_id, {
    type: 'TunnelData',
    payload: {
      tunnel_id: tunnelId,
      stream_id: streamId,
      data_base64: Buffer.from(rawRequestHeaders).toString('base64')
    }
  });

  req.on('data', chunk => {
    sendServerCommand(tunnel.machine_id, {
      type: 'TunnelData',
      payload: {
        tunnel_id: tunnelId,
        stream_id: streamId,
        data_base64: chunk.toString('base64')
      }
    });
  });

  req.on('error', () => {
    sendServerCommand(tunnel.machine_id, {
      type: 'TunnelCloseStream',
      payload: { tunnel_id: tunnelId, stream_id: streamId }
    });
    db.tunnelStreams.delete(streamId);
  });
}

function handleTunnelWebSocketUpgrade(request, socket, head, pathname) {
  const parts = pathname.slice('/tunnel/'.length).split('/');
  const tunnelId = parts[0];
  const tunnel = db.tunnels.get(tunnelId);

  if (!tunnel || tunnel.status !== 'active') {
    socket.destroy();
    return;
  }

  const streamId = 'ws_stream_' + crypto.randomUUID().slice(0, 8);
  const targetPort = tunnel.target_port;

  sendServerCommand(tunnel.machine_id, {
    type: 'TunnelOpenStream',
    payload: { tunnel_id: tunnelId, stream_id: streamId, target_port: targetPort }
  });

  db.tunnelStreams.set(streamId, { clientSocket: socket, isWsUpgrade: true });

  socket.on('data', (chunk) => {
    sendServerCommand(tunnel.machine_id, {
      type: 'TunnelData',
      payload: {
        tunnel_id: tunnelId,
        stream_id: streamId,
        data_base64: chunk.toString('base64')
      }
    });
  });

  socket.on('close', () => {
    sendServerCommand(tunnel.machine_id, {
      type: 'TunnelCloseStream',
      payload: { tunnel_id: tunnelId, stream_id: streamId }
    });
    db.tunnelStreams.delete(streamId);
  });
}

// =============================================================================
// UNIVERSAL NETWORK BRIDGE DASHBOARD UI
// =============================================================================
function getUniversalBridgeDashboardHtml(host) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>CyberVPS SPACE STATION - Universal Network Bridge</title>
  <style>
    :root {
      --bg: #070b14;
      --card-bg: #0f172a;
      --border: #1e293b;
      --accent: #00f0ff;
      --accent-glow: rgba(0, 240, 255, 0.25);
      --purple: #8b5cf6;
      --success: #10b981;
      --warning: #f59e0b;
      --danger: #ef4444;
      --text: #f8fafc;
      --text-muted: #94a3b8;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: var(--bg);
      color: var(--text);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
    }
    header {
      background: rgba(15, 23, 42, 0.85);
      backdrop-filter: blur(12px);
      border-bottom: 1px solid var(--border);
      padding: 1rem 2rem;
      display: flex;
      justify-content: space-between;
      align-items: center;
      position: sticky;
      top: 0;
      z-index: 50;
    }
    .logo {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      font-weight: 800;
      letter-spacing: 1px;
      font-size: 1.25rem;
      color: var(--accent);
    }
    .logo-badge {
      background: rgba(0, 240, 255, 0.1);
      border: 1px solid var(--accent);
      padding: 2px 8px;
      border-radius: 4px;
      font-size: 0.7rem;
    }
    .stats-bar {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 1rem;
      padding: 1.5rem 2rem 0.5rem;
    }
    .stat-card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 1rem 1.25rem;
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
    }
    .stat-card .label { font-size: 0.75rem; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.5px; }
    .stat-card .value { font-size: 1.8rem; font-weight: 700; color: var(--accent); }
    main {
      padding: 1.5rem 2rem;
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: 2rem;
    }
    .section-title {
      font-size: 1.15rem;
      font-weight: 700;
      margin-bottom: 1rem;
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }
    .card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 1.5rem;
    }
    table { width: 100%; border-collapse: collapse; text-align: left; }
    th { padding: 0.75rem 1rem; border-bottom: 1px solid var(--border); font-size: 0.75rem; color: var(--text-muted); text-transform: uppercase; }
    td { padding: 0.85rem 1rem; border-bottom: 1px solid rgba(30, 41, 59, 0.6); font-size: 0.9rem; }
    tr:hover { background: rgba(255, 255, 255, 0.02); }
    .badge {
      display: inline-block;
      padding: 3px 8px;
      border-radius: 9999px;
      font-size: 0.75rem;
      font-weight: 600;
    }
    .badge-online { background: rgba(16, 185, 129, 0.15); color: var(--success); border: 1px solid var(--success); }
    .badge-offline { background: rgba(239, 68, 68, 0.15); color: var(--danger); border: 1px solid var(--danger); }
    .badge-mesh { background: rgba(139, 92, 246, 0.15); color: var(--purple); border: 1px solid var(--purple); }
    .btn {
      background: var(--accent);
      color: #000;
      border: none;
      padding: 0.45rem 0.9rem;
      border-radius: 6px;
      font-weight: 600;
      font-size: 0.85rem;
      cursor: pointer;
      text-decoration: none;
      display: inline-flex;
      align-items: center;
      gap: 0.4rem;
      transition: all 0.2s;
    }
    .btn:hover { box-shadow: 0 0 12px var(--accent-glow); opacity: 0.95; }
    .btn-purple { background: var(--purple); color: #fff; }
    .btn-danger { background: var(--danger); color: #fff; }
    .btn-outline { background: transparent; border: 1px solid var(--border); color: var(--text); }
    .btn-outline:hover { border-color: var(--accent); color: var(--accent); }
    .copy-box {
      background: #0a0f1d;
      border: 1px dashed var(--accent);
      border-radius: 6px;
      padding: 0.75rem 1rem;
      font-family: monospace;
      color: var(--accent);
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-top: 0.5rem;
      font-size: 0.85rem;
    }
    .bridge-banner {
      background: linear-gradient(90deg, rgba(0,240,255,0.08) 0%, rgba(139,92,246,0.08) 100%);
      border: 1px solid rgba(0,240,255,0.2);
      border-radius: 8px;
      padding: 1rem 1.25rem;
      margin-bottom: 1.25rem;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
  </style>
</head>
<body>
  <header>
    <div class="logo">
      <span>🛰️ CYBERVPS SPACE STATION</span>
      <span class="logo-badge">UNIVERSAL NETWORK BRIDGE</span>
    </div>
    <div style="display:flex; gap:0.75rem;">
      <button class="btn btn-outline" onclick="fetchData()">🔄 Sync Fleet</button>
      <button class="btn btn-purple" onclick="showBridgeModal()">+ New Port Bridge</button>
    </div>
  </header>

  <div class="stats-bar">
    <div class="stat-card">
      <div class="label">Connected Fleet Nodes</div>
      <div class="value" id="stat-machines">0</div>
    </div>
    <div class="stat-card">
      <div class="label">Mode A: PC Port Bridges</div>
      <div class="value" id="stat-bridges">0</div>
    </div>
    <div class="stat-card">
      <div class="label">Mode B: Virtual Network Mesh</div>
      <div class="value" style="font-size:1.4rem; color:var(--purple);" id="stat-vpn">10.77.0.0/24</div>
    </div>
    <div class="stat-card">
      <div class="label">All-Port Discovery Engine</div>
      <div class="value" id="stat-ports">0 Active Ports</div>
    </div>
  </div>

  <main>
    <!-- MODE A: UNIVERSAL TCP PORT BRIDGE -->
    <div class="card">
      <div class="section-title">🌉 MODE A: Universal TCP Port Bridge (Remote Port ➡️ Windows PC 127.0.0.1)</div>
      <div class="bridge-banner">
        <div>
          <strong>Map ANY remote port (1–65535) directly to your Windows PC!</strong>
          <div style="font-size:0.85rem; color:var(--text-muted); margin-top:2px;">
            Open <code style="color:var(--accent);">http://127.0.0.1:&lt;local_port&gt;</code> on your PC to access the remote VPS service directly with conflict-safe auto-binding.
          </div>
        </div>
        <button class="btn" onclick="showBridgeModal()">⚡ Create Port Bridge</button>
      </div>

      <table>
        <thead>
          <tr>
            <th>Bridge ID</th>
            <th>Target Machine</th>
            <th>Remote Service</th>
            <th>Local PC Mapping</th>
            <th>Protocol</th>
            <th>Status</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody id="bridge-table-body">
          <tr><td colspan="7" style="text-align:center; color:var(--text-muted);">No active port bridges. Map a port below!</td></tr>
        </tbody>
      </table>
    </div>

    <!-- MODE B: VIRTUAL PRIVATE NETWORK -->
    <div class="card">
      <div class="section-title">🪐 MODE B: Virtual Private Network (10.77.0.0/24 Mesh Network)</div>
      <p style="color:var(--text-muted); font-size:0.9rem; margin-bottom:1rem;">
        Private virtual mesh network connecting your Windows PC and remote machines. Each enrolled node receives a dedicated Virtual IP.
      </p>

      <table>
        <thead>
          <tr>
            <th>Virtual IP</th>
            <th>Machine ID / Hostname</th>
            <th>Platform</th>
            <th>Route / Subnet</th>
            <th>Mesh Status</th>
            <th>TUN Adapter Privileges</th>
          </tr>
        </thead>
        <tbody id="vpn-table-body">
          <tr><td colspan="6" style="text-align:center; color:var(--text-muted);">Loading Virtual Mesh...</td></tr>
        </tbody>
      </table>
    </div>

    <!-- ALL-PORT DISCOVERY INVENTORY -->
    <div class="card">
      <div class="section-title">🔍 Live All-Port Inventory (Any Port 1–65535 Discovered on Remote Machines)</div>
      <table>
        <thead>
          <tr>
            <th>Machine</th>
            <th>Port</th>
            <th>Protocol</th>
            <th>Bind Address</th>
            <th>Process / Service</th>
            <th>HTTP Title / Status</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody id="ports-table-body">
          <tr><td colspan="7" style="text-align:center; color:var(--text-muted);">Scanning for listening ports...</td></tr>
        </tbody>
      </table>
    </div>

    <!-- FLEET OVERVIEW -->
    <div class="card">
      <div class="section-title">🖥️ Connected Machines Fleet</div>
      <table>
        <thead>
          <tr>
            <th>Status</th>
            <th>Machine ID / Hostname</th>
            <th>Platform</th>
            <th>Virtual IP</th>
            <th>CPU / RAM</th>
            <th>Discovered Ports</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody id="machines-table-body">
          <tr><td colspan="7" style="text-align:center; color:var(--text-muted);">Scanning connected fleet...</td></tr>
        </tbody>
      </table>
    </div>

    <!-- ONBOARDING -->
    <div class="card">
      <div class="section-title">🚀 Connect Any Machine to the Universal Bridge</div>
      <div style="font-weight:600; font-size:0.85rem; margin-top:0.5rem;">🐧 Linux (Ubuntu, Debian, Root & Non-Root):</div>
      <div class="copy-box">
        <code id="cmd-linux">curl -sSL http://${host}/install.sh | bash</code>
        <button class="btn btn-outline" onclick="copyText('cmd-linux')">Copy</button>
      </div>

      <div style="font-weight:600; font-size:0.85rem; margin-top:0.75rem;">🪟 Windows PowerShell (Client & Remote Server):</div>
      <div class="copy-box">
        <code id="cmd-win">irm http://${host}/install.ps1 | iex</code>
        <button class="btn btn-outline" onclick="copyText('cmd-win')">Copy</button>
      </div>

      <div style="font-weight:600; font-size:0.85rem; margin-top:0.75rem;">🩺 System Doctor & Curl Timeout Checker:</div>
      <div class="copy-box">
        <code id="cmd-doc">curl -sSL http://${host}/doctor.sh | bash</code>
        <button class="btn btn-outline" onclick="copyText('cmd-doc')">Copy</button>
      </div>
    </div>
  </main>

  <script>
    let currentMachines = [];

    async function fetchData() {
      try {
        const [mRes, bRes, vRes] = await Promise.all([
          fetch('/api/v1/machines'),
          fetch('/api/v1/bridge/mappings'),
          fetch('/api/v1/vpn/network')
        ]);
        const machines = await mRes.json();
        const bridges = await bRes.json();
        const vpn = await vRes.json();
        currentMachines = machines;

        document.getElementById('stat-machines').innerText = machines.filter(m => m.status === 'online').length;
        document.getElementById('stat-bridges').innerText = bridges.filter(b => b.status === 'active').length;

        renderMachines(machines);
        renderBridges(bridges);
        renderVpn(vpn);
        fetchAllPorts(machines);
      } catch (e) {
        console.error('Fetch error:', e);
      }
    }

    function renderBridges(bridges) {
      const tbody = document.getElementById('bridge-table-body');
      if (bridges.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; color:var(--text-muted);">No active port bridges. Click below to map any remote port to your PC!</td></tr>';
        return;
      }

      tbody.innerHTML = bridges.map(b => \`
        <tr>
          <td><code>\${b.id}</code></td>
          <td><strong>\${b.machine_id}</strong></td>
          <td><strong style="color:var(--accent);">:\${b.remote_port}</strong></td>
          <td>
            <a href="http://127.0.0.1:\${b.local_port}" target="_blank" style="color:var(--accent); font-weight:700; text-decoration:none;">
              🔗 127.0.0.1:\${b.local_port}
            </a>
          </td>
          <td><span class="badge" style="background:#1e293b; color:#38bdf8;">\${b.protocol}</span></td>
          <td><span class="badge badge-online">\${b.status.toUpperCase()}</span></td>
          <td>
            <button class="btn btn-danger" style="padding:2px 8px; font-size:0.75rem;" onclick="revokeBridge('\${b.id}')">Disconnect</button>
          </td>
        </tr>
      \`).join('');
    }

    function renderVpn(vpn) {
      const tbody = document.getElementById('vpn-table-body');
      if (!vpn.peers || vpn.peers.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; color:var(--text-muted);">No peers in Virtual Network.</td></tr>';
        return;
      }

      tbody.innerHTML = vpn.peers.map(p => \`
        <tr>
          <td><strong style="color:var(--purple); font-family:monospace; font-size:1rem;">\${p.virtual_ip}</strong></td>
          <td><strong>\${p.hostname}</strong><br><small style="color:var(--text-muted);">\${p.machine_id}</small></td>
          <td>\${p.os}</td>
          <td><code>\${p.route}</code></td>
          <td><span class="badge badge-mesh">\${p.status.toUpperCase()}</span></td>
          <td>\${p.tun_supported ? '<span style="color:var(--success);">✅ Root / Admin Available</span>' : '<span style="color:var(--warning);">⚠️ User Mode (Port Bridge Active)</span>'}</td>
        </tr>
      \`).join('');
    }

    function renderMachines(machines) {
      const tbody = document.getElementById('machines-table-body');
      if (machines.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; color:var(--text-muted);">No machines enrolled yet. Use the command below to connect one!</td></tr>';
        return;
      }

      tbody.innerHTML = machines.map(m => \`
        <tr>
          <td><span class="badge badge-\${m.status}">\${m.status.toUpperCase()}</span></td>
          <td><strong>\${m.hostname}</strong><br><small style="color:var(--text-muted);">\${m.id}</small></td>
          <td>\${m.os} (\${m.arch})</td>
          <td><strong style="color:var(--purple);">\${m.virtual_ip || 'Assigning...'}</strong></td>
          <td>CPU: \${m.cpu_usage || 0}%<br><small style="color:var(--text-muted);">RAM: \${Math.round((m.memory_used_bytes||0)/(1024*1024))} MB</small></td>
          <td><span class="badge" style="background:#1e293b; color:#38bdf8;" id="port-count-\${m.id}">...</span></td>
          <td>
            <button class="btn btn-outline" style="padding:2px 8px; font-size:0.75rem;" onclick="promptBridge('\${m.id}', 6767)">Bridge Port</button>
          </td>
        </tr>
      \`).join('');
    }

    async function fetchAllPorts(machines) {
      const portsTbody = document.getElementById('ports-table-body');
      let totalPorts = 0;
      let allPortsRows = [];

      for (const m of machines) {
        try {
          const res = await fetch(\`/api/v1/machines/\${m.id}/ports\`);
          const ports = await res.json();
          totalPorts += ports.length;

          const badgeEl = document.getElementById(\`port-count-\${m.id}\`);
          if (badgeEl) badgeEl.innerText = \`\${ports.length} ports\`;

          for (const p of ports) {
            allPortsRows.push(\`
              <tr>
                <td><strong>\${m.hostname}</strong></td>
                <td><strong style="color:var(--accent);">:\${p.port}</strong></td>
                <td>\${p.protocol}</td>
                <td>\${p.bind_address}</td>
                <td>\${p.process_name || 'System Service'}</td>
                <td>\${p.is_http ? \`✅ HTTP \${p.http_status || ''} (\${p.http_title || 'Web Service'})\` : 'Listening Endpoint'}</td>
                <td>
                  <button class="btn" style="padding:3px 8px; font-size:0.75rem;" onclick="bridgePort('\${m.id}', \${p.port})">⚡ Bridge to My PC</button>
                </td>
              </tr>
            \`);
          }
        } catch (e) {}
      }

      document.getElementById('stat-ports').innerText = \`\${totalPorts} Discovered Ports\`;
      if (allPortsRows.length > 0) {
        portsTbody.innerHTML = allPortsRows.join('');
      }
    }

    async function bridgePort(machineId, port) {
      try {
        const res = await fetch('/api/v1/bridge/mappings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ machine_id: machineId, remote_port: port })
        });
        const created = await res.json();
        alert(\`🎉 Universal Port Bridge Created!\\nRemote [:\${port}] is now mapped to your PC at 127.0.0.1:\${created.local_port}\`);
        fetchData();
      } catch (e) {
        alert('Bridge Error: ' + e.message);
      }
    }

    async function revokeBridge(mappingId) {
      if (!confirm('Revoke this port bridge mapping?')) return;
      await fetch(\`/api/v1/bridge/mappings/\${mappingId}/revoke\`, { method: 'POST' });
      fetchData();
    }

    function showBridgeModal() {
      if (currentMachines.length === 0) {
        alert('Please connect a remote machine first!');
        return;
      }
      const mId = currentMachines[0].id;
      const port = prompt('Enter remote port number to bridge to your PC (e.g. 6767, 3000, 8080, 22):', '6767');
      if (port) bridgePort(mId, parseInt(port, 10));
    }

    function promptBridge(mId, defaultPort) {
      const port = prompt('Enter remote port number to bridge to your PC:', defaultPort);
      if (port) bridgePort(mId, parseInt(port, 10));
    }

    function copyText(id) {
      const txt = document.getElementById(id).innerText;
      navigator.clipboard.writeText(txt);
      alert('Copied to clipboard!');
    }

    fetchData();
    setInterval(fetchData, 4000);
  </script>
</body>
</html>`;
}

server.listen(PORT, '0.0.0.0', async () => {
  console.log(`================================================================`);
  console.log(`🛰️  CYBERVPS SPACE STATION UNIVERSAL CONTROL PLANE READY`);
  console.log(`================================================================`);
  console.log(`🏠 Local Control Plane:  http://localhost:${PORT}`);

  let tunnelInfo = { provider: 'localhost', public_url: `http://localhost:${PORT}` };
  try {
    tunnelInfo = await tunnelManager.start(PORT);
  } catch (err) {
    console.warn(`[!] Remote tunnel check notice: ${err.message}`);
  }

  const publicUrl = tunnelInfo.public_url || `http://localhost:${PORT}`;
  const pairingKey = tunnelManager.pairingKey;
  const isRemote = tunnelInfo.provider !== 'localhost';

  if (isRemote) {
    console.log(`🌐 Remote Public URL:     ${publicUrl} (${tunnelInfo.provider})`);
    console.log(`🔑 Secure Pairing Key:    ${pairingKey}`);
    console.log(``);
    console.log(`👉 DIRECT ACCESS:`);
    console.log(`   ${publicUrl}/?pair=${pairingKey}`);
    console.log(``);
    console.log(`👉 CONNECT GITHUB PAGES DASHBOARD:`);
    console.log(`   https://cyberdrivepro.github.io/cybervps-space-station/?backend=${encodeURIComponent(publicUrl)}&pair=${pairingKey}`);
    console.log(``);
    console.log(`👉 CONNECT ANY REMOTE AGENT (VPS / SSH / Ubuntu / Windows):`);
    console.log(`   curl -sSL https://raw.githubusercontent.com/cyberdrivepro/cybervps-space-station/main/scripts/install-agent.sh | bash -s -- --server ${publicUrl}`);
  } else {
    console.log(`ℹ️  Running in Local Mode: ${publicUrl}`);
    console.log(`👉 Local Dashboard:        http://localhost:${PORT}`);
    console.log(`👉 Connect GitHub Pages:   https://cyberdrivepro.github.io/cybervps-space-station/?backend=http://localhost:${PORT}`);
  }

  console.log(``);
  console.log(`🌉 Mode A (TCP Port Bridge API): ${publicUrl}/api/v1/bridge/mappings`);
  console.log(`🪐 Mode B (Virtual Network Mesh): ${publicUrl}/api/v1/vpn/network`);
  console.log(`================================================================`);
});

// Clean process termination
const cleanup = async () => {
  console.log('\n[!] Shutting down Space Station server...');
  await tunnelManager.stop();
  server.close(() => process.exit(0));
};
process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);

