# ADR 002: indisponibilidad explícita y presupuesto total de consulta

Estado: aceptada; caos integrado de Norte y Oriente y suite posterior a la corrección aprobados. Los dos casos integrados de Sur siguen omitidos; existen pruebas propias originales y sintéticas separadas.

## Contexto

Una fuente que no responde impide demostrar ausencia de afiliación. Además, el contrato exige respuesta inferior a cinco segundos aunque un origen esté lento o auditoría demore.

## Decisión

Distinguir ausencia confirmada de indisponibilidad. Consultar orígenes en paralelo con deadline total, cancelación y semáforos. Sin coincidencias y con falla devolver INDETERMINADO; conservar unavailable incluso cuando existe una coincidencia.

## Alternativas

- Convertir timeout en lista vacía: produce falsos NO_AFILIADO y elimina información sobre fuentes fallidas.
- Reintentar secuencialmente sin presupuesto compartido: puede superar cinco segundos y acumular trabajo pendiente.
- Guardar ausencia en una caché persistente: puede ocultar la caída o recuperación de una caja.

## Consecuencias

La respuesta expresa incertidumbre y limita el tiempo de espera, incluyendo colas y auditoría. Si la persistencia indispensable falla o consume el presupuesto, la operación responde 503. Una dependencia no cancelable puede terminar más tarde; conserva su permiso hasta asentarse. El JUnit consultado aprueba deadline y caos integrado de Norte y Oriente; los dos casos de Sur están omitidos y no se consideran aprobados.
