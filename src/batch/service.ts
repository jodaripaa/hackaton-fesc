import { randomUUID } from 'node:crypto';
import type { BatchServiceFactory } from '../contracts/modules.ts';
import { queryDate } from '../domain/affiliation.ts';
import { abortable, createDeadline } from '../domain/concurrency.ts';
import { AppError } from '../domain/errors.ts';
import { normalizeDocument } from '../domain/normalization.ts';
import { CAJA_IDS, PURPOSES } from '../domain/types.ts';
import type { BatchJob, BatchRowResult, ConsumerIdentity } from '../domain/types.ts';
import { batchContentHash, validateIdempotencyKey } from './csv.ts';

export const createBatchService: BatchServiceFactory = options => {
  // Leave at least one slot (and normally 25%) in both shared query/origin pools.
  const reservedLimit = (limit: number) => Math.max(1, Math.floor(limit * 0.75));
  const concurrency = Math.max(1, Math.min(options.batch.concurrency, reservedLimit(options.query.concurrency), reservedLimit(options.query.originConcurrency)));
  const blockSize = Math.min(64, concurrency * 2);
  let controller: AbortController | undefined;
  let startup: Promise<void> | undefined;
  let loop: Promise<void> | undefined;
  let wake: (() => void) | undefined;

  function wait(signal: AbortSignal): Promise<void> {
    return new Promise(resolve => {
      const finish = () => { clearTimeout(timer); signal.removeEventListener('abort', finish); if (wake === finish) wake = undefined; resolve(); };
      const timer = setTimeout(finish, 500);
      wake = finish;
      signal.addEventListener('abort', finish, { once: true });
      if (signal.aborted) finish();
    });
  }
  async function processJob(job: BatchJob, signal: AbortSignal): Promise<void> {
    const identity: ConsumerIdentity = { kind: 'consumer', caja: job.requestingCaja };
    const stored = await options.repository.readResults(job.jobId, identity);
    if (!stored || stored.results.length > job.documents.length) throw new AppError(503, 'UNAVAILABLE');
    const asOf = queryDate(new Date(job.createdAt));
    for (let start = stored.results.length; start < job.documents.length; start += blockSize) {
      signal.throwIfAborted();
      const end = Math.min(start + blockSize, job.documents.length);
      const results: BatchRowResult[] = new Array(end - start);
      let next = start;
      const block = new AbortController();
      const blockSignal = AbortSignal.any([signal, block.signal]);
      const workers = Array.from({ length: Math.min(concurrency, end - start) }, async () => {
        try {
          for (;;) {
            blockSignal.throwIfAborted();
            const index = next++;
            if (index >= end) return;
            const document = job.documents[index];
            if (document === undefined) throw new AppError(503, 'UNAVAILABLE');
            // Retried queries are real new consultations: give each a new ID so
            // audit ON CONFLICT cannot hide a changed result after an outage.
            const requestId = randomUUID();
            const deadline = createDeadline(Date.now() + options.query.totalTimeoutMs, blockSignal);
            try {
              // A separate common query for EVERY row preserves per-row audit,
              // including duplicates, without a second audit implementation.
              const response = await abortable(options.affiliations.query({ document, identity, purpose: job.purpose, requestId, asOf, signal: deadline.signal }), deadline.signal);
              results[index - start] = { document, requestId, result: response.result,
                matches: response.matches.map(match => ({ caja: match.caja, validFrom: match.validFrom, validTo: match.validTo, source: match.source, asOf: match.asOf })),
                unavailable: response.unavailable };
            } finally { deadline.dispose(); }
          }
        } catch (error) { block.abort(); throw error; }
      });
      const settled = await Promise.allSettled(workers);
      const failure = settled.find(result => result.status === 'rejected');
      if (failure?.status === 'rejected') throw failure.reason;
      signal.throwIfAborted();
      await options.repository.saveResults(job.jobId, results);
    }
    signal.throwIfAborted();
    await options.repository.complete(job.jobId);
  }
  async function work(signal: AbortSignal): Promise<void> {
    try {
      while (!signal.aborted) {
        try {
          await options.repository.recoverInterrupted();
          signal.throwIfAborted();
          const job = await options.repository.claimPending();
          if (job) await processJob(job, signal);
          else await wait(signal);
        } catch {
          // Infrastructure/audit errors leave the job unfinished and resumable.
          // Origin failures are already valid INDETERMINADO/partial responses.
          try { await options.repository.recoverInterrupted(); } catch { /* Retry after PostgreSQL recovers. */ }
          if (!signal.aborted) await wait(signal);
        }
      }
    } finally {
      try { await options.repository.recoverInterrupted(); } catch { /* A crashed lease expires in PostgreSQL. */ }
    }
  }
  return {
    async submit(input) {
      validateIdempotencyKey(input.idempotencyKey);
      if (!CAJA_IDS.includes(input.identity.caja) || !PURPOSES.includes(input.purpose) || input.documents.length === 0) throw new AppError(400, 'INVALID_REQUEST');
      if (input.documents.length > options.batch.maxDocuments) throw new AppError(413, 'INVALID_REQUEST');
      if (input.documents.some(document => normalizeDocument(document) !== document) || input.contentHash !== batchContentHash(input.purpose, input.documents)) throw new AppError(400, 'INVALID_REQUEST');
      const accepted = await options.repository.createOrGet(input);
      wake?.();
      return accepted;
    },
    async get(jobId, identity) { return options.repository.readResults(jobId, identity, false); },
    async start() {
      if (startup) return startup;
      if (controller && !controller.signal.aborted) return;
      const current = new AbortController();
      controller = current;
      startup = (async () => {
        try {
          await options.repository.recoverInterrupted();
          if (!current.signal.aborted) loop = work(current.signal);
        } catch { current.abort(); throw new AppError(503, 'UNAVAILABLE'); }
      })();
      try { await startup; } finally { startup = undefined; }
    },
    async stop() {
      controller?.abort();
      wake?.();
      if (startup) { try { await startup; } catch { /* Failed startup has no active worker. */ } }
      await loop;
      loop = undefined;
    },
  };
};
