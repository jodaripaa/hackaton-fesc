import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { parse } from 'yaml';
import { buildApp } from '../../src/app.ts';
import {
  API_ROUTES, affiliationResponseV1Schema, affiliationResponseV2Schema,
  auditResponseSchema, batchResponseSchema,
} from '../../src/domain/schemas.ts';
import { DEFAULT_BATCH_PURPOSE } from '../../src/domain/types.ts';
import { testConfig } from '../helpers/config.ts';

test('contrato_openapi_declara_cinco_rutas_y_referencias_resolubles', async () => {
  const api = parse(await readFile(new URL('../../openapi.yaml', import.meta.url), 'utf8')) as Record<string, unknown>;
  assert.match(api['openapi'] as string, /^3\./u);
  const paths = api['paths'] as Record<string, Record<string, unknown>>;
  for (const route of Object.values(API_ROUTES)) {
    const path = route.replace(/:([A-Za-z]+)/gu, '{$1}');
    assert.ok(paths[path]);
    const method = path === '/api/v1/batch-checks' ? 'post' : 'get';
    const operation = paths[path]![method] as Record<string, unknown>;
    assert.equal(operation['x-implementation-status'], 'pending');
  }
  const visit = (value: unknown): void => {
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      if (key === '$ref') {
        assert.ok(typeof child === 'string' && child.startsWith('#/'));
        let target: unknown = api;
        for (const segment of child.slice(2).split('/')) target = (target as Record<string, unknown>)[segment];
        assert.ok(target, `Unresolved reference: ${child}`);
      } else visit(child);
    }
  };
  visit(api);
  assert.equal(DEFAULT_BATCH_PURPOSE, 'VALIDACION_AFILIACION');
});
test('contrato_serializa_listas_permitidas_y_v1_no_expone_tipo', async t => {
  const match = { caja: 'NORTE', validFrom: '2026-01-01', validTo: null, source: 'ONLINE', asOf: '2026-10-14', affiliateType: 'DEPENDIENTE', nombre: 'synthetic-private-field' };
  const result = { requestId: 'synthetic-request', result: 'AFILIADO_OTRA_CAJA', matches: [match], unavailable: [], correo: 'synthetic-private-field' };
  const app = buildApp({ config: testConfig(), logger: false, persistence: { ping: async () => true, close: async () => {} } });
  for (const [url, schema, payload] of [
    ['/v1', affiliationResponseV1Schema, result], ['/v2', affiliationResponseV2Schema, result],
    ['/batch', batchResponseSchema, { status: 'DONE', results: [{ ...result, document: '12345678' }], nombre: 'synthetic-private-field' }],
    ['/audit', auditResponseSchema, [{ timestamp: '2026-10-14T15:00:00.000Z', requestingCaja: 'NORTE', purpose: DEFAULT_BATCH_PURPOSE, result: 'INDETERMINADO', documentMasked: '****5678', nombre: 'synthetic-private-field' }]],
  ] as const) app.get(url, { schema: { response: { 200: schema } } }, async () => payload);
  t.after(() => app.close());
  const v1 = (await app.inject('/v1')).json();
  assert.equal(v1.matches[0].affiliateType, undefined);
  assert.equal((await app.inject('/v2')).json().matches[0].affiliateType, 'DEPENDIENTE');
  for (const url of ['/v1', '/v2', '/batch', '/audit']) assert.ok(!(await app.inject(url)).body.includes('synthetic-private-field'));
});
