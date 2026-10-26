// ============================================================
// Tarjetas de regalo (migración 020) · tienda física
// ------------------------------------------------------------
// Reglas (sin trucos):
//   · Valen 6 meses desde la fecha de venta; la fecha de vencimiento va impresa en la tarjeta.
//   · Un solo uso: se aplica completa a una venta. Si la compra vale más, el cliente paga la diferencia;
//     si vale menos, no hay vueltas ni saldo (lo que sobra es ingreso de la tienda).
//   · Venderla mete el dinero a la caja (origen «tarjeta»); redimirla no, porque ese dinero ya entró.
//   · Anular la venta en que se usó la devuelve a «activa» con su vencimiento original.
//   · Solo se anula una tarjeta que no se ha usado: el dinero sale de la caja con el mismo método.
// ============================================================
import crypto from 'crypto';
import { esquema } from './estado.js';
import { sincronizarDinero } from './caja.js';
import { insertarPago } from './catalogos.js';

export const METODO_TARJETA = 'Tarjeta de regalo';
export const MESES_VIGENCIA = 6;

const err = (status, message) => Object.assign(new Error(message), { status });
const r2 = (n) => Math.round(Number(n) * 100) / 100;
const hoyLocal = () => new Date(Date.now() - 5 * 3600 * 1000).toISOString().slice(0, 10);

// AD-XXXX-XXXX sin letras que se confundan (0/O, 1/I/L): fácil de dictar y de escribir
const ALFABETO = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
function codigoAleatorio() {
    const b = crypto.randomBytes(8);
    const c = [...b].map((x) => ALFABETO[x % ALFABETO.length]).join('');
    return `AD-${c.slice(0, 4)}-${c.slice(4, 8)}`;
}

/** Normaliza lo que escriben en caja: «ad 7k3p q9xm» → «AD-7K3P-Q9XM» */
export function normalizarCodigo(texto) {
    const t = String(texto || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    const cuerpo = t.startsWith('AD') ? t.slice(2) : t;
    return cuerpo.length === 8 ? `AD-${cuerpo.slice(0, 4)}-${cuerpo.slice(4)}` : String(texto || '').trim().toUpperCase();
}

/** Estado visible: activa, vencida, redimida o anulada */
export function estadoTarjeta(t, hoy = hoyLocal()) {
    if (t.anulada_en) return 'anulada';
    if (t.estado === 'redimida') return 'redimida';
    return String(t.vence).slice(0, 10) < hoy ? 'vencida' : 'activa';
}

export const tarjetaPublica = (t) => ({
    id: t.id, code: t.codigo, value: Number(t.valor), date: String(t.fecha).slice(0, 10), expires: String(t.vence).slice(0, 10),
    buyer: t.comprador || null, recipient: t.para || null, notes: t.notas || null, method: t.metodo || null,
    status: estadoTarjeta(t), saleId: t.venta_id || null, redeemedAt: t.redimida_en || null,
    applied: t.aplicado == null ? null : Number(t.aplicado), leftover: t.excedente == null ? null : Number(t.excedente),
    voidedAt: t.anulada_en || null, voidReason: t.motivo_anulacion || null, createdAt: t.creado_en
});

const SELECT = `SELECT t.*, m.nombre AS metodo FROM tarjetas_regalo t LEFT JOIN metodos_pago m ON m.id = t.metodo_pago_id`;

export async function buscarTarjeta(conn, codigo, { bloquear = false } = {}) {
    const [[t]] = await conn.query(`${SELECT} WHERE t.codigo = ?${bloquear ? ' FOR UPDATE' : ''}`, [normalizarCodigo(codigo)]);
    return t || null;
}

export async function listarTarjetas(db, { q, estado } = {}) {
    const [rows] = await db.query(`${SELECT} ORDER BY t.id DESC LIMIT 500`);
    const texto = String(q || '').trim().toLowerCase();
    return rows.map(tarjetaPublica)
        .filter((t) => !estado || t.status === estado)
        .filter((t) => !texto || `${t.code} ${t.buyer || ''} ${t.recipient || ''}`.toLowerCase().includes(texto) || t.code === normalizarCodigo(texto));
}

/** Vende una tarjeta: queda activa 6 meses y su valor entra a la caja con el método con que la pagaron */
export async function emitirTarjeta(conn, { valor, fecha, comprador, para, notas, metodoPagoId, usuarioId }) {
    const monto = r2(valor);
    if (!(monto >= 1000)) throw err(400, 'El valor de la tarjeta debe ser de al menos $1.000');
    if (monto > 10000000) throw err(400, 'El valor de la tarjeta es demasiado alto');
    const [[metodo]] = await conn.query('SELECT id, mueve_caja FROM metodos_pago WHERE id = ? AND activo = 1', [metodoPagoId]);
    if (!metodo) throw err(400, 'Elige con qué pagaron la tarjeta');
    if (Number(metodo.mueve_caja) === 0) throw err(400, 'Una tarjeta de regalo no se paga con otra tarjeta de regalo');
    let id;
    for (let intento = 0; !id; intento += 1) {
        try {
            const [r] = await conn.query(
                `INSERT INTO tarjetas_regalo (codigo, valor, fecha, vence, comprador, para, notas, metodo_pago_id, creado_por)
                 VALUES (?, ?, ?, DATE_ADD(?, INTERVAL ${MESES_VIGENCIA} MONTH), ?, ?, ?, ?, ?)`,
                [codigoAleatorio(), monto, fecha, fecha, limpio(comprador, 120), limpio(para, 120), limpio(notas, 255), metodo.id, usuarioId || null]);
            id = r.insertId;
        } catch (e) {
            if (e.code !== 'ER_DUP_ENTRY' || intento > 5) throw e;
        }
    }
    const [[t]] = await conn.query(`${SELECT} WHERE t.id = ?`, [id]);
    await sincronizarDinero(conn, { origenTipo: 'tarjeta', origenId: id, tipo: 'cobro', monto, metodoPagoId: metodo.id,
        descripcion: `Venta de la tarjeta de regalo ${t.codigo}`, usuarioId });
    return t;
}

/** Anula una tarjeta sin usar: el dinero vuelve a salir de la caja */
export async function anularTarjeta(conn, id, { motivo, usuarioId }) {
    const texto = String(motivo || '').trim();
    if (texto.length < 5) throw err(400, 'Escribe el motivo de la anulación');
    const [[t]] = await conn.query('SELECT * FROM tarjetas_regalo WHERE id = ? FOR UPDATE', [id]);
    if (!t) throw err(404, 'Tarjeta no encontrada');
    if (t.anulada_en) throw err(400, 'Esta tarjeta ya está anulada');
    if (t.estado === 'redimida') throw err(400, 'Esta tarjeta ya se usó: para devolverla, anula la venta en que se usó');
    await conn.query('UPDATE tarjetas_regalo SET anulada_en = NOW(), anulada_por = ?, motivo_anulacion = ? WHERE id = ?', [usuarioId || null, texto.slice(0, 255), id]);
    await sincronizarDinero(conn, { origenTipo: 'tarjeta', origenId: id, tipo: 'cobro', monto: 0, metodoPagoId: t.metodo_pago_id,
        descripcion: `Devolución por anulación de la tarjeta ${t.codigo}`, usuarioId });
}

/**
 * Comprueba que la tarjeta se pueda usar en una venta de `total` con fecha `fecha` (bloquea la fila).
 * Devuelve { tarjeta, aplicado, excedente }.
 */
export async function validarRedencion(conn, codigo, { total, fecha }) {
    const t = await buscarTarjeta(conn, codigo, { bloquear: true });
    if (!t) throw err(400, `No existe una tarjeta de regalo con el código ${normalizarCodigo(codigo)}`);
    const estado = estadoTarjeta(t, String(fecha).slice(0, 10));
    if (estado === 'anulada') throw err(400, `La tarjeta ${t.codigo} está anulada`);
    if (estado === 'redimida') throw err(400, `La tarjeta ${t.codigo} ya se usó en la venta #${t.venta_id}`);
    if (estado === 'vencida') throw err(400, `La tarjeta ${t.codigo} venció el ${String(t.vence).slice(0, 10)}`);
    if (String(fecha).slice(0, 10) < String(t.fecha).slice(0, 10)) throw err(400, 'La venta no puede ser anterior a la fecha en que se vendió la tarjeta');
    const aplicado = r2(Math.min(Number(t.valor), Number(total)));
    return { tarjeta: t, aplicado, excedente: r2(Number(t.valor) - aplicado) };
}

/** Aplica la tarjeta (ya validada) como pago de la venta y la marca usada */
export async function redimirTarjeta(conn, { tarjeta, aplicado, excedente }, { ventaId, fecha, usuarioId }) {
    if (aplicado > 0) {
        await insertarPago(conn, { ventaId, monto: aplicado, fecha, metodo: METODO_TARJETA, crear: false, usuarioId });
    }
    await conn.query("UPDATE tarjetas_regalo SET estado = 'redimida', venta_id = ?, redimida_en = NOW(), aplicado = ?, excedente = ? WHERE id = ?",
        [ventaId, aplicado, excedente, tarjeta.id]);
}

/** Al anular una venta, la tarjeta con que se pagó vuelve a quedar activa */
export async function liberarTarjetaDeVenta(conn, ventaId) {
    if (!esquema.tarjetas) return [];
    const [rows] = await conn.query("SELECT id, codigo FROM tarjetas_regalo WHERE venta_id = ? AND estado = 'redimida' FOR UPDATE", [ventaId]);
    if (rows.length) {
        await conn.query("UPDATE tarjetas_regalo SET estado = 'activa', venta_id = NULL, redimida_en = NULL, aplicado = NULL, excedente = NULL WHERE venta_id = ? AND estado = 'redimida'", [ventaId]);
    }
    return rows.map((r) => r.codigo);
}

/** Lo que dicen las tarjetas en un periodo (para el estado de resultados) */
export async function tarjetasDelPeriodo(db, desde, hasta) {
    if (!esquema.tarjetas) return null;
    const ini = `${desde} 00:00:00`;
    const fin = `${hasta} 23:59:59`;
    const hoy = hoyLocal();
    const [[vendidas]] = await db.query(`SELECT COUNT(*) n, COALESCE(SUM(valor), 0) total FROM tarjetas_regalo
        WHERE fecha BETWEEN ? AND ? AND (anulada_en IS NULL OR anulada_en > ?)`, [desde, hasta, fin]);
    const [[usadas]] = await db.query(`SELECT COUNT(*) n, COALESCE(SUM(t.aplicado), 0) aplicado, COALESCE(SUM(t.excedente), 0) excedente
        FROM tarjetas_regalo t JOIN ventas v ON v.id = t.venta_id WHERE t.estado = 'redimida' AND v.fecha BETWEEN ? AND ?`, [ini, fin]);
    // Vencidas sin usar: su valor es ingreso el día en que vencen (solo las que ya vencieron)
    const [[vencidas]] = await db.query(`SELECT COUNT(*) n, COALESCE(SUM(valor), 0) total FROM tarjetas_regalo
        WHERE estado = 'activa' AND anulada_en IS NULL AND vence BETWEEN ? AND ? AND vence < ?`, [desde, hasta, hoy]);
    // Lo que la tienda debe al cierre del periodo: tarjetas vendidas, sin usar, sin anular y sin vencer
    const [[pendiente]] = await db.query(`SELECT COUNT(*) n, COALESCE(SUM(t.valor), 0) total FROM tarjetas_regalo t
        LEFT JOIN ventas v ON v.id = t.venta_id
        WHERE t.fecha <= ? AND (t.anulada_en IS NULL OR t.anulada_en > ?) AND t.vence >= ?
          AND (t.estado = 'activa' OR v.fecha > ?)`, [hasta, fin, hasta, fin]);
    const ingreso = r2(Number(usadas.excedente) + Number(vencidas.total));
    return {
        vendidas: { n: Number(vendidas.n), total: r2(vendidas.total) },
        usadas: { n: Number(usadas.n), aplicado: r2(usadas.aplicado), excedente: r2(usadas.excedente) },
        vencidas: { n: Number(vencidas.n), total: r2(vencidas.total) },
        ingreso,
        pendientes: { n: Number(pendiente.n), total: r2(pendiente.total) }
    };
}

function limpio(t, max) {
    const s = String(t ?? '').trim();
    return s ? s.slice(0, max) : null;
}
