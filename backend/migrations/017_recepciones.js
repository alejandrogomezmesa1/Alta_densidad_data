// Fase C/D · Recepciones de mercancía: una factura de proveedor con varias líneas. Cada línea sigue
// siendo una compra (con su entrada al inventario y su salida de dinero); la recepción las agrupa con
// el proveedor, el número de factura, la fecha y el método con que se pagó.
export const nombre = 'Recepciones de mercancía (factura de proveedor con varias líneas)';

export async function up(conn, h) {
    await conn.query(`CREATE TABLE IF NOT EXISTS recepciones (
        id INT AUTO_INCREMENT PRIMARY KEY,
        proveedor_id INT NULL,
        factura VARCHAR(60) NULL,
        fecha DATETIME NOT NULL,
        metodo_pago_id INT NULL,
        notas VARCHAR(500) NULL,
        usuario_id INT NULL,
        creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT fk_recepciones_proveedor FOREIGN KEY (proveedor_id) REFERENCES proveedores(id),
        CONSTRAINT fk_recepciones_metodo FOREIGN KEY (metodo_pago_id) REFERENCES metodos_pago(id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    if (!(await h.columnaExiste('compras', 'recepcion_id'))) {
        await conn.query('ALTER TABLE compras ADD COLUMN recepcion_id INT NULL, ADD CONSTRAINT fk_compras_recepcion FOREIGN KEY (recepcion_id) REFERENCES recepciones(id)');
    }
}
