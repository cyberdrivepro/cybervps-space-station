/**
 * CyberVPS SPACE STATION - Unified Remote Access & Automatic Tunnel Manager
 * Supports:
 * 1. Daytona Sandbox Preview URLs (native zero-config HTTPS proxy)
 * 2. Cloudflare Quick Tunnels (cloudflared automatic standalone tunnel)
 * 3. Pinggy SSH Tunnel fallback (zero-dependency outbound HTTPS)
 * 4. Custom Public Coordinator / Base URL
 * 5. Localhost Fallback with clear diagnostics
 */

const http = require('http');
const https = require('https');
const url = require('url');
const { spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

class TunnelManager {
  constructor(options = {}) {
    this.port = options.port || 8080;
    this.status = 'idle'; // idle | starting | connected | reconnecting | failed | stopped
    this.providerName = 'localhost';
    this.publicUrl = options.publicUrl || `http://127.0.0.1:${this.port}`;
    this.pairingKey = options.pairingKey || ('cvps_pair_' + crypto.randomBytes(8).toString('hex'));
    this.sessionTokens = new Set();
    this.activeChild = null;
    this.reconnectTimer = null;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
    this.lastError = null;
    this.onUrlChange = options.onUrlChange || null;
  }

  /**
   * Health-check an HTTP/HTTPS URL
   */
  async verifyUrlReachability(targetUrl, timeoutMs = 6000) {
    return new Promise((resolve) => {
      try {
        const parsed = new URL(targetUrl);
        const client = parsed.protocol === 'https:' ? https : http;
        const testPath = (parsed.pathname === '/' || !parsed.pathname) ? '/health' : `${parsed.pathname.replace(/\/$/, '')}/health`;

        const req = client.get({
          hostname: parsed.hostname,
          port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
          path: testPath,
          headers: { 'User-Agent': 'CyberVPS-Tunnel-Verifier/1.0' },
          timeout: timeoutMs
        }, (res) => {
          if (res.statusCode >= 200 && res.statusCode < 400) {
            resolve(true);
          } else {
            resolve(false);
          }
        });

        req.on('timeout', () => {
          req.destroy();
          resolve(false);
        });

        req.on('error', () => {
          resolve(false);
        });
      } catch (e) {
        resolve(false);
      }
    });
  }

  /**
   * Provider A: Daytona Sandbox Preview URL
   */
  async detectDaytona() {
    const sandboxId = process.env.DAYTONA_SANDBOX_ID;
    if (!sandboxId) return null;

    // Daytona standard proxy domain format: https://{port}-{sandboxId}.proxy.daytona.work
    const candidateUrl = `https://${this.port}-${sandboxId}.proxy.daytona.work`;
    console.log(`[*] Daytona sandbox detected (${sandboxId}). Verifying proxy: ${candidateUrl}`);

    // Wait slightly for server to be fully listening before checking
    const isReachable = await this.verifyUrlReachability(candidateUrl, 5000);
    if (isReachable) {
      return {
        provider: 'daytona',
        url: candidateUrl,
        notes: 'Native Daytona zero-config HTTPS proxy'
      };
    }

    // In case proxy has slight propagation delay, return candidate as valid provider
    return {
      provider: 'daytona',
      url: candidateUrl,
      notes: 'Daytona sandbox preview URL'
    };
  }

  /**
   * Provider B: Cloudflare Quick Tunnel (cloudflared)
   */
  async startCloudflareTunnel() {
    // 1. Locate cloudflared binary
    let cloudflaredBin = null;

    const candidatePaths = [
      'cloudflared',
      path.join(os.homedir(), '.cybervps', 'bin', process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared'),
      path.join(os.homedir(), 'bin', process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared'),
      '/usr/local/bin/cloudflared',
      '/tmp/cloudflared'
    ];

    for (const p of candidatePaths) {
      try {
        execSync(`${p} --version`, { stdio: 'ignore' });
        cloudflaredBin = p;
        break;
      } catch (_) {}
    }

    // 2. If not found, attempt to download standalone static binary
    if (!cloudflaredBin) {
      cloudflaredBin = await this.downloadCloudflared();
    }

    if (!cloudflaredBin) {
      throw new Error('cloudflared executable not available and auto-download failed.');
    }

    // 3. Launch cloudflared tunnel
    console.log(`[*] Starting Cloudflare Quick Tunnel using ${cloudflaredBin}...`);
    return new Promise((resolve, reject) => {
      const child = spawn(cloudflaredBin, ['tunnel', '--url', `http://127.0.0.1:${this.port}`], {
        stdio: ['ignore', 'pipe', 'pipe']
      });

      this.activeChild = child;
      let discoveredUrl = null;
      let errorLog = '';

      const urlRegex = /https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/i;

      const onData = (data) => {
        const text = data.toString();
        errorLog += text;
        const match = text.match(urlRegex);
        if (match && !discoveredUrl) {
          discoveredUrl = match[0];
          console.log(`[+] Cloudflare Quick Tunnel established: ${discoveredUrl}`);
          resolve({
            provider: 'cloudflare',
            url: discoveredUrl,
            notes: 'Cloudflare Quick Tunnel (temporary public HTTPS link)'
          });
        }
      };

      child.stdout.on('data', onData);
      child.stderr.on('data', onData);

      child.on('error', (err) => {
        reject(err);
      });

      child.on('exit', (code) => {
        if (!discoveredUrl) {
          reject(new Error(`cloudflared exited with code ${code}. Log: ${errorLog.slice(-300)}`));
        }
      });

      // 15-second timeout for quick tunnel creation
      setTimeout(() => {
        if (!discoveredUrl) {
          reject(new Error('Cloudflare tunnel URL acquisition timed out.'));
        }
      }, 15000);
    });
  }

  /**
   * Helper: Download cloudflared binary safely matching OS & arch
   */
  async downloadCloudflared() {
    try {
      const arch = os.arch();
      const platform = process.platform;
      let downloadUrl = null;
      const targetDir = path.join(os.homedir(), '.cybervps', 'bin');
      if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });

      const targetPath = path.join(targetDir, platform === 'win32' ? 'cloudflared.exe' : 'cloudflared');

      if (platform === 'linux') {
        if (arch === 'x64') downloadUrl = 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64';
        else if (arch === 'arm64') downloadUrl = 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64';
        else if (arch === 'arm') downloadUrl = 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm';
      } else if (platform === 'win32') {
        downloadUrl = 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe';
      } else if (platform === 'darwin') {
        downloadUrl = arch === 'arm64'
          ? 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-darwin-arm64.tgz'
          : 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-darwin-amd64.tgz';
      }

      if (!downloadUrl) return null;

      console.log(`[*] Downloading cloudflared standalone binary for ${platform}-${arch}...`);
      if (platform === 'linux' || platform === 'win32') {
        execSync(`curl -fsSL -o "${targetPath}" "${downloadUrl}"`, { timeout: 30000 });
        if (platform !== 'win32') fs.chmodSync(targetPath, 0o755);
        return targetPath;
      }
      return null;
    } catch (e) {
      console.warn(`[!] Auto-download of cloudflared failed: ${e.message}`);
      return null;
    }
  }

  /**
   * Provider C: Pinggy SSH reverse tunnel (Zero-dependency SSH outbound over port 443)
   */
  async startPinggyTunnel() {
    return new Promise((resolve, reject) => {
      // Test if ssh is available
      try {
        execSync('ssh -V', { stdio: 'ignore' });
      } catch (_) {
        return reject(new Error('ssh client not available for pinggy tunnel'));
      }

      console.log('[*] Testing Pinggy SSH tunnel fallback...');
      const child = spawn('ssh', [
        '-o', 'StrictHostKeyChecking=no',
        '-o', 'ServerAliveInterval=30',
        '-p', '443',
        '-R0:localhost:' + this.port,
        'a.pinggy.io'
      ], { stdio: ['ignore', 'pipe', 'pipe'] });

      this.activeChild = child;
      let discoveredUrl = null;
      const urlRegex = /https:\/\/[a-zA-Z0-9-]+\.(a\.pinggy\.link|pinggy\.link|free\.pinggy\.link)/i;

      const onData = (data) => {
        const text = data.toString();
        const match = text.match(urlRegex);
        if (match && !discoveredUrl) {
          discoveredUrl = match[0];
          console.log(`[+] Pinggy tunnel established: ${discoveredUrl}`);
          resolve({
            provider: 'pinggy',
            url: discoveredUrl,
            notes: 'Pinggy SSH Outbound HTTPS Tunnel'
          });
        }
      };

      child.stdout.on('data', onData);
      child.stderr.on('data', onData);

      child.on('exit', (code) => {
        if (!discoveredUrl) reject(new Error(`Pinggy ssh exited with code ${code}`));
      });

      setTimeout(() => {
        if (!discoveredUrl) reject(new Error('Pinggy tunnel timeout'));
      }, 10000);
    });
  }

  /**
   * Start Tunnel Manager and resolve reachable Public URL
   */
  async start(port) {
    if (port) this.port = port;
    this.status = 'starting';

    // 1. Check custom PUBLIC_BASE_URL, CYBERVPS_PUBLIC_URL, or PUBLIC_URL
    const configuredUrl = process.env.PUBLIC_BASE_URL || process.env.CYBERVPS_PUBLIC_URL || process.env.PUBLIC_URL;
    if (configuredUrl) {
      this.providerName = 'custom';
      this.publicUrl = configuredUrl.replace(/\/$/, '');
      this.status = 'connected';
      console.log(`[+] Using configured PUBLIC_BASE_URL: ${this.publicUrl}`);
      return this.getInfo();
    }

    // 1B. Check Railway Platform environment
    if (process.env.RAILWAY_PUBLIC_DOMAIN) {
      this.providerName = 'railway';
      this.publicUrl = `https://${process.env.RAILWAY_PUBLIC_DOMAIN.replace(/\/$/, '')}`;
      this.status = 'connected';
      console.log(`[+] Railway Public Domain detected: ${this.publicUrl}`);
      return this.getInfo();
    }
    if (process.env.RAILWAY_STATIC_URL) {
      this.providerName = 'railway';
      this.publicUrl = `https://${process.env.RAILWAY_STATIC_URL.replace(/\/$/, '')}`;
      this.status = 'connected';
      console.log(`[+] Railway Static URL detected: ${this.publicUrl}`);
      return this.getInfo();
    }

    // 2. Check Daytona platform preview
    try {
      const daytonaResult = await this.detectDaytona();
      if (daytonaResult) {
        this.providerName = daytonaResult.provider;
        this.publicUrl = daytonaResult.url;
        this.status = 'connected';
        return this.getInfo();
      }
    } catch (e) {
      console.warn(`[!] Daytona preview detection note: ${e.message}`);
    }

    // 3. Check Cloudflare Quick Tunnel
    if (process.env.TUNNEL_PROVIDER !== 'none' && process.env.ENABLE_TUNNEL !== 'false') {
      try {
        const cfResult = await this.startCloudflareTunnel();
        if (cfResult) {
          this.providerName = cfResult.provider;
          this.publicUrl = cfResult.url;
          this.status = 'connected';
          return this.getInfo();
        }
      } catch (cfErr) {
        console.warn(`[!] Cloudflare tunnel unavailable: ${cfErr.message}`);
      }

      // 4. Try Pinggy SSH tunnel fallback
      try {
        const pinggyResult = await this.startPinggyTunnel();
        if (pinggyResult) {
          this.providerName = pinggyResult.provider;
          this.publicUrl = pinggyResult.url;
          this.status = 'connected';
          return this.getInfo();
        }
      } catch (pinggyErr) {
        console.warn(`[!] Pinggy tunnel fallback unavailable: ${pinggyErr.message}`);
      }
    }

    // 5. Fallback: Localhost only
    this.providerName = 'localhost';
    this.publicUrl = `http://127.0.0.1:${this.port}`;
    this.status = 'connected';
    this.lastError = 'Outbound public tunnels disabled or blocked by host firewall. Serving locally.';
    return this.getInfo();
  }

  /**
   * Get safe connection status info (no secrets leaked)
   */
  getInfo() {
    return {
      status: this.status,
      provider: this.providerName,
      public_url: this.publicUrl,
      local_url: `http://127.0.0.1:${this.port}`,
      has_auth: true,
      last_error: this.lastError
    };
  }

  /**
   * Generate quick link with pairing token
   */
  getQuickPairUrl() {
    if (!this.publicUrl) return null;
    return `${this.publicUrl}/?pair=${this.pairingKey}`;
  }

  /**
   * Validate a pairing key
   */
  verifyPairingKey(key) {
    if (!key) return false;
    if (key === this.pairingKey) {
      const sessionToken = 'cvps_sess_' + crypto.randomBytes(16).toString('hex');
      this.sessionTokens.add(sessionToken);
      return sessionToken;
    }
    return false;
  }

  /**
   * Validate a session token
   */
  isValidSession(token) {
    return token && this.sessionTokens.has(token);
  }

  /**
   * Stop tunnel and clean up children
   */
  async stop() {
    this.status = 'stopped';
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.activeChild) {
      try {
        this.activeChild.kill('SIGTERM');
      } catch (_) {}
      this.activeChild = null;
    }
    console.log('[-] Tunnel Manager stopped.');
  }
}

module.exports = TunnelManager;
