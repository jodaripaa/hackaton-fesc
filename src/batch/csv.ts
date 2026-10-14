import { createHash } from 'node:crypto';
import { parse } from 'csv-parse/sync';
import { AppError } from '../domain/errors.ts';
import { normalizeDocument } from '../domain/normalization.ts';
import type { NormalizedDocument, Purpose } from '../domain/types.ts';

/** Never coerce documents to numbers or discard an invalid/empty data row. */
export function parseBatchCsv(input: Buffer, maxDocuments: number): readonly NormalizedDocument[] {
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(input);
    let records = 0;
    const rows = parse(text, {
      bom: true, skip_empty_lines: false, max_record_size: 4096,
      on_record: (record: string[]) => {
        if (++records > maxDocuments + 1) throw new AppError(413, 'INVALID_REQUEST');
        return record;
      },
    });
    const header = rows.shift()?.map(column => column.trim());
    if (!header || new Set(header).size !== header.length || header.some(column => !column)) throw new AppError(400, 'INVALID_REQUEST');
    const column = header.indexOf('document');
    if (column < 0 || rows.length === 0) throw new AppError(400, 'INVALID_REQUEST');
    return rows.map(row => normalizeDocument(row[column]));
  } catch (error) {
    if (error instanceof AppError) throw error;
    // Parser diagnostics can contain the submitted document: expose no details.
    throw new AppError(400, 'INVALID_REQUEST');
  }
}

/** Canonical, envelope-independent hash; order and duplicate rows are significant. */
export function batchContentHash(purpose: Purpose, documents: readonly NormalizedDocument[]): string {
  return createHash('sha256').update(JSON.stringify([purpose, documents])).digest('hex');
}

export function validateIdempotencyKey(key: unknown): asserts key is string {
  if (typeof key !== 'string' || key.length < 1 || key.length > 200 || key.trim() !== key || /[\u0000-\u001f\u007f]/u.test(key)) {
    throw new AppError(400, 'INVALID_REQUEST');
  }
}
