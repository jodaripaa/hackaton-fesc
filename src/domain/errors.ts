export type ErrorCode = 'INVALID_REQUEST' | 'UNAUTHORIZED' | 'FORBIDDEN' | 'NOT_FOUND' | 'CONFLICT' | 'UNAVAILABLE' | 'INTERNAL_ERROR';
export interface ErrorResponse { readonly error: ErrorCode; readonly requestId: string }
/** Only the fixed code is exposed. Never return raw messages, upstream bodies or SQL errors. */
export class AppError extends Error {
  override readonly name = 'AppError';
  readonly statusCode: 400 | 401 | 403 | 404 | 409 | 413 | 415 | 429 | 503;
  readonly code: ErrorCode;
  constructor(statusCode: AppError['statusCode'], code: ErrorCode) {
    super(code);
    this.statusCode = statusCode;
    this.code = code;
  }
}
