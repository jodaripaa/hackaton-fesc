import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import test from 'node:test';
import type { Pool } from 'pg';
import { buildApp } from '../../src/app.ts';
import { maskDocument } from '../../src/audit/masking.ts';
import { createAuditRepository } from '../../src/audit/repository.ts';
import { loadConfig } from '../../src/config/index.ts';
import { AppError } from '../../src/domain/errors.ts';
import type { AuditEntry, AuditRecord, AuditRepository, AffiliationService, AffiliationResponseV2 } from '../../src/domain/types.ts';
import { createAffiliationRoutes } from '../../src/routes/affiliations.ts';
import { createAuditRoutes } from '../../src/routes/audit.ts';
import { createSecurity } from '../../src/security/index.ts';
import { cajasPath, testEnvironment } from '../helpers/config.ts';

const document = '9876543210';
const sample: AffiliationResponseV2 = {
  requestId: 'synthetic-request', result: 'AFILIADO_OTRA_CAJA', unavailable: [],
  matches: [{ caja: 'NORTE', validFrom: '2025-01-01', validTo: null, source: 'ONLINE', asOf: '2026-10-14', affiliateType: 'DEPENDIENTE' }],
};
const entry: AuditEntry = { timestamp: '2026-10-14T15:00:00.000Z', requestingCaja: 'CENTRO', purpose: 'VALIDACION_AFILIACION', result: 'AFILIADO_OTRA_CAJA', documentMasked: '******3210' };

function fixture(service: AffiliationService = { query: async input => ({ ...sample, requestId: input.requestId }) }, repository: AuditRepository = { append: async () => {}, list: async () => [entry] }, logging = false) {
  const env = testEnvironment();
  env['LOG_LEVEL'] = logging ? 'info' : 'silent';
  const config = loadConfig(env, { cajasPath });
  const security = createSecurity(config.auth);
  let logs = '';
  const app = buildApp({ config, logger: logging, logStream: { write(message) { logs += message; } }, persistence: { ping: async () => true, close: async () => {} }, modules: {
    affiliations: createAffiliationRoutes({ service, security }), audit: createAuditRoutes({ repository, security }),
  } });
  return { app, config, logs: () => logs, consumer: { authorization: `Bearer ${config.auth.consumerTokens.CENTRO}` }, admin: { authorization: `Bearer ${config.auth.adminToken}` } };
}

test('test_consulta_sin_token_responde_401', async t => {
  let calls = 0;
  const f = fixture({ query: async () => { calls += 1; return sample; } });
  t.after(() => f.app.close());
  const invalid = randomBytes(24).toString('hex');
  for (const version of ['v1', 'v2']) {
    const url = `/api/${version}/affiliations/${document}`;
    for (const authorization of [undefined, `Bearer ${invalid}`, `Basic ${invalid}`, 'Bearer', `Bearer ${invalid} extra`, `Bearer ${'x'.repeat(4100)}`]) {
      const response = await f.app.inject({ url, ...(authorization ? { headers: { authorization } } : {}) });
      assert.equal(response.statusCode, 401);
      assert.equal(response.json().error, 'UNAUTHORIZED');
      assert.deepEqual(Object.keys(response.json()).sort(), ['error', 'requestId']);
    }
  }
  assert.equal(calls, 0, 'Una petición no autenticada no alcanza el servicio de consultas');
});

test('test_finalidad_ausente_o_invalida_responde_400', async t => {
  let calls = 0;
  const f = fixture({ query: async () => { calls += 1; return sample; } });
  t.after(() => f.app.close());
  for (const version of ['v1', 'v2']) {
    for (const query of ['', '?purpose=', '?purpose=OTRA', '?purpose=VALIDACION_AFILIACION&purpose=TARIFA_SUBSIDIADA']) {
      const response = await f.app.inject({ url: `/api/${version}/affiliations/${document}${query}`, headers: f.consumer });
      assert.equal(response.statusCode, 400);
    }
  }
  assert.equal(calls, 0, 'Una finalidad rechazada no produce consulta ni tratamiento del documento');
  for (const purpose of ['TARIFA_SUBSIDIADA', 'SUBSIDIO_MONETARIO', 'VALIDACION_AFILIACION']) {
    assert.equal((await f.app.inject({ url: `/api/v1/affiliations/${document}?purpose=${purpose}`, headers: f.consumer })).statusCode, 200);
  }
  assert.equal(calls, 3);
});

test('test_respuestas_solo_contienen_dato_minimo', async t => {
  // Inject extra fields at the domain boundary to exercise the real output serializers.
  const dirty = { ...sample, nombre: 'synthetic-private', titular: { salario: 1 }, matches: sample.matches.map(match => ({ ...match, correo: 'synthetic-private', beneficiarios: ['synthetic-private'] })) };
  const dirtyAudit = { ...entry, documento: document, nombre: 'synthetic-private' };
  const f = fixture({ query: async () => dirty }, { append: async () => {}, list: async () => [dirtyAudit] });
  t.after(() => f.app.close());
  for (const version of ['v1', 'v2']) {
    const response = await f.app.inject({ url: `/api/${version}/affiliations/${document}?purpose=VALIDACION_AFILIACION`, headers: f.consumer });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(Object.keys(response.json()).sort(), ['matches', 'requestId', 'result', 'unavailable']);
    assert.deepEqual(Object.keys(response.json().matches[0]).sort(), [...(version === 'v2' ? ['affiliateType'] : []), 'asOf', 'caja', 'source', 'validFrom', 'validTo'].sort());
    assert.ok(!response.body.includes('synthetic-private'));
  }
  const audit = await f.app.inject({ url: '/api/v1/audit', headers: f.admin });
  assert.equal(audit.statusCode, 200);
  assert.deepEqual(Object.keys(audit.json()[0]).sort(), ['documentMasked', 'purpose', 'requestingCaja', 'result', 'timestamp']);
  assert.ok(!audit.body.includes(document));
  assert.ok(!audit.body.includes('synthetic-private'));
});

test('test_secretos_no_se_exponen_en_logs_y_errores', async t => {
  const secret = randomBytes(24).toString('hex');
  const f = fixture({ query: async () => { throw new Error(`upstream credential ${secret} person synthetic-private ${document}`); } }, { append: async () => {}, list: async () => { throw new Error(secret); } }, true);
  t.after(() => f.app.close());
  const failed = await f.app.inject({ url: `/api/v2/affiliations/${document}?purpose=VALIDACION_AFILIACION`, headers: f.consumer });
  assert.equal(failed.statusCode, 500);
  assert.equal(failed.json().error, 'INTERNAL_ERROR');
  assert.deepEqual(Object.keys(failed.json()).sort(), ['error', 'requestId']);
  await f.app.inject({ url: '/api/v1/audit', headers: f.admin });
  await f.app.inject({ url: `/api/v1/affiliations/${document}?purpose=${secret}`, headers: { authorization: `Bearer ${secret}` } });
  const output = f.logs() + failed.body;
  assert.ok(f.logs().includes('request failed'), 'El logger está activo durante la prueba');
  for (const value of [secret, document, 'synthetic-private', f.config.auth.adminToken, ...Object.values(f.config.auth.consumerTokens)]) assert.ok(!output.includes(value), 'El error y los logs no revelan el dato sensible');
  assert.ok(!f.logs().includes('/affiliations/'));
});

test('test_auditoria_exclusiva_y_documento_enmascarado', async t => {
  let reads = 0;
  const masked = maskDocument(document);
  const f = fixture(undefined, { append: async () => {}, list: async limit => { reads += 1; assert.equal(limit, 7); return [{ ...entry, documentMasked: masked }]; } });
  t.after(() => f.app.close());
  assert.equal((await f.app.inject('/api/v1/audit?limit=7')).statusCode, 401);
  for (const token of Object.values(f.config.auth.consumerTokens)) assert.equal((await f.app.inject({ url: '/api/v1/audit?limit=7', headers: { authorization: `Bearer ${token}` } })).statusCode, 403);
  assert.equal(reads, 0);
  const response = await f.app.inject({ url: '/api/v1/audit?limit=7', headers: f.admin });
  assert.equal(response.statusCode, 200);
  assert.equal(reads, 1);
  assert.deepEqual(response.json(), [{ ...entry, documentMasked: masked }]);
  assert.match(masked, /^\*+[0-9]{0,4}$/u);
  assert.ok(!response.body.includes(document));
});

test('seguridad_identidad_por_token_y_admin_no_consulta_afiliaciones', async t => {
  const identities: string[] = [];
  const f = fixture({ query: async input => { identities.push(input.identity.caja); return sample; } });
  t.after(() => f.app.close());
  const url = `/api/v1/affiliations/${document}?purpose=VALIDACION_AFILIACION`;
  for (const [caja, token] of Object.entries(f.config.auth.consumerTokens)) {
    assert.equal((await f.app.inject({ url, headers: { authorization: `Bearer ${token}` } })).statusCode, 200);
    assert.equal(identities.at(-1), caja);
  }
  assert.equal((await f.app.inject({ url, headers: f.admin })).statusCode, 403);
  assert.equal(identities.length, 4);
});

test('auditoria_mascara_oculta_al_menos_un_digito_incluso_documento_corto', () => {
  for (const input of ['1', '12', '123', '1234', '12345', document, '123456789012']) {
    const masked = maskDocument(input);
    assert.equal(masked.length, input.length);
    assert.match(masked, /^\*+[0-9]{0,4}$/u);
    assert.notEqual(masked, input);
    assert.ok((masked.match(/[0-9]/gu) ?? []).length <= 4);
  }
});

test('auditoria_repositorio_parametriza_y_no_persiste_documento_completo', async () => {
  const calls: { sql: string; values: unknown[] }[] = [];
  const pool = { query: async (sql: string, values: unknown[]) => { calls.push({ sql, values }); return { rows: [] }; } } as unknown as Pool;
  const repository = createAuditRepository(pool);
  const record: AuditRecord = { ...entry, requestId: 'synthetic-request' };
  await repository.append(record);
  assert.equal(calls.length, 1);
  assert.match(calls[0]!.sql, /VALUES \(\$1, \$2, \$3, \$4, \$5, \$6\)/u);
  assert.deepEqual(calls[0]!.values, [record.requestId, record.timestamp, record.requestingCaja, record.purpose, record.result, record.documentMasked]);
  assert.ok(!JSON.stringify(calls).includes(document));
  for (const masked of [document, '1234', '*****12345', 'nombre']) await assert.rejects(repository.append({ ...record, documentMasked: masked }), error => error instanceof AppError && error.statusCode === 503);
  assert.equal(calls.length, 1, 'Un documento no enmascarado se rechaza antes de llegar a PostgreSQL');
});

test('auditoria_orden_limite_y_errores_de_db_sanitizados', async () => {
  let sqlRead = '';
  const repository = createAuditRepository({ query: async (sql: string, values: unknown[]) => {
    sqlRead = sql;
    assert.deepEqual(values, [2]);
    return { rows: [{ occurred_at: new Date(entry.timestamp), requesting_caja: entry.requestingCaja, purpose: entry.purpose, result: entry.result, document_masked: entry.documentMasked }] };
  } } as unknown as Pool);
  assert.deepEqual(await repository.list(2), [entry]);
  assert.match(sqlRead, /ORDER BY occurred_at DESC, id DESC LIMIT \$1/u);
  for (const limit of [0, -1, 1001, 1.2, NaN]) await assert.rejects(repository.list(limit), error => error instanceof AppError && error.statusCode === 400);
  const failed = createAuditRepository({ query: async () => { throw new Error('synthetic database credential'); } } as unknown as Pool);
  for (const operation of [() => failed.append({ ...entry, requestId: 'synthetic' }), () => failed.list(1)]) await assert.rejects(operation(), error => error instanceof AppError && error.statusCode === 503 && !error.message.includes('credential'));
});

test('auditoria_ruta_rechaza_limites_invalidos_antes_del_repositorio', async t => {
  let reads = 0;
  const f = fixture(undefined, { append: async () => {}, list: async () => { reads += 1; return []; } });
  t.after(() => f.app.close());
  for (const limit of ['0', '-1', '1001', '1.5', 'NaN']) assert.equal((await f.app.inject({ url: `/api/v1/audit?limit=${limit}`, headers: f.admin })).statusCode, 400);
  assert.equal(reads, 0);
});
