# ADR 003: trabajos de lote persistentes e idempotencia por consumidor

Estado: aceptada e implementada; pruebas PostgreSQL, suite repetida y carga independiente aprobadas.

## Contexto

Procesar diez mil documentos puede exceder una conexión HTTP y repetirse por reintentos del consumidor. Debemos conservar estado, orden y resultados, evitar trabajos duplicados y medir el límite de trescientos segundos.

## Decisión

Aceptar CSV o multipart y devolver 202 con un UUID. Guardar trabajos y resultados en PostgreSQL. Definir unicidad por consumidor e Idempotency-Key, con hash de finalidad y documentos normalizados en orden. La clave con contenido diferente devuelve 409. El worker reutiliza el servicio común de consultas y mantiene un corte derivado de createdAt. El GET público devuelve results vacío en PENDING y RUNNING y resultados completos en DONE; las lecturas parciales quedan disponibles para recuperación interna.

## Alternativas

- Ejecutar todo el lote dentro del POST: mantiene la conexión abierta y dificulta consultar progreso o recuperarse.
- Guardar cola e idempotencia solamente en memoria: pierde estado tras reinicio y permite duplicados.
- Añadir un broker externo: agrega otro servicio y operación sin resolver por sí mismo la persistencia requerida.
- Reconstruir todos los resultados parciales en cada consulta de estado: la primera carga evidenció timeout PostgreSQL y GET 503; consultar solo estado hasta DONE reduce ese trabajo repetido.

## Consecuencias

La persistencia conserva una salida por fila, incluidos duplicados, y permite reanudar desde el avance confirmado. Las pruebas aprobaron idempotencia atómica, leases, orden, propiedad y recuperación con PostgreSQL real. La lectura pública evita reconstrucción acumulada antes de DONE; el consumidor obtiene progreso por estado, sin parciales. Con valores efectivos de dieciséis workers, sesenta y cuatro consultas y treinta y dos operaciones por origen, la repetición verificó 10000 filas sin errores en 62,658 segundos. Atendió 41 consultas individuales con máximo observado de 356,388 ms. El intento fallido se conserva por separado; la cifra aprobada corresponde a los tres orígenes y consumidor de docs/load-test.md.
