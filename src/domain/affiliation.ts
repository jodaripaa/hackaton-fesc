import { AFFILIATE_TYPES } from './types.ts';
import type { CajaId, DateOnly, NormalizedAffiliation } from './types.ts';

const calendar = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit' });

export function isDateOnly(value: unknown): value is DateOnly {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function queryDate(now: Date): DateOnly {
  const parts = calendar.formatToParts(now);
  const part = (type: string) => parts.find(item => item.type === type)?.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

export function isCurrentAffiliation(affiliation: NormalizedAffiliation, asOf: DateOnly): boolean {
  return isDateOnly(asOf) && isDateOnly(affiliation.validFrom) && (affiliation.validTo === null || isDateOnly(affiliation.validTo))
    && affiliation.validFrom <= asOf && (affiliation.validTo === null || affiliation.validTo >= asOf);
}

/** An invalid upstream row cannot be silently interpreted as confirmed absence. */
export function isNormalizedAffiliation(value: unknown, caja: CajaId): value is NormalizedAffiliation {
  if (value === null || typeof value !== 'object') return false;
  const row = value as Record<string, unknown>;
  return row['caja'] === caja && isDateOnly(row['validFrom']) && isDateOnly(row['asOf'])
    && (row['validTo'] === null || (isDateOnly(row['validTo']) && row['validTo'] >= row['validFrom']))
    && (row['source'] === 'ONLINE' || row['source'] === 'FILE')
    && AFFILIATE_TYPES.some(type => type === row['affiliateType']);
}
