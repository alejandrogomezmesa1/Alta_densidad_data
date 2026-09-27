// Fase 2 · Categorías de gasto como lista cerrada (hoy es texto libre y está vacío).
export const nombre = 'Categorías de gasto';

const BASE = ['Arriendo', 'Servicios públicos', 'Nómina', 'Publicidad', 'Transporte y envíos', 'Mantenimiento', 'Impuestos', 'Otros'];

export async function up(conn, h) {
    await conn.query(`
        CREATE TABLE IF NOT EXISTS categorias_gasto (
            id INT AUTO_INCREMENT PRIMARY KEY,
            nombre VARCHAR(60) NOT NULL UNIQUE,
            activo TINYINT(1) NOT NULL DEFAULT 1
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    for (const nombre of BASE) await conn.query('INSERT IGNORE INTO categorias_gasto (nombre) VALUES (?)', [nombre]);
    await conn.query(`
        INSERT IGNORE INTO categorias_gasto (nombre)
        SELECT DISTINCT TRIM(categoria) FROM gastos WHERE categoria IS NOT NULL AND TRIM(categoria) <> ''
    `);
    if (!(await h.columnaExiste('gastos', 'categoria_id'))) {
        await conn.query('ALTER TABLE gastos ADD COLUMN categoria_id INT NULL, ADD CONSTRAINT fk_gastos_categoria FOREIGN KEY (categoria_id) REFERENCES categorias_gasto(id)');
    }
    await conn.query('UPDATE gastos g JOIN categorias_gasto c ON c.nombre = TRIM(g.categoria) SET g.categoria_id = c.id WHERE g.categoria_id IS NULL');
    await conn.query("UPDATE gastos SET categoria_id = (SELECT id FROM categorias_gasto WHERE nombre = 'Otros') WHERE categoria_id IS NULL");
}
