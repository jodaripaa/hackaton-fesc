import { pathToFileURL } from 'node:url';
import { loadConfig } from '../config/index.ts';
import { createPostgresConnection } from './connection.ts';
import { runMigrations } from './migrations.ts';

export async function migrate(): Promise<readonly string[]> {
  const connection = createPostgresConnection(loadConfig().database);
  try { return await runMigrations(connection.pool); }
  finally { await connection.close(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { const applied = await migrate(); process.stdout.write(`Migraciones aplicadas: ${applied.length}\n`); }
  catch { process.stderr.write('No se pudieron aplicar las migraciones; revisa configuración y disponibilidad de PostgreSQL.\n'); process.exitCode = 1; }
}
