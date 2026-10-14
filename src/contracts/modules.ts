import type { FastifyPluginAsync, FastifyRequest, onRequestHookHandler } from 'fastify';
import type { Pool } from 'pg';
import type { AppConfig, CajaConfig } from '../config/types.ts';
import type {
  AdminIdentity, AffiliationService, AuditRepository, BatchRepository, BatchService,
  CajaAdapter, ConsumerIdentity,
} from '../domain/types.ts';

/** Exported function types, not implementations of future modules. */
export type AdapterFactory = (cajas: readonly CajaConfig[], query: AppConfig['query']) => readonly CajaAdapter[];
export interface RouteSecurity {
  readonly authenticate: onRequestHookHandler;
  requireConsumer(request: FastifyRequest): ConsumerIdentity;
  requireAdmin(request: FastifyRequest): AdminIdentity;
}
export type SecurityFactory = (auth: AppConfig['auth']) => RouteSecurity;
export type AuditRepositoryFactory = (pool: Pool) => AuditRepository;
export type BatchRepositoryFactory = (pool: Pool) => BatchRepository;
export interface AffiliationServiceOptions {
  readonly adapters: readonly CajaAdapter[];
  readonly query: AppConfig['query'];
  readonly audit: AuditRepository;
}
export type AffiliationServiceFactory = (options: AffiliationServiceOptions) => AffiliationService;
export interface BatchServiceOptions {
  readonly repository: BatchRepository;
  readonly affiliations: AffiliationService;
  readonly batch: AppConfig['batch'];
  readonly query: AppConfig['query'];
}
export type BatchServiceFactory = (options: BatchServiceOptions) => BatchService;
export interface AffiliationRoutesOptions {
  readonly service: AffiliationService;
  readonly security: RouteSecurity;
  readonly clock?: () => Date;
}
export interface AuditRoutesOptions { readonly repository: AuditRepository; readonly security: RouteSecurity }
export interface BatchRoutesOptions { readonly service: BatchService; readonly security: RouteSecurity; readonly batch: AppConfig['batch'] }
export type AffiliationRoutesFactory = (options: AffiliationRoutesOptions) => FastifyPluginAsync;
export type AuditRoutesFactory = (options: AuditRoutesOptions) => FastifyPluginAsync;
export type BatchRoutesFactory = (options: BatchRoutesOptions) => FastifyPluginAsync;
