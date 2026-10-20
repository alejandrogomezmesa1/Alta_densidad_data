// ============================================================
// Registro de ventas, compras y ajustes que no se cargaron en el punto de venta
// ------------------------------------------------------------
// Uso (desde backend/):
//   DATA_DB_URL=mysql://… node tools/registrar_movimientos.js tools/datos/movimientos_2026-10-18.json            → simulación
//   DATA_DB_URL=mysql://… node tools/registrar_movimientos.js tools/datos/movimientos_2026-10-18.json --aplicar  → aplica
//
// El plan trae:
//   fecha, motivo
//   ventas:  [{ id, nombre, cantidad, precio, metodo }]   una venta pagada por línea, sin cliente
//   compras: [{ id, nombre, cantidad, costo }]            entrada con costo (recalcula el promedio)
//   ajustes: [{ id, nombre, stock }]                       stock final con el motivo del plan
// Hace lo mismo que el panel (venta + pago + detalle con costo al vender; compra con costo promedio;
// ajuste con motivo), todo en una sola transacción. No se aplica dos veces: si el motivo ya está en
// el libro de inventario, se detiene.
// ============================================================
import fs from 'fs';
import mysql from 'mysql2/promise';
import { esquema } from '../estado.js';
import { moverStock, moverVenta, auditarStock } from '../inventario.js';
import { insertarPago } from '../catalogos.js';

const [archivo] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const APLICAR = process.argv.includes('--aplicar');
if (!archivo || !process.env.DATA_DB_URL) {
    console.error('Uso: DATA_DB_URL=mysql://… node tools/registrar_movimientos.js <plan.json> [--aplicar]');
    process.exit(1);
}
const plan = JSON.parse(fs.readFileSync(archivo, 'utf8'));
const { fecha, motivo } = plan;
const ventas = plan.ventas || [];
const compras = plan.compras || [];
const ajustes = plan.ajustes || [];
const fmt = (n) => Number(n).toLocaleString('es-CO', { maximumFractionDigits: 2 });
const mismo = (a, b) => String(a).trim().replace(/\s+/g, ' ').toLowerCase() === String(b).trim().replace(/\s+/g, ' ').toLowerCase();

const conn = await mysql.createConnection({ uri: process.env.DATA_DB_URL });
try {
    const [migs] = await conn.query('SELECT version FROM schema_migrations');
    const versiones = new Set(migs.map((m) => m.version));
    for (const v of ['003', '005', '006', '007', '010']) {
        if (!versiones.has(v)) throw new Error(`Falta la migración ${v} en la base`);
    }
    Object.assign(esquema, { integracion: true, inventarioTipos: true, libro: true, metodosPago: true, kits: true });

    if (!fecha || !motivo) throw new Error('El plan necesita fecha y motivo');
    const [[ya]] = await conn.query('SELECT COUNT(*) n FROM movimientos_inventario WHERE motivo = ?', [motivo]);
    if (Number(ya.n)) throw new Error(`Ya hay ${ya.n} movimientos con el motivo "${motivo}": el plan ya se aplicó`);

    // 1. Verificación: ids, nombres, precios y stock suficiente
    const ids = [...ventas, ...compras, ...ajustes].map((x) => x.id);
    const [filas] = await conn.query('SELECT id, nombre, stock, precio, precio_costo FROM inventario WHERE id IN (?)', [ids]);
    const porId = new Map(filas.map((f) => [f.id, f]));
    const errores = [];
    for (const x of [...ventas, ...compras, ...ajustes]) {
        const f = porId.get(x.id);
        if (!f) errores.push(`#${x.id} ${x.nombre}: no existe`);
        else if (!mismo(f.nombre, x.nombre)) errores.push(`#${x.id}: en la base se llama "${f.nombre}", el plan dice "${x.nombre}"`);
    }
    ventas.forEach((v) => { if (!(v.precio > 0) || !(v.cantidad > 0)) errores.push(`Venta de ${v.nombre}: precio y cantidad deben ser mayores que 0`); });
    compras.forEach((c) => { if (!(c.costo > 0) || !(c.cantidad > 0)) errores.push(`Compra de ${c.nombre}: costo y cantidad deben ser mayores que 0`); });
    if (errores.length) throw new Error('El plan no coincide con la base:\n  ' + errores.join('\n  '));

    // 2. Qué se va a registrar
    console.log(`\n${APLICAR ? 'APLICANDO' : 'SIMULACIÓN (usa --aplicar para registrar)'} · ${fecha} · "${motivo}"\n`);
    const total = ventas.reduce((s, v) => s + v.precio * v.cantidad, 0);
    console.log(`Ventas: ${ventas.length} · total $${fmt(total)}`);
    ventas.forEach((v) => {
        const f = porId.get(v.id);
        console.log(`  #${v.id} ${f.nombre}: ${v.cantidad} × $${fmt(v.precio)} (${v.metodo}) · stock ${fmt(f.stock)} → ${fmt(f.stock - v.cantidad)}`);
    });
    console.log(`\nCompras: ${compras.length}`);
    compras.forEach((c) => {
        const f = porId.get(c.id);
        console.log(`  #${c.id} ${f.nombre}: ${c.cantidad} × $${fmt(c.costo)} · stock ${fmt(f.stock)} → ${fmt(Number(f.stock) + c.cantidad)}`);
    });
    console.log(`\nAjustes: ${ajustes.length}`);
    ajustes.forEach((a) => { const f = porId.get(a.id); console.log(`  #${a.id} ${f.nombre}: ${fmt(f.stock)} → ${fmt(a.stock)}`); });

    // 3. Aplicar en una sola transacción
    if (APLICAR) {
        await conn.beginTransaction();
        for (const v of ventas) {
            const subtotal = v.precio * v.cantidad;
            const [r] = await conn.query("INSERT INTO ventas (total, fecha, cliente_id, estado, metodo) VALUES (?, ?, NULL, 'paid', ?)", [subtotal, fecha, v.metodo]);
            await insertarPago(conn, { ventaId: r.insertId, monto: subtotal, fecha, metodo: v.metodo });
            const m = await moverVenta(conn, { inventarioId: v.id, cantidad: -v.cantidad, tipo: 'venta', origenTipo: 'venta', origenId: r.insertId, motivo });
            await conn.query('INSERT INTO venta_detalles (venta_id, inventario_id, cantidad, precio_unitario, costo_al_vender, descripcion) VALUES (?, ?, ?, ?, ?, NULL)',
                [r.insertId, v.id, v.cantidad, v.precio, m ? m.costo : 0]);
        }
        for (const c of compras) {
            const [r] = await conn.query('INSERT INTO compras (inventario_id, proveedor_id, cantidad, monto, precio_unitario, fecha) VALUES (?, NULL, ?, ?, ?, ?)',
                [c.id, c.cantidad, c.costo * c.cantidad, c.costo, fecha]);
            await moverStock(conn, { inventarioId: c.id, cantidad: c.cantidad, tipo: 'compra', costoUnitario: c.costo, recalcularCosto: true,
                origenTipo: 'compra', origenId: r.insertId, motivo });
        }
        for (const a of ajustes) {
            const actual = Number(porId.get(a.id).stock);
            if (actual !== a.stock) await moverStock(conn, { inventarioId: a.id, cantidad: a.stock - actual, tipo: 'ajuste', origenTipo: 'ajuste', motivo });
        }
        await conn.commit();
        const diferencias = await auditarStock(conn);
        console.log(`\nListo. Libro de inventario: ${diferencias.length ? `${diferencias.length} diferencias` : 'cuadra'}.`);
    }
} catch (err) {
    await conn.rollback().catch(() => {});
    console.error('\n✘ ' + err.message);
    process.exitCode = 1;
} finally {
    await conn.end();
}
