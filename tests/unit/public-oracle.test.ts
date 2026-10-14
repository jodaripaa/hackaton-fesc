import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import test from 'node:test';
import type { TestContext } from 'node:test';
import { assertMinimumData, assertResponse, calendarDate, expectedResponse, normalizeReference, prepareReference, readCentro, readDocuments } from '../helpers/public-oracle.ts';
import type { ReferenceSnapshot } from '../helpers/public-oracle.ts';
import { testEnvironment } from '../helpers/config.ts';

async function publishedFile(t: TestContext) {
  const temporaryRoot = resolve(tmpdir());
  const directory = await mkdtemp(join(temporaryRoot, 'caja-link-oracle-'));
  t.after(async () => {
    assert.equal(dirname(resolve(directory)), temporaryRoot);
    assert.ok(basename(directory).startsWith('caja-link-oracle-'));
    await rm(directory, { recursive: true, force: true });
  });
  const header = 'FECHA_CORTE|2026-10-13\nTIPO_DOC|NUMERO_DOCUMENTO|FECHA_INICIO|FECHA_FIN|TIPO_AFILIADO|NOMBRE|SALARIO\n';
  await writeFile(join(directory, 'centro_afiliados_20261013.txt'), `${header}CC|123456789|20240101||DEP|synthetic-private|1\nCC|999999999|20240101|20261014|PEN|synthetic-private|1\nCC|888888888|20240101|20261013|IND|synthetic-private|1\n`);
  const env: Record<string, string> = { ...testEnvironment(), CAJA_CENTRO_DIR: directory };
  return { directory, env };
}
async function publicApis(t: TestContext) {
  const fixture = await publishedFile(t);
  const state = { failNorth: false, soapFault: false, northCalls: 0, eastCalls: 0, surCalls: 0 };
  const server = createServer(async (request, reply) => {
    if (request.url?.startsWith('/api/v1/afiliados/')) {
      state.northCalls += 1;
      assert.equal(request.headers['x-api-key'], fixture.env.CAJA_NORTE_API_KEY);
      reply.setHeader('content-type', 'application/json');
      if (state.failNorth) { reply.writeHead(503); reply.end('{}'); return; }
      if (!request.url.endsWith('/123456789')) { reply.writeHead(404); reply.end('{"error":"NO_ENCONTRADO"}'); return; }
      reply.end(JSON.stringify({ titular: { nombre: 'synthetic-private' }, afiliaciones: [
        { fechaInicio: '2024-01-01', fechaFin: null, tipoAfiliado: 'DEPENDIENTE' },
        { fechaInicio: '2027-01-01', fechaFin: null, tipoAfiliado: 'INDEPENDIENTE' },
        { fechaInicio: '2020-01-01', fechaFin: '2023-12-31', tipoAfiliado: 'PENSIONADO' },
      ] }));
      return;
    }
    if (request.url === '/soap') {
      state.eastCalls += 1;
      let body = '';
      for await (const chunk of request) body += chunk;
      assert.ok(body.includes(fixture.env['CAJA_ORIENTE_PASSWORD']!));
      assert.ok(body.includes('<ori:NumeroDocumento>000'));
      assert.equal(request.headers['soapaction'], 'ConsultarAfiliacion');
      reply.setHeader('content-type', 'text/xml');
      if (state.soapFault) { reply.writeHead(500); reply.end('<s:Envelope><s:Body><s:Fault/></s:Body></s:Envelope>'); return; }
      const found = body.includes('000123456789');
      reply.end(`<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" xmlns:x="http://cajaoriente.example/afiliacion"><s:Body><x:ConsultarAfiliacionResponse><x:Encontrado>${found}</x:Encontrado>${found ? '<x:Persona><x:NombreCompleto>synthetic-private</x:NombreCompleto><x:Afiliaciones><x:Afiliacion><x:FechaIngreso>29/02/2024</x:FechaIngreso><x:FechaRetiro>14/10/2026</x:FechaRetiro><x:TipoAfiliado>I</x:TipoAfiliado></x:Afiliacion></x:Afiliaciones></x:Persona>' : ''}</x:ConsultarAfiliacionResponse></s:Body></s:Envelope>`);
      return;
    }
    if (request.url?.startsWith('/v2/people/')) {
      state.surCalls += 1;
      assert.equal(request.headers.authorization, `Bearer ${fixture.env.CAJA_SUR_TOKEN}`);
      reply.setHeader('content-type', 'application/json');
      if (!request.url.includes('/123456789/')) { reply.writeHead(404); reply.end('{"error":"person_not_found"}'); return; }
      reply.end(JSON.stringify({ person: { fullName: 'synthetic-private' }, memberships: [{ start: '2021-01-01', end: null, category: 'RETIREE' }] }));
      return;
    }
    reply.writeHead(404); reply.end();
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`;
  return { state, env: { ...fixture.env, CAJA_NORTE_URL: base, CAJA_ORIENTE_URL: `${base}/soap`, CAJA_SUR_URL: base, CAJA_SUR_ENABLED: 'true' } };
}

test('referencia_normaliza_sin_perder_precision_y_rechaza_caracteres', () => {
  assert.equal(normalizeReference(' 001.234 567.890 '), '1234567890');
  assert.equal(normalizeReference('123456789012'), '123456789012');
  assert.equal(normalizeReference('000'), '0');
  for (const value of ['', '12-3', '+123', '1e4', '1234567890123']) assert.throws(() => normalizeReference(value));
});
test('referencia_fecha_consulta_usa_calendario_bogota', () => {
  assert.equal(calendarDate(new Date('2026-10-15T04:59:59.999Z')), '2026-10-14');
  assert.equal(calendarDate(new Date('2026-10-15T05:00:00.000Z')), '2026-10-15');
});
test('referencia_csv_conserva_orden_y_duplicados_con_bom_y_comillas', async t => {
  const { directory } = await publishedFile(t);
  const csvPath = join(directory, 'propio.csv');
  await writeFile(csvPath, '\uFEFFdocument\r\n" 000123 "\r\n456\r\n123\r\n');
  assert.deepEqual((await readDocuments(csvPath)).documents, ['123', '456', '123']);
  await writeFile(csvPath, 'document\nINVALIDO\n');
  await assert.rejects(readDocuments(csvPath));
});
test('referencia_centro_elige_archivo_mas_reciente_y_fecha_publicada', async t => {
  const { directory, env } = await publishedFile(t);
  await writeFile(join(directory, 'centro_afiliados_20261012.txt'), 'FECHA_CORTE|2026-10-12\nINVALIDO\n');
  const centro = await readCentro(env);
  assert.equal(centro.asOf, '2026-10-13');
  assert.equal(centro.matches.size, 3);
  assert.equal(centro.matches.get('123456789')?.[0]?.source, 'FILE');
  assert.equal(centro.matches.get('123456789')?.[0]?.affiliateType, 'DEPENDIENTE');
  assert.ok(!JSON.stringify([...centro.matches.values()]).includes('synthetic-private'));
  await writeFile(join(directory, 'centro_afiliados_20261014.txt'), 'FECHA_CORTE|2026-02-30\n');
  await assert.rejects(readCentro(env), /Fecha calendario inválida/u);
});
test('referencia_independiente_rest_soap_archivo_sur_vigencia_y_exclusion', async t => {
  const { env, state } = await publicApis(t);
  const snapshot = await prepareReference(['000123456789', '123456789', '999999999', '888888888'], env, { asOf: '2026-10-14', concurrency: 2 });
  assert.equal(snapshot.matches.size, 3);
  assert.equal(state.northCalls, 3);
  assert.equal(state.eastCalls, 3);
  assert.equal(state.surCalls, 3);
  assert.equal(snapshot.matches.get('123456789')?.length, 4);
  assert.equal(snapshot.matches.get('888888888')?.length, 0, 'Se descarta la afiliación cuyo fin fue ayer');
  assert.equal(snapshot.matches.get('999999999')?.length, 1, 'El límite de fin es inclusivo');
  const v2 = expectedResponse(snapshot, '123456789', 'CENTRO', 2);
  assert.equal(v2.result, 'AFILIADO_OTRA_CAJA');
  assert.equal(v2.matches.length, 3);
  assert.deepEqual(v2.matches.map(match => (match as { affiliateType?: string }).affiliateType).sort(), ['DEPENDIENTE', 'INDEPENDIENTE', 'PENSIONADO']);
  assertMinimumData(v2);
  assertResponse({ ...v2, requestId: 'synthetic' }, v2, 2);
  const negative = expectedResponse(snapshot, '888888888', 'CENTRO', 1, ['NORTE']);
  assert.equal(negative.result, 'INDETERMINADO');
  assert.deepEqual(negative.unavailable, ['NORTE']);
  assert.equal(expectedResponse(snapshot, '123456789', 'CENTRO', 1, ['NORTE']).result, 'AFILIADO_OTRA_CAJA');
});
test('referencia_rechaza_503_y_soap_fault_sin_fabricar_ausencia', async t => {
  const { env, state } = await publicApis(t);
  state.failNorth = true;
  await assert.rejects(prepareReference(['123456789'], env, { asOf: '2026-10-14' }), /No se pudo completar la referencia/u);
  state.failNorth = false;
  state.soapFault = true;
  await assert.rejects(prepareReference(['123456789'], env, { asOf: '2026-10-14' }), /No se pudo completar la referencia/u);
  state.soapFault = false;
  assert.equal((await prepareReference(['123456789'], env, { asOf: '2026-10-14' })).matches.get('123456789')?.length, 4);
});
test('referencia_sur_deshabilitada_no_hace_peticion', async t => {
  const { env, state } = await publicApis(t);
  const snapshot = await prepareReference(['123456789'], { ...env, CAJA_SUR_ENABLED: 'false' }, { asOf: '2026-10-14' });
  assert.equal(state.surCalls, 0);
  assert.ok(!snapshot.enabled.includes('SUR'));
  assert.equal(snapshot.matches.get('123456789')?.length, 3);
});
test('referencia_verificacion_rechaza_campos_extra_y_resultados_inexactos', () => {
  const snapshot: ReferenceSnapshot = { asOf: '2026-10-14', centroAsOf: '2026-10-13', enabled: ['NORTE', 'ORIENTE', 'CENTRO'], matches: new Map([['123', []]]) };
  const expected = expectedResponse(snapshot, '123', 'CENTRO');
  const actual = { ...expected, requestId: 'synthetic', document: '123' };
  assertResponse(actual, expected, 1, '123');
  assert.throws(() => assertResponse({ ...actual, document: '321' }, expected, 1, '123'));
  assert.throws(() => assertResponse({ ...actual, result: 'AFILIADO_OTRA_CAJA' }, expected, 1, '123'));
  assert.throws(() => assertResponse({ ...actual, nombre: 'synthetic-private' }, expected, 1, '123'));
  assert.throws(() => assertMinimumData({ results: [{ matches: [{ correo: 'synthetic-private' }] }] }));
  assert.throws(() => expectedResponse(snapshot, '999', 'CENTRO'));
});
