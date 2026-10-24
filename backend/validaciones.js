// ============================================================
// Validaciones de los documentos (ventas, compras, gastos, pagos)
// ------------------------------------------------------------
// El servidor no confía en el navegador: la fecha, el cliente y cada línea se revisan aquí,
// dentro de la transacción, antes de mover inventario o dinero.
// ============================================================
import { esquema } from './estado.js';
import { componentesDe } from './inventario.js';

const err400 = (mensaje, extra = {}) => Object.assign(new Error(mensaje), { status: 400, ...extra });
const pesos = (n) => `$${Math.round(Number(n) || 0).toLocaleString('es-CO')}`;
export const redondear2 = (n) => Math.round(Number(n) * 100) / 100;

// Fecha y hora local de Medellín en el formato DATETIME del sistema
export const fechaLocal = () => {
    const parts = Object.fromEntries(
        new Intl.DateTimeFormat('en-CA', {
            timeZone: 'America/Bogota', hour12: false,
            year: 'numeric', month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit', second: '2-digit'
        }).formatToParts(new Date()).map(p => [p.type, p.value])
    );
    const hour = parts.hour === '24' ? '00' : parts.hour;
    return `${parts.year}-${parts.month}-${parts.day} ${hour}:${parts.minute}:${parts.second}`;
};

/**
 * Fecha de un documento. Obligatoria y nunca futura. El panel envía solo el día:
 *   · hoy → la hora real del registro;
 *   · al editar, si el día no cambió → se conserva la fecha y hora original;
 *   · un día anterior → ese día a las 00:00.
 */
export function fechaDocumento(valor, { original = null, campo = 'La fecha' } = {}) {
    const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(String(valor ?? '').trim());
    if (!m) throw err400(`${campo} es obligatoria (AAAA-MM-DD)`);
    const [, y, mo, d, hh, mi, ss] = m;
    const prueba = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d)));
    if (prueba.getUTCMonth() !== Number(mo) - 1 || prueba.getUTCDate() !== Number(d)) throw err400(`${campo} no es válida: ${valor}`);
    const dia = `${y}-${mo}-${d}`;
    const ahora = fechaLocal();
    if (dia > ahora.slice(0, 10)) throw err400(`${campo} no puede ser futura (${dia})`);
    if (original && String(original).slice(0, 10) === dia) return String(original);
    if (hh !== undefined) return `${dia} ${hh}:${mi}:${ss || '00'}`;
    return dia === ahora.slice(0, 10) ? ahora : `${dia} 00:00:00`;
}

const texto = (v, max) => (v == null || String(v).trim() === '' ? null : String(v).trim().replace(/\s+/g, ' ').substring(0, max));

/**
 * Cliente de una venta sin duplicarlo: id elegido → cédula → teléfono → nombre exacto (si es único).
 * Si ya existe, solo completa los datos que le falten. Sin nombre ni id, la venta queda sin cliente.
 */
export async function resolverCliente(conn, datos = {}) {
    const elegido = Number.parseInt(datos.customerId, 10);
    if (elegido) {
        const [c] = await conn.query('SELECT id FROM clientes WHERE id = ?', [elegido]);
        if (!c.length) throw err400('El cliente elegido ya no existe');
        return elegido;
    }
    const nombre = texto(datos.customerName, 255);
    if (!nombre) return null;
    const cedula = texto(datos.idDocument, 50);
    const telefono = texto(datos.phone, 50);
    let id = null;
    if (cedula) {
        const [c] = await conn.query('SELECT id FROM clientes WHERE cedula = ?', [cedula]);
        id = c[0]?.id || null;
    }
    if (!id && telefono) {
        const [c] = await conn.query('SELECT id FROM clientes WHERE telefono = ? LIMIT 2', [telefono]);
        if (c.length === 1) id = c[0].id;
    }
    if (!id) {
        const [c] = await conn.query('SELECT id, cedula FROM clientes WHERE LOWER(TRIM(nombre)) = LOWER(?) LIMIT 2', [nombre]);
        // Mismo nombre pero otra cédula: es otra persona
        if (c.length === 1 && !(cedula && c[0].cedula && c[0].cedula !== cedula)) id = c[0].id;
    }
    if (id) {
        await conn.query(
            'UPDATE clientes SET cedula = COALESCE(cedula, ?), telefono = COALESCE(telefono, ?), ciudad = COALESCE(ciudad, ?), direccion = COALESCE(direccion, ?) WHERE id = ?',
            [cedula, telefono, texto(datos.city, 100), texto(datos.address, 255), id]);
        return id;
    }
    const [nuevo] = await conn.query('INSERT INTO clientes (nombre, telefono, cedula, ciudad, direccion) VALUES (?, ?, ?, ?, ?)',
        [nombre, telefono, cedula, texto(datos.city, 100), texto(datos.address, 255)]);
    return nuevo.insertId;
}

/**
 * Líneas de una venta del panel contra el inventario: el ítem existe y está activo, lo que se cuenta
 * por unidades va en enteros y no se vende por debajo del costo sin confirmarlo (allowBelowCost).
 */
export async function validarLineasVenta(conn, items) {
    const ids = [...new Set(items.map((i) => i.productId))];
    const [rows] = await conn.query(
        `SELECT id, nombre, precio_costo${esquema.inventarioTipos ? ', unidad, activo' : ", 'und' AS unidad, 1 AS activo"} FROM inventario WHERE id IN (?)`, [ids]);
    const porId = new Map(rows.map((r) => [r.id, r]));
    for (const item of items) {
        const p = porId.get(item.productId);
        if (!p) throw err400(`El producto ${item.productId} no existe en el inventario`);
        if (!Number(p.activo)) throw err400(`«${p.nombre}» está desactivado: no se puede vender`);
        if (p.unidad === 'und' && !Number.isInteger(item.quantity)) throw err400(`«${p.nombre}» se vende por unidades: la cantidad debe ser un número entero`);
        const componentes = await componentesDe(conn, p.id);
        const costo = componentes.length ? componentes.reduce((s, c) => s + c.cantidad * c.costo, 0) : Number(p.precio_costo) || 0;
        if (costo > 0 && item.unitPrice < costo - 0.005 && !item.allowBelowCost) {
            throw err400(`«${p.nombre}» se vendería a ${pesos(item.unitPrice)}, por debajo de su costo (${pesos(costo)}). Confírmalo en el panel para registrarlo.`, { code: 'BAJO_COSTO' });
        }
    }
}

// Un ítem activo para registrarle una compra
export async function validarItemCompra(conn, inventarioId) {
    const [rows] = await conn.query(`SELECT id, nombre${esquema.inventarioTipos ? ', activo' : ', 1 AS activo'} FROM inventario WHERE id = ?`, [inventarioId]);
    if (!rows.length) throw err400(`El producto ${inventarioId} no existe en el inventario`);
    if (!Number(rows[0].activo)) throw err400(`«${rows[0].nombre}» está desactivado: reactívalo antes de comprarlo`);
}
