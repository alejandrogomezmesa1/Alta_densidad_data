// ============================================================
// Carga de un conteo físico al inventario de DATA
// ------------------------------------------------------------
// Uso (desde backend/):
//   DATA_DB_URL=mysql://… node tools/cargar_conteo.js tools/datos/conteo_2026-09-29.json            → solo muestra
//   DATA_DB_URL=mysql://… node tools/cargar_conteo.js tools/datos/conteo_2026-09-29.json --aplicar  → aplica
//
// El archivo trae:
//   ajustes: [{ id, nombre, stock }]  stock final de ítems existentes (el nombre debe coincidir)
//   ceros:   [{ id, nombre }]         ítems que no aparecieron en el conteo → stock 0
//   kits:    [{ id, nombre, componentes: [{ id, cantidad }] }]  kits que quedan armados
//   nuevos:  [{ nombre, categoria, tipo, unidad, stock, precio, costo }]  (si el nombre ya existe, se omite)
// Todo cambio de stock pasa por moverStock (queda en el libro con el motivo) y va en una sola
// transacción: si algo falla, no se aplica nada. Se puede repetir: lleva cada ítem al stock pedido.
// ============================================================
import fs from 'fs';
import mysql from 'mysql2/promise';
import { esquema } from '../estado.js';
import { moverStock, auditarStock } from '../inventario.js';

const [archivo] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const APLICAR = process.argv.includes('--aplicar');
if (!archivo || !process.env.DATA_DB_URL) {
    console.error('Uso: DATA_DB_URL=mysql://… node tools/cargar_conteo.js <conteo.json> [--aplicar]');
    process.exit(1);
}
const plan = JSON.parse(fs.readFileSync(archivo, 'utf8'));
const motivo = plan.motivo || 'Conteo físico';
const fmt = (n) => Number(n).toLocaleString('es-CO', { maximumFractionDigits: 2 });
const mismo = (a, b) => String(a).trim().replace(/\s+/g, ' ').toLowerCase() === String(b).trim().replace(/\s+/g, ' ').toLowerCase();

const conn = await mysql.createConnection({ uri: process.env.DATA_DB_URL, multipleStatements: false });
try {
    const [migs] = await conn.query('SELECT version FROM schema_migrations');
    const versiones = new Set(migs.map((m) => m.version));
    for (const v of ['005', '006', '010']) {
        if (!versiones.has(v)) throw new Error(`Falta la migración ${v} en la base: despliega DATA antes de cargar el conteo`);
    }
    Object.assign(esquema, { inventarioTipos: true, libro: true, kits: true });

    const [filas] = await conn.query('SELECT id, nombre, categoria, stock, activo FROM inventario');
    const porId = new Map(filas.map((f) => [f.id, f]));

    // 1. Verificación: cada id existe y su nombre coincide con el del plan. Un ajuste sin id se busca por
    //    nombre exacto (ítems creados en un conteo anterior) y debe haber uno solo con ese nombre.
    const errores = [];
    for (const x of plan.ajustes) {
        if (x.id) continue;
        const iguales = filas.filter((f) => mismo(f.nombre, x.nombre) && f.activo !== 0);
        if (iguales.length === 1) x.id = iguales[0].id;
        else errores.push(`"${x.nombre}": ${iguales.length ? `${iguales.length} ítems con ese nombre` : 'no existe'}`);
    }
    for (const x of [...plan.ajustes, ...plan.ceros]) {
        const f = porId.get(x.id);
        if (!f) errores.push(`#${x.id} ${x.nombre}: no existe`);
        else if (!mismo(f.nombre, x.nombre)) errores.push(`#${x.id}: en la base se llama "${f.nombre}", el plan dice "${x.nombre}"`);
    }
    for (const k of plan.kits || []) {
        if (!porId.has(k.id)) errores.push(`Kit #${k.id} ${k.nombre}: no existe`);
        k.componentes.forEach((c) => { if (!porId.has(c.id)) errores.push(`Componente #${c.id} del kit ${k.nombre}: no existe`); });
    }
    if (errores.length) throw new Error('El plan no coincide con la base:\n  ' + errores.join('\n  '));

    // 2. Qué cambia
    const cambios = [
        ...plan.ajustes.map((a) => ({ ...a, actual: Number(porId.get(a.id).stock) })),
        ...plan.ceros.map((c) => ({ ...c, stock: 0, actual: Number(porId.get(c.id).stock) }))
    ].filter((c) => c.actual !== c.stock);
    const nuevos = plan.nuevos.filter((n) => !filas.some((f) => mismo(f.nombre, n.nombre)));
    const omitidos = plan.nuevos.filter((n) => !nuevos.includes(n));

    console.log(`\n${APLICAR ? 'APLICANDO' : 'SIMULACIÓN (usa --aplicar para cargar)'} · motivo: "${motivo}"\n`);
    console.log(`Ajustes de stock: ${cambios.length} (de ${plan.ajustes.length + plan.ceros.length} ítems revisados; el resto ya está igual)`);
    cambios.forEach((c) => console.log(`  #${c.id} ${c.nombre}: ${fmt(c.actual)} → ${fmt(c.stock)}`));
    console.log(`\nKits armados: ${(plan.kits || []).length}`);
    (plan.kits || []).forEach((k) => console.log(`  #${k.id} ${k.nombre} = ${k.componentes.map((c) => `${c.cantidad} × ${porId.get(c.id).nombre}`).join(' + ')}`));
    console.log(`\nÍtems nuevos: ${nuevos.length}${omitidos.length ? ` (${omitidos.length} ya existían y se omiten)` : ''}`);
    const porCategoria = nuevos.reduce((m, n) => m.set(n.categoria, (m.get(n.categoria) || 0) + 1), new Map());
    porCategoria.forEach((n, c) => console.log(`  ${c}: ${n}`));
    omitidos.forEach((n) => console.log(`  (ya existe) ${n.nombre}`));

    // 3. Aplicar en una sola transacción
    if (APLICAR) {
        await conn.beginTransaction();
        for (const c of cambios) {
            await moverStock(conn, { inventarioId: c.id, cantidad: c.stock - c.actual, tipo: 'ajuste', origenTipo: 'ajuste', motivo });
        }
        for (const k of plan.kits || []) {
            await conn.query('DELETE FROM kit_componentes WHERE kit_id = ?', [k.id]);
            for (const c of k.componentes) {
                await conn.query('INSERT INTO kit_componentes (kit_id, componente_id, cantidad) VALUES (?, ?, ?)', [k.id, c.id, c.cantidad]);
            }
            const [[kit]] = await conn.query('SELECT stock FROM inventario WHERE id = ?', [k.id]);
            if (Number(kit.stock) !== 0) {
                await moverStock(conn, { inventarioId: k.id, cantidad: -Number(kit.stock), tipo: 'ajuste', origenTipo: 'ajuste',
                    motivo: `${motivo} · kit armado: sus existencias salen de los componentes`, permitirNegativo: true });
            }
        }
        for (const n of nuevos) {
            const [r] = await conn.query(
                'INSERT INTO inventario (nombre, categoria, precio, precio_costo, stock, tipo, unidad) VALUES (?, ?, ?, ?, 0, ?, ?)',
                [n.nombre, n.categoria, n.precio || 0, n.costo || 0, n.tipo, n.unidad]);
            if (n.stock > 0) {
                await moverStock(conn, { inventarioId: r.insertId, cantidad: n.stock, tipo: 'inicial', costoUnitario: n.costo || 0,
                    origenTipo: 'producto', origenId: r.insertId, motivo });
            }
        }
        await conn.commit();

        const diferencias = await auditarStock(conn);
        console.log(`\nListo. Libro de inventario: ${diferencias.length ? `${diferencias.length} diferencias` : 'cuadra'}.`);
    }
    if (plan.pendientes?.length) console.log('\nPendientes:\n  - ' + plan.pendientes.join('\n  - '));
} catch (err) {
    await conn.rollback().catch(() => {});
    console.error('\n✘ ' + err.message);
    process.exitCode = 1;
} finally {
    await conn.end();
}
