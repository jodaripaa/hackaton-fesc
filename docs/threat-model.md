# Modelo de amenazas

La frontera de confianza está entre consumidores, Caja Link, orígenes externos y PostgreSQL propio. Los tokens identifican cajas o administrador; una identidad administrativa no tiene caja consultante. Los payloads externos se validan antes de entrar al dominio. El documento normalizado sigue siendo un dato sensible, aunque no se devuelvan nombre, dirección, teléfono, correo, salario ni beneficiarios.

| Categoría | Amenaza | Mitigación | Prueba |
|---|---|---|---|
| Autenticación | Peticiones sin token o con credencial inválida intentan consultar afiliaciones. | Las rutas verifican Bearer y devuelven 401 antes de ejecutar el servicio. | test_consulta_sin_token_responde_401 |
| Finalidad | El consumidor consulta sin finalidad admitida o introduce parámetros ambiguos. | Esquema exige una finalidad permitida y devuelve 400 antes de ejecutar el servicio. | test_finalidad_ausente_o_invalida_responde_400 |
| Dato mínimo | Datos personales externos aparecen en consultas o respuestas de auditoría. | Proyección v1 y esquemas permitidos eliminan campos ajenos al contrato. | test_respuestas_solo_contienen_dato_minimo |
| Secretos | Logs y errores capturan credenciales, documento de la URL o payload personal. | Serializadores omiten URL, headers y cuerpos; errores internos y campos sensibles se redactan. | test_secretos_no_se_exponen_en_logs_y_errores |
| Auditoría | Un consumidor lee auditoría o la respuesta revela el documento completo. | Solo ADMIN_TOKEN puede leer entradas y la máscara revela como máximo cuatro dígitos. | test_auditoria_exclusiva_y_documento_enmascarado |

## Evidencia comprobada

Los cinco nombres de la tabla aparecen aprobados en el JUnit único test-results/junit.xml generado para esta revisión: 165 casos aprobados, cero fallidos y dos omitidos de Sur. Se verificó cada testcase y la ausencia de failure, error o skipped en los cinco casos. El [resumen conservado](evidence/tests-summary.json) registra conteos, nombres, comando y revisión 71394a6; el XML se regenera al ejecutar tests. Las pruebas usan seguridad y serializadores reales con Fastify inyectado. El coordinador comunicó revisión de seguridad sin defectos y diez pruebas ejecutadas; no sustituye la revisión humana de los integrantes.

El mismo XML también aprueba integracion_auditoria_solo_admin_y_trazabilidad_enmascarada contra HTTP real y PostgreSQL, integracion_idempotencia_simultanea_conflicto_y_aislamiento_por_caja y lote_postgres_idempotencia_atomica_leases_orden_propiedad_y_recuperacion. Las pruebas de auditoría fallida y presupuesto total siguen aprobadas. La suite fue repetida después de corregir la lectura pública de lotes y conserva 165 casos aprobados, cero fallidos y dos omitidos de Sur.

## Riesgos y comprobaciones pendientes

El [fixture positivo de Sur](evidence/sur-fixture-check.json) se repitió dentro de Docker con el comando documentado en README: cinco controles aprobados y salida 0, sin exigir Node.js local ni .env dentro del contenedor. Mantiene la distinción entre evidencia propia y el P14 oficial no ejecutado.

La [carga repetida](evidence/load-test.json) verificó 10000 filas sin errores después de corregir GET de lote para evitar reconstrucción de parciales antes de DONE. La red interna usa HTTP en el kit; TLS, rotación de secretos, cifrado y retención de documentos de lote necesitan decisiones operativas para producción. El [cotejo de secretos](evidence/secrets-check.json) comparó nueve valores reales contra los dieciséis commits del HEAD 04c29bc y su árbol versionado, sin coincidencias; el reporte no contiene esos valores. Se repite antes del push y tras cambios de código. Los dos casos de Sur omitidos no cuentan como aprobaciones; su evidencia propia adicional está en [Sur original](evidence/sur-check.json) y [fixture sintético](evidence/sur-fixture-check.json), sin ejecución de P14 oficial.
