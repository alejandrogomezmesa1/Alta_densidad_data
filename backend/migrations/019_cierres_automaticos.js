// Cierres automáticos (caja diaria y mes contable a las 23:59, hora de Colombia).
// tareas_automaticas registra cada ejecución y sirve de candado: la clave (p. ej. «caja_2026-10-25»,
// «mes_2026-10») se inserta antes de ejecutar, así dos instancias del servidor nunca cierran dos veces.
export const nombre = 'Cierres automáticos: registro y candado de tareas';

export async function up(conn) {
    await conn.query(`CREATE TABLE IF NOT EXISTS tareas_automaticas (
        clave VARCHAR(60) PRIMARY KEY,
        tipo ENUM('caja','mes') NOT NULL,
        ejecutada_en DATETIME NOT NULL,
        ok TINYINT(1) NULL,
        detalle VARCHAR(500) NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    // Desde cuándo rigen: los meses que terminaron antes no se cierran solos de inmediato
    await conn.query("INSERT IGNORE INTO ajustes_aplicados (clave, detalle) VALUES ('automaticos_desde', 'Cierres automáticos activos desde esta fecha')");
}
