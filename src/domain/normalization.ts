import { AppError } from './errors.ts';
import type { NormalizedDocument } from './types.ts';

export function normalizeDocument(value: unknown): NormalizedDocument {
  if (typeof value !== 'string' || !value || value.length > 64 || !/^[0-9.\s]+$/u.test(value)) throw new AppError(400, 'INVALID_REQUEST');
  const digits = value.replace(/[.\s]/gu, '');
  if (!digits) throw new AppError(400, 'INVALID_REQUEST');
  const canonical = digits.replace(/^0+(?=[0-9])/u, '');
  if (canonical.length > 12) throw new AppError(400, 'INVALID_REQUEST');
  return canonical as NormalizedDocument;
}
