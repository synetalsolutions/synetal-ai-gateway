const http = require('http');

const PORT = 8787;

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  
  if (req.method === 'OPTIONS') {
    res.writeHead(204); res.end(); return;
  }
  
  if (req.url === '/health' || req.url === '/') {
    res.writeHead(200, {'Content-Type': 'application/json'});
    res.end(JSON.stringify({status: 'ok', service: 'headroom-proxy'}));
    return;
  }
  
  // Default: passthrough (no compression for now - models handle context fine)
  if (req.url === '/v1/compress' && req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        const { messages } = JSON.parse(body);
        // Return messages as-is (pass-through mode)
        res.writeHead(200, {'Content-Type': 'application/json'});
        res.end(JSON.stringify({
          messages,
          compressed: false,
          tokens_before: JSON.stringify(messages).length,
          tokens_after: JSON.stringify(messages).length,
          tokens_saved: 0,
          compression_ratio: 1.0,
          transforms_applied: []
        }));
      } catch(e) {
        res.writeHead(400);
        res.end(JSON.stringify({error: e.message}));
      }
    });
    return;
  }
  
  res.writeHead(404);
  res.end('Not found');
});

server.listen(PORT, () => console.log('Headroom proxy on http://localhost:' + PORT));
