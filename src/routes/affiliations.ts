import type { AffiliationRoutesFactory } from '../contracts/modules.ts';
import { queryDate } from '../domain/affiliation.ts';
import { normalizeDocument } from '../domain/normalization.ts';
import { API_ROUTES, affiliationParamsSchema, affiliationResponseV1Schema, affiliationResponseV2Schema, purposeQuerySchema, errorResponseSchema } from '../domain/schemas.ts';
import type { Purpose } from '../domain/types.ts';

export const createAffiliationRoutes: AffiliationRoutesFactory = options => async app => {
  app.addHook('onRequest', options.security.authenticate);
  app.addHook('onRequest', async request => { options.security.requireConsumer(request); });
  for (const [path, version, schema] of [[API_ROUTES.affiliationsV1, 1, affiliationResponseV1Schema], [API_ROUTES.affiliationsV2, 2, affiliationResponseV2Schema]] as const) {
    app.get<{ Params: { document: string }; Querystring: { purpose: Purpose } }>(path, {
      schema: { params: affiliationParamsSchema, querystring: purposeQuerySchema, response: { 200: schema, 400: errorResponseSchema, 401: errorResponseSchema, 403: errorResponseSchema, 503: errorResponseSchema } },
    }, async (request, reply) => {
      const controller = new AbortController();
      const cancel = () => { controller.abort(); };
      const disconnected = () => { if (!reply.raw.writableFinished) cancel(); };
      request.raw.once('aborted', cancel);
      reply.raw.once('close', disconnected);
      try {
        const response = await options.service.query({ document: normalizeDocument(request.params.document), identity: options.security.requireConsumer(request), purpose: request.query.purpose, requestId: request.id, asOf: queryDate((options.clock ?? (() => new Date()))()), signal: controller.signal });
        return version === 2 ? response : { ...response, matches: response.matches.map(match => ({ caja: match.caja, validFrom: match.validFrom, validTo: match.validTo, source: match.source, asOf: match.asOf })) };
      } finally {
        request.raw.off('aborted', cancel);
        reply.raw.off('close', disconnected);
      }
    });
  }
};
