import type { AuditRepositoryFactory } from '../contracts/modules.ts';
import { AppError } from '../domain/errors.ts';
import type { AuditEntry, AuditRecord, CajaId, Purpose, AffiliationResult } from '../domain/types.ts';

interface AuditRow { occurred_at: Date; requesting_caja: CajaId; purpose: Purpose; result: AffiliationResult; document_masked: string }

export const createAuditRepository: AuditRepositoryFactory = pool => ({
  async append(record: AuditRecord): Promise<void> {
    if (!/^\*+[0-9]{0,4}$/u.test(record.documentMasked)) throw new AppError(503, 'UNAVAILABLE');
    try {
      await pool.query('INSERT INTO caja_link.audit (request_id, occurred_at, requesting_caja, purpose, result, document_masked) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (request_id) DO NOTHING',
        [record.requestId, record.timestamp, record.requestingCaja, record.purpose, record.result, record.documentMasked]);
    } catch { throw new AppError(503, 'UNAVAILABLE'); }
  },
  async list(limit: number): Promise<readonly AuditEntry[]> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw new AppError(400, 'INVALID_REQUEST');
    try {
      const rows = await pool.query<AuditRow>('SELECT occurred_at, requesting_caja, purpose, result, document_masked FROM caja_link.audit ORDER BY occurred_at DESC, id DESC LIMIT $1', [limit]);
      return rows.rows.map(row => ({ timestamp: row.occurred_at.toISOString(), requestingCaja: row.requesting_caja, purpose: row.purpose, result: row.result, documentMasked: row.document_masked }));
    } catch { throw new AppError(503, 'UNAVAILABLE'); }
  },
});
