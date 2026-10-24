// ============================================================
// Anular una venta (migración 016): nada se borra
// ------------------------------------------------------------
// Vuelve al inventario todo lo que salió (productos, componentes de kits, recetas), marca la venta
// y sus pagos como anulados y registra la devolución del dinero en la caja abierta, con el mismo
// método de cada pago. Las líneas quedan como historia.
// ============================================================
import { esquema } from './estado.js';
import { devolverVenta } from './recetas.js';
import { sincronizarDinero } from './caja.js';

export async function anularVenta(conn, ventaId, { motivo, usuarioId } = {}) {
    const id = Number(ventaId);
    const [[venta]] = await conn.query('SELECT id, anulada_en FROM ventas WHERE id = ? FOR UPDATE', [id]);
    if (!venta) throw Object.assign(new Error('Venta no encontrada'), { status: 404 });
    if (venta.anulada_en) throw Object.assign(new Error('Esta venta ya está anulada'), { status: 400 });
    const texto = String(motivo || 'Venta anulada').substring(0, 255);
    await devolverVenta(conn, id, texto, usuarioId);
    await conn.query('UPDATE ventas SET anulada_en = NOW(), anulada_por = ?, motivo_anulacion = ? WHERE id = ?', [usuarioId || null, texto, id]);
    const [pagos] = await conn.query('SELECT id, metodo_pago_id FROM pagos WHERE venta_id = ? AND anulada_en IS NULL', [id]);
    for (const p of pagos) {
        await conn.query('UPDATE pagos SET anulada_en = NOW(), anulada_por = ?, motivo_anulacion = ? WHERE id = ?', [usuarioId || null, texto, p.id]);
        await sincronizarDinero(conn, { origenTipo: 'pago', origenId: p.id, tipo: 'cobro', monto: 0, metodoPagoId: p.metodo_pago_id,
            descripcion: `Devolución por anulación de la venta #${id}`, usuarioId });
    }
    return { saleId: id, refundedPayments: pagos.length };
}

export const ventaAnulada = async (conn, id) => {
    if (!esquema.caja) return false;
    const [[v]] = await conn.query('SELECT anulada_en FROM ventas WHERE id = ?', [id]);
    return Boolean(v?.anulada_en);
};
