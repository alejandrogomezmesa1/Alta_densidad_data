// Fase A · Blindaje: lo que el servidor necesita para no perder datos.
//   · compras y venta_detalles con cantidad DECIMAL: lo que se mide en ml (esencias) entra y sale
//     con decimales; antes 250,5 ml se guardaban como 251 y al anular se perdía la diferencia.
//   · Tipo de movimiento 'cambio_costo': un cambio manual del costo queda en el kárdex (cantidad 0).
//   · venta_consumos.venta_detalle_id: lo que consumió cada línea (kits); al anular se devuelve
//     exactamente eso aunque la composición del kit haya cambiado. Y llave foránea a ventas.
export const nombre = 'Blindaje: cantidades decimales, cambio de costo y consumos por línea';

export async function up(conn, h) {
    for (const tabla of ['compras', 'venta_detalles']) {
        if ((await h.tipoColumna(tabla, 'cantidad')) !== 'decimal') {
            await conn.query(`ALTER TABLE ${tabla} MODIFY COLUMN cantidad DECIMAL(12,2) NOT NULL`);
        }
    }

    const [[col]] = await conn.query(
        "SELECT COLUMN_TYPE AS t FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'movimientos_inventario' AND COLUMN_NAME = 'tipo'");
    if (col && !String(col.t).includes("'cambio_costo'")) {
        await conn.query(`ALTER TABLE movimientos_inventario MODIFY COLUMN tipo
            ENUM('inicial','compra','anulacion_compra','venta','anulacion_venta','ajuste','consumo_produccion','salida_produccion','cambio_costo') NOT NULL`);
    }

    if (!(await h.columnaExiste('venta_consumos', 'venta_detalle_id'))) {
        await conn.query('ALTER TABLE venta_consumos ADD COLUMN venta_detalle_id INT NULL, ADD INDEX idx_venta_consumos_detalle (venta_detalle_id)');
    }
    if (!(await h.indiceExiste('venta_consumos', 'fk_venta_consumos_venta'))) {
        // Consumos de ventas que ya no existen no se pueden devolver a nadie: se descartan
        await conn.query('DELETE vc FROM venta_consumos vc LEFT JOIN ventas v ON v.id = vc.venta_id WHERE v.id IS NULL');
        await conn.query('ALTER TABLE venta_consumos ADD CONSTRAINT fk_venta_consumos_venta FOREIGN KEY (venta_id) REFERENCES ventas(id) ON DELETE CASCADE');
    }
}
