# Plan de implementación de Caja Link

Caja Link consultará afiliaciones entre cajas de compensación mediante REST, SOAP y archivos publicados, con autenticación, finalidad, auditoría, tolerancia a fallas y procesamiento por lotes. El objetivo es completar el contrato Profesional y los entregables de la rúbrica antes del 15 de octubre de 2026 a las 15:00, hora de Colombia (America/Bogota, UTC−05:00).

La ventana oficial del evento comienza el 14 de octubre de 2026 a las 10:00 y termina el 15 de octubre de 2026 a las 15:00, hora de Colombia. Su duración total es de 29 horas; el historial Git se revisará dentro de esa ventana.

Integrantes informados: Josue Palomino y Andres Rodriguez. El plan está aprobado por el equipo. La tecnología acordada es Node.js con TypeScript, Fastify y PostgreSQL. La implementación comienza por la tarea 01; las demás tareas se activarán conforme a sus dependencias.

Identidades informadas para organizar el trabajo: el usuario de GitHub de Josue es `jodaripaa`; el correo asociado a la cuenta de GitHub de Andres es `art_fr_gallego@fesc.edu.co`. Los correos que figurarán en los commits se definirán al preparar Git en la tarea 01.

## Estado inicial

- El kit contiene las cajas simuladas, las especificaciones, el CSV de 10.000 documentos y los validadores públicos.
- Faltan el servicio propio, las pruebas, la configuración de cajas y el contrato OpenAPI. El README y los documentos de entrega todavía contienen plantillas.
- Docker y Docker Compose están instalados. El motor de Docker no está corriendo; debe estar disponible para la primera verificación del entorno.
- El remoto configurado es `https://github.com/jodaripaa/hackaton-fesc.git`. Falta verificar su acceso público y su registro en la plataforma.
- Git solo registra `.gitattributes`; los archivos del kit aparecen sin seguimiento. La primera tarea preservará esta base con un commit descriptivo.
- La fecha y hora de inicio oficial está confirmada: 14 de octubre de 2026 a las 10:00, hora de Colombia. En la tarea 01 se definirán los correos de los commits de ambos integrantes. Los nombres para la entrega son Josue Palomino y Andres Rodriguez.

## Arquitectura propuesta

La propuesta es un hub central con adaptadores por protocolo. Una aplicación Fastify recibirá las solicitudes en el puerto 8083. La lógica de consulta trabajará con un modelo común de afiliación; los adaptadores transformarán los formatos externos y eliminarán los datos personales que no formen parte del contrato.

| Componente | Propuesta | Propósito |
|---|---|---|
| Runtime | Node.js 24 LTS y TypeScript con comprobaciones estrictas | Ejecutar el mismo código en desarrollo y Docker |
| API | Fastify con esquemas de entrada y salida | Mantener tipos, validación y respuestas controladas |
| HTTP | `fetch`, cancelación y concurrencia limitada | Consultar cajas simultáneamente con límites de tiempo |
| SOAP | Constructor XML y parser con entidades externas deshabilitadas | Integrar Oriente y tratar los SOAP Fault como fallas |
| Configuración | YAML con referencias a variables de entorno | Declarar las cuatro cajas sin direcciones en `src/` |
| Persistencia | PostgreSQL y `pg`, en un servicio propio de Compose | Persistir auditoría, trabajos, resultados e idempotencia |
| Pruebas | `node:test`, aserciones y reporte JUnit | Probar el servicio levantado y demostrar las mitigaciones |
| Despliegue | Docker Compose y compilación de TypeScript en contenedores | Arrancar desde cero en el servidor Linux del evento |

PostgreSQL será una base propia del equipo. El servicio accederá a Norte, Oriente y Sur exclusivamente mediante sus APIs, y a Centro mediante el archivo publicado. El contenedor de Caja Link no montará `mocks/` ni accederá a `mocks/data`.

Node.js 24 aparece como LTS en la [tabla oficial de versiones](https://nodejs.org/en/about/previous-releases). Fastify documenta su [integración con TypeScript](https://fastify.dev/docs/latest/Reference/TypeScript/). El runner de Node incluye un [reporter JUnit](https://nodejs.org/docs/latest-v24.x/api/test.html#test-reporters). Las versiones exactas de imágenes y paquetes se fijarán en la tarea de base, junto con el lockfile.

## Organización de los chats

Este chat será el punto de coordinación, revisión de decisiones e integración final. Cada chat de trabajo recibirá el alcance, los requisitos que cubre, los archivos que puede modificar, las interfaces compartidas y las comprobaciones que debe superar.

Los chats usarán el proyecto existente. Para evitar interferencias, primero se completará la base compartida. Después se podrán trabajar módulos con archivos distintos. Los cambios en `package.json`, el lockfile, `docker-compose.yml`, `.env.example`, `src/app.ts`, `src/main.ts` y los tipos comunes se coordinarán desde el chat principal después de la tarea 01.

Al terminar una tarea, su chat entregará los archivos modificados, las comprobaciones ejecutadas, los resultados y cualquier dependencia pendiente. Cada integrante deberá entender, ejecutar y revisar sus cambios antes de registrarlos con su propia identidad Git.

| Chat previsto | Alcance | Requisitos principales | Depende de |
|---|---|---|---|
| Caja Link 01 Base y contrato | Entorno, estructura, configuración, tipos y persistencia común | Arranque desde cero; base de PE05 y PE06 | Revisión del plan |
| Caja Link 02 Adaptadores de cajas | REST Norte, SOAP Oriente, archivo Centro y REST Sur | P04, P09, P14; PE05 | 01 |
| Caja Link 03 Consultas y fallas | Reglas de afiliación, consultas v1/v2 y tolerancia a fallas | P02–P08, P12 | 01; 02 para integración |
| Caja Link 04 Seguridad y auditoría | Tokens, permisos, finalidad, dato mínimo y auditoría | P01, P02, P06, P13; PE02 | 01; 03 para integración |
| Caja Link 05 Lotes e idempotencia | CSV, trabajos persistentes, ejecución y consulta del lote | P10, P11 | 01; 02–04 para integración |
| Caja Link 06 Pruebas y rendimiento | Pruebas del servicio, JUnit, caos y carga | P01–P14; PE02, PE03, PE04 | Plan desde 01; ejecución después de integrar 02–05 |
| Caja Link 07 Documentación y entrega | README, OpenAPI, arquitectura, ADR, IA y pitch | PE01, PE02, PE06–PE11 | Borradores desde 01; cierre con resultados de 06 |

La elección del contexto de cada chat seguirá las [indicaciones oficiales de Codex sobre chats y entornos de trabajo](https://developers.openai.com/blog/mastering-codex-remote-for-engineering). La creación de los siete chats y el inicio de la tarea 01 están autorizados. Los chats 02 a 07 prepararán su alcance y esperarán su activación para modificar el proyecto.

## Tarea 01 Base y contrato

**Resultado:** estructura compilable y entorno que permita integrar módulos sin cambiar sus interfaces a mitad del trabajo.

1. Revisar el estado de Git y preservar el kit original con un commit descriptivo del integrante que lo revise.
2. Comprobar Docker Desktop, el motor Linux y la disponibilidad de los puertos 8083, 9001, 9002 y 9004.
3. Crear `package.json`, el lockfile, la configuración TypeScript, scripts de compilación y la estructura de `src/` y `tests/`.
4. Definir los tipos de documento normalizado, identidad de caja, finalidad, afiliación, resultado de adaptador, auditoría y trabajo de lote.
5. Crear `config/cajas.yaml` con Norte, Oriente, Centro y Sur. Las URLs, credenciales y directorios se resolverán desde el entorno; Sur dependerá de `CAJA_SUR_ENABLED`.
6. Preparar el cliente PostgreSQL, las migraciones y el mecanismo común para guardar auditoría y trabajos.
7. Añadir a Compose `caja-link`, la base propia y `tests` con `profiles: ["test"]`. Mantener los servicios simulados y el perfil `caja-sur` del kit.
8. Preparar healthchecks, montajes permitidos, cierre de conexiones y logs que oculten tokens y documentos.
9. Definir el tratamiento de fechas, archivo de Centro ausente o ilegible, entradas inválidas y finalidad de lotes antes de integrar módulos.

**Archivos:** archivos de configuración del proyecto, `src/Dockerfile`, `src/main.ts`, `src/app.ts`, `src/config/`, `src/domain/types.ts`, `src/persistence/connection.ts`, el runner de migraciones, `config/`, `docker-compose.yml`, `.env.example` y `.gitignore`.

**Criterio de cierre:** compilación sin errores; configuración validada al arrancar; Docker Compose sin opciones prohibidas; servicio disponible en 8083; tipos y responsabilidades compartidos definidos. La verificación completa desde cero se repetirá al integrar todos los módulos.

## Tarea 02 Adaptadores de cajas

**Resultado:** cuatro adaptadores que devuelvan exclusivamente afiliaciones normalizadas o una falla explícita.

1. Norte: petición REST con API key; interpretar 404 como ausencia confirmada, y errores, timeout o respuestas inválidas como indisponibilidad.
2. Oriente: rellenar el documento a 12 dígitos; generar el SOAP Header con credenciales; procesar namespaces, `Encontrado`, fechas y tipos D/I/P; detectar SOAP Fault.
3. Centro: elegir el archivo más reciente; leer `FECHA_CORTE`; construir un índice de documentos; convertir fechas y tipos DEP/IND/PEN; conservar `source: FILE` y `asOf` del archivo.
4. Sur: petición REST con bearer; convertir categorías al contrato v2; respetar su activación por configuración.
5. Aplicar el modelo común y descartar nombres, dirección, teléfono, correo, salario y beneficiarios durante la transformación.
6. Distinguir una respuesta vacía válida de un origen que no pudo consultarse. Tratar archivos corruptos o formatos inesperados sin afirmar ausencia.

**Archivos:** `src/adapters/` y fixtures propios en `tests/fixtures/adapters/`, coordinados con el chat de pruebas.

**Criterio de cierre:** los cuatro protocolos funcionan mediante sus interfaces; documentos equivalentes dan el mismo resultado; Centro conserva la fecha de corte; Sur se activa sin modificar código; las pruebas de transformación y error pasan.

## Tarea 03 Consultas y fallas

**Resultado:** consultas v1/v2 correctas, con el mismo comportamiento de negocio y respuestas dentro del límite de tiempo.

1. Normalizar puntos, espacios y ceros de relleno. Rechazar documentos vacíos o con caracteres no admitidos.
2. Identificar y excluir la caja consumidora antes de consultar los orígenes.
3. Definir una fecha de consulta consistente y aplicar la vigencia indicada por el contrato, incluyendo el límite inclusivo de `validTo` y el tratamiento de fechas futuras.
4. Consultar orígenes habilitados en paralelo, con cancelación y un presupuesto total inferior a cinco segundos.
5. Responder `AFILIADO_OTRA_CAJA` si existe una afiliación vigente en otra caja. Incluir también las cajas indisponibles.
6. Responder `NO_AFILIADO` únicamente cuando los orígenes requeridos hayan respondido válidamente sin coincidencias. Si falta alguno, responder `INDETERMINADO` y enumerarlo en `unavailable`.
7. Evitar que una caché de ausencia o un mecanismo de fallas oculte la indisponibilidad de una caja o impida reconocer su recuperación.
8. Implementar v1 y v2; únicamente v2 añadirá `affiliateType`. Mantener `requestId`, `matches`, `source` y `asOf` según contrato.
9. Reutilizar esta lógica en los lotes y aplicar validación de finalidad con HTTP 400, sin depender del código por defecto de validación del framework.

**Archivos:** `src/domain/normalization.ts`, `src/domain/affiliation.ts`, `src/application/affiliations.ts` y las rutas de consultas en `src/routes/affiliations.ts`.

**Criterio de cierre:** P02–P09 y P12 pasan donde corresponda; una caja caída nunca produce un falso `NO_AFILIADO`; una caja lenta permite respuesta en menos de cinco segundos; v1 conserva su contrato.

## Tarea 04 Seguridad y auditoría

**Resultado:** cada consumidor tiene identidad verificable y cada consulta autorizada deja trazabilidad con documento enmascarado.

1. Validar `Authorization: Bearer` contra variables de entorno. Sin token o con token inválido, responder 401.
2. Asociar cada token con su caja; limitar la auditoría a `ADMIN_TOKEN` y definir los permisos administrativos sobre otras rutas.
3. Aceptar solo las tres finalidades permitidas en consultas individuales. Finalidad ausente o inválida devuelve 400.
4. Aplicar esquemas de salida por lista de campos permitidos, incluyendo resultados de lote, errores y auditoría.
5. Persistir `timestamp`, `requestingCaja`, `purpose`, `result` y `documentMasked`. El enmascaramiento revelará como máximo cuatro dígitos.
6. Proteger los logs: no registrar tokens, credenciales de SOAP, payloads personales ni documentos completos en URLs.
7. Mantener los secretos en `.env`, fuera de Git; documentar las variables sin copiar sus valores a código, pruebas o ejemplos.
8. Coordinar cinco pruebas con nombres estables para el modelo de amenazas: autenticación, finalidad, dato mínimo, secretos y auditoría.

**Archivos:** `src/security/`, `src/audit/`, `src/routes/audit.ts` y la migración propia de auditoría.

**Criterio de cierre:** P01, P02, P06 y P13 pasan; un token de caja no puede leer auditoría; las cinco mitigaciones tienen una prueba ejecutada y aprobada.

## Tarea 05 Lotes e idempotencia

**Resultado:** procesamiento asíncrono y persistente de al menos 10.000 documentos en un máximo de 300 segundos.

1. Aceptar CSV `text/csv` con columna `document`; añadir multipart con campo `file` para cubrir ambos formatos admitidos por el kit.
2. Validar autenticación, CSV, límites de tamaño y `Idempotency-Key` antes de crear el trabajo.
3. Resolver la finalidad de lote de forma compatible con el validador: usar `VALIDACION_AFILIACION` cuando el POST no declare `purpose`, documentarlo y auditarlo; rechazar una finalidad explícita inválida.
4. Guardar el trabajo y responder 202 con `jobId` sin esperar a procesar todas las filas.
5. Implementar idempotencia atómica por consumidor y clave. La misma petición devuelve el mismo `jobId`; una clave reutilizada con contenido distinto tiene un comportamiento documentado y probado.
6. Persistir y exponer `PENDING`, `RUNNING` y `DONE`; definir recuperación de trabajos tras reinicio.
7. Limitar la concurrencia global y por origen; conservar capacidad para consultas individuales mientras corre un lote.
8. Reutilizar resultados de documentos repetidos dentro del mismo lote y conservar una salida por fila, su orden y la exclusión de la caja consultante.
9. Aislar trabajos por consumidor; impedir consultar trabajos de otra caja sin autorización.
10. Medir el procesamiento y verificar exactitud, resultados parciales ante fallas y ausencia de campos personales.

**Archivos:** `src/batch/`, `src/routes/batch.ts` y las migraciones propias de trabajos y resultados.

**Criterio de cierre:** 10.000 resultados correctos en 300 segundos o menos; POST repetido devuelve el mismo trabajo; dos POST simultáneos con la misma clave no crean dos trabajos; la API sigue atendiendo consultas.

## Tarea 06 Pruebas y rendimiento

**Resultado:** evidencia reproducible de funcionamiento y al menos 15 pruebas aprobadas con cero fallidas.

1. Crear pruebas unitarias de normalización, fechas, tipos de afiliación y transformación de protocolos con fixtures propios.
2. Crear pruebas de integración contra Caja Link levantado para autenticación, finalidad, exclusión, coincidencias, no afiliación, dato mínimo, Centro, v1/v2 y auditoría.
3. Probar caída y lentitud de las cajas mediante `/__chaos`; restablecer siempre el modo `ok`, incluso cuando falle una aserción.
4. Verificar recuperación de un origen, coexistencia de coincidencias e indisponibilidad y ausencia de respuestas falsas.
5. Probar CSV, multipart, idempotencia simultánea, permisos de lote, persistencia y consulta de estado.
6. Generar el reporte JUnit real en `test-results/` desde el servicio `tests`, con los nombres citados por el modelo de amenazas.
7. Ejecutar `validator check`, `validator check --lote` y `validator entregables` sin modificar sus reglas ni sus datos de referencia.
8. Probar Caja Sur explícitamente con `CAJA_SUR_ENABLED=true` y recreación del perfil, porque P14 solo se comprueba oficialmente en el validador del evento.
9. Ejecutar una prueba de carga del CSV real y guardar duración, número de documentos y errores medidos; comprobar también la exactitud, que el validador público de lote no comprueba.
10. Repetir arranque desde cero y pruebas esenciales con el estado final. Acordar los reinicios y las pruebas de caos desde el chat principal para no interferir con otros trabajos.

**Archivos:** `tests/`, `tests/Dockerfile`, scripts de prueba y carga, y evidencia generada en `test-results/`. Los cambios necesarios en Compose se integrarán desde el chat principal.

**Criterio de cierre:** mínimo 15 pruebas aprobadas; cinco mitigaciones demostradas en JUnit; lote dentro del tiempo; evidencia de Sur; controles públicos aplicables aprobados y problemas restantes registrados con precisión.

## Tarea 07 Documentación y entrega

**Resultado:** documentos completos y coherentes con el código y las comprobaciones ejecutadas.

1. Completar las once secciones exactas del README. Incluir integrantes, requisitos, arranque, todas las variables de `.env.example`, todos los servicios de Compose, las cinco rutas, pruebas y enlaces obligatorios.
2. Elaborar OpenAPI 3 con las cinco rutas, esquemas v1/v2, seguridad, finalidades, CSV, multipart, idempotencia, códigos de error y auditoría.
3. Completar arquitectura con las cinco secciones obligatorias, al menos 20 palabras por sección y dos alternativas descartadas.
4. Escribir entre tres y cinco ADR con Contexto, Decisión, Alternativas y Consecuencias. Cumplir los mínimos de palabras y alternativas. Decisiones previstas: hub con adaptadores; fallas y tiempos; lotes persistentes; privacidad y configuración.
5. Completar las cinco categorías del modelo de amenazas; citar únicamente nombres de pruebas que aparezcan aprobadas en el JUnit final.
6. Completar `docs/load-test.md` con `herramienta`, `documentos`, `duracion_segundos` y `errores` usando la medición real.
7. Registrar al menos tres usos relevantes de IA con los cinco campos exactos; describir correcciones o verificaciones efectivamente realizadas por el equipo con ocho palabras o más.
8. Preparar un guion de pitch de hasta 60 segundos que muestre problema, solución y resultado comprobado.
9. Verificar historial Git: mínimo diez commits descriptivos entre el 14 de octubre de 2026 a las 10:00 y antes del cierre del 15 de octubre de 2026 a las 15:00, hora de Colombia; mínimo tres por integrante, con sus identidades reales.
10. Verificar repositorio público y enlaces registrados en Mi equipo. Los integrantes grabarán el pitch y compartirán el video de Drive como cualquier persona con el enlace antes del cierre.

**Archivos:** `README.md`, `openapi.yaml`, `AI_USAGE.md`, `docs/architecture.md`, `docs/adr/`, `docs/threat-model.md`, `docs/load-test.md` y un guion de pitch en `docs/pitch.md`.

**Criterio de cierre:** entregables automáticos completos con evidencia real; historial de ambos integrantes conforme a la ventana del evento; enlaces de repositorio y pitch registrados; video público de 60 segundos o menos. La evaluación del contenido del pitch corresponde al comité.

## Orden de ejecución

1. Revisar este plan, cerrar las decisiones de arquitectura y obtener las identidades Git necesarias.
2. Completar 01 y guardar una base compilable con los tipos compartidos.
3. Trabajar 02, 03 y 04 en módulos separados; preparar el diseño de pruebas y los borradores de documentos en paralelo cuando sus dependencias lo permitan.
4. Integrar consultas, adaptadores y seguridad; ejecutar el validador sin lote y corregir fallas antes de ampliar el servicio.
5. Completar 05; integrar, medir el lote y ajustar concurrencia con evidencia.
6. Ejecutar 06, incluido Sur, caos y arranque desde cero.
7. Cerrar 07 con los resultados reales; revisar entregables y realizar la entrega con margen.

Distribución inicial para revisar: Josue se concentra en base, consultas e integración; Andres en adaptadores, seguridad y lotes. Ambos revisan pruebas, documentación y pitch. La distribución se puede ajustar a sus conocimientos sin cambiar los criterios de cierre.

## Cobertura de la rúbrica

| Requisitos | Responsable del trabajo | Evidencia de cierre |
|---|---|---|
| P01 autenticación; P02 finalidad | 03 y 04 | Respuestas 401/400, restricción administrativa y pruebas |
| P03 resultados; P04 normalización; P05 exclusión | 02 y 03 | Casos positivos, negativos, dobles afiliaciones y documentos equivalentes |
| P06 dato mínimo | 02, 03, 04 y 05 | Esquemas permitidos y prueba recursiva de respuestas |
| P07 caída; P08 lentitud | 02 y 03 | Caos, indisponibilidad explícita y consulta menor de cinco segundos |
| P09 fuente por archivo | 02 | Centro con `source: FILE` y fecha de corte correcta |
| P10 lote; P11 idempotencia | 05 | 10.000 resultados en máximo 300 s y trabajo único |
| P12 versionado | 03 | v2 con tipo y v1 con contrato original |
| P13 auditoría | 04 | Campos completos, permisos y máximo cuatro dígitos visibles |
| P14 cuarta caja | 01 y 02 | Activación de Sur por configuración y pruebas propias |
| PE01 ADR; PE07 arquitectura | 07 | Formatos y mínimos completos |
| PE02 amenazas; PE03 pruebas | 04, 06 y 07 | Cinco categorías demostradas y mínimo 15 pruebas aprobadas |
| PE04 carga | 06 y 07 | Medición real y cuatro campos completos |
| PE05 configuración | 01 y 02 | Cuatro cajas declaradas, sin direcciones en código |
| PE06 OpenAPI; PE11 README | 07 | Cinco rutas y once secciones contrastadas con el proyecto |
| PE08 historial | Ambos integrantes | Diez commits en el evento, tres o más por cada autor |
| PE09 uso de IA | Ambos integrantes y 07 | Tres usos completos y correcciones o verificaciones reales |
| PE10 pitch | Ambos integrantes y 07 | Video público de máximo 60 s y registro antes del cierre |

## Fechas de control propuestas

El evento comienza el 14 de octubre de 2026 a las 10:00 y la entrega cierra el 15 de octubre de 2026 a las 15:00 en Colombia. Estos cortes reservan tiempo para corregir fallas y completar los registros de entrega:

| Fecha y hora de Colombia | Meta |
|---|---|
| 14 de octubre | Plan revisado, base del proyecto y primer recorrido de consulta |
| 15 de octubre, 12:00 | Contrato completo, incluidos lotes y Caja Sur |
| 15 de octubre, 13:00 | Pruebas, carga, JUnit y documentos completos |
| 15 de octubre, 14:00 | Commit y push finales previstos; repositorio y pitch registrados |
| 15 de octubre, 14:00 a 15:00 | Margen para resolver problemas de entrega y comprobar enlaces |

Si una tarea se retrasa, se prioriza el contrato obligatorio, las pruebas y los entregables. Una interfaz gráfica, servicios adicionales o mejoras ajenas a la rúbrica se considerarían después de completar esa base.

## Acuerdos de colaboración

Se harán preguntas cuando falte información que afecte a una decisión, a las identidades del equipo o a la entrega. Las decisiones rutinarias dentro del alcance acordado se resolverán y se explicarán en el chat correspondiente.

Cada resultado se registrará con su comprobación. Los valores de carga, reportes de pruebas, usos de IA y autorías Git reflejarán trabajo real. Los cambios compartidos, las pruebas de caos, los reinicios y la integración final se coordinarán desde este chat.

Antes de cerrar, ambos integrantes deberán poder explicar el flujo de consulta, las reglas de fallas, los permisos, la idempotencia y los resultados de las pruebas. El objetivo de cada chat incluye dejar el módulo comprensible para el equipo.
