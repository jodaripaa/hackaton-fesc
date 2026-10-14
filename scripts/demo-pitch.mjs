import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

// Run in the Compose tests service: credentials stay in its environment.
const required = name => {
  const value = process.env[name];
  assert.ok(value, `Falta ${name}; ejecutar dentro del servicio tests de Compose`);
  return value;
};
const base = required('TEST_SERVICE_URL');
const norte = required('CAJA_NORTE_URL');
const purpose = 'VALIDACION_AFILIACION';
const metadata = JSON.parse(await readFile('.validator.json', 'utf8'));
assert.match(metadata.centro_document, /^\d{1,12}$/u);
const directory = 'test-results/pitch-demo';
await mkdir(directory, { recursive: true });

async function query(path, token) {
  const response = await fetch(new URL(path, base), {
    headers: { Authorization: `Bearer ${required(token)}` },
    signal: AbortSignal.timeout(7000),
  });
  assert.equal(response.status, 200, 'La API de Caja Link debe responder 200');
  return response.json();
}
async function save(name, response) {
  await writeFile(`${directory}/${name}.json`, `${JSON.stringify(response, null, 2)}\n`);
  console.log(`\n${name}\n${JSON.stringify(response, null, 2)}`);
}
async function chaos(mode) {
  const response = await fetch(new URL('/__chaos', norte), {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode }), signal: AbortSignal.timeout(7000),
  });
  assert.equal(response.status, 200, 'El simulador Norte debe aceptar el modo de demo');
}

const affiliation = await query(`/api/v2/affiliations/${metadata.centro_document}?purpose=${purpose}`, 'NORTE_TOKEN');
assert.equal(affiliation.result, 'AFILIADO_OTRA_CAJA');
assert.ok(affiliation.matches.some(match => match.caja === 'CENTRO' && match.affiliateType));
await save('01-consulta-v2', affiliation);
try {
  await chaos('down');
  const unavailable = await query(`/api/v2/affiliations/999999999999?purpose=${purpose}`, 'CENTRO_TOKEN');
  assert.equal(unavailable.result, 'INDETERMINADO');
  assert.ok(unavailable.unavailable.includes('NORTE'));
  await save('02-caja-indisponible', unavailable);
} finally {
  await chaos('ok');
}
const audit = await query('/api/v1/audit?limit=1', 'ADMIN_TOKEN');
assert.ok(Array.isArray(audit) && audit.length === 1);
assert.match(audit[0].documentMasked, /^[^0-9]*[0-9]{0,4}$/u);
await save('03-auditoria', audit);
console.log('\nNorte restaurado a modo ok. La medición histórica del lote está en docs/evidence/load-test.json.');
