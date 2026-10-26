// ============================================================
// Caja: sesiones y libro de dinero (migración 016)
// ------------------------------------------------------------
// Siempre hay exactamente una sesión abierta. Todo peso que entra o sale queda en movimientos_caja
// con su método y la sesión abierta en ese momento. Las filas nunca se editan ni se borran: si un
// documento cambia o se anula, sincronizarDinero agrega la diferencia en la sesión abierta, así el
// libro de cada documento suma siempre su monto vigente y lo de una sesión cerrada no cambia.
// Cerrar la caja lo calcula el servidor: efectivo esperado, contado, diferencia y retiro.
// ============================================================
import { esquema } from './estado.js';

const err = (status, mensaje) => Object.assign(new Error(mensaje), { status });
const r2 = (n) => Math.round(Number(n) * 100) / 100;

/** La sesión abierta. Con bloquear: FOR UPDATE (cerrar); si no, FOR SHARE (un cierre espera a los movimientos en curso). */
export async function sesionAbierta(conn, { bloquear = false } = {}) {
    const leer = async () => (await conn.query(`SELECT * FROM sesiones_caja WHERE abierta = 1 ${bloquear ? 'FOR UPDATE' : 'FOR SHARE'}`))[0][0];
    let sesion = await leer();
    if (!sesion) {
        // No debería pasar (cerrar abre la siguiente); si pasa, se abre una en 0
        await conn.query("INSERT IGNORE INTO sesiones_caja (tipo, abierta, abierta_en, efectivo_inicial) VALUES ('normal', 1, NOW(), 0)");
        sesion = await leer();
    }
    return sesion;
}

async function esEfectivo(conn, metodoPagoId) {
    if (!metodoPagoId) return 1;
    const [[m]] = await conn.query('SELECT es_efectivo FROM metodos_pago WHERE id = ?', [metodoPagoId]);
    return m ? Number(m.es_efectivo) : 1;
}

const insertar = (conn, f) => conn.query(
    `INSERT INTO movimientos_caja (sesion_id, tipo, monto, metodo_pago_id, es_efectivo, origen_tipo, origen_id, descripcion, usuario_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [f.sesionId, f.tipo, f.monto, f.metodoPagoId || null, f.esEfectivo, f.origenTipo || null, f.origenId || null,
        f.descripcion ? String(f.descripcion).substring(0, 255) : null, f.usuarioId || null]);

/**
 * Deja el libro de un documento en su monto vigente: monto con signo (+ entra, − sale), 0 si se anuló.
 * Si cambió el método, se revierte lo del método anterior y se registra en el nuevo.
 * @param {{origenTipo:'pago'|'gasto'|'compra', origenId:number, tipo:'cobro'|'gasto'|'compra', monto:number, metodoPagoId:number|null, descripcion:string, usuarioId?:number}} d
 */
export async function sincronizarDinero(conn, d) {
    if (!esquema.caja) return;
    const sesion = await sesionAbierta(conn);
    const [rows] = await conn.query(
        `SELECT metodo_pago_id AS metodo, MAX(es_efectivo) AS efectivo, SUM(monto) AS total FROM movimientos_caja
         WHERE origen_tipo = ? AND origen_id = ? GROUP BY metodo_pago_id`, [d.origenTipo, d.origenId]);
    const base = { sesionId: sesion.id, tipo: d.tipo, origenTipo: d.origenTipo, origenId: d.origenId, usuarioId: d.usuarioId };
    const metodo = d.metodoPagoId || null;
    for (const r of rows) {
        if ((r.metodo || null) !== metodo && Math.abs(Number(r.total)) > 0.005) {
            await insertar(conn, { ...base, monto: -r2(r.total), metodoPagoId: r.metodo, esEfectivo: Number(r.efectivo), descripcion: `Cambio de método: ${d.descripcion}` });
        }
    }
    const previo = rows.find((r) => (r.metodo || null) === metodo);
    const diferencia = r2(Number(d.monto) - (previo ? Number(previo.total) : 0));
    if (Math.abs(diferencia) > 0.005) {
        await insertar(conn, { ...base, monto: diferencia, metodoPagoId: metodo, esEfectivo: await esEfectivo(conn, metodo),
            // Una anulación (monto 0) ya trae su propia descripción
            descripcion: rows.length && Number(d.monto) !== 0 ? `Corrección: ${d.descripcion}` : d.descripcion });
    }
}

// Ingreso o retiro de efectivo a mano (base del cajón, consignación, cambio…)
export async function movimientoManual(conn, { tipo, monto, motivo, usuarioId }) {
    if (!['ingreso', 'retiro'].includes(tipo)) throw err(400, 'El movimiento debe ser un ingreso o un retiro');
    const valor = r2(monto);
    if (!(valor > 0)) throw err(400, 'El monto debe ser mayor que 0');
    if (String(motivo || '').trim().length < 3) throw err(400, 'Escribe el motivo del movimiento');
    const sesion = await sesionAbierta(conn);
    const [[efectivo]] = await conn.query("SELECT id FROM metodos_pago WHERE es_efectivo = 1 ORDER BY orden, id LIMIT 1");
    await insertar(conn, { sesionId: sesion.id, tipo, monto: tipo === 'retiro' ? -valor : valor, metodoPagoId: efectivo?.id, esEfectivo: 1,
        descripcion: String(motivo).trim(), usuarioId });
}

// Resumen de una sesión: efectivo esperado, entradas y salidas por tipo y por método
export async function resumenSesion(conn, sesion, { conMovimientos = false } = {}) {
    const [rows] = await conn.query(
        `SELECT mc.tipo, mc.es_efectivo AS efectivo, COALESCE(m.nombre, 'Sin método') AS metodo, SUM(mc.monto) AS total, COUNT(*) AS n
         FROM movimientos_caja mc LEFT JOIN metodos_pago m ON m.id = mc.metodo_pago_id
         WHERE mc.sesion_id = ? GROUP BY mc.tipo, mc.es_efectivo, metodo`, [sesion.id]);
    const porTipo = { cobro: 0, gasto: 0, compra: 0, ingreso: 0, retiro: 0 };
    const metodos = new Map();
    let entradasEfectivo = 0;
    let salidasEfectivo = 0;
    for (const r of rows) {
        const total = Number(r.total);
        porTipo[r.tipo] = r2(porTipo[r.tipo] + total);
        const m = metodos.get(r.metodo) || { method: r.metodo, isCash: Number(r.efectivo) === 1, total: 0 };
        m.total = r2(m.total + total);
        metodos.set(r.metodo, m);
        if (Number(r.efectivo) === 1) {
            if (total >= 0) entradasEfectivo += total; else salidasEfectivo += total;
        }
    }
    const inicial = Number(sesion.efectivo_inicial) || 0;
    const resumen = {
        initialCash: inicial,
        cashIn: r2(entradasEfectivo),
        cashOut: r2(-salidasEfectivo),
        expectedCash: r2(inicial + entradasEfectivo + salidasEfectivo),
        byType: { collections: porTipo.cobro, expenses: -porTipo.gasto, purchases: -porTipo.compra, deposits: porTipo.ingreso, withdrawals: -porTipo.retiro },
        byMethod: [...metodos.values()].sort((a, b) => Number(b.isCash) - Number(a.isCash) || b.total - a.total),
        movementCount: rows.reduce((s, r) => s + Number(r.n), 0)
    };
    if (conMovimientos) {
        const [movs] = await conn.query(
            `SELECT mc.id, mc.tipo AS type, mc.monto AS amount, COALESCE(m.nombre, 'Sin método') AS method, mc.es_efectivo AS isCash,
                    mc.origen_tipo AS sourceType, mc.origen_id AS sourceId, mc.descripcion AS description, mc.creado_en AS createdAt, u.username AS user
             FROM movimientos_caja mc LEFT JOIN metodos_pago m ON m.id = mc.metodo_pago_id LEFT JOIN usuarios u ON u.id = mc.usuario_id
             WHERE mc.sesion_id = ? ORDER BY mc.id DESC`, [sesion.id]);
        resumen.movements = movs.map((x) => ({ ...x, amount: Number(x.amount), isCash: Number(x.isCash) === 1 }));
    }
    return resumen;
}

export const sesionPublica = (s) => ({
    id: s.id, type: s.tipo, open: Number(s.abierta) === 1, openedAt: s.abierta_en, closedAt: s.cerrada_en,
    initialCash: Number(s.efectivo_inicial) || 0,
    expectedCash: s.efectivo_esperado == null ? null : Number(s.efectivo_esperado),
    countedCash: s.efectivo_contado == null ? null : Number(s.efectivo_contado),
    difference: s.diferencia == null ? null : Number(s.diferencia),
    withdrawn: s.efectivo_retirado == null ? null : Number(s.efectivo_retirado),
    notes: s.notas || null
});

/**
 * Cierra la sesión abierta: el servidor calcula lo esperado, guarda lo contado, la diferencia y lo que
 * se retira, y abre la siguiente con el efectivo que queda en el cajón (contado − retirado).
 * sesionId evita cerrar dos veces: si otra persona ya cerró, la abierta es otra y se rechaza.
 */
export async function cerrarSesion(conn, { sesionId, contado, retirado = 0, notas, usuarioId, automatico = false }) {
    const sesion = await sesionAbierta(conn, { bloquear: true });
    if (Number(sesionId) !== sesion.id) throw err(409, 'Esta caja ya se cerró: recarga para ver la sesión actual');
    const resumen = await resumenSesion(conn, sesion);
    // Cierre automático (23:59): nadie contó el efectivo. Queda sin contado ni diferencia (no «cuadra»:
    // no se sabe) y la siguiente sesión arranca con lo que debía haber en el cajón.
    if (automatico) {
        await conn.query(
            `UPDATE sesiones_caja SET abierta = NULL, cerrada_en = NOW(), cerrada_por = NULL, efectivo_esperado = ?, efectivo_contado = NULL,
             diferencia = NULL, efectivo_retirado = 0, resumen = ?, notas = ? WHERE id = ?`,
            [resumen.expectedCash, JSON.stringify(resumen), notas || 'Cierre automático de las 23:59 (sin arqueo)', sesion.id]);
        const [nueva] = await conn.query("INSERT INTO sesiones_caja (tipo, abierta, abierta_en, efectivo_inicial) VALUES ('normal', 1, NOW(), ?)", [resumen.expectedCash]);
        return { closedId: sesion.id, expectedCash: resumen.expectedCash, countedCash: null, difference: null, newSessionId: nueva.insertId, automatico: true };
    }
    const efectivo = r2(contado);
    const retiro = r2(retirado || 0);
    if (!(efectivo >= 0)) throw err(400, 'Escribe el efectivo contado en el cajón (0 o más)');
    if (!(retiro >= 0) || retiro > efectivo) throw err(400, 'Lo retirado no puede ser negativo ni mayor que lo contado');
    const diferencia = r2(efectivo - resumen.expectedCash);
    await conn.query(
        `UPDATE sesiones_caja SET abierta = NULL, cerrada_en = NOW(), cerrada_por = ?, efectivo_esperado = ?, efectivo_contado = ?,
         diferencia = ?, efectivo_retirado = ?, resumen = ?, notas = ? WHERE id = ?`,
        [usuarioId || null, resumen.expectedCash, efectivo, diferencia, retiro, JSON.stringify(resumen),
            notas ? String(notas).substring(0, 2000) : null, sesion.id]);
    const [nueva] = await conn.query("INSERT INTO sesiones_caja (tipo, abierta, abierta_en, abierta_por, efectivo_inicial) VALUES ('normal', 1, NOW(), ?, ?)",
        [usuarioId || null, r2(efectivo - retiro)]);
    return { closedId: sesion.id, expectedCash: resumen.expectedCash, countedCash: efectivo, difference: diferencia, newSessionId: nueva.insertId };
}

// Documentos cuyo libro de dinero no suma su monto vigente (debe estar vacío)
export async function auditarDinero(db) {
    // Cada documento contra lo que dejó en el libro. Los pagos con un método que no mueve la caja (tarjeta
    // de regalo) deben dejar 0; la venta de una tarjeta deja su valor.
    const tablas = [['pago', 'pagos', 1], ['gasto', 'gastos', -1], ['compra', 'compras', -1]];
    if (esquema.tarjetas) tablas.push(['tarjeta', 'tarjetas_regalo', 1]);
    const diferencias = [];
    for (const [tipo, tabla, signo] of tablas) {
        const monto = tipo === 'tarjeta' ? 'd.valor'
            : tipo === 'pago' && esquema.tarjetas ? '(SELECT IF(mp.mueve_caja = 0, 0, d.monto) FROM metodos_pago mp WHERE mp.id = d.metodo_pago_id)'
                : 'd.monto';
        const [rows] = await db.query(`SELECT d.id, COALESCE(${monto}, d.${tipo === 'tarjeta' ? 'valor' : 'monto'}) AS monto, d.anulada_en, COALESCE(SUM(mc.monto), 0) AS libro FROM ${tabla} d
            LEFT JOIN movimientos_caja mc ON mc.origen_tipo = ? AND mc.origen_id = d.id GROUP BY d.id`, [tipo]);
        for (const r of rows) {
            const documento = r.anulada_en ? 0 : signo * Number(r.monto);
            if (Math.abs(documento - Number(r.libro)) > 0.005) diferencias.push({ tipo, id: r.id, documento, libro: Number(r.libro) });
        }
    }
    return diferencias;
}
