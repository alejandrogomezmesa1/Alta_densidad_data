// ============================================================
// Configuraciones del sistema
// ------------------------------------------------------------
// Registro de todo lo que se puede ajustar desde el módulo Configuraciones. Para agregar una
// configuración nueva basta con añadirla aquí: el panel de DATA y el de la tienda la muestran
// solos (agrupada, con su etiqueta, ayuda y límites). "web: true" la expone a la tienda por la
// integración privada. Los valores se guardan en la tabla configuraciones (migración 011); si
// una clave no tiene valor guardado, rige su valor por defecto.
// ============================================================
import { esquema } from './estado.js';

export const DEFINICIONES = [
    {
        clave: 'stock_advertencia_und', grupo: 'Inventario · semáforo de stock', tipo: 'numero', unidad: 'und',
        etiqueta: 'Advertencia en productos por unidad',
        ayuda: 'Con esta cantidad o menos, el producto se marca en amarillo (advertencia). En 0 se marca en rojo (agotado) y por encima en verde (disponible). Si un ítem tiene su propio stock mínimo, se usa ese.',
        min: 0, max: 1000, paso: 1, defecto: 1, web: true
    },
    {
        clave: 'stock_advertencia_ml', grupo: 'Inventario · semáforo de stock', tipo: 'numero', unidad: 'ml',
        etiqueta: 'Advertencia en esencias y líquidos',
        ayuda: 'Para lo que se mide en ml (esencias, bases, feromonas): con estos ml o menos se marca en amarillo.',
        min: 0, max: 100000, paso: 1, defecto: 30, web: true
    }
];

const porClave = new Map(DEFINICIONES.map((d) => [d.clave, d]));

function convertir(def, valor) {
    if (def.tipo === 'numero') {
        const n = Number(String(valor).replace(',', '.'));
        if (!Number.isFinite(n)) throw Object.assign(new Error(`«${def.etiqueta}» debe ser un número`), { status: 400 });
        if (n < def.min || n > def.max) throw Object.assign(new Error(`«${def.etiqueta}» debe estar entre ${def.min} y ${def.max}`), { status: 400 });
        return n;
    }
    if (def.tipo === 'booleano') return valor === true || valor === 'true' || valor === 1 || valor === '1';
    return String(valor ?? '').slice(0, 500);
}

// { clave: valor } con los valores por defecto aplicados
export async function leerConfiguraciones(db, { soloWeb = false } = {}) {
    const valores = {};
    DEFINICIONES.forEach((d) => { if (!soloWeb || d.web) valores[d.clave] = d.defecto; });
    if (!esquema.configuraciones) return valores;
    const [rows] = await db.query('SELECT clave, valor FROM configuraciones');
    for (const r of rows) {
        const def = porClave.get(r.clave);
        if (!def || (soloWeb && !def.web) || r.valor === null) continue;
        try { valores[r.clave] = convertir(def, r.valor); } catch { /* valor viejo inválido: rige el defecto */ }
    }
    return valores;
}

// Valida y guarda { clave: valor }. Solo claves conocidas (y, desde la web, solo las web: true).
export async function guardarConfiguraciones(db, cambios, { usuarioId = null, soloWeb = false } = {}) {
    if (!esquema.configuraciones) throw Object.assign(new Error('Configuraciones no disponibles (migración 011 pendiente)'), { status: 503 });
    const validos = [];
    for (const [clave, valor] of Object.entries(cambios || {})) {
        const def = porClave.get(clave);
        if (!def || (soloWeb && !def.web)) throw Object.assign(new Error(`Configuración desconocida: ${clave}`), { status: 400 });
        validos.push([clave, convertir(def, valor)]);
    }
    for (const [clave, valor] of validos) {
        await db.query(
            'INSERT INTO configuraciones (clave, valor, usuario_id) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE valor = VALUES(valor), usuario_id = VALUES(usuario_id)',
            [clave, String(valor), usuarioId]);
    }
    return leerConfiguraciones(db, { soloWeb });
}

// Definiciones para pintar el formulario (sin nada interno)
export const definicionesPublicas = ({ soloWeb = false } = {}) => DEFINICIONES
    .filter((d) => !soloWeb || d.web)
    .map(({ clave, grupo, tipo, unidad, etiqueta, ayuda, min, max, paso, defecto }) => ({ clave, grupo, tipo, unidad, etiqueta, ayuda, min, max, paso, defecto }));
