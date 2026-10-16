const https = require('https');
const http = require('http');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Machine-ID, X-Enrollment-Token, X-CVPS-Pairing-Key, X-Session-Token, X-Admin-Token, X-Pairing-Key, X-Simulate-Public');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  const targetBase = process.env.CONTROL_PLANE_URL || 'https://cybervps-space-station.up.railway.app';
  const targetUrl = new URL(req.url, targetBase);

  const client = targetUrl.protocol === 'https:' ? https : http;
  const proxyReq = client.request(targetUrl, {
    method: req.method,
    headers: {
      ...req.headers,
      host: targetUrl.host
    }
  }, (proxyRes) => {
    res.writeHead(proxyRes.statusCode, proxyRes.headers);
    proxyRes.pipe(res);
  });

  proxyReq.on('error', (err) => {
    res.status(502).json({ error: 'Gateway upstream error', detail: err.message });
  });

  if (req.body) {
    if (typeof req.body === 'string' || Buffer.isBuffer(req.body)) {
      proxyReq.write(req.body);
    } else {
      proxyReq.write(JSON.stringify(req.body));
    }
  } else {
    req.pipe(proxyReq);
  }
};
