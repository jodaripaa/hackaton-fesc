import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { loadConfig } from '../../src/config/index.ts';
import { createPostgresConnection } from '../../src/persistence/connection.ts';
import { runMigrations } from '../../src/persistence/migrations.ts';

const service = process.env['TEST_SERVICE_URL'];
test('integracion_health_y_readiness_del_servicio_en_funcionamiento', { skip: !service }, async () => {
  const health = await fetch(`${service}/health`, { signal: AbortSignal.timeout(3000) });
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { status: 'ok' });
  const ready = await fetch(`${service}/ready`, { signal: AbortSignal.timeout(3000) });
  assert.equal(ready.status, 200);
  assert.deepEqual(await ready.json(), { status: 'ready', database: 'up' });
});
test('integracion_postgres_migraciones_idempotentes_y_conexion_cerrada', { skip: process.env['TEST_DATABASE'] !== 'true' }, async () => {
  const config = loadConfig(process.env, { cajasPath: fileURLToPath(new URL('../../config/cajas.yaml', import.meta.url)) });
  const connection = createPostgresConnection(config.database);
  try {
    assert.equal(await connection.ping(), true);
    await runMigrations(connection.pool);
    assert.deepEqual(await runMigrations(connection.pool), []);
    const result = await connection.pool.query<{ name: string }>('SELECT name FROM public.caja_link_migrations');
    assert.ok(result.rows.some(row => row.name === '001_base.sql'));
    const schema = await connection.pool.query<{ exists: boolean }>("SELECT EXISTS (SELECT FROM information_schema.schemata WHERE schema_name = 'caja_link') AS exists");
    assert.equal(schema.rows[0]?.exists, true);
  } finally { await connection.close(); }
  assert.equal(await connection.ping(), false);
});
