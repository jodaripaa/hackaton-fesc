# Pitch y checklist de entrega

## Guion provisional de hasta 60 segundos

Objetivo de lectura: aproximadamente 50–55 segundos, pendiente de cronometrar en voz alta por los integrantes. El guion incorpora la medición recibida; grabación, duración real y publicación todavía están pendientes.

> Somos Josue Palomino y Andres Rodriguez. Antes de conceder un beneficio, una caja necesita saber si una persona está afiliada en otra. Caja Link integra REST, SOAP y archivos mediante una API común. Cada consumidor se identifica y declara una finalidad; compartimos datos mínimos y auditamos con documento enmascarado. Si una fuente falla, informamos la incertidumbre para evitar un falso “no afiliado”. Conservamos la versión uno y añadimos el tipo de afiliado en la versión dos. Verificamos diez mil resultados sin errores en 62,7 segundos, mientras atendíamos consultas individuales. El lote conserva orden e idempotencia; las pruebas comprueban seguridad y persistencia.

La cifra del guion proviene de [load-test.json](evidence/load-test.json), redondeada a una décima. Ajustar la lectura para mantener una duración real de 60 segundos o menos. Mostrar consulta v2, unavailable y auditoría enmascarada, usando datos sintéticos y ocultando tokens. El video no declara P14 oficial aprobado ni publicación del repositorio antes de realizarla.

## Checklist técnico

- [x] [Arranque limpio](evidence/clean-start.json) de 71394a6 con .env.example sin cambios y PostgreSQL nuevo: segundo build correcto tras timeout TLS del registro. [Validador limpio](evidence/clean-validator.txt): P01–P13 PASS; lote público DONE en 134 s.
- [x] Consultas, auditoría y lotes instalados y contrastados con las cinco rutas OpenAPI.
- [x] Compose resuelto con perfiles test y caja-sur: seis servicios, todos los bind mounts dentro del repositorio, sin privileged, cap_add, devices ni red o procesos del host; los servicios propios no montan mocks.
- [x] JUnit del rework: 169 casos aprobados, cero fallidos; las cinco mitigaciones del modelo de amenazas y cuatro pruebas sintéticas de Sur aprobadas.
- [x] Suite Docker repetida con dos procesos del runner: 173 aprobadas según Node, cero fallidas y dos omitidas del origen Sur original. Los límites de la API no cambiaron.
- [x] Validador público con lote: P01–P13 PASS, salida 0 y 460/500 puntos; P14 N/E. Verificador de entregables del rework: 25/25, incluido historial; pitch aparte.
- [x] Cinco controles propios con Sur original y cinco positivos con fixture sintético por configuración, también aprobados dentro de Docker con salida 0; P14 oficial no ejecutado.
- [x] Fixture ampliado del rework: nueve controles aprobados, incluidos caída, lentitud, exclusión durante falla y recuperación.
- [x] Lote independiente: 10000 filas recibidas y verificadas, cero errores, 62,658 segundos; 41 consultas individuales durante el lote.
- [x] README con 36 variables, seis servicios y once secciones; enlaces y formatos revisados.
- [x] Tres usos de IA veraces documentados.
- [ ] Ambos integrantes revisaron y pueden explicar código y comprobaciones.

## Checklist Git y plataforma

Ventana inicial: 14 de octubre de 2026 a las 10:00 hasta 15 de octubre de 2026 a las 15:00, America/Bogota (UTC−05:00). El usuario informó prórroga hasta las 15:30 del 15 de octubre; contrastarla con la plataforma. La entrega debe estar en un commit anterior al cierre. La corrección de autoría solicitada se limita a trabajo que el usuario confirmó que pertenecía a Andres; conserva las fechas originales.

- [x] Autores registrados: Josue con jodaripaa y Andres Rodriguez con art_fr_gallego@fesc.edu.co; corrección confirmada por el usuario y registrada en docs/authorship-correction.md.
- [x] Mínimo total de diez commits del evento cumplido con contribuciones reales de Josue; recontar al entregar.
- [x] Historial con cuatro commits de Andres en pruebas, rendimiento y seguridad y más de tres de Josue; contenido y fechas originales conservados.
- [x] Mensajes descriptivos: el verificador requiere al menos tres palabras y un mínimo de 80 %; el historial completo observado obtuvo 94 %.
- [x] Cotejo de nueve credenciales reales contra dieciséis commits del HEAD 04c29bc y árbol versionado, sin coincidencias; evidencia en docs/evidence/secrets-check.json.
- [x] .env fuera del historial y .env.example presente. Repetir el cotejo antes de cada push y tras el rework.
- [x] Repositorio público con autorización del usuario; lectura Git sin credenciales y ZIP HTTP 200 comprobados sobre 6c8bb73. El ZIP es legible y contiene README, Compose, OpenAPI y src/main.ts.
- [ ] Registrar el enlace del repositorio público en Mi equipo y comprobar el resultado de la plataforma.
- [x] Estado validado subido por el coordinador a origin/main; HEAD local y remoto 6c8bb73 coinciden antes de documentar la publicación.
- [ ] Grabar y cronometrar el video; duración efectiva de 60 segundos o menos.
- [ ] Subir el video a Google Drive, habilitar “Cualquier persona con el enlace” y comprobar acceso.
- [ ] Registrar el enlace del pitch en Mi equipo antes del cierre; conservar el archivo sin modificaciones posteriores.
- [ ] Verificar desde Mi equipo que repositorio y pitch tienen sus enlaces correctos y acceso confirmado.

Consulta de historial, sin modificar Git:

```bash
git log --no-merges --since='2026-10-14T10:00:00-05:00' --before='2026-10-15T15:30:00-05:00' --format='%h | %an | %ae | %cI | %s'
```

La revisión debe atribuir contribuciones a identidades confirmadas y considerar el historial real. Los commits anteriores a las 10:00 del inicio no cuentan para la ventana. La mitad automática del pitch verifica duración y acceso; la validez del contenido corresponde al comité.

Estado comunicado por el coordinador: el historial corregido registra cuatro commits de Andres y más de tres de Josue; b7dee66 es anterior al inicio y no cuenta. El usuario confirmó que pruebas, rendimiento y seguridad pertenecían a Andres y habían quedado con la cuenta de Josue. La corrección y su respaldo están documentados. El repositorio es público con acceso sin autenticación comprobado. Pitch/Drive, registro de enlaces y revisión humana siguen pendientes. Volver a comprobar esos estados al entregar.
