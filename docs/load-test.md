# Prueba de carga del lote

herramienta: Node.js 24 fetch + referencia independiente de interfaces públicas
documentos: 10000
duracion_segundos: 62.657976766
errores: 0

## Medición aprobada

Evidencia conservada: [load-test.json](evidence/load-test.json). El trabajo llegó a DONE con 10000 filas recibidas y verificadas, cero filas erróneas y cero errores HTTP. El reporte registra aprobada=true. Se comprobó el resultado completo, no solamente el 202 inicial o el estado del trabajo.

| Dato | Valor observado |
|---|---|
| Runtime | Node.js v24.21.0 |
| Versión funcional indicada por el coordinador | 40ee113 |
| Consumidor | CENTRO |
| Orígenes habilitados | NORTE, ORIENTE, CENTRO; Sur deshabilitada |
| Estado de orígenes comunicado por el coordinador | ok |
| Corte de consulta | 2026-10-14, America/Bogota |
| Fecha publicada de Centro | 2026-10-03 |
| Documentos / documentos únicos | 10000 / 10000 |
| Filas recibidas / verificadas / erróneas | 10000 / 10000 / 0 |
| Consultas individuales durante el lote | 41 |
| Máximo de latencia individual observado | 356.387593 ms |
| Preparación de referencia independiente | 36.680937544 s |
| Verificación posterior de resultados | 0.312125244 s |
| Inicio UTC | 2026-10-14T16:28:58.867Z |
| Fin UTC | 2026-10-14T16:30:01.517Z |
| Horario de Colombia | 14 de octubre, 11:28:58.867 a 11:30:01.517 |
| Job | 2812c765-4b30-4254-bad8-15a497eb52fe |

La configuración efectiva comunicada fue QUERY_CONCURRENCY=64, ORIGIN_CONCURRENCY=32, BATCH_CONCURRENCY=16, PGPOOL_MAX=10, ORIGIN_TIMEOUT_MS=3500 y QUERY_TOTAL_TIMEOUT_MS=4500. No se copiaron credenciales de .env al documento.

El cronómetro monotónico empieza inmediatamente antes del POST y termina cuando se lee el cuerpo DONE completo. Los 62.657976766 segundos incluyen aceptación, procesamiento y seguimiento HTTP; preparación y comparación posterior se miden separadamente. Los timestamps de pared no sustituyen ese cronómetro.

En otra ejecución, el [validador público con lote](evidence/validator-check.txt) aprobó P01–P13 (460/500; P14 N/E). P10 informó DONE en 55 segundos con 10000 resultados y P13 revisó 100 entradas completas y enmascaradas. No compara exactitud del lote; la comparación independiente documentada aquí corresponde a 62.657976766 segundos.

Además, el [arranque limpio](evidence/clean-start.json) exportó la revisión 71394a6, copió .env.example sin cambios y creó PostgreSQL nuevo en otro proyecto Compose. El primer build falló por timeout TLS de Docker Hub; el segundo construyó tres imágenes y arrancó. En esa copia, [validator check --lote](evidence/clean-validator.txt) salió 0 y aprobó P01–P13, con P10 DONE en 134 segundos y 10000 resultados. Ese resultado es de otro escenario y no reemplaza la comparación de exactitud de la medición independiente.

## Exactitud, orden y duplicados

La herramienta scripts/load-test.mjs prepara una referencia independiente mediante REST, SOAP y el archivo publicado de Centro. No lee mocks/data ni reutiliza los adaptadores del servicio. La referencia normaliza documentos, aplica vigencia por fecha y excluye al consumidor.

Compara las 10000 filas, por índice, con el documento esperado y la referencia v1: result, matches completos (caja, validFrom, validTo, source, asOf), unavailable y campos permitidos. Exige un requestId no vacío, el documento correcto en cada posición, cantidad exacta de filas y ausencia recursiva de campos personales. Los matches se comparan canónicamente, sin exigir un orden arbitrario entre coincidencias; el orden de las filas del lote sí se verifica. Las 41 consultas individuales también se compararon con la referencia y no excedieron cinco segundos.

El CSV medido contiene 10000 documentos únicos, por lo que esta ejecución no incluye documentos repetidos. La conservación de duplicados se demuestra separadamente mediante integracion_lote_orden_duplicados_y_resultados_exactos, lote_worker_conserva_orden_duplicados_corte_y_auditoria_por_fila y lote_postgres_idempotencia_atomica_leases_orden_propiedad_y_recuperacion, aprobadas en el JUnit único. La idempotencia simultánea, el 409 por contenido diferente y el aislamiento se comprueban en integracion_idempotencia_simultanea_conflicto_y_aislamiento_por_caja.

## Reproducción

Con el servicio levantado, Centro disponible, orígenes en ok y pruebas de caos ya terminadas, ejecutar desde la raíz del repositorio:

```bash
docker compose --profile test run --rm tests node scripts/load-test.mjs --consumer CENTRO --reference-concurrency 16
```

El contenedor tests recibe TEST_SERVICE_URL, las credenciales desde el entorno y el archivo publicado de Centro. Node.js ejecuta dentro del contenedor la referencia TypeScript independiente. El reporte se guarda en el montaje test-results/load-test.json. Para repetir exactamente esta condición, mantener Sur deshabilitada y los límites efectivos indicados; una condición distinta constituye otra medición.

Archivo usado: data/lote_10000.csv. SHA-256 observado: 8dcc0e0c0d61f2712d6c7d1fd714c1ead57db0d3638c9f1362629688082b82dd. El script termina con error si no recibe y verifica todas las filas, detecta errores o supera el límite de 300 segundos.

## Primer intento fallido conservado

Evidencia conservada: [primer intento fallido](evidence/load-test.failed-2026-10-14T16-18-51.json). Se usó la misma herramienta y el CSV de 10000 documentos únicos; consumidor CENTRO, NORTE/ORIENTE/CENTRO habilitadas y corte 2026-10-14. Inicio UTC: 2026-10-14T16:17:22.412Z; interrupción UTC: 2026-10-14T16:18:51.412Z.

El seguimiento se interrumpió a los 89.011140079 segundos por GET 503 asociado al timeout PostgreSQL. El reporte terminó en RUNNING, con un error HTTP, cero filas recibidas y cero verificadas, y aprobada=false. Se atendieron 34 consultas individuales y el máximo registrado fue 408.667154 ms. Son datos del intento fallido; ese tiempo no demuestra finalización del lote dentro del límite.

El coordinador comprobó después DONE con 10000 filas, pero ese seguimiento no aportaba duración y exactitud completas. Corrigió readResults(jobId, identity, includePartial=true): el worker puede recuperar parciales y service.get usa false, devolviendo results vacío en PENDING/RUNNING. DONE entrega todas las filas. La repetición aprobada de 62.657976766 segundos se realizó después de esa corrección y conservó el intento fallido.

## Límites de la evidencia

La medición corresponde a un consumidor, los tres orígenes indicados y el entorno local Docker. Demuestra el requisito bajo esas condiciones y coexistencia de consultas individuales; no representa carga sostenida de producción ni rendimiento con Sur o fuentes caídas. Sur tiene comprobaciones separadas. El [resumen de pruebas](evidence/tests-summary.json) conserva 165 casos aprobados, cero fallidos y dos omitidos; no se mezclan sus resultados con tiempos de carga. Los archivos de evidence se conservan junto a la documentación; test-results contiene los reportes regenerados.
