import assert from 'node:assert/strict';
import test from 'node:test';
import { buildApp } from '../../src/app.ts';
import { AppError } from '../../src/domain/errors.ts';
import { purposeQuerySchema } from '../../src/domain/schemas.ts';
import { testConfig } from '../helpers/config.ts';

test('base_health_es_liveness_y_ready_detecta_postgres_caido', async t => {
  let available = true;
  let closed = false;
  const app = buildApp({ config: testConfig(), logger: false, persistence: { ping: async () => available, close: async () => { closed = true; } } });
  t.after(async () => { await app.close(); assert.equal(closed, true); });
  assert.deepEqual((await app.inject('/health')).json(), { status: 'ok' });
  assert.deepEqual((await app.inject('/ready')).json(), { status: 'ready', database: 'up' });
  available = false;
  const failed = await app.inject('/ready');
  assert.equal(failed.statusCode, 503);
  assert.equal(failed.json().error, 'UNAVAILABLE');
  assert.equal((await app.inject('/health')).statusCode, 200);
});
test('base_no_simula_endpoints_de_negocio_pendientes', async t => {
  const app = buildApp({ config: testConfig(), logger: false, persistence: { ping: async () => true, close: async () => {} } });
  t.after(() => app.close());
  const response = await app.inject('/api/v1/affiliations/12345678?purpose=VALIDACION_AFILIACION');
  assert.equal(response.statusCode, 404);
  assert.equal(response.json().error, 'NOT_FOUND');
  assert.equal(response.headers['cache-control'], 'no-store');
  assert.ok(!response.body.includes('NO_AFILIADO'));
});
test('base_instala_plugins_y_mapea_validacion_a_400', async t => {
  const app = buildApp({
    config: testConfig(), logger: false, persistence: { ping: async () => true, close: async () => {} },
    modules: { affiliations: async instance => {
      instance.get('/probe', { schema: { querystring: purposeQuerySchema } }, async () => ({ accepted: true }));
      instance.get('/conflict', async () => { throw new AppError(409, 'CONFLICT'); });
      instance.get('/failure', async () => { throw new Error('sensitive upstream payload'); });
    } },
  });
  t.after(() => app.close());
  for (const url of ['/probe', '/probe?purpose=UNKNOWN', '/probe?purpose=VALIDACION_AFILIACION&extra=1']) {
    const response = await app.inject(url);
    assert.equal(response.statusCode, 400);
    assert.equal(response.json().error, 'INVALID_REQUEST');
  }
  assert.equal((await app.inject('/probe?purpose=VALIDACION_AFILIACION')).statusCode, 200);
  assert.equal((await app.inject('/conflict')).statusCode, 409);
  const failure = await app.inject('/failure');
  assert.equal(failure.statusCode, 500);
  assert.deepEqual(Object.keys(failure.json()).sort(), ['error', 'requestId']);
  assert.ok(!failure.body.includes('sensitive'));
});
test('base_logs_no_registran_documento_tokens_url_ni_payload', async t => {
  const config = { ...testConfig(), logLevel: 'info' as const };
  let logs = '';
  const token = config.auth.consumerTokens.NORTE;
  const document = '987654321012';
  const app = buildApp({
    config, logStream: { write(message) { logs += message; } },
    persistence: { ping: async () => true, close: async () => {} },
    modules: { audit: async instance => {
      instance.post('/probe/:document', async request => { throw new Error(JSON.stringify(request.body)); });
    } },
  });
  t.after(() => app.close());
  await app.inject({ method: 'POST', url: `/probe/${document}?token=${token}`, headers: { authorization: `Bearer ${token}` }, payload: { nombre: 'synthetic-sensitive-payload' } });
  assert.ok(logs.includes('request failed'));
  assert.ok(!logs.includes(document));
  assert.ok(!logs.includes(token));
  assert.ok(!logs.includes('synthetic-sensitive-payload'));
  assert.ok(!logs.includes('/probe/'));
});
