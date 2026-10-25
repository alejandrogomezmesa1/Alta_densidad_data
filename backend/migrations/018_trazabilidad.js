// Fase E · Trazabilidad contable.
//   1. Hora única (Colombia): lo que puso la base con NOW()/CURRENT_TIMESTAMP quedó en la hora del
//      servidor (UTC en Railway) mientras los documentos van en hora de Colombia. Se corre una sola
//      vez (marca en ajustes_aplicados) a la hora de Colombia; desde ahora cada conexión usa -05:00.
//   2. creado_en / creado_por en ventas, pagos, compras y gastos: cuándo y quién registró el documento
//      (la «fecha» es la del hecho; puede ser anterior).
//   3. movimientos_inventario.costo_promedio: el costo promedio tras cada movimiento, para valorizar
//      el inventario a cualquier fecha.
//   4. auditoria: bitácora de todo cambio (quién, cuándo, antes y después) encadenada con SHA-256
//      (auditoria_cadena guarda el último eslabón): si alguien altera un registro, la cadena no cuadra.
//   5. periodos_contables: meses cerrados con su foto (resumen) y su huella.
//   6. Disparadores que impiden modificar o borrar la bitácora y los libros de inventario y dinero.
export const nombre = 'Trazabilidad contable: hora única, auditoría encadenada, periodos y libros inmutables';

const DOCUMENTOS = ['ventas', 'pagos', 'compras', 'gastos'];
const INMUTABLES = ['auditoria', 'movimientos_inventario', 'movimientos_caja'];

export async function up(conn, h) {
    // ── 1. Hora única ──
    await conn.query(`CREATE TABLE IF NOT EXISTS ajustes_aplicados (
        clave VARCHAR(60) PRIMARY KEY, detalle VARCHAR(255) NULL, aplicado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    const [[ya]] = await conn.query("SELECT COUNT(*) AS n FROM ajustes_aplicados WHERE clave = 'zona_horaria_018'");
    if (!Number(ya.n)) {
        // Desfase con el que se escribió hasta hoy: el de la zona global del servidor
        await conn.query('SET time_zone = @@global.time_zone');
        const [[{ servidor }]] = await conn.query('SELECT TIMESTAMPDIFF(MINUTE, UTC_TIMESTAMP(), NOW()) AS servidor');
        await conn.query("SET time_zone = '-05:00'");
        const corrimiento = -300 - Math.round(Number(servidor) / 15) * 15; // minutos a sumar para llevarlo a Colombia
        await conn.beginTransaction();
        try {
            if (corrimiento) {
                const mover = async (tabla, columna, donde = '1 = 1') => {
                    if (await h.columnaExiste(tabla, columna)) {
                        await conn.query(`UPDATE ${tabla} SET ${columna} = ${columna} + INTERVAL ? MINUTE WHERE ${columna} IS NOT NULL AND ${donde}`, [corrimiento]);
                    }
                };
                await mover('movimientos_inventario', 'creado_en');
                // La regularización de caja (migración 016) copió la fecha de cada documento: ya está en hora de Colombia
                await mover('movimientos_caja', 'creado_en', "sesion_id NOT IN (SELECT id FROM (SELECT id FROM sesiones_caja WHERE tipo = 'regularizacion') r)");
                await mover('sesiones_caja', 'abierta_en', "tipo = 'normal'");
                await mover('sesiones_caja', 'cerrada_en');
                for (const t of DOCUMENTOS) await mover(t, 'anulada_en');
                await mover('recepciones', 'creado_en');
                await mover('inventario', 'fecha_creacion');
                await mover('proveedores', 'fecha_creacion');
                await mover('usuarios', 'fecha_creacion');
                await mover('configuraciones', 'actualizado_en');
                await mover('cierres_caja', 'fecha_creacion');
            }
            await conn.query("INSERT INTO ajustes_aplicados (clave, detalle) VALUES ('zona_horaria_018', ?)",
                [corrimiento ? `Fechas del servidor llevadas a hora de Colombia (${corrimiento} min)` : 'El servidor ya estaba en hora de Colombia']);
            await conn.commit();
        } catch (e) {
            await conn.rollback();
            throw e;
        }
    }

    // ── 2. Quién y cuándo registró cada documento ──
    for (const t of DOCUMENTOS) {
        if (!(await h.columnaExiste(t, 'creado_en'))) {
            await conn.query(`ALTER TABLE ${t} ADD COLUMN creado_en DATETIME NULL, ADD COLUMN creado_por INT NULL`);
            // Lo anterior no lo sabemos con exactitud: se toma la fecha del documento
            await conn.query(`UPDATE ${t} SET creado_en = fecha WHERE creado_en IS NULL`);
            await conn.query(`ALTER TABLE ${t} MODIFY COLUMN creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP`);
        }
    }

    // ── 3. Costo promedio tras cada movimiento ──
    if (!(await h.columnaExiste('movimientos_inventario', 'costo_promedio'))) {
        await conn.query('ALTER TABLE movimientos_inventario ADD COLUMN costo_promedio DECIMAL(15,4) NULL');
    }

    // ── 4. Bitácora encadenada ──
    await conn.query(`CREATE TABLE IF NOT EXISTS auditoria (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        creado_en DATETIME(3) NOT NULL,
        usuario_id INT NULL,
        usuario VARCHAR(120) NULL,
        accion VARCHAR(30) NOT NULL,
        entidad VARCHAR(40) NOT NULL,
        entidad_id VARCHAR(40) NULL,
        resumen VARCHAR(255) NULL,
        antes MEDIUMTEXT NULL,      -- JSON tal como se firmó (MySQL reordena el tipo JSON y la huella no cuadraría)
        despues MEDIUMTEXT NULL,
        hash_anterior CHAR(64) NOT NULL,
        hash CHAR(64) NOT NULL,
        KEY idx_auditoria_entidad (entidad, entidad_id),
        KEY idx_auditoria_fecha (creado_en)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    await conn.query(`CREATE TABLE IF NOT EXISTS auditoria_cadena (
        id TINYINT PRIMARY KEY, ultimo_id BIGINT NOT NULL DEFAULT 0, ultimo_hash CHAR(64) NOT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    await conn.query("INSERT IGNORE INTO auditoria_cadena (id, ultimo_id, ultimo_hash) VALUES (1, 0, REPEAT('0', 64))");

    // ── 5. Periodos contables (meses cerrados) ──
    await conn.query(`CREATE TABLE IF NOT EXISTS periodos_contables (
        periodo CHAR(7) PRIMARY KEY,
        desde DATE NOT NULL,
        hasta DATE NOT NULL,
        estado ENUM('cerrado','reabierto') NOT NULL DEFAULT 'cerrado',
        cerrado_en DATETIME NOT NULL,
        cerrado_por INT NULL,
        resumen MEDIUMTEXT NOT NULL,
        hash CHAR(64) NOT NULL,
        notas VARCHAR(500) NULL,
        reabierto_en DATETIME NULL,
        reabierto_por INT NULL,
        motivo_reapertura VARCHAR(255) NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

    // ── 6. Libros inmutables en la base (si el servidor no permite crear disparadores, la aplicación
    //       igual nunca los modifica; Salud contable avisa que falta esta protección) ──
    for (const t of INMUTABLES) {
        for (const [cuando, verbo] of [['UPDATE', 'modificar'], ['DELETE', 'borrar']]) {
            const nombreTrigger = `trg_${t}_no_${cuando.toLowerCase()}`;
            const [[existe]] = await conn.query('SELECT COUNT(*) AS n FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA = DATABASE() AND TRIGGER_NAME = ?', [nombreTrigger]);
            if (Number(existe.n)) continue;
            try {
                await conn.query(`CREATE TRIGGER ${nombreTrigger} BEFORE ${cuando} ON ${t} FOR EACH ROW
                    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Registro contable inmutable: no se puede ${verbo} (${t})'`);
            } catch (e) {
                console.warn(`[MIGRACIONES] 018: no se pudo crear ${nombreTrigger}: ${e.message}`);
            }
        }
    }
}
