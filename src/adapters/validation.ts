import type { AffiliateType, DateOnly, NormalizedDocument } from '../domain/types.ts';

/** Constant failure messages: never retain an upstream body or credentials in errors. */
export class InvalidResponse extends Error {
  constructor() { super('Invalid upstream response'); }
}

export function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new InvalidResponse();
  return value as Record<string, unknown>;
}

export function text(value: unknown): string {
  if (typeof value !== 'string') throw new InvalidResponse();
  return value;
}

export function array(value: unknown): readonly unknown[] {
  if (!Array.isArray(value)) throw new InvalidResponse();
  return value;
}

/** Local source-key normalization, independent of the public input normalizer. */
export function documentKey(value: unknown): NormalizedDocument {
  const raw = text(value);
  if (!raw || raw.length > 64 || !/^[0-9.\s]+$/u.test(raw)) throw new InvalidResponse();
  const digits = raw.replace(/[.\s]/gu, '').replace(/^0+(?=[0-9])/u, '');
  if (!digits || digits.length > 12) throw new InvalidResponse();
  return digits as NormalizedDocument;
}

export function isoDate(value: unknown): DateOnly {
  const date = text(value);
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(date)) throw new InvalidResponse();
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  const day = Number(date.slice(8, 10));
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > (days[month - 1] ?? 0)) {
    throw new InvalidResponse();
  }
  return date;
}

export function compactDate(value: unknown): DateOnly {
  const date = text(value);
  if (!/^\d{8}$/u.test(date)) throw new InvalidResponse();
  return isoDate(`${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`);
}

export function dayFirstDate(value: unknown): DateOnly {
  const date = text(value);
  if (!/^\d{2}\/\d{2}\/\d{4}$/u.test(date)) throw new InvalidResponse();
  return isoDate(`${date.slice(6, 10)}-${date.slice(3, 5)}-${date.slice(0, 2)}`);
}

export function validatePeriod(from: DateOnly, to: DateOnly | null): void {
  if (to !== null && to < from) throw new InvalidResponse();
}

export function affiliateType(value: unknown, mapping: Readonly<Record<string, AffiliateType>>): AffiliateType {
  const key = text(value);
  const type = Object.hasOwn(mapping, key) ? mapping[key] : undefined;
  if (!type) throw new InvalidResponse();
  return type;
}

export function jsonObject(body: string): Record<string, unknown> {
  try { return record(JSON.parse(body) as unknown); }
  catch { throw new InvalidResponse(); }
}
