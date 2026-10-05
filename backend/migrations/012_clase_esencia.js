// Clase de cada esencia: árabe o tradicional (diseñador). Define el precio en "Crea tu perfume" y
// qué esencias admite un kit preparado. NULL = sin clasificar.
export const nombre = 'Clase de esencia (árabe / tradicional)';

export async function up(conn) {
    const [cols] = await conn.query("SHOW COLUMNS FROM inventario LIKE 'clase_esencia'");
    if (!cols.length) {
        await conn.query("ALTER TABLE inventario ADD COLUMN clase_esencia ENUM('arabe','tradicional') NULL AFTER tipo");
    }
}
