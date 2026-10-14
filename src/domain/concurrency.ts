interface Waiter { readonly grant: () => void; readonly reject: (reason: unknown) => void; readonly signal: AbortSignal; readonly cancel: () => void }

export class Semaphore {
  readonly #limit: number;
  #active = 0;
  readonly #queue: Waiter[] = [];

  constructor(limit: number) {
    if (!Number.isInteger(limit) || limit < 1) throw new RangeError('Invalid concurrency');
    this.#limit = limit;
  }

  async run<T>(work: () => Promise<T>, signal: AbortSignal): Promise<T> {
    signal.throwIfAborted();
    await this.#acquire(signal);
    try { signal.throwIfAborted(); return await work(); }
    finally { this.#release(); }
  }

  #acquire(signal: AbortSignal): Promise<void> {
    if (this.#active < this.#limit) { this.#active += 1; return Promise.resolve(); }
    return new Promise<void>((resolve, reject) => {
      const cancel = () => {
        signal.removeEventListener('abort', cancel);
        const index = this.#queue.indexOf(waiter);
        if (index >= 0) this.#queue.splice(index, 1);
        reject(signal.reason);
      };
      const waiter: Waiter = { signal, cancel, reject, grant: resolve };
      this.#queue.push(waiter);
      signal.addEventListener('abort', cancel, { once: true });
      if (signal.aborted) cancel();
    });
  }

  #release(): void {
    for (;;) {
      const waiter = this.#queue.shift();
      if (!waiter) { this.#active -= 1; return; }
      waiter.signal.removeEventListener('abort', waiter.cancel);
      if (waiter.signal.aborted) { waiter.reject(waiter.signal.reason); continue; }
      waiter.grant();
      return;
    }
  }
}

/** A disposable deadline avoids leaving timeout timers/listeners behind after success. */
export function createDeadline(deadlineAt: number, parent: AbortSignal): { readonly signal: AbortSignal; dispose(): void } {
  const controller = new AbortController();
  const cancel = () => { controller.abort(parent.reason); };
  const timeout = () => { controller.abort(new DOMException('Deadline exceeded', 'TimeoutError')); };
  const remaining = deadlineAt - Date.now();
  const timer = remaining > 0 ? setTimeout(timeout, remaining) : undefined;
  parent.addEventListener('abort', cancel, { once: true });
  if (parent.aborted) cancel();
  else if (remaining <= 0) timeout();
  return {
    signal: controller.signal,
    dispose() {
      if (timer !== undefined) clearTimeout(timer);
      parent.removeEventListener('abort', cancel);
    },
  };
}

/** Bounds even a faulty dependency that ignores its caller's cancellation. */
export function abortable<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const cancel = () => { signal.removeEventListener('abort', cancel); reject(signal.reason); };
    signal.addEventListener('abort', cancel, { once: true });
    work.then(value => { signal.removeEventListener('abort', cancel); resolve(value); }, error => { signal.removeEventListener('abort', cancel); reject(error); });
    if (signal.aborted) cancel();
  });
}
