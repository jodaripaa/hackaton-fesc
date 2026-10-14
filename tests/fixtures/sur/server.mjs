import { createServer } from 'node:http';

// A wholly synthetic positive case; no access to any caja dataset.
const document = '999999999999';
const server = createServer((request, response) => {
  const send = (status, body) => {
    const json = JSON.stringify(body);
    response.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(json) });
    response.end(json);
  };
  if (request.headers.authorization !== `Bearer ${process.env.CAJA_SUR_TOKEN}`) return send(401, { error: 'unauthorized' });
  if (request.method === 'GET' && request.url === `/v2/people/${document}/memberships`) {
    return send(200, { person: { id: document }, memberships: [{ start: '2026-01-01', end: null, category: 'SELF_EMPLOYED' }] });
  }
  send(404, { error: 'person_not_found' });
});
server.listen(9004, '0.0.0.0');
process.once('SIGTERM', () => server.close());
process.once('SIGINT', () => server.close());
