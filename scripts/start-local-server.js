const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const baseDir = path.join(__dirname, '..');
const logsDir = path.join(baseDir, 'logs');
if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });

const logFile = path.join(logsDir, 'server.log');
const out = fs.openSync(logFile, 'a');
const err = fs.openSync(logFile, 'a');

const serverScript = path.join(baseDir, 'services/server.js');
const child = spawn(process.execPath, [serverScript], {
  detached: true,
  stdio: ['ignore', out, err],
  cwd: baseDir
});
child.unref();

console.log('Successfully launched CyberVPS control plane server with PID:', child.pid);
