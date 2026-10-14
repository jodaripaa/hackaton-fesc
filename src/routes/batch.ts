import multipart from '@fastify/multipart';
import type { BatchRoutesFactory } from '../contracts/modules.ts';
import { batchContentHash, parseBatchCsv, validateIdempotencyKey } from '../batch/csv.ts';
import { AppError } from '../domain/errors.ts';
import { API_ROUTES, batchAcceptedSchema, batchHeadersSchema, batchParamsSchema, batchPurposeQuerySchema, batchResponseSchema, errorResponseSchema } from '../domain/schemas.ts';
import { DEFAULT_BATCH_PURPOSE } from '../domain/types.ts';
import type { Purpose } from '../domain/types.ts';

export const createBatchRoutes: BatchRoutesFactory = options => async app => {
  app.addHook('onRequest', options.security.authenticate);
  app.addHook('onRequest', async request => { options.security.requireConsumer(request); });
  app.addHook('onReady', async () => { await options.service.start(); });
  app.addHook('onClose', async () => { await options.service.stop(); });
  app.addContentTypeParser('text/csv', { parseAs: 'buffer' }, (_request, body, done) => { done(null, body); });
  await app.register(multipart, { limits: { files: 1, fields: 0, parts: 1, headerPairs: 32,
    ...(app.initialConfig.bodyLimit === undefined ? {} : { fileSize: app.initialConfig.bodyLimit }),
  }, throwFileSizeLimit: true });
  const errors = { 400: errorResponseSchema, 401: errorResponseSchema, 403: errorResponseSchema, 404: errorResponseSchema, 409: errorResponseSchema, 413: errorResponseSchema, 415: errorResponseSchema, 503: errorResponseSchema };
  app.post<{ Querystring: { purpose?: Purpose } }>(API_ROUTES.batchCreate, {
    schema: { headers: batchHeadersSchema, querystring: batchPurposeQuerySchema, response: { ...errors, 202: batchAcceptedSchema } },
  }, async (request, reply) => {
    const identity = options.security.requireConsumer(request);
    const key = request.headers['idempotency-key'];
    validateIdempotencyKey(key);
    const purpose = request.query.purpose ?? DEFAULT_BATCH_PURPOSE;
    let csv: Buffer | undefined;
    if (request.isMultipart()) {
      try {
        for await (const part of request.parts()) {
          if (part.type !== 'file' || part.fieldname !== 'file' || csv !== undefined) throw new AppError(400, 'INVALID_REQUEST');
          csv = await part.toBuffer();
        }
      } catch (error) {
        if (error instanceof AppError) throw error;
        const code = error !== null && typeof error === 'object' && 'code' in error ? error.code : undefined;
        throw new AppError(code === 'FST_REQ_FILE_TOO_LARGE' || code === 'FST_FILES_LIMIT' || code === 'FST_PARTS_LIMIT' || code === 'FST_FIELDS_LIMIT' ? 413 : 400, 'INVALID_REQUEST');
      }
    } else if (Buffer.isBuffer(request.body)) csv = request.body;
    if (!csv) throw new AppError(400, 'INVALID_REQUEST');
    const documents = parseBatchCsv(csv, options.batch.maxDocuments);
    const accepted = await options.service.submit({ identity, purpose, idempotencyKey: key,
      contentHash: batchContentHash(purpose, documents), documents, requestId: request.id });
    return reply.code(202).send(accepted);
  });
  app.get<{ Params: { jobId: string } }>(API_ROUTES.batchStatus, {
    schema: { params: batchParamsSchema, response: { ...errors, 200: batchResponseSchema } },
  }, async request => {
    const result = await options.service.get(request.params.jobId, options.security.requireConsumer(request));
    if (!result) throw new AppError(404, 'NOT_FOUND');
    return result;
  });
};
