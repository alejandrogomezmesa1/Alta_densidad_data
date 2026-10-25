// ============================================================
// Contabilidad (migración 018): periodos, resultados, salud y libros
// ------------------------------------------------------------
// · Periodos: un mes cerrado guarda la foto de sus cifras con su huella. Desde entonces no se
//   registra ni se edita ningún documento con fecha en ese mes o antes; lo que se corrija después
//   (p. ej. anular una venta de un mes cerrado) cuenta en el mes en que se hace.
// · Resultados de un periodo (base de causación): una venta cuenta en el mes de su fecha; si se
//   anula en un mes posterior, ese mes la resta como «anulación de periodos anteriores». Igual para
//   gastos y compras. El dinero (caja) cuenta por la fecha en que se movió.
// · Salud: todos los controles de integridad en un solo lugar.
// · Libros: ventas, cobros, compras, gastos, caja, inventario y auditoría en CSV para el contador.
// ============================================================
import crypto from 'crypto';
import { esquema } from './estado.js';
import { auditar, verificarCadena } from './auditoria.js';
import { auditarStock } from './inventario.js';
import { auditarDinero } from './caja.js';

const err = (status, mensaje) => Object.assign(new Error(mensaje), { status });
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const num = (v) => Number(v) || 0;

const RE_PERIODO = /^(\d{4})-(0[1-9]|1[0-2])$/;
export function limitesPeriodo(periodo) {
    const m = RE_PERIODO.exec(String(periodo || ''));
    if (!m) throw err(400, 'El periodo debe ser AAAA-MM');
    const [y, mes] = [Number(m[1]), Number(m[2])];
    const ultimo = new Date(Date.UTC(y, mes, 0)).getUTCDate();
    return { desde: `${m[1]}-${m[2]}-01`, hasta: `${m[1]}-${m[2]}-${String(ultimo).padStart(2, '0')}` };
}
const siguiente = (periodo) => {
    const [y, m] = periodo.split('-').map(Number);
    return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
};
const hoyLocal = () => new Date(Date.now() - 5 * 3600 * 1000).toISOString().slice(0, 10);

// ── Bloqueo de periodos cerrados ──
export async function ultimoCierre(conn) {
    if (!esquema.trazabilidad) return null;
    const [[r]] = await conn.query("SELECT periodo, hasta FROM periodos_contables WHERE estado = 'cerrado' ORDER BY periodo DESC LIMIT 1");
    return r ? { periodo: r.periodo, hasta: String(r.hasta).slice(0, 10) } : null;
}

/** Lanza 400 si la fecha cae en un periodo cerrado (o antes). `que`: «ventas», «compras»… */
export async function exigirPeriodoAbierto(conn, fecha, que = 'documentos') {
    const c = await ultimoCierre(conn);
    if (c && String(fecha).slice(0, 10) <= c.hasta) {
        throw err(400, `Hasta el ${c.hasta} la contabilidad está cerrada (periodo ${c.periodo}): no se pueden registrar ni editar ${que} con esa fecha. Usa una fecha posterior.`);
    }
}

// ── Resultados de un periodo ──
export async function resultados(db, desde, hasta) {
    const ini = `${desde} 00:00:00`;
    const fin = `${hasta} 23:59:59`;
    const caja = esquema.caja;
    const vigente = (t) => (caja ? `(${t}.anulada_en IS NULL OR ${t}.anulada_en > ?)` : '1 = 1');
    const pVig = caja ? [fin] : [];

    const [[v]] = await db.query(`SELECT COUNT(*) n, COALESCE(SUM(total), 0) total FROM ventas v WHERE fecha BETWEEN ? AND ? AND ${vigente('v')}`, [ini, fin, ...pVig]);
    const [[vc]] = await db.query(`SELECT COALESCE(SUM(d.cantidad * d.costo_al_vender), 0) costo FROM venta_detalles d JOIN ventas v ON v.id = d.venta_id
        WHERE v.fecha BETWEEN ? AND ? AND ${vigente('v')}`, [ini, fin, ...pVig]);
    const [origen] = await db.query(`SELECT ${esquema.integracion ? 'origen' : "'pos'"} AS origen, COUNT(*) n, COALESCE(SUM(total), 0) total FROM ventas v
        WHERE fecha BETWEEN ? AND ? AND ${vigente('v')} GROUP BY 1 ORDER BY 1`, [ini, fin, ...pVig]);
    let anul = { n: 0, total: 0, costo: 0 };
    if (caja) {
        const [[a]] = await db.query('SELECT COUNT(*) n, COALESCE(SUM(total), 0) total FROM ventas WHERE fecha < ? AND anulada_en BETWEEN ? AND ?', [ini, ini, fin]);
        const [[ac]] = await db.query(`SELECT COALESCE(SUM(d.cantidad * d.costo_al_vender), 0) costo FROM venta_detalles d JOIN ventas v ON v.id = d.venta_id
            WHERE v.fecha < ? AND v.anulada_en BETWEEN ? AND ?`, [ini, ini, fin]);
        anul = { n: num(a.n), total: num(a.total), costo: num(ac.costo) };
    }

    const [gastosCat] = await db.query(`SELECT ${esquema.categoriasGasto ? 'COALESCE(c.nombre, g.categoria)' : 'g.categoria'} AS categoria, COUNT(*) n, COALESCE(SUM(g.monto), 0) total
        FROM gastos g ${esquema.categoriasGasto ? 'LEFT JOIN categorias_gasto c ON c.id = g.categoria_id' : ''}
        WHERE g.fecha BETWEEN ? AND ? AND ${vigente('g')} GROUP BY 1 ORDER BY total DESC`, [ini, fin, ...pVig]);
    const [[gAnul]] = caja ? await db.query('SELECT COALESCE(SUM(monto), 0) total FROM gastos WHERE fecha < ? AND anulada_en BETWEEN ? AND ?', [ini, ini, fin]) : [[{ total: 0 }]];
    const [[comp]] = await db.query(`SELECT COUNT(*) n, COALESCE(SUM(monto), 0) total FROM compras c WHERE fecha BETWEEN ? AND ? AND ${vigente('c')}`, [ini, fin, ...pVig]);
    const [[cAnul]] = caja ? await db.query('SELECT COALESCE(SUM(monto), 0) total FROM compras WHERE fecha < ? AND anulada_en BETWEEN ? AND ?', [ini, ini, fin]) : [[{ total: 0 }]];

    // Ajustes de inventario (conteos, roturas…) valorizados al costo del momento
    const [[aj]] = esquema.libro ? await db.query(`SELECT
            COALESCE(SUM(CASE WHEN cantidad < 0 THEN -cantidad * COALESCE(costo_unitario, 0) END), 0) faltantes,
            COALESCE(SUM(CASE WHEN cantidad > 0 THEN cantidad * COALESCE(costo_unitario, 0) END), 0) sobrantes
        FROM movimientos_inventario WHERE tipo = 'ajuste' AND creado_en BETWEEN ? AND ?`, [ini, fin]) : [[{ faltantes: 0, sobrantes: 0 }]];

    const ventasNetas = r2(num(v.total) - anul.total);
    const costoNeto = r2(num(vc.costo) - anul.costo);
    const gastos = r2(gastosCat.reduce((s, g) => s + num(g.total), 0) - num(gAnul.total));
    const mermas = r2(num(aj.faltantes) - num(aj.sobrantes));
    const utilidadBruta = r2(ventasNetas - costoNeto);

    return {
        desde, hasta,
        ventas: {
            n: num(v.n), brutas: r2(v.total), anulacionesAnteriores: r2(anul.total), anulacionesN: anul.n, netas: ventasNetas,
            porOrigen: origen.map((o) => ({ origen: o.origen, n: num(o.n), total: r2(o.total) }))
        },
        costoVentas: { bruto: r2(vc.costo), anulacionesAnteriores: r2(anul.costo), neto: costoNeto },
        utilidadBruta,
        margenBruto: ventasNetas > 0 ? Math.round((utilidadBruta / ventasNetas) * 1000) / 10 : 0,
        gastos: { total: gastos, anulacionesAnteriores: r2(gAnul.total), porCategoria: gastosCat.map((g) => ({ categoria: g.categoria || 'Sin categoría', n: num(g.n), total: r2(g.total) })) },
        ajustesInventario: { faltantes: r2(aj.faltantes), sobrantes: r2(aj.sobrantes), neto: mermas },
        utilidadOperativa: r2(utilidadBruta - gastos - mermas),
        compras: { n: num(comp.n), total: r2(comp.total), anulacionesAnteriores: r2(cAnul.total), neto: r2(num(comp.total) - num(cAnul.total)) },
        dinero: await dineroDelPeriodo(db, ini, fin),
        cartera: await carteraAl(db, fin),
        inventario: { inicial: await inventarioAl(db, `${desde} 00:00:00`, true), final: await inventarioAl(db, fin) }
    };
}

async function dineroDelPeriodo(db, ini, fin) {
    if (!esquema.caja) return null;
    const [rows] = await db.query(`SELECT mc.tipo, COALESCE(m.nombre, 'Sin método') metodo, mc.es_efectivo efectivo,
            COALESCE(SUM(CASE WHEN mc.monto > 0 THEN mc.monto END), 0) entradas, COALESCE(SUM(CASE WHEN mc.monto < 0 THEN -mc.monto END), 0) salidas
        FROM movimientos_caja mc LEFT JOIN metodos_pago m ON m.id = mc.metodo_pago_id
        WHERE mc.creado_en BETWEEN ? AND ? GROUP BY mc.tipo, metodo, efectivo`, [ini, fin]);
    const porMetodo = new Map();
    const porTipo = {};
    for (const r of rows) {
        const m = porMetodo.get(r.metodo) || { metodo: r.metodo, efectivo: Number(r.efectivo) === 1, entradas: 0, salidas: 0 };
        m.entradas = r2(m.entradas + num(r.entradas)); m.salidas = r2(m.salidas + num(r.salidas));
        porMetodo.set(r.metodo, m);
        porTipo[r.tipo] = r2((porTipo[r.tipo] || 0) + num(r.entradas) - num(r.salidas));
    }
    const lista = [...porMetodo.values()].map((m) => ({ ...m, neto: r2(m.entradas - m.salidas) }));
    return { porMetodo: lista, porTipo, neto: r2(lista.reduce((s, m) => s + m.neto, 0)) };
}

// Lo que los clientes deben a una fecha (ventas vigentes menos sus pagos vigentes a esa fecha)
async function carteraAl(db, fin) {
    const vig = (t) => (esquema.caja ? `(${t}.anulada_en IS NULL OR ${t}.anulada_en > ?)` : '1 = 1');
    const p = esquema.caja ? [fin] : [];
    const [[c]] = await db.query(`SELECT COUNT(*) n, COALESCE(SUM(saldo), 0) saldo FROM (
            SELECT v.total - COALESCE((SELECT SUM(pg.monto) FROM pagos pg WHERE pg.venta_id = v.id AND pg.fecha <= ? AND ${vig('pg')}), 0) AS saldo
            FROM ventas v WHERE v.fecha <= ? AND ${vig('v')}) x WHERE saldo > 0.01`, [fin, ...p, fin, ...p]);
    return { ventas: num(c.n), saldo: r2(c.saldo) };
}

/**
 * Inventario valorizado a una fecha: el último movimiento de cada ítem hasta entonces da su stock y
 * su costo promedio. Antes de la migración 018 el libro no guardaba el costo promedio: se usa el
 * costo actual y el resultado se marca como aproximado.
 */
async function inventarioAl(db, momento, antes = false) {
    if (!esquema.libro) return null;
    const [rows] = await db.query(`SELECT m.stock_resultante stock, ${esquema.trazabilidad ? 'm.costo_promedio' : 'NULL'} costo, i.precio_costo actual
        FROM movimientos_inventario m
        JOIN (SELECT inventario_id, MAX(id) mid FROM movimientos_inventario WHERE creado_en ${antes ? '<' : '<='} ? GROUP BY inventario_id) u ON u.mid = m.id
        JOIN inventario i ON i.id = m.inventario_id`, [momento]);
    let valor = 0;
    let aproximado = false;
    for (const r of rows) {
        const stock = Math.max(0, num(r.stock));
        if (!stock) continue;
        if (r.costo === null) aproximado = true;
        valor += stock * num(r.costo ?? r.actual);
    }
    return { valor: r2(valor), aproximado };
}

// ── Salud contable: todos los controles de integridad ──
export async function salud(db) {
    const controles = [];
    const agregar = (clave, titulo, ok, detalle, nivel = 'critico') => controles.push({ clave, titulo, ok, detalle, nivel });
    const contar = async (sql, p = []) => num((await db.query(sql, p))[0][0].n);

    const inv = esquema.libro ? await auditarStock(db) : [];
    agregar('libro_inventario', 'El stock de cada producto coincide con su libro de movimientos', inv.length === 0,
        inv.length ? `${inv.length} producto(s) no cuadran: ${inv.slice(0, 5).map((d) => d.nombre).join(', ')}` : 'Todos cuadran');
    if (esquema.caja) {
        const din = await auditarDinero(db);
        agregar('libro_dinero', 'Cada cobro, gasto y compra está registrado en la caja por su valor', din.length === 0,
            din.length ? `${din.length} documento(s) no cuadran con la caja` : 'Todos cuadran');
        const abiertas = await contar('SELECT COUNT(*) n FROM sesiones_caja WHERE abierta = 1');
        agregar('caja_unica', 'Hay exactamente una sesión de caja abierta', abiertas === 1, `${abiertas} abierta(s)`);
    }
    const totales = await contar(`SELECT COUNT(*) n FROM (SELECT v.id FROM ventas v JOIN venta_detalles d ON d.venta_id = v.id
        GROUP BY v.id, v.total HAVING ROUND(v.total, 2) <> ROUND(SUM(d.cantidad * d.precio_unitario), 2)) x`);
    agregar('totales_ventas', 'El total de cada venta es la suma de sus líneas', totales === 0, totales ? `${totales} venta(s) con diferencia` : 'Todas cuadran');
    const vig = esquema.caja ? 'AND p.anulada_en IS NULL' : '';
    const demas = await contar(`SELECT COUNT(*) n FROM (SELECT v.id FROM ventas v JOIN pagos p ON p.venta_id = v.id ${vig} GROUP BY v.id, v.total HAVING SUM(p.monto) > v.total + 0.01) x`);
    agregar('sobrepagos', 'Ninguna venta tiene pagos por encima de su total', demas === 0, demas ? `${demas} venta(s) pagadas de más` : 'Ninguna');
    const estados = await contar(`SELECT COUNT(*) n FROM (SELECT v.id FROM ventas v LEFT JOIN pagos p ON p.venta_id = v.id ${vig}
        ${esquema.caja ? 'WHERE v.anulada_en IS NULL' : ''} GROUP BY v.id, v.total, v.estado HAVING (v.estado = 'paid') <> (COALESCE(SUM(p.monto), 0) >= v.total - 0.01)) x`);
    agregar('estado_pago', 'El estado «pagada / pendiente» de cada venta coincide con sus pagos', estados === 0, estados ? `${estados} venta(s) con estado incoherente` : 'Todas coinciden');
    const negativos = await contar('SELECT COUNT(*) n FROM inventario WHERE stock < 0');
    agregar('stock_negativo', 'Ningún producto tiene existencias negativas', negativos === 0, negativos ? `${negativos} producto(s)` : 'Ninguno', 'aviso');
    const sinCosto = await contar(`SELECT COUNT(*) n FROM inventario WHERE ${esquema.inventarioTipos ? "activo = 1 AND tipo = 'terminado' AND" : ''} precio > 0 AND (precio_costo IS NULL OR precio_costo <= 0) AND id NOT IN (SELECT kit_id FROM kit_componentes)`).catch(() => 0);
    agregar('costos', 'Todos los productos a la venta tienen costo (sin costo, la utilidad sale inflada)', sinCosto === 0, sinCosto ? `${sinCosto} producto(s) sin costo` : 'Todos tienen costo', 'aviso');

    if (esquema.trazabilidad) {
        const [[resp]] = await db.query("SELECT MAX(creado_en) ultimo FROM auditoria WHERE accion = 'respaldar'");
        const dias = resp.ultimo ? (Date.now() - new Date(String(resp.ultimo).replace(' ', 'T') + '-05:00')) / 86400000 : null;
        agregar('respaldo', 'Hay un respaldo descargado en los últimos 7 días', dias !== null && dias <= 7,
            dias === null ? 'Nunca se ha descargado un respaldo desde el panel (Contabilidad → Libros)' : `Último respaldo: hace ${Math.floor(dias)} día(s)`, 'aviso');
        const cadena = await verificarCadena(db);
        agregar('auditoria', 'La bitácora de auditoría está completa y sin alteraciones', cadena.integra,
            cadena.integra ? `${cadena.total} registro(s) verificados` : `La cadena se rompe en el registro ${cadena.rotaEn}`);
        const [[t]] = await db.query("SELECT COUNT(*) n FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA = DATABASE() AND TRIGGER_NAME LIKE 'trg\\_%\\_no\\_%'");
        agregar('inmutables', 'La base impide modificar o borrar la bitácora y los libros de inventario y dinero', num(t.n) >= 6,
            num(t.n) >= 6 ? 'Protección activa en los 3 libros' : `Solo ${num(t.n)} de 6 protecciones activas (el servidor no permitió crearlas)`, 'aviso');
        const c = await ultimoCierre(db);
        const [y, m] = hoyLocal().split('-').map(Number);
        const mesAnterior = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
        agregar('periodos', 'Los meses terminados están cerrados', Boolean(c && c.periodo >= mesAnterior),
            c ? `Último mes cerrado: ${c.periodo}${c.periodo < mesAnterior ? ` (falta cerrar hasta ${mesAnterior})` : ''}` : 'Todavía no se ha cerrado ningún mes', 'aviso');
    }
    return { ok: controles.every((c) => c.ok || c.nivel !== 'critico'), controles, revisado: new Date().toISOString() };
}

// ── Cierre y reapertura de periodos ──
export async function listarPeriodos(db) {
    if (!esquema.trazabilidad) return [];
    const [rows] = await db.query(`SELECT p.periodo, p.desde, p.hasta, p.estado, p.cerrado_en, u.username cerrado_por, p.hash, p.notas,
            p.reabierto_en, r.username reabierto_por, p.motivo_reapertura, p.resumen
        FROM periodos_contables p LEFT JOIN usuarios u ON u.id = p.cerrado_por LEFT JOIN usuarios r ON r.id = p.reabierto_por ORDER BY p.periodo DESC`);
    return rows.map((r) => {
        let resumen = null;
        try { resumen = JSON.parse(r.resumen); } catch { /* foto ilegible */ }
        return { ...r, resumen, verificado: sha256(r.resumen) === r.hash };
    });
}
const sha256 = (t) => crypto.createHash('sha256').update(String(t)).digest('hex');

export async function cerrarPeriodo(conn, periodo, { usuario, notas } = {}) {
    if (!esquema.trazabilidad) throw err(503, 'Los cierres contables aún no están disponibles (migración 018 pendiente)');
    const { desde, hasta } = limitesPeriodo(periodo);
    if (hasta >= hoyLocal()) throw err(400, `El mes ${periodo} todavía no ha terminado: se cierra a partir del día siguiente a su último día`);
    const [[existente]] = await conn.query('SELECT estado FROM periodos_contables WHERE periodo = ? FOR UPDATE', [periodo]);
    if (existente?.estado === 'cerrado') throw err(400, `El periodo ${periodo} ya está cerrado`);
    const ultimo = await ultimoCierre(conn);
    if (ultimo && periodo !== siguiente(ultimo.periodo)) {
        throw err(400, `Los meses se cierran en orden: el siguiente por cerrar es ${siguiente(ultimo.periodo)}`);
    }
    const s = await salud(conn);
    if (!s.ok) throw err(400, `No se puede cerrar con problemas de integridad: ${s.controles.filter((c) => !c.ok && c.nivel === 'critico').map((c) => c.titulo).join('; ')}`);
    const resumen = JSON.stringify(await resultados(conn, desde, hasta));
    const hash = sha256(resumen);
    await conn.query(`INSERT INTO periodos_contables (periodo, desde, hasta, estado, cerrado_en, cerrado_por, resumen, hash, notas)
        VALUES (?, ?, ?, 'cerrado', NOW(), ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE estado = 'cerrado', cerrado_en = NOW(), cerrado_por = VALUES(cerrado_por), resumen = VALUES(resumen), hash = VALUES(hash), notas = VALUES(notas)`,
    [periodo, desde, hasta, usuario?.id || null, resumen, hash, notas ? String(notas).slice(0, 500) : null]);
    await auditar(conn, { accion: 'cerrar', entidad: 'periodo', entidadId: periodo, resumen: `Cierre contable de ${periodo}`, despues: { hash, ...JSON.parse(resumen) }, usuario });
    return { periodo, hash };
}

// Solo el último mes cerrado, con motivo: queda en la bitácora con la foto que tenía
export async function reabrirPeriodo(conn, periodo, { motivo, usuario } = {}) {
    if (String(motivo || '').trim().length < 10) throw err(400, 'Escribe el motivo de la reapertura (al menos 10 caracteres)');
    const ultimo = await ultimoCierre(conn);
    if (!ultimo || ultimo.periodo !== periodo) throw err(400, 'Solo se puede reabrir el último mes cerrado');
    const [[p]] = await conn.query('SELECT resumen, hash FROM periodos_contables WHERE periodo = ? FOR UPDATE', [periodo]);
    await conn.query("UPDATE periodos_contables SET estado = 'reabierto', reabierto_en = NOW(), reabierto_por = ?, motivo_reapertura = ? WHERE periodo = ?",
        [usuario?.id || null, String(motivo).trim().slice(0, 255), periodo]);
    await auditar(conn, { accion: 'reabrir', entidad: 'periodo', entidadId: periodo, resumen: `Reapertura de ${periodo}: ${String(motivo).trim()}`,
        antes: { hash: p.hash, ...JSON.parse(p.resumen) }, usuario });
}

// ── Respaldo completo (todas las tablas, sin las claves de los usuarios) ──
export async function respaldoCompleto(db) {
    const [tablas] = await db.query("SELECT TABLE_NAME AS t FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE' ORDER BY TABLE_NAME");
    const datos = {};
    for (const { t } of tablas) {
        const [rows] = await db.query(`SELECT * FROM \`${t}\``);
        datos[t] = t === 'usuarios' ? rows.map(({ password, ...u }) => u) : rows;
    }
    const [migs] = await db.query('SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1');
    return { sistema: 'Alta Densidad DATA', generado: new Date().toISOString(), esquema: migs[0]?.version || null, tablas: datos };
}

// ── Libros en CSV (Excel en español: separador «;» y decimales con coma) ──
const celda = (v) => {
    if (v === null || v === undefined) return '';
    if (typeof v === 'number') return String(v).replace('.', ',');
    const t = String(v);
    return /[;"\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
};
const csv = (columnas, filas) => '﻿' + [columnas.join(';'), ...filas.map((f) => f.map(celda).join(';'))].join('\r\n');

const LIBROS = {
    ventas: {
        nombre: 'Libro de ventas (por línea)',
        columnas: ['Fecha', 'Venta', 'Origen', 'Cliente', 'Cédula', 'Producto', 'Cantidad', 'Precio unitario', 'Subtotal', 'Costo unitario', 'Costo total', 'Utilidad', 'Estado', 'Anulada en', 'Motivo anulación'],
        sql: () => `SELECT v.fecha, v.id, ${esquema.integracion ? 'v.origen' : "'pos'"}, c.nombre, c.cedula, COALESCE(i.nombre, d.descripcion), d.cantidad, d.precio_unitario,
                d.cantidad * d.precio_unitario, d.costo_al_vender, d.cantidad * d.costo_al_vender, d.cantidad * (d.precio_unitario - d.costo_al_vender),
                v.estado, ${esquema.caja ? 'v.anulada_en, v.motivo_anulacion' : 'NULL, NULL'}
            FROM ventas v JOIN venta_detalles d ON d.venta_id = v.id LEFT JOIN clientes c ON c.id = v.cliente_id LEFT JOIN inventario i ON i.id = d.inventario_id
            WHERE v.fecha BETWEEN ? AND ? ORDER BY v.fecha, v.id, d.id`
    },
    cobros: {
        nombre: 'Cobros (pagos de clientes)',
        columnas: ['Fecha', 'Pago', 'Venta', 'Cliente', 'Método', 'Monto', 'Anulado en'],
        sql: () => `SELECT p.fecha, p.id, p.venta_id, c.nombre, p.metodo, p.monto, ${esquema.caja ? 'p.anulada_en' : 'NULL'}
            FROM pagos p JOIN ventas v ON v.id = p.venta_id LEFT JOIN clientes c ON c.id = v.cliente_id WHERE p.fecha BETWEEN ? AND ? ORDER BY p.fecha, p.id`
    },
    compras: {
        nombre: 'Libro de compras',
        columnas: ['Fecha', 'Compra', 'Proveedor', 'Factura', 'Producto', 'Cantidad', 'Costo unitario', 'Total', 'Método', 'Anulada en', 'Motivo anulación'],
        sql: () => `SELECT co.fecha, co.id, pr.nombre, ${esquema.recepciones ? 'rc.factura' : 'NULL'}, i.nombre, co.cantidad, co.precio_unitario, co.monto,
                ${esquema.caja ? 'mp.nombre, co.anulada_en, co.motivo_anulacion' : 'NULL, NULL, NULL'}
            FROM compras co LEFT JOIN proveedores pr ON pr.id = co.proveedor_id LEFT JOIN inventario i ON i.id = co.inventario_id
            ${esquema.recepciones ? 'LEFT JOIN recepciones rc ON rc.id = co.recepcion_id' : ''} ${esquema.caja ? 'LEFT JOIN metodos_pago mp ON mp.id = co.metodo_pago_id' : ''}
            WHERE co.fecha BETWEEN ? AND ? ORDER BY co.fecha, co.id`
    },
    gastos: {
        nombre: 'Libro de gastos',
        columnas: ['Fecha', 'Gasto', 'Categoría', 'Descripción', 'Monto', 'Método', 'Anulado en', 'Motivo anulación'],
        sql: () => `SELECT g.fecha, g.id, ${esquema.categoriasGasto ? 'COALESCE(cg.nombre, g.categoria)' : 'g.categoria'}, g.descripcion, g.monto,
                ${esquema.caja ? 'mp.nombre, g.anulada_en, g.motivo_anulacion' : 'NULL, NULL, NULL'}
            FROM gastos g ${esquema.categoriasGasto ? 'LEFT JOIN categorias_gasto cg ON cg.id = g.categoria_id' : ''} ${esquema.caja ? 'LEFT JOIN metodos_pago mp ON mp.id = g.metodo_pago_id' : ''}
            WHERE g.fecha BETWEEN ? AND ? ORDER BY g.fecha, g.id`
    },
    caja: {
        nombre: 'Libro de caja (todo el dinero que entró y salió)',
        columnas: ['Fecha y hora', 'Movimiento', 'Sesión', 'Tipo', 'Método', 'Efectivo', 'Monto', 'Documento', 'Descripción', 'Usuario'],
        requiere: 'caja',
        sql: () => `SELECT mc.creado_en, mc.id, mc.sesion_id, mc.tipo, m.nombre, IF(mc.es_efectivo, 'Sí', 'No'), mc.monto,
                CONCAT(COALESCE(mc.origen_tipo, ''), IF(mc.origen_id IS NULL, '', CONCAT(' #', mc.origen_id))), mc.descripcion, u.username
            FROM movimientos_caja mc LEFT JOIN metodos_pago m ON m.id = mc.metodo_pago_id LEFT JOIN usuarios u ON u.id = mc.usuario_id
            WHERE mc.creado_en BETWEEN ? AND ? ORDER BY mc.id`
    },
    inventario: {
        nombre: 'Kárdex (movimientos de inventario)',
        columnas: ['Fecha y hora', 'Movimiento', 'Producto', 'Tipo', 'Cantidad', 'Unidad', 'Saldo', 'Costo unitario', 'Costo promedio', 'Documento', 'Motivo', 'Usuario'],
        requiere: 'libro',
        sql: () => `SELECT m.creado_en, m.id, i.nombre, m.tipo, m.cantidad, ${esquema.inventarioTipos ? 'i.unidad' : "'und'"}, m.stock_resultante, m.costo_unitario,
                ${esquema.trazabilidad ? 'm.costo_promedio' : 'NULL'}, CONCAT(COALESCE(m.origen_tipo, ''), IF(m.origen_id IS NULL, '', CONCAT(' #', m.origen_id))), m.motivo, u.username
            FROM movimientos_inventario m JOIN inventario i ON i.id = m.inventario_id LEFT JOIN usuarios u ON u.id = m.usuario_id
            WHERE m.creado_en BETWEEN ? AND ? ORDER BY m.id`
    },
    auditoria: {
        nombre: 'Bitácora de auditoría',
        columnas: ['Fecha y hora', 'Registro', 'Usuario', 'Acción', 'Entidad', 'Id', 'Resumen', 'Antes', 'Después', 'Huella'],
        requiere: 'trazabilidad',
        sql: () => `SELECT creado_en, id, usuario, accion, entidad, entidad_id, resumen, antes, despues, hash FROM auditoria WHERE creado_en BETWEEN ? AND ? ORDER BY id`
    }
};
export const librosDisponibles = () => Object.entries(LIBROS).filter(([, l]) => !l.requiere || esquema[l.requiere]).map(([clave, l]) => ({ clave, nombre: l.nombre }));

export async function exportarLibro(db, libro, desde, hasta) {
    const l = LIBROS[libro];
    if (!l || (l.requiere && !esquema[l.requiere])) throw err(400, 'Libro no disponible');
    const [rows] = await db.query({ sql: l.sql(), rowsAsArray: true }, [`${desde} 00:00:00`, `${hasta} 23:59:59`]);
    // Montos y cantidades como número (coma decimal en Excel); lo demás como texto
    const filas = rows.map((r) => r.map((v) => (typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v) && v.length < 16 ? Number(v) : v)));
    return { nombre: `${libro}_${desde}_a_${hasta}.csv`, contenido: csv(l.columnas, filas) };
}
