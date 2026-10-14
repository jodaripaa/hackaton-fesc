import { maskDocument } from '../audit/masking.ts';
import type { AffiliationServiceOptions } from '../contracts/modules.ts';
import { isCurrentAffiliation, isDateOnly, isNormalizedAffiliation } from '../domain/affiliation.ts';
import { Semaphore, abortable, createDeadline } from '../domain/concurrency.ts';
import { AppError } from '../domain/errors.ts';
import type { AdapterResult, AffiliationService, CajaId, NormalizedAffiliation } from '../domain/types.ts';

interface ServiceOptions extends AffiliationServiceOptions {
  /** Pass enabled configuration IDs to detect missing optional origins, including Sur. */
  readonly requiredCajas?: readonly CajaId[];
}
const originalCajas: readonly CajaId[] = ['NORTE', 'ORIENTE', 'CENTRO'];

function checkedResult(value: unknown, caja: CajaId): AdapterResult {
  const invalid: AdapterResult = { status: 'unavailable', caja, reason: 'INVALID_RESPONSE' };
  if (value === null || typeof value !== 'object') return invalid;
  const result = value as Record<string, unknown>;
  if (result['caja'] !== caja) return invalid;
  if (result['status'] === 'unavailable') return { status: 'unavailable', caja, reason: 'UNAVAILABLE' };
  if (result['status'] !== 'ok' || !Array.isArray(result['affiliations'])) return invalid;
  const affiliations: NormalizedAffiliation[] = [];
  for (const row of result['affiliations']) {
    if (!isNormalizedAffiliation(row, caja)) return invalid;
    affiliations.push(row);
  }
  return { status: 'ok', caja, affiliations };
}

export const createAffiliationService = (options: ServiceOptions): AffiliationService => {
  const slots = new Semaphore(options.query.concurrency);
  const adapters = new Map(options.adapters.map(adapter => [adapter.caja, adapter]));
  if (adapters.size !== options.adapters.length) throw new Error('Duplicate adapter');
  // Configuration requires the original three; absence of an adapter is a failed origin.
  const requiredCajas = [...new Set([...originalCajas, ...(options.requiredCajas ?? [...adapters.keys()])])].sort();
  const originSlots = new Map(requiredCajas.map(caja => [caja, new Semaphore(options.query.originConcurrency)]));
  return {
    async query(input) {
      if (!isDateOnly(input.asOf)) throw new AppError(400, 'INVALID_REQUEST');
      const deadlineAt = Date.now() + options.query.totalTimeoutMs;
      const total = createDeadline(deadlineAt, input.signal);
      const reserve = Math.min(100, Math.max(10, Math.floor(options.query.totalTimeoutMs / 10)));
      try {
        // Race outside the semaphore: a dependency ignoring cancellation keeps its
        // permit until it settles, while the caller still gets a bounded response.
        return await abortable(slots.run(async () => {
          const origins = requiredCajas.filter(caja => caja !== input.identity.caja);
          const originDeadlineAt = Math.min(deadlineAt - reserve, Date.now() + options.query.originTimeoutMs);
          const results = await Promise.all(origins.map(async (caja): Promise<AdapterResult> => {
            const adapter = adapters.get(caja);
            const originSlot = originSlots.get(caja);
            if (!adapter || !originSlot) return { status: 'unavailable', caja, reason: 'UNAVAILABLE' };
            const origin = createDeadline(originDeadlineAt, total.signal);
            try {
              const response = await abortable(originSlot.run(() => adapter.lookup(input.document, {
                signal: origin.signal, deadlineAt: originDeadlineAt, requestId: input.requestId, asOf: input.asOf,
              }), origin.signal), origin.signal);
              return checkedResult(response, caja);
            } catch {
              return { status: 'unavailable', caja, reason: origin.signal.aborted ? 'TIMEOUT' : 'UNAVAILABLE' };
            } finally { origin.dispose(); }
          }));
          const matches: NormalizedAffiliation[] = [];
          const unavailable: CajaId[] = [];
          const seen = new Set<string>();
          for (const origin of results) {
            if (origin.status === 'unavailable') { unavailable.push(origin.caja); continue; }
            for (const row of origin.affiliations) {
              if (!isCurrentAffiliation(row, input.asOf)) continue;
              const match: NormalizedAffiliation = {
                caja: row.caja, validFrom: row.validFrom, validTo: row.validTo, source: row.source,
                asOf: row.source === 'ONLINE' ? input.asOf : row.asOf, affiliateType: row.affiliateType,
              };
              const key = JSON.stringify(match);
              if (!seen.has(key)) { seen.add(key); matches.push(match); }
            }
          }
          matches.sort((a, b) => a.caja.localeCompare(b.caja) || a.validFrom.localeCompare(b.validFrom) || (a.validTo ?? '').localeCompare(b.validTo ?? '') || a.affiliateType.localeCompare(b.affiliateType));
          const result = matches.length ? 'AFILIADO_OTRA_CAJA' : unavailable.length ? 'INDETERMINADO' : 'NO_AFILIADO';
          total.signal.throwIfAborted();
          if (Date.now() >= deadlineAt) throw new AppError(503, 'UNAVAILABLE');
          await options.audit.append({
            requestId: input.requestId, timestamp: new Date().toISOString(), requestingCaja: input.identity.caja,
            purpose: input.purpose, result, documentMasked: maskDocument(input.document),
          });
          total.signal.throwIfAborted();
          if (Date.now() >= deadlineAt) throw new AppError(503, 'UNAVAILABLE');
          return { requestId: input.requestId, result, matches, unavailable };
        }, total.signal), total.signal);
      } catch { throw new AppError(503, 'UNAVAILABLE'); }
      finally { total.dispose(); }
    },
  };
};
