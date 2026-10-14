# Uso de inteligencia artificial

Los registros describen trabajo observado o comunicado por el coordinador durante esta sesión. Las comprobaciones automáticas realizadas por agentes se distinguen de la revisión humana del equipo, todavía pendiente. No se atribuye a un integrante una corrección ni un commit sin confirmación.

## Uso 1

- Herramienta: Codex.
- Para qué se usó: planificar la implementación y dividir responsabilidades del proyecto Caja Link.
- Prompt principal (resumido): preparar el servicio Profesional, sus dependencias y entregables de la hackatón.
- Qué produjo: una propuesta inicial de tecnología que consideraba Python y un plan de componentes y tareas.
- Qué modificó o corrigió el equipo: El usuario corrigió la propuesta de Python y aprobó Node.js con TypeScript, Fastify y PostgreSQL; esa decisión sustituyó el stack inicial en el plan y la base compartida.

## Uso 2

- Herramienta: Codex.
- Para qué se usó: implementar la base, tipos compartidos, configuración y persistencia inicial.
- Prompt principal (resumido): crear una base compilable con Node.js 24, TypeScript estricto, Fastify, PostgreSQL, Docker Compose y node:test con reporte JUnit.
- Qué produjo: estructura ESM, configuración validada, contratos de módulos, migraciones, arranque y pruebas de infraestructura.
- Qué modificó o corrigió el equipo: Durante la sesión, el agente corrigió la integración de Fastify LogController, los tipos estrictos y el manejo de migraciones; la base quedó comprobada en un reporte Docker de veinte pruebas aprobadas. La revisión humana de estas correcciones continúa pendiente.

## Uso 3

- Herramienta: Codex.
- Para qué se usó: preparar controles de privacidad y configuración de los orígenes.
- Prompt principal (resumido): impedir documentos y credenciales en logs y errores; obtener direcciones desde configuración y entorno; conservar solamente datos del contrato.
- Qué produjo: serializadores y redacción de logs, errores con códigos fijos, esquemas de salida permitidos y cuatro cajas configuradas con referencias a variables.
- Qué modificó o corrigió el equipo: Durante la sesión, el agente eliminó URL, encabezados y payloads de los logs, ocultó mensajes internos de errores y resolvió los orígenes desde configuración. Las pruebas base_logs_no_registran_documento_tokens_url_ni_payload y config_no_filtra_urls_ni_credenciales_en_errores aparecen aprobadas en el reporte de base; falta la revisión humana final.

## Verificación y revisión pendiente

La documentación contrastó estos mecanismos con src/app.ts, src/config/index.ts, los esquemas y el JUnit generado en test-results/junit.xml. El [resumen conservado](docs/evidence/tests-summary.json) registra 165 casos aprobados, cero fallidos y dos omitidos de Sur, incluidos los cinco nombres de seguridad. El [primer intento fallido](docs/evidence/load-test.failed-2026-10-14T16-18-51.json) se interrumpió por GET 503. Después de separar la lectura pública y los parciales del worker, la [repetición](docs/evidence/load-test.json) verificó 10000 filas sin errores en 62,658 segundos. El [arranque limpio](docs/evidence/clean-start.json) aprobó con .env.example sin cambios tras repetir un build por timeout TLS del registro. Josue y Andres deben ejecutar, explicar y revisar los módulos antes de entregar; no se declara que esa revisión humana ya ocurrió.
