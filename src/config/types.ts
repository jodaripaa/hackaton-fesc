import type { CajaId } from '../domain/types.ts';

export interface RestNorteConfig {
  readonly id: 'NORTE'; readonly protocol: 'REST_NORTE'; readonly enabled: boolean;
  readonly baseUrl: string; readonly apiKey: string;
}
export interface SoapOrienteConfig {
  readonly id: 'ORIENTE'; readonly protocol: 'SOAP_ORIENTE'; readonly enabled: boolean;
  readonly endpoint: string; readonly username: string; readonly password: string;
}
export interface FileCentroConfig {
  readonly id: 'CENTRO'; readonly protocol: 'FILE_CENTRO'; readonly enabled: boolean;
  readonly directory: string;
}
export interface RestSurConfig {
  readonly id: 'SUR'; readonly protocol: 'REST_SUR'; readonly enabled: boolean;
  readonly baseUrl: string | undefined; readonly token: string | undefined;
}
export type CajaConfig = RestNorteConfig | SoapOrienteConfig | FileCentroConfig | RestSurConfig;
export interface DatabaseConfig {
  readonly host: string; readonly port: number; readonly database: string;
  readonly user: string; readonly password: string; readonly max: number;
  readonly connectionTimeoutMs: number; readonly queryTimeoutMs: number;
}
export interface AppConfig {
  readonly server: { readonly host: string; readonly port: number; readonly bodyLimit: number };
  readonly logLevel: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent';
  readonly database: DatabaseConfig;
  readonly cajas: readonly CajaConfig[];
  readonly auth: { readonly consumerTokens: Readonly<Record<CajaId, string>>; readonly adminToken: string };
  readonly query: {
    readonly totalTimeoutMs: number; readonly originTimeoutMs: number;
    readonly concurrency: number; readonly originConcurrency: number;
  };
  readonly batch: { readonly concurrency: number; readonly maxDocuments: number };
}
