import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { performance } from 'node:perf_hooks';
import test from 'node:test';
import type { TestContext } from 'node:test';
import { buildApp } from '../../src/app.ts';
import { createAdapters } from '../../src/adapters/index.ts';
import { createAffiliationService } from '../../src/application/affiliations.ts';
import { loadConfig } from '../../src/config/index.ts';
import type { AuditRecord, CajaAdapter, CajaId } from '../../src/domain/types.ts';
import { createAffiliationRoutes } from '../../src/routes/affiliations.ts';
import { createAuditRoutes } from '../../src/routes/audit.ts';
import { createSecurity } from '../../src/security/index.ts';
import { cajasPath, testEnvironment } from '../helpers/config.ts';

// Real HTTP Sur adapter + domain + security + routes. Other origins and audit
// persistence are isolated fixtures; no mock dataset or live caja is accessed.
async function fixture(t: TestContext) {
  const env = testEnvironment();
  let mode: 'ok' | 'down' | 'slow' = 'ok';
  let requests = 0;
  const source = createServer((request, response) => {
    requests += 1;
    if (request.headers.authorization !== `Bearer ${env['CAJA_SUR_TOKEN']}`) {
      response.writeHead(401).end(); return;
    }
    if (mode === 'down') { response.writeHead(503).end(); return; }
    if (mode === 'slow') return; // Adapter deadline must cancel this socket.
    if (request.url !== '/v2/people/123456789/memberships') { response.writeHead(404).end(); return; }
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ person: { id: '123456789', name: 'SYNTHETIC_PRIVATE' },
      memberships: [{ start: '2026-01-01', end: null, category: 'SELF_EMPLOYED' }] }));
  });
  await new Promise<void>((resolve, reject) => {
    source.once('error', reject);
    source.listen(0, '127.0.0.1', () => { source.removeListener('error', reject); resolve(); });
  });
  t.after(async () => {
    source.closeAllConnections();
    await new Promise<void>((resolve, reject) => source.close(error => error ? reject(error) : resolve()));
  });
  const address = source.address();
  assert.ok(address && typeof address !== 'string');
  env['CAJA_SUR_URL'] = `http://127.0.0.1:${address.port}`;
  env['ORIGIN_TIMEOUT_MS'] = '500';
  env['QUERY_TOTAL_TIMEOUT_MS'] = '2000';

  function application(enabled: boolean) {
    const config = loadConfig({ ...env, CAJA_SUR_ENABLED: String(enabled) }, { cajasPath });
    const originals: CajaAdapter[] = (['NORTE', 'ORIENTE', 'CENTRO'] as const).map(caja => ({
      caja, lookup: async () => ({ status: 'ok', caja, affiliations: [] }),
    }));
    const adapters = [...originals, ...createAdapters(config.cajas.filter(caja => caja.id === 'SUR'), config.query)];
    const records: AuditRecord[] = [];
    const audit = { append: async (record: AuditRecord) => { records.push(record); },
      list: async (limit: number) => records.slice(-limit).reverse() };
    const security = createSecurity(config.auth);
    const service = createAffiliationService({ adapters, query: config.query, audit });
    const app = buildApp({ config, logger: false,
      persistence: { ping: async () => true, close: async () => {} },
      modules: { affiliations: createAffiliationRoutes({ service, security, clock: () => new Date('2026-10-15T17:00:00Z') }),
        audit: createAuditRoutes({ repository: audit, security }) } });
    t.after(async () => { await app.close(); await Promise.all(adapters.map(adapter => adapter.close?.())); });
    async function query(version = 'v2', caja: CajaId = 'NORTE', document = '123456789') {
      const response = await app.inject({ url: `/api/${version}/affiliations/${document}?purpose=VALIDACION_AFILIACION`,
        headers: { authorization: `Bearer ${config.auth.consumerTokens[caja]}` } });
      assert.equal(response.statusCode, 200);
      assert.ok(!response.body.includes('SYNTHETIC_PRIVATE'));
      return response.json();
    }
    return { app, config, query, records };
  }
  return { application, requests: () => requests, mode: (value: typeof mode) => { mode = value; } };
}

test('sur_configuracion_habilita_cuarta_caja_al_recrear_aplicacion', { timeout: 10000 }, async t => {
  const fixtureSur = await fixture(t);
  const disabled = fixtureSur.application(false);
  assert.equal((await disabled.query()).result, 'NO_AFILIADO');
  assert.equal(fixtureSur.requests(), 0);
  const enabled = fixtureSur.application(true);
  const response = await enabled.query();
  assert.equal(response.result, 'AFILIADO_OTRA_CAJA');
  assert.deepEqual(response.unavailable, []);
  assert.deepEqual(response.matches, [{ caja: 'SUR', validFrom: '2026-01-01', validTo: null,
    source: 'ONLINE', asOf: '2026-10-15', affiliateType: 'INDEPENDIENTE' }]);
  assert.equal(fixtureSur.requests(), 1);
});

test('sur_http_conserva_v1_normaliza_v2_y_audita_sin_documento_completo', { timeout: 10000 }, async t => {
  const { application } = await fixture(t);
  const { app, config, query } = application(true);
  const v1 = await query('v1');
  const v2 = await query('v2', 'NORTE', '000.123.456.789');
  assert.equal(v2.matches[0].affiliateType, 'INDEPENDIENTE');
  const { affiliateType: _, ...minimum } = v2.matches[0];
  assert.deepEqual(v1.matches, [minimum]);
  const audit = await app.inject({ url: '/api/v1/audit?limit=1',
    headers: { authorization: `Bearer ${config.auth.adminToken}` } });
  assert.equal(audit.statusCode, 200);
  assert.deepEqual(audit.json()[0].documentMasked, '*****6789');
  assert.ok(!audit.body.includes('123456789'));
  assert.ok(!audit.body.includes('requestId'));
});

test('sur_caida_y_lentitud_no_producen_falso_negativo_y_se_recuperan', { timeout: 10000 }, async t => {
  const fixtureSur = await fixture(t);
  const { query } = fixtureSur.application(true);
  for (const mode of ['down', 'slow'] as const) {
    fixtureSur.mode(mode);
    const began = performance.now();
    const response = await query();
    assert.equal(response.result, 'INDETERMINADO');
    assert.deepEqual(response.matches, []);
    assert.deepEqual(response.unavailable, ['SUR']);
    assert.ok(performance.now() - began < 2500, 'The HTTP origin deadline must bound latency');
  }
  fixtureSur.mode('ok');
  assert.equal((await query()).result, 'AFILIADO_OTRA_CAJA');
});

test('sur_consumidor_excluye_su_origen_incluso_cuando_falla', { timeout: 10000 }, async t => {
  const fixtureSur = await fixture(t);
  const { query } = fixtureSur.application(true);
  fixtureSur.mode('down');
  const response = await query('v2', 'SUR');
  assert.equal(response.result, 'NO_AFILIADO');
  assert.deepEqual(response.matches, []);
  assert.deepEqual(response.unavailable, []);
  assert.equal(fixtureSur.requests(), 0);
});
