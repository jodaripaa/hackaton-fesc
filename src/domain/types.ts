/** Public shared interfaces. Implementations live in the owning modules. */
export const CAJA_IDS = ['NORTE', 'ORIENTE', 'CENTRO', 'SUR'] as const;
export type CajaId = (typeof CAJA_IDS)[number];
export const PURPOSES = ['TARIFA_SUBSIDIADA', 'SUBSIDIO_MONETARIO', 'VALIDACION_AFILIACION'] as const;
export type Purpose = (typeof PURPOSES)[number];
export const DEFAULT_BATCH_PURPOSE: Purpose = 'VALIDACION_AFILIACION';
export const AFFILIATION_RESULTS = ['AFILIADO_OTRA_CAJA', 'NO_AFILIADO', 'INDETERMINADO'] as const;
export type AffiliationResult = (typeof AFFILIATION_RESULTS)[number];
export const AFFILIATE_TYPES = ['DEPENDIENTE', 'INDEPENDIENTE', 'PENSIONADO'] as const;
export type AffiliateType = (typeof AFFILIATE_TYPES)[number];
export type Source = 'ONLINE' | 'FILE';
/** Calendar-valid YYYY-MM-DD. Compare dates, never locale-dependent timestamps. */
export type DateOnly = string;
/** UTC RFC3339 timestamp, generated with Date.toISOString(). */
export type Timestamp = string;
declare const normalizedDocument: unique symbol;
/** Digits only; dots, whitespace and padding removed by the domain normalizer. */
export type NormalizedDocument = string & { readonly [normalizedDocument]: true };

export interface AffiliationMatchV1 {
  readonly caja: CajaId;
  readonly validFrom: DateOnly;
  readonly validTo: DateOnly | null;
  readonly source: Source;
  readonly asOf: DateOnly;
}
export interface AffiliationMatchV2 extends AffiliationMatchV1 {
  readonly affiliateType: AffiliateType;
}
export interface AffiliationResponseV1 {
  readonly requestId: string;
  readonly result: AffiliationResult;
  readonly matches: readonly AffiliationMatchV1[];
  readonly unavailable: readonly CajaId[];
}
export interface AffiliationResponseV2 extends Omit<AffiliationResponseV1, 'matches'> {
  readonly matches: readonly AffiliationMatchV2[];
}
/** Includes historical affiliations; validity is decided by the query service. */
export type NormalizedAffiliation = AffiliationMatchV2;
export type AdapterFailure = 'TIMEOUT' | 'UNAVAILABLE' | 'INVALID_RESPONSE' | 'AUTHENTICATION' | 'FILE_UNAVAILABLE';
export type AdapterResult =
  | { readonly status: 'ok'; readonly caja: CajaId; readonly affiliations: readonly NormalizedAffiliation[] }
  | { readonly status: 'unavailable'; readonly caja: CajaId; readonly reason: AdapterFailure };
export interface AdapterContext {
  readonly requestId: string;
  readonly asOf: DateOnly;
  /** Absolute epoch milliseconds; all work shares the caller's deadline. */
  readonly deadlineAt: number;
  readonly signal: AbortSignal;
}
export interface CajaAdapter {
  readonly caja: CajaId;
  lookup(document: NormalizedDocument, context: AdapterContext): Promise<AdapterResult>;
  close?(): Promise<void>;
}

export interface ConsumerIdentity { readonly kind: 'consumer'; readonly caja: CajaId }
export interface AdminIdentity { readonly kind: 'admin' }
export type Identity = ConsumerIdentity | AdminIdentity;
export interface Authenticator {
  /** Throws AppError(401) for absent/invalid credentials. No token in the result. */
  authenticate(authorization: string | undefined): Promise<Identity>;
}
export interface AffiliationQuery {
  readonly document: NormalizedDocument;
  readonly identity: ConsumerIdentity;
  readonly purpose: Purpose;
  readonly requestId: string;
  readonly asOf: DateOnly;
  readonly signal: AbortSignal;
}
export interface AffiliationService {
  /** Returns canonical v2; the v1 route projects the five v1 match fields. */
  query(input: AffiliationQuery): Promise<AffiliationResponseV2>;
}
export interface AuditEntry {
  readonly timestamp: Timestamp;
  readonly requestingCaja: CajaId;
  readonly purpose: Purpose;
  readonly result: AffiliationResult;
  /** At most four visible document digits; never the full document. */
  readonly documentMasked: string;
}
export interface AuditRecord extends AuditEntry { readonly requestId: string }
export interface AuditRepository {
  append(record: AuditRecord): Promise<void>;
  /** Newest first. Only an admin route may expose the result. */
  list(limit: number): Promise<readonly AuditEntry[]>;
}

export type BatchStatus = 'PENDING' | 'RUNNING' | 'DONE';
export interface BatchAccepted { readonly jobId: string }
export interface BatchRowResult extends AffiliationResponseV1 { readonly document: NormalizedDocument }
export interface BatchResponse { readonly status: BatchStatus; readonly results: readonly BatchRowResult[] }
export interface BatchSubmission {
  readonly identity: ConsumerIdentity;
  readonly purpose: Purpose;
  readonly idempotencyKey: string;
  /** SHA256 of purpose plus ordered normalized documents, not a token. */
  readonly contentHash: string;
  readonly documents: readonly NormalizedDocument[];
  readonly requestId: string;
}
export interface BatchJob {
  readonly jobId: string;
  readonly requestingCaja: CajaId;
  readonly purpose: Purpose;
  readonly status: BatchStatus;
  readonly createdAt: Timestamp;
  readonly updatedAt: Timestamp;
  readonly documents: readonly NormalizedDocument[];
}
export interface BatchRepository {
  /** Atomic consumer+key uniqueness. Different content throws AppError(409). */
  createOrGet(input: BatchSubmission): Promise<BatchAccepted>;
  find(jobId: string, identity: ConsumerIdentity): Promise<BatchJob | null>;
  /** Atomically claims a pending job; worker recovery is owned by the batch module. */
  claimPending(): Promise<BatchJob | null>;
  saveResults(jobId: string, results: readonly BatchRowResult[]): Promise<void>;
  complete(jobId: string): Promise<void>;
  readResults(jobId: string, identity: ConsumerIdentity): Promise<BatchResponse | null>;
  recoverInterrupted(): Promise<number>;
}
export interface BatchService {
  submit(input: BatchSubmission): Promise<BatchAccepted>;
  get(jobId: string, identity: ConsumerIdentity): Promise<BatchResponse | null>;
  start(): Promise<void>;
  stop(): Promise<void>;
}
