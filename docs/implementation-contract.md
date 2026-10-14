# Contrato de implementación compartido — Caja Link

Los módulos de adaptadores, consultas, seguridad, auditoría y lotes están implementados e integrados en `main.ts`. El arranque aplica las migraciones antes de abrir el puerto y el plugin de lotes administra el worker. `GET /health` comprueba el proceso y `GET /ready` comprueba PostgreSQL; readiness no sustituye las pruebas de las cinco operaciones de negocio.

## Archivos y exports existentes

| Archivo | Exports reales y finalidad |
|---|---|
| `src/config/index.ts` | `loadConfig(env?, { cajasPath? }?): AppConfig`, `ConfigurationError`, tipos de configuración |
| `src/config/types.ts` | `AppConfig`, `DatabaseConfig`, `CajaConfig` y sus cuatro variantes discriminadas |
| `src/domain/types.ts` | Identidades, documentos, finalidades, respuestas, interfaces de adaptadores, consultas, auditoría y lotes detalladas abajo |
| `src/domain/schemas.ts` | `API_ROUTES`, esquemas de entrada/salida que las rutas deben importar |
| `src/domain/errors.ts` | `AppError`, `ErrorCode`, `ErrorResponse` |
| `src/contracts/modules.ts` | Tipos de factories y dependencias de plugins; ninguna implementación de módulos futuros |
| `src/persistence/connection.ts` | `createPostgresConnection(config: DatabaseConfig): PostgresConnection`, `PersistenceHealth`, `PostgresConnection` |
| `src/persistence/migrations.ts` | `readMigrations(directory?): Promise<readonly Migration[]>`, `runMigrations(pool: Pool, directory?): Promise<readonly string[]>`, `DEFAULT_MIGRATIONS_DIRECTORY`, `Migration` |
| `src/persistence/migrate.ts` | `migrate(): Promise<readonly string[]>` y ejecución CLI segura |
| `src/app.ts` | `buildApp(options: BuildAppOptions): FastifyInstance`, `AppModules`, `BuildAppOptions` |
| `src/main.ts` | `start(): Promise<void>`; configuración, migraciones, escucha, SIGINT/SIGTERM |

Se usa ESM y TypeScript estricto, incluidos `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` y `erasableSyntaxOnly`. Los imports relativos de archivos TypeScript usan `.ts`; el compilador reescribe a `.js`. `node:test` puede ejecutar los tests `.ts` directamente con Node 24, sin `tsx` ni mocks internos del kit.

## Modelo común existente

`CajaId = 'NORTE' | 'ORIENTE' | 'CENTRO' | 'SUR'`. `Purpose` admite únicamente `TARIFA_SUBSIDIADA`, `SUBSIDIO_MONETARIO` y `VALIDACION_AFILIACION`. `DEFAULT_BATCH_PURPOSE` exporta `VALIDACION_AFILIACION`. Las constantes `CAJA_IDS`, `PURPOSES`, `AFFILIATION_RESULTS` y `AFFILIATE_TYPES` son arrays readonly.

`NormalizedDocument` es un string con marca de tipo; 03 lo construye tras validar y normalizar, nunca con coerción de una entrada arbitraria. `DateOnly` es un string calendario válido `YYYY-MM-DD`. `Timestamp` es RFC3339 UTC generado con `toISOString()`. Las marcas y aliases no sustituyen validación de entrada.

`AffiliationMatchV1` contiene exactamente `caja`, `validFrom`, `validTo: DateOnly | null`, `source: 'ONLINE' | 'FILE'` y `asOf`. `AffiliationMatchV2` añade `affiliateType: 'DEPENDIENTE' | 'INDEPENDIENTE' | 'PENSIONADO'`. `NormalizedAffiliation` es el mismo tipo que `AffiliationMatchV2`, incluyendo historial aún sin filtrar.

`AffiliationResponseV1` contiene `requestId`, `result`, `matches` v1 y `unavailable: readonly CajaId[]`. `AffiliationResponseV2` sustituye `matches` por coincidencias v2. `AffiliationResult` tiene los tres estados del reto. Las colecciones son readonly; no modificar respuestas compartidas por cachés ni lotes.

## Adaptadores — tarea 02

La interfaz que ya exporta `src/domain/types.ts` es:

```ts
interface CajaAdapter {
  readonly caja: CajaId;
  lookup(document: NormalizedDocument, context: AdapterContext): Promise<AdapterResult>;
  close?(): Promise<void>;
}
interface AdapterContext {
  readonly requestId: string;
  readonly asOf: DateOnly;
  readonly deadlineAt: number;
  readonly signal: AbortSignal;
}
type AdapterResult =
  | { readonly status: 'ok'; readonly caja: CajaId; readonly affiliations: readonly NormalizedAffiliation[] }
  | { readonly status: 'unavailable'; readonly caja: CajaId; readonly reason: AdapterFailure };
```

`AdapterFailure = TIMEOUT | UNAVAILABLE | INVALID_RESPONSE | AUTHENTICATION | FILE_UNAVAILABLE`. Una búsqueda válida sin afiliaciones devuelve `status: 'ok', affiliations: []`. Timeout, 5xx, SOAP Fault, respuesta inválida, archivo ausente/ilegible/corrupto o falta de adaptador habilitado representan indisponibilidad; nunca una lista vacía que aparente ausencia confirmada. El factory debe producir un adaptador por cada caja habilitada y la integración verifica esa correspondencia.

Carpeta asignada: `src/adapters/`. Export implementado en `src/adapters/index.ts`: `createAdapters: AdapterFactory`. La firma es `(cajas: readonly CajaConfig[], query: AppConfig['query']) => readonly CajaAdapter[]`. Los adaptadores reciben URL, endpoint, credenciales y directorio ya resueltos; jamás incluyen hosts, puertos o direcciones de las cajas escritos en `src/`, tampoco como fallback. `RestSurConfig` tiene URL/token posiblemente undefined mientras está deshabilitada; con `enabled: true`, el loader los exige y el factory verifica sus tipos.

No montar ni leer `mocks/data` desde código del equipo. Centro se obtiene exclusivamente del archivo publicado del directorio configurado, elige la fecha más reciente y conserva `FECHA_CORTE` en `asOf`. Un archivo inexistente durante operación devuelve `FILE_UNAVAILABLE`, permitiendo consultar los otros orígenes. Validar fechas reales y tipos antes de exponer filas. SOAP requiere escape XML, límites de respuesta y rechazo de DTD/entidades externas; no se ha seleccionado ni implementado todavía un parser.

## Consultas — tarea 03

```ts
interface AffiliationService {
  query(input: AffiliationQuery): Promise<AffiliationResponseV2>;
}
interface AffiliationQuery {
  readonly document: NormalizedDocument;
  readonly identity: ConsumerIdentity;
  readonly purpose: Purpose;
  readonly requestId: string;
  readonly asOf: DateOnly;
  readonly signal: AbortSignal;
}
interface AffiliationServiceOptions {
  readonly adapters: readonly CajaAdapter[];
  readonly query: AppConfig['query'];
  readonly audit: AuditRepository;
}
```

Export implementado: `src/application/affiliations.ts` → `createAffiliationService`. Acepta las opciones de `AffiliationServiceFactory` y opcionalmente `requiredCajas` para detectar orígenes configurados ausentes. Rutas implementadas: `src/routes/affiliations.ts` → `createAffiliationRoutes: AffiliationRoutesFactory`. Opciones: `{ service: AffiliationService; security: RouteSecurity; clock?: () => Date }`. 03 también es dueño de `src/domain/normalization.ts` y `src/domain/affiliation.ts`.

Normalizar puntos, espacios y ceros de relleno sin convertir el documento a Number. Rechazar entradas vacías, caracteres no permitidos y documentos que no puedan representarse en los orígenes. La fecha de consulta se captura una vez por petición con calendario de `America/Bogota`, sin depender de la zona del host; `clock` permite probar límites. Comparar fechas ISO calendario validadas: `validFrom <= asOf` y `validTo === null || validTo >= asOf`. El extremo final es inclusivo; fechas de inicio futuras no son vigentes. `asOf` de ONLINE es el corte de consulta; FILE conserva su fecha publicada.

Excluir la caja consumidora antes de llamar adaptadores. Presupuesto total por consulta `QUERY_TOTAL_TIMEOUT_MS=4500` (rango permitido 100–4900 ms), incluido tiempo en cola de concurrencia. `ORIGIN_TIMEOUT_MS=3500` nunca supera el total. Propagar señal y deadline a todos los orígenes; el límite por origen no reinicia el presupuesto total. `QUERY_CONCURRENCY=64` y `ORIGIN_CONCURRENCY=32` son límites de trabajo en vuelo, no permisos para aumentar el timeout. Si un origen requerido no pudo comprobarse, enumerarlo en `unavailable`; una coincidencia puede coexistir con esa lista. No devolver `NO_AFILIADO` si algún origen requerido está ausente, falló o no pudo consultarse.

La respuesta canónica es v2. La ruta v1 proyecta las cinco propiedades de cada match y usa `affiliationResponseV1Schema`; v2 usa `affiliationResponseV2Schema`. Los esquemas son listas permitidas. Los adaptadores ya eliminan los campos personales antes de entregarlos al dominio; la serialización constituye una defensa adicional. La consulta registra auditoría antes de devolver un resultado exitoso. Si falla la persistencia indispensable de auditoría, devolver `AppError(503, 'UNAVAILABLE')`, sin ocultar esa falla.

El deadline total incluye también auditoría y preparación de respuesta. No sumar el timeout PostgreSQL después de agotar 4500 ms en orígenes: la operación completa debe estar limitada por ese mismo deadline, con cancelación y una carrera acotada cuando una dependencia no admita señal. Si no se consigue persistir auditoría dentro del presupuesto, responder 503 antes del límite total. La espera de una consulta SQL pendiente no debe prolongar la respuesta HTTP por encima de cinco segundos.

## Identidad y seguridad — tarea 04

```ts
interface ConsumerIdentity { readonly kind: 'consumer'; readonly caja: CajaId }
interface AdminIdentity { readonly kind: 'admin' }
type Identity = ConsumerIdentity | AdminIdentity;
interface Authenticator {
  authenticate(authorization: string | undefined): Promise<Identity>;
}
interface RouteSecurity {
  readonly authenticate: onRequestHookHandler;
  requireConsumer(request: FastifyRequest): ConsumerIdentity;
  requireAdmin(request: FastifyRequest): AdminIdentity;
}
```

Carpeta: `src/security/`. Export implementado `src/security/index.ts` → `createSecurity: SecurityFactory`, cuya firma existente es `(auth: AppConfig['auth']) => RouteSecurity`. El módulo decide cómo asociar identidad al request (decoración encapsulada o WeakMap); no debe almacenar tokens en la identidad ni alterar los tipos comunes. `requireConsumer`/`requireAdmin` fallan con 401 si no hubo autenticación y 403 si el rol no corresponde.

Cada plugin de negocio instala `security.authenticate` en `onRequest` dentro de su propio scope, seguido de un hook `onRequest` de rol. Así la autenticación precede validación de parámetros/finalidad y lectura del CSV. Health/readiness permanecen fuera de ese scope. ADMIN_TOKEN se reserva para auditoría; las consultas/lotes requieren una identidad consumidora para poder excluir una caja. No registrar token, header, cuerpo, documento completo o URL de una consulta en logs. El logger base omite los logs automáticos de petición, registra método/status/tiempo y redacta errores. Los módulos usan mensajes constantes y metadatos no personales; no deben adjuntar configuración ni payloads arbitrarios al logger.

## Auditoría y migraciones — tarea 04

```ts
interface AuditEntry {
  readonly timestamp: Timestamp;
  readonly requestingCaja: CajaId;
  readonly purpose: Purpose;
  readonly result: AffiliationResult;
  readonly documentMasked: string;
}
interface AuditRecord extends AuditEntry { readonly requestId: string }
interface AuditRepository {
  append(record: AuditRecord): Promise<void>;
  list(limit: number): Promise<readonly AuditEntry[]>;
}
```

Exports implementados: `src/audit/repository.ts` → `createAuditRepository: AuditRepositoryFactory` (`(pool: Pool) => AuditRepository`); `src/routes/audit.ts` → `createAuditRoutes: AuditRoutesFactory` (`{ repository, security }`). `list` devuelve primero los más recientes; su ruta devuelve un array con `auditResponseSchema`. Limite 1–1000, default 100. Enmascarar dejando como máximo cuatro dígitos visibles y ocultando al menos uno incluso para documentos de longitud <=4. `requestId` permanece interno, salvo que el contrato final justifique exponerlo. No persistir el documento completo en la tabla de auditoría.

La base crea `caja_link` y `public.caja_link_migrations`, sin inventar tablas de módulos futuros. 04 agrega `src/persistence/migrations/002_audit.sql`; 05 agrega `003_batch.sql`. No editar migraciones ya aplicadas: un SHA256 detecta cambios, con normalización CRLF→LF. El runner toma advisory lock en una conexión, ejecuta cada SQL y registro en una transacción, revierte al fallar y rechaza versiones faltantes o insertadas antes de versiones aplicadas. Los archivos usan prefijos únicos `NNN_nombre.sql`. `npm run build` copia los SQL a `dist/persistence/migrations`; Docker también los incluye. `main.ts` aplica migraciones antes de escuchar y falla si PostgreSQL/configuración/migraciones fallan. `npm run migrate` permite ejecutarlas explícitamente con el entorno cargado.

`createPostgresConnection` expone `.pool` para repositorios, `.ping(): Promise<boolean>` para readiness y `.close(): Promise<void>` para cierre. Usar consultas parametrizadas, esquema `caja_link` explícito, timestamps PostgreSQL `timestamptz` y transacciones para operaciones atómicas. Los errores de DB nunca se devuelven literalmente al cliente.

## Lotes — tarea 05

Interfaces reales exportadas en `src/domain/types.ts`:

```ts
interface BatchRepository {
  createOrGet(input: BatchSubmission): Promise<BatchAccepted>;
  find(jobId: string, identity: ConsumerIdentity): Promise<BatchJob | null>;
  claimPending(): Promise<BatchJob | null>;
  saveResults(jobId: string, results: readonly BatchRowResult[]): Promise<void>;
  complete(jobId: string): Promise<void>;
  readResults(jobId: string, identity: ConsumerIdentity, includePartial?: boolean): Promise<BatchResponse | null>;
  recoverInterrupted(): Promise<number>;
}
interface BatchService {
  submit(input: BatchSubmission): Promise<BatchAccepted>;
  get(jobId: string, identity: ConsumerIdentity): Promise<BatchResponse | null>;
  start(): Promise<void>;
  stop(): Promise<void>;
}
```

`BatchSubmission` tiene `identity`, `purpose`, `idempotencyKey`, `contentHash`, `documents: readonly NormalizedDocument[]` y `requestId`. `BatchAccepted` es `{ jobId: string }`, generado como UUID. `BatchJob` tiene `jobId`, `requestingCaja`, `purpose`, `status`, `createdAt`, `updatedAt`, `documents`. `BatchRowResult` añade `document` a `AffiliationResponseV1`. `BatchResponse` es `{ status: 'PENDING' | 'RUNNING' | 'DONE'; results: readonly BatchRowResult[] }`.

Exports implementados: `src/batch/repository.ts` → `createBatchRepository: BatchRepositoryFactory`; `src/batch/service.ts` → `createBatchService: BatchServiceFactory`; `src/routes/batch.ts` → `createBatchRoutes: BatchRoutesFactory`. Opciones de servicio `{ repository, affiliations, batch: AppConfig['batch'], query: AppConfig['query'] }`; opciones de rutas `{ service, security, batch }`. Instalar worker `service.start()` en `onReady` del plugin y `service.stop()` en `onClose`, antes de cerrar la conexión propia de la app. Recuperar PENDING/RUNNING de forma documentada y atómica; no completar ni perder un trabajo solo por reiniciar.

El POST admite `text/csv` y multipart campo `file`; finalidad opcional en query. Si falta, aplicar `DEFAULT_BATCH_PURPOSE`; si se declara inválida, devolver 400. Validar CSV, cada documento, número de filas, tamaño y clave antes de crear trabajo. `BODY_LIMIT_BYTES` default 2097152; `BATCH_MAX_DOCUMENTS` default 10000. `BATCH_CONCURRENCY=16` nunca supera `QUERY_CONCURRENCY`; reservar capacidad para consultas individuales. La identidad consumidora y clave forman una restricción única persistente; mismo hash devuelve mismo jobId, hash diferente lanza 409. El hash SHA256 incluye finalidad y secuencia normalizada de documentos, conservando orden y duplicados. Una ausencia/no pertenencia devuelve null y se expone como 404. Conservar una salida por fila, incluso documentos repetidos; toda consulta usa la lógica común y la finalidad elegida para auditoría.

Para mantener el corte consistente entre filas y tras recuperación, derivar `asOf` una vez desde `BatchJob.createdAt` con calendario `America/Bogota`. El timestamp de auditoría sigue siendo el instante UTC real de cada consulta. La fecha de archivo Centro se conserva siempre como fecha de publicación, sin sustituirla por la fecha del lote.

`readResults` incluye resultados parciales por defecto para recuperar un trabajo. El servicio público llama con `includePartial=false`: PENDING y RUNNING devuelven `results=[]`; DONE devuelve todas las filas ordenadas. PostgreSQL evita agregar el JSON parcial en cada polling, sin eliminarlo de la persistencia. Cada intento de consulta de una fila genera un UUID nuevo para que una reconsulta tras falla de guardado conserve su propia auditoría.

## Integración de plugins y dependencias

`AppModules` ya acepta `affiliations?: FastifyPluginAsync`, `audit?: FastifyPluginAsync` y `batch?: FastifyPluginAsync`. Los factories de rutas cierran sobre sus dependencias y retornan plugins sin prefijo adicional: usar `API_ROUTES` para no duplicar `/api/v1` ni convertir `:document` en `{document}` dentro de Fastify. El coordinador compone factories, crea repositorios desde el mismo pool, instala los tres plugins en `buildApp({ config, persistence, modules })` y conecta el cierre de adaptadores. `buildApp` cierra persistencia en su propio `onClose`.

Las dependencias están fijadas exactamente en package.json/lockfile: Fastify, pg, yaml, fast-xml-parser, csv-parse, `@fastify/multipart`, TypeScript y tipos de Node/pg. Los cambios de dependencias se coordinan con instalación reproducible, build/typecheck y pruebas afectadas. Multipart se instala dentro del plugin de lotes, con límite de bytes/archivos y parsing controlado; no se habilita globalmente para health/consultas.

`AppError(statusCode, code)` expone únicamente `{ error: code, requestId }`; no expone mensajes ni stack. Los códigos disponibles son `INVALID_REQUEST`, `UNAUTHORIZED`, `FORBIDDEN`, `NOT_FOUND`, `CONFLICT`, `UNAVAILABLE`, `INTERNAL_ERROR`. La base transforma validaciones Fastify a 400; `purposeQuerySchema` exige finalidad y `batchPurposeQuerySchema` permite omitirla. Las rutas importan también `affiliationParamsSchema`, `batchHeadersSchema`, `batchParamsSchema`, `batchAcceptedSchema`, `batchResponseSchema`, `auditQuerySchema`, `auditResponseSchema`, `errorResponseSchema`. Para POST CSV no aplicar un esquema JSON al cuerpo text/csv; validar su estructura con parser y AppError.

## Arranque y pruebas de esta fase

Crear `.env` desde `.env.example`. Los valores de ejemplo son válidos para arrancar con los datos sintéticos del kit; esta compatibilidad es necesaria para el arranque desde una copia limpia en el calificador. En esta sesión se generó `.env` local con valores aleatorios y se verificó su exclusión de Git. Las cajas simuladas consumen las mismas variables de credenciales; no editar sus implementaciones. En Linux con Docker disponible, ejecutar `docker compose config --quiet`, `docker compose up -d --build`, y comprobar `/health` y `/ready` en 8083. El perfil `caja-sur` y las tres cajas originales permanecen en Compose. PostgreSQL usa su volumen propio y ningún puerto publicado. El contenedor de aplicación monta solamente Centro y configuración.

Verificación local: `npm ci`, `npm run build`, `npm run typecheck`, `npm test`. JUnit: `npm run test:junit`, o pruebas del servicio levantado con `docker compose --profile test run --rm tests`. El último reporte queda en `test-results/junit.xml`, excluido de Git; es evidencia real que debe generarse también con el estado final. Los tests de integración se omiten localmente si faltan `TEST_SERVICE_URL`/`TEST_DATABASE=true`; Compose los habilita. `TEST_SERVICE_URL` y `TEST_DATABASE` son variables internas de tests, no credenciales ni configuración de la app.

06 entregó pruebas unitarias, integración con interfaces públicas y PostgreSQL, caos y referencia independiente de carga. El runner conserva informes anteriores con extensión `.previous` y genera un único `test-results/junit.xml`. 07 administra OpenAPI y documentos de entrega; los pendientes de implementación se retiran tras contrastar sus rutas. Las mediciones y el estado final se registran en `docs/load-test.md`, `docs/threat-model.md` y `COORDINACION.md`, sin sustituir ejecución por descripción.

El commit del kit conserva la identidad Git existente y la fecha real. Los commits hechos antes de las 10:00 del 14 de octubre no cuentan dentro de la ventana del evento; no se alteran fechas ni autorías. La identidad de Andres sigue pendiente de confirmación humana.

## Comprobaciones registradas de 01

El 14 de octubre se ejecutaron `npm ci`, build y typecheck con las versiones fijadas. Las 18 pruebas unitarias de base pasaron con cero fallidas. El runner JUnit registró 20 pruebas: 18 aprobadas y dos de integración omitidas porque no había servicio/PostgreSQL levantados; esas omisiones no cuentan como aprobaciones. `docker compose config --quiet` y la validación de Compose con perfiles `test` y `caja-sur` terminaron con código 0. La búsqueda en `src/` no encontró direcciones de cajas ni acceso a datos internos de mocks. `.env` está ignorado por Git.

El bloqueo inicial de Docker se resolvió preservando sus directorios temporales obsoletos. Se comprobó el arranque en contenedores, health/readiness, migraciones PostgreSQL y la suite integrada. Las comprobaciones históricas de base no sustituyen la evidencia final de negocio, carga y entrega, registrada en los documentos citados.
