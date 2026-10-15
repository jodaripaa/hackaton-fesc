import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';

if (existsSync('.env')) process.loadEnvFile('.env');
const base = process.env.TEST_SERVICE_URL || 'http://127.0.0.1:8083';
const document = '999999999999';
const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(new Date());
const query = async (version, caja, input = document) => {
  const response = await fetch(new URL(`/api/${version}/affiliations/${encodeURIComponent(input)}?purpose=VALIDACION_AFILIACION`, base), {
    headers: { Authorization: `Bearer ${process.env[`${caja}_TOKEN`]}` }, signal: AbortSignal.timeout(4900),
  });
  assert.equal(response.status, 200);
  return response.json();
};
const expected = { caja: 'SUR', validFrom: '2026-01-01', validTo: null, source: 'ONLINE', asOf: date };
const v1 = await query('v1', 'NORTE');
assert.equal(v1.result, 'AFILIADO_OTRA_CAJA');
assert.deepEqual(v1.matches, [expected]);
assert.deepEqual(v1.unavailable, []);
const v2 = await query('v2', 'NORTE');
assert.deepEqual(v2.matches, [{ ...expected, affiliateType: 'INDEPENDIENTE' }]);
assert.deepEqual((await query('v2', 'NORTE', `000.${document}`)).matches, v2.matches);
const own = await query('v2', 'SUR');
assert.equal(own.result, 'NO_AFILIADO');
assert.deepEqual(own.matches, []);
assert.deepEqual(own.unavailable, []);
const checks = ['positive membership through complete service', 'minimum v1 DTO',
  'v2 category mapping', 'normalization', 'own caja exclusion'];
if (process.env.SUR_FIXTURE_URL) {
  const chaos = async mode => {
    const response = await fetch(new URL('/__chaos', process.env.SUR_FIXTURE_URL), {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.CAJA_SUR_TOKEN}` },
      body: JSON.stringify({ mode }), signal: AbortSignal.timeout(4900),
    });
    assert.equal(response.status, 200);
  };
  try {
    for (const mode of ['down', 'slow']) {
      await chaos(mode);
      const began = performance.now();
      const failed = await query('v2', 'NORTE');
      assert.equal(failed.result, 'INDETERMINADO');
      assert.deepEqual(failed.matches, []);
      assert.deepEqual(failed.unavailable, ['SUR']);
      assert.ok(performance.now() - began < 5000);
      checks.push(`synthetic Sur ${mode} prevents false negative within deadline`);
    }
    const excluded = await query('v2', 'SUR');
    assert.equal(excluded.result, 'NO_AFILIADO');
    assert.deepEqual(excluded.unavailable, []);
    checks.push('Sur consumer excludes its own unavailable origin');
  } finally { await chaos('ok'); }
  assert.equal((await query('v2', 'NORTE')).result, 'AFILIADO_OTRA_CAJA');
  checks.push('synthetic Sur recovers after chaos');
}
const evidence = { checkedAt: new Date().toISOString(), source: 'wholly synthetic REST Sur fixture',
  configurationOnly: true, checks, passed: checks.length,
  officialP14Executed: false };
await mkdir('test-results', { recursive: true });
await writeFile('test-results/sur-fixture-check.json', `${JSON.stringify(evidence, null, 2)}\n`);
console.log(JSON.stringify(evidence));
