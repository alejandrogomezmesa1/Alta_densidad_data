// ============================================================
// Bitácora de auditoría encadenada (migración 018)
// ------------------------------------------------------------
// Cada cambio contable deja un registro: cuándo, quién, qué acción, sobre qué y cómo estaba antes y
// después. Se escribe en la MISMA transacción del cambio (si el cambio no se guarda, tampoco su
// registro). Cada registro lleva la huella SHA-256 del anterior más la suya: alterar o borrar uno
// rompe la cadena y verificarCadena lo detecta. La base, además, impide modificar o borrar la tabla.
// ============================================================
import crypto from 'crypto';
import { esquema } from './estado.js';

const sha256 = (t) => crypto.createHash('sha256').update(t).digest('hex');

// Fecha y hora de Colombia con milisegundos (la misma que queda guardada y entra en la huella)
function ahoraLocal() {
    const d = new Date(Date.now() - 5 * 3600 * 1000);
    return d.toISOString().replace('T', ' ').slice(0, 23);
}

const texto = (v) => (v === undefined || v === null ? null : JSON.stringify(v));

// Lo que se firma: siempre el mismo orden y las mismas cadenas que quedan en la base
const contenido = (r) => JSON.stringify([r.creado_en, r.usuario_id ?? null, r.accion, r.entidad, r.entidad_id ?? null, r.resumen ?? null, r.antes ?? null, r.despues ?? null]);

/**
 * @param conn conexión en la transacción del cambio
 * @param {{accion:string, entidad:string, entidadId?:string|number, resumen?:string, antes?:object, despues?:object, usuario?:{id?:number, nombre?:string}}} a
 */
export async function auditar(conn, a) {
    if (!esquema.trazabilidad) return;
    const [[cadena]] = await conn.query('SELECT ultimo_hash FROM auditoria_cadena WHERE id = 1 FOR UPDATE');
    const r = {
        creado_en: ahoraLocal(),
        usuario_id: a.usuario?.id || null,
        accion: String(a.accion).slice(0, 30),
        entidad: String(a.entidad).slice(0, 40),
        entidad_id: a.entidadId === undefined || a.entidadId === null ? null : String(a.entidadId).slice(0, 40),
        resumen: a.resumen ? String(a.resumen).slice(0, 255) : null,
        antes: texto(a.antes),
        despues: texto(a.despues)
    };
    const anterior = cadena?.ultimo_hash || '0'.repeat(64);
    const hash = sha256(anterior + contenido(r));
    const [ins] = await conn.query(
        `INSERT INTO auditoria (creado_en, usuario_id, usuario, accion, entidad, entidad_id, resumen, antes, despues, hash_anterior, hash)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [r.creado_en, r.usuario_id, a.usuario?.nombre ? String(a.usuario.nombre).slice(0, 120) : null, r.accion, r.entidad, r.entidad_id, r.resumen, r.antes, r.despues, anterior, hash]);
    await conn.query('UPDATE auditoria_cadena SET ultimo_id = ?, ultimo_hash = ? WHERE id = 1', [ins.insertId, hash]);
}

// Usuario de una petición del panel (o la tienda web en la integración)
export const usuarioDe = (req) => (req?.user ? { id: req.user.id, nombre: req.user.username } : null);
export const TIENDA_WEB = { id: null, nombre: 'Tienda web (Mercado Pago)' };

// Una fila tal como está (para el «antes» y el «después»)
export async function fila(conn, tabla, id) {
    const [[r]] = await conn.query(`SELECT * FROM ${tabla} WHERE id = ?`, [id]);
    return r || null;
}

// Una venta completa: cabecera, líneas y pagos
export async function documentoVenta(conn, id) {
    const venta = await fila(conn, 'ventas', id);
    if (!venta) return null;
    const [lineas] = await conn.query('SELECT inventario_id, descripcion, cantidad, precio_unitario, costo_al_vender FROM venta_detalles WHERE venta_id = ? ORDER BY id', [id]);
    const [pagos] = await conn.query('SELECT id, monto, fecha, metodo, anulada_en FROM pagos WHERE venta_id = ? ORDER BY id', [id]);
    return { ...venta, lineas, pagos };
}

/** Recorre toda la bitácora: cada eslabón apunta al anterior y su huella corresponde a su contenido. */
export async function verificarCadena(db) {
    if (!esquema.trazabilidad) return { disponible: false };
    let anterior = '0'.repeat(64);
    let total = 0;
    let desde = 0;
    for (;;) {
        const [rows] = await db.query(`SELECT id, DATE_FORMAT(creado_en, '%Y-%m-%d %H:%i:%s.%f') AS creado_en, usuario_id, accion, entidad, entidad_id, resumen, antes, despues, hash_anterior, hash
            FROM auditoria WHERE id > ? ORDER BY id LIMIT 2000`, [desde]);
        if (!rows.length) break;
        for (const r of rows) {
            r.creado_en = r.creado_en.slice(0, 23); // %f da microsegundos: se guardan milisegundos
            if (r.hash_anterior !== anterior || sha256(anterior + contenido(r)) !== r.hash) {
                return { disponible: true, integra: false, total, rotaEn: r.id };
            }
            anterior = r.hash;
            total += 1;
            desde = r.id;
        }
    }
    const [[c]] = await db.query('SELECT ultimo_hash FROM auditoria_cadena WHERE id = 1');
    // El último eslabón guardado aparte debe coincidir: si borraran los últimos registros, no cuadraría
    if (c && total > 0 && c.ultimo_hash !== anterior) return { disponible: true, integra: false, total, rotaEn: 'final' };
    return { disponible: true, integra: true, total };
}
