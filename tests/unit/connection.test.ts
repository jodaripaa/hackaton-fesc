import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import test from 'node:test';
import { createPostgresConnection } from '../../src/persistence/connection.ts';
import { testConfig } from '../helpers/config.ts';

test('postgres_ping_falla_de_forma_acotada_y_pool_cierra_sin_motor', async () => {
  const server = createServer();
  await new Promise<void>(resolve => { server.listen(0, '127.0.0.1', resolve); });
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  // Own ephemeral port is released; no foreign listener or container is touched.
  await new Promise<void>((resolve, reject) => { server.close(error => error ? reject(error) : resolve()); });
  const connection = createPostgresConnection({ ...testConfig().database, port: address.port, connectionTimeoutMs: 200, queryTimeoutMs: 200 });
  const started = Date.now();
  try {
    assert.equal(await connection.ping(), false);
    assert.ok(Date.now() - started < 2000);
  } finally { await connection.close(); }
  assert.equal(await connection.ping(), false);
});
