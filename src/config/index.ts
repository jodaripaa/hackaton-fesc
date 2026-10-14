import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseDocument } from 'yaml';
import { CAJA_IDS } from '../domain/types.ts';
import type { AppConfig, CajaConfig } from './types.ts';
export type * from './types.ts';

export class ConfigurationError extends Error {
  override readonly name = 'ConfigurationError';
}
type Environment = Readonly<Record<string, string | undefined>>;
function required(env: Environment, name: string): string {
  const value = env[name];
  if (!value || value.trim() !== value || /[\r\n\0]/u.test(value)) {
    throw new ConfigurationError(`Variable requerida o inválida: ${name}`);
  }
  return value;
}
function secret(env: Environment, name: string): string {
  const value = required(env, name);
  if (value.startsWith('cambiar-')) throw new ConfigurationError(`Reemplaza el marcador de ${name}`);
  return value;
}
function integer(env: Environment, name: string, fallback: number, min: number, max: number): number {
  const raw = env[name] ?? String(fallback);
  const value = Number(raw);
  if (!/^\d+$/u.test(raw) || !Number.isSafeInteger(value) || value < min || value > max) {
    throw new ConfigurationError(`Entero fuera de rango: ${name} (${min}..${max})`);
  }
  return value;
}
function object(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ConfigurationError(`Objeto requerido: ${label}`);
  }
  return value as Record<string, unknown>;
}
function keys(record: Record<string, unknown>, allowed: readonly string[]): void {
  if (Object.keys(record).some(key => !allowed.includes(key))) {
    throw new ConfigurationError('La configuración de cajas contiene campos desconocidos');
  }
}
function reference(record: Record<string, unknown>, field: string): string {
  const name = record[field];
  if (typeof name !== 'string' || !/^[A-Z][A-Z0-9_]*$/u.test(name)) {
    throw new ConfigurationError(`Referencia de entorno inválida: ${field}`);
  }
  return name;
}
function address(env: Environment, name: string): string {
  const value = required(env, name);
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error();
    return value.replace(/\/$/u, '');
  } catch {
    throw new ConfigurationError(`URL HTTP(S) sin credenciales, query ni fragmento requerida: ${name}`);
  }
}
function boolean(env: Environment, name: string): boolean {
  const value = required(env, name);
  if (value !== 'true' && value !== 'false') throw new ConfigurationError(`Booleano true/false requerido: ${name}`);
  return value === 'true';
}

/** No URLs or credentials are defaulted in source code. All four boxes must be declared. */
export function loadConfig(env: Environment = process.env, options: { cajasPath?: string } = {}): AppConfig {
  const path = options.cajasPath ?? resolve(env['CAJAS_CONFIG_PATH'] ?? 'config/cajas.yaml');
  let raw: unknown;
  try {
    const yaml = parseDocument(readFileSync(path, 'utf8'), { uniqueKeys: true });
    if (yaml.errors.length) throw new Error();
    raw = yaml.toJS({ maxAliasCount: 0 });
  } catch {
    throw new ConfigurationError('No se pudo leer un YAML de cajas válido');
  }
  const root = object(raw, 'configuración de cajas');
  keys(root, ['version', 'cajas']);
  if (root['version'] !== 1 || !Array.isArray(root['cajas']) || root['cajas'].length !== CAJA_IDS.length) {
    throw new ConfigurationError('Se requiere version 1 y exactamente cuatro cajas');
  }
  const seen = new Set<string>();
  const cajas = root['cajas'].map((item: unknown): CajaConfig => {
    const entry = object(item, 'caja');
    const id = entry['id'];
    if (typeof id !== 'string' || !CAJA_IDS.includes(id as typeof CAJA_IDS[number]) || seen.has(id)) {
      throw new ConfigurationError('Identidad de caja desconocida o duplicada');
    }
    seen.add(id);
    if (id === 'SUR') {
      keys(entry, ['id', 'protocol', 'enabledEnv', 'baseUrlEnv', 'tokenEnv']);
      if (entry['protocol'] !== 'REST_SUR') throw new ConfigurationError('Protocolo inválido para SUR');
      const enabled = boolean(env, reference(entry, 'enabledEnv'));
      const urlEnv = reference(entry, 'baseUrlEnv');
      const tokenEnv = reference(entry, 'tokenEnv');
      return { id, protocol: 'REST_SUR', enabled, baseUrl: enabled ? address(env, urlEnv) : undefined, token: enabled ? secret(env, tokenEnv) : undefined };
    }
    if (entry['enabled'] !== true) throw new ConfigurationError('Las tres cajas originales deben estar habilitadas');
    if (id === 'NORTE') {
      keys(entry, ['id', 'protocol', 'enabled', 'baseUrlEnv', 'apiKeyEnv']);
      if (entry['protocol'] !== 'REST_NORTE') throw new ConfigurationError('Protocolo inválido para NORTE');
      return { id, protocol: 'REST_NORTE', enabled: true, baseUrl: address(env, reference(entry, 'baseUrlEnv')), apiKey: secret(env, reference(entry, 'apiKeyEnv')) };
    }
    if (id === 'ORIENTE') {
      keys(entry, ['id', 'protocol', 'enabled', 'endpointEnv', 'usernameEnv', 'passwordEnv']);
      if (entry['protocol'] !== 'SOAP_ORIENTE') throw new ConfigurationError('Protocolo inválido para ORIENTE');
      return { id, protocol: 'SOAP_ORIENTE', enabled: true, endpoint: address(env, reference(entry, 'endpointEnv')), username: required(env, reference(entry, 'usernameEnv')), password: secret(env, reference(entry, 'passwordEnv')) };
    }
    keys(entry, ['id', 'protocol', 'enabled', 'directoryEnv']);
    if (entry['protocol'] !== 'FILE_CENTRO') throw new ConfigurationError('Protocolo inválido para CENTRO');
    return { id: 'CENTRO', protocol: 'FILE_CENTRO', enabled: true, directory: required(env, reference(entry, 'directoryEnv')) };
  });
  const consumerTokens = {
    NORTE: secret(env, 'NORTE_TOKEN'), ORIENTE: secret(env, 'ORIENTE_TOKEN'),
    CENTRO: secret(env, 'CENTRO_TOKEN'), SUR: secret(env, 'SUR_TOKEN'),
  };
  const adminToken = secret(env, 'ADMIN_TOKEN');
  if (new Set([...Object.values(consumerTokens), adminToken]).size !== 5) {
    throw new ConfigurationError('Los tokens de consumidores y administrador deben ser distintos');
  }
  const totalTimeoutMs = integer(env, 'QUERY_TOTAL_TIMEOUT_MS', 4500, 100, 4900);
  const originTimeoutMs = integer(env, 'ORIGIN_TIMEOUT_MS', 3500, 50, totalTimeoutMs);
  const concurrency = integer(env, 'QUERY_CONCURRENCY', 64, 1, 1024);
  const logLevel = env['LOG_LEVEL'] ?? 'info';
  if (!['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'].includes(logLevel)) {
    throw new ConfigurationError('LOG_LEVEL inválido');
  }
  const host = env['HOST'] ?? '0.0.0.0';
  if (!host || /\s/u.test(host)) throw new ConfigurationError('HOST inválido');
  return {
    server: { host, port: integer(env, 'PORT', 8083, 1, 65535), bodyLimit: integer(env, 'BODY_LIMIT_BYTES', 2097152, 1024, 16777216) },
    logLevel: logLevel as AppConfig['logLevel'], cajas,
    auth: { consumerTokens, adminToken },
    database: {
      host: required(env, 'PGHOST'), port: integer(env, 'PGPORT', 5432, 1, 65535),
      database: required(env, 'PGDATABASE'), user: required(env, 'PGUSER'), password: secret(env, 'PGPASSWORD'),
      max: integer(env, 'PGPOOL_MAX', 10, 1, 100), connectionTimeoutMs: integer(env, 'PGCONNECT_TIMEOUT_MS', 1000, 100, 10000),
      queryTimeoutMs: integer(env, 'PGQUERY_TIMEOUT_MS', 1500, 100, 10000),
    },
    query: { totalTimeoutMs, originTimeoutMs, concurrency, originConcurrency: integer(env, 'ORIGIN_CONCURRENCY', 32, 1, 1024) },
    batch: { concurrency: integer(env, 'BATCH_CONCURRENCY', 16, 1, concurrency), maxDocuments: integer(env, 'BATCH_MAX_DOCUMENTS', 10000, 10000, 100000) },
  };
}
