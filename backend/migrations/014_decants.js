// Decants (10 ml): una línea de negocio propia que se arma con la receta de decant.
//   · recetas.ambito 'decant': qué lleva un decant (la esencia que elige el cliente, el envase de
//     decant que elige y los insumos fijos: alcohol, fijador…). Sin feromonas (decisión del 18-10).
//   · Envases de decant: ítems de inventario tipo envase con categoría «Decants» (atomizador de
//     bolsillo y vial de vidrio). Stock y costo los carga el usuario.
//   · venta_consumos: lo que una venta descontó por receta (un decant no es un ítem de inventario).
//     Al anular la venta se devuelve exactamente eso.
export const nombre = 'Decants: receta, envases y consumos por venta';

export const CATEGORIA_DECANTS = 'Decants';
export const ML_DECANT = 10;
const ENVASES = ['Decant atomizador de bolsillo 10 ml', 'Decant vial de vidrio 10 ml'];

export async function up(conn, h) {
    const [[col]] = await conn.query(
        "SELECT COLUMN_TYPE AS t FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'recetas' AND COLUMN_NAME = 'ambito'");
    if (col && !String(col.t).includes("'decant'")) {
        await conn.query("ALTER TABLE recetas MODIFY COLUMN ambito ENUM('tamano','pedido','decant') NOT NULL");
    }
    const [[{ n }]] = await conn.query("SELECT COUNT(*) n FROM recetas WHERE ambito = 'decant'");
    if (!n) {
        await conn.query("INSERT INTO recetas (ambito, ml, rol, cantidad, orden) VALUES ('decant', ?, 'esencia', 0, 0), ('decant', ?, 'envase', 1, 1)", [ML_DECANT, ML_DECANT]);
    }

    for (const nombreEnvase of ENVASES) {
        const [existe] = await conn.query('SELECT id FROM inventario WHERE nombre = ?', [nombreEnvase]);
        if (!existe.length) {
            await conn.query("INSERT INTO inventario (nombre, categoria, precio, precio_costo, stock, tipo, unidad) VALUES (?, ?, 0, 0, 0, 'envase', 'und')",
                [nombreEnvase, CATEGORIA_DECANTS]);
        }
    }

    if (!(await h.tablaExiste('venta_consumos'))) {
        await conn.query(`CREATE TABLE venta_consumos (
            id INT AUTO_INCREMENT PRIMARY KEY,
            venta_id INT NOT NULL,
            inventario_id INT NOT NULL,
            cantidad DECIMAL(12,3) NOT NULL,
            costo_unitario DECIMAL(15,4) NOT NULL DEFAULT 0,
            descripcion VARCHAR(255) NULL,
            KEY idx_venta_consumos_venta (venta_id),
            CONSTRAINT fk_venta_consumos_inventario FOREIGN KEY (inventario_id) REFERENCES inventario(id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    }
}
