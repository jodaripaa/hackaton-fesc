import { pathToFileURL } from 'node:url';
import { buildApp } from './app.ts';
import { ConfigurationError, loadConfig } from './config/index.ts';
import { createPostgresConnection } from './persistence/connection.ts';
import { runMigrations } from './persistence/migrations.ts';

export async function start(): Promise<void> {
  const config = loadConfig();
  const persistence = createPostgresConnection(config.database);
  const app = buildApp({ config, persistence });
  try {
    await runMigrations(persistence.pool);
    await app.listen({ host: config.server.host, port: config.server.port });
  } catch (error) {
    await app.close();
    throw error;
  }
  let closing = false;
  const shutdown = async () => {
    if (closing) return;
    closing = true;
    try { await app.close(); }
    catch { process.stderr.write('Error en el cierre del servicio.\n'); process.exitCode = 1; }
  };
  process.once('SIGINT', () => { void shutdown(); });
  process.once('SIGTERM', () => { void shutdown(); });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { await start(); }
  catch (error) {
    // ConfigurationError messages contain variable/field names only. All other errors are withheld.
    process.stderr.write(error instanceof ConfigurationError ? `${error.message}\n` : 'No se pudo iniciar Caja Link; revisa PostgreSQL y las migraciones.\n');
    process.exitCode = 1;
  }
}
