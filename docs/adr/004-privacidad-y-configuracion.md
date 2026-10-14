# ADR 004: dato mínimo, trazabilidad y secretos por entorno

Estado: aceptada; revisión humana y evidencia final pendientes.

## Contexto

Los orígenes entregan datos personales que no son necesarios para verificar afiliación. El servicio también maneja credenciales y documentos en rutas, errores, logs y persistencia propia.

## Decisión

Eliminar campos personales en adaptadores y serializar respuestas con listas permitidas. Autenticar consumidores y administrador por tokens distintos del entorno; exigir finalidad. Auditar consumidor, finalidad, resultado y documento enmascarado antes de responder éxito. Resolver credenciales y direcciones por configuración sin valores secretos en el código.

## Alternativas

- Devolver el payload del origen y pedir al consumidor filtrar datos: expone información innecesaria y pierde control del contrato.
- Registrar URL y cuerpo completos para depurar: puede revelar documentos, tokens y datos personales en logs.
- Incluir credenciales y direcciones directamente en adaptadores: dificulta rotación, incorporación de Sur y cumplimiento del límite de configuración.

## Consecuencias

El contrato reduce datos expuestos y la auditoría conserva trazabilidad con cuatro dígitos visibles como máximo. La base propia sigue manejando documentos de lote; requiere acceso restringido y una política de retención pendiente para producción. El JUnit prueba máscara, esquema, redacción y permisos, incluida auditoría administrativa mediante HTTP real. El cotejo de secretos no halló coincidencias para nueve credenciales y nueve commits revisados; falta repetirlo sobre el último HEAD y completar la revisión humana.
