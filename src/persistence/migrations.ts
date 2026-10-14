import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import type { Pool } from 'pg';

export const DEFAULT_MIGRATIONS_DIRECTORY = fileURLToPath(new URL('./migrations/', import.meta.url));
export interface Migration { readonly name: string; readonly sql: string; readonly checksum: string }

export async function readMigrations(directory = DEFAULT_MIGRATIONS_DIRECTORY): Promise<readonly Migration[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const names = entries.filter(entry => entry.isFile() && entry.name.endsWith('.sql')).map(entry => entry.name).sort();
  if (!names.length || names.some(name => !/^\d{3}_[a-z0-9_-]+\.sql$/u.test(name)) || new Set(names.map(name => name.slice(0, 3))).size !== names.length) {
    throw new Error('Migration filenames must use unique NNN_name.sql prefixes');
  }
  return Promise.all(names.map(async name => {
    const sql = (await readFile(join(directory, name), 'utf8')).replaceAll('\r\n', '\n');
    return { name, sql, checksum: createHash('sha256').update(sql).digest('hex') };
  }));
}

/** One connection holds the lock. Each migration and its record commit atomically. */
export async function runMigrations(pool: Pool, directory = DEFAULT_MIGRATIONS_DIRECTORY): Promise<readonly string[]> {
  const migrations = await readMigrations(directory);
  const client = await pool.connect();
  const applied: string[] = [];
  let locked = false;
  try {
    await client.query('SELECT pg_advisory_lock(1731001001)');
    locked = true;
    await client.query('CREATE TABLE IF NOT EXISTS public.caja_link_migrations (name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())');
    const existing = await client.query<{ name: string; checksum: string }>('SELECT name, checksum FROM public.caja_link_migrations ORDER BY name');
    const known = new Map(migrations.map(migration => [migration.name, migration]));
    if (existing.rows.some(row => known.get(row.name)?.checksum !== row.checksum)) {
      throw new Error('Applied migrations changed or are missing; restore the original SQL');
    }
    for (const migration of migrations) {
      if (existing.rows.some(row => row.name === migration.name)) continue;
      if (existing.rows.some(row => row.name > migration.name)) throw new Error('New migrations must be appended after existing versions');
      await client.query('BEGIN');
      try {
        await client.query(migration.sql);
        await client.query('INSERT INTO public.caja_link_migrations (name, checksum) VALUES ($1, $2)', [migration.name, migration.checksum]);
        await client.query('COMMIT');
        applied.push(migration.name);
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }
    return applied;
  } finally {
    try { if (locked) await client.query('SELECT pg_advisory_unlock(1731001001)'); }
    finally { client.release(); }
  }
}
