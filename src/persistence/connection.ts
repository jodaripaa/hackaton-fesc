import pg from 'pg';
import type { DatabaseConfig } from '../config/types.ts';

export interface PersistenceHealth {
  ping(): Promise<boolean>;
  close(): Promise<void>;
}
export interface PostgresConnection extends PersistenceHealth { readonly pool: pg.Pool }

export function createPostgresConnection(config: DatabaseConfig): PostgresConnection {
  const pool = new pg.Pool({
    host: config.host, port: config.port, database: config.database, user: config.user, password: config.password,
    max: config.max, connectionTimeoutMillis: config.connectionTimeoutMs, idleTimeoutMillis: 30000,
    query_timeout: config.queryTimeoutMs, statement_timeout: config.queryTimeoutMs, application_name: 'caja-link',
  });
  // pg emits idle-client errors; never let a listener print connection details or terminate the process.
  pool.on('error', () => {});
  return {
    pool,
    async ping() {
      try { await pool.query('SELECT 1'); return true; } catch { return false; }
    },
    async close() { await pool.end(); },
  };
}
