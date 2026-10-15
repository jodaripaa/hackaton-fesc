import { createServer } from 'node:http';

// A wholly synthetic positive case; no access to any caja dataset.
const document = '999999999999';
let mode = 'ok';
const server = createServer((request, response) => {
  const send = (status, body) => {
    const json = JSON.stringify(body);
    response.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(json) });
    response.end(json);
  };
  if (request.headers.authorization !== `Bearer ${process.env.CAJA_SUR_TOKEN}`) return send(401, { error: 'unauthorized' });
  if (request.method === 'POST' && request.url === '/__chaos') {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', chunk => {
      if (response.writableEnded) return;
      body += chunk;
      if (body.length > 1024) { body = ''; send(413, { error: 'body_too_large' }); }
    });
    request.on('end', () => {
      if (response.writableEnded) return;
      try {
        const input = JSON.parse(body);
        if (!['ok', 'down', 'slow'].includes(input?.mode)) return send(400, { error: 'invalid_mode' });
        mode = input.mode;
        send(200, { mode });
      } catch { send(400, { error: 'invalid_json' }); }
    });
    return;
  }
  if (request.method === 'GET' && request.url === `/v2/people/${document}/memberships`) {
    if (mode === 'down') return send(503, { error: 'synthetic_unavailable' });
    if (mode === 'slow') {
      const timer = setTimeout(() => { if (!response.destroyed) send(503, { error: 'synthetic_timeout' }); }, 6000);
      response.once('close', () => clearTimeout(timer));
      return;
    }
    return send(200, { person: { id: document }, memberships: [{ start: '2026-01-01', end: null, category: 'SELF_EMPLOYED' }] });
  }
  send(404, { error: 'person_not_found' });
});
server.listen(9004, '0.0.0.0');
process.once('SIGTERM', () => server.close());
process.once('SIGINT', () => server.close());
