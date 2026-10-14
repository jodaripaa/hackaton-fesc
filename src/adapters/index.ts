import type { AdapterFactory } from '../contracts/modules.ts';
import type { CajaAdapter, CajaId } from '../domain/types.ts';
import { createCentroAdapter } from './centro.ts';
import { createNorteAdapter } from './norte.ts';
import { createOrienteAdapter } from './oriente.ts';
import { createSurAdapter } from './sur.ts';

export const createAdapters: AdapterFactory = (cajas, query) => {
  const adapters: CajaAdapter[] = [];
  const seen = new Set<CajaId>();
  for (const config of cajas) {
    if (!config.enabled) continue;
    if (seen.has(config.id)) throw new Error('Duplicate enabled source');
    seen.add(config.id);
    switch (config.protocol) {
      case 'REST_NORTE': adapters.push(createNorteAdapter(config, query)); break;
      case 'SOAP_ORIENTE': adapters.push(createOrienteAdapter(config, query)); break;
      case 'FILE_CENTRO': adapters.push(createCentroAdapter(config, query)); break;
      case 'REST_SUR': adapters.push(createSurAdapter(config, query)); break;
      default: throw new Error('Unsupported source protocol');
    }
  }
  return adapters;
};
