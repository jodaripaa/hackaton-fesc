import { randomUUID } from 'node:crypto';
import Fastify, { LogController } from 'fastify';
import type { FastifyError, FastifyInstance, FastifyPluginAsync } from 'fastify';
import type { AppConfig } from './config/types.ts';
import { AppError } from './domain/errors.ts';
import { errorResponseSchema } from './domain/schemas.ts';
import type { PersistenceHealth } from './persistence/connection.ts';

/** Factories in future modules close over their typed dependencies and return these plugins. */
export interface AppModules {
  readonly affiliations?: FastifyPluginAsync;
  readonly audit?: FastifyPluginAsync;
  readonly batch?: FastifyPluginAsync;
}
export interface BuildAppOptions {
  readonly config: AppConfig;
  readonly persistence: PersistenceHealth;
  readonly modules?: AppModules;
  /** In-memory tests can suppress logs. Production uses the safe logger below. */
  readonly logger?: boolean;
  readonly logStream?: { write(message: string): void };
}
export function buildApp(options: BuildAppOptions): FastifyInstance {
  const app = Fastify({
    logger: options.logger === false ? false : {
      level: options.config.logLevel,
      ...(options.logStream ? { stream: options.logStream } : {}),
      redact: { paths: ['req.headers', 'res.headers', 'body', 'document', 'token', 'password', 'authorization', 'config'], censor: '[REDACTED]' },
      serializers: {
        // No raw URL, parameters, headers, body, error message or stack enters the default logs.
        req: req => ({ method: req.method }),
        res: res => ({ statusCode: res.statusCode }),
        err: () => ({ type: 'RedactedError', message: '[REDACTED]', stack: '[REDACTED]' }),
      },
    },
    genReqId: () => randomUUID(), requestIdHeader: false,
    logController: new LogController({ disableRequestLogging: true }), bodyLimit: options.config.server.bodyLimit,
    requestTimeout: 10000, connectionTimeout: 10000,
    ajv: { customOptions: { removeAdditional: false, allErrors: false } },
  });
  app.addHook('onRequest', async (_request, reply) => { reply.header('cache-control', 'no-store'); });
  app.addHook('onResponse', async (request, reply) => {
    request.log.info({ method: request.method, statusCode: reply.statusCode, responseTime: reply.elapsedTime }, 'request completed');
  });
  app.setErrorHandler((error, request, reply) => {
    const frameworkError = error instanceof Error ? error as FastifyError : undefined;
    const frameworkStatus = frameworkError?.statusCode;
    const statusCode = error instanceof AppError ? error.statusCode : frameworkError?.validation ? 400 : (typeof frameworkStatus === 'number' && frameworkStatus >= 400 && frameworkStatus < 500 ? frameworkStatus : 500);
    const code = error instanceof AppError ? error.code : statusCode < 500 ? 'INVALID_REQUEST' : 'INTERNAL_ERROR';
    if (statusCode >= 500) request.log.error({ code, statusCode }, 'request failed');
    void reply.code(statusCode).send({ error: code, requestId: request.id });
  });
  app.setNotFoundHandler((_request, reply) => { void reply.code(404).send({ error: 'NOT_FOUND', requestId: _request.id }); });
  const healthSchema = {
    type: 'object', additionalProperties: false, required: ['status'], properties: { status: { type: 'string', enum: ['ok'] } },
  } as const;
  app.get('/health', { schema: { response: { 200: healthSchema } } }, async () => ({ status: 'ok' }));
  app.get('/ready', {
    schema: { response: {
      200: { type: 'object', additionalProperties: false, required: ['status', 'database'], properties: { status: { type: 'string', enum: ['ready'] }, database: { type: 'string', enum: ['up'] } } },
      503: errorResponseSchema,
    } },
  }, async () => {
    if (!await options.persistence.ping()) throw new AppError(503, 'UNAVAILABLE');
    return { status: 'ready', database: 'up' };
  });
  for (const plugin of [options.modules?.affiliations, options.modules?.audit, options.modules?.batch]) {
    if (plugin) app.register(plugin);
  }
  app.addHook('onClose', async () => { await options.persistence.close(); });
  return app;
}
