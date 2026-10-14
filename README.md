# Caja Link — Josue Palomino y Andres Rodriguez

## Descripción

Caja Link permite a una caja de compensación consultar si una persona tiene afiliación vigente en otra caja antes de validar un beneficio. Integra REST, SOAP y archivos publicados, exige una finalidad y conserva trazabilidad con documento enmascarado. Una fuente indisponible se informa explícitamente para evitar decisiones basadas en una ausencia que no pudo comprobarse.

## Integrantes

- Josue Palomino — usuario de GitHub: `jodaripaa`.
- Andres Rodriguez — correo informado de su cuenta de GitHub: `art_fr_gallego@fesc.edu.co`. Su identidad para autoría de commits sigue pendiente de confirmación.

## Requisitos

Docker con motor Linux y Docker Compose v2; en Windows, Docker Desktop con su motor iniciado. La evaluación arranca en Linux. Las imágenes fijan Node.js `24.21.0` y PostgreSQL `17.6`; Node.js 24 y npm locales son opcionales para desarrollo. Los ejemplos emplean Bash, curl y jq. Deben estar disponibles el puerto 8083 y los puertos publicados de las cajas simuladas.

## Instalación y ejecución

Desde una copia limpia del repositorio, crear el entorno, revisar sus valores y levantar los contenedores. Los valores `cambiar-...` permiten ejecutar el kit sintético; las credenciales reales se guardan solamente en `.env`, excluido de Git.

```bash
cp .env.example .env
docker compose config --quiet
docker compose up -d --build
curl -fsS http://localhost:8083/health
curl -fsS http://localhost:8083/ready
```

`/health` comprueba el proceso. `/ready` comprueba PostgreSQL después de las migraciones aplicadas al arrancar; no certifica disponibilidad de las cajas ni aprobación del contrato de negocio.

Para habilitar Sur, establecer `CAJA_SUR_ENABLED=true` en `.env` y ejecutar:

```bash
docker compose --profile caja-sur up -d --build --force-recreate
```

El volumen de PostgreSQL conserva los datos al recrear contenedores. `reset.sh` pertenece al kit y borra el entorno: usarlo solamente cuando se quiera reiniciar sus datos.

La comprobación positiva opcional de Sur utiliza un fixture propio, totalmente sintético, que sustituye solo su configuración. Coordinarla fuera de pruebas de caos/carga. Ejecutar en Bash desde la raíz y esperar a que /ready devuelva 200:

```bash
docker compose -f docker-compose.yml -f tests/sur-fixture.compose.yml up -d --build --force-recreate caja-link sur-fixture
curl -fsS http://localhost:8083/ready
mkdir -p test-results
docker compose -f docker-compose.yml -f tests/sur-fixture.compose.yml --profile test run --rm --build tests node scripts/check-sur-fixture.mjs
docker compose up -d --force-recreate caja-link
docker compose -f docker-compose.yml -f tests/sur-fixture.compose.yml stop sur-fixture
docker compose -f docker-compose.yml -f tests/sur-fixture.compose.yml rm -f sur-fixture
curl -fsS http://localhost:8083/ready
```

El comando del checker fue comprobado dentro de Docker con salida 0 y cinco controles aprobados, sin Node.js local. Usa TEST_SERVICE_URL y las credenciales inyectadas por Compose; solo carga .env si existe un archivo local. Los dos archivos Compose mantienen la API configurada con el fixture. Escribe test-results/sur-fixture-check.json. La restauración vuelve al Compose y .env originales y retira el contenedor temporal.

## Configuración

Todas las variables de `.env.example` se describen aquí. Son ejemplos del kit, no secretos reales. `config/cajas.yaml` identifica cuatro orígenes y referencia variables; el código recibe direcciones y credenciales resueltas.

| Variable | Función | Ejemplo |
|---|---|---|
| `NORTE_TOKEN` | Identifica a Norte como consumidor de Caja Link. | `cambiar-norte` |
| `ORIENTE_TOKEN` | Identifica a Oriente como consumidor. | `cambiar-oriente` |
| `CENTRO_TOKEN` | Identifica a Centro como consumidor. | `cambiar-centro` |
| `SUR_TOKEN` | Identifica a Sur como consumidor, independientemente de su activación como origen. | `cambiar-sur` |
| `ADMIN_TOKEN` | Autoriza la lectura administrativa de auditoría; no representa una caja consultante. | `cambiar-admin` |
| `CAJA_NORTE_URL` | URL base REST de Norte dentro de Compose. | `http://caja-norte:9001` |
| `CAJA_NORTE_API_KEY` | Credencial del encabezado X-Api-Key enviado a Norte. | `cambiar-api-norte` |
| `CAJA_ORIENTE_URL` | Endpoint SOAP de Oriente. | `http://caja-oriente:9002/ws/AfiliacionService` |
| `CAJA_ORIENTE_USER` | Usuario del SOAP Header de Oriente. | `caja-link` |
| `CAJA_ORIENTE_PASSWORD` | Clave del SOAP Header de Oriente. | `cambiar-clave-oriente` |
| `CAJA_CENTRO_DIR` | Directorio publicado de Centro, montado de solo lectura. | `/data/caja-centro` |
| `CAJA_SUR_URL` | URL base de Sur; requerida al habilitarlo. | `http://caja-sur:9004` |
| `CAJA_SUR_TOKEN` | Bearer enviado al origen Sur; requerido al habilitarlo. | `cambiar-api-sur` |
| `CAJA_SUR_ENABLED` | Activa Sur con true; requiere recrear Caja Link y levantar su perfil. | `false` |
| `CAJA_NORTE_PORT` | Puerto publicado de Norte en el host. | `9001` |
| `CAJA_ORIENTE_PORT` | Puerto publicado de Oriente en el host. | `9002` |
| `CAJA_SUR_PORT` | Puerto publicado de Sur en el host. | `9004` |
| `PGHOST` | Host de la base propia; Compose lo fija a postgres. | `postgres` |
| `PGPORT` | Puerto interno PostgreSQL; Compose lo fija a 5432. | `5432` |
| `PGDATABASE` | Base creada por PostgreSQL y utilizada por la aplicación. | `caja_link` |
| `PGUSER` | Usuario PostgreSQL de la aplicación. | `caja_link` |
| `PGPASSWORD` | Contraseña de la base propia. | `cambiar-postgres` |
| `PGPOOL_MAX` | Máximo de conexiones del pool, entre 1 y 100. | `10` |
| `PGCONNECT_TIMEOUT_MS` | Tiempo máximo para conectar, entre 100 y 10000 ms. | `1000` |
| `PGQUERY_TIMEOUT_MS` | Timeout de consultas SQL, entre 100 y 10000 ms. | `1500` |
| `HOST` | Interfaz de escucha; Compose la fija a 0.0.0.0. | `0.0.0.0` |
| `PORT` | Puerto API; Compose conserva el puerto obligatorio 8083. | `8083` |
| `CAJAS_CONFIG_PATH` | Ruta del YAML de orígenes; Compose la fija al archivo montado. | `/app/config/cajas.yaml` |
| `LOG_LEVEL` | Nivel: fatal, error, warn, info, debug, trace o silent. | `info` |
| `BODY_LIMIT_BYTES` | Límite del cuerpo HTTP, entre 1024 y 16777216 bytes. | `2097152` |
| `QUERY_TOTAL_TIMEOUT_MS` | Presupuesto total con colas y auditoría, entre 100 y 4900 ms. | `4500` |
| `ORIGIN_TIMEOUT_MS` | Presupuesto de orígenes, entre 50 ms y el presupuesto total. | `3500` |
| `QUERY_CONCURRENCY` | Máximo de consultas concurrentes, entre 1 y 1024. | `64` |
| `ORIGIN_CONCURRENCY` | Máximo de trabajos concurrentes por origen, entre 1 y 1024. | `32` |
| `BATCH_CONCURRENCY` | Concurrencia del worker, sin superar QUERY_CONCURRENCY. | `16` |
| `BATCH_MAX_DOCUMENTS` | Máximo de documentos del lote, entre 10000 y 100000. | `10000` |

Los cinco tokens de identidad deben ser distintos y las credenciales requeridas no pueden estar vacías. Fuera de Compose, ajustar las rutas de Centro/configuración y el acceso PostgreSQL. `TEST_SERVICE_URL` y `TEST_DATABASE` son variables internas del servicio tests, definidas por Compose.

## Arquitectura

El servicio `caja-link` ejecuta Fastify y el dominio de consultas en TypeScript estricto. Sus adaptadores consultan `caja-norte` por REST, `caja-oriente` por SOAP y `caja-sur` por REST cuando está habilitado. Centro aporta un archivo publicado, sin servicio propio. `postgres` persiste auditoría, trabajos, resultados e idempotencia de lotes. El servicio `tests`, bajo el perfil test, prueba API y PostgreSQL y produce JUnit; monta Centro de solo lectura para su referencia independiente. La aplicación monta solamente Centro y configuración; los montajes internos de mocks pertenecen a los simuladores del kit.

La consulta excluye al consumidor, normaliza documentos y aplica vigencia con fecha de Colombia. v1 y v2 comparten lógica; v2 añade el tipo de afiliado. Ver [arquitectura](docs/architecture.md) y [ADR](docs/adr/).

## Uso

Los ejemplos usan variables del .env local y documentos del kit sintético. Una caja usa su token de consumidor; el administrador usa ADMIN_TOKEN para auditoría. Cargar el entorno en Bash local sin publicar sus valores:

```bash
set -a
. ./.env
set +a
```

| Método y ruta | Entrada y salida |
|---|---|
| GET `/api/v1/affiliations/{document}` | purpose obligatorio; requestId, result, matches y unavailable. |
| GET `/api/v2/affiliations/{document}` | Igual que v1; cada coincidencia incluye affiliateType. |
| POST `/api/v1/batch-checks` | CSV UTF-8 con columna document, text/csv o multipart file, e Idempotency-Key; 202 con jobId. |
| GET `/api/v1/batch-checks/{jobId}` | Solo su dueño; PENDING/RUNNING con results vacío; DONE con todos los resultados v1 por fila. |
| GET `/api/v1/audit` | Solo administrador; limit entre 1 y 1000, por defecto 100; array de entradas enmascaradas. |

```bash
curl -fsS -H "Authorization: Bearer ${NORTE_TOKEN}" \
  'http://localhost:8083/api/v1/affiliations/1098765432?purpose=VALIDACION_AFILIACION'
curl -fsS -H "Authorization: Bearer ${NORTE_TOKEN}" \
  'http://localhost:8083/api/v2/affiliations/001.098.765.432?purpose=TARIFA_SUBSIDIADA'
JOB_ID=$(curl -fsS -X POST -H "Authorization: Bearer ${NORTE_TOKEN}" \
  -H 'Idempotency-Key: demostracion-lote-001' -H 'Content-Type: text/csv' \
  --data-binary @data/lote_10000.csv \
  'http://localhost:8083/api/v1/batch-checks?purpose=VALIDACION_AFILIACION' | jq -r .jobId)
curl -fsS -H "Authorization: Bearer ${NORTE_TOKEN}" \
  "http://localhost:8083/api/v1/batch-checks/${JOB_ID}"
curl -fsS -H "Authorization: Bearer ${ADMIN_TOKEN}" \
  'http://localhost:8083/api/v1/audit?limit=100'
```

Alternativa multipart:

```bash
curl -fsS -X POST -H "Authorization: Bearer ${NORTE_TOKEN}" \
  -H 'Idempotency-Key: demostracion-multipart-001' \
  -F 'file=@data/lote_10000.csv;type=text/csv' \
  'http://localhost:8083/api/v1/batch-checks'
```

Finalidades: `TARIFA_SUBSIDIADA`, `SUBSIDIO_MONETARIO`, `VALIDACION_AFILIACION`. En lotes, omitir purpose aplica la última; una finalidad explícita inválida devuelve 400. La clave pertenece al consumidor: mismo contenido normalizado y finalidad devuelven el mismo trabajo; una reutilización diferente devuelve 409.

La consulta de estado devuelve `results: []` mientras el trabajo está `PENDING` o `RUNNING`. Al llegar a `DONE`, devuelve todas las filas en su orden original, incluidos duplicados. Los resultados parciales persistidos se usan internamente para recuperar el worker; no se reconstruyen en cada GET público durante el procesamiento.

`AFILIADO_OTRA_CAJA` puede coexistir con cajas en unavailable. `NO_AFILIADO` requiere ausencia confirmada en todos los orígenes necesarios. Sin coincidencias y con alguna fuente indisponible se devuelve `INDETERMINADO`. Centro conserva source FILE y FECHA_CORTE como asOf; ONLINE informa el corte de consulta. v1 no incluye affiliateType.

Los errores contienen únicamente error y requestId: 400 entrada inválida, 401 token ausente/inválido, 403 rol no permitido, 404 lote inexistente/no visible, 409 conflicto, 413 límite de carga, 415 formato no admitido, 503 dependencia propia indispensable y 500 error interno. Ver [OpenAPI](openapi.yaml). Las cinco operaciones están conectadas en main; las pruebas incluyen lotes y PostgreSQL real. La carga repetida aprobó después de corregir la lectura del estado.

## Pruebas

Las pruebas usan node:test, fixtures propios, Fastify inyectado e integración contra el servicio en funcionamiento. Compose habilita pruebas HTTP y PostgreSQL y deja JUnit XML en test-results/.

```bash
docker compose --profile test run --rm tests
docker compose --profile test run --rm -e TEST_ENABLE_CHAOS=true tests
./validator check
./validator check --lote
./validator entregables --desde 2026-10-14T10:00:00-05:00
```

Desarrollo con Node.js 24: `npm ci`, `npm run build`, `npm run typecheck`, `npm test` y `npm run test:junit`. Las integraciones locales requieren TEST_SERVICE_URL y TEST_DATABASE=true; una omisión no cuenta como aprobación. Restaurar /__chaos a ok después de caída/lentitud y coordinar esas pruebas con el equipo.

En esta sesión Windows, la revisión de entregables se ejecutó con salida UTF-8 para permitir los símbolos del reporte, sin modificar el verificador:

```powershell
$env:PYTHONIOENCODING = 'utf-8'
python -B validator entregables --desde 2026-10-14T10:00:00-05:00
```

La revisión documental comprobó once secciones exactas, 36 variables, seis servicios, cuatro ADR y enlaces locales existentes. La suite incluye pruebas de contrato y referencias OpenAPI resolubles. La carga está medida y documentada; falta completar el historial real de ambos integrantes. PE10 se comprueba en la plataforma.

El JUnit único generado en `test-results/junit.xml`, repetido después de la corrección de lotes, contiene 165 casos aprobados, cero fallidos y dos omitidos de Sur. El [resumen conservado](docs/evidence/tests-summary.json) registra los conteos y los cinco nombres de mitigación aprobados. El resumen node:test muestra 169 aprobaciones; para PE03 se cuentan los elementos testcase del XML. El [validador público con lote](docs/evidence/validator-check.txt) aprobó P01–P13, 13/14 controles y 460/500 puntos; P14 N/E, exclusivo del oficial. P10 informó DONE en 55 segundos con 10000 resultados y P13 revisó 100 entradas completas y enmascaradas. Ese validador no contrasta exactitud del lote; la referencia independiente sí.

La [medición independiente aprobada](docs/evidence/load-test.json) terminó DONE en **62,658 segundos**, con **10000 filas recibidas y verificadas y cero errores**. Durante el lote se atendieron 41 consultas individuales, con máximo observado de 356,388 ms. El CSV tenía 10000 documentos únicos; orden y campos completos se verificaron por fila. Duplicados e idempotencia están cubiertos por pruebas específicas. Preparación de referencia (36,681 s) y comparación posterior (0,312 s) se midieron aparte. La primera carga fallida y su corrección se conservan en [load-test.md](docs/load-test.md).

Sur tiene [cinco comprobaciones con el origen original](docs/evidence/sur-check.json) y [cinco positivas con un fixture completamente sintético](docs/evidence/sur-fixture-check.json). El segundo comprobó coincidencia completa, DTO v1 mínimo, tipo v2 INDEPENDIENTE, normalización y exclusión del consumidor Sur. La repetición dentro de Docker aprobó los mismos cinco controles con salida 0, sin Node.js local. Cambió solo configuración, sin leer datos internos. Esta evidencia propia complementa los dos casos omitidos del JUnit; **P14 oficial no se ha ejecutado**.

El [arranque limpio](docs/evidence/clean-start.json) se comprobó sobre la exportación funcional 71394a6, con .env.example sin cambios y PostgreSQL nuevo en otro proyecto Compose. El primer build falló por timeout TLS de Docker Hub; el segundo construyó las tres imágenes y arrancó correctamente. En esa copia, [validator check --lote](docs/evidence/clean-validator.txt) terminó con salida 0 y P01–P13 PASS (460/500); su lote llegó a DONE en 134 segundos con 10000 filas. Es otra ejecución del validador público, sin la comparación independiente de exactitud de 62,658 segundos.

## Documentación

- [Arquitectura](docs/architecture.md).
- [Decisiones de arquitectura](docs/adr/).
- [Modelo de amenazas y pruebas](docs/threat-model.md).
- [Prueba de carga y evidencia](docs/load-test.md).
- [Contrato OpenAPI](openapi.yaml).
- [Configuración de cajas](config/cajas.yaml).
- [Uso de inteligencia artificial](AI_USAGE.md).
- [Guion de pitch y checklist](docs/pitch.md).
- [Evidencias conservadas: carga, Sur, pruebas y arranque limpio](docs/evidence/).
- [Contrato compartido de implementación](docs/implementation-contract.md).

## Qué resolvimos

Se implementaron adaptadores REST, SOAP y archivo, consultas versionadas, seguridad, auditoría y lotes persistentes con idempotencia. Las consultas excluyen al consumidor, conservan el corte de Centro y evitan un falso NO_AFILIADO ante indisponibilidad. Las pruebas demostraron finalidad, dato mínimo, permisos, cancelación y persistencia PostgreSQL. La primera carga detectó costo excesivo al reconstruir resultados parciales en cada GET; se separó la lectura pública de la recuperación interna. La suite repetida aprobó y el lote verificó 10000 filas sin errores en 62,658 segundos.

## Limitaciones y pendientes

P14 oficial no se ha ejecutado. La carga independiente mantuvo Sur deshabilitada y sus dos casos integrados del JUnit están omitidos; sus pruebas propias originales y sintéticas están descritas arriba. Centro tiene la antigüedad de su publicación. El HTTP interno del kit no incorpora TLS ni rotación de credenciales para producción. Ambos integrantes deben revisar y poder explicar el código. El [repositorio de entrega](https://github.com/jodaripaa/hackaton-fesc) ya es público con autorización del usuario; se comprobaron la lectura Git sin credenciales y la descarga del ZIP con HTTP 200. El mínimo total de commits del evento se cumple con contribuciones de Josue. El usuario indicó que Andres hará rework real desde su cuenta; siguen pendientes sus tres commits personales, la confirmación de autoría y su revisión. Repositorio y video deben registrarse antes del 15 de octubre de 2026 a las 15:00, America/Bogota; pitch/Drive, registro y revisión humana siguen pendientes.
