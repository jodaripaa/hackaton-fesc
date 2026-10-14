import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../../src/config/index.ts';

export const cajasPath = fileURLToPath(new URL('../../config/cajas.yaml', import.meta.url));
/** Independent synthetic credentials; no real secrets or upstream datasets. */
export function testEnvironment(): Record<string, string> {
  const random = () => randomBytes(24).toString('hex');
  return {
    NORTE_TOKEN: random(), ORIENTE_TOKEN: random(), CENTRO_TOKEN: random(), SUR_TOKEN: random(), ADMIN_TOKEN: random(),
    CAJA_NORTE_URL: 'http://127.0.0.1:19001', CAJA_NORTE_API_KEY: random(),
    CAJA_ORIENTE_URL: 'http://127.0.0.1:19002/service', CAJA_ORIENTE_USER: 'test-user', CAJA_ORIENTE_PASSWORD: random(),
    CAJA_CENTRO_DIR: '/synthetic/centro', CAJA_SUR_URL: 'http://127.0.0.1:19004', CAJA_SUR_TOKEN: random(),
    CAJA_SUR_ENABLED: 'false', PGHOST: '127.0.0.1', PGDATABASE: 'test', PGUSER: 'test', PGPASSWORD: random(), LOG_LEVEL: 'silent',
  };
}
export function testConfig() { return loadConfig(testEnvironment(), { cajasPath }); }
