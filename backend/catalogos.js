// Listas cerradas: métodos de pago y categorías de gasto.
// Los formularios envían el nombre; aquí se traduce a su ID (creándolo si es nuevo).
import { esquema } from './estado.js';

const limpiar = (v) => String(v || '').trim().substring(0, 60);

export async function metodoPagoId(conn, nombre) {
    if (!esquema.metodosPago) return null;
    const n = limpiar(nombre) || 'Efectivo';
    const [rows] = await conn.query('SELECT id FROM metodos_pago WHERE nombre = ?', [n]);
    if (rows.length) return rows[0].id;
    const [r] = await conn.query('INSERT INTO metodos_pago (nombre, es_efectivo) VALUES (?, 0)', [n]);
    return r.insertId;
}

export async function categoriaGastoId(conn, nombre) {
    if (!esquema.categoriasGasto) return null;
    const n = limpiar(nombre) || 'Otros';
    const [rows] = await conn.query('SELECT id FROM categorias_gasto WHERE nombre = ?', [n]);
    if (rows.length) return rows[0].id;
    const [r] = await conn.query('INSERT INTO categorias_gasto (nombre) VALUES (?)', [n]);
    return r.insertId;
}

// Inserta un pago con su método (texto y, si existe la tabla, su ID)
export async function insertarPago(conn, { ventaId, monto, fecha, metodo }) {
    const nombre = limpiar(metodo) || 'Efectivo';
    if (esquema.metodosPago) {
        const id = await metodoPagoId(conn, nombre);
        await conn.query('INSERT INTO pagos (venta_id, monto, fecha, metodo, metodo_pago_id) VALUES (?, ?, ?, ?, ?)', [ventaId, monto, fecha, nombre, id]);
    } else {
        await conn.query('INSERT INTO pagos (venta_id, monto, fecha, metodo) VALUES (?, ?, ?, ?)', [ventaId, monto, fecha, nombre]);
    }
}
