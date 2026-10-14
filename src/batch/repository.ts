import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import type { BatchRepositoryFactory } from '../contracts/modules.ts';
import { AppError } from '../domain/errors.ts';
import type { BatchJob, BatchRowResult, BatchStatus, CajaId, NormalizedDocument, Purpose } from '../domain/types.ts';

interface JobRow {
  job_id: string; requesting_caja: CajaId; purpose: Purpose; status: BatchStatus;
  created_at: Date; updated_at: Date; documents: NormalizedDocument[]; next_row: number;
}
const columns = 'job_id, requesting_caja, purpose, status, created_at, updated_at, documents, next_row';
const jobFromRow = (row: JobRow): BatchJob => ({
  jobId: row.job_id, requestingCaja: row.requesting_caja, purpose: row.purpose, status: row.status,
  createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString(), documents: row.documents,
});

/** A lease is fenced by this repository instance; an expired worker cannot write. */
export const createBatchRepository: BatchRepositoryFactory = pool => {
  const workerId = randomUUID();
  async function transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    let client: PoolClient | undefined;
    let begun = false;
    let discard = false;
    try {
      client = await pool.connect();
      await client.query('BEGIN');
      begun = true;
      const value = await work(client);
      await client.query('COMMIT');
      begun = false;
      return value;
    } catch (error) {
      if (client && begun) { try { await client.query('ROLLBACK'); } catch { discard = true; } }
      if (error instanceof AppError) throw error;
      throw new AppError(503, 'UNAVAILABLE');
    } finally { client?.release(discard); }
  }
  async function query<T extends import('pg').QueryResultRow>(sql: string, parameters: unknown[]) {
    try { return await pool.query<T>(sql, parameters); }
    catch { throw new AppError(503, 'UNAVAILABLE'); }
  }
  return {
    async createOrGet(input) {
      return transaction(async client => {
        const created = await client.query<{ job_id: string }>(
          `INSERT INTO caja_link.batch_jobs (job_id, requesting_caja, purpose, idempotency_key, content_hash, documents)
           VALUES ($1, $2, $3, $4, $5, $6::text[])
           ON CONFLICT (requesting_caja, idempotency_key) DO NOTHING RETURNING job_id`,
          [randomUUID(), input.identity.caja, input.purpose, input.idempotencyKey, input.contentHash, input.documents]);
        if (created.rows[0]) return { jobId: created.rows[0].job_id };
        // A separate READ COMMITTED statement sees the winning concurrent insert
        // after ON CONFLICT has waited for its transaction to commit.
        const existing = await client.query<{ job_id: string; content_hash: string }>(
          'SELECT job_id, content_hash FROM caja_link.batch_jobs WHERE requesting_caja = $1 AND idempotency_key = $2',
          [input.identity.caja, input.idempotencyKey]);
        const row = existing.rows[0];
        if (!row) throw new AppError(503, 'UNAVAILABLE');
        if (row.content_hash !== input.contentHash) throw new AppError(409, 'CONFLICT');
        return { jobId: row.job_id };
      });
    },
    async find(jobId, identity) {
      const result = await query<JobRow>(`SELECT ${columns} FROM caja_link.batch_jobs WHERE job_id = $1 AND requesting_caja = $2`, [jobId, identity.caja]);
      return result.rows[0] ? jobFromRow(result.rows[0]) : null;
    },
    async claimPending() {
      return transaction(async client => {
        const result = await client.query<JobRow>(
          `WITH candidate AS (
             SELECT job_id FROM caja_link.batch_jobs WHERE status = 'PENDING'
             ORDER BY created_at, job_id LIMIT 1 FOR UPDATE SKIP LOCKED
           )
           UPDATE caja_link.batch_jobs AS job
           SET status = 'RUNNING', lease_owner = $1, lease_until = clock_timestamp() + interval '30 seconds', updated_at = clock_timestamp()
           FROM candidate WHERE job.job_id = candidate.job_id RETURNING ${columns.split(', ').map(column => `job.${column}`).join(', ')}`,
          [workerId]);
        return result.rows[0] ? jobFromRow(result.rows[0]) : null;
      });
    },
    async saveResults(jobId, results) {
      if (results.length === 0) return;
      await transaction(async client => {
        const locked = await client.query<{ next_row: number; total: number; expected: NormalizedDocument[] }>(
          `SELECT next_row, cardinality(documents) AS total, documents[next_row + 1:next_row + $3] AS expected FROM caja_link.batch_jobs
           WHERE job_id = $1 AND status = 'RUNNING' AND lease_owner = $2 AND lease_until > clock_timestamp() FOR UPDATE`,
          [jobId, workerId, results.length]);
        const job = locked.rows[0];
        if (!job || job.next_row + results.length > job.total || results.some((row, index) => row.document !== job.expected[index])) {
          throw new AppError(503, 'UNAVAILABLE');
        }
        // Append only this bounded block, never rewrite an accumulated JSON array.
        const payloads = results.map(row => ({ document: row.document, requestId: row.requestId, result: row.result,
          matches: row.matches.map(match => ({ caja: match.caja, validFrom: match.validFrom, validTo: match.validTo, source: match.source, asOf: match.asOf })),
          unavailable: row.unavailable }));
        await client.query(
          `INSERT INTO caja_link.batch_results (job_id, row_index, payload)
           SELECT $1::uuid, $2::integer + ordinal::integer - 1, payload
           FROM jsonb_array_elements($3::jsonb) WITH ORDINALITY AS entries(payload, ordinal)`,
          [jobId, job.next_row, JSON.stringify(payloads)]);
        await client.query(
          `UPDATE caja_link.batch_jobs SET next_row = next_row + $2,
           lease_until = clock_timestamp() + interval '30 seconds', updated_at = clock_timestamp() WHERE job_id = $1`,
          [jobId, results.length]);
      });
    },
    async complete(jobId) {
      // Visibility of DONE and the exact number of persisted rows change together.
      const result = await query(
        `UPDATE caja_link.batch_jobs SET status = 'DONE', lease_owner = NULL, lease_until = NULL, updated_at = clock_timestamp()
         WHERE job_id = $1 AND status = 'RUNNING' AND lease_owner = $2 AND lease_until > clock_timestamp()
           AND next_row = cardinality(documents)
           AND next_row = (SELECT count(*) FROM caja_link.batch_results WHERE job_id = $1)`,
        [jobId, workerId]);
      if (result.rowCount !== 1) throw new AppError(503, 'UNAVAILABLE');
    },
    async readResults(jobId, identity, includePartial = true) {
      // One statement gives a consistent status/results snapshot and owner check.
      const result = await query<{ status: BatchStatus; results: BatchRowResult[] }>(
        `SELECT job.status, CASE WHEN job.status <> 'DONE' AND NOT $3::boolean THEN '[]'::jsonb
           ELSE COALESCE((SELECT jsonb_agg(result_row.payload ORDER BY result_row.row_index)
             FROM caja_link.batch_results AS result_row WHERE result_row.job_id = job.job_id), '[]'::jsonb) END AS results
         FROM caja_link.batch_jobs AS job WHERE job.job_id = $1 AND job.requesting_caja = $2`, [jobId, identity.caja, includePartial]);
      return result.rows[0] ?? null;
    },
    async recoverInterrupted() {
      // On graceful stop/error, release our own job. Another live instance keeps
      // its lease; after a crash its job becomes reclaimable within 30 seconds.
      const result = await query(
        `UPDATE caja_link.batch_jobs SET status = 'PENDING', lease_owner = NULL, lease_until = NULL, updated_at = clock_timestamp()
         WHERE status = 'RUNNING' AND (lease_owner = $1 OR lease_until <= clock_timestamp())`, [workerId]);
      return result.rowCount ?? 0;
    },
  };
};
