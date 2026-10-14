import type { AppConfig, RestSurConfig } from '../config/types.ts';
import type { AffiliateType, CajaAdapter } from '../domain/types.ts';
import { endpoint, requestText } from './http.ts';
import { AuthenticationFailure, createAdapter, OriginUnavailable } from './runtime.ts';
import {
  affiliateType, array, documentKey, InvalidResponse, isoDate, jsonObject, record, validatePeriod,
} from './validation.ts';

const TYPES: Readonly<Record<string, AffiliateType>> = {
  DEPENDENT: 'DEPENDIENTE', SELF_EMPLOYED: 'INDEPENDIENTE', RETIREE: 'PENSIONADO',
};

export function createSurAdapter(config: RestSurConfig, query: AppConfig['query']): CajaAdapter {
  if (!config.enabled || !config.baseUrl || !config.token) throw new Error('Enabled REST source requires configuration');
  const baseUrl = config.baseUrl;
  const token = config.token;
  return createAdapter(config.id, query, async (document, context, signal) => {
    const response = await requestText(endpoint(baseUrl, `/v2/people/${document}/memberships`), {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    }, signal, 'json', [200, 404]);
    if (response.status === 401 || response.status === 403) throw new AuthenticationFailure();
    if (response.status === 404) {
      if (jsonObject(response.body).error !== 'person_not_found') throw new InvalidResponse();
      return [];
    }
    if (response.status !== 200) throw new OriginUnavailable();
    const payload = jsonObject(response.body);
    if (documentKey(record(payload.person).id) !== document) throw new InvalidResponse();
    return array(payload.memberships).map(value => {
      const row = record(value);
      const validFrom = isoDate(row.start);
      const validTo = row.end === null ? null : isoDate(row.end);
      validatePeriod(validFrom, validTo);
      return {
        caja: config.id, validFrom, validTo, affiliateType: affiliateType(row.category, TYPES),
        source: 'ONLINE' as const, asOf: context.asOf,
      };
    });
  });
}
