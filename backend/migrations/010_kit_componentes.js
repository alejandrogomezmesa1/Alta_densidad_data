// Kits compuestos: un kit se arma con otros ítems del inventario (perfumes, minis, cremas,
// esencias…). Vender el kit descuenta sus componentes y sus existencias se calculan a partir
// de ellos, así un mini se puede vender suelto o dentro del kit sin descuadrar.
export const nombre = 'Componentes de los kits';

export async function up(conn) {
    await conn.query(`CREATE TABLE IF NOT EXISTS kit_componentes (
        kit_id INT NOT NULL,
        componente_id INT NOT NULL,
        cantidad DECIMAL(12,2) NOT NULL DEFAULT 1,
        PRIMARY KEY (kit_id, componente_id),
        CONSTRAINT fk_kit_componentes_kit FOREIGN KEY (kit_id) REFERENCES inventario(id),
        CONSTRAINT fk_kit_componentes_componente FOREIGN KEY (componente_id) REFERENCES inventario(id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
}
