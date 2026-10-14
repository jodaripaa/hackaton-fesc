# ADR 001: hub central con adaptadores por protocolo

Estado: aceptada para la implementación del reto.

## Contexto

Las cajas publican REST, SOAP y archivos diarios con formatos y credenciales distintos. Debemos aplicar reglas comunes de vigencia, exclusión y privacidad sin acceder a sus bases internas.

## Decisión

Implementar un hub Fastify con dominio común y adaptadores CajaAdapter por origen. Resolver direcciones desde configuración y convertir respuestas a afiliaciones normalizadas antes de consultar reglas de negocio.

## Alternativas

- Integraciones punto a punto: aumentan contratos y duplican reglas por cada pareja de cajas.
- Un adaptador universal que devuelve payloads originales: mezcla protocolos con negocio y dificulta garantizar dato mínimo.
- Leer datos internos de las cajas: contradice el límite obligatorio de acceso por interfaces.

## Consecuencias

El hub simplifica cambios de protocolo y permite probar el dominio con fixtures propios. También concentra carga y disponibilidad, por lo que su capacidad y recuperación se comprobaron durante integración. El [arranque limpio](../evidence/clean-start.json) demostró instalación con .env.example sin modificar y PostgreSQL nuevo; requirió repetir el primer build por un timeout TLS del registro. La evaluación pública de esa copia aprobó P01–P13.
