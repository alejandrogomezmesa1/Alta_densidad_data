// ============================================================
// Recetas aplicadas a ventas (decants)
// ------------------------------------------------------------
// Un decant no es un ítem de inventario: se arma con la receta 'decant' (migración 014).
// Venderlo descuenta cada línea de la receta (la esencia y el envase que eligió el cliente y los
// insumos fijos) y deja constancia en venta_consumos para devolver lo mismo si se anula.
// ============================================================
import { esquema } from './estado.js';
import { moverStock } from './inventario.js';

export const CATEGORIA_DECANTS = 'Decants';
export const ML_DECANT = 10;

const err400 = (mensaje) => Object.assign(new Error(mensaje), { status: 400 });

export async function lineasReceta(conn, ambito, ml) {
    if (!esquema.recetas) return [];
    const [rows] = await conn.query(
        'SELECT rol, inventario_id AS inventarioId, cantidad FROM recetas WHERE ambito = ? AND (ml = ? OR ml IS NULL) ORDER BY orden, id', [ambito, ml]);
    return rows.map((r) => ({ rol: r.rol, inventarioId: r.inventarioId, cantidad: Number(r.cantidad) || 0 }));
}

// Esencia y envase válidos para un decant (la esencia es tipo esencia; el envase, de la categoría Decants)
async function validarEleccion(conn, { essenceId, containerId }) {
    const [rows] = await conn.query('SELECT id, nombre, tipo, categoria, activo FROM inventario WHERE id IN (?)', [[essenceId || 0, containerId || 0]]);
    const porId = new Map(rows.map((r) => [r.id, r]));
    const esencia = porId.get(Number(essenceId));
    const envase = porId.get(Number(containerId));
    if (!esencia || esencia.tipo !== 'esencia') throw err400(`La esencia ${essenceId} no existe en el inventario`);
    if (!envase || envase.tipo !== 'envase' || envase.categoria !== CATEGORIA_DECANTS) throw err400(`El envase de decant ${containerId} no existe`);
    return { esencia, envase };
}

/**
 * Qué consume un decant: [{ inventarioId, cantidad }] por unidad × cantidad.
 * @param recipe { scope: 'decant', ml, essenceId, containerId }
 */
export async function consumoDeReceta(conn, recipe, cantidad = 1) {
    if (!esquema.decants) throw err400('Los decants aún no están disponibles en DATA (migración 014 pendiente)');
    if (!recipe || recipe.scope !== 'decant') throw err400('Receta no soportada');
    const ml = parseInt(recipe.ml, 10) || ML_DECANT;
    const { esencia, envase } = await validarEleccion(conn, recipe);
    const consumo = new Map();
    for (const l of await lineasReceta(conn, 'decant', ml)) {
        const id = l.rol === 'esencia' ? esencia.id : l.rol === 'envase' ? envase.id : l.inventarioId;
        const q = l.cantidad * cantidad;
        if (id && q > 0) consumo.set(id, (consumo.get(id) || 0) + q);
    }
    return [...consumo].map(([inventarioId, q]) => ({ inventarioId, cantidad: Math.round(q * 1000) / 1000 }));
}

// Descuenta la receta de una línea vendida y registra cada consumo. Devuelve el costo unitario.
export async function venderReceta(conn, { ventaId, recipe, cantidad, motivo, descripcion }) {
    const consumos = await consumoDeReceta(conn, recipe, cantidad);
    let costoTotal = 0;
    const negativos = [];
    for (const c of consumos) {
        const r = await moverStock(conn, { inventarioId: c.inventarioId, cantidad: -c.cantidad, tipo: 'venta',
            origenTipo: 'venta', origenId: ventaId, motivo, permitirNegativo: true });
        const costo = r ? r.costo : 0;
        costoTotal += c.cantidad * costo;
        if (r && r.stock < 0) negativos.push(c.inventarioId);
        await conn.query('INSERT INTO venta_consumos (venta_id, inventario_id, cantidad, costo_unitario, descripcion) VALUES (?, ?, ?, ?, ?)',
            [ventaId, c.inventarioId, c.cantidad, costo, descripcion ? String(descripcion).substring(0, 255) : null]);
    }
    return { costoUnitario: cantidad ? costoTotal / cantidad : 0, negativos };
}

// Devuelve al inventario todo lo que una venta consumió por receta (anulación o eliminación)
export async function devolverConsumos(conn, ventaId, motivo, usuarioId) {
    if (!esquema.decants) return;
    const [rows] = await conn.query('SELECT inventario_id, cantidad FROM venta_consumos WHERE venta_id = ?', [ventaId]);
    for (const r of rows) {
        await moverStock(conn, { inventarioId: r.inventario_id, cantidad: Number(r.cantidad), tipo: 'anulacion_venta',
            origenTipo: 'venta', origenId: Number(ventaId), motivo, usuarioId });
    }
    await conn.query('DELETE FROM venta_consumos WHERE venta_id = ?', [ventaId]);
}

// Lo que la tienda necesita para vender decants: receta resumida, esencias y envases con stock y
// costo. El precio lo pone la tienda; con el costo bloquea los que no lo cubran (vigilante).
export async function catalogoDecants(db) {
    if (!esquema.decants) return { disponible: false };
    const lineas = await lineasReceta(db, 'decant', ML_DECANT);
    const esenciaMl = lineas.filter((l) => l.rol === 'esencia').reduce((s, l) => s + l.cantidad, 0);
    const envasesPorDecant = lineas.filter((l) => l.rol === 'envase').reduce((s, l) => s + l.cantidad, 0) || 1;
    const fijos = lineas.filter((l) => l.rol === 'insumo' && l.inventarioId);
    let costoInsumos = 0;
    if (fijos.length) {
        const [items] = await db.query('SELECT id, precio_costo FROM inventario WHERE id IN (?)', [fijos.map((l) => l.inventarioId)]);
        const costo = new Map(items.map((i) => [i.id, Number(i.precio_costo) || 0]));
        costoInsumos = fijos.reduce((s, l) => s + l.cantidad * (costo.get(l.inventarioId) || 0), 0);
    }
    const [esencias] = await db.query(`SELECT id, nombre, ${esquema.claseEsencia ? 'clase_esencia' : 'NULL'} AS clase, stock, precio_costo
        FROM inventario WHERE tipo = 'esencia' AND activo = 1 ORDER BY nombre`);
    const [envases] = await db.query("SELECT id, nombre, stock, precio_costo FROM inventario WHERE tipo = 'envase' AND categoria = ? AND activo = 1 ORDER BY nombre",
        [CATEGORIA_DECANTS]);
    const r2 = (n) => Math.round(Number(n) * 100) / 100;
    return {
        disponible: true,
        ml: ML_DECANT,
        // Sin esencia en la receta todavía no se puede calcular cuántos decants salen de cada esencia
        recetaLista: esenciaMl > 0,
        esenciaMl: r2(esenciaMl),
        costoInsumos: r2(costoInsumos),
        esencias: esencias.map((e) => ({ id: e.id, name: e.nombre, clase: e.clase || null, stockMl: r2(e.stock), costPerMl: Number(e.precio_costo) || 0,
            decants: esenciaMl > 0 ? Math.max(0, Math.floor((Number(e.stock) || 0) / esenciaMl + 1e-9)) : 0 })),
        envases: envases.map((e) => ({ id: e.id, name: e.nombre, stock: r2(e.stock), cost: Number(e.precio_costo) || 0,
            decants: Math.max(0, Math.floor((Number(e.stock) || 0) / envasesPorDecant + 1e-9)) }))
    };
}
