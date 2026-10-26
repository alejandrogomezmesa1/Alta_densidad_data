// Tarjetas de regalo (solo tienda física).
//   · Se venden por un valor y valen 6 meses desde la fecha de venta. El dinero entra a la caja al
//     venderla (libro de dinero, origen «tarjeta»), pero no es venta: es un anticipo del cliente.
//   · Se redimen UNA sola vez como pago de una venta (método «Tarjeta de regalo», que no mueve la caja
//     porque ese dinero ya entró). Si la compra vale más, el resto se paga con otro método; si vale
//     menos, lo que sobra no se devuelve y cuenta como ingreso, igual que una tarjeta que se vence.
//   · Anular la venta en que se usó la deja otra vez activa (con su vencimiento original).
export const nombre = 'Tarjetas de regalo: emisión, redención única y vencimiento a 6 meses';

export async function up(conn, h) {
    await conn.query(`CREATE TABLE IF NOT EXISTS tarjetas_regalo (
        id INT AUTO_INCREMENT PRIMARY KEY,
        codigo VARCHAR(20) NOT NULL UNIQUE,
        valor DECIMAL(15,2) NOT NULL,
        fecha DATE NOT NULL,
        vence DATE NOT NULL,
        comprador VARCHAR(120) NULL,
        para VARCHAR(120) NULL,
        notas VARCHAR(255) NULL,
        metodo_pago_id INT NULL,
        estado ENUM('activa','redimida') NOT NULL DEFAULT 'activa',
        venta_id INT NULL,
        redimida_en DATETIME NULL,
        aplicado DECIMAL(15,2) NULL,
        excedente DECIMAL(15,2) NULL,
        anulada_en DATETIME NULL,
        anulada_por INT NULL,
        motivo_anulacion VARCHAR(255) NULL,
        creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        creado_por INT NULL,
        KEY idx_tarjetas_venta (venta_id),
        KEY idx_tarjetas_vence (vence),
        CONSTRAINT fk_tarjetas_metodo FOREIGN KEY (metodo_pago_id) REFERENCES metodos_pago(id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

    // El libro de dinero acepta movimientos que vienen de una tarjeta (su venta o su anulación)
    const [[col]] = await conn.query(`SELECT COLUMN_TYPE t FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'movimientos_caja' AND COLUMN_NAME = 'origen_tipo'`);
    if (col && !String(col.t).includes("'tarjeta'")) {
        await conn.query("ALTER TABLE movimientos_caja MODIFY COLUMN origen_tipo ENUM('pago','gasto','compra','tarjeta') NULL");
    }

    // Un método de pago puede no mover la caja (la tarjeta de regalo: su dinero entró al venderla)
    if (!(await h.columnaExiste('metodos_pago', 'mueve_caja'))) {
        await conn.query('ALTER TABLE metodos_pago ADD COLUMN mueve_caja TINYINT(1) NOT NULL DEFAULT 1');
    }
    await conn.query("INSERT IGNORE INTO metodos_pago (nombre, es_efectivo, orden, mueve_caja) VALUES ('Tarjeta de regalo', 0, 7, 0)");
    await conn.query("UPDATE metodos_pago SET mueve_caja = 0, es_efectivo = 0 WHERE nombre = 'Tarjeta de regalo'");
}
