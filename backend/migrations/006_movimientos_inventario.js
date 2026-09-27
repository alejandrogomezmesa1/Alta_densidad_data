// Fase 2 · Libro de movimientos: todo cambio de stock queda registrado con su origen.
// El saldo inicial es el stock que había al activar el libro.
export const nombre = 'Libro de movimientos de inventario';

export async function up(conn, h) {
    await conn.query(`
        CREATE TABLE IF NOT EXISTS movimientos_inventario (
            id INT AUTO_INCREMENT PRIMARY KEY,
            inventario_id INT NOT NULL,
            tipo ENUM('inicial','compra','anulacion_compra','venta','anulacion_venta','ajuste','consumo_produccion','salida_produccion') NOT NULL,
            cantidad DECIMAL(12,2) NOT NULL,
            stock_resultante DECIMAL(12,2) NOT NULL,
            costo_unitario DECIMAL(15,4) NULL,
            origen_tipo VARCHAR(30) NULL,
            origen_id INT NULL,
            motivo VARCHAR(255) NULL,
            usuario_id INT NULL,
            creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_mov_inventario (inventario_id, id),
            INDEX idx_mov_origen (origen_tipo, origen_id),
            CONSTRAINT fk_mov_inventario FOREIGN KEY (inventario_id) REFERENCES inventario(id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    // Saldo inicial solo si el libro está vacío (la migración se aplica una vez, pero por seguridad)
    const [[{ n }]] = await conn.query('SELECT COUNT(*) AS n FROM movimientos_inventario');
    if (Number(n) === 0) {
        await conn.query(`
            INSERT INTO movimientos_inventario (inventario_id, tipo, cantidad, stock_resultante, costo_unitario, motivo)
            SELECT id, 'inicial', stock, stock, precio_costo, 'Saldo al activar el libro de movimientos'
            FROM inventario WHERE stock <> 0
        `);
    }
}
