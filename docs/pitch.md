# Pitch y checklist de entrega

## Guion de Josue y Andres

Grabar con objetivo de 55 segundos y dejar cinco segundos de margen. Los tiempos son una pauta de ensayo; comprobar la duración del archivo final, que debe ser de 60 segundos o menos.

El texto hablado suma 101 palabras. Hablar con calma y ensayar los cambios de pantalla antes de grabar.

| Tiempo | Habla | Texto | Qué mostrar |
|---|---|---|---|
| 0–11 s | Josue | Somos Josue Palomino y Andres Rodriguez. Antes de conceder un beneficio, una caja necesita comprobar si la persona está afiliada en otra. | Ambos integrantes y el nombre Caja Link; pasar a la pantalla compartida. |
| 11–26 s | Andres | Creamos Caja Link: integra REST, SOAP y archivos en una API. Aquí vemos la afiliación y su tipo. Exigimos autenticación y finalidad, entregamos datos mínimos y auditamos con documento enmascarado. | Consulta v2 con result, caja y affiliateType. Cambiar a una entrada de auditoría con purpose y documentMasked. |
| 26–39 s | Josue | Si una caja falla y no podemos verificar la afiliación, respondemos “indeterminado”. Así evitamos confundir una falla con un “no afiliado”. | Respuesta del caso sin coincidencias comprobables: result INDETERMINADO, matches vacío y unavailable con NORTE. |
| 39–55 s | Andres | Verificamos diez mil resultados sin errores en sesenta y dos coma siete segundos, atendiendo consultas individuales durante el lote. Caja Link aporta interoperabilidad, trazabilidad y tolerancia a fallas. | Medición previa del lote: documentos 10000, filas_verificadas 10000, duracion_segundos 62.657976766, errores 0 y consultas_durante_lote 41. |

La cifra proviene de [load-test.json](evidence/load-test.json), redondeada a una décima. Mostrarla como una medición ya ejecutada: la prueba completa tarda más que el pitch y no debe presentarse como si hubiera terminado durante esos segundos. El guion no declara P14 oficial aprobado.

## Preparación de la demo

La API corre en [localhost:8083/health](http://localhost:8083/health) en el computador que ejecuta Docker. Esa ruta muestra JSON; el repositorio público no constituye un despliegue web de la API.

Antes de grabar, con el entorno levantado, preparar las respuestas reales del kit sintético:

```bash
docker compose --profile test run --rm --build tests node scripts/demo-pitch.mjs
```

El script consulta un caso de Centro publicado por el validador, simula Norte caído para un documento artificial y restaura Norte a modo ok en finally. No ejecutarlo mientras otra prueba de caos o carga esté activa. Las credenciales se leen del entorno del contenedor y no se imprimen. Se guardan tres archivos en test-results/pitch-demo:

1. 01-consulta-v2.json: consulta autenticada con finalidad, coincidencia y tipo de afiliado.
2. 02-caja-indisponible.json: respuesta real con INDETERMINADO y unavailable.
3. 03-auditoria.json: una entrada con documento enmascarado.

El comando se comprobó en Docker con salida 0: la consulta mostró Centro con tipo PENSIONADO, el caso de falla respondió INDETERMINADO con NORTE en unavailable y la auditoría mostró ********9999. Norte quedó restaurado.

Abrir esos tres archivos y docs/evidence/load-test.json en pestañas antes de grabar, con texto grande y sin mostrar .env ni encabezados Authorization. Las respuestas preparadas son capturas de ejecuciones reales; si se muestra una consulta en vivo, usar un cliente HTTP con credenciales ocultas. Evitar escribir comandos largos durante el video.

Ensayar una vez con cronómetro. Si supera 55 segundos, retirar la frase “atendiendo consultas individuales durante el lote”; conservar problema, solución y resultado. Grabar audio claro, revisar el archivo completo y subirlo a Drive con acceso “Cualquier persona con el enlace”. Registrar repositorio y video en Mi equipo antes del cierre.

## Checklist técnico

- [x] [Arranque limpio](evidence/clean-start.json) de 71394a6 con .env.example sin cambios y PostgreSQL nuevo: segundo build correcto tras timeout TLS del registro. [Validador limpio](evidence/clean-validator.txt): P01–P13 PASS; lote público DONE en 134 s.
- [x] Consultas, auditoría y lotes instalados y contrastados con las cinco rutas OpenAPI.
- [x] Compose resuelto con perfiles test y caja-sur: seis servicios, todos los bind mounts dentro del repositorio, sin privileged, cap_add, devices ni red o procesos del host; los servicios propios no montan mocks.
- [x] JUnit consultado: 165 casos aprobados, cero fallidos; cinco nombres del modelo de amenazas aprobados.
- [x] Suite repetida después de la corrección de lotes: JUnit con 165 aprobadas, cero fallidas y dos omitidas de Sur.
- [x] Validador público con lote: P01–P13 PASS, salida 0 y 460/500 puntos; P14 N/E. Verificador documental: 24,83/25, solo historial parcial.
- [x] Cinco controles propios con Sur original y cinco positivos con fixture sintético por configuración, también aprobados dentro de Docker con salida 0; P14 oficial no ejecutado.
- [x] Lote independiente: 10000 filas recibidas y verificadas, cero errores, 62,658 segundos; 41 consultas individuales durante el lote.
- [x] README con 36 variables, seis servicios y once secciones; enlaces y formatos revisados.
- [x] Tres usos de IA veraces documentados.
- [ ] Ambos integrantes revisaron y pueden explicar código y comprobaciones.

## Checklist Git y plataforma

Ventana oficial: 14 de octubre de 2026 a las 10:00 hasta 15 de octubre de 2026 a las 15:00, America/Bogota (UTC−05:00). La entrega debe estar en un commit anterior al cierre. No se alteran autores, correos ni fechas para completar requisitos.

- [ ] Confirmar nombre y correo reales de commits de ambos integrantes; el correo de GitHub informado de Andres todavía no acredita autoría de commits.
- [x] Mínimo total de diez commits del evento cumplido con contribuciones reales de Josue; recontar al entregar.
- [ ] Al menos tres commits reales de cada integrante confirmado; ninguno confirmado todavía de Andres.
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
git log --no-merges --since='2026-10-14T10:00:00-05:00' --before='2026-10-15T15:00:00-05:00' --format='%h | %an | %ae | %cI | %s'
```

La revisión debe atribuir contribuciones a identidades confirmadas y considerar el historial real. Los commits anteriores a las 10:00 del inicio no cuentan para la ventana. La mitad automática del pitch verifica duración y acceso; la validez del contenido corresponde al comité.

Estado comunicado por el coordinador: el mínimo total de commits del evento está cumplido por Josue y ninguno está confirmado de Andres; b7dee66 es anterior a las 10:00 y no cuenta. El usuario indicó que se trabaja desde esta cuenta por ahora y que Andres hará rework real posterior desde su propia cuenta: siguen pendientes sus tres commits personales y revisión. El repositorio ya es público con autorización explícita del usuario y acceso sin autenticación comprobado. Pitch/Drive, registro de enlaces y revisión humana siguen pendientes. Volver a comprobar esos estados al entregar.
