import assert from 'node:assert/strict';
import test from 'node:test';
import { isCurrentAffiliation, isDateOnly, queryDate } from '../../src/domain/affiliation.ts';
import { Semaphore, abortable } from '../../src/domain/concurrency.ts';
import { AppError } from '../../src/domain/errors.ts';
import { normalizeDocument } from '../../src/domain/normalization.ts';
import type { NormalizedAffiliation } from '../../src/domain/types.ts';

test('consulta_normaliza_puntos_espacios_y_relleno_sin_coercion', () => {
  for (const value of ['1234567890', '001.234.567.890', ' 00 123 456 7890 ', '\t001234567890\n']) {
    assert.equal(normalizeDocument(value), '1234567890');
  }
  assert.equal(normalizeDocument('999999999999'), '999999999999');
  assert.equal(normalizeDocument('000'), '0');
  for (const value of ['', ' . \t ', '12-34', '+123', '1e3', '１２３', '1234567890123', '0'.repeat(65), null, 123, { toString: () => '123' }]) {
    assert.throws(() => normalizeDocument(value), error => error instanceof AppError && error.statusCode === 400 && error.code === 'INVALID_REQUEST');
  }
});

test('consulta_valida_calendario_y_corte_colombiano_en_cambio_de_dia', () => {
  assert.equal(isDateOnly('2024-02-29'), true);
  for (const date of ['2026-02-29', '2026-04-31', '2026-13-01', '2026-1-01', '2026-01-01T00:00:00Z', null]) {
    assert.equal(isDateOnly(date), false);
  }
  assert.equal(queryDate(new Date('2026-10-15T04:59:59.999Z')), '2026-10-14');
  assert.equal(queryDate(new Date('2026-10-15T05:00:00.000Z')), '2026-10-15');
});

test('consulta_vigencia_incluye_extremos_y_excluye_inicio_futuro', () => {
  const affiliation: NormalizedAffiliation = { caja: 'NORTE', validFrom: '2026-10-14', validTo: '2026-10-14', source: 'ONLINE', asOf: '2026-10-14', affiliateType: 'DEPENDIENTE' };
  assert.equal(isCurrentAffiliation(affiliation, '2026-10-14'), true);
  assert.equal(isCurrentAffiliation(affiliation, '2026-10-13'), false);
  assert.equal(isCurrentAffiliation(affiliation, '2026-10-15'), false);
  assert.equal(isCurrentAffiliation({ ...affiliation, validTo: null }, '2026-10-15'), true);
  assert.equal(isCurrentAffiliation({ ...affiliation, validFrom: '2026-02-29' }, '2026-10-14'), false);
  assert.equal(isCurrentAffiliation(affiliation, '2026-10-14junk'), false);
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

test('concurrencia_respeta_limite_y_no_ejecuta_espera_cancelada', async () => {
  const slots = new Semaphore(1);
  const release = deferred<void>();
  const entered = deferred<void>();
  const first = slots.run(async () => { entered.resolve(); await release.promise; return 1; }, new AbortController().signal);
  await entered.promise;
  const controller = new AbortController();
  let cancelledCalled = false;
  const cancelled = slots.run(async () => { cancelledCalled = true; return 2; }, controller.signal);
  const rejection = assert.rejects(cancelled, error => error === controller.signal.reason);
  controller.abort();
  await rejection;
  let lastCalled = false;
  const last = slots.run(async () => { lastCalled = true; return 3; }, new AbortController().signal);
  await Promise.resolve();
  assert.equal(lastCalled, false);
  release.resolve();
  assert.deepEqual(await Promise.all([first, last]), [1, 3]);
  assert.equal(cancelledCalled, false);
  assert.equal(lastCalled, true);
});

test('concurrencia_libera_turno_ante_excepcion_y_rechaza_limites_invalidos', async () => {
  for (const value of [0, -1, 1.5, Infinity, NaN]) assert.throws(() => new Semaphore(value), RangeError);
  const slots = new Semaphore(1);
  await assert.rejects(slots.run(async () => { throw new Error('synthetic failure'); }, new AbortController().signal));
  assert.equal(await slots.run(async () => 42, new AbortController().signal), 42);
  const cancelled = AbortSignal.abort();
  await assert.rejects(slots.run(async () => { assert.fail('Cancelled work must not start'); }, cancelled));
});

test('cancelacion_acota_dependencia_y_observa_rechazo_tardio', async () => {
  const controller = new AbortController();
  let reject!: (reason: unknown) => void;
  const work = new Promise<void>((_resolve, fail) => { reject = fail; });
  const bounded = abortable(work, controller.signal);
  const rejection = assert.rejects(bounded, error => error === controller.signal.reason);
  controller.abort();
  await rejection;
  reject(new Error('Late dependency failure'));
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(await abortable(Promise.resolve(42), new AbortController().signal), 42);
  await assert.rejects(abortable(Promise.resolve(42), AbortSignal.abort()));
});
