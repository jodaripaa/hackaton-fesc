import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtemp, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { basename, dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { test as nodeTest } from 'node:test';
import type { TestContext } from 'node:test';
import { XMLParser } from 'fast-xml-parser';
import type { AppConfig, CajaConfig } from '../../src/config/types.ts';
import type { AdapterContext, AdapterResult, CajaAdapter, NormalizedDocument } from '../../src/domain/types.ts';
import { createAdapters } from '../../src/adapters/index.ts';
import { MAX_CENTRO_BYTES } from '../../src/adapters/centro.ts';
import { MAX_RESPONSE_BYTES } from '../../src/adapters/http.ts';

const document = '123456789' as NormalizedDocument;
const query: AppConfig['query'] = { totalTimeoutMs: 4500, originTimeoutMs: 3500, concurrency: 64, originConcurrency: 32 };
const fixtureXml = await readFile(new URL('../fixtures/adapters/oriente.xml', import.meta.url), 'utf8');
const fixtureCentro = await readFile(new URL('../fixtures/adapters/centro.txt', import.meta.url), 'utf8');
const soapNamespace = 'http://schemas.xmlsoap.org/soap/envelope/';
const orienteNamespace = 'http://cajaoriente.example/afiliacion';

function test(name: string, run: (t: TestContext) => void | Promise<void>) {
  return nodeTest(name, { timeout: 10_000 }, run);
}

function context(milliseconds = 2000, signal = new AbortController().signal): AdapterContext {
  return { requestId: 'synthetic-request', asOf: '2026-10-14', deadlineAt: Date.now() + milliseconds, signal };
}

function successful(result: AdapterResult) {
  assert.equal(result.status, 'ok', JSON.stringify(result));
  if (result.status !== 'ok') throw new Error('Expected successful synthetic lookup');
  return result.affiliations;
}

function unavailable(result: AdapterResult, reason?: string): void {
  assert.equal(result.status, 'unavailable');
  if (result.status !== 'unavailable') throw new Error('Expected explicit unavailability');
  if (reason) assert.equal(result.reason, reason);
  assert.deepEqual(Object.keys(result).sort(), ['caja', 'reason', 'status']);
}

function minimumFields(result: AdapterResult): void {
  for (const row of successful(result)) {
    assert.deepEqual(Object.keys(row).sort(), ['affiliateType', 'asOf', 'caja', 'source', 'validFrom', 'validTo']);
  }
  assert.equal(JSON.stringify(result).includes('NO_PUBLICAR'), false);
}

async function server(t: TestContext, handler: (request: IncomingMessage, response: ServerResponse) => void | Promise<void>): Promise<string> {
  const instance = createServer((request, response) => {
    void Promise.resolve(handler(request, response)).catch(() => response.destroy());
  });
  await new Promise<void>((resolve, reject) => {
    instance.once('error', reject);
    instance.listen(0, '127.0.0.1', () => { instance.removeListener('error', reject); resolve(); });
  });
  t.after(async () => {
    instance.closeAllConnections();
    await new Promise<void>((resolve, reject) => instance.close(error => error ? reject(error) : resolve()));
  });
  const address = instance.address();
  if (address === null || typeof address === 'string') throw new Error('Synthetic server failed');
  return `http://127.0.0.1:${address.port}`;
}

function adapter(t: TestContext, config: CajaConfig, options = query): CajaAdapter {
  const instance = createAdapters([config], options)[0];
  if (!instance) throw new Error('Missing synthetic adapter');
  t.after(() => instance.close?.());
  return instance;
}

function norte(t: TestContext, baseUrl: string, options = query, apiKey = randomBytes(24).toString('hex')): CajaAdapter {
  return adapter(t, { id: 'NORTE', protocol: 'REST_NORTE', enabled: true, baseUrl, apiKey }, options);
}

function oriente(t: TestContext, endpoint: string, username = 'synthetic-user', password = randomBytes(24).toString('hex')): CajaAdapter {
  return adapter(t, { id: 'ORIENTE', protocol: 'SOAP_ORIENTE', enabled: true, endpoint, username, password });
}

function json(response: ServerResponse, value: unknown, status = 200): void {
  response.writeHead(status, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify(value));
}

function xml(response: ServerResponse, body: string, status = 200): void {
  response.writeHead(status, { 'Content-Type': 'text/xml; charset=utf-8' });
  response.end(body);
}

function nortePayload(): Record<string, unknown> {
  return {
    documento: document,
    titular: { nombre: 'NO_PUBLICAR', direccion: 'NO_PUBLICAR', telefono: 'NO_PUBLICAR', correo: 'NO_PUBLICAR', salario: 1000, beneficiarios: ['NO_PUBLICAR'] },
    afiliaciones: [
      { fechaInicio: '2024-02-29', fechaFin: null, tipoAfiliado: 'DEPENDIENTE', estado: 'VIGENTE' },
      { fechaInicio: '2020-01-01', fechaFin: '2022-12-31', tipoAfiliado: 'INDEPENDIENTE', estado: 'HISTORICA' },
      { fechaInicio: '2027-01-01', fechaFin: null, tipoAfiliado: 'PENSIONADO', estado: 'VIGENTE' },
    ],
  };
}

function soapResponse(body: string): string {
  return `<s:Envelope xmlns:s="${soapNamespace}" xmlns:a="${orienteNamespace}"><s:Body><a:ConsultarAfiliacionResponse>${body}</a:ConsultarAfiliacionResponse></s:Body></s:Envelope>`;
}

async function centro(t: TestContext): Promise<{ directory: string; instance: CajaAdapter }> {
  const directory = await mkdtemp(join(tmpdir(), 'caja-link-adapters-'));
  t.after(async () => {
    assert.equal(dirname(directory), tmpdir());
    assert.ok(basename(directory).startsWith('caja-link-adapters-'));
    await rm(directory, { recursive: true, force: true });
  });
  const instance = adapter(t, { id: 'CENTRO', protocol: 'FILE_CENTRO', enabled: true, directory });
  return { directory, instance };
}

test('adapters_factory_respects_configuration_and_sur_enabled', async t => {
  const configs: CajaConfig[] = [
    { id: 'NORTE', protocol: 'REST_NORTE', enabled: true, baseUrl: 'http://synthetic.invalid', apiKey: randomBytes(24).toString('hex') },
    { id: 'ORIENTE', protocol: 'SOAP_ORIENTE', enabled: true, endpoint: 'http://synthetic.invalid/service', username: 'synthetic', password: randomBytes(24).toString('hex') },
    { id: 'CENTRO', protocol: 'FILE_CENTRO', enabled: true, directory: join(tmpdir(), 'synthetic-absent-publication') },
    { id: 'SUR', protocol: 'REST_SUR', enabled: false, baseUrl: undefined, token: undefined },
  ];
  const disabled = createAdapters(configs, query);
  t.after(async () => { await Promise.all(disabled.map(item => item.close?.())); });
  assert.deepEqual(disabled.map(item => item.caja), ['NORTE', 'ORIENTE', 'CENTRO']);
  const enabled = createAdapters([...configs.slice(0, 3), { id: 'SUR', protocol: 'REST_SUR', enabled: true, baseUrl: 'http://synthetic.invalid', token: randomBytes(24).toString('hex') }], query);
  t.after(async () => { await Promise.all(enabled.map(item => item.close?.())); });
  assert.deepEqual(enabled.map(item => item.caja), ['NORTE', 'ORIENTE', 'CENTRO', 'SUR']);
  assert.throws(() => createAdapters([{ id: 'SUR', protocol: 'REST_SUR', enabled: true, baseUrl: undefined, token: undefined }], query));
  assert.throws(() => createAdapters([configs[0]!, configs[0]!], query));
});

test('adapters_norte_real_http_credentials_history_and_minimum_data', async t => {
  const key = randomBytes(24).toString('hex');
  const url = await server(t, (request, response) => {
    assert.equal(request.method, 'GET');
    assert.equal(request.url, `/api/v1/afiliados/${document}`);
    assert.equal(request.headers['x-api-key'], key);
    json(response, nortePayload());
  });
  const result = await norte(t, url, query, key).lookup(document, context());
  const rows = successful(result);
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.map(row => row.affiliateType), ['DEPENDIENTE', 'INDEPENDIENTE', 'PENSIONADO']);
  assert.deepEqual(rows.map(row => row.validTo), [null, '2022-12-31', null]);
  assert.ok(rows.every(row => row.asOf === '2026-10-14' && row.source === 'ONLINE' && row.caja === 'NORTE'));
  minimumFields(result);
});

test('adapters_rest_absence_requires_valid_404_or_valid_empty_response', async t => {
  let status = 404;
  let body: unknown = { error: 'NO_ENCONTRADO' };
  const url = await server(t, (_request, response) => json(response, body, status));
  const instance = norte(t, url);
  assert.deepEqual(successful(await instance.lookup(document, context())), []);
  status = 200; body = { documento: document, afiliaciones: [] };
  assert.deepEqual(successful(await instance.lookup(document, context())), []);
  status = 404; body = { error: 'unknown_resource' };
  unavailable(await instance.lookup(document, context()), 'INVALID_RESPONSE');
  body = 'not-an-object';
  unavailable(await instance.lookup(document, context()), 'INVALID_RESPONSE');
});

test('adapters_sur_bearer_categories_identity_and_valid_absence', async t => {
  const token = randomBytes(24).toString('hex');
  let missing = false;
  let category = 'DEPENDENT';
  const url = await server(t, (request, response) => {
    assert.equal(request.url, `/v2/people/${document}/memberships`);
    assert.equal(request.headers.authorization, `Bearer ${token}`);
    if (missing) { json(response, { error: 'person_not_found' }, 404); return; }
    json(response, {
      person: { id: document, fullName: 'NO_PUBLICAR', email: 'NO_PUBLICAR', monthlySalary: 123 },
      memberships: ['DEPENDENT', 'SELF_EMPLOYED', 'RETIREE'].map((value, index) => ({
        start: '2024-02-29', end: null, category: index === 0 ? category : value,
      })),
    });
  });
  const instance = adapter(t, { id: 'SUR', protocol: 'REST_SUR', enabled: true, baseUrl: url, token });
  const result = await instance.lookup(document, context());
  assert.deepEqual(successful(result).map(row => row.affiliateType), ['DEPENDIENTE', 'INDEPENDIENTE', 'PENSIONADO']);
  minimumFields(result);
  category = 'UNKNOWN'; unavailable(await instance.lookup(document, context()), 'INVALID_RESPONSE');
  missing = true; assert.deepEqual(successful(await instance.lookup(document, context())), []);
});

test('adapters_oriente_soap_header_escape_padding_namespaces_dates_and_types', async t => {
  const username = 'user<&"';
  const password = `${randomBytes(24).toString('hex')}<&>'`;
  const url = await server(t, async (request, response) => {
    assert.equal(request.method, 'POST');
    assert.equal(request.headers.soapaction, 'ConsultarAfiliacion');
    assert.ok(request.headers['content-type']?.startsWith('text/xml'));
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(chunk as Buffer);
    const body = Buffer.concat(chunks).toString('utf8');
    assert.equal(body.includes('<&>'), false);
    const parsed = new XMLParser({ removeNSPrefix: true, parseTagValue: false }).parse(body) as {
      Envelope: { Header: { Credenciales: { Usuario: string; Clave: string } }; Body: { ConsultarAfiliacionRequest: { NumeroDocumento: string } } };
    };
    assert.equal(parsed.Envelope.Header.Credenciales.Usuario, username);
    assert.equal(parsed.Envelope.Header.Credenciales.Clave, password);
    assert.equal(parsed.Envelope.Body.ConsultarAfiliacionRequest.NumeroDocumento, '000123456789');
    xml(response, fixtureXml);
  });
  const result = await oriente(t, `${url}/service`, username, password).lookup(document, context());
  const rows = successful(result);
  assert.deepEqual(rows.map(row => row.affiliateType), ['DEPENDIENTE', 'INDEPENDIENTE', 'PENSIONADO']);
  assert.equal(rows[0]?.validFrom, '2024-02-29');
  assert.equal(rows[1]?.validTo, '2022-12-31');
  assert.equal(rows[2]?.validFrom, '2027-01-01');
  minimumFields(result);
});

test('adapters_oriente_valid_false_empty_and_default_namespace', async t => {
  let body = soapResponse('<a:Encontrado>false</a:Encontrado>');
  const url = await server(t, (_request, response) => xml(response, body));
  const instance = oriente(t, url);
  assert.deepEqual(successful(await instance.lookup(document, context())), []);
  body = fixtureXml.replace(`xmlns:a="${orienteNamespace}"`, `xmlns="${orienteNamespace}"`).replaceAll('a:', '');
  assert.equal(successful(await instance.lookup(document, context())).length, 3);
  body = soapResponse('<a:Encontrado>true</a:Encontrado><a:Persona><a:Afiliaciones/></a:Persona>');
  assert.deepEqual(successful(await instance.lookup(document, context())), []);
});

test('adapters_oriente_rejects_dtd_entities_malformed_structure_and_invalid_fields', async t => {
  let body = '';
  const url = await server(t, (_request, response) => xml(response, body));
  const instance = oriente(t, url);
  const invalid = [
    '<!DOCTYPE Envelope [<!ENTITY x SYSTEM "file:///synthetic-private">]>' + fixtureXml,
    '<!ENTITY x "synthetic">' + fixtureXml,
    fixtureXml.replace('Persona &amp; prueba privada', '&undefined;'),
    fixtureXml.replace(orienteNamespace, 'urn:wrong-namespace'),
    fixtureXml.replace(` xmlns:a="${orienteNamespace}"`, ''),
    fixtureXml.replace('<a:Encontrado>true</a:Encontrado>', ''),
    fixtureXml.replace('<a:Encontrado>true</a:Encontrado>', '<a:Encontrado>true</a:Encontrado><a:Encontrado>false</a:Encontrado>'),
    fixtureXml.replace('29/02/2024', '29/02/2023'),
    fixtureXml.replace('<a:TipoAfiliado>D</a:TipoAfiliado>', '<a:TipoAfiliado>X</a:TipoAfiliado>'),
    fixtureXml.replace('<a:FechaRetiro/>', ''),
    fixtureXml.replace('000.123.456.789', '000.987.654.321'),
    soapResponse('<a:Encontrado>false</a:Encontrado><a:Persona/>'),
    '<s:Envelope>',
    `<s:Envelope xmlns:s="${soapNamespace}"><s:Body/><s:Body/></s:Envelope>`,
  ];
  for (const [index, candidate] of invalid.entries()) {
    body = candidate;
    await t.test(`invalid_soap_case_${index}`, async () => unavailable(await instance.lookup(document, context()), 'INVALID_RESPONSE'));
  }
});

test('adapters_oriente_fault_is_unavailable_even_with_http_200', async t => {
  let status = 200;
  const fault = `<s:Envelope xmlns:s="${soapNamespace}"><s:Body><s:Fault><faultcode>s:Server</faultcode><faultstring>NO_PUBLICAR</faultstring></s:Fault></s:Body></s:Envelope>`;
  const url = await server(t, (_request, response) => xml(response, fault, status));
  const instance = oriente(t, url);
  unavailable(await instance.lookup(document, context()), 'UNAVAILABLE');
  status = 500; unavailable(await instance.lookup(document, context()), 'UNAVAILABLE');
});

test('adapters_norte_invalid_calendar_period_enum_identity_and_structure_are_unavailable', async t => {
  let body: unknown = {};
  const url = await server(t, (_request, response) => json(response, body));
  const instance = norte(t, url);
  const row = { fechaInicio: '2024-02-29', fechaFin: null, tipoAfiliado: 'DEPENDIENTE', estado: 'VIGENTE' };
  const invalid = [
    null, [], { documento: document }, { documento: 'another', afiliaciones: [] },
    { documento: '999999999', afiliaciones: [] }, { documento: document, afiliaciones: {} },
    ...[
      { fechaInicio: '2023-02-29' }, { fechaInicio: '0000-01-01' }, { fechaInicio: '2024-13-01' },
      { fechaFin: '2024-02-30' }, { fechaFin: '2020-01-01' }, { fechaFin: '' },
      { tipoAfiliado: 'UNKNOWN' }, { estado: 'UNKNOWN' }, { fechaInicio: 20240229 },
    ].map(changes => ({ documento: document, afiliaciones: [row, { ...row, ...changes }] })),
  ];
  for (const [index, candidate] of invalid.entries()) {
    body = candidate;
    await t.test(`invalid_rest_case_${index}`, async () => unavailable(await instance.lookup(document, context()), 'INVALID_RESPONSE'));
  }
});

test('adapters_http_errors_and_redirect_never_become_absence', async t => {
  let status = 503;
  let calls = 0;
  const url = await server(t, (_request, response) => {
    calls++;
    response.writeHead(status, { Location: '/other-endpoint' }); response.end();
  });
  const instance = norte(t, url);
  for (const code of [503, 500, 400, 401, 403, 302]) {
    status = code;
    const before = calls;
    unavailable(await instance.lookup(document, context()), code === 401 || code === 403 ? 'AUTHENTICATION' : 'UNAVAILABLE');
    assert.equal(calls - before, 1);
  }
});

test('adapters_connection_interruption_is_unavailable', async t => {
  const url = await server(t, (_request, response) => { response.destroy(); });
  unavailable(await norte(t, url).lookup(document, context()), 'UNAVAILABLE');
});

test('adapters_sur_rejects_wrong_person_and_invalid_response_structure', async t => {
  let body: unknown = {};
  const url = await server(t, (_request, response) => json(response, body));
  const instance = adapter(t, {
    id: 'SUR', protocol: 'REST_SUR', enabled: true, baseUrl: url, token: randomBytes(24).toString('hex'),
  });
  for (const candidate of [
    { person: { id: '987654321' }, memberships: [] },
    { person: { id: document }, memberships: null },
    { person: { id: document }, memberships: [{ start: '2024-02-29', end: null, category: '__proto__' }] },
    { person: { id: document }, memberships: [{ start: '2024-02-29', end: '2020-01-01', category: 'RETIREE' }] },
  ]) {
    body = candidate;
    unavailable(await instance.lookup(document, context()), 'INVALID_RESPONSE');
  }
  body = { person: { id: document }, memberships: [] };
  assert.deepEqual(successful(await instance.lookup(document, context())), []);
});

test('adapters_http_body_limit_content_type_utf8_and_json_validation', async t => {
  let mode = 'length';
  const url = await server(t, (_request, response) => {
    if (mode === 'length') { response.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': MAX_RESPONSE_BYTES + 1 }); response.end(); }
    else if (mode === 'stream') { response.writeHead(200, { 'Content-Type': 'application/json' }); response.write('x'.repeat(MAX_RESPONSE_BYTES)); response.end('x'); }
    else if (mode === 'type') { response.writeHead(200, { 'Content-Type': 'text/html' }); response.end('<html>NO_PUBLICAR</html>'); }
    else if (mode === 'utf8') { response.writeHead(200, { 'Content-Type': 'application/json' }); response.end(Buffer.from([0xff])); }
    else { response.writeHead(200, { 'Content-Type': 'application/json' }); response.end('{invalid'); }
  });
  const instance = norte(t, url);
  for (const value of ['length', 'stream', 'type', 'utf8', 'json']) {
    mode = value;
    await t.test(`invalid_body_${value}`, async () => unavailable(await instance.lookup(document, context()), 'INVALID_RESPONSE'));
  }
});

test('adapters_deadline_covers_slow_headers_and_slow_body', async t => {
  let startedBody = false;
  const url = await server(t, (_request, response) => {
    if (startedBody) { response.writeHead(200, { 'Content-Type': 'application/json' }); response.write('{'); }
    // Deliberately leave open until cancellation. Test cleanup closes the server.
  });
  const instance = norte(t, url, { ...query, originTimeoutMs: 80 });
  for (const body of [false, true]) {
    startedBody = body;
    const before = Date.now();
    unavailable(await instance.lookup(document, context(1000)), 'TIMEOUT');
    assert.ok(Date.now() - before < 1000);
  }
});

test('adapters_cancel_in_flight_and_expired_or_preaborted_do_not_send_requests', async t => {
  let calls = 0;
  let arrived: (() => void) | undefined;
  const arrival = new Promise<void>(resolve => { arrived = resolve; });
  const url = await server(t, () => { calls++; arrived?.(); });
  const instance = norte(t, url);
  const cancelled = new AbortController(); cancelled.abort();
  unavailable(await instance.lookup(document, context(1000, cancelled.signal)), 'TIMEOUT');
  unavailable(await instance.lookup(document, context(-1)), 'TIMEOUT');
  assert.equal(calls, 0);
  const active = new AbortController();
  const pending = instance.lookup(document, context(1000, active.signal));
  await arrival; active.abort();
  unavailable(await pending, 'TIMEOUT');
  assert.equal(calls, 1);
});

test('adapters_origin_concurrency_queue_consumes_deadline', async t => {
  let calls = 0;
  let arrived: (() => void) | undefined;
  let answer: (() => void) | undefined;
  const arrival = new Promise<void>(resolve => { arrived = resolve; });
  const url = await server(t, (_request, response) => {
    calls++; answer = () => json(response, nortePayload()); arrived?.();
  });
  const instance = norte(t, url, { ...query, originConcurrency: 1 });
  const first = instance.lookup(document, context(1000));
  await arrival;
  unavailable(await instance.lookup(document, context(40)), 'TIMEOUT');
  assert.equal(calls, 1);
  answer?.(); assert.equal(successful(await first).length, 3);
  // Capacity is returned after cancellation and completion.
  const next = instance.lookup(document, context(1000));
  while (calls < 2) await delay(5);
  answer?.(); assert.equal(successful(await next).length, 3);
});

test('adapters_close_cancels_work_and_prevents_future_requests', async t => {
  let arrived: (() => void) | undefined;
  const arrival = new Promise<void>(resolve => { arrived = resolve; });
  const url = await server(t, () => arrived?.());
  const instance = norte(t, url);
  const pending = instance.lookup(document, context());
  await arrival; await instance.close?.();
  unavailable(await pending, 'UNAVAILABLE');
  unavailable(await instance.lookup(document, context()), 'UNAVAILABLE');
});

test('adapters_centro_latest_filename_normalized_documents_history_cutoff_and_minimum_data', async t => {
  const { directory, instance } = await centro(t);
  await writeFile(join(directory, 'centro_afiliados_20261012.txt'), fixtureCentro.replace('2026-10-13', '2026-10-11'));
  const latest = join(directory, 'centro_afiliados_20261014.txt');
  await writeFile(latest, fixtureCentro);
  await utimes(latest, new Date('2020-01-01'), new Date('2020-01-01'));
  const results = await Promise.all(Array.from({ length: 8 }, () => instance.lookup(document, context())));
  for (const result of results) {
    const rows = successful(result);
    assert.equal(rows.length, 3);
    assert.ok(Object.isFrozen(rows));
    assert.equal(Reflect.set(rows[0]!, 'asOf', '1900-01-01'), false);
    assert.ok(successful(result).every(row => row.asOf === '2026-10-13' && row.source === 'FILE' && row.caja === 'CENTRO'));
    assert.deepEqual(successful(result).map(row => row.affiliateType), ['DEPENDIENTE', 'INDEPENDIENTE', 'PENSIONADO']);
    minimumFields(result);
  }
  assert.deepEqual(successful(await instance.lookup('999' as NormalizedDocument, context())), []);
});

test('adapters_centro_shared_index_load_survives_cancellation_of_one_caller', async t => {
  const { directory, instance } = await centro(t);
  const header = fixtureCentro.split('\n').slice(0, 2).join('\n');
  const lines = Array.from({ length: 20_000 }, (_, index) => `CC|${1000000000 + index}|20240229||DEP|NO_PUBLICAR|1`);
  await writeFile(join(directory, 'centro_afiliados_20261014.txt'), header + '\n' + lines.join('\n') + '\n');
  const cancellation = new AbortController();
  const first = instance.lookup('1000000000' as NormalizedDocument, context(2000, cancellation.signal));
  const second = instance.lookup('1000019999' as NormalizedDocument, context());
  await delay(5); cancellation.abort();
  unavailable(await first, 'TIMEOUT');
  assert.equal(successful(await second).length, 1);
  assert.equal(successful(await instance.lookup('1000000000' as NormalizedDocument, context())).length, 1);
});

test('adapters_centro_refreshes_changed_file_and_newest_empty_publication', async t => {
  const { directory, instance } = await centro(t);
  const filename = join(directory, 'centro_afiliados_20261013.txt');
  await writeFile(filename, fixtureCentro);
  assert.equal(successful(await instance.lookup(document, context())).length, 3);
  await writeFile(filename, fixtureCentro.replace('|DEP|', '|PEN|').replaceAll('1200000', '12000001'));
  assert.equal(successful(await instance.lookup(document, context()))[0]?.affiliateType, 'PENSIONADO');
  await writeFile(join(directory, 'centro_afiliados_20261014.txt'), fixtureCentro.split('\n').slice(0, 2).join('\n') + '\n');
  assert.deepEqual(successful(await instance.lookup(document, context())), []);
});

test('adapters_centro_missing_corrupt_newest_and_unrelated_corrupt_row_never_assert_absence', async t => {
  const { directory, instance } = await centro(t);
  unavailable(await instance.lookup(document, context()), 'FILE_UNAVAILABLE');
  await writeFile(join(directory, 'centro_afiliados_20261013.txt'), fixtureCentro);
  assert.equal(successful(await instance.lookup(document, context())).length, 3);
  const newest = join(directory, 'centro_afiliados_20261014.txt');
  await writeFile(newest, 'corrupt');
  unavailable(await instance.lookup(document, context()), 'INVALID_RESPONSE');
  await writeFile(newest, fixtureCentro + 'CC|999|20230229||DEP|NO_PUBLICAR|1\n');
  unavailable(await instance.lookup('555' as NormalizedDocument, context()), 'INVALID_RESPONSE');
  await rm(newest);
  assert.equal(successful(await instance.lookup(document, context())).length, 3);
});

test('adapters_centro_rejects_invalid_cutoff_columns_documents_types_dates_and_utf8', async t => {
  const { directory, instance } = await centro(t);
  const filename = join(directory, 'centro_afiliados_20261014.txt');
  const invalid: (string | Buffer)[] = [
    fixtureCentro.replace('2026-10-13', '2026-02-30'),
    fixtureCentro.replace('NUMERO_DOCUMENTO', 'WRONG_COLUMN'),
    fixtureCentro.replace('000.123.456.789', '123invalid'),
    fixtureCentro.replace('|DEP|', '|UNKNOWN|'),
    fixtureCentro.replace('20240229', '20230229'),
    fixtureCentro.replace('20221231', '20191231'),
    fixtureCentro + 'CC|111|20240229||DEP|NO_PUBLICAR\n',
    Buffer.from([0xff, 0xff]),
  ];
  for (const [index, body] of invalid.entries()) {
    await writeFile(filename, body);
    await t.test(`invalid_file_${index}`, async () => unavailable(await instance.lookup(document, context()), 'INVALID_RESPONSE'));
  }
  await writeFile(filename, '\uFEFF' + fixtureCentro.replaceAll('\n', '\r\n'));
  assert.equal(successful(await instance.lookup(document, context())).length, 3);
});

test('adapters_centro_rejects_oversized_publication_and_non_calendar_filename', async t => {
  const { directory, instance } = await centro(t);
  const filename = join(directory, 'centro_afiliados_20261014.txt');
  await writeFile(filename, Buffer.alloc(MAX_CENTRO_BYTES + 1));
  unavailable(await instance.lookup(document, context()), 'INVALID_RESPONSE');
  await rm(filename);
  await writeFile(join(directory, 'centro_afiliados_20261399.txt'), fixtureCentro);
  unavailable(await instance.lookup(document, context()), 'INVALID_RESPONSE');
});
