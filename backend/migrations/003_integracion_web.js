// Ventas que llegan de la tienda web: origen, referencia única del pedido y
// descripción para líneas sin producto (p. ej. el envío).
export const nombre = 'Integración con la tienda web';

export async function up(conn, h) {
    if (!(await h.columnaExiste('ventas', 'origen'))) {
        await conn.query("ALTER TABLE ventas ADD COLUMN origen VARCHAR(20) NOT NULL DEFAULT 'pos'");
    }
    if (!(await h.columnaExiste('ventas', 'referencia_externa'))) {
        await conn.query('ALTER TABLE ventas ADD COLUMN referencia_externa VARCHAR(100) NULL');
    }
    if (!(await h.indiceExiste('ventas', 'uq_ventas_referencia_externa'))) {
        await conn.query('ALTER TABLE ventas ADD UNIQUE INDEX uq_ventas_referencia_externa (referencia_externa)');
    }
    if (!(await h.columnaExiste('venta_detalles', 'descripcion'))) {
        await conn.query('ALTER TABLE venta_detalles ADD COLUMN descripcion VARCHAR(255) NULL');
    }
}
