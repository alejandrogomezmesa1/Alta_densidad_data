// Módulo Configuraciones: valores ajustables desde el panel (DATA y tienda web).
// Cada clave se define en configuraciones.js; aquí solo se guarda el valor elegido.
export const nombre = 'Configuraciones del sistema';

export async function up(conn) {
    await conn.query(`CREATE TABLE IF NOT EXISTS configuraciones (
        clave VARCHAR(60) NOT NULL PRIMARY KEY,
        valor VARCHAR(500) NULL,
        actualizado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        usuario_id INT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
}
