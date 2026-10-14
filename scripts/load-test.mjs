#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { assertMinimumData, assertResponse, calendarDate, expectedResponse, prepareReference, readDocuments, required } from '../tests/helpers/public-oracle.ts';

/** Run only in the coordinated performance turn, with all origins in mode ok.
 * docker compose --profile test run --rm tests node scripts/load-test.mjs
 * Node 24 executes the independent TypeScript reference helper without a loader.
 * Input: the real data/lote_10000.csv. No reading of mocks or internal datasets.
 * The clock starts immediately before POST and stops after the DONE body is read.
 * Reference preparation and result comparison are measured separately.
 */
const env = process.env;
const args = process.argv.slice(2);
function option(name, fallback) {
  const index = args.indexOf(name);
  if (index === -1) return fallback;
  if (!args[index + 1] || args[index + 1].startsWith('--')) throw new Error(`Falta valor de ${name}`);
  return args[index + 1];
}
const output = resolve(option('--output', 'test-results/load-test.json'));
const csvPath = resolve(option('--csv', fileURLToPath(new URL('../data/lote_10000.csv', import.meta.url))));
const consumer = option('--consumer', 'CENTRO');
const referenceConcurrency = Number(option('--reference-concurrency', '16'));
let began;
let metrics;

async function run() {
  if (!['NORTE', 'ORIENTE', 'CENTRO', 'SUR'].includes(consumer)) throw new Error('Caja consumidora inválida');
  if (!process.version.startsWith('v24.')) throw new Error('La carga debe ejecutarse con Node.js 24');
  for (let index = 0; index < args.length; index += 2) {
    if (!['--output', '--csv', '--consumer', '--reference-concurrency'].includes(args[index]) || !args[index + 1] || args[index + 1].startsWith('--')) throw new Error('Opción de carga inválida');
  }
  const base = required(env, 'TEST_SERVICE_URL');
  const token = required(env, `${consumer}_TOKEN`);
  const input = await readDocuments(csvPath);
  if (input.documents.length !== 10000) throw new Error('La carga exige exactamente 10000 filas de documentos');
  const preparing = performance.now();
  process.stdout.write('Preparando referencia independiente mediante interfaces públicas; cronómetro de carga pendiente.\n');
  const reference = await prepareReference(input.documents, env, { concurrency: referenceConcurrency });
  if (calendarDate() !== reference.asOf) throw new Error('Cambió el día de consulta durante la preparación; repetir la referencia');
  const preparationSeconds = (performance.now() - preparing) / 1000;
  metrics = {
    herramienta: 'Node.js 24 fetch + referencia independiente de interfaces públicas',
    runtime: process.version, csv_sha256: createHash('sha256').update(input.csv).digest('hex'),
    documentos: input.documents.length, documentos_unicos: new Set(input.documents).size,
    duracion_segundos: null, errores: null, filas_recibidas: 0, filas_verificadas: 0,
    filas_erroneas: 0, errores_http: 0, consultas_durante_lote: 0, consulta_max_ms: 0,
    preparacion_segundos: preparationSeconds, verificacion_segundos: null,
    caja_consumidora: consumer, cajas_habilitadas: reference.enabled,
    fecha_corte: reference.asOf, centro_asOf: reference.centroAsOf,
    inicio_utc: new Date().toISOString(), final_utc: null,
    estado: 'NO_COMPLETADO', aprobada: false,
  };
  async function request(path, init = {}) {
    const remaining = 300000 - (performance.now() - began);
    if (remaining <= 0) throw new Error('Límite de 300 segundos agotado');
    const headers = new Headers(init.headers);
    headers.set('authorization', `Bearer ${token}`);
    const response = await fetch(new URL(path, base), { ...init, headers, signal: AbortSignal.timeout(Math.max(1, Math.floor(Math.min(7000, remaining)))) });
    const body = await response.json();
    return { status: response.status, body };
  }
  const key = randomUUID();
  began = performance.now();
  const accepted = await request('/api/v1/batch-checks', { method: 'POST', headers: { 'content-type': 'text/csv', 'idempotency-key': key }, body: input.csv });
  if (accepted.status !== 202 || typeof accepted.body?.jobId !== 'string' || Object.keys(accepted.body).sort().join(',') !== 'jobId') {
    metrics.errores_http += 1;
    throw new Error('El servicio no aceptó el lote real con 202 y jobId');
  }
  metrics.jobId = accepted.body.jobId;
  let final;
  let polls = 0;
  while (performance.now() - began < 300000) {
    const response = await request(`/api/v1/batch-checks/${encodeURIComponent(metrics.jobId)}`);
    if (response.status !== 200 || !['PENDING', 'RUNNING', 'DONE'].includes(response.body?.status) || !Array.isArray(response.body?.results)) {
      metrics.errores_http += 1;
      throw new Error('Estado de lote inválido');
    }
    metrics.estado = response.body.status;
    if (response.body.status === 'DONE') { final = response.body; break; }
    // Reserve a real individual query while the batch is running; check its content too.
    if (polls++ % 5 === 0) {
      const probeStart = performance.now();
      const probe = await request(`/api/v1/affiliations/${input.documents[0]}?purpose=VALIDACION_AFILIACION`);
      const probeMs = performance.now() - probeStart;
      metrics.consultas_durante_lote += 1;
      metrics.consulta_max_ms = Math.max(metrics.consulta_max_ms, probeMs);
      try {
        if (probe.status !== 200 || probeMs >= 5000) throw new Error('Consulta individual no disponible');
        assertResponse(probe.body, expectedResponse(reference, input.documents[0], consumer));
      } catch { metrics.errores_http += 1; }
    }
    await delay(250);
  }
  metrics.duracion_segundos = (performance.now() - began) / 1000;
  metrics.final_utc = new Date().toISOString();
  if (!final) throw new Error('El lote no llegó a DONE antes del límite');
  metrics.filas_recibidas = final.results.length;
  const verification = performance.now();
  for (let index = 0; index < input.documents.length; index += 1) {
    const document = input.documents[index];
    try {
      assertResponse(final.results[index], expectedResponse(reference, document, consumer), 1, document);
      assertMinimumData(final.results[index]);
    } catch { metrics.filas_erroneas += 1; }
    metrics.filas_verificadas += 1;
  }
  if (final.results.length > input.documents.length) metrics.filas_erroneas += final.results.length - input.documents.length;
  try {
    if (Object.keys(final).sort().join(',') !== 'results,status') throw new Error('Campos inesperados en la respuesta de lote');
    assertMinimumData(final);
  } catch { metrics.errores_http += 1; }
  metrics.verificacion_segundos = (performance.now() - verification) / 1000;
  metrics.errores = metrics.filas_erroneas + metrics.errores_http;
  metrics.aprobada = metrics.estado === 'DONE' && metrics.filas_recibidas === 10000 && metrics.filas_verificadas === 10000 && metrics.errores === 0 && metrics.duracion_segundos < 300;
  if (!metrics.aprobada) process.exitCode = 1;
}

try { await run(); }
catch {
  process.exitCode = 1;
  process.stderr.write(began === undefined ? 'La preparación falló; no se ejecutó ni midió la carga. Revise CSV, variables y orígenes en modo ok.\n' : 'La carga falló o excedió su límite; consulte las mediciones parciales.\n');
  if (metrics && began !== undefined) {
    metrics.duracion_segundos ??= (performance.now() - began) / 1000;
    metrics.final_utc ??= new Date().toISOString();
    metrics.errores = Math.max(1, metrics.filas_erroneas + metrics.errores_http);
    metrics.aprobada = false;
  }
}
if (metrics && began !== undefined) {
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(metrics, null, 2)}\n`, 'utf8');
  process.stdout.write(`${JSON.stringify(metrics, null, 2)}\n`);
}
