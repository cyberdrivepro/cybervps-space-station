module.exports = (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');
  res.status(200).json({
    status: 'OK',
    version: '2.1.0',
    platform: 'vercel-edge',
    service: 'CyberVPS Space Station Vercel Gateway',
    timestamp: new Date().toISOString()
  });
};
