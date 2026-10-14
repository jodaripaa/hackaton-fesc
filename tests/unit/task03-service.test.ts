import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import test from 'node:test';
import { createAffiliationService } from '../../src/application/affiliations.ts';
import { AppError } from '../../src/domain/errors.ts';
import { normalizeDocument } from '../../src/domain/normalization.ts';
import type { AdapterContext, AdapterResult, AffiliationQuery, AuditRecord, AuditRepository, CajaAdapter, CajaId, NormalizedAffiliation } from '../../src/domain/types.ts';

const queryOptions = { totalTimeoutMs: 500, originTimeoutMs: 100, concurrency: 2, originConcurrency: 1 };
const match = (caja: CajaId, changes: Partial<NormalizedAffiliation> = {}): NormalizedAffiliation => ({ caja, validFrom: '2026-01-01', validTo: null, source: 'ONLINE', asOf: '2026-10-14', affiliateType: 'DEPENDIENTE', ...changes });
const input = (changes: Partial<AffiliationQuery> = {}): AffiliationQuery => ({ document: normalizeDocument('1234567890'), identity: { kind: 'consumer', caja: 'CENTRO' }, purpose: 'VALIDACION_AFILIACION', requestId: 'synthetic-query', asOf: '2026-10-14', signal: new AbortController().signal, ...changes });
const adapter = (caja: CajaId, affiliations: readonly NormalizedAffiliation[] = []): CajaAdapter => ({ caja, lookup: async () => ({ status: 'ok', caja, affiliations }) });
function dependencies(adapters: readonly CajaAdapter[]) {
  const records: AuditRecord[] = [];
  const audit: AuditRepository = { append: async record => { records.push(record); }, list: async () => records };
  return { options: { adapters, query: queryOptions, audit }, records };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

test('consulta_excluye_consumidor_antes_de_llamar_y_audita_documento_minimo', async () => {
  const centre: CajaAdapter = { caja: 'CENTRO', lookup: async () => { assert.fail('Consumer must not be queried'); } };
  const { options, records } = dependencies([adapter('NORTE'), adapter('ORIENTE'), centre]);
  const response = await createAffiliationService(options).query(input());
  assert.deepEqual(response, { requestId: 'synthetic-query', result: 'NO_AFILIADO', matches: [], unavailable: [] });
  assert.equal(records.length, 1);
  assert.equal(records[0]?.requestingCaja, 'CENTRO');
  assert.equal(records[0]?.purpose, 'VALIDACION_AFILIACION');
  assert.equal(records[0]?.result, 'NO_AFILIADO');
  assert.equal(records[0]?.documentMasked, '******7890');
  assert.ok(!JSON.stringify(records).includes('1234567890'));
});

test('consulta_origen_original_ausente_impide_falso_no_afiliado', async () => {
  const { options } = dependencies([adapter('NORTE')]);
  const response = await createAffiliationService(options).query(input());
  assert.equal(response.result, 'INDETERMINADO');
  assert.deepEqual(response.unavailable, ['ORIENTE']);
});

test('consulta_sur_requerida_ausente_y_sur_presente_por_configuracion', async () => {
  const { options } = dependencies([adapter('NORTE'), adapter('ORIENTE'), adapter('CENTRO')]);
  const requiredCajas: readonly CajaId[] = ['NORTE', 'ORIENTE', 'CENTRO', 'SUR'];
  const incomplete = await createAffiliationService({ ...options, requiredCajas }).query(input());
  assert.equal(incomplete.result, 'INDETERMINADO');
  assert.deepEqual(incomplete.unavailable, ['SUR']);
  const complete = await createAffiliationService({ ...options, adapters: [...options.adapters, adapter('SUR', [match('SUR', { affiliateType: 'INDEPENDIENTE' })])], requiredCajas }).query(input());
  assert.equal(complete.result, 'AFILIADO_OTRA_CAJA');
  assert.deepEqual(complete.matches, [match('SUR', { affiliateType: 'INDEPENDIENTE' })]);
  assert.deepEqual(complete.unavailable, []);
});

test('consulta_coincidencia_prevalece_y_conserva_unavailable', async () => {
  const failing: CajaAdapter = { caja: 'ORIENTE', lookup: async () => { throw new Error('Synthetic unavailable'); } };
  const { options } = dependencies([adapter('NORTE', [match('NORTE')]), failing, adapter('CENTRO')]);
  const response = await createAffiliationService(options).query(input());
  assert.equal(response.result, 'AFILIADO_OTRA_CAJA');
  assert.deepEqual(response.matches, [match('NORTE')]);
  assert.deepEqual(response.unavailable, ['ORIENTE']);
});

test('consulta_dobles_afiliaciones_vigencia_y_fuente_de_archivo', async () => {
  const file = match('CENTRO', { source: 'FILE', asOf: '2026-10-03', affiliateType: 'PENSIONADO' });
  const current = match('ORIENTE', { validTo: '2026-10-14' });
  const { options } = dependencies([adapter('NORTE'), adapter('ORIENTE', [current, current, match('ORIENTE', { validFrom: '2026-10-15' }), match('ORIENTE', { validTo: '2026-10-13' })]), adapter('CENTRO', [file])]);
  const response = await createAffiliationService(options).query(input({ identity: { kind: 'consumer', caja: 'NORTE' } }));
  assert.equal(response.result, 'AFILIADO_OTRA_CAJA');
  assert.deepEqual(response.matches, [file, current]);
  assert.deepEqual(response.unavailable, []);
});

test('consulta_respuesta_invalida_o_de_otra_caja_es_indisponibilidad', async () => {
  const badResults: readonly AdapterResult[] = [
    { status: 'ok', caja: 'SUR', affiliations: [] },
    { status: 'ok', caja: 'NORTE', affiliations: [match('ORIENTE')] },
    { status: 'ok', caja: 'NORTE', affiliations: [match('NORTE', { validFrom: '2026-02-29' })] },
    { status: 'ok', caja: 'NORTE', affiliations: [match('NORTE', { affiliateType: 'INVALID' as NormalizedAffiliation['affiliateType'] })] },
    { status: 'ok', caja: 'NORTE', affiliations: null } as unknown as AdapterResult,
    null as unknown as AdapterResult,
  ];
  for (const bad of badResults) {
    const { options } = dependencies([{ caja: 'NORTE', lookup: async () => bad }, adapter('ORIENTE'), adapter('CENTRO')]);
    const response = await createAffiliationService(options).query(input());
    assert.equal(response.result, 'INDETERMINADO');
    assert.deepEqual(response.unavailable, ['NORTE']);
  }
});

test('consulta_elimina_campos_personales_y_fija_corte_online', async () => {
  const dirty = { ...match('NORTE', { asOf: '2026-01-01' }), nombre: 'synthetic-personal-field', correo: 'synthetic-personal-field' };
  const { options } = dependencies([adapter('NORTE', [dirty]), adapter('ORIENTE'), adapter('CENTRO')]);
  const response = await createAffiliationService(options).query(input());
  assert.deepEqual(response.matches, [match('NORTE')]);
  assert.ok(!JSON.stringify(response).includes('synthetic-personal-field'));
});

test('consulta_paralela_aplica_timeout_por_origen_y_cancela_dependencia', async () => {
  let observed: AdapterContext | undefined;
  const hanging: CajaAdapter = { caja: 'ORIENTE', lookup: async (_document, context) => { observed = context; return new Promise(() => {}); } };
  const { options } = dependencies([adapter('NORTE', [match('NORTE')]), hanging, adapter('CENTRO')]);
  const started = performance.now();
  const response = await createAffiliationService(options).query(input());
  assert.ok(performance.now() - started < 350, 'Origin timeout must not consume the total query budget');
  assert.equal(response.result, 'AFILIADO_OTRA_CAJA');
  assert.deepEqual(response.unavailable, ['ORIENTE']);
  assert.equal(observed?.signal.aborted, true);
  assert.ok(observed && observed.deadlineAt <= Date.now());
});

test('consulta_inicia_todos_los_origenes_en_paralelo_con_corte_compartido', async () => {
  const allStarted = deferred<void>();
  const contexts: AdapterContext[] = [];
  const cajas: readonly CajaId[] = ['NORTE', 'ORIENTE', 'CENTRO'];
  const adapters = cajas.map(caja => ({ caja, lookup: async (_document: unknown, context: AdapterContext): Promise<AdapterResult> => {
    contexts.push(context);
    if (contexts.length === cajas.length) allStarted.resolve();
    await allStarted.promise;
    return { status: 'ok', caja, affiliations: [match(caja)] };
  } }));
  const { options } = dependencies(adapters);
  const response = await createAffiliationService(options).query(input({ identity: { kind: 'consumer', caja: 'SUR' } }));
  assert.equal(response.result, 'AFILIADO_OTRA_CAJA');
  assert.equal(response.matches.length, 3);
  assert.deepEqual(response.unavailable, []);
  assert.equal(new Set(contexts.map(context => context.deadlineAt)).size, 1);
  for (const context of contexts) {
    assert.equal(context.asOf, '2026-10-14');
    assert.equal(context.requestId, 'synthetic-query');
  }
});

test('consulta_origen_recuperado_se_consulta_de_nuevo_sin_cache_de_ausencia', async () => {
  let up = false;
  const recovering: CajaAdapter = { caja: 'ORIENTE', lookup: async () => up ? { status: 'ok', caja: 'ORIENTE', affiliations: [] } : { status: 'unavailable', caja: 'ORIENTE', reason: 'UNAVAILABLE' } };
  const { options } = dependencies([adapter('NORTE'), recovering, adapter('CENTRO')]);
  const service = createAffiliationService(options);
  assert.equal((await service.query(input())).result, 'INDETERMINADO');
  up = true;
  assert.equal((await service.query(input())).result, 'NO_AFILIADO');
  up = false;
  assert.equal((await service.query(input())).result, 'INDETERMINADO');
});

test('consulta_concurrencia_por_origen_incluye_cola_y_no_arranca_trabajo_cancelado', async () => {
  let calls = 0;
  const started = deferred<void>();
  const release = deferred<AdapterResult>();
  const slow: CajaAdapter = { caja: 'NORTE', lookup: async () => { calls += 1; started.resolve(); return release.promise; } };
  const { options } = dependencies([slow, adapter('ORIENTE'), adapter('CENTRO')]);
  const service = createAffiliationService(options);
  const first = service.query(input());
  await started.promise;
  const second = service.query(input({ requestId: 'synthetic-second' }));
  const responses = await Promise.all([first, second]);
  assert.equal(calls, 1, 'An origin must not exceed its in-flight concurrency');
  for (const response of responses) {
    assert.equal(response.result, 'INDETERMINADO');
    assert.deepEqual(response.unavailable, ['NORTE']);
  }
  release.resolve({ status: 'ok', caja: 'NORTE', affiliations: [] });
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(calls, 1, 'A cancelled queued lookup must never execute after recovery');
  assert.equal((await service.query(input())).result, 'NO_AFILIADO');
  assert.equal(calls, 2, 'A settled origin must be queried again after recovery');
});

test('consulta_presupuesto_total_incluye_auditoria_y_concurrencia_global', async () => {
  const started = deferred<void>();
  const release = deferred<void>();
  let auditCalls = 0;
  const { options } = dependencies([adapter('NORTE'), adapter('ORIENTE'), adapter('CENTRO')]);
  const service = createAffiliationService({ ...options, query: { ...queryOptions, totalTimeoutMs: 160, originTimeoutMs: 60, concurrency: 1 }, audit: { list: async () => [], append: async () => { auditCalls += 1; started.resolve(); await release.promise; } } });
  const began = performance.now();
  const first = service.query(input());
  const firstRejection = assert.rejects(first, error => error instanceof AppError && error.statusCode === 503 && error.code === 'UNAVAILABLE');
  await started.promise;
  const secondRejection = assert.rejects(service.query(input({ requestId: 'synthetic-second' })), error => error instanceof AppError && error.statusCode === 503);
  await Promise.all([firstRejection, secondRejection]);
  assert.ok(performance.now() - began < 500, 'A pending audit must not extend the total budget');
  assert.equal(auditCalls, 1, 'Query concurrency must include pending audit work');
  release.resolve();
});

test('consulta_auditoria_fallida_no_devuelve_resultado_exitoso', async () => {
  const { options } = dependencies([adapter('NORTE'), adapter('ORIENTE'), adapter('CENTRO')]);
  const service = createAffiliationService({ ...options, audit: { list: async () => [], append: async () => { throw new Error('Synthetic persistence failure'); } } });
  await assert.rejects(service.query(input()), error => error instanceof AppError && error.statusCode === 503 && error.code === 'UNAVAILABLE');
});

test('consulta_cancelada_no_llama_origenes_ni_auditoria', async () => {
  let called = false;
  const { options, records } = dependencies([{ caja: 'NORTE', lookup: async () => { called = true; return { status: 'ok', caja: 'NORTE', affiliations: [] }; } }, adapter('ORIENTE'), adapter('CENTRO')]);
  await assert.rejects(createAffiliationService(options).query(input({ signal: AbortSignal.abort() })), error => error instanceof AppError && error.statusCode === 503);
  assert.equal(called, false);
  assert.equal(records.length, 0);
});

test('consulta_cancelacion_del_consumidor_se_propaga_en_vuelo_sin_auditar', async () => {
  const entered = deferred<AdapterContext>();
  const controller = new AbortController();
  const { options, records } = dependencies([{ caja: 'NORTE', lookup: async (_document, context) => { entered.resolve(context); return new Promise(() => {}); } }, adapter('ORIENTE'), adapter('CENTRO')]);
  const pending = createAffiliationService(options).query(input({ signal: controller.signal }));
  const rejection = assert.rejects(pending, error => error instanceof AppError && error.statusCode === 503);
  const context = await entered.promise;
  controller.abort();
  await rejection;
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(context.signal.aborted, true);
  assert.equal(records.length, 0);
});

test('consulta_rechaza_adaptadores_duplicados', () => {
  const { options } = dependencies([adapter('NORTE'), adapter('NORTE')]);
  assert.throws(() => createAffiliationService(options));
});
