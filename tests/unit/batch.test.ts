import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { buildApp } from '../../src/app.ts';
import { batchContentHash, parseBatchCsv } from '../../src/batch/csv.ts';
import { createBatchRepository } from '../../src/batch/repository.ts';
import { createBatchService } from '../../src/batch/service.ts';
import { loadConfig } from '../../src/config/index.ts';
import { AppError } from '../../src/domain/errors.ts';
import { normalizeDocument } from '../../src/domain/normalization.ts';
import type { AffiliationQuery, AffiliationResponseV2, BatchAccepted, BatchJob, BatchRepository, BatchResponse, BatchRowResult, BatchService, BatchSubmission, ConsumerIdentity, Purpose } from '../../src/domain/types.ts';
import { createPostgresConnection } from '../../src/persistence/connection.ts';
import { createBatchRoutes } from '../../src/routes/batch.ts';
import { createSecurity } from '../../src/security/index.ts';
import { testConfig } from '../helpers/config.ts';
import type { Pool } from 'pg';

const owner: ConsumerIdentity = { kind: 'consumer', caja: 'NORTE' };
const other: ConsumerIdentity = { kind: 'consumer', caja: 'CENTRO' };
const jobDate = '2026-10-15T04:59:59.999Z';
function submission(documents: readonly string[], purpose: Purpose = 'VALIDACION_AFILIACION', key: string = randomUUID(), identity = owner): BatchSubmission {
  const normalized = documents.map(normalizeDocument);
  return { identity, purpose, idempotencyKey: key, contentHash: batchContentHash(purpose, normalized), documents: normalized, requestId: randomUUID() };
}
function response(input: AffiliationQuery): AffiliationResponseV2 {
  return { requestId: input.requestId, result: 'NO_AFILIADO', matches: [], unavailable: [] };
}
async function eventually(check: () => Promise<boolean>, timeout = 5000): Promise<void> {
  const end = Date.now() + timeout;
  while (!await check()) { if (Date.now() >= end) assert.fail('Timed out waiting for batch state'); await delay(5); }
}

/** Independent durable-store double: survives creation of a new service instance. */
class MemoryRepository implements BatchRepository {
  readonly jobs = new Map<string, BatchJob>();
  readonly results = new Map<string, BatchRowResult[]>();
  readonly keys = new Map<string, { hash: string; jobId: string }>();
  readonly writes: number[] = [];
  recoveries = 0;
  failSave = false;
  async createOrGet(input: BatchSubmission): Promise<BatchAccepted> {
    const key = `${input.identity.caja}:${input.idempotencyKey}`;
    const existing = this.keys.get(key);
    if (existing) { if (existing.hash !== input.contentHash) throw new AppError(409, 'CONFLICT'); return { jobId: existing.jobId }; }
    const jobId = randomUUID();
    this.keys.set(key, { jobId, hash: input.contentHash });
    this.jobs.set(jobId, { jobId, requestingCaja: input.identity.caja, purpose: input.purpose, status: 'PENDING', createdAt: jobDate, updatedAt: jobDate, documents: input.documents });
    this.results.set(jobId, []);
    return { jobId };
  }
  async find(jobId: string, identity: ConsumerIdentity): Promise<BatchJob | null> {
    const job = this.jobs.get(jobId);
    return job?.requestingCaja === identity.caja ? job : null;
  }
  async claimPending(): Promise<BatchJob | null> {
    const job = [...this.jobs.values()].find(value => value.status === 'PENDING');
    if (!job) return null;
    const claimed: BatchJob = { ...job, status: 'RUNNING' };
    this.jobs.set(job.jobId, claimed);
    return claimed;
  }
  async saveResults(jobId: string, results: readonly BatchRowResult[]): Promise<void> {
    if (this.failSave) { this.failSave = false; throw new AppError(503, 'UNAVAILABLE'); }
    this.writes.push(results.length);
    this.results.get(jobId)?.push(...results);
  }
  async complete(jobId: string): Promise<void> {
    const job = this.jobs.get(jobId);
    assert.ok(job);
    assert.equal(this.results.get(jobId)?.length, job.documents.length);
    this.jobs.set(jobId, { ...job, status: 'DONE' });
  }
  async readResults(jobId: string, identity: ConsumerIdentity): Promise<BatchResponse | null> {
    const job = await this.find(jobId, identity);
    return job ? { status: job.status, results: [...(this.results.get(jobId) ?? [])] } : null;
  }
  async recoverInterrupted(): Promise<number> {
    let recovered = 0;
    this.recoveries += 1;
    for (const [id, job] of this.jobs) {
      if (job.status === 'RUNNING') { this.jobs.set(id, { ...job, status: 'PENDING' }); recovered += 1; }
    }
    return recovered;
  }
}

test('lote_csv_normaliza_BOM_comillas_CRLF_y_conserva_orden_y_duplicados', () => {
  assert.deepEqual(parseBatchCsv(Buffer.from('\ufeffother,document\r\nignored,"001.234"\r\nignored,5678\r\nignored,1234\r\n'), 10), ['1234', '5678', '1234']);
});
test('lote_csv_rechaza_filas_invalidas_sin_descartarlas', () => {
  for (const csv of ['', 'document\n', 'different\n123\n', 'document,document\n123,456\n', 'document\n123\n\n456\n', 'document\n12-34\n', 'document\n123\n"456\n', 'document,other\n123\n', 'document\n1234567890123\n']) {
    assert.throws(() => parseBatchCsv(Buffer.from(csv), 10), error => error instanceof AppError && error.statusCode === 400);
  }
  assert.throws(() => parseBatchCsv(Buffer.from([0xff]), 10), error => error instanceof AppError && error.statusCode === 400);
});
test('lote_csv_limita_filas_y_tamano_de_registro', () => {
  assert.throws(() => parseBatchCsv(Buffer.from('document\n123\n456\n789\n'), 2), error => error instanceof AppError && error.statusCode === 413);
  assert.throws(() => parseBatchCsv(Buffer.from(`document\n${'1'.repeat(5000)}\n`), 10), error => error instanceof AppError && error.statusCode === 400);
});
test('lote_hash_canonico_incluye_finalidad_orden_y_duplicados', () => {
  const a = submission(['001.234', '5678', '1234']);
  const b = submission(['1234', '5678', '1234']);
  assert.equal(a.contentHash, b.contentHash);
  assert.notEqual(a.contentHash, submission(['5678', '1234', '1234']).contentHash);
  assert.notEqual(a.contentHash, submission(['1234', '5678']).contentHash);
  assert.notEqual(a.contentHash, submission(['1234', '5678', '1234'], 'SUBSIDIO_MONETARIO').contentHash);
});

function routes(serviceOverrides: Partial<BatchService> = {}, maximum = 10000, bodyLimit = 2097152) {
  const config = testConfig();
  const received: BatchSubmission[] = [];
  const counts = { starts: 0, stops: 0 };
  const repository = new MemoryRepository();
  const service: BatchService = {
    submit: async input => { received.push(input); return repository.createOrGet(input); },
    get: (jobId, identity) => repository.readResults(jobId, identity),
    start: async () => { counts.starts += 1; }, stop: async () => { counts.stops += 1; }, ...serviceOverrides,
  };
  const app = buildApp({ config: { ...config, server: { ...config.server, bodyLimit } }, logger: false,
    persistence: { ping: async () => true, close: async () => { assert.equal(counts.stops, 1); } },
    modules: { batch: createBatchRoutes({ service, security: createSecurity(config.auth), batch: { concurrency: 2, maxDocuments: maximum } }) } });
  const headers = { authorization: `Bearer ${config.auth.consumerTokens.NORTE}`, 'idempotency-key': randomUUID(), 'content-type': 'text/csv' };
  return { app, config, service, received, counts, headers };
}
function multipartBody(boundary: string, csv: string, fieldname = 'file'): string {
  return `--${boundary}\r\nContent-Disposition: form-data; name="${fieldname}"; filename="independent.csv"\r\nContent-Type: text/csv\r\n\r\n${csv}\r\n--${boundary}--\r\n`;
}
test('lote_ruta_csv_devuelve_202_y_finalidad_predeterminada', async t => {
  const { app, headers, received } = routes(); t.after(() => app.close());
  const result = await app.inject({ method: 'POST', url: '/api/v1/batch-checks', headers, payload: 'document\n001.234\n5678\n' });
  assert.equal(result.statusCode, 202);
  assert.deepEqual(Object.keys(result.json()), ['jobId']);
  assert.match(result.json().jobId, /^[0-9a-f-]{36}$/u);
  assert.equal(received[0]?.purpose, 'VALIDACION_AFILIACION');
  assert.deepEqual(received[0]?.documents, ['1234', '5678']);
  assert.deepEqual(received[0]?.identity, owner);
  assert.equal(result.headers['cache-control'], 'no-store');
});
test('lote_ruta_multipart_equivalente_comparte_jobId_con_CSV', async t => {
  const { app, headers, received } = routes(); t.after(() => app.close());
  const csv = 'document\r\n1234\r\n5678\r\n';
  const original = await app.inject({ method: 'POST', url: '/api/v1/batch-checks', headers, payload: csv });
  const boundary = 'synthetic-boundary';
  const repeated = await app.inject({ method: 'POST', url: '/api/v1/batch-checks', headers: { ...headers, 'content-type': `multipart/form-data; boundary=${boundary}` }, payload: multipartBody(boundary, 'document\n001.234\n5678\n') });
  assert.equal(repeated.statusCode, 202);
  assert.equal(repeated.json().jobId, original.json().jobId);
  assert.equal(received[0]?.contentHash, received[1]?.contentHash);
});
test('lote_ruta_valida_finalidad_y_clave_antes_de_crear_trabajo', async t => {
  const { app, headers, received } = routes(); t.after(() => app.close());
  for (const query of ['?purpose=INVALID', '?purpose=', '?purpose=VALIDACION_AFILIACION&extra=1', '?purpose=VALIDACION_AFILIACION&purpose=SUBSIDIO_MONETARIO']) {
    assert.equal((await app.inject({ method: 'POST', url: `/api/v1/batch-checks${query}`, headers, payload: 'document\n1234\n' })).statusCode, 400);
  }
  for (const key of ['', ' ', ' key', 'x'.repeat(201)]) {
    assert.equal((await app.inject({ method: 'POST', url: '/api/v1/batch-checks', headers: { ...headers, 'idempotency-key': key }, payload: 'document\n1234\n' })).statusCode, 400);
  }
  const { 'idempotency-key': _key, ...noKey } = headers;
  assert.equal((await app.inject({ method: 'POST', url: '/api/v1/batch-checks', headers: noKey, payload: 'document\n1234\n' })).statusCode, 400);
  assert.equal(received.length, 0);
  assert.equal((await app.inject({ method: 'POST', url: '/api/v1/batch-checks?purpose=TARIFA_SUBSIDIADA', headers, payload: 'document\n1234\n' })).statusCode, 202);
  assert.equal(received[0]?.purpose, 'TARIFA_SUBSIDIADA');
});
test('lote_ruta_autenticacion_y_rol_antes_de_parsear_CSV', async t => {
  const { app, config, headers, received } = routes(); t.after(() => app.close());
  for (const authorization of ['', 'Bearer invalid-synthetic', `Bearer ${config.auth.adminToken}`]) {
    const result = await app.inject({ method: 'POST', url: '/api/v1/batch-checks?purpose=INVALID', headers: { ...headers, authorization }, payload: 'not csv' });
    assert.equal(result.statusCode, authorization.includes(config.auth.adminToken) ? 403 : 401);
  }
  assert.equal(received.length, 0);
});
test('lote_ruta_rechaza_archivo_invalido_y_limites_sin_crear', async t => {
  const { app, headers, received } = routes({}, 2, 1024); t.after(() => app.close());
  assert.equal((await app.inject({ method: 'POST', url: '/api/v1/batch-checks', headers, payload: 'document\n1234\n\n' })).statusCode, 400);
  assert.equal((await app.inject({ method: 'POST', url: '/api/v1/batch-checks', headers, payload: 'document\n1234\n5678\n9012\n' })).statusCode, 413);
  assert.equal((await app.inject({ method: 'POST', url: '/api/v1/batch-checks', headers, payload: 'x'.repeat(1025) })).statusCode, 413);
  const boundary = 'synthetic-boundary';
  for (const [payload, status] of [[multipartBody(boundary, 'document\n1234\n', 'wrong'), 400], [multipartBody(boundary, 'x'.repeat(1025)), 413], [`--${boundary}--\r\n`, 400]] as const) {
    const result = await app.inject({ method: 'POST', url: '/api/v1/batch-checks', headers: { ...headers, 'content-type': `multipart/form-data; boundary=${boundary}` }, payload });
    assert.equal(result.statusCode, status);
  }
  assert.equal(received.length, 0);
});
test('lote_ruta_aisla_consumidor_y_hash_distinto_devuelve_409', async t => {
  const { app, config, headers } = routes(); t.after(() => app.close());
  const created = await app.inject({ method: 'POST', url: '/api/v1/batch-checks', headers, payload: 'document\n1234\n' });
  const jobId = created.json().jobId;
  const owned = await app.inject({ url: `/api/v1/batch-checks/${jobId}`, headers });
  assert.deepEqual(owned.json(), { status: 'PENDING', results: [] });
  assert.equal((await app.inject({ url: `/api/v1/batch-checks/${jobId}`, headers: { authorization: `Bearer ${config.auth.consumerTokens.CENTRO}` } })).statusCode, 404);
  assert.equal((await app.inject({ url: `/api/v1/batch-checks/${randomUUID()}`, headers })).statusCode, 404);
  const conflict = await app.inject({ method: 'POST', url: '/api/v1/batch-checks', headers, payload: 'document\n5678\n' });
  assert.equal(conflict.statusCode, 409);
  assert.equal(conflict.json().error, 'CONFLICT');
  const independent = await app.inject({ method: 'POST', url: '/api/v1/batch-checks', headers: { ...headers, authorization: `Bearer ${config.auth.consumerTokens.CENTRO}` }, payload: 'document\n1234\n' });
  assert.equal(independent.statusCode, 202);
  assert.notEqual(independent.json().jobId, jobId);
});
test('lote_ruta_salida_v1_elimina_datos_personales_y_tipo', async t => {
  const document = normalizeDocument('1234');
  const dirty = { status: 'DONE' as const, results: [{ document, requestId: randomUUID(), result: 'AFILIADO_OTRA_CAJA' as const, unavailable: ['ORIENTE' as const], nombre: 'private-synthetic', matches: [{ caja: 'CENTRO' as const, validFrom: '2026-01-01', validTo: null, source: 'FILE' as const, asOf: '2026-10-03', affiliateType: 'DEPENDIENTE', correo: 'private-synthetic' }] }], token: 'private-synthetic' };
  const { app, headers } = routes({ get: async () => dirty }); t.after(() => app.close());
  const result = await app.inject({ url: `/api/v1/batch-checks/${randomUUID()}`, headers });
  assert.equal(result.statusCode, 200);
  assert.ok(!result.body.includes('private-synthetic'));
  assert.ok(!result.body.includes('affiliateType'));
  assert.deepEqual(Object.keys(result.json().results[0]).sort(), ['document', 'matches', 'requestId', 'result', 'unavailable']);
});
test('lote_ruta_lifecycle_cierra_worker_antes_de_pool', async () => {
  const { app, counts } = routes();
  await app.ready();
  assert.equal(counts.starts, 1);
  await app.close();
  assert.equal(counts.stops, 1);
});

function worker(repository: BatchRepository, query: (input: AffiliationQuery) => Promise<AffiliationResponseV2>, concurrency = 3, queryConcurrency = 8, originConcurrency = 8) {
  return createBatchService({ repository, affiliations: { query }, batch: { concurrency, maxDocuments: 10000 },
    query: { concurrency: queryConcurrency, originConcurrency, totalTimeoutMs: 200, originTimeoutMs: 100 } });
}
test('lote_worker_conserva_orden_duplicados_corte_y_auditoria_por_fila', async t => {
  const repository = new MemoryRepository();
  const calls: AffiliationQuery[] = [];
  const service = worker(repository, async input => { calls.push(input); await delay(input.document === '1234' ? 5 : 1); return { ...response(input), result: 'AFILIADO_OTRA_CAJA', matches: [{ caja: 'CENTRO', validFrom: '2026-01-01', validTo: null, source: 'FILE', asOf: '2026-10-03', affiliateType: 'DEPENDIENTE' }] }; });
  t.after(() => service.stop());
  const { jobId } = await service.submit(submission(['1234', '5678', '1234', '9012']));
  assert.equal((await service.get(jobId, owner))?.status, 'PENDING');
  await service.start();
  await eventually(async () => (await service.get(jobId, owner))?.status === 'DONE');
  const result = await service.get(jobId, owner);
  assert.deepEqual(result?.results.map(row => row.document), ['1234', '5678', '1234', '9012']);
  assert.equal(calls.length, 4);
  assert.equal(new Set(calls.map(call => call.requestId)).size, 4);
  assert.ok(calls.every(call => call.asOf === '2026-10-14' && call.purpose === 'VALIDACION_AFILIACION' && call.identity.caja === 'NORTE'));
  assert.ok(result?.results.every(row => row.matches[0]?.asOf === '2026-10-03' && !('affiliateType' in (row.matches[0] ?? {}))));
});
test('lote_worker_reserva_capacidad_y_limita_concurrencia_global', async t => {
  const repository = new MemoryRepository();
  let active = 0; let peak = 0;
  const service = worker(repository, async input => { active += 1; peak = Math.max(peak, active); await delay(5); active -= 1; return response(input); }, 8, 8, 4);
  t.after(() => service.stop());
  const { jobId } = await service.submit(submission(Array.from({ length: 30 }, (_, i) => String(1000 + i))));
  await service.start(); await eventually(async () => (await service.get(jobId, owner))?.status === 'DONE');
  assert.equal(peak, 3);
  assert.equal(active, 0);
  assert.ok(repository.writes.every(count => count <= 6));
});
test('lote_worker_10000_filas_sinteticas_correctas_y_escrituras_acotadas', async t => {
  const repository = new MemoryRepository();
  const service = worker(repository, async input => ({ ...response(input), result: Number(input.document) % 2 === 0 ? 'INDETERMINADO' : 'NO_AFILIADO', unavailable: Number(input.document) % 2 === 0 ? ['ORIENTE'] : [] }), 16, 64, 32);
  t.after(() => service.stop());
  const input = submission(Array.from({ length: 10000 }, (_, index) => String(100000 + index)));
  const { jobId } = await service.submit(input);
  await service.start(); await eventually(async () => (await service.get(jobId, owner))?.status === 'DONE');
  const result = await service.get(jobId, owner);
  assert.equal(result?.results.length, 10000);
  result?.results.forEach((row, index) => {
    assert.equal(row.document, input.documents[index]);
    assert.equal(row.result, index % 2 === 0 ? 'INDETERMINADO' : 'NO_AFILIADO');
    assert.deepEqual(row.unavailable, index % 2 === 0 ? ['ORIENTE'] : []);
    assert.match(row.requestId, /^[0-9a-f-]{36}$/u);
  });
  assert.equal(repository.writes.reduce((sum, count) => sum + count, 0), 10000);
  assert.ok(repository.writes.every(count => count <= 32));
  assert.equal(new Set(result?.results.map(row => row.requestId)).size, 10000);
});
test('lote_worker_reanuda_punto_confirmado_tras_reinicio', async t => {
  const repository = new MemoryRepository();
  const input = submission(['1234', '5678', '9012']);
  const { jobId } = await repository.createOrGet(input);
  const job = repository.jobs.get(jobId); assert.ok(job);
  repository.jobs.set(jobId, { ...job, status: 'RUNNING' });
  repository.results.set(jobId, [{ document: normalizeDocument('1234'), ...response({ document: normalizeDocument('1234'), identity: owner, purpose: input.purpose, requestId: randomUUID(), asOf: '2026-10-14', signal: new AbortController().signal }) }]);
  const calls: string[] = [];
  const service = worker(repository, async query => { calls.push(query.document); return response(query); }); t.after(() => service.stop());
  await service.start(); await eventually(async () => (await service.get(jobId, owner))?.status === 'DONE');
  assert.deepEqual(calls, ['5678', '9012']);
  assert.deepEqual((await service.get(jobId, owner))?.results.map(row => row.document), ['1234', '5678', '9012']);
});
test('lote_worker_error_de_persistencia_no_pierde_trabajo_y_audita_cada_consulta_real', async t => {
  const repository = new MemoryRepository(); repository.failSave = true;
  const queryIds: string[] = []; const durableAudit = new Set<string>();
  const service = worker(repository, async input => { queryIds.push(input.requestId); durableAudit.add(input.requestId); return response(input); }); t.after(() => service.stop());
  const { jobId } = await service.submit(submission(['1234', '5678']));
  await service.start(); await eventually(async () => (await service.get(jobId, owner))?.status === 'DONE');
  assert.equal(queryIds.length, 4); assert.equal(durableAudit.size, 4);
  assert.equal((await service.get(jobId, owner))?.results.length, 2);
});
test('lote_worker_stop_cancela_y_reinicio_termina_sin_perdida', async () => {
  const repository = new MemoryRepository();
  let entered = false;
  const first = worker(repository, input => { entered = true; return new Promise((_resolve, reject) => { input.signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true }); }); });
  const { jobId } = await first.submit(submission(['1234', '5678']));
  await first.start(); await eventually(async () => entered);
  await first.stop();
  assert.equal((await first.get(jobId, owner))?.status, 'PENDING');
  const resumed = worker(repository, async input => response(input));
  try { await resumed.start(); await eventually(async () => (await resumed.get(jobId, owner))?.status === 'DONE'); }
  finally { await resumed.stop(); }
  assert.equal((await resumed.get(jobId, owner))?.results.length, 2);
});
test('lote_worker_reconsulta_con_id_nuevo_si_cambia_resultado_tras_falla_de_guardado', async t => {
  const repository = new MemoryRepository(); repository.failSave = true;
  const audit = new Map<string, string>();
  let calls = 0;
  const service = worker(repository, async input => {
    const result = ++calls === 1 ? 'NO_AFILIADO' as const : 'INDETERMINADO' as const;
    audit.set(input.requestId, result);
    return { ...response(input), result, unavailable: result === 'INDETERMINADO' ? ['ORIENTE'] : [] };
  }); t.after(() => service.stop());
  const { jobId } = await service.submit(submission(['1234']));
  await service.start(); await eventually(async () => (await service.get(jobId, owner))?.status === 'DONE');
  const row = (await service.get(jobId, owner))?.results[0]; assert.ok(row);
  assert.equal(row.result, 'INDETERMINADO');
  assert.equal(audit.get(row.requestId), row.result);
  assert.equal(audit.size, 2);
});
test('lote_worker_auditoria_fallida_no_se_convierte_en_NO_AFILIADO', async t => {
  const repository = new MemoryRepository();
  let fail = true;
  const service = worker(repository, async input => { if (fail) { fail = false; throw new AppError(503, 'UNAVAILABLE'); } return response(input); }); t.after(() => service.stop());
  const { jobId } = await service.submit(submission(['1234']));
  await service.start(); await eventually(async () => !fail);
  assert.notEqual((await service.get(jobId, owner))?.status, 'DONE');
  assert.equal((await service.get(jobId, owner))?.results.length, 0);
  await eventually(async () => (await service.get(jobId, owner))?.status === 'DONE');
});
test('lote_service_valida_antes_de_persistir_y_start_stop_son_repetibles', async () => {
  const repository = new MemoryRepository();
  const service = worker(repository, async input => response(input));
  const original = submission(['1234']);
  for (const invalid of [{ ...original, idempotencyKey: ' ' }, { ...original, documents: [] }, { ...original, contentHash: '0'.repeat(64) }]) {
    await assert.rejects(service.submit(invalid), error => error instanceof AppError && error.statusCode === 400);
  }
  assert.equal(repository.jobs.size, 0);
  const results = await Promise.all(Array.from({ length: 8 }, () => service.submit(original)));
  assert.equal(new Set(results.map(result => result.jobId)).size, 1);
  await Promise.all([service.start(), service.start()]);
  await service.stop(); await service.stop();
  await service.start(); await service.stop();
});

/** Real PostgreSQL, isolated tables: the live app cannot claim our test jobs. */
function repositoryTestPool(pool: Pool, schema: string): Pool {
  const scoped = (sql: string) => sql.replaceAll('caja_link.', `${schema}.`);
  return new Proxy(pool, {
    get(target, property) {
      if (property === 'query') return (sql: string, values?: unknown[]) => target.query(scoped(sql), values);
      if (property === 'connect') return async () => {
        const client = await target.connect();
        return new Proxy(client, {
          get(connection, key) {
            if (key === 'query') return (sql: string, values?: unknown[]) => connection.query(scoped(sql), values);
            const value: unknown = Reflect.get(connection, key);
            return typeof value === 'function' ? value.bind(connection) : value;
          },
        });
      };
      const value: unknown = Reflect.get(target, property);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

test('lote_postgres_idempotencia_atomica_leases_orden_propiedad_y_recuperacion', { skip: process.env['TEST_DATABASE'] !== 'true', timeout: 30000 }, async () => {
  const config = loadConfig(process.env, { cajasPath: fileURLToPath(new URL('../../config/cajas.yaml', import.meta.url)) });
  const connection = createPostgresConnection({ ...config.database, max: Math.max(4, config.database.max) });
  const schema = `batch_test_${randomUUID().replaceAll('-', '')}`;
  const pool = repositoryTestPool(connection.pool, schema);
  const ids = new Set<string>();
  try {
    await connection.pool.query(`CREATE SCHEMA ${schema}`);
    const sql = await readFile(new URL('../../src/persistence/migrations/003_batch.sql', import.meta.url), 'utf8');
    await pool.query(sql);
    const repository = createBatchRepository(pool);
    const competitor = createBatchRepository(pool);
    const input = submission(['1234', '5678', '1234']);
    const accepted = await Promise.all(Array.from({ length: 12 }, (_, index) => (index % 2 ? repository : competitor).createOrGet(input)));
    accepted.forEach(result => ids.add(result.jobId)); assert.equal(ids.size, 1);
    const jobId = accepted[0]?.jobId; assert.ok(jobId);
    await assert.rejects(repository.createOrGet(submission(['9012'], input.purpose, input.idempotencyKey)), error => error instanceof AppError && error.statusCode === 409);
    const separate = await competitor.createOrGet(submission(['1234'], input.purpose, input.idempotencyKey, other)); ids.add(separate.jobId);
    assert.equal(await repository.find(jobId, other), null);
    assert.equal(await repository.readResults(jobId, other), null);
    const guard = await pool.connect();
    try {
      await guard.query('BEGIN');
      const claims = await Promise.all([repository.claimPending(), competitor.claimPending()]);
      assert.equal(new Set(claims.map(job => job?.jobId)).size, 2);
      const owning = claims[0]?.jobId === jobId ? repository : competitor;
      const rival = owning === repository ? competitor : repository;
      assert.equal(await rival.recoverInterrupted(), 1); // Releases ONLY the rival's own second job.
      assert.equal((await owning.find(jobId, owner))?.status, 'RUNNING');
      const first: BatchRowResult = { document: normalizeDocument('1234'), requestId: randomUUID(), result: 'NO_AFILIADO', matches: [], unavailable: [] };
      await assert.rejects(rival.saveResults(jobId, [first]), error => error instanceof AppError && error.statusCode === 503);
      await owning.saveResults(jobId, [first]);
      await assert.rejects(owning.complete(jobId), error => error instanceof AppError && error.statusCode === 503);
      await pool.query("UPDATE caja_link.batch_jobs SET lease_until = clock_timestamp() - interval '1 second' WHERE job_id = $1", [jobId]);
      await assert.rejects(owning.saveResults(jobId, [first]), error => error instanceof AppError && error.statusCode === 503);
      await rival.recoverInterrupted();
      // Keep the second test job locked so the expired primary is selected next.
      await guard.query('SELECT job_id FROM caja_link.batch_jobs WHERE job_id = $1 FOR UPDATE', [separate.jobId]);
      assert.equal((await rival.claimPending())?.jobId, jobId);
      const recovered = await rival.readResults(jobId, owner);
      assert.deepEqual(recovered?.results.map(row => row.document), ['1234']);
      await rival.saveResults(jobId, [
        { ...first, document: normalizeDocument('5678'), requestId: randomUUID(), result: 'INDETERMINADO', unavailable: ['ORIENTE'] },
        { ...first, requestId: randomUUID() },
      ]);
      await rival.complete(jobId);
      assert.equal((await rival.readResults(jobId, owner))?.status, 'DONE');
      assert.deepEqual((await rival.readResults(jobId, owner))?.results.map(row => row.document), ['1234', '5678', '1234']);
    } finally { await guard.query('ROLLBACK'); guard.release(); }
  } finally {
    try { await connection.pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); }
    finally { await connection.close(); }
  }
});
