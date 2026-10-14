import type { AppConfig, RestNorteConfig } from '../config/types.ts';
import type { AffiliateType, CajaAdapter } from '../domain/types.ts';
import { endpoint, requestText } from './http.ts';
import { AuthenticationFailure, createAdapter, OriginUnavailable } from './runtime.ts';
import {
  affiliateType, array, documentKey, InvalidResponse, isoDate, jsonObject, record, validatePeriod,
} from './validation.ts';

const TYPES: Readonly<Record<string, AffiliateType>> = {
  DEPENDIENTE: 'DEPENDIENTE', INDEPENDIENTE: 'INDEPENDIENTE', PENSIONADO: 'PENSIONADO',
};

export function createNorteAdapter(config: RestNorteConfig, query: AppConfig['query']): CajaAdapter {
  return createAdapter(config.id, query, async (document, context, signal) => {
    const response = await requestText(endpoint(config.baseUrl, `/api/v1/afiliados/${document}`), {
      headers: { 'X-Api-Key': config.apiKey, Accept: 'application/json' },
    }, signal, 'json', [200, 404]);
    if (response.status === 401 || response.status === 403) throw new AuthenticationFailure();
    if (response.status === 404) {
      if (jsonObject(response.body).error !== 'NO_ENCONTRADO') throw new InvalidResponse();
      return [];
    }
    if (response.status !== 200) throw new OriginUnavailable();
    const payload = jsonObject(response.body);
    if (documentKey(payload.documento) !== document) throw new InvalidResponse();
    return array(payload.afiliaciones).map(value => {
      const row = record(value);
      const validFrom = isoDate(row.fechaInicio);
      const validTo = row.fechaFin === null ? null : isoDate(row.fechaFin);
      validatePeriod(validFrom, validTo);
      if (row.estado !== 'VIGENTE' && row.estado !== 'HISTORICA') throw new InvalidResponse();
      return {
        caja: config.id, validFrom, validTo, affiliateType: affiliateType(row.tipoAfiliado, TYPES),
        source: 'ONLINE' as const, asOf: context.asOf,
      };
    });
  });
}
