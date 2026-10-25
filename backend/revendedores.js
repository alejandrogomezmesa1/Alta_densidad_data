// ============================================================
// Precio mayorista (lo que le cuesta cada producto al mayorista)
// ------------------------------------------------------------
// Regla de negocio (24-10-2026): precio al público − un descuento fijo según su rango
// (hasta $75.000: −$10.000 · hasta $95.000: −$15.000 · por encima: −$20.000), nunca por debajo de
// costo + margen mínimo (15 %, redondeado a $1.000 hacia arriba). Si ni así queda por debajo del
// precio al público, el producto no se ofrece al mayorista. Rangos, montos y margen viven en
// Configuraciones. Se calcula aquí porque solo DATA conoce el costo: la tienda recibe el resultado.
// ============================================================
import { esquema } from './estado.js';
import { leerConfiguraciones } from './configuraciones.js';
import { resumenKits } from './inventario.js';

export function precioMayorista(publico, costo, c) {
    const descuento = publico <= c.revendedor_tope_bajo ? c.revendedor_desc_bajo
        : publico <= c.revendedor_tope_medio ? c.revendedor_desc_medio : c.revendedor_desc_alto;
    let precio = publico - descuento;
    let alPiso = false;
    if (costo > 0) {
        const piso = Math.ceil((costo * (1 + c.revendedor_margen_minimo / 100)) / 1000) * 1000;
        if (piso >= publico) return { precio: null, excluido: true };
        if (precio < piso) { precio = piso; alPiso = true; }
    }
    if (!(precio > 0)) return { precio: null, excluido: true };
    return { precio, alPiso, sinCosto: !(costo > 0) };
}

// Precio mayorista de cada producto terminado con precio: [{ inventoryId, price, wholesalePrice, excluded, atFloor, noCost }]
export async function preciosMayoristas(db) {
    const c = await leerConfiguraciones(db);
    const [rows] = await db.query(`SELECT id, precio, precio_costo FROM inventario
        WHERE precio > 0 ${esquema.inventarioTipos ? "AND activo = 1 AND tipo = 'terminado'" : ''}`);
    const kits = await resumenKits(db);
    return {
        rule: {
            lowUpTo: c.revendedor_tope_bajo, lowDiscount: c.revendedor_desc_bajo,
            midUpTo: c.revendedor_tope_medio, midDiscount: c.revendedor_desc_medio,
            highDiscount: c.revendedor_desc_alto, minMarginPct: c.revendedor_margen_minimo
        },
        items: rows.map((r) => {
            const publico = Number(r.precio);
            const costo = kits.has(r.id) ? kits.get(r.id).costo : Number(r.precio_costo) || 0;
            const m = precioMayorista(publico, costo, c);
            return { inventoryId: r.id, price: publico, wholesalePrice: m.precio, excluded: !!m.excluido, atFloor: !!m.alPiso, noCost: !!m.sinCosto };
        })
    };
}
