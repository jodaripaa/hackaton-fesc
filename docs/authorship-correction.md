# Corrección de autoría

El [registro de normalización posterior](evidence/history-cleanup.json) relaciona los identificadores de esta etapa con el historial técnico final. Se agruparon los commits de solo documentación y se normalizaron los títulos; se conservaron los cuatro autores de Andres. Los identificadores de la tabla siguiente corresponden a la etapa de corrección anterior a esa normalización.

El 15 de octubre de 2026 el usuario aclaró que las contribuciones de pruebas, rendimiento y seguridad pertenecían a Andres Rodriguez y habían quedado registradas con la cuenta de Josue. A petición del usuario se corrigió la autoría de estos cuatro commits a Andres Rodriguez, con el correo art_fr_gallego@fesc.edu.co proporcionado para su cuenta.

| Cambio | Commit original | Commit corregido |
|---|---|---|
| Seguridad y auditoría SQL | ec9cf61 | ebf9ce6 |
| Pruebas del contrato, carga y secretos | cd71993 | 3e19070 |
| Rendimiento de consultas de estado de lotes | 40ee113 | 1eef656 |
| Prueba positiva de Sur con fixture sintético | 71394a6 | 0154d67 |

La corrección conservó los árboles de archivos, mensajes, fechas y datos del committer originales. Cambió únicamente la identidad del autor de los cuatro commits y los enlaces a sus descendientes. Se comprobó que el árbol completo antes y después fuera idéntico. La publicación utilizó una condición sobre el HEAD remoto esperado para proteger cambios concurrentes.

El [registro de la corrección](evidence/authorship-correction.json) conserva los identificadores completos y el resultado de la comparación. Existe un respaldo local del historial anterior en la rama codex/backup-autoria-20261015 y un bundle verificado dentro de test-results, excluido de Git.

Los reportes de pruebas y carga anteriores conservan los identificadores de las ejecuciones originales; la corrección no representa una nueva medición. La revisión personal del código por ambos integrantes sigue pendiente de confirmación.

El usuario informó una prórroga del cierre hasta el 15 de octubre de 2026 a las 15:30, hora de Colombia. El equipo debe contrastar esa prórroga con la plataforma del evento y registrar allí repositorio y video.
