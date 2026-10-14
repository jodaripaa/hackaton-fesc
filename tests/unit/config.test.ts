import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { ConfigurationError, loadConfig } from '../../src/config/index.ts';
import { cajasPath, testEnvironment } from '../helpers/config.ts';

test('config_resuelve_cuatro_cajas_y_limites_desde_entorno', () => {
  const env = testEnvironment();
  const config = loadConfig(env, { cajasPath });
  assert.deepEqual(config.cajas.map(caja => caja.id), ['NORTE', 'ORIENTE', 'CENTRO', 'SUR']);
  assert.equal(config.cajas[0]?.protocol, 'REST_NORTE');
  const norte = config.cajas.find(caja => caja.id === 'NORTE');
  assert.equal(norte?.baseUrl, env['CAJA_NORTE_URL']);
  assert.equal(config.cajas.find(caja => caja.id === 'SUR')?.enabled, false);
  assert.ok(config.query.totalTimeoutMs < 5000);
  assert.ok(config.query.originTimeoutMs <= config.query.totalTimeoutMs);
});
test('config_activa_sur_solo_por_entorno', () => {
  const env: Record<string, string> = { ...testEnvironment(), CAJA_SUR_ENABLED: 'true' };
  const sur = loadConfig(env, { cajasPath }).cajas.find(caja => caja.id === 'SUR');
  assert.equal(sur?.enabled, true);
  assert.equal(sur?.baseUrl, env['CAJA_SUR_URL']);
  assert.equal(sur?.token, env['CAJA_SUR_TOKEN']);
});
test('config_exige_credenciales_sur_cuando_esta_habilitada', () => {
  const env = { ...testEnvironment(), CAJA_SUR_ENABLED: 'true', CAJA_SUR_TOKEN: '' };
  assert.throws(() => loadConfig(env, { cajasPath }), ConfigurationError);
});
test('config_rechaza_tokens_ambiguos_y_credenciales_vacias', () => {
  const env = testEnvironment();
  env['ADMIN_TOKEN'] = env['NORTE_TOKEN']!;
  assert.throws(() => loadConfig(env, { cajasPath }), /distintos/u);
  env['NORTE_TOKEN'] = '';
  assert.throws(() => loadConfig(env, { cajasPath }), /NORTE_TOKEN/u);
});
test('config_permite_arranque_desde_env_example_del_kit', async () => {
  const text = await readFile(new URL('../../.env.example', import.meta.url), 'utf8');
  const entries = text.split(/\r?\n/u).filter(line => line && !line.startsWith('#')).map(line => {
    const index = line.indexOf('=');
    return [line.slice(0, index), line.slice(index + 1)] as const;
  });
  const config = loadConfig(Object.fromEntries(entries), { cajasPath });
  assert.equal(config.server.port, 8083);
  assert.equal(config.cajas.length, 4);
});
test('config_falla_antes_de_arrancar_si_falta_un_origen', () => {
  const env = testEnvironment();
  delete env['CAJA_NORTE_URL'];
  assert.throws(() => loadConfig(env, { cajasPath }), /CAJA_NORTE_URL/u);
});
test('config_no_filtra_urls_ni_credenciales_en_errores', () => {
  const env = testEnvironment();
  const credential = env['CAJA_NORTE_API_KEY']!;
  env['CAJA_NORTE_URL'] = `https://test:${credential}@example.invalid?document=12345678`;
  assert.throws(() => loadConfig(env, { cajasPath }), (error: unknown) => {
    assert.ok(error instanceof ConfigurationError);
    assert.ok(!error.message.includes(credential));
    assert.ok(!error.message.includes('12345678'));
    return true;
  });
});
test('config_rechaza_presupuesto_mayor_o_igual_a_cinco_segundos', () => {
  const env = testEnvironment();
  for (const value of ['5000', '9000', '-1', '1e3', 'NaN']) {
    assert.throws(() => loadConfig({ ...env, QUERY_TOTAL_TIMEOUT_MS: value }, { cajasPath }), ConfigurationError);
  }
  assert.throws(() => loadConfig({ ...env, QUERY_TOTAL_TIMEOUT_MS: '2000', ORIGIN_TIMEOUT_MS: '3500' }, { cajasPath }), ConfigurationError);
});
test('config_rechaza_booleanos_concurrencia_y_puertos_invalidos', () => {
  const env = testEnvironment();
  for (const invalid of [{ CAJA_SUR_ENABLED: 'yes' }, { QUERY_CONCURRENCY: '0' }, { PORT: '65536' }, { BATCH_CONCURRENCY: '65' }]) {
    assert.throws(() => loadConfig({ ...env, ...invalid }, { cajasPath }), ConfigurationError);
  }
});
test('config_rechaza_yaml_incompleto_duplicado_y_claves_desconocidas', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'caja-link-config-'));
  const path = join(directory, 'cajas.yaml');
  try {
    for (const yaml of ['version: 1\ncajas: []\n', 'version: 1\nversion: 1\ncajas: []\n', 'version: 1\ncajas: []\nunknown: true\n']) {
      await writeFile(path, yaml);
      assert.throws(() => loadConfig(testEnvironment(), { cajasPath: path }), ConfigurationError);
    }
    assert.throws(() => loadConfig(testEnvironment(), { cajasPath: join(directory, 'absent.yaml') }), ConfigurationError);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
