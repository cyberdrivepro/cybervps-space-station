const { spawn, execSync } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');

// Kill any old pythonw agent processes
try {
  execSync('taskkill /F /IM pythonw.exe', { stdio: 'ignore' });
} catch (_) {}

const base = path.join(os.homedir(), '.cybervps');
const cfg = path.join(base, 'config.json');
const logs = path.join(base, 'logs');
const script = path.join(base, 'universal-agent.py');
const runDir = path.join(base, 'run');

if (!fs.existsSync(logs)) fs.mkdirSync(logs, { recursive: true });
if (!fs.existsSync(runDir)) fs.mkdirSync(runDir, { recursive: true });

let pyw = 'pythonw.exe';
try {
  const p = execSync('where pythonw.exe').toString().trim().split('\r\n')[0].trim();
  if (p && fs.existsSync(p)) pyw = p;
} catch (_) {}

const child = spawn(pyw, ['-u', script, '--config', cfg, '--log-dir', logs, '--ghost'], {
  detached: true,
  stdio: 'ignore',
  windowsHide: true
});
child.unref();

fs.writeFileSync(path.join(runDir, 'agent.pid'), String(child.pid), 'utf8');
console.log('Successfully launched CyberVPS background agent with PID:', child.pid);
