// Listas cerradas: métodos de pago y categorías de gasto.
// Los formularios envían el nombre; aquí se traduce a su ID. Desde el panel solo valen los que
// existen y están activos (crear: false); la integración web y los scripts los crean si son nuevos.
import { esquema } from './estado.js';
import { sincronizarDinero } from './caja.js';

const limpiar = (v) => String(v || '').trim().substring(0, 60);
const err400 = (mensaje) => Object.assign(new Error(mensaje), { status: 400 });

export async function metodoPagoId(conn, nombre, { crear = true } = {}) {
    if (!esquema.metodosPago) return null;
    const n = limpiar(nombre) || 'Efectivo';
    const [rows] = await conn.query('SELECT id, activo FROM metodos_pago WHERE nombre = ?', [n]);
    if (rows.length && (crear || rows[0].activo)) return rows[0].id;
    if (!crear) throw err400(`El método de pago «${n}» no existe o está inactivo`);
    const [r] = await conn.query('INSERT INTO metodos_pago (nombre, es_efectivo) VALUES (?, 0)', [n]);
    return r.insertId;
}

export async function categoriaGastoId(conn, nombre, { crear = true } = {}) {
    if (!esquema.categoriasGasto) return null;
    const n = limpiar(nombre) || 'Otros';
    const [rows] = await conn.query('SELECT id, activo FROM categorias_gasto WHERE nombre = ?', [n]);
    if (rows.length && (crear || rows[0].activo)) return rows[0].id;
    if (!crear) throw err400(`La categoría de gasto «${n}» no existe o está inactiva`);
    const [r] = await conn.query('INSERT INTO categorias_gasto (nombre) VALUES (?)', [n]);
    return r.insertId;
}

// Inserta un pago con su método (texto y, si existe la tabla, su ID) y lo registra en la caja abierta
export async function insertarPago(conn, { ventaId, monto, fecha, metodo, crear = true, usuarioId = null }) {
    const nombre = limpiar(metodo) || 'Efectivo';
    if (esquema.metodosPago) {
        const id = await metodoPagoId(conn, nombre, { crear });
        const [r] = await conn.query(`INSERT INTO pagos (venta_id, monto, fecha, metodo, metodo_pago_id${esquema.trazabilidad ? ', creado_por' : ''}) VALUES (?, ?, ?, ?, ?${esquema.trazabilidad ? ', ?' : ''})`,
            [ventaId, monto, fecha, nombre, id, ...(esquema.trazabilidad ? [usuarioId || null] : [])]);
        // La tarjeta de regalo no mueve la caja: su dinero entró cuando se vendió
        const [[m]] = esquema.tarjetas ? await conn.query('SELECT mueve_caja FROM metodos_pago WHERE id = ?', [id]) : [[null]];
        if (!m || Number(m.mueve_caja) !== 0) {
            await sincronizarDinero(conn, { origenTipo: 'pago', origenId: r.insertId, tipo: 'cobro', monto: Number(monto), metodoPagoId: id,
                descripcion: `Pago de la venta #${ventaId}`, usuarioId });
        }
        return r.insertId;
    }
    const [r] = await conn.query('INSERT INTO pagos (venta_id, monto, fecha, metodo) VALUES (?, ?, ?, ?)', [ventaId, monto, fecha, nombre]);
    return r.insertId;
}
