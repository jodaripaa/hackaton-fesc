import type { AppConfig } from '../config/types.ts';
import type {
  AdapterContext, AdapterResult, CajaAdapter, CajaId, NormalizedAffiliation, NormalizedDocument,
} from '../domain/types.ts';
import { documentKey, InvalidResponse, isoDate } from './validation.ts';

export class AuthenticationFailure extends Error {
  constructor() { super('Upstream authentication failed'); }
}
export class OriginUnavailable extends Error {
  constructor() { super('Upstream unavailable'); }
}
export class FileUnavailable extends Error {
  constructor() { super('Published file unavailable'); }
}

/** A rejection handler stays attached even when cancellation wins the race. */
export function abortable<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(new OriginUnavailable());
    signal.addEventListener('abort', abort, { once: true });
    operation.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
    if (signal.aborted) abort();
  });
}

interface Waiter {
  readonly signal: AbortSignal;
  readonly enter: () => void;
  readonly abort: () => void;
}

/** FIFO per-origin capacity. Waiting consumes the same time budget as I/O. */
class OriginCapacity {
  private active = 0;
  private readonly queue: Waiter[] = [];
  private readonly limit: number;
  constructor(limit: number) { this.limit = limit; }

  acquire(signal: AbortSignal): Promise<() => void> {
    return new Promise((resolve, reject) => {
      const abort = () => {
        const index = this.queue.indexOf(waiter);
        if (index >= 0) this.queue.splice(index, 1);
        reject(new OriginUnavailable());
      };
      const waiter: Waiter = {
        signal, abort,
        enter: () => {
          signal.removeEventListener('abort', abort);
          this.active++;
          let released = false;
          resolve(() => {
            if (released) return;
            released = true;
            this.active--;
            this.drain();
          });
        },
      };
      if (signal.aborted) { reject(new OriginUnavailable()); return; }
      if (this.active < this.limit) waiter.enter();
      else {
        this.queue.push(waiter);
        signal.addEventListener('abort', abort, { once: true });
      }
    });
  }

  private drain(): void {
    while (this.active < this.limit && this.queue.length) {
      const waiter = this.queue.shift();
      if (!waiter) break;
      if (waiter.signal.aborted) waiter.abort();
      else waiter.enter();
    }
  }
}

export type Lookup = (
  document: NormalizedDocument, context: AdapterContext, signal: AbortSignal,
) => Promise<readonly NormalizedAffiliation[]>;

export function createAdapter(
  caja: CajaId, query: AppConfig['query'], lookup: Lookup,
  closed: AbortController = new AbortController(), cleanup: () => void = () => {},
): CajaAdapter {
  const capacity = new OriginCapacity(query.originConcurrency);
  return {
    caja,
    async lookup(document, context): Promise<AdapterResult> {
      const remaining = Math.min(query.originTimeoutMs, context.deadlineAt - Date.now());
      if (!Number.isFinite(remaining) || remaining <= 0 || context.signal.aborted) {
        return { status: 'unavailable', caja, reason: 'TIMEOUT' };
      }
      if (closed.signal.aborted) return { status: 'unavailable', caja, reason: 'UNAVAILABLE' };
      const timeout = new AbortController();
      const timer = setTimeout(() => timeout.abort(), remaining);
      const signal = AbortSignal.any([context.signal, timeout.signal, closed.signal]);
      let release: (() => void) | undefined;
      try {
        if (documentKey(document) !== document) throw new InvalidResponse();
        isoDate(context.asOf);
        release = await capacity.acquire(signal);
        if (signal.aborted) throw new OriginUnavailable();
        const affiliations = await abortable(lookup(document, context, signal), signal);
        if (signal.aborted || Date.now() >= context.deadlineAt) throw new OriginUnavailable();
        return { status: 'ok', caja, affiliations };
      } catch (error) {
        const reason = context.signal.aborted || timeout.signal.aborted || Date.now() >= context.deadlineAt
          ? 'TIMEOUT'
          : error instanceof InvalidResponse ? 'INVALID_RESPONSE'
          : error instanceof AuthenticationFailure ? 'AUTHENTICATION'
          : error instanceof FileUnavailable ? 'FILE_UNAVAILABLE'
          : 'UNAVAILABLE';
        return { status: 'unavailable', caja, reason };
      } finally {
        clearTimeout(timer);
        release?.();
      }
    },
    async close() { closed.abort(); cleanup(); },
  };
}
