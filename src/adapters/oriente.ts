import { XMLBuilder, XMLParser, XMLValidator } from 'fast-xml-parser';
import type { AppConfig, SoapOrienteConfig } from '../config/types.ts';
import type { AffiliateType, CajaAdapter, DateOnly, NormalizedAffiliation, NormalizedDocument } from '../domain/types.ts';
import { requestText } from './http.ts';
import { AuthenticationFailure, createAdapter, OriginUnavailable } from './runtime.ts';
import {
  affiliateType, array, dayFirstDate, documentKey, InvalidResponse, record, text, validatePeriod,
} from './validation.ts';

// Protocol namespace identifiers, never destinations for network requests.
const SOAP_NS = 'http://schemas.xmlsoap.org/soap/envelope/';
const ORIENTE_NS = 'http://cajaoriente.example/afiliacion';
const TYPES: Readonly<Record<string, AffiliateType>> = {
  D: 'DEPENDIENTE', I: 'INDEPENDIENTE', P: 'PENSIONADO',
};

interface XmlNode {
  readonly name: string;
  readonly namespace: string;
  readonly children: readonly XmlNode[];
  readonly value: string;
}

/** Traverse the library's ordered AST, resolving scoped namespaces explicitly. */
function soapTree(xml: string): XmlNode {
  // These are rejection guards, not an XML parser. No DTD or custom entity is evaluated.
  if (/<!\s*(?:DOCTYPE|ENTITY)\b/iu.test(xml)
    || /&(?!(?:amp|lt|gt|quot|apos|#[0-9]+|#x[0-9a-f]+);)/iu.test(xml)) throw new InvalidResponse();
  if (XMLValidator.validate(xml) !== true) throw new InvalidResponse();
  const parser = new XMLParser({
    preserveOrder: true, ignoreAttributes: false, removeNSPrefix: false,
    parseTagValue: false, parseAttributeValue: false, processEntities: false,
    ignoreDeclaration: true, ignorePiTags: true, maxNestedTags: 32,
  });
  let count = 0;
  function children(raw: unknown, inherited: ReadonlyMap<string, string>, depth: number): {
    readonly nodes: readonly XmlNode[]; readonly value: string;
  } {
    if (depth > 32) throw new InvalidResponse();
    const nodes: XmlNode[] = [];
    let value = '';
    for (const item of array(raw)) {
      const entry = record(item);
      if (Object.hasOwn(entry, '#text')) { value += text(entry['#text']); continue; }
      if (++count > 20_000) throw new InvalidResponse();
      const names = Object.keys(entry).filter(key => key !== ':@');
      const qualified = names[0];
      if (names.length !== 1 || !qualified) throw new InvalidResponse();
      const namespaces = new Map(inherited);
      const attributes = entry[':@'] === undefined ? {} : record(entry[':@']);
      for (const [key, attribute] of Object.entries(attributes)) {
        if (key === '@_xmlns') namespaces.set('', text(attribute));
        else if (key.startsWith('@_xmlns:')) namespaces.set(key.slice(8), text(attribute));
      }
      const parts = qualified.split(':');
      if (parts.length > 2) throw new InvalidResponse();
      const prefix = parts.length === 2 ? parts[0] ?? '' : '';
      const name = parts.at(-1);
      const namespace = namespaces.get(prefix) ?? '';
      if (!name || (prefix && !namespace)) throw new InvalidResponse();
      const parsed = children(entry[qualified], namespaces, depth + 1);
      nodes.push({ name, namespace, children: parsed.nodes, value: parsed.value });
    }
    return { nodes, value };
  }
  try {
    const parsed: unknown = parser.parse(xml);
    const root = children(parsed, new Map(), 0);
    const envelope = root.nodes[0];
    if (root.nodes.length !== 1 || root.value.trim() || !envelope
      || envelope.name !== 'Envelope' || envelope.namespace !== SOAP_NS) throw new InvalidResponse();
    return envelope;
  } catch { throw new InvalidResponse(); }
}

function named(node: XmlNode, name: string, namespace = ORIENTE_NS): readonly XmlNode[] {
  return node.children.filter(child => child.name === name && child.namespace === namespace);
}

function only(node: XmlNode, name: string, namespace = ORIENTE_NS): XmlNode {
  const matches = named(node, name, namespace);
  const match = matches[0];
  if (matches.length !== 1 || !match) throw new InvalidResponse();
  return match;
}

function value(node: XmlNode): string {
  if (node.children.length) throw new InvalidResponse();
  return node.value.trim();
}

function transform(xml: string, document: NormalizedDocument, asOf: DateOnly): readonly NormalizedAffiliation[] {
  const envelope = soapTree(xml);
  const body = only(envelope, 'Body', SOAP_NS);
  if (named(body, 'Fault', SOAP_NS).length) throw new OriginUnavailable();
  if (body.children.length !== 1 || body.value.trim()) throw new InvalidResponse();
  const response = only(body, 'ConsultarAfiliacionResponse');
  const found = value(only(response, 'Encontrado'));
  if (found === 'false' || found === '0') {
    if (named(response, 'Persona').length || named(response, 'Afiliaciones').length) throw new InvalidResponse();
    return [];
  }
  if (found !== 'true' && found !== '1') throw new InvalidResponse();
  const person = only(response, 'Persona');
  const numbers = named(person, 'NumeroDocumento');
  if (numbers.length > 1 || (numbers[0] && documentKey(value(numbers[0])) !== document)) throw new InvalidResponse();
  const affiliations = only(person, 'Afiliaciones');
  if (affiliations.value.trim()
    || affiliations.children.some(child => child.namespace !== ORIENTE_NS || child.name !== 'Afiliacion')) {
    throw new InvalidResponse();
  }
  return affiliations.children.map(row => {
    const validFrom = dayFirstDate(value(only(row, 'FechaIngreso')));
    const end = value(only(row, 'FechaRetiro'));
    const validTo = end === '' ? null : dayFirstDate(end);
    validatePeriod(validFrom, validTo);
    return {
      caja: 'ORIENTE', validFrom, validTo, source: 'ONLINE', asOf,
      affiliateType: affiliateType(value(only(row, 'TipoAfiliado')), TYPES),
    };
  });
}

export function createOrienteAdapter(config: SoapOrienteConfig, query: AppConfig['query']): CajaAdapter {
  const builder = new XMLBuilder({ ignoreAttributes: false, processEntities: true });
  return createAdapter(config.id, query, async (document, context, signal) => {
    const body = builder.build({
      'soapenv:Envelope': {
        '@_xmlns:soapenv': SOAP_NS, '@_xmlns:ori': ORIENTE_NS,
        'soapenv:Header': { 'ori:Credenciales': { 'ori:Usuario': config.username, 'ori:Clave': config.password } },
        'soapenv:Body': { 'ori:ConsultarAfiliacionRequest': { 'ori:NumeroDocumento': document.padStart(12, '0') } },
      },
    }) as string;
    const response = await requestText(config.endpoint, {
      method: 'POST', headers: { 'Content-Type': 'text/xml; charset=utf-8', SOAPAction: 'ConsultarAfiliacion', Accept: 'text/xml' },
      body,
    }, signal, 'xml', [200, 500]);
    if (response.status === 401 || response.status === 403) throw new AuthenticationFailure();
    if (response.status !== 200 && response.status !== 500) throw new OriginUnavailable();
    const affiliations = transform(response.body, document, context.asOf);
    if (response.status !== 200) throw new OriginUnavailable();
    return affiliations;
  });
}
