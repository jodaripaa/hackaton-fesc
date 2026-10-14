import { createHash, timingSafeEqual } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import type { SecurityFactory } from '../contracts/modules.ts';
import { AppError } from '../domain/errors.ts';
import { CAJA_IDS } from '../domain/types.ts';
import type { Identity } from '../domain/types.ts';

export const createSecurity: SecurityFactory = auth => {
  const identities = new WeakMap<FastifyRequest, Identity>();
  const digest = (value: string) => createHash('sha256').update(value).digest();
  const tokens = [
    ...CAJA_IDS.map(caja => ({ hash: digest(auth.consumerTokens[caja]), identity: { kind: 'consumer', caja } as const })),
    { hash: digest(auth.adminToken), identity: { kind: 'admin' } as const },
  ];
  const identify = (request: FastifyRequest): Identity => {
    const identity = identities.get(request);
    if (!identity) throw new AppError(401, 'UNAUTHORIZED');
    return identity;
  };
  return {
    authenticate: async request => {
      const header = request.headers.authorization;
      const match = typeof header === 'string' && header.length <= 4096 ? /^Bearer ([^\s]+)$/iu.exec(header) : null;
      if (!match?.[1]) throw new AppError(401, 'UNAUTHORIZED');
      const hash = digest(match[1]);
      let identity: Identity | undefined;
      for (const token of tokens) { if (timingSafeEqual(hash, token.hash)) identity = token.identity; }
      if (!identity) throw new AppError(401, 'UNAUTHORIZED');
      identities.set(request, identity);
    },
    requireConsumer: request => {
      const identity = identify(request);
      if (identity.kind !== 'consumer') throw new AppError(403, 'FORBIDDEN');
      return identity;
    },
    requireAdmin: request => {
      const identity = identify(request);
      if (identity.kind !== 'admin') throw new AppError(403, 'FORBIDDEN');
      return identity;
    },
  };
};
