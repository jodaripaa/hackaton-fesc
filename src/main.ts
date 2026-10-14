import { pathToFileURL } from 'node:url';
import { buildApp } from './app.ts';
import { ConfigurationError, loadConfig } from './config/index.ts';
import { createPostgresConnection } from './persistence/connection.ts';
import { runMigrations } from './persistence/migrations.ts';
import { createAdapters } from './adapters/index.ts';
import { createAffiliationService } from './application/affiliations.ts';
import { createAuditRepository } from './audit/repository.ts';
import { createSecurity } from './security/index.ts';
import { createAffiliationRoutes } from './routes/affiliations.ts';
import { createAuditRoutes } from './routes/audit.ts';
import { createBatchRepository } from './batch/repository.ts';
import { createBatchService } from './batch/service.ts';
import { createBatchRoutes } from './routes/batch.ts';

export async function start(): Promise<void> {
  const config = loadConfig();
  const persistence = createPostgresConnection(config.database);
  const adapters = createAdapters(config.cajas, config.query);
  const expected = config.cajas.filter(caja => caja.enabled).map(caja => caja.id).sort();
  if (JSON.stringify(adapters.map(adapter => adapter.caja).sort()) !== JSON.stringify(expected)) throw new Error('Missing enabled adapter');
  const security = createSecurity(config.auth);
  const audit = createAuditRepository(persistence.pool);
  const affiliations = createAffiliationService({ adapters, query: config.query, audit });
  const batches = createBatchService({
    repository: createBatchRepository(persistence.pool), affiliations,
    batch: config.batch, query: config.query,
  });
  const app = buildApp({ config, persistence, modules: {
    affiliations: createAffiliationRoutes({ service: affiliations, security }),
    audit: createAuditRoutes({ repository: audit, security }),
    batch: createBatchRoutes({ service: batches, security, batch: config.batch }),
  } });
  app.addHook('onClose', async () => { await Promise.all(adapters.map(adapter => adapter.close?.())); });
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
