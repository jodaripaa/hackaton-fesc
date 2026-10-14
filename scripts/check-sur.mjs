import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';

process.loadEnvFile('.env');
assert.equal(process.env.CAJA_SUR_ENABLED, 'true', 'Activate Sur before this check');
const source = `http://127.0.0.1:${process.env.CAJA_SUR_PORT || '9004'}`;
const target = 'http://127.0.0.1:8083';
const document = process.argv[2] || '999999999999';
assert.match(document, /^\d{1,12}$/);
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(new Date());
const reference = await fetch(`${source}/v2/people/${document}/memberships`, {
  headers: { Authorization: `Bearer ${process.env.CAJA_SUR_TOKEN}` }, signal: AbortSignal.timeout(4500),
});
assert.ok([200, 404].includes(reference.status));
const active = reference.status === 200
  ? (await reference.json()).memberships.find(row => row.start <= today && (row.end === null || row.end >= today))
  : undefined;
const query = async (version, token) => {
  const response = await fetch(`${target}/api/${version}/affiliations/${document}?purpose=VALIDACION_AFILIACION`, {
    headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(4900),
  });
  assert.equal(response.status, 200);
  return response.json();
};
const checks = [];
const v1 = await query('v1', process.env.NORTE_TOKEN);
assert.ok(!v1.unavailable.includes('SUR'));
assert.ok(v1.matches.every(match => !Object.hasOwn(match, 'affiliateType')));
checks.push('Healthy Sur is consulted through configured REST origin', 'v1 does not expose affiliateType');
if (active) {
  const matchV1 = v1.matches.find(match => match.caja === 'SUR');
  assert.ok(matchV1);
  assert.deepEqual(Object.keys(matchV1).sort(), ['asOf', 'caja', 'source', 'validFrom', 'validTo']);
  const matchV2 = (await query('v2', process.env.NORTE_TOKEN)).matches.find(match => match.caja === 'SUR');
  const types = { DEPENDENT: 'DEPENDIENTE', SELF_EMPLOYED: 'INDEPENDIENTE', RETIREE: 'PENSIONADO' };
  assert.equal(matchV2?.affiliateType, types[active.category]);
  assert.equal(matchV2?.source, 'ONLINE');
  assert.equal(matchV2?.asOf, today);
  checks.push('Active Sur membership appears in v1 and maps category in v2');
} else {
  assert.ok(v1.matches.every(match => match.caja !== 'SUR'));
  checks.push('Sur with no current membership does not create a match');
}
const chaos = async mode => {
  const response = await fetch(`${source}/__chaos`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode }), signal: AbortSignal.timeout(4500),
  });
  assert.equal(response.status, 200);
};
try {
  await chaos('down');
  const failed = await query('v2', process.env.NORTE_TOKEN);
  assert.ok(failed.unavailable.includes('SUR'));
  assert.notEqual(failed.result, 'NO_AFILIADO');
  checks.push('Unavailable configured Sur prevents false NO_AFILIADO');
  const own = await query('v2', process.env.SUR_TOKEN);
  assert.ok(own.matches.every(match => match.caja !== 'SUR'));
  assert.ok(own.unavailable.every(caja => caja !== 'SUR'));
  checks.push('Sur consumer excludes its own origin even during failure');
} finally {
  await chaos('ok');
}
const evidence = { checkedAt: new Date().toISOString(), checks, passed: checks.length, activeMembershipObserved: Boolean(active) };
await writeFile('test-results/sur-check.json', `${JSON.stringify(evidence, null, 2)}\n`);
console.log(JSON.stringify(evidence));
