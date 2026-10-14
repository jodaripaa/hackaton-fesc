import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import { performance } from 'node:perf_hooks';
import test from 'node:test';
import { buildApp } from '../../src/app.ts';
import { createAffiliationService } from '../../src/application/affiliations.ts';
import type { AffiliationQuery, AffiliationResponseV2, AffiliationService } from '../../src/domain/types.ts';
import { createAffiliationRoutes } from '../../src/routes/affiliations.ts';
import { createSecurity } from '../../src/security/index.ts';
import { testConfig } from '../helpers/config.ts';

const sample: AffiliationResponseV2 = {
  requestId: 'synthetic', result: 'AFILIADO_OTRA_CAJA', unavailable: ['ORIENTE'],
  matches: [{ caja: 'NORTE', validFrom: '2026-01-01', validTo: null, source: 'ONLINE', asOf: '2026-10-14', affiliateType: 'DEPENDIENTE' }],
};
function routeApp(service: AffiliationService, clock = () => new Date('2026-10-15T04:59:59.999Z')) {
  const config = testConfig();
  const app = buildApp({ config, logger: false, persistence: { ping: async () => true, close: async () => {} }, modules: { affiliations: createAffiliationRoutes({ service, security: createSecurity(config.auth), clock }) } });
  return { app, config, headers: { authorization: `Bearer ${config.auth.consumerTokens.CENTRO}` } };
}

test('finalidad_obligatoria_e_invalida_devuelve_400_antes_de_consultar', async t => {
  let calls = 0;
  const { app, headers } = routeApp({ query: async () => { calls += 1; return sample; } });
  t.after(() => app.close());
  for (const version of ['v1', 'v2']) {
    for (const query of ['', '?purpose=INVALID', '?purpose=', '?purpose=VALIDACION_AFILIACION&extra=1', '?purpose=VALIDACION_AFILIACION&purpose=SUBSIDIO_MONETARIO']) {
      const response = await app.inject({ url: `/api/${version}/affiliations/1234567890${query}`, headers });
      assert.equal(response.statusCode, 400);
      assert.equal(response.json().error, 'INVALID_REQUEST');
    }
  }
  assert.equal(calls, 0);
  for (const purpose of ['VALIDACION_AFILIACION', 'TARIFA_SUBSIDIADA', 'SUBSIDIO_MONETARIO']) {
    assert.equal((await app.inject({ url: `/api/v1/affiliations/1234567890?purpose=${purpose}`, headers })).statusCode, 200);
  }
  assert.equal(calls, 3);
});

test('consulta_autentica_y_exige_consumidor_antes_de_validar_finalidad', async t => {
  let calls = 0;
  const { app, config } = routeApp({ query: async () => { calls += 1; return sample; } });
  t.after(() => app.close());
  for (const version of ['v1', 'v2']) {
    const url = `/api/${version}/affiliations/1234567890`;
    assert.equal((await app.inject(url)).statusCode, 401);
    assert.equal((await app.inject({ url, headers: { authorization: 'Bearer invalid-synthetic-token' } })).statusCode, 401);
    assert.equal((await app.inject({ url, headers: { authorization: `Bearer ${config.auth.adminToken}` } })).statusCode, 403);
  }
  assert.equal(calls, 0);
});

test('consulta_ruta_normaliza_y_captura_corte_una_vez', async t => {
  const queries: AffiliationQuery[] = [];
  let clockCalls = 0;
  const { app, headers } = routeApp({ query: async query => { queries.push(query); return { ...sample, requestId: query.requestId }; } }, () => { clockCalls += 1; return new Date('2026-10-15T04:59:59.999Z'); });
  t.after(() => app.close());
  const response = await app.inject({ url: '/api/v2/affiliations/001.234.%20567.890?purpose=SUBSIDIO_MONETARIO', headers });
  assert.equal(response.statusCode, 200);
  assert.equal(queries.length, 1);
  assert.equal(queries[0]?.document, '1234567890');
  assert.deepEqual(queries[0]?.identity, { kind: 'consumer', caja: 'CENTRO' });
  assert.equal(queries[0]?.purpose, 'SUBSIDIO_MONETARIO');
  assert.equal(queries[0]?.asOf, '2026-10-14');
  assert.equal(queries[0]?.signal.aborted, false);
  assert.equal(response.json().requestId, queries[0]?.requestId);
  assert.equal(clockCalls, 1);
  for (const document of ['12-34', '%20.%20', '1234567890123']) {
    const invalid = await app.inject({ url: `/api/v2/affiliations/${document}?purpose=VALIDACION_AFILIACION`, headers });
    assert.equal(invalid.statusCode, 400);
  }
  assert.equal(queries.length, 1);
});

test('consulta_v1_conserva_contrato_y_v2_agrega_solo_tipo_sin_datos_personales', async t => {
  const dirty = { ...sample, nombre: 'synthetic-private', matches: sample.matches.map(match => ({ ...match, correo: 'synthetic-private' })) };
  const { app, headers } = routeApp({ query: async () => dirty });
  t.after(() => app.close());
  const v1 = await app.inject({ url: '/api/v1/affiliations/1234567890?purpose=VALIDACION_AFILIACION', headers });
  const v2 = await app.inject({ url: '/api/v2/affiliations/1234567890?purpose=VALIDACION_AFILIACION', headers });
  assert.equal(v1.statusCode, 200);
  assert.equal(v2.statusCode, 200);
  assert.deepEqual(Object.keys(v1.json()).sort(), ['matches', 'requestId', 'result', 'unavailable']);
  assert.deepEqual(Object.keys(v1.json().matches[0]).sort(), ['asOf', 'caja', 'source', 'validFrom', 'validTo']);
  assert.deepEqual(v1.json().unavailable, ['ORIENTE']);
  const { affiliateType, ...originalMatch } = v2.json().matches[0];
  assert.equal(affiliateType, 'DEPENDIENTE');
  assert.deepEqual(originalMatch, v1.json().matches[0]);
  for (const response of [v1, v2]) {
    assert.ok(!response.body.includes('synthetic-private'));
    assert.equal(response.headers['cache-control'], 'no-store');
  }
});

test('consulta_http_acota_auditoria_pendiente_y_expone_503_seguro', async t => {
  const service = createAffiliationService({ adapters: ['NORTE', 'ORIENTE', 'CENTRO'].map(caja => ({ caja: caja as 'NORTE' | 'ORIENTE' | 'CENTRO', lookup: async () => ({ status: 'ok' as const, caja: caja as 'NORTE' | 'ORIENTE' | 'CENTRO', affiliations: [] }) })), query: { totalTimeoutMs: 160, originTimeoutMs: 50, concurrency: 1, originConcurrency: 1 }, audit: { append: async () => new Promise(() => {}), list: async () => [] } });
  const { app, headers } = routeApp(service);
  t.after(() => app.close());
  await app.ready();
  const began = performance.now();
  const response = await app.inject({ url: '/api/v1/affiliations/1234567890?purpose=VALIDACION_AFILIACION', headers });
  assert.ok(performance.now() - began < 600);
  assert.equal(response.statusCode, 503);
  assert.deepEqual(Object.keys(response.json()).sort(), ['error', 'requestId']);
  assert.equal(response.json().error, 'UNAVAILABLE');
});

test('consulta_http_cancela_origenes_si_cliente_cierra_conexion', { timeout: 5000 }, async t => {
  let entered!: () => void;
  let failConnection!: (error: Error) => void;
  let reachedHandler = false;
  let cancelled!: () => void;
  const entering = new Promise<void>((resolve, reject) => { entered = resolve; failConnection = reject; });
  const cancellation = new Promise<void>(resolve => { cancelled = resolve; });
  const { app, headers } = routeApp({ query: async input => new Promise<AffiliationResponseV2>(resolve => {
    input.signal.addEventListener('abort', () => { cancelled(); resolve({ ...sample, requestId: input.requestId }); }, { once: true });
    reachedHandler = true;
    entered();
  }) });
  t.after(() => app.close());
  const address = await app.listen({ host: '127.0.0.1', port: 0 });
  const request = httpRequest(new URL('/api/v1/affiliations/1234567890?purpose=VALIDACION_AFILIACION', address), { headers });
  request.on('error', error => { if (!reachedHandler) failConnection(error); });
  t.after(() => request.destroy());
  request.end();
  await entering;
  request.destroy();
  await cancellation;
});
