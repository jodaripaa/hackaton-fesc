import { createReadStream } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { setImmediate as yieldToEventLoop } from 'node:timers/promises';
import type { AppConfig, FileCentroConfig } from '../config/types.ts';
import type { AffiliateType, CajaAdapter, NormalizedAffiliation, NormalizedDocument } from '../domain/types.ts';
import { abortable, createAdapter, FileUnavailable } from './runtime.ts';
import { affiliateType, compactDate, documentKey, InvalidResponse, isoDate, validatePeriod } from './validation.ts';

export const MAX_CENTRO_BYTES = 33_554_432;
const HEADER = 'TIPO_DOC|NUMERO_DOCUMENTO|FECHA_INICIO|FECHA_FIN|TIPO_AFILIADO|NOMBRE|SALARIO';
const TYPES: Readonly<Record<string, AffiliateType>> = {
  DEP: 'DEPENDIENTE', IND: 'INDEPENDIENTE', PEN: 'PENSIONADO',
};
type Index = ReadonlyMap<NormalizedDocument, readonly NormalizedAffiliation[]>;
interface Snapshot { readonly signature: string; readonly index: Index }
interface Loading { readonly signature: string; readonly promise: Promise<Index> }

function signature(path: string, metadata: Awaited<ReturnType<typeof stat>>): string {
  if (!metadata.isFile()) throw new FileUnavailable();
  if (metadata.size > MAX_CENTRO_BYTES) throw new InvalidResponse();
  return `${path}:${metadata.size}:${metadata.mtimeMs}:${metadata.ctimeMs}`;
}

async function parseFile(body: string, signal: AbortSignal): Promise<Index> {
  const lines = body.replace(/^\uFEFF/u, '').split(/\r?\n/u);
  const cutoff = lines[0]?.split('|');
  if (cutoff?.length !== 2 || cutoff[0] !== 'FECHA_CORTE' || lines[1] !== HEADER) throw new InvalidResponse();
  const asOf = isoDate(cutoff[1]);
  const index = new Map<NormalizedDocument, NormalizedAffiliation[]>();
  for (let i = 2; i < lines.length; i++) {
    // Let request deadlines/cancellation run even while indexing a large publication.
    if ((i & 511) === 0) await yieldToEventLoop(undefined, { signal });
    const line = lines[i];
    if (!line?.trim()) continue;
    const cells = line.split('|');
    if (cells.length !== 7 || !/^[A-Z][A-Z0-9]{0,9}$/u.test(cells[0] ?? '')) throw new InvalidResponse();
    const document = documentKey(cells[1]);
    const validFrom = compactDate(cells[2]);
    const validTo = cells[3] === '' ? null : compactDate(cells[3]);
    validatePeriod(validFrom, validTo);
    const affiliation: NormalizedAffiliation = Object.freeze({
      caja: 'CENTRO', validFrom, validTo, affiliateType: affiliateType(cells[4], TYPES), source: 'FILE', asOf,
    });
    const rows = index.get(document);
    if (rows) rows.push(affiliation);
    else index.set(document, [affiliation]);
  }
  for (const rows of index.values()) Object.freeze(rows);
  return index;
}

async function loadFile(path: string, expected: string, signal: AbortSignal): Promise<Index> {
  try {
    const chunks: Buffer[] = [];
    let size = 0;
    const stream = createReadStream(path, { signal });
    for await (const chunk of stream) {
      const bytes = chunk as Buffer;
      size += bytes.byteLength;
      if (size > MAX_CENTRO_BYTES) { stream.destroy(); throw new InvalidResponse(); }
      chunks.push(bytes);
    }
    const metadata = await stat(path);
    if (signature(path, metadata) !== expected) throw new FileUnavailable();
    let body: string;
    try { body = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, size)); }
    catch { throw new InvalidResponse(); }
    return parseFile(body, signal);
  } catch (error) {
    if (error instanceof InvalidResponse) throw error;
    throw new FileUnavailable();
  }
}

export function createCentroAdapter(config: FileCentroConfig, query: AppConfig['query']): CajaAdapter {
  const closed = new AbortController();
  let snapshot: Snapshot | undefined;
  let loading: Loading | undefined;
  return createAdapter(config.id, query, async (document, _context, signal) => {
    let path: string;
    let current: string;
    try {
      const entries = await abortable(readdir(config.directory, { withFileTypes: true }), signal);
      const candidates = entries.filter(entry => entry.isFile() && /^centro_afiliados_\d{8}\.txt$/u.test(entry.name));
      // Date in the publication name determines recency, not filesystem copy time.
      const latest = candidates.sort((a, b) => b.name.localeCompare(a.name))[0];
      if (!latest) throw new FileUnavailable();
      compactDate(latest.name.slice(-12, -4));
      path = join(config.directory, latest.name);
      current = signature(path, await abortable(stat(path), signal));
    } catch (error) {
      if (error instanceof InvalidResponse) throw error;
      throw new FileUnavailable();
    }
    if (snapshot?.signature === current) return snapshot.index.get(document) ?? [];
    if (loading?.signature !== current) {
      // A shared load belongs to the adapter. Cancelling one caller cannot cancel other readers.
      const promise = loadFile(path, current, closed.signal);
      const pending: Loading = { signature: current, promise };
      loading = pending;
      promise.then(index => {
        if (loading === pending && !closed.signal.aborted) snapshot = { signature: current, index };
      }, () => {}).finally(() => { if (loading === pending) loading = undefined; });
    }
    const index = await abortable(loading.promise, signal);
    // Never serve a previous valid snapshot when the selected publication is corrupt.
    return index.get(document) ?? [];
  }, closed, () => { snapshot = undefined; loading = undefined; });
}
