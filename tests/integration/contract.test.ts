import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';
import { before, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../../src/config/index.ts';
import { createPostgresConnection } from '../../src/persistence/connection.ts';
import { assertMinimumData, assertResponse, calendarDate, canonicalMatches, expectedResponse, prepareReference, readCentro, readDocuments, required, setChaos } from '../helpers/public-oracle.ts';
import type { Box, ReferenceSnapshot } from '../helpers/public-oracle.ts';

const base = process.env['TEST_SERVICE_URL'];
const env = process.env;
const purpose = 'VALIDACION_AFILIACION';
const chaosEnabled = env['TEST_ENABLE_CHAOS'] === 'true';
const surEnabled = env['CAJA_SUR_ENABLED'] === 'true';
type Json = Record<string, unknown>;

// All origin mutation lives in this serial suite. No chaos is enabled by default.
describe('contrato_integracion_servicio_real', { skip: !base, concurrency: false, timeout: 180000 }, () => {
  let snapshot: ReferenceSnapshot;
  let documents: string[];
  let negative: string;
  let positive: string;

  async function api(path: string, caja: Box | 'ADMIN' | null = 'CENTRO', init: RequestInit = {}): Promise<{ status: number; body: unknown; elapsedMs: number }> {
    const headers = new Headers(init.headers);
    if (caja) headers.set('authorization', `Bearer ${required(env, `${caja}_TOKEN`)}`);
    const began = performance.now();
    const response = await fetch(new URL(path, base!), { ...init, headers, signal: AbortSignal.timeout(7000) });
    const body: unknown = await response.json();
    return { status: response.status, body, elapsedMs: performance.now() - began };
  }
  async function query(document: string, caja: Box = 'CENTRO', version: 1 | 2 = 1) {
    return api(`/api/v${version}/affiliations/${encodeURIComponent(document)}?purpose=${purpose}`, caja);
  }
  function candidate(predicate: (document: string) => boolean, label: string): string {
    const document = documents.find(predicate);
    assert.ok(document, `Falta un caso público ${label}; ampliar TEST_DOCUMENTS o TEST_REFERENCE_SAMPLE_SIZE`);
    return document;
  }
  async function submit(csv: string, key: string, caja: Box = 'CENTRO', suffix = '') {
    return api(`/api/v1/batch-checks${suffix}`, caja, { method: 'POST', headers: { 'content-type': 'text/csv', 'idempotency-key': key }, body: csv });
  }
  function jobId(response: { status: number; body: unknown }): string {
    assert.equal(response.status, 202);
    const body = response.body as Json;
    assert.deepEqual(Object.keys(body), ['jobId']);
    assert.match(body['jobId'] as string, /^[0-9a-f-]{36}$/iu);
    return body['jobId'] as string;
  }
  async function completed(id: string, caja: Box = 'CENTRO'): Promise<Json> {
    const began = performance.now();
    while (performance.now() - began < 45000) {
      const response = await api(`/api/v1/batch-checks/${id}`, caja);
      assert.equal(response.status, 200);
      const body = response.body as Json;
      assert.deepEqual(Object.keys(body).sort(), ['results', 'status']);
      assert.ok(['PENDING', 'RUNNING', 'DONE'].includes(body['status'] as string));
      assert.ok(Array.isArray(body['results']));
      if (body['status'] === 'DONE') return body;
      await delay(100);
    }
    assert.fail('El lote pequeño no terminó en 45 segundos');
  }
  function assertRows(body: Json, expectedDocuments: readonly string[], caja: Box = 'CENTRO'): void {
    const rows = body['results'] as unknown[];
    assert.equal(rows.length, expectedDocuments.length);
    rows.forEach((row, index) => assertResponse(row, expectedResponse(snapshot, expectedDocuments[index]!, caja), 1, expectedDocuments[index]!));
    assertMinimumData(body);
  }

  before(async () => {
    const health = await api('/ready', null);
    assert.equal(health.status, 200, 'El servicio debe estar integrado y ready antes de estas pruebas');
    const { documents: input } = await readDocuments();
    const centro = await readCentro(env);
    const sampleSize = Number(env['TEST_REFERENCE_SAMPLE_SIZE'] ?? '128');
    assert.ok(Number.isInteger(sampleSize) && sampleSize >= 1 && sampleSize <= 10000);
    documents = [...new Set([...input.slice(0, sampleSize), ...[...centro.matches.keys()].slice(0, 32), ...(env['TEST_DOCUMENTS']?.split(',').filter(Boolean) ?? [])])];
    snapshot = await prepareReference(documents, env);
    documents = [...snapshot.matches.keys()];
    assert.equal(calendarDate(), snapshot.asOf, 'Repetir la referencia si cambió el día en Colombia');
    negative = candidate(document => expectedResponse(snapshot, document, 'CENTRO').result === 'NO_AFILIADO', 'sin afiliación en otras cajas');
    positive = candidate(document => expectedResponse(snapshot, document, 'CENTRO').result === 'AFILIADO_OTRA_CAJA', 'con afiliación vigente');
  });

  test('integracion_autenticacion_401_en_consultas_lotes_y_auditoria', async () => {
    const invalid = randomBytes(24).toString('hex');
    for (const path of [`/api/v1/affiliations/${negative}`, `/api/v2/affiliations/${negative}`, '/api/v1/audit', `/api/v1/batch-checks/${randomUUID()}`]) {
      for (const headers of [{}, { authorization: `Bearer ${invalid}` }]) {
        const response = await api(path, null, { headers });
        assert.equal(response.status, 401);
        assert.deepEqual(Object.keys(response.body as Json).sort(), ['error', 'requestId']);
        assertMinimumData(response.body);
      }
    }
    assert.equal((await api('/api/v1/batch-checks', null, { method: 'POST', headers: { 'content-type': 'text/csv' }, body: 'invalid' })).status, 401);
    assert.equal((await api(`/api/v1/affiliations/${negative}?purpose=${purpose}`, 'ADMIN')).status, 403);
  });

  test('integracion_finalidad_400_y_tres_finalidades_permitidas', async () => {
    for (const version of [1, 2]) {
      for (const suffix of ['', '?purpose=', '?purpose=INVALIDA']) assert.equal((await api(`/api/v${version}/affiliations/${negative}${suffix}`)).status, 400);
    }
    for (const allowed of ['VALIDACION_AFILIACION', 'TARIFA_SUBSIDIADA', 'SUBSIDIO_MONETARIO']) assert.equal((await api(`/api/v1/affiliations/${negative}?purpose=${allowed}`)).status, 200);
  });

  test('integracion_resultados_positivos_negativos_y_dobles_con_referencia_publica', async () => {
    const double = candidate(document => new Set(snapshot.matches.get(document)!.filter(match => match.caja !== 'SUR').map(match => match.caja)).size >= 2, 'de doble afiliación fuera de Sur');
    for (const document of [positive, negative, double]) {
      const response = await query(document);
      assert.equal(response.status, 200);
      assertResponse(response.body, expectedResponse(snapshot, document, 'CENTRO'));
    }
    const doubleResponse = await query(double, 'SUR');
    assert.equal(doubleResponse.status, 200);
    assertResponse(doubleResponse.body, expectedResponse(snapshot, double, 'SUR'));
    assert.ok(new Set(((doubleResponse.body as Json)['matches'] as Json[]).map(match => match['caja'])).size >= 2, 'La consulta conserva las dos cajas de la doble afiliación');
  });

  test('integracion_normalizacion_puntos_espacios_y_ceros', async () => {
    for (const variant of [positive, `000${positive}`, positive.split('').join('.'), ` ${positive.slice(0, 3)} ${positive.slice(3)} `]) {
      const response = await query(variant);
      assert.equal(response.status, 200);
      assertResponse(response.body, expectedResponse(snapshot, positive, 'CENTRO'));
    }
  });

  test('integracion_exclusion_de_cada_caja_consumidora', async () => {
    for (const caja of snapshot.enabled) {
      const document = candidate(value => snapshot.matches.get(value)!.some(match => match.caja === caja), `afiliado de ${caja}`);
      const response = await query(document, caja);
      assert.equal(response.status, 200);
      assertResponse(response.body, expectedResponse(snapshot, document, caja));
      assert.ok(!((response.body as Json)['matches'] as Json[]).some(match => match['caja'] === caja));
      assert.ok(!((response.body as Json)['unavailable'] as unknown[]).includes(caja));
    }
  });

  test('integracion_dato_minimo_y_contrato_v1_v2', async () => {
    const v1 = await query(positive);
    const v2 = await query(positive, 'CENTRO', 2);
    assert.equal(v1.status, 200);
    assert.equal(v2.status, 200);
    assertResponse(v1.body, expectedResponse(snapshot, positive, 'CENTRO'));
    assertResponse(v2.body, expectedResponse(snapshot, positive, 'CENTRO', 2), 2);
    assertMinimumData(v1.body);
    assertMinimumData(v2.body);
    const projection = ((v2.body as Json)['matches'] as Json[]).map(({ affiliateType: _type, ...match }) => match);
    assert.deepEqual(canonicalMatches(projection), canonicalMatches((v1.body as Json)['matches']));
  });

  test('integracion_centro_fuente_file_y_fecha_corte_publicada', async () => {
    const document = candidate(value => snapshot.matches.get(value)!.some(match => match.caja === 'CENTRO'), 'vigente en el archivo de Centro');
    const response = await query(document, 'NORTE');
    assert.equal(response.status, 200);
    assertResponse(response.body, expectedResponse(snapshot, document, 'NORTE'));
    const matches = ((response.body as Json)['matches'] as Json[]).filter(match => match['caja'] === 'CENTRO');
    assert.ok(matches.length > 0);
    matches.forEach(match => { assert.equal(match['source'], 'FILE'); assert.equal(match['asOf'], snapshot.centroAsOf); });
  });

  test('integracion_auditoria_solo_admin_y_trazabilidad_enmascarada', async () => {
    assert.equal((await api('/api/v1/audit', 'CENTRO')).status, 403);
    const started = Date.now();
    const response = await query(positive);
    assert.equal(response.status, 200);
    const audit = await api('/api/v1/audit?limit=1000', 'ADMIN');
    assert.equal(audit.status, 200);
    assert.ok(Array.isArray(audit.body));
    assertMinimumData(audit.body);
    const visible = Math.min(4, Math.max(0, positive.length - 1));
    const masked = '*'.repeat(positive.length - visible) + (visible ? positive.slice(-visible) : '');
    const entries = audit.body as Json[];
    assert.ok(entries.some(entry => entry['requestingCaja'] === 'CENTRO' && entry['purpose'] === purpose && entry['result'] === (response.body as Json)['result'] && entry['documentMasked'] === masked && Date.parse(entry['timestamp'] as string) >= started - 1000));
    for (const entry of entries) {
      assert.deepEqual(Object.keys(entry).sort(), ['documentMasked', 'purpose', 'requestingCaja', 'result', 'timestamp']);
      assert.match(entry['documentMasked'] as string, /^\*+[0-9]{0,4}$/u);
    }
    assert.ok(!JSON.stringify(entries).includes(positive));
    assert.equal((await api('/api/v1/audit?limit=0', 'ADMIN')).status, 400);
  });

  test('integracion_csv_validacion_y_finalidad_de_lote', async () => {
    const headers = { 'content-type': 'text/csv' };
    assert.equal((await api('/api/v1/batch-checks', 'CENTRO', { method: 'POST', headers, body: `document\n${negative}\n` })).status, 400);
    for (const csv of ['otra\n123\n', 'document\nINVALIDO\n', 'document\n', 'document\n"sin cierre']) assert.equal((await submit(csv, randomUUID())).status, 400);
    assert.equal((await submit(`document\n${negative}\n`, randomUUID(), 'CENTRO', '?purpose=INVALIDA')).status, 400);
    assert.equal((await submit(`document\n${negative}\n`, randomUUID(), 'CENTRO', '?purpose=TARIFA_SUBSIDIADA')).status, 202);
  });

  test('integracion_lote_orden_duplicados_y_resultados_exactos', async () => {
    const input = [positive, negative, positive];
    const csv = `document\n000${positive}\n ${negative} \n${positive}\n`;
    const id = jobId(await submit(csv, randomUUID()));
    assertRows(await completed(id), input);
    const again = await api(`/api/v1/batch-checks/${id}`);
    assert.equal(again.status, 200);
    assertRows(again.body as Json, input);
  });

  test('integracion_multipart_campo_file', async () => {
    const form = new FormData();
    form.append('file', new Blob([`document\n${positive}\n${negative}\n`], { type: 'text/csv' }), 'independiente.csv');
    const id = jobId(await api('/api/v1/batch-checks', 'CENTRO', { method: 'POST', headers: { 'idempotency-key': randomUUID() }, body: form }));
    assertRows(await completed(id), [positive, negative]);
  });

  test('integracion_idempotencia_simultanea_conflicto_y_aislamiento_por_caja', async () => {
    const key = randomUUID();
    const csv = `document\n${positive}\n${negative}\n`;
    const responses = await Promise.all(Array.from({ length: 5 }, () => submit(csv, key)));
    const ids = responses.map(jobId);
    assert.equal(new Set(ids).size, 1);
    const id = ids[0]!;
    assert.equal(jobId(await submit(csv, key)), id);
    assert.equal((await submit(`document\n${negative}\n`, key)).status, 409);
    assert.equal((await submit(csv, key, 'CENTRO', '?purpose=SUBSIDIO_MONETARIO')).status, 409);
    assert.equal((await api(`/api/v1/batch-checks/${id}`, 'NORTE')).status, 404);
    assert.equal((await api(`/api/v1/batch-checks/${id}`, 'ADMIN')).status, 403);
    const otherId = jobId(await submit(csv, key, 'NORTE'));
    assert.notEqual(otherId, id);
    assertRows(await completed(id), [positive, negative]);
    assertRows(await completed(otherId, 'NORTE'), [positive, negative], 'NORTE');
  });

  test('integracion_lote_persistido_en_postgres_propio', { skip: env['TEST_DATABASE'] !== 'true' }, async () => {
    const config = loadConfig(env, { cajasPath: fileURLToPath(new URL('../../config/cajas.yaml', import.meta.url)) });
    const connection = createPostgresConnection(config.database);
    const id = jobId(await submit(`document\n${negative}\n`, randomUUID()));
    const finished = await completed(id);
    try {
      const row = await connection.pool.query<{ status: string; requesting_caja: string }>('SELECT status, requesting_caja FROM caja_link.batch_jobs WHERE job_id = $1', [id]);
      assert.equal(row.rows.length, 1);
      assert.equal(row.rows[0]?.status, 'DONE');
      assert.equal(row.rows[0]?.requesting_caja, 'CENTRO');
      const result = await connection.pool.query<{ count: string }>('SELECT count(*)::text AS count FROM caja_link.batch_results WHERE job_id = $1', [id]);
      assert.equal(Number(result.rows[0]?.count), 1);
    } finally { await connection.close(); }
    // A new HTTP request rereads the persisted DONE job. Restart recovery belongs to the coordinated turn.
    assert.deepEqual((await api(`/api/v1/batch-checks/${id}`)).body, finished);
  });

  test('integracion_sur_activa_por_configuracion_y_contrato_v2', { skip: !surEnabled }, async () => {
    const document = candidate(value => snapshot.matches.get(value)!.some(match => match.caja === 'SUR'), 'vigente en Sur');
    const response = await query(document, 'CENTRO', 2);
    assert.equal(response.status, 200);
    assertResponse(response.body, expectedResponse(snapshot, document, 'CENTRO', 2), 2);
    assert.ok(((response.body as Json)['matches'] as Json[]).some(match => match['caja'] === 'SUR'));
  });

  for (const caja of ['NORTE', 'ORIENTE', 'SUR'] as const) {
    test(`integracion_caos_${caja}_caida_lentitud_y_recuperacion`, { skip: !chaosEnabled || (caja === 'SUR' && !surEnabled), timeout: 30000 }, async () => {
      try {
        await setChaos(env, caja, 'down');
        const unavailable = await query(negative);
        assert.equal(unavailable.status, 200);
        assertResponse(unavailable.body, expectedResponse(snapshot, negative, 'CENTRO', 1, [caja]));
        assert.equal((unavailable.body as Json)['result'], 'INDETERMINADO');
        const mixedDocument = candidate(value => expectedResponse(snapshot, value, 'CENTRO', 1, [caja]).matches.length > 0, `con coincidencia fuera de ${caja}`);
        const mixed = await query(mixedDocument);
        assert.equal(mixed.status, 200);
        assertResponse(mixed.body, expectedResponse(snapshot, mixedDocument, 'CENTRO', 1, [caja]));
        await setChaos(env, caja, 'slow');
        const slow = await query(negative);
        assert.equal(slow.status, 200);
        assert.ok(slow.elapsedMs < 5000, 'La respuesta completa llega antes de cinco segundos');
        assertResponse(slow.body, expectedResponse(snapshot, negative, 'CENTRO', 1, [caja]));
      } finally { await setChaos(env, caja, 'ok'); }
      const recovered = await query(negative);
      assert.equal(recovered.status, 200);
      assertResponse(recovered.body, expectedResponse(snapshot, negative, 'CENTRO'));
      const own = candidate(value => snapshot.matches.get(value)!.some(match => match.caja === caja), `vigente en ${caja}`);
      const restored = await query(own);
      assert.equal(restored.status, 200);
      assertResponse(restored.body, expectedResponse(snapshot, own, 'CENTRO'));
    });
  }
});
