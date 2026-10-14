import { AFFILIATE_TYPES, AFFILIATION_RESULTS, CAJA_IDS, PURPOSES } from './types.ts';

const date = { type: 'string', format: 'date' } as const;
const caja = { type: 'string', enum: [...CAJA_IDS] } as const;
const matchProperties = {
  caja, validFrom: date, validTo: { anyOf: [date, { type: 'null' }] },
  source: { type: 'string', enum: ['ONLINE', 'FILE'] }, asOf: date,
};
export const matchV1Schema = {
  type: 'object', additionalProperties: false,
  required: ['caja', 'validFrom', 'validTo', 'source', 'asOf'], properties: matchProperties,
} as const;
export const matchV2Schema = {
  type: 'object', additionalProperties: false,
  required: [...matchV1Schema.required, 'affiliateType'],
  properties: { ...matchProperties, affiliateType: { type: 'string', enum: [...AFFILIATE_TYPES] } },
} as const;
const responseProperties = {
  requestId: { type: 'string', minLength: 1 }, result: { type: 'string', enum: [...AFFILIATION_RESULTS] },
  unavailable: { type: 'array', uniqueItems: true, items: caja },
};
export const affiliationResponseV1Schema = {
  type: 'object', additionalProperties: false, required: ['requestId', 'result', 'matches', 'unavailable'],
  properties: { ...responseProperties, matches: { type: 'array', items: matchV1Schema } },
} as const;
export const affiliationResponseV2Schema = {
  ...affiliationResponseV1Schema,
  properties: { ...responseProperties, matches: { type: 'array', items: matchV2Schema } },
} as const;
export const affiliationParamsSchema = {
  type: 'object', additionalProperties: false, required: ['document'],
  properties: { document: { type: 'string', minLength: 1, maxLength: 64 } },
} as const;
export const purposeQuerySchema = {
  type: 'object', additionalProperties: false, required: ['purpose'],
  properties: { purpose: { type: 'string', enum: [...PURPOSES] } },
} as const;
export const batchPurposeQuerySchema = { ...purposeQuerySchema, required: [] } as const;
export const batchHeadersSchema = {
  type: 'object', required: ['idempotency-key'],
  properties: { 'idempotency-key': { type: 'string', minLength: 1, maxLength: 200 } },
} as const;
export const batchAcceptedSchema = {
  type: 'object', additionalProperties: false, required: ['jobId'],
  properties: { jobId: { type: 'string', format: 'uuid' } },
} as const;
export const batchParamsSchema = {
  type: 'object', additionalProperties: false, required: ['jobId'], properties: batchAcceptedSchema.properties,
} as const;
export const batchRowSchema = {
  ...affiliationResponseV1Schema, required: [...affiliationResponseV1Schema.required, 'document'],
  properties: { ...affiliationResponseV1Schema.properties, document: { type: 'string', pattern: '^[0-9]+$' } },
} as const;
export const batchResponseSchema = {
  type: 'object', additionalProperties: false, required: ['status', 'results'],
  properties: { status: { type: 'string', enum: ['PENDING', 'RUNNING', 'DONE'] }, results: { type: 'array', items: batchRowSchema } },
} as const;
export const auditQuerySchema = {
  type: 'object', additionalProperties: false,
  properties: { limit: { type: 'integer', minimum: 1, maximum: 1000, default: 100 } },
} as const;
export const auditEntrySchema = {
  type: 'object', additionalProperties: false,
  required: ['timestamp', 'requestingCaja', 'purpose', 'result', 'documentMasked'],
  properties: {
    timestamp: { type: 'string', format: 'date-time' }, requestingCaja: caja,
    purpose: { type: 'string', enum: [...PURPOSES] }, result: responseProperties.result,
    documentMasked: { type: 'string', pattern: '^[^0-9]*[0-9]{0,4}$', minLength: 1 },
  },
} as const;
export const auditResponseSchema = { type: 'array', items: auditEntrySchema } as const;
export const errorResponseSchema = {
  type: 'object', additionalProperties: false, required: ['error', 'requestId'],
  properties: {
    error: { type: 'string', enum: ['INVALID_REQUEST', 'UNAUTHORIZED', 'FORBIDDEN', 'NOT_FOUND', 'CONFLICT', 'UNAVAILABLE', 'INTERNAL_ERROR'] },
    requestId: { type: 'string', minLength: 1 },
  },
} as const;
export const API_ROUTES = {
  affiliationsV1: '/api/v1/affiliations/:document', affiliationsV2: '/api/v2/affiliations/:document',
  batchCreate: '/api/v1/batch-checks', batchStatus: '/api/v1/batch-checks/:jobId', audit: '/api/v1/audit',
} as const;
