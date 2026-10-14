import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'csv-parse/sync';
import { XMLParser } from 'fast-xml-parser';

/** Independent reference: public APIs and the published Centro file only.
 * No imports of the service's adapters, normalization or affiliation rules.
 * Upstream payloads are reduced in memory and never written to evidence/logs.
 */
export const BOXES = ['NORTE', 'ORIENTE', 'CENTRO', 'SUR'] as const;
export type Box = typeof BOXES[number];
export type Environment = Readonly<Record<string, string | undefined>>;
export interface ReferenceMatch {
  caja: Box; validFrom: string; validTo: string | null; source: 'ONLINE' | 'FILE'; asOf: string;
  affiliateType: 'DEPENDIENTE' | 'INDEPENDIENTE' | 'PENSIONADO';
}
export interface ReferenceSnapshot {
  asOf: string;
  centroAsOf: string;
  enabled: readonly Box[];
  matches: Map<string, ReferenceMatch[]>;
}
export interface ReferenceResponse { result: 'AFILIADO_OTRA_CAJA' | 'NO_AFILIADO' | 'INDETERMINADO'; matches: Omit<ReferenceMatch, 'affiliateType'>[]; unavailable: Box[] }

export function required(env: Environment, name: string): string {
  const value = env[name];
  if (!value) throw new Error(`Falta la variable de pruebas ${name}`);
  return value;
}
export function normalizeReference(document: string): string {
  if (!/^[0-9.\s]+$/u.test(document)) throw new Error('Documento de referencia inválido');
  const value = document.replace(/[.\s]/gu, '').replace(/^0+/u, '') || '0';
  if (value.length > 12) throw new Error('Documento de referencia fuera del contrato');
  return value;
}
export function calendarDate(date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en', { timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const get = (type: string) => parts.find(part => part.type === type)!.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}
function dateOnly(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) throw new Error('Fecha inválida en una interfaz pública');
  const time = Date.parse(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== value) throw new Error('Fecha calendario inválida en una interfaz pública');
  return value;
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Respuesta pública con formato inesperado');
  return value as Record<string, unknown>;
}
function array(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new Error('Lista pública con formato inesperado');
  return value;
}
function text(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Campo público con formato inesperado');
  return value;
}
function affiliationType(value: unknown, mapping: Readonly<Record<string, ReferenceMatch['affiliateType']>>): ReferenceMatch['affiliateType'] {
  const result = mapping[text(value)];
  if (!result) throw new Error('Tipo desconocido en una interfaz pública');
  return result;
}
const northTypes = { DEPENDIENTE: 'DEPENDIENTE', INDEPENDIENTE: 'INDEPENDIENTE', PENSIONADO: 'PENSIONADO' } as const;
const eastTypes = { D: 'DEPENDIENTE', I: 'INDEPENDIENTE', P: 'PENSIONADO' } as const;
const centroTypes = { DEP: 'DEPENDIENTE', IND: 'INDEPENDIENTE', PEN: 'PENSIONADO' } as const;
const surTypes = { DEPENDENT: 'DEPENDIENTE', SELF_EMPLOYED: 'INDEPENDIENTE', RETIREE: 'PENSIONADO' } as const;
function end(value: unknown, convert: (value: unknown) => string = dateOnly): string | null {
  return value === null || value === '' ? null : convert(value);
}
function compactDate(value: unknown): string {
  const input = text(value);
  if (!/^\d{8}$/u.test(input)) throw new Error('Fecha inválida en el archivo publicado');
  return dateOnly(`${input.slice(0, 4)}-${input.slice(4, 6)}-${input.slice(6, 8)}`);
}
function eastDate(value: unknown): string {
  const input = text(value);
  if (!/^\d{2}\/\d{2}\/\d{4}$/u.test(input)) throw new Error('Fecha inválida en SOAP público');
  return dateOnly(`${input.slice(6)}-${input.slice(3, 5)}-${input.slice(0, 2)}`);
}
function xmlEscape(value: string): string {
  return value.replace(/&/gu, '&amp;').replace(/</gu, '&lt;').replace(/>/gu, '&gt;').replace(/"/gu, '&quot;').replace(/'/gu, '&apos;');
}
async function request(url: URL | string, init: RequestInit = {}): Promise<Response> {
  try { return await fetch(url, { ...init, signal: AbortSignal.timeout(12000) }); }
  catch { throw new Error('No se pudo preparar la referencia mediante una API pública'); }
}

export async function readDocuments(csvPath = fileURLToPath(new URL('../../data/lote_10000.csv', import.meta.url))): Promise<{ csv: string; documents: string[] }> {
  const csv = await readFile(csvPath, 'utf8');
  const rows: unknown = parse(csv, { columns: true, skip_empty_lines: true, bom: true });
  const documents = array(rows).map(row => normalizeReference(text(object(row)['document'])));
  if (!documents.length) throw new Error('CSV sin documentos');
  return { csv, documents };
}

export async function readCentro(env: Environment): Promise<{ asOf: string; matches: Map<string, ReferenceMatch[]> }> {
  const directory = env['TEST_CENTRO_DIR'] ?? required(env, 'CAJA_CENTRO_DIR');
  const files = (await readdir(directory)).filter(file => /^centro_afiliados_\d{8}\.txt$/u.test(file)).sort().reverse();
  if (!files[0]) throw new Error('No está disponible el archivo publicado de Centro para las pruebas');
  const lines = (await readFile(join(directory, files[0]), 'utf8')).replace(/^\uFEFF/u, '').split(/\r?\n/u).filter(line => line.trim());
  if (!lines[0]?.startsWith('FECHA_CORTE|')) throw new Error('Archivo publicado sin FECHA_CORTE');
  const asOf = dateOnly(lines[0].split('|')[1]);
  const header = lines[1]?.split('|');
  const names = ['NUMERO_DOCUMENTO', 'FECHA_INICIO', 'FECHA_FIN', 'TIPO_AFILIADO'];
  if (!header || names.some(name => !header.includes(name))) throw new Error('Cabecera del archivo publicado inválida');
  const matches = new Map<string, ReferenceMatch[]>();
  for (const line of lines.slice(2)) {
    const fields = line.split('|');
    const field = (name: string) => fields[header.indexOf(name)];
    const document = normalizeReference(text(field('NUMERO_DOCUMENTO')));
    const match: ReferenceMatch = { caja: 'CENTRO', validFrom: compactDate(field('FECHA_INICIO')), validTo: end(field('FECHA_FIN'), compactDate), source: 'FILE', asOf, affiliateType: affiliationType(field('TIPO_AFILIADO'), centroTypes) };
    matches.set(document, [...(matches.get(document) ?? []), match]);
  }
  return { asOf, matches };
}

async function north(document: string, env: Environment, asOf: string): Promise<ReferenceMatch[]> {
  const response = await request(new URL(`/api/v1/afiliados/${document}`, required(env, 'CAJA_NORTE_URL')), { headers: { 'X-Api-Key': required(env, 'CAJA_NORTE_API_KEY') } });
  if (response.status === 404) { await response.arrayBuffer(); return []; }
  if (response.status !== 200) { await response.arrayBuffer(); throw new Error(`Referencia NORTE: HTTP ${response.status}`); }
  return array(object(await response.json())['afiliaciones']).map(value => {
    const row = object(value);
    return { caja: 'NORTE', validFrom: dateOnly(row['fechaInicio']), validTo: end(row['fechaFin']), source: 'ONLINE', asOf, affiliateType: affiliationType(row['tipoAfiliado'], northTypes) };
  });
}
async function east(document: string, env: Environment, asOf: string): Promise<ReferenceMatch[]> {
  const body = `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ori="http://cajaoriente.example/afiliacion"><soapenv:Header><ori:Credenciales><ori:Usuario>${xmlEscape(required(env, 'CAJA_ORIENTE_USER'))}</ori:Usuario><ori:Clave>${xmlEscape(required(env, 'CAJA_ORIENTE_PASSWORD'))}</ori:Clave></ori:Credenciales></soapenv:Header><soapenv:Body><ori:ConsultarAfiliacionRequest><ori:NumeroDocumento>${document.padStart(12, '0')}</ori:NumeroDocumento></ori:ConsultarAfiliacionRequest></soapenv:Body></soapenv:Envelope>`;
  const response = await request(required(env, 'CAJA_ORIENTE_URL'), { method: 'POST', headers: { 'content-type': 'text/xml; charset=utf-8', SOAPAction: 'ConsultarAfiliacion' }, body });
  if (response.status !== 200) { await response.arrayBuffer(); throw new Error(`Referencia ORIENTE: HTTP ${response.status}`); }
  const xml = await response.text();
  if (/<!DOCTYPE|<!ENTITY/iu.test(xml)) throw new Error('SOAP público contiene una declaración no permitida');
  const parsed: unknown = new XMLParser({ removeNSPrefix: true, ignoreAttributes: true, parseTagValue: false, processEntities: false, isArray: tag => tag === 'Afiliacion' }).parse(xml);
  const envelope = object(object(parsed)['Envelope']);
  const soapBody = object(envelope['Body']);
  if (soapBody['Fault']) throw new Error('La API pública respondió SOAP Fault');
  const result = object(soapBody['ConsultarAfiliacionResponse']);
  if (result['Encontrado'] === 'false') return [];
  if (result['Encontrado'] !== 'true') throw new Error('SOAP público sin estado Encontrado válido');
  const affiliations = object(result['Persona'])['Afiliaciones'];
  if (affiliations === '') return [];
  return array(object(affiliations)['Afiliacion']).map(value => {
    const row = object(value);
    return { caja: 'ORIENTE', validFrom: eastDate(row['FechaIngreso']), validTo: end(row['FechaRetiro'], eastDate), source: 'ONLINE', asOf, affiliateType: affiliationType(row['TipoAfiliado'], eastTypes) };
  });
}
async function south(document: string, env: Environment, asOf: string): Promise<ReferenceMatch[]> {
  const response = await request(new URL(`/v2/people/${document}/memberships`, required(env, 'CAJA_SUR_URL')), { headers: { authorization: `Bearer ${required(env, 'CAJA_SUR_TOKEN')}` } });
  if (response.status === 404) { await response.arrayBuffer(); return []; }
  if (response.status !== 200) { await response.arrayBuffer(); throw new Error(`Referencia SUR: HTTP ${response.status}`); }
  return array(object(await response.json())['memberships']).map(value => {
    const row = object(value);
    return { caja: 'SUR', validFrom: dateOnly(row['start']), validTo: end(row['end']), source: 'ONLINE', asOf, affiliateType: affiliationType(row['category'], surTypes) };
  });
}

export async function prepareReference(documents: readonly string[], env: Environment, options: { concurrency?: number; asOf?: string } = {}): Promise<ReferenceSnapshot> {
  const asOf = options.asOf ?? calendarDate();
  const centro = await readCentro(env);
  const enabled: Box[] = ['NORTE', 'ORIENTE', 'CENTRO', ...(env['CAJA_SUR_ENABLED'] === 'true' ? ['SUR' as const] : [])];
  const unique = [...new Set(documents.map(normalizeReference))];
  const matches = new Map<string, ReferenceMatch[]>();
  const concurrency = options.concurrency ?? 8;
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 64) throw new Error('Concurrencia de referencia inválida');
  let index = 0;
  const workers = Array.from({ length: Math.min(concurrency, unique.length) }, async () => {
    while (index < unique.length) {
      const document = unique[index++]!;
      const originResults = await Promise.allSettled([north(document, env, asOf), east(document, env, asOf), ...(enabled.includes('SUR') ? [south(document, env, asOf)] : [])]);
      if (originResults.some(result => result.status === 'rejected')) throw new Error('Referencia incompleta de una API pública');
      const online = originResults.map(result => (result as PromiseFulfilledResult<ReferenceMatch[]>).value);
      const rows = [...(centro.matches.get(document) ?? []), ...online.flat()];
      matches.set(document, rows.filter(row => row.validFrom <= asOf && (row.validTo === null || row.validTo >= asOf)));
    }
  });
  // Wait for every worker before rejecting: never leave a reference scan running into a chaos test.
  const settled = await Promise.allSettled(workers);
  if (settled.some(result => result.status === 'rejected')) throw new Error('No se pudo completar la referencia; compruebe cajas en modo ok y credenciales');
  return { asOf, centroAsOf: centro.asOf, enabled, matches };
}

export function expectedResponse(snapshot: ReferenceSnapshot, document: string, requestingCaja: Box, version: 1 | 2 = 1, unavailable: readonly Box[] = []): ReferenceResponse {
  const normalized = normalizeReference(document);
  if (!snapshot.matches.has(normalized)) throw new Error('Documento no incluido en la referencia pública');
  const missing = unavailable.filter(caja => snapshot.enabled.includes(caja) && caja !== requestingCaja);
  const matches = snapshot.matches.get(normalized)!.filter(match => match.caja !== requestingCaja && !missing.includes(match.caja)).map(match => {
    if (version === 2) return { ...match };
    const { affiliateType: _type, ...v1 } = match;
    return v1;
  });
  return { result: matches.length ? 'AFILIADO_OTRA_CAJA' : missing.length ? 'INDETERMINADO' : 'NO_AFILIADO', matches, unavailable: [...new Set(missing)].sort() };
}
export function canonicalMatches(value: unknown): unknown[] {
  const key = (item: Record<string, unknown>) => JSON.stringify(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)));
  return array(value).map(item => object(item)).sort((a, b) => key(a).localeCompare(key(b)));
}
export function assertResponse(actual: unknown, expected: ReferenceResponse, version: 1 | 2 = 1, rowDocument?: string): void {
  const response = object(actual);
  assert.deepEqual(Object.keys(response).sort(), [...(rowDocument === undefined ? [] : ['document']), 'matches', 'requestId', 'result', 'unavailable'].sort());
  assert.equal(typeof response['requestId'], 'string');
  assert.ok(text(response['requestId']).length > 0);
  assert.equal(response['result'], expected.result);
  assert.deepEqual([...array(response['unavailable'])].sort(), expected.unavailable);
  assert.deepEqual(canonicalMatches(response['matches']), canonicalMatches(expected.matches));
  for (const match of array(response['matches'])) assert.deepEqual(Object.keys(object(match)).sort(), [...(version === 2 ? ['affiliateType'] : []), 'asOf', 'caja', 'source', 'validFrom', 'validTo'].sort());
  if (rowDocument !== undefined) assert.equal(response['document'], rowDocument);
}
export function assertMinimumData(value: unknown): void {
  const forbidden = /^(?:nombre|nombreCompleto|name|fullName|direccion|dirección|address|telefono|teléfono|phone|correo|email|salario|salary|monthlySalary|beneficiarios|beneficiaries|titular|person|persona)$/iu;
  if (Array.isArray(value)) { value.forEach(assertMinimumData); return; }
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) { assert.ok(!forbidden.test(key), 'La respuesta contiene un campo personal prohibido'); assertMinimumData(child); }
}
export async function setChaos(env: Environment, caja: Exclude<Box, 'CENTRO'>, mode: 'ok' | 'down' | 'slow'): Promise<void> {
  const response = await request(new URL('/__chaos', required(env, `CAJA_${caja}_URL`)), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode }) });
  if (response.status !== 200) throw new Error(`No se pudo establecer caos ${caja} ${mode}: HTTP ${response.status}`);
  await response.arrayBuffer();
}
