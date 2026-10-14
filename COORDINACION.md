# Coordinación de Caja Link

El plan está aprobado y los siete chats de trabajo están creados en el proyecto `hackaton fesc`. La tarea 01 está validada con compilación, typecheck, arranque Docker, PostgreSQL y 20 pruebas aprobadas dentro de los contenedores. El usuario autorizó continuar todas las tareas pendientes.

Las respuestas de las herramientas de consulta y activación tardan, pero se confirmó que los chats 02, 03, 05, 06 y 07 recibieron sus tareas. El coordinador inició implementaciones mientras esperaba confirmación y corrigió la distribución para evitar nuevas interferencias. Cada chat conserva los archivos asignados; el coordinador integra los exports y verifica el sistema en Docker.

## Chats y dependencias

| Tarea | Chat | Identificador | Estado de activación | Dependencias |
|---|---|---|---|---|
| 01 | Caja Link 01 Base y contrato | `01a13ada-6172-7cb2-9c18-d219538866d1` | Base validada en Docker | Plan aprobado |
| 02 | Caja Link 02 Adaptadores de cajas | `01a13ada-794b-7ad3-b80a-eb5fc4312418` | Implementación en su chat; propietario exclusivo de adapters | Base 01 |
| 03 | Caja Link 03 Consultas y fallas | `01a13ada-91eb-7ed3-b5db-8d733be634db` | Revisión terminada; 28 pruebas propias aprobadas | Tipos 01; adaptadores 02 para integrar |
| 04 | Caja Link 04 Seguridad y auditoría | `01a13ada-a77b-7380-9cfd-26828e00a718` | Implementación en el coordinador | Base 01; consultas 03 para integrar |
| 05 | Caja Link 05 Lotes e idempotencia | `01a13ada-c93b-76a3-b3c4-ec998ebf4f49` | Implementación activa; worker, repositorio y migración presentes | Base 01; integración 02 a 04 |
| 06 | Caja Link 06 Pruebas y rendimiento | `01a13ada-e972-7c23-b3be-29099d0ffaef` | Implementación activa de pruebas y carga; ejecución en coordinador | Base 01; integración 02 a 05 para ejecutar |
| 07 | Caja Link 07 Documentación y entrega | `01a13adb-0730-7641-a129-6586415480b9` | Documentación activa; métricas pendientes de medición real | Base 01; resultados 06 para cerrar |

Chat de coordinación e integración: `01a13ac6-fd41-7232-8afb-c1d8df317645`, correspondiente a la conversación donde el equipo aprobó el plan.

## Responsabilidades de la fase activa

La tarea 01 implementa la estructura TypeScript, Fastify, configuración de las cuatro cajas, conexión PostgreSQL, runner de migraciones, Docker Compose y el arnés inicial de pruebas. Define los tipos compartidos y crea el contrato OpenAPI inicial y `docs/implementation-contract.md` para que las siguientes tareas integren sus módulos con interfaces concretas.

La base debe compilar, validar su configuración y proporcionar health/readiness. Las rutas de afiliaciones, seguridad de negocio, auditoría y lotes se completarán en las tareas siguientes; no se considerarán aprobadas por el validador hasta implementarlas y comprobarlas.

El chat principal administra [PLAN.md](PLAN.md) y este registro. Durante la implementación de la base, los demás chats no modifican código, dependencias, Git ni Docker. Después de la tarea 01, los cambios en los archivos compartidos se coordinarán desde el chat principal.

## Comprobaciones de la base

- Instalación reproducible con lockfile, comprobación de tipos y compilación.
- Pruebas reales de configuración, contrato base y health/readiness, según las dependencias disponibles.
- Configuración válida de Docker Compose, sin opciones prohibidas ni montajes fuera del repositorio.
- Arranque de Caja Link y PostgreSQL, con verificación de salud, cuando esté disponible el motor Docker.
- Cuatro cajas declaradas mediante configuración y credenciales obtenidas del entorno.
- Código del servicio sin direcciones de las cajas ni lectura de sus datos internos.

## Revisión de avance de la base

La tarea 01 quedó guardada en `b9a6130` después de preservar el kit en `b7dee66`. Ya existen la configuración TypeScript, las dependencias fijadas, los tipos compartidos de consultas, adaptadores, auditoría y lotes, la configuración de las cuatro cajas, la aplicación Fastify con health/readiness y el código de conexión y migraciones PostgreSQL.

Los Dockerfiles, OpenAPI inicial y `docs/implementation-contract.md` están presentes. Se verificaron los tipos y 18 pruebas locales; tras recuperar el motor Docker se levantó Compose, `/health` y `/ready` respondieron correctamente y el servicio `tests` generó JUnit con 20 pruebas aprobadas, cero fallidas y cero omitidas. Esta evidencia valida la base; la suite final incluirá también los módulos de negocio.

Docker fallaba por sockets temporales antiguos. Los directorios temporales se preservaron en copias dentro de sus mismos directorios padre, sin borrar imágenes, contenedores o volúmenes. El motor volvió a responder y permitió la validación en contenedores.

## Condiciones de entrega

La ventana del evento es del 14 de octubre de 2026 a las 10:00 al 15 de octubre de 2026 a las 15:00, hora de Colombia. Los commits deben representar cambios reales dentro de esa ventana. No se sustituye la identidad de un integrante para atribuirle el trabajo de otro.

El usuario de GitHub de Josue es `jodaripaa`. El correo asociado a la cuenta de GitHub de Andres es `art_fr_gallego@fesc.edu.co`; todavía no se ha establecido como correo de sus commits. Las pruebas y mediciones de rendimiento se registrarán después de ejecutarlas.

## Evidencia de integración parcial

El 14 de octubre se aprobaron 112 pruebas unitarias combinadas y los 11 controles evaluados por `python validator check`: P01–P09, P12 y P13, con 380/500 puntos parciales. P10–P11 requieren el lote y P14 se evalúa oficialmente. No representan todavía una aprobación de la entrega completa.

El perfil `caja-sur` se activó con `CAJA_SUR_ENABLED=true` y se ejecutó `scripts/check-sur.mjs`. Cinco controles reales aprobaron la ausencia válida, la consulta del origen configurado, la compatibilidad de v1, la indisponibilidad sin falso negativo y la exclusión del consumidor Sur. No se encontró un afiliado activo de Sur en los primeros 512 documentos públicos; el caso positivo exclusivo continúa pendiente del validador oficial. El origen quedó restaurado a modo `ok` y la configuración habitual vuelve a deshabilitar Sur.

La suite final, la medición de 10.000 documentos, el pitch público y las contribuciones personales de ambos integrantes siguen pendientes de cierre. El kit previo al evento (`b7dee66`) no cuenta en la ventana; la base (`b9a6130`) sí cuenta.
