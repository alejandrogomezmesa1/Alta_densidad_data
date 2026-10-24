// Fase B · Caja con sesiones y libro de dinero; anular en vez de borrar.
//   · sesiones_caja: siempre hay exactamente una abierta (abierta = 1 es UNIQUE; las cerradas quedan
//     en NULL). Cerrar calcula en el servidor el efectivo esperado, guarda el contado y la diferencia
//     y abre la siguiente con el efectivo que queda en el cajón.
//   · movimientos_caja: todo peso que entra o sale (cobros, gastos, compras, ingresos y retiros) con
//     su método y su sesión. Nunca se edita ni se borra: una corrección o anulación es otra fila del
//     mismo origen en la sesión abierta, así lo de una sesión cerrada nunca cambia.
//   · ventas, pagos, compras y gastos se anulan (anulada_en, anulada_por, motivo_anulacion).
//   · Gastos y compras registran con qué se pagaron (metodo_pago_id; lo anterior queda en efectivo).
//   · Regularización: todo el dinero anterior queda en una sesión cerrada «de regularización» (incluye
//     los pagos que nunca entraron a un cierre, decisión del 23-10). cierres_caja queda como historia.
export const nombre = 'Caja con sesiones, libro de dinero y anulaciones';

const ANULACION = {
    anulada_en: 'DATETIME NULL',
    anulada_por: 'INT NULL',
    motivo_anulacion: 'VARCHAR(255) NULL'
};

export async function up(conn, h) {
    await conn.query(`CREATE TABLE IF NOT EXISTS sesiones_caja (
        id INT AUTO_INCREMENT PRIMARY KEY,
        tipo ENUM('normal','regularizacion') NOT NULL DEFAULT 'normal',
        abierta TINYINT(1) NULL DEFAULT 1,
        abierta_en DATETIME NOT NULL,
        abierta_por INT NULL,
        efectivo_inicial DECIMAL(15,2) NOT NULL DEFAULT 0,
        cerrada_en DATETIME NULL,
        cerrada_por INT NULL,
        efectivo_esperado DECIMAL(15,2) NULL,
        efectivo_contado DECIMAL(15,2) NULL,
        diferencia DECIMAL(15,2) NULL,
        efectivo_retirado DECIMAL(15,2) NULL,
        resumen MEDIUMTEXT NULL,
        notas TEXT NULL,
        UNIQUE KEY uq_sesion_abierta (abierta)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

    await conn.query(`CREATE TABLE IF NOT EXISTS movimientos_caja (
        id INT AUTO_INCREMENT PRIMARY KEY,
        sesion_id INT NOT NULL,
        tipo ENUM('cobro','gasto','compra','ingreso','retiro') NOT NULL,
        monto DECIMAL(15,2) NOT NULL,
        metodo_pago_id INT NULL,
        es_efectivo TINYINT(1) NOT NULL,
        origen_tipo ENUM('pago','gasto','compra') NULL,
        origen_id INT NULL,
        descripcion VARCHAR(255) NULL,
        usuario_id INT NULL,
        creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        KEY idx_movcaja_sesion (sesion_id, id),
        KEY idx_movcaja_origen (origen_tipo, origen_id),
        CONSTRAINT fk_movcaja_sesion FOREIGN KEY (sesion_id) REFERENCES sesiones_caja(id),
        CONSTRAINT fk_movcaja_metodo FOREIGN KEY (metodo_pago_id) REFERENCES metodos_pago(id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

    for (const tabla of ['ventas', 'pagos', 'compras', 'gastos']) {
        for (const [col, def] of Object.entries(ANULACION)) {
            if (!(await h.columnaExiste(tabla, col))) await conn.query(`ALTER TABLE ${tabla} ADD COLUMN ${col} ${def}`);
        }
    }
    const [[efectivo]] = await conn.query("SELECT id FROM metodos_pago WHERE nombre = 'Efectivo'");
    for (const tabla of ['compras', 'gastos']) {
        if (!(await h.columnaExiste(tabla, 'metodo_pago_id'))) {
            await conn.query(`ALTER TABLE ${tabla} ADD COLUMN metodo_pago_id INT NULL, ADD CONSTRAINT fk_${tabla}_metodo FOREIGN KEY (metodo_pago_id) REFERENCES metodos_pago(id)`);
            await conn.query(`UPDATE ${tabla} SET metodo_pago_id = ? WHERE metodo_pago_id IS NULL`, [efectivo.id]);
        }
    }

    // Regularización (una sola vez): todo el dinero anterior en una sesión cerrada, y la primera sesión abierta
    const [[{ n }]] = await conn.query('SELECT COUNT(*) AS n FROM sesiones_caja');
    if (Number(n) > 0) return;
    // Los datos van en una transacción: si algo falla, no queda una regularización a medias
    await conn.beginTransaction();
    try {
        await regularizar(conn);
        await conn.commit();
    } catch (error) {
        await conn.rollback();
        throw error;
    }
}

async function regularizar(conn) {
    const [[rango]] = await conn.query(`SELECT LEAST(
        COALESCE((SELECT MIN(fecha) FROM pagos), NOW()), COALESCE((SELECT MIN(fecha) FROM gastos), NOW()),
        COALESCE((SELECT MIN(fecha) FROM compras), NOW())) AS desde`);
    const [[{ cierres }]] = await conn.query('SELECT COUNT(*) AS cierres FROM cierres_caja');
    const [reg] = await conn.query(
        `INSERT INTO sesiones_caja (tipo, abierta, abierta_en, efectivo_inicial, cerrada_en, notas)
         VALUES ('regularizacion', NULL, ?, 0, NOW(), ?)`,
        [rango.desde, `Regularización: todo el dinero registrado antes de las sesiones de caja (pagos, gastos y compras), incluidos los pagos que nunca entraron a un cierre. Los ${cierres} cierres del sistema anterior siguen en su historial. Gastos y compras anteriores se toman como pagados en efectivo.`]);
    const sesion = reg.insertId;
    await conn.query(`INSERT INTO movimientos_caja (sesion_id, tipo, monto, metodo_pago_id, es_efectivo, origen_tipo, origen_id, descripcion, creado_en)
        SELECT ?, 'cobro', p.monto, p.metodo_pago_id, COALESCE(m.es_efectivo, 1), 'pago', p.id, CONCAT('Pago de la venta #', p.venta_id), p.fecha
        FROM pagos p LEFT JOIN metodos_pago m ON m.id = p.metodo_pago_id ORDER BY p.id`, [sesion]);
    await conn.query(`INSERT INTO movimientos_caja (sesion_id, tipo, monto, metodo_pago_id, es_efectivo, origen_tipo, origen_id, descripcion, creado_en)
        SELECT ?, 'gasto', -g.monto, g.metodo_pago_id, 1, 'gasto', g.id, LEFT(CONCAT('Gasto: ', g.descripcion), 255), g.fecha FROM gastos g ORDER BY g.id`, [sesion]);
    await conn.query(`INSERT INTO movimientos_caja (sesion_id, tipo, monto, metodo_pago_id, es_efectivo, origen_tipo, origen_id, descripcion, creado_en)
        SELECT ?, 'compra', -c.monto, c.metodo_pago_id, 1, 'compra', c.id, LEFT(CONCAT('Compra: ', COALESCE(i.nombre, CONCAT('#', c.inventario_id))), 255), c.fecha
        FROM compras c LEFT JOIN inventario i ON i.id = c.inventario_id ORDER BY c.id`, [sesion]);
    const [[t]] = await conn.query('SELECT COALESCE(SUM(CASE WHEN es_efectivo = 1 THEN monto END), 0) AS efectivo FROM movimientos_caja WHERE sesion_id = ?', [sesion]);
    await conn.query('UPDATE sesiones_caja SET efectivo_esperado = ? WHERE id = ?', [t.efectivo, sesion]);
    // Primera sesión real: arranca en 0; el efectivo que hay en el cajón se registra como ingreso
    await conn.query("INSERT INTO sesiones_caja (tipo, abierta, abierta_en, efectivo_inicial) VALUES ('normal', 1, NOW(), 0)");
}
