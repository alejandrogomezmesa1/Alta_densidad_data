# Migraciones del esquema (DATA)

El esquema de la base se cambia **solo** con archivos de esta carpeta.
El servidor aplica los pendientes al arrancar y los registra en la tabla `schema_migrations`.

- Nombre: `NNN_descripcion.js` (número de 3 dígitos, consecutivo). Nunca se renombra ni se edita una migración ya aplicada: se crea una nueva.
- Exporta `export const nombre` y `export async function up(conn, h)` (módulo ESM). `h` trae `tablaExiste`, `columnaExiste`, `tipoColumna`, `indiceExiste`.
- Deben ser **idempotentes** (comprobar antes de crear o alterar): MySQL no revierte cambios de estructura si algo falla a mitad.
- Sin datos de ejemplo ni cargas de datos de negocio: solo estructura y ajustes de datos necesarios para la estructura.

Comandos (desde `backend/`):

```bash
npm run migrate          # aplica pendientes
npm run migrate:status   # lista aplicadas y pendientes
```

`schema.sql` y `migrate.sql` quedan solo como referencia histórica: no se ejecutan.
