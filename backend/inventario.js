// ============================================================
// Movimientos de inventario (regla I-01)
// ------------------------------------------------------------
// Único punto por el que cambia el stock. Cada llamada:
//   1. bloquea la fila del ítem (SELECT … FOR UPDATE) para que dos ventas
//      simultáneas no tomen el mismo stock,
//   2. valida que no quede negativo (regla I-04), salvo que se permita,
//   3. actualiza el stock y, si es una entrada con costo, el costo promedio (I-03),
//   4. registra el movimiento con su origen.
// Debe llamarse dentro de una transacción (recibe la conexión).
// ============================================================

import { esquema } from './estado.js';

export class StockInsuficienteError extends Error {
    constructor(item, disponible, solicitado) {
        super(`Stock insuficiente de "${item}": disponible ${formatear(disponible)}, se necesitan ${formatear(solicitado)}`);
        this.status = 400;
        this.item = item;
        this.disponible = disponible;
        this.solicitado = solicitado;
    }
}

const formatear = (n) => Number(n).toLocaleString('es-CO', { maximumFractionDigits: 2 });
const redondear = (n) => Math.round(Number(n) * 100) / 100;

export const TIPOS = ['inicial', 'compra', 'anulacion_compra', 'venta', 'anulacion_venta', 'ajuste', 'consumo_produccion', 'salida_produccion'];

/**
 * @param conn conexión en transacción
 * @param {object} m
 * @param {number} m.inventarioId
 * @param {number} m.cantidad       positiva entra, negativa sale
 * @param {string} m.tipo           uno de TIPOS
 * @param {number} [m.costoUnitario] costo por unidad de inventario (entradas: recalcula el promedio)
 * @param {boolean} [m.recalcularCosto] true en compras: la entrada actualiza el costo promedio
 * @param {string} [m.origenTipo]   'venta', 'compra', 'produccion', 'ajuste'…
 * @param {number} [m.origenId]
 * @param {string} [m.motivo]
 * @param {number} [m.usuarioId]
 * @param {boolean} [m.permitirNegativo] solo ventas web ya pagadas (regla D-07)
 * @returns {Promise<{stockAnterior:number, stock:number, costo:number}>}
 */
export async function moverStock(conn, m) {
    const cantidad = redondear(m.cantidad);
    if (!m.inventarioId || !cantidad) return null;
    if (!TIPOS.includes(m.tipo)) throw new Error(`Tipo de movimiento inválido: ${m.tipo}`);

    const [rows] = await conn.query('SELECT id, nombre, stock, precio_costo FROM inventario WHERE id = ? FOR UPDATE', [m.inventarioId]);
    if (!rows.length) {
        const err = new Error(`El ítem de inventario ${m.inventarioId} no existe`);
        err.status = 400;
        throw err;
    }
    const item = rows[0];
    const stockAnterior = Number(item.stock) || 0;
    const costoAnterior = Number(item.precio_costo) || 0;
    const stock = redondear(stockAnterior + cantidad);

    if (stock < 0 && !m.permitirNegativo) {
        throw new StockInsuficienteError(item.nombre, stockAnterior, -cantidad);
    }

    // Costo promedio ponderado: solo cambia con entradas que traen costo (compras, producción)
    let costo = costoAnterior;
    if (m.recalcularCosto && cantidad > 0 && m.costoUnitario != null) {
        const base = Math.max(stockAnterior, 0);
        costo = stock > 0 ? (base * costoAnterior + cantidad * Number(m.costoUnitario)) / (base + cantidad) : Number(m.costoUnitario);
    }
    // Anular una compra revierte su aporte al promedio
    if (m.recalcularCosto && cantidad < 0 && m.costoUnitario != null && stock > 0) {
        const revertido = (stockAnterior * costoAnterior + cantidad * Number(m.costoUnitario)) / stock;
        costo = revertido > 0 ? revertido : costoAnterior;
    }

    await conn.query('UPDATE inventario SET stock = ?, precio_costo = ? WHERE id = ?', [stock, costo, item.id]);
    // Sin la migración 006 el stock cambia igual, pero todavía no hay libro donde registrarlo
    if (esquema.libro) await conn.query(
        `INSERT INTO movimientos_inventario
            (inventario_id, tipo, cantidad, stock_resultante, costo_unitario, origen_tipo, origen_id, motivo, usuario_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [item.id, m.tipo, cantidad, stock, m.costoUnitario ?? costoAnterior, m.origenTipo || null, m.origenId || null,
         m.motivo ? String(m.motivo).substring(0, 255) : null, m.usuarioId || null]
    );
    if (stock < 0) console.warn(`[INVENTARIO] "${item.nombre}" quedó en ${stock} por ${m.tipo} ${m.origenTipo || ''} ${m.origenId || ''}`);
    return { stockAnterior, stock, costo };
}

// Ítems cuyo stock no coincide con la suma de su libro (regla I-01: verificación)
export async function auditarStock(db) {
    const [rows] = await db.query(`
        SELECT i.id, i.nombre, i.stock, COALESCE(SUM(m.cantidad), 0) AS libro
        FROM inventario i
        LEFT JOIN movimientos_inventario m ON m.inventario_id = i.id
        GROUP BY i.id, i.nombre, i.stock
        HAVING ROUND(i.stock, 2) <> ROUND(COALESCE(SUM(m.cantidad), 0), 2)
    `);
    return rows.map(r => ({ id: r.id, nombre: r.nombre, stock: Number(r.stock), libro: Number(r.libro) }));
}
