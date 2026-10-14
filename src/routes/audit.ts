import type { AuditRoutesFactory } from '../contracts/modules.ts';
import { API_ROUTES, auditQuerySchema, auditResponseSchema, errorResponseSchema } from '../domain/schemas.ts';

export const createAuditRoutes: AuditRoutesFactory = options => async app => {
  app.addHook('onRequest', options.security.authenticate);
  app.addHook('onRequest', async request => { options.security.requireAdmin(request); });
  app.get<{ Querystring: { limit?: number } }>(API_ROUTES.audit, {
    schema: { querystring: auditQuerySchema, response: { 200: auditResponseSchema, 400: errorResponseSchema, 401: errorResponseSchema, 403: errorResponseSchema, 503: errorResponseSchema } },
  }, request => options.repository.list(request.query.limit ?? 100));
};
