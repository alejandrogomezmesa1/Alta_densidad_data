// Recetas de perfume preparado y empaque: qué insumos lleva cada tamaño (esencia elegida, envase
// elegido, alcohol, fijador, feromonas…) y qué empaque lleva cada pedido. Todo editable desde el
// panel; con esto se calcula el costo real y se descuenta inventario al vender.
//   ambito 'tamano' + ml: una línea de la receta de ese tamaño
//   ambito 'pedido': una línea del empaque de cada pedido
//   rol 'esencia' / 'envase': la esencia o el envase que elija el cliente (inventario_id NULL)
//   rol 'insumo': un ítem fijo del inventario
export const nombre = 'Recetas de preparado y empaque';

export async function up(conn) {
    await conn.query(`CREATE TABLE IF NOT EXISTS recetas (
        id INT AUTO_INCREMENT PRIMARY KEY,
        ambito ENUM('tamano','pedido') NOT NULL,
        ml INT NULL,
        rol ENUM('esencia','envase','insumo') NOT NULL DEFAULT 'insumo',
        inventario_id INT NULL,
        cantidad DECIMAL(12,3) NOT NULL DEFAULT 0,
        orden INT NOT NULL DEFAULT 0,
        KEY idx_recetas_ambito (ambito, ml),
        CONSTRAINT fk_recetas_inventario FOREIGN KEY (inventario_id) REFERENCES inventario(id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    // Tamaños de partida: la esencia y el envase elegidos (las cantidades se ajustan en el panel)
    const [[{ n }]] = await conn.query('SELECT COUNT(*) n FROM recetas');
    if (!n) {
        for (const ml of [30, 50, 60, 100]) {
            await conn.query("INSERT INTO recetas (ambito, ml, rol, cantidad, orden) VALUES ('tamano', ?, 'esencia', 0, 0), ('tamano', ?, 'envase', 1, 1)", [ml, ml]);
        }
    }
}
