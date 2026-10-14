import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';

process.loadEnvFile('.env');
const document = '999999999999';
const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(new Date());
const query = async (version, caja, input = document) => {
  const response = await fetch(`http://127.0.0.1:8083/api/${version}/affiliations/${encodeURIComponent(input)}?purpose=VALIDACION_AFILIACION`, {
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
const evidence = { checkedAt: new Date().toISOString(), source: 'wholly synthetic REST Sur fixture',
  configurationOnly: true, checks: ['positive membership through complete service', 'minimum v1 DTO',
    'v2 category mapping', 'normalization', 'own caja exclusion'], passed: 5,
  officialP14Executed: false };
await writeFile('test-results/sur-fixture-check.json', `${JSON.stringify(evidence, null, 2)}\n`);
console.log(JSON.stringify(evidence));
