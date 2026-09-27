// Fase 2 · El inventario distingue tipo y unidad: los ítems actuales son producto
// terminado (unidades); se podrán agregar esencias, base y feromonas (ml) y envases.
export const nombre = 'Inventario con tipo, unidad y conversión de compra';

const COLUMNAS = {
    codigo: 'VARCHAR(40) NULL',
    tipo: "ENUM('terminado','esencia','base','feromona','envase','accesorio') NOT NULL DEFAULT 'terminado'",
    unidad: "ENUM('und','ml') NOT NULL DEFAULT 'und'",
    stock_minimo: 'DECIMAL(12,2) NOT NULL DEFAULT 0',
    activo: 'TINYINT(1) NOT NULL DEFAULT 1',
    // Cómo se compra y cuánto equivale en la unidad de inventario (1 kg de esencia = 1087 ml, etc.)
    unidad_compra: 'VARCHAR(20) NULL',
    factor_compra: 'DECIMAL(12,4) NOT NULL DEFAULT 1'
};

export async function up(conn, h) {
    for (const [col, def] of Object.entries(COLUMNAS)) {
        if (!(await h.columnaExiste('inventario', col))) {
            await conn.query(`ALTER TABLE inventario ADD COLUMN ${col} ${def}`);
        }
    }
    if (!(await h.indiceExiste('inventario', 'uq_inventario_codigo'))) {
        await conn.query('ALTER TABLE inventario ADD UNIQUE INDEX uq_inventario_codigo (codigo)');
    }
    // Los líquidos se miden con decimales (0,6 ml de feromonas)
    if ((await h.tipoColumna('inventario', 'stock')) !== 'decimal') {
        await conn.query('ALTER TABLE inventario MODIFY COLUMN stock DECIMAL(12,2) NOT NULL DEFAULT 0');
    }
    // Costo con 4 decimales: una esencia cuesta fracciones de peso por ml, y el costo
    // promedio se recalcula en cada compra (con 2 decimales se pierden centavos al revertir)
    const [[escala]] = await conn.query(
        "SELECT NUMERIC_SCALE AS s FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'inventario' AND COLUMN_NAME = 'precio_costo'"
    );
    if (Number(escala?.s) < 4) {
        await conn.query('ALTER TABLE inventario MODIFY COLUMN precio_costo DECIMAL(15,4) DEFAULT 0.0000');
    }
}
