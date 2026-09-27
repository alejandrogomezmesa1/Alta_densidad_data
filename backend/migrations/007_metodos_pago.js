// Fase 2 · Métodos de pago como lista cerrada. `es_efectivo` permite que la caja
// cuente solo el dinero físico. El texto de pagos.metodo se conserva por compatibilidad.
export const nombre = 'Métodos de pago';

const BASE = [
    ['Efectivo', 1, 1], ['Transferencia', 0, 2], ['Nequi', 0, 3], ['Daviplata', 0, 4],
    ['Tarjeta', 0, 5], ['Mercado Pago (Web)', 0, 6]
];

export async function up(conn, h) {
    await conn.query(`
        CREATE TABLE IF NOT EXISTS metodos_pago (
            id INT AUTO_INCREMENT PRIMARY KEY,
            nombre VARCHAR(50) NOT NULL UNIQUE,
            es_efectivo TINYINT(1) NOT NULL DEFAULT 0,
            activo TINYINT(1) NOT NULL DEFAULT 1,
            orden INT NOT NULL DEFAULT 99
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    for (const [nombre, efectivo, orden] of BASE) {
        await conn.query('INSERT IGNORE INTO metodos_pago (nombre, es_efectivo, orden) VALUES (?, ?, ?)', [nombre, efectivo, orden]);
    }
    // Cualquier método escrito a mano en el pasado se conserva como no efectivo
    await conn.query(`
        INSERT IGNORE INTO metodos_pago (nombre, es_efectivo)
        SELECT DISTINCT TRIM(metodo), 0 FROM pagos WHERE metodo IS NOT NULL AND TRIM(metodo) <> ''
    `);
    if (!(await h.columnaExiste('pagos', 'metodo_pago_id'))) {
        await conn.query('ALTER TABLE pagos ADD COLUMN metodo_pago_id INT NULL, ADD CONSTRAINT fk_pagos_metodo FOREIGN KEY (metodo_pago_id) REFERENCES metodos_pago(id)');
    }
    await conn.query(`
        UPDATE pagos p JOIN metodos_pago m ON m.nombre = TRIM(p.metodo)
        SET p.metodo_pago_id = m.id WHERE p.metodo_pago_id IS NULL
    `);
    await conn.query("UPDATE pagos SET metodo_pago_id = (SELECT id FROM metodos_pago WHERE nombre = 'Efectivo') WHERE metodo_pago_id IS NULL");
}
