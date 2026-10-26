import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import db from './db.js';
import { iniciarServidorIntegracion } from './integration.js';
import { ejecutarMigraciones } from './migrator.js';
import { esquema, actualizarEsquema } from './estado.js';
import { leerConfiguraciones, guardarConfiguraciones, definicionesPublicas } from './configuraciones.js';
import { moverStock, moverVenta, auditarStock, componentesDe, resumenKits, registrarCambioCosto } from './inventario.js';
import { insertarPago, categoriaGastoId, metodoPagoId } from './catalogos.js';
import { sincronizarDinero, sesionAbierta, resumenSesion, sesionPublica, cerrarSesion, movimientoManual, auditarDinero } from './caja.js';
import { anularVenta, ventaAnulada } from './anulaciones.js';
import { devolverVenta, guardarConsumosKit, catalogoDecants, CATEGORIA_DECANTS } from './recetas.js';
import { fechaDocumento, resolverCliente, validarLineasVenta, validarItemCompra, redondear2 } from './validaciones.js';
import { auditar, usuarioDe, fila, documentoVenta } from './auditoria.js';
import { exigirPeriodoAbierto, resultados, salud, listarPeriodos, cerrarPeriodo, reabrirPeriodo, limitesPeriodo, exportarLibro, librosDisponibles, respaldoCompleto } from './contabilidad.js';
import { iniciarCierresAutomaticos, revisarCierres } from './automaticos.js';
import { listarTarjetas, buscarTarjeta, tarjetaPublica, emitirTarjeta, anularTarjeta, validarRedencion, redimirTarjeta, METODO_TARJETA } from './tarjetas.js';

dotenv.config();

// Ensure the Node backend always operates in Medellin Time
process.env.TZ = 'America/Bogota';

const app = express();
const PORT = process.env.PORT || 5000;
const IS_PROD = process.env.NODE_ENV === 'production';

// Nunca usar un secreto conocido: si falta, se genera uno aleatorio por arranque
// (las sesiones se invalidan al reiniciar, pero nadie puede falsificar tokens).
let JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET || JWT_SECRET === 'your_ultra_secret_key_123') {
    JWT_SECRET = crypto.randomBytes(48).toString('hex');
    console.warn('SECURITY: JWT_SECRET no configurado. Se usa uno temporal; define JWT_SECRET en las variables de entorno.');
}

// CORS: solo los orígenes del panel DATA (ALLOWED_ORIGINS separados por coma)
const allowedOrigins = (process.env.ALLOWED_ORIGINS || '').split(',').map(o => o.trim()).filter(Boolean);
if (!allowedOrigins.length) {
    console.warn('SECURITY: ALLOWED_ORIGINS no configurado; CORS queda abierto. Define el dominio del panel DATA.');
}
app.use(cors({
    origin: (origin, callback) => {
        if (!origin || !allowedOrigins.length) return callback(null, true);
        const isLocalhost = !IS_PROD && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
        callback(null, isLocalhost || allowedOrigins.includes(origin));
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use((req, res, next) => {
    res.set({
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY',
        'Referrer-Policy': 'no-referrer',
        'Strict-Transport-Security': 'max-age=31536000; includeSubDomains'
    });
    next();
});
app.use(express.json({ limit: '1mb' }));

// Límite de intentos de login por IP (anti fuerza bruta)
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 10;
const loginAttempts = new Map();
setInterval(() => {
    const now = Date.now();
    for (const [ip, a] of loginAttempts) if (a.resetAt < now) loginAttempts.delete(ip);
}, LOGIN_WINDOW_MS).unref();

const loginLimiter = (req, res, next) => {
    const now = Date.now();
    let a = loginAttempts.get(req.ip);
    if (!a || a.resetAt < now) {
        a = { count: 0, resetAt: now + LOGIN_WINDOW_MS };
        loginAttempts.set(req.ip, a);
    }
    if (++a.count > LOGIN_MAX_ATTEMPTS) {
        return res.status(429).json({ error: 'Demasiados intentos. Intenta de nuevo en unos minutos.' });
    }
    next();
};

// --- MIDDLEWARE: Authenticate Token ---
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) return res.status(401).json({ error: 'Access denied. No token provided.' });

    jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] }, (err, user) => {
        if (err) return res.status(403).json({ error: 'Invalid or expired token.' });
        req.user = user;
        next();
    });
};

// --- AUTH ENDPOINTS ---
app.post('/api/auth/login', loginLimiter, async (req, res, next) => {
    const { username, password } = req.body;
    try {
        const [users] = await db.query('SELECT * FROM usuarios WHERE username = ?', [username]);
        const user = users[0];

        if (!user || !(await bcrypt.compare(password, user.password))) {
            return res.status(401).json({ error: 'Invalid username or password' });
        }

        loginAttempts.delete(req.ip);
        const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '24h' });
        res.json({ token, username: user.username });
    } catch (error) { next(error); }
});

// --- TODO /api EXIGE SESIÓN ---
// Salvo el login, ninguna ruta de la API es pública: una ruta nueva queda protegida sin tener
// que agregarla a una lista (así quedaron abiertas /api/kits y /api/settings hasta el 30-09).
const RUTAS_PUBLICAS = ['/auth/login'];
app.use('/api', (req, res, next) => (RUTAS_PUBLICAS.includes(req.path) ? next() : authenticateToken(req, res, next)));

// Conexión y migraciones versionadas del esquema (ver backend/migrations)
try {
    await db.query('SELECT 1');
    console.log('Successfully connected to MySQL database');

    const migraciones = await ejecutarMigraciones(db);
    // Si una migración falla, el servidor arranca igual con esas funciones deshabilitadas
    actualizarEsquema(migraciones.aplicadas);
} catch (error) {
    console.error('CRITICAL: Could not connect to MySQL. Application will start but API calls will fail.');
    console.error(error.message);
}

// Ejecuta fn(conexión) en una transacción: commit si termina, rollback si lanza
async function transaccion(fn) {
    const connection = await db.getConnection();
    try {
        await connection.beginTransaction();
        const resultado = await fn(connection);
        await connection.commit();
        return resultado;
    } catch (error) {
        await connection.rollback().catch(() => {});
        throw error;
    } finally {
        connection.release();
    }
}

// --- PROVEEDORES (Suppliers) ---
app.get('/api/suppliers', async (req, res, next) => {
    try {
        const [rows] = await db.query('SELECT id, nombre as name, telefono as phone, email, direccion as address, fecha_creacion as createdAt FROM proveedores ORDER BY nombre ASC');
        res.json(rows);
    } catch (error) { next(error); }
});

app.post('/api/suppliers', async (req, res, next) => {
    const { name, phone, email, address } = req.body;
    try {
        const id = await transaccion(async (c) => {
            const [result] = await c.query('INSERT INTO proveedores (nombre, telefono, email, direccion) VALUES (?, ?, ?, ?)', [name, phone, email, address]);
            await auditar(c, { accion: 'crear', entidad: 'proveedor', entidadId: result.insertId, resumen: `Proveedor ${name}`, despues: await fila(c, 'proveedores', result.insertId), usuario: usuarioDe(req) });
            return result.insertId;
        });
        res.status(201).json({ id, ...req.body });
    } catch (error) { next(error); }
});

app.put('/api/suppliers/:id', async (req, res, next) => {
    const { id } = req.params;
    const { name, phone, email, address } = req.body;
    try {
        await transaccion(async (c) => {
            const antes = await fila(c, 'proveedores', id);
            await c.query('UPDATE proveedores SET nombre = ?, telefono = ?, email = ?, direccion = ? WHERE id = ?', [name, phone, email, address, id]);
            await auditar(c, { accion: 'editar', entidad: 'proveedor', entidadId: id, resumen: `Proveedor ${name}`, antes, despues: await fila(c, 'proveedores', id), usuario: usuarioDe(req) });
        });
        res.json({ id, ...req.body });
    } catch (error) { next(error); }
});

app.delete('/api/suppliers/:id', async (req, res, next) => {
    try {
        const [[{ n }]] = await db.query('SELECT COUNT(*) AS n FROM compras WHERE proveedor_id = ?', [req.params.id]);
        if (Number(n) > 0) return res.status(400).json({ error: `Este proveedor tiene ${n} compra(s) registradas: no se puede eliminar` });
        await transaccion(async (c) => {
            const antes = await fila(c, 'proveedores', req.params.id);
            await c.query('DELETE FROM proveedores WHERE id = ?', [req.params.id]);
            await auditar(c, { accion: 'borrar', entidad: 'proveedor', entidadId: req.params.id, resumen: `Proveedor ${antes?.nombre || ''} (sin compras)`, antes, usuario: usuarioDe(req) });
        });
        res.json({ message: 'Supplier deleted' });
    } catch (error) { next(error); }
});

// --- PRODUCTOS / INVENTARIO ---
const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));
const TIPOS_INV = ['terminado', 'esencia', 'base', 'feromona', 'envase', 'accesorio'];

const productoDesdeFila = (r) => ({
    id: r.id, name: r.name, category: r.category,
    price: Number(r.price) || 0, costPrice: Number(r.costPrice) || 0, stock: Number(r.stock) || 0,
    createdAt: r.createdAt,
    ...(esquema.inventarioTipos ? {
        code: r.code, type: r.type, unit: r.unit, minStock: Number(r.minStock) || 0,
        purchaseUnit: r.purchaseUnit, purchaseFactor: Number(r.purchaseFactor) || 1
    } : {}),
    ...(esquema.claseEsencia ? { essenceClass: r.essenceClass || null } : {})
});

// Clase de esencia: solo se toca si el formulario la envía (otros llamadores no la conocen)
const CLASES_ESENCIA = ['arabe', 'tradicional'];
async function guardarClaseEsencia(conn, id, body) {
    if (!esquema.claseEsencia || !Object.prototype.hasOwnProperty.call(body, 'essenceClass')) return;
    const clase = body.type === 'esencia' && CLASES_ESENCIA.includes(body.essenceClass) ? body.essenceClass : null;
    await conn.query('UPDATE inventario SET clase_esencia = ? WHERE id = ?', [clase, id]);
}

const COLS_PRODUCTO = () => `id, nombre as name, categoria as category, precio as price, precio_costo as costPrice, stock, fecha_creacion as createdAt
    ${esquema.inventarioTipos ? ', codigo as code, tipo as type, unidad as unit, stock_minimo as minStock, unidad_compra as purchaseUnit, factor_compra as purchaseFactor' : ''}
    ${esquema.claseEsencia ? ', clase_esencia as essenceClass' : ''}`;

app.get('/api/products', async (req, res, next) => {
    try {
        const { category, type } = req.query;
        const condiciones = [];
        const params = [];
        if (esquema.inventarioTipos) {
            condiciones.push('activo = 1');
        }
        if (category && category !== 'all') {
            condiciones.push('categoria = ?');
            params.push(String(category).trim());
        }
        if (type && type !== 'all' && TIPOS_INV.includes(type)) {
            condiciones.push('tipo = ?');
            params.push(type);
        }
        const where = condiciones.length > 0 ? `WHERE ${condiciones.join(' AND ')}` : '';
        const [rows] = await db.query(`SELECT ${COLS_PRODUCTO()} FROM inventario ${where} ORDER BY nombre ASC`, params);
        // Kits compuestos: existencias y costo salen de sus componentes
        const kits = await resumenKits(db);
        res.json(rows.map((r) => {
            const p = productoDesdeFila(r);
            const k = kits.get(r.id);
            return k ? { ...p, stock: k.stock, costPrice: k.costo, isKit: true, componentCount: k.componentes } : p;
        }));
    } catch (error) { next(error); }
});

const datosInventario = (body) => {
    const tipo = TIPOS_INV.includes(body.type) ? body.type : 'terminado';
    const unidad = body.unit === 'ml' ? 'ml' : (['esencia', 'base', 'feromona'].includes(tipo) ? 'ml' : 'und');
    return {
        codigo: body.code ? String(body.code).trim().substring(0, 40) : null,
        tipo, unidad,
        stockMinimo: Math.max(0, num(body.minStock) || 0),
        unidadCompra: body.purchaseUnit ? String(body.purchaseUnit).trim().substring(0, 20) : null,
        factorCompra: num(body.purchaseFactor) > 0 ? num(body.purchaseFactor) : 1
    };
};

// Datos mínimos de un ítem del inventario: sin nombre, categoría o precio de venta no se guarda
const errorProducto = (body) => {
    if (!body.name || !String(body.name).trim()) return 'El nombre es obligatorio';
    if (!body.category || !String(body.category).trim()) return 'La categoría es obligatoria';
    // Los insumos (alcohol, envases, bolsas…) no se venden: el precio de venta solo se exige a lo terminado
    if ((body.type || 'terminado') === 'terminado' && !(num(body.price) > 0)) return 'El precio de venta debe ser mayor que 0';
    if (num(body.price) < 0) return 'El precio de venta no puede ser negativo';
    if (num(body.costPrice) < 0) return 'El precio de costo no puede ser negativo';
    return null;
};

app.post('/api/products', async (req, res, next) => {
    const { name, category, price, costPrice } = req.body;
    const stockInicial = num(req.body.stock) || 0;
    if (errorProducto(req.body)) return res.status(400).json({ error: errorProducto(req.body) });
    let connection;
    try {
        connection = await db.getConnection();
        await connection.beginTransaction();
        let result;
        if (esquema.inventarioTipos) {
            const d = datosInventario(req.body);
            [result] = await connection.query(
                'INSERT INTO inventario (nombre, categoria, precio, precio_costo, stock, codigo, tipo, unidad, stock_minimo, unidad_compra, factor_compra) VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?)',
                [name, category, num(price) || 0, num(costPrice) || 0, d.codigo, d.tipo, d.unidad, d.stockMinimo, d.unidadCompra, d.factorCompra]
            );
        } else {
            [result] = await connection.query('INSERT INTO inventario (nombre, categoria, precio, precio_costo, stock) VALUES (?, ?, ?, ?, 0)',
                [name, category, num(price) || 0, num(costPrice) || 0]);
        }
        await guardarClaseEsencia(connection, result.insertId, req.body);
        if (stockInicial > 0) {
            await moverStock(connection, { inventarioId: result.insertId, cantidad: stockInicial, tipo: 'inicial', costoUnitario: num(costPrice) || 0,
                origenTipo: 'producto', origenId: result.insertId, motivo: 'Stock inicial al crear el producto', usuarioId: req.user?.id });
        }
        await auditar(connection, { accion: 'crear', entidad: 'producto', entidadId: result.insertId, resumen: `Producto ${name}`,
            despues: await fila(connection, 'inventario', result.insertId), usuario: usuarioDe(req) });
        await connection.commit();
        res.status(201).json({ id: result.insertId, ...req.body });
    } catch (error) {
        if (connection) await connection.rollback();
        next(error);
    } finally {
        if (connection) connection.release();
    }
});

app.put('/api/products/:id', async (req, res, next) => {
    const { id } = req.params;
    const { name, category, price, costPrice } = req.body;
    if (errorProducto(req.body)) return res.status(400).json({ error: errorProducto(req.body) });
    let connection;
    try {
        connection = await db.getConnection();
        await connection.beginTransaction();
        const [actual] = await connection.query(`SELECT stock, precio_costo${esquema.inventarioTipos ? ', unidad' : ''} FROM inventario WHERE id = ? FOR UPDATE`, [id]);
        if (!actual.length) {
            await connection.rollback();
            return res.status(404).json({ error: 'Producto no encontrado' });
        }
        const esKit = (await componentesDe(connection, Number(id))).length > 0;
        const fichaAntes = await fila(connection, 'inventario', id);
        const stockActual = Number(actual[0].stock) || 0;
        const costoActual = Number(actual[0].precio_costo) || 0;
        // El costo de un kit lo calculan sus componentes: el de su ficha no se toca
        const costoNuevo = esKit ? costoActual : num(costPrice) || 0;
        if (esquema.blindaje) {
            // El stock solo cambia con un movimiento con motivo (Ajustar stock, compra, venta)
            const pedido = num(req.body.stock);
            if (pedido !== null && !esKit && Math.abs(pedido - stockActual) > 0.001) {
                await connection.rollback();
                return res.status(400).json({ error: 'El stock no se cambia desde la ficha: usa «Ajustar stock» y escribe el motivo' });
            }
            // 7 und no son 7 ml: cambiar la unidad exige dejar el stock en 0 primero
            if (esquema.inventarioTipos && datosInventario(req.body).unidad !== actual[0].unidad && stockActual !== 0) {
                await connection.rollback();
                return res.status(400).json({ error: `Para cambiar la unidad (${actual[0].unidad} → ${datosInventario(req.body).unidad}) el stock debe estar en 0: ajústalo primero` });
            }
        }
        if (esquema.inventarioTipos) {
            const d = datosInventario(req.body);
            await connection.query(
                'UPDATE inventario SET nombre = ?, categoria = ?, precio = ?, precio_costo = ?, codigo = ?, tipo = ?, unidad = ?, stock_minimo = ?, unidad_compra = ?, factor_compra = ? WHERE id = ?',
                [name, category, num(price) || 0, costoNuevo, d.codigo, d.tipo, d.unidad, d.stockMinimo, d.unidadCompra, d.factorCompra, id]
            );
        } else {
            await connection.query('UPDATE inventario SET nombre = ?, categoria = ?, precio = ?, precio_costo = ? WHERE id = ?',
                [name, category, num(price) || 0, costoNuevo, id]);
        }
        await guardarClaseEsencia(connection, Number(id), req.body);
        // Un costo cambiado a mano queda en el kárdex (antes pisaba el promedio sin rastro)
        if (Math.abs(costoNuevo - costoActual) > 0.00005) {
            await registrarCambioCosto(connection, { inventarioId: Number(id), stock: stockActual, costoAnterior: costoActual, costoNuevo,
                motivo: req.body.costReason || 'Costo editado en la ficha', usuarioId: req.user?.id });
        }
        // Sin la migración 015, un cambio de stock desde el formulario queda como ajuste en el libro (regla I-05)
        const nuevo = num(req.body.stock);
        const diferencia = esquema.blindaje || nuevo === null || esKit ? 0 : nuevo - stockActual;
        if (diferencia) {
            await moverStock(connection, { inventarioId: Number(id), cantidad: diferencia, tipo: 'ajuste', origenTipo: 'ajuste',
                motivo: req.body.adjustmentReason || 'Edición manual del stock', usuarioId: req.user?.id });
        }
        await auditar(connection, { accion: 'editar', entidad: 'producto', entidadId: id, resumen: `Producto ${name}`,
            antes: fichaAntes, despues: await fila(connection, 'inventario', id), usuario: usuarioDe(req) });
        await connection.commit();
        res.json({ id, ...req.body });
    } catch (error) {
        if (connection) await connection.rollback();
        next(error);
    } finally {
        if (connection) connection.release();
    }
});

// Nada se borra si tiene historia: el producto se desactiva y deja de aparecer
app.delete('/api/products/:id', async (req, res, next) => {
    try {
        if (esquema.blindaje) {
            // Desactivar con existencias las saca del inventario visible sin registrar a dónde fueron
            const [[item]] = await db.query('SELECT nombre, stock, unidad FROM inventario WHERE id = ?', [req.params.id]);
            if (!item) return res.status(404).json({ error: 'Producto no encontrado' });
            if (Number(item.stock) !== 0) {
                return res.status(400).json({ error: `«${item.nombre}» tiene ${Number(item.stock).toLocaleString('es-CO')}${item.unidad === 'ml' ? ' ml' : ' und'} en stock: ajústalo a 0 (con su motivo) antes de desactivarlo` });
            }
            const [kits] = await db.query(`SELECT i.nombre FROM kit_componentes kc JOIN inventario i ON i.id = kc.kit_id
                WHERE kc.componente_id = ? AND i.activo = 1`, [req.params.id]);
            if (kits.length) return res.status(400).json({ error: `«${item.nombre}» es componente de ${kits.map((k) => `«${k.nombre}»`).join(', ')}: quítalo del kit primero` });
        }
        await transaccion(async (c) => {
            const antes = await fila(c, 'inventario', req.params.id);
            if (esquema.inventarioTipos) {
                await c.query('UPDATE inventario SET activo = 0 WHERE id = ?', [req.params.id]);
            } else {
                await c.query('DELETE FROM inventario WHERE id = ?', [req.params.id]);
            }
            await auditar(c, { accion: 'desactivar', entidad: 'producto', entidadId: req.params.id, resumen: `Producto ${antes?.nombre || ''} desactivado`, antes, usuario: usuarioDe(req) });
        });
        res.json({ message: 'Product deleted' });
    } catch (error) { next(error); }
});

// Historial de movimientos de un ítem (kárdex)
app.get('/api/products/:id/movements', async (req, res, next) => {
    if (!esquema.libro) return res.json([]);
    try {
        const [rows] = await db.query(`
            SELECT m.id, m.tipo as type, m.cantidad as quantity, m.stock_resultante as balance, m.costo_unitario as unitCost,
                   m.origen_tipo as sourceType, m.origen_id as sourceId, m.motivo as reason, m.creado_en as createdAt, u.username as user
            FROM movimientos_inventario m LEFT JOIN usuarios u ON u.id = m.usuario_id
            WHERE m.inventario_id = ? ORDER BY m.id DESC LIMIT 500`, [req.params.id]);
        res.json(rows.map(r => ({ ...r, quantity: Number(r.quantity), balance: Number(r.balance), unitCost: r.unitCost === null ? null : Number(r.unitCost) })));
    } catch (error) { next(error); }
});

// Ajuste de inventario con motivo obligatorio (conteo físico, rotura, vencimiento…)
app.post('/api/products/:id/adjustments', async (req, res, next) => {
    const motivo = String(req.body.reason || '').trim();
    if (motivo.length < 3) return res.status(400).json({ error: 'El motivo del ajuste es obligatorio' });
    let connection;
    try {
        connection = await db.getConnection();
        await connection.beginTransaction();
        const [actual] = await connection.query('SELECT stock FROM inventario WHERE id = ? FOR UPDATE', [req.params.id]);
        if (!actual.length) {
            await connection.rollback();
            return res.status(404).json({ error: 'Producto no encontrado' });
        }
        if ((await componentesDe(connection, Number(req.params.id))).length) {
            await connection.rollback();
            return res.status(400).json({ error: 'Las existencias de un kit dependen de sus componentes: ajusta los componentes' });
        }
        const cantidad = num(req.body.newStock) !== null ? num(req.body.newStock) - Number(actual[0].stock) : num(req.body.quantity);
        if (!cantidad) {
            await connection.rollback();
            return res.status(400).json({ error: 'El ajuste no cambia el stock' });
        }
        const r = await moverStock(connection, { inventarioId: Number(req.params.id), cantidad, tipo: 'ajuste', origenTipo: 'ajuste', motivo, usuarioId: req.user?.id });
        await auditar(connection, { accion: 'ajustar', entidad: 'inventario', entidadId: req.params.id, resumen: `Ajuste ${cantidad > 0 ? '+' : ''}${cantidad}: ${motivo}`,
            antes: { stock: Number(actual[0].stock) }, despues: { stock: r.stock, motivo }, usuario: usuarioDe(req) });
        await connection.commit();
        res.status(201).json({ stock: r.stock });
    } catch (error) {
        if (connection) await connection.rollback();
        next(error);
    } finally {
        if (connection) connection.release();
    }
});

// Verificación: stock que no cuadra con su libro
app.get('/api/inventory/audit', async (req, res, next) => {
    if (!esquema.libro) return res.json({ disponible: false, diferencias: [] });
    try {
        res.json({ disponible: true, diferencias: await auditarStock(db) });
    } catch (error) { next(error); }
});

// --- CONFIGURACIONES (módulo del panel) ---
app.get('/api/settings', async (req, res, next) => {
    try {
        res.json({ definiciones: definicionesPublicas(), valores: await leerConfiguraciones(db) });
    } catch (error) { next(error); }
});

app.put('/api/settings', async (req, res, next) => {
    try {
        const antes = await leerConfiguraciones(db);
        const valores = await guardarConfiguraciones(db, req.body?.valores, { usuarioId: req.user?.id });
        const cambios = Object.keys(valores).filter((k) => String(valores[k]) !== String(antes[k]));
        if (cambios.length) {
            await transaccion((c) => auditar(c, { accion: 'editar', entidad: 'configuracion', resumen: `Configuraciones: ${cambios.join(', ')}`,
                antes: Object.fromEntries(cambios.map((k) => [k, antes[k]])), despues: Object.fromEntries(cambios.map((k) => [k, valores[k]])), usuario: usuarioDe(req) }));
        }
        res.json({ definiciones: definicionesPublicas(), valores });
    } catch (error) { next(error); }
});

// --- KITS COMPUESTOS (creador de kits) ---
// Un kit es un ítem del inventario (categoría Kit) con componentes: cualquier otro ítem con su cantidad.
const kitDesdeFila = (r, componentes) => {
    const stock = componentes.length ? Math.min(...componentes.map(c => Math.max(0, Math.floor(c.stock / c.cantidad + 1e-9)))) : 0;
    const costo = Math.round(componentes.reduce((s, c) => s + c.cantidad * c.costo, 0) * 100) / 100;
    return {
        id: r.id, name: r.nombre, category: r.categoria, price: Number(r.precio) || 0,
        stock, costPrice: costo, priceReview: costo > 0 && Number(r.precio) <= costo,
        components: componentes.map(c => ({ productId: c.id, name: c.nombre, quantity: c.cantidad, stock: c.stock, costPrice: c.costo, unit: c.unidad }))
    };
};

// --- RECETAS DE PREPARADO Y EMPAQUE ---
// Costo por ml de la esencia según su clase: promedio ponderado por stock de las esencias activas
async function costosEsencia(conn) {
    if (!esquema.claseEsencia) return {};
    const [rows] = await conn.query(`SELECT clase_esencia AS clase,
        SUM(precio_costo * GREATEST(stock, 0)) / NULLIF(SUM(GREATEST(stock, 0)), 0) AS ponderado, AVG(precio_costo) AS promedio
        FROM inventario WHERE tipo = 'esencia' AND activo = 1 AND clase_esencia IS NOT NULL GROUP BY clase_esencia`);
    return Object.fromEntries(rows.map((r) => [r.clase, Number(r.ponderado ?? r.promedio) || 0]));
}

app.get('/api/recipes', async (req, res, next) => {
    if (!esquema.recetas) return res.status(503).json({ error: 'Las recetas aún no están disponibles (migración 013 pendiente)' });
    try {
        const [lineas] = await db.query(`SELECT r.id, r.ambito AS scope, r.ml, r.rol AS role, r.inventario_id AS itemId, r.cantidad AS quantity, r.orden AS sortOrder,
            i.nombre AS itemName, i.unidad AS unit, i.precio_costo AS unitCost, i.stock
            FROM recetas r LEFT JOIN inventario i ON i.id = r.inventario_id ORDER BY r.ambito, r.ml, r.orden, r.id`);
        // Envases del inventario por tamaño (el costo del "envase elegido" va de su mínimo a su máximo)
        const [envases] = await db.query("SELECT id, nombre AS name, precio_costo AS unitCost, stock, categoria FROM inventario WHERE tipo = 'envase' AND activo = 1 ORDER BY nombre");
        res.json({
            lines: lineas.map((l) => ({ ...l, quantity: Number(l.quantity), unitCost: l.unitCost == null ? null : Number(l.unitCost), stock: l.stock == null ? null : Number(l.stock) })),
            essenceCost: await costosEsencia(db),
            // decant: los envases de decant (categoría Decants) solo cuentan para la receta de decant
            containers: envases.map(({ categoria, ...e }) => ({ ...e, unitCost: Number(e.unitCost) || 0, stock: Number(e.stock) || 0,
                ml: Number((/(\d+)\s*ml/i.exec(e.name) || [])[1]) || null, decant: categoria === CATEGORIA_DECANTS })),
            decants: esquema.decants
        });
    } catch (error) { next(error); }
});

// Reemplaza todas las líneas (el panel envía la receta completa)
app.put('/api/recipes', async (req, res, next) => {
    if (!esquema.recetas) return res.status(503).json({ error: 'Las recetas aún no están disponibles (migración 013 pendiente)' });
    const lineas = Array.isArray(req.body.lines) ? req.body.lines : [];
    const limpias = [];
    for (const [i, l] of lineas.entries()) {
        const ambito = ['pedido', 'decant'].includes(l.scope) ? l.scope : 'tamano';
        if (ambito === 'decant' && !esquema.decants) return res.status(400).json({ error: 'Los decants aún no están disponibles (migración 014 pendiente)' });
        const ml = ambito === 'pedido' ? null : parseInt(l.ml, 10);
        const rol = ['esencia', 'envase', 'insumo'].includes(l.role) ? l.role : 'insumo';
        const cantidad = Number(l.quantity);
        if (ambito !== 'pedido' && !(ml > 0 && ml <= 1000)) return res.status(400).json({ error: 'Cada tamaño debe tener ml válidos' });
        if (ambito === 'pedido' && rol !== 'insumo') return res.status(400).json({ error: 'El empaque por pedido solo lleva insumos' });
        if (!(cantidad >= 0)) return res.status(400).json({ error: 'Las cantidades no pueden ser negativas' });
        const itemId = rol === 'insumo' ? parseInt(l.itemId, 10) : null;
        if (rol === 'insumo' && !(itemId > 0)) return res.status(400).json({ error: 'Cada línea de insumo necesita un ítem del inventario' });
        limpias.push([ambito, ml, rol, itemId, cantidad, i]);
    }
    let connection;
    try {
        connection = await db.getConnection();
        await connection.beginTransaction();
        const [antes] = await connection.query('SELECT ambito, ml, rol, inventario_id, cantidad FROM recetas ORDER BY ambito, ml, orden, id');
        await connection.query('DELETE FROM recetas');
        if (limpias.length) await connection.query('INSERT INTO recetas (ambito, ml, rol, inventario_id, cantidad, orden) VALUES ?', [limpias]);
        await auditar(connection, { accion: 'editar', entidad: 'recetas', resumen: `Recetas: ${limpias.length} línea(s)`, antes,
            despues: limpias.map(([ambito, ml, rol, inventario_id, cantidad]) => ({ ambito, ml, rol, inventario_id, cantidad })), usuario: usuarioDe(req) });
        await connection.commit();
        res.json({ ok: true, count: limpias.length });
    } catch (error) {
        if (connection) await connection.rollback();
        next(error);
    } finally {
        if (connection) connection.release();
    }
});

// Decants: cuántos decants alcanzan con cada esencia y cada envase (para el panel)
app.get('/api/decants', async (req, res, next) => {
    try {
        res.json(await catalogoDecants(db));
    } catch (error) { next(error); }
});

app.get('/api/kits', async (req, res, next) => {
    if (!esquema.kits) return res.json([]);
    try {
        const [rows] = await db.query(`
            SELECT DISTINCT i.id, i.nombre, i.categoria, i.precio FROM inventario i
            LEFT JOIN kit_componentes kc ON kc.kit_id = i.id
            WHERE ${esquema.inventarioTipos ? 'i.activo = 1 AND' : ''} (kc.kit_id IS NOT NULL OR LOWER(i.categoria) LIKE '%kit%')
            ORDER BY i.nombre`);
        const lista = [];
        for (const r of rows) lista.push(kitDesdeFila(r, await componentesDe(db, r.id)));
        res.json(lista);
    } catch (error) { next(error); }
});

// Reemplaza la composición de un kit: { components: [{ productId, quantity }] }
app.put('/api/kits/:id/components', async (req, res, next) => {
    if (!esquema.kits) return res.status(503).json({ error: 'Los kits compuestos aún no están disponibles (migración 010 pendiente)' });
    const kitId = Number.parseInt(req.params.id, 10);
    const lineas = new Map();
    for (const c of Array.isArray(req.body.components) ? req.body.components : []) {
        const id = Number.parseInt(c.productId, 10);
        const cantidad = Math.round(Number(c.quantity) * 100) / 100;
        if (!id || !(cantidad > 0)) return res.status(400).json({ error: 'Cada componente necesita un producto y una cantidad mayor que 0' });
        if (id === kitId) return res.status(400).json({ error: 'Un kit no puede contenerse a sí mismo' });
        lineas.set(id, (lineas.get(id) || 0) + cantidad);
    }
    let connection;
    try {
        connection = await db.getConnection();
        await connection.beginTransaction();
        const [kit] = await connection.query('SELECT id, nombre, categoria, precio, stock FROM inventario WHERE id = ? FOR UPDATE', [kitId]);
        if (!kit.length) {
            await connection.rollback();
            return res.status(404).json({ error: 'Kit no encontrado' });
        }
        if (lineas.size) {
            const ids = [...lineas.keys()];
            const [existentes] = await connection.query('SELECT id FROM inventario WHERE id IN (?)', [ids]);
            if (existentes.length !== ids.length) {
                await connection.rollback();
                return res.status(400).json({ error: 'Algún componente no existe en el inventario' });
            }
            // Sin kits dentro de kits: las existencias se calculan a un solo nivel
            const [anidados] = await connection.query('SELECT DISTINCT kit_id FROM kit_componentes WHERE kit_id IN (?)', [ids]);
            if (anidados.length) {
                await connection.rollback();
                return res.status(400).json({ error: 'Un kit no puede contener otro kit compuesto: agrega sus componentes directamente' });
            }
            const [esComponente] = await connection.query('SELECT 1 FROM kit_componentes WHERE componente_id = ? LIMIT 1', [kitId]);
            if (esComponente.length) {
                await connection.rollback();
                return res.status(400).json({ error: 'Este ítem es componente de otro kit: no puede tener componentes' });
            }
        }
        const [compAntes] = await connection.query('SELECT componente_id, cantidad FROM kit_componentes WHERE kit_id = ? ORDER BY componente_id', [kitId]);
        await auditar(connection, { accion: 'editar', entidad: 'kit', entidadId: kitId, resumen: `Composición del kit ${kit[0].nombre}`, antes: compAntes,
            despues: [...lineas].map(([componente_id, cantidad]) => ({ componente_id, cantidad })), usuario: usuarioDe(req) });
        await connection.query('DELETE FROM kit_componentes WHERE kit_id = ?', [kitId]);
        for (const [id, cantidad] of lineas) {
            await connection.query('INSERT INTO kit_componentes (kit_id, componente_id, cantidad) VALUES (?, ?, ?)', [kitId, id, cantidad]);
        }
        // El stock propio del kit deja de contar: se lleva a 0 con un ajuste en el libro
        if (lineas.size && Number(kit[0].stock) !== 0) {
            await moverStock(connection, { inventarioId: kitId, cantidad: -Number(kit[0].stock), tipo: 'ajuste', origenTipo: 'ajuste',
                motivo: 'Kit compuesto: sus existencias salen de los componentes', usuarioId: req.user?.id, permitirNegativo: true });
        }
        await connection.commit();
        res.json(kitDesdeFila(kit[0], await componentesDe(db, kitId)));
    } catch (error) {
        if (connection) await connection.rollback();
        next(error);
    } finally {
        if (connection) connection.release();
    }
});

// --- CLIENTES (Customers) ---
app.get('/api/customers', async (req, res, next) => {
    try {
        const [rows] = await db.query('SELECT * FROM clientes ORDER BY nombre ASC');
        res.json(rows || []);
    } catch (error) { next(error); }
});

app.post('/api/customers', async (req, res, next) => {
    const { nombre, telefono, cedula, ciudad, direccion } = req.body;
    try {
        const id = await transaccion(async (c) => {
            const [result] = await c.query('INSERT INTO clientes (nombre, telefono, cedula, ciudad, direccion) VALUES (?, ?, ?, ?, ?)',
                [nombre, telefono || null, cedula || null, ciudad || null, direccion || null]);
            await auditar(c, { accion: 'crear', entidad: 'cliente', entidadId: result.insertId, resumen: `Cliente ${nombre}`, despues: await fila(c, 'clientes', result.insertId), usuario: usuarioDe(req) });
            return result.insertId;
        });
        res.status(201).json({ id, ...req.body });
    } catch (error) { next(error); }
});

app.put('/api/customers/:id', async (req, res, next) => {
    const { id } = req.params;
    const { nombre, telefono, cedula, ciudad, direccion } = req.body;
    try {
        await transaccion(async (c) => {
            const antes = await fila(c, 'clientes', id);
            await c.query('UPDATE clientes SET nombre = ?, telefono = ?, cedula = ?, ciudad = ?, direccion = ? WHERE id = ?',
                [nombre, telefono || null, cedula || null, ciudad || null, direccion || null, id]);
            await auditar(c, { accion: 'editar', entidad: 'cliente', entidadId: id, resumen: `Cliente ${nombre}`, antes, despues: await fila(c, 'clientes', id), usuario: usuarioDe(req) });
        });
        res.json({ id, ...req.body });
    } catch (error) { next(error); }
});

app.delete('/api/customers/:id', async (req, res, next) => {
    try {
        // Con ventas, el cliente es parte de la historia (y quizá debe dinero): no se borra
        const [[{ n }]] = await db.query('SELECT COUNT(*) AS n FROM ventas WHERE cliente_id = ?', [req.params.id]);
        if (Number(n) > 0) return res.status(400).json({ error: `Este cliente tiene ${n} venta(s) registradas: no se puede eliminar` });
        await transaccion(async (c) => {
            const antes = await fila(c, 'clientes', req.params.id);
            await c.query('DELETE FROM clientes WHERE id = ?', [req.params.id]);
            await auditar(c, { accion: 'borrar', entidad: 'cliente', entidadId: req.params.id, resumen: `Cliente ${antes?.nombre || ''} (sin ventas)`, antes, usuario: usuarioDe(req) });
        });
        res.json({ message: 'Customer deleted' });
    } catch (error) { next(error); }
});

// --- VENTAS & PAGOS (Sales & Payments) ---
// MySQL devuelve DECIMAL como texto: toda comparación de montos debe pasar por Number
const toNumber = (v) => Number.parseFloat(v) || 0;

// Normaliza las líneas del carrito. Las líneas sin producto (p. ej. envío de la web)
// conservan su descripción para que sigan identificándose en reportes.
const normalizarItems = (items) => (Array.isArray(items) ? items : []).map(item => {
    const rawId = item.productId;
    const productId = rawId !== undefined && rawId !== null && rawId !== '' && rawId !== 'null' ? Number.parseInt(rawId, 10) : null;
    // Con la migración 015 las cantidades llevan decimales (ml de esencia); antes se truncaban a entero
    const cantidad = esquema.blindaje ? redondear2(toNumber(item.quantity)) : Math.max(1, Number.parseInt(item.quantity, 10) || 1);
    return {
        productId: Number.isInteger(productId) ? productId : null,
        quantity: cantidad,
        unitPrice: Math.max(0, toNumber(item.unitPrice)),
        costAtSale: Math.max(0, toNumber(item.costAtSale)),
        description: item.productName ? String(item.productName).substring(0, 255) : null,
        // El panel ya pidió confirmación de vender por debajo del costo
        allowBelowCost: item.allowBelowCost === true
    };
});

// Ninguna línea de venta sin precio: una venta en $0 descuenta inventario sin ingreso
const errorItems = (items) => {
    if (!items.length) return 'La venta debe tener al menos un producto';
    if (items.some(i => !i.productId)) return 'Cada línea de la venta necesita un producto';
    if (items.some(i => !(i.quantity > 0))) return 'La cantidad de cada producto debe ser mayor que 0';
    if (items.some(i => !(i.unitPrice > 0))) return 'Cada producto de la venta necesita un precio mayor que 0';
    return null;
};

const totalDeItems = (items) => redondear2(items.reduce((sum, i) => sum + i.quantity * i.unitPrice, 0));

// Descuenta el stock y registra la línea con el costo real del momento (regla I-07)
const insertarDetalle = async (connection, saleId, item, usuarioId) => {
    let costo = 0;
    let movido = null;
    if (item.productId) {
        movido = await moverVenta(connection, { inventarioId: item.productId, cantidad: -item.quantity, tipo: 'venta',
            origenTipo: 'venta', origenId: saleId, usuarioId });
        costo = movido ? movido.costo : 0;
    }
    let detalle;
    if (esquema.integracion) {
        [detalle] = await connection.query(
            'INSERT INTO venta_detalles (venta_id, inventario_id, cantidad, precio_unitario, costo_al_vender, descripcion) VALUES (?, ?, ?, ?, ?, ?)',
            [saleId, item.productId, item.quantity, item.unitPrice, costo, item.productId ? null : item.description]
        );
    } else {
        [detalle] = await connection.query(
            'INSERT INTO venta_detalles (venta_id, inventario_id, cantidad, precio_unitario, costo_al_vender) VALUES (?, ?, ?, ?, ?)',
            [saleId, item.productId, item.quantity, item.unitPrice, costo]
        );
    }
    // Kit: queda lo que salió de cada componente, para devolver exactamente eso al anular
    await guardarConsumosKit(connection, { ventaId: saleId, detalleId: detalle.insertId, consumos: movido?.consumos });
};

// Ventas de la tienda web: las registra y las anula la integración (pago y reembolso en Mercado Pago)
const esVentaWeb = async (connection, id) => {
    if (!esquema.integracion) return false;
    const [r] = await connection.query("SELECT 1 FROM ventas WHERE id = ? AND origen = 'web'", [id]);
    return r.length > 0;
};

app.get('/api/sales', async (req, res, next) => {
    try {
        const [sales] = await db.query(`
            SELECT v.id, v.total, v.fecha as date, v.estado as status, v.metodo as method${esquema.integracion ? ', v.origen as origin' : ''},
                   c.id as customerId, c.nombre as customerName, c.telefono as phone,
                   c.cedula as idDocument, c.ciudad as city, c.direccion as address
            FROM ventas v
            LEFT JOIN clientes c ON v.cliente_id = c.id
            ${esquema.caja ? 'WHERE v.anulada_en IS NULL' : ''}
            ORDER BY v.fecha DESC
        `);
        if (!sales.length) return res.json([]);

        // Dos consultas en total (antes eran 2 por cada venta)
        const [payments] = await db.query(esquema.metodosPago
            ? `SELECT p.id, p.venta_id as saleId, p.monto as amount, p.fecha as date, COALESCE(m.nombre, p.metodo) as method, COALESCE(m.es_efectivo, 1) as isCash FROM pagos p LEFT JOIN metodos_pago m ON m.id = p.metodo_pago_id ${esquema.caja ? 'WHERE p.anulada_en IS NULL' : ''} ORDER BY p.id ASC`
            : 'SELECT id, venta_id as saleId, monto as amount, fecha as date, metodo as method, 1 as isCash FROM pagos ORDER BY id ASC');
        const [items] = await db.query(`SELECT vd.id, vd.venta_id as saleId, vd.inventario_id as productId, vd.cantidad as quantity, vd.precio_unitario as unitPrice, vd.costo_al_vender as costAtSale, ${esquema.integracion ? 'COALESCE(p.nombre, vd.descripcion)' : 'p.nombre'} as productName FROM venta_detalles vd LEFT JOIN inventario p ON vd.inventario_id = p.id ORDER BY vd.id ASC`);

        const agrupar = (rows) => rows.reduce((map, r) => {
            if (!map.has(r.saleId)) map.set(r.saleId, []);
            map.get(r.saleId).push(r);
            return map;
        }, new Map());
        const pagosPorVenta = agrupar(payments);
        const itemsPorVenta = agrupar(items);

        res.json(sales.map(sale => ({
            ...sale,
            payments: pagosPorVenta.get(sale.id) || [],
            items: itemsPorVenta.get(sale.id) || []
        })));
    } catch (error) { next(error); }
});

app.post('/api/sales', async (req, res, next) => {
    const { date, customerId, customerName, phone, idDocument, city, address, method } = req.body;
    const items = normalizarItems(req.body.items);
    if (errorItems(items)) return res.status(400).json({ error: errorItems(items) });

    // El total y el estado se calculan en el servidor, no se confía en el cliente
    const total = totalDeItems(items);
    const codigoTarjeta = esquema.tarjetas ? String(req.body.giftCardCode || '').trim() : '';

    let connection;
    try {
        const fecha = esquema.blindaje ? fechaDocumento(date) : date;
        connection = await db.getConnection();
        await connection.beginTransaction();

        // Un mes cerrado no recibe documentos nuevos
        if (esquema.trazabilidad) await exigirPeriodoAbierto(connection, fecha, 'ventas');
        // Tarjeta de regalo: se aplica primero (un solo uso); el resto se paga con el método elegido
        const tarjeta = codigoTarjeta ? await validarRedencion(connection, codigoTarjeta, { total, fecha }) : null;
        const aplicado = tarjeta ? tarjeta.aplicado : 0;
        const initialPayment = Math.min(Math.max(0, toNumber(req.body.initialPayment)), Math.round((total - aplicado) * 100) / 100);
        const status = aplicado + initialPayment >= total - 0.01 ? 'paid' : 'pending';
        const metodoVenta = tarjeta && initialPayment <= 0 ? METODO_TARJETA : method;
        let finalCustomerId;
        if (esquema.blindaje) {
            await validarLineasVenta(connection, items);
            finalCustomerId = await resolverCliente(connection, req.body);
            // De contado puede ser «Consumidor final»; a crédito hay que saber quién debe
            if (esquema.caja && !finalCustomerId && status !== 'paid') {
                await connection.rollback();
                return res.status(400).json({ error: 'Una venta a crédito necesita el nombre del cliente' });
            }
        } else {
            finalCustomerId = customerId || null;
            if (!finalCustomerId && customerName) {
                const [clientResult] = await connection.query(
                    'INSERT INTO clientes (nombre, telefono, cedula, ciudad, direccion) VALUES (?, ?, ?, ?, ?)',
                    [customerName, phone || null, idDocument || null, city || null, address || null]
                );
                finalCustomerId = clientResult.insertId;
            }
        }

        const [saleResult] = await connection.query(
            `INSERT INTO ventas (total, fecha, cliente_id, estado, metodo${esquema.trazabilidad ? ', creado_por' : ''}) VALUES (?, ?, ?, ?, ?${esquema.trazabilidad ? ', ?' : ''})`,
            [total, fecha, finalCustomerId, status, metodoVenta, ...(esquema.trazabilidad ? [req.user?.id || null] : [])]
        );
        const saleId = saleResult.insertId;

        if (tarjeta) await redimirTarjeta(connection, tarjeta, { ventaId: saleId, fecha, usuarioId: req.user?.id });
        if (initialPayment > 0) {
            await insertarPago(connection, { ventaId: saleId, monto: initialPayment, fecha, metodo: method, crear: !esquema.blindaje, usuarioId: req.user?.id });
        }

        for (const item of items) await insertarDetalle(connection, saleId, item, req.user?.id);
        await auditar(connection, { accion: 'crear', entidad: 'venta', entidadId: saleId,
            resumen: `Venta #${saleId} por $${Math.round(total).toLocaleString('es-CO')}${tarjeta ? ` (tarjeta de regalo ${tarjeta.tarjeta.codigo}: $${Math.round(aplicado).toLocaleString('es-CO')})` : ''}`,
            despues: await documentoVenta(connection, saleId), usuario: usuarioDe(req) });

        await connection.commit();
        res.status(201).json({ id: saleId, ...req.body, total, status,
            giftCard: tarjeta ? { code: tarjeta.tarjeta.codigo, applied: aplicado, leftover: tarjeta.excedente } : null });
    } catch (error) {
        if (connection) await connection.rollback();
        next(error);
    } finally {
        if (connection) connection.release();
    }
});

app.post('/api/sales/:id/payments', async (req, res, next) => {
    const { id } = req.params;
    const { date, method } = req.body;
    const amount = toNumber(req.body.amount);
    if (amount <= 0) return res.status(400).json({ error: 'El abono debe ser mayor a cero' });

    let connection;
    try {
        const fecha = esquema.blindaje ? fechaDocumento(date, { campo: 'La fecha del abono' }) : date;
        connection = await db.getConnection();
        await connection.beginTransaction();

        const [saleRows] = await connection.query('SELECT total FROM ventas WHERE id = ? FOR UPDATE', [id]);
        if (!saleRows.length) {
            await connection.rollback();
            return res.status(404).json({ error: 'Venta no encontrada' });
        }
        if (await ventaAnulada(connection, id)) {
            await connection.rollback();
            return res.status(400).json({ error: 'La venta está anulada: no recibe abonos' });
        }
        const total = toNumber(saleRows[0].total);
        const [paidRows] = await connection.query(`SELECT COALESCE(SUM(monto), 0) as totalPaid FROM pagos WHERE venta_id = ?${esquema.caja ? ' AND anulada_en IS NULL' : ''}`, [id]);
        const saldo = total - toNumber(paidRows[0].totalPaid);

        if (amount - saldo > 0.01) {
            await connection.rollback();
            return res.status(400).json({ error: `El abono supera el saldo pendiente ($${Math.round(saldo).toLocaleString('es-CO')})` });
        }

        if (esquema.trazabilidad) await exigirPeriodoAbierto(connection, fecha, 'abonos');
        const pagoId = await insertarPago(connection, { ventaId: id, monto: amount, fecha, metodo: method, crear: !esquema.blindaje, usuarioId: req.user?.id });
        await auditar(connection, { accion: 'abonar', entidad: 'venta', entidadId: id, resumen: `Abono de $${Math.round(amount).toLocaleString('es-CO')} (${method || 'Efectivo'}) a la venta #${id}`,
            despues: await fila(connection, 'pagos', pagoId), usuario: usuarioDe(req) });
        await connection.query('UPDATE ventas SET estado = ? WHERE id = ?', [saldo - amount <= 0.01 ? 'paid' : 'pending', id]);

        await connection.commit();
        res.status(201).json({ message: 'Payment added' });
    } catch (error) {
        if (connection) await connection.rollback();
        next(error);
    } finally {
        if (connection) connection.release();
    }
});

app.put('/api/sales/:id', async (req, res, next) => {
    const { id } = req.params;
    const { date, customerId, customerName, phone, idDocument, city, address, method } = req.body;
    const items = normalizarItems(req.body.items);
    if (errorItems(items)) return res.status(400).json({ error: errorItems(items) });
    const total = totalDeItems(items);

    let connection;
    try {
        connection = await db.getConnection();
        await connection.beginTransaction();

        const [actual] = await connection.query('SELECT estado, fecha FROM ventas WHERE id = ? FOR UPDATE', [id]);
        if (!actual.length) {
            await connection.rollback();
            return res.status(404).json({ error: 'Venta no encontrada' });
        }
        if (esquema.blindaje && await esVentaWeb(connection, id)) {
            await connection.rollback();
            return res.status(400).json({ error: 'Las ventas de la tienda web no se editan aquí: se anulan con el reembolso en Mercado Pago' });
        }
        if (await ventaAnulada(connection, id)) {
            await connection.rollback();
            return res.status(400).json({ error: 'La venta está anulada: no se puede editar' });
        }
        const fecha = esquema.blindaje ? fechaDocumento(date, { original: actual[0].fecha }) : date;
        // Ni la fecha original ni la nueva pueden caer en un mes cerrado
        if (esquema.trazabilidad) {
            await exigirPeriodoAbierto(connection, actual[0].fecha, 'ventas');
            await exigirPeriodoAbierto(connection, fecha, 'ventas');
        }
        const ventaAntes = await documentoVenta(connection, id);

        // Editar productos o precios no debe cambiar un estado de pago ya real:
        // se recalcula con los abonos registrados. Sin abonos se conserva el estado anterior.
        const [pagos] = await connection.query(`SELECT COUNT(*) as n, COALESCE(SUM(monto), 0) as totalPaid FROM pagos WHERE venta_id = ?${esquema.caja ? ' AND anulada_en IS NULL' : ''}`, [id]);
        const pagado = toNumber(pagos[0].totalPaid);
        // Lo ya cobrado no desaparece: el total no puede quedar por debajo de lo pagado
        if (esquema.blindaje && pagado - total > 0.01) {
            await connection.rollback();
            return res.status(400).json({ error: `Esta venta ya tiene $${Math.round(pagado).toLocaleString('es-CO')} pagados: el nuevo total ($${Math.round(total).toLocaleString('es-CO')}) no puede quedar por debajo. Para devolver dinero, anula la venta y regístrala de nuevo.` });
        }
        const status = Number(pagos[0].n) > 0
            ? (pagado >= total - 0.01 ? 'paid' : 'pending')
            : actual[0].estado;

        let finalCustomerId;
        if (esquema.blindaje) {
            finalCustomerId = await resolverCliente(connection, req.body);
        } else {
            finalCustomerId = customerId || null;
            if (!finalCustomerId && customerName) {
                const [clientResult] = await connection.query(
                    'INSERT INTO clientes (nombre, telefono, cedula, ciudad, direccion) VALUES (?, ?, ?, ?, ?)',
                    [customerName, phone || null, idDocument || null, city || null, address || null]
                );
                finalCustomerId = clientResult.insertId;
            }
        }

        // Primero vuelve lo que salió con la versión anterior; luego se validan y descuentan las líneas nuevas
        await devolverVenta(connection, id, 'Edición de la venta', req.user?.id);
        await connection.query('DELETE FROM venta_detalles WHERE venta_id = ?', [id]);
        if (esquema.blindaje) await validarLineasVenta(connection, items);

        await connection.query('UPDATE ventas SET total = ?, fecha = ?, cliente_id = ?, estado = ?, metodo = ? WHERE id = ?',
            [total, fecha, finalCustomerId, status, method, id]);
        const auditarEdicion = async () => auditar(connection, { accion: 'editar', entidad: 'venta', entidadId: id, resumen: `Venta #${id} editada`,
            antes: ventaAntes, despues: await documentoVenta(connection, id), usuario: usuarioDe(req) });

        for (const item of items) await insertarDetalle(connection, id, item, req.user?.id);
        await auditarEdicion();

        await connection.commit();
        res.json({ id, ...req.body, total, status });
    } catch (error) {
        if (connection) await connection.rollback();
        next(error);
    } finally {
        if (connection) connection.release();
    }
});

app.delete('/api/sales/:id', async (req, res, next) => {
    const { id } = req.params;
    let connection;
    try {
        connection = await db.getConnection();
        await connection.beginTransaction();
        if (esquema.blindaje && await esVentaWeb(connection, id)) {
            await connection.rollback();
            return res.status(400).json({ error: 'Las ventas de la tienda web no se eliminan aquí: se anulan con el reembolso en Mercado Pago' });
        }
        // Con la caja por sesiones nada se borra: se anula y el dinero vuelve en la caja abierta
        if (esquema.caja) {
            const r = await anularVenta(connection, id, { motivo: req.query.reason || 'Venta anulada desde el panel', usuarioId: req.user?.id, usuario: usuarioDe(req) });
            await connection.commit();
            return res.json({ message: 'Venta anulada: inventario devuelto y devolución registrada en la caja', ...r });
        }

        // Vuelve todo lo que salió: productos, componentes de kits y lo que descontó la receta de un decant
        await devolverVenta(connection, id, 'Venta eliminada', req.user?.id);
        await connection.query('DELETE FROM venta_detalles WHERE venta_id = ?', [id]);
        await connection.query('DELETE FROM pagos WHERE venta_id = ?', [id]);
        await connection.query('DELETE FROM ventas WHERE id = ?', [id]);
        await connection.commit();
        res.json({ message: 'Sale deleted and stock adjusted' });
    } catch (error) {
        if (connection) await connection.rollback();
        next(error);
    } finally {
        if (connection) connection.release();
    }
});

// --- COMPRAS (Purchases) ---
// Con la migración 016 las anuladas no se listan ni cuentan (quedan como historia)
app.get('/api/purchases', async (req, res, next) => {
    try {
        const [rows] = await db.query(`SELECT co.id, co.inventario_id as productId, co.proveedor_id as supplierId, co.cantidad, co.monto as amount, co.precio_unitario as unitPrice, co.fecha as date, pr.nombre as productName, prve.nombre as supplierName
            ${esquema.caja ? ', mp.nombre as method, mp.es_efectivo as isCash' : ''}
            ${esquema.recepciones ? ', co.recepcion_id as receptionId, rc.factura as invoice' : ''}
            FROM compras co ${esquema.recepciones ? 'LEFT JOIN recepciones rc ON rc.id = co.recepcion_id' : ''} LEFT JOIN inventario pr ON co.inventario_id = pr.id LEFT JOIN proveedores prve ON co.proveedor_id = prve.id
            ${esquema.caja ? 'LEFT JOIN metodos_pago mp ON mp.id = co.metodo_pago_id WHERE co.anulada_en IS NULL' : ''}
            ORDER BY co.fecha DESC`);
        res.json(rows || []);
    } catch (error) { next(error); }
});

const datosCompra = (body) => {
    const cantidad = redondear2(Math.max(0, parseFloat(body.quantity) || 0));
    const precioUnitario = Math.max(0, parseFloat(body.unitPrice) || 0);
    return {
        invId: body.productId ? parseInt(body.productId, 10) : null,
        suppId: body.supplierId ? parseInt(body.supplierId, 10) : null,
        cantidad,
        precioUnitario,
        // El monto de la compra es cantidad × precio unitario (antes se guardaba el que llegara)
        monto: esquema.blindaje ? redondear2(cantidad * precioUnitario) : parseFloat(body.amount || body.total || 0) || 0,
        fecha: body.date,
        metodo: body.method
    };
};

const errorCompra = (c) => {
    if (!c.invId || !c.cantidad) return 'Producto y cantidad son obligatorios';
    if (!(c.precioUnitario > 0)) return 'El precio unitario de la compra debe ser mayor que 0';
    return null;
};

// Entrada de una compra: suma stock y recalcula el costo promedio (reglas I-02, I-03)
const entradaCompra = (connection, compraId, c, usuarioId) => moverStock(connection, {
    inventarioId: c.invId, cantidad: c.cantidad, tipo: 'compra', costoUnitario: c.precioUnitario, recalcularCosto: true,
    origenTipo: 'compra', origenId: compraId, usuarioId
});

// Reversa de una compra (edición o anulación). Si esas unidades ya se vendieron, no se permite.
const reversaCompra = async (connection, compraId, motivo, usuarioId) => {
    const [rows] = await connection.query('SELECT inventario_id, cantidad, precio_unitario FROM compras WHERE id = ? FOR UPDATE', [compraId]);
    if (rows.length && rows[0].inventario_id) {
        await moverStock(connection, {
            inventarioId: rows[0].inventario_id, cantidad: -Number(rows[0].cantidad), tipo: 'anulacion_compra',
            costoUnitario: Number(rows[0].precio_unitario), recalcularCosto: true, origenTipo: 'compra', origenId: Number(compraId), motivo, usuarioId
        });
    }
    return rows.length > 0;
};

// Un documento anulado ya no se edita ni se vuelve a anular
async function exigirVigente(connection, tabla, id, etiqueta) {
    const [[fila]] = await connection.query(`SELECT ${esquema.caja ? 'anulada_en' : 'NULL AS anulada_en'}, fecha FROM ${tabla} WHERE id = ? FOR UPDATE`, [id]);
    if (!fila) throw Object.assign(new Error(`${etiqueta} no encontrada`), { status: 404 });
    if (fila.anulada_en) throw Object.assign(new Error(`${etiqueta} está anulada`), { status: 400 });
    return fila;
}

// Lo que salió de la caja por una compra (con su método); 0 si se anuló
const dineroCompra = (connection, id, monto, metodoPagoId, nombre, usuarioId) => sincronizarDinero(connection, {
    origenTipo: 'compra', origenId: Number(id), tipo: 'compra', monto: -monto, metodoPagoId, descripcion: `Compra #${id}: ${nombre}`, usuarioId });

const nombreItem = async (connection, id) => (await connection.query('SELECT nombre FROM inventario WHERE id = ?', [id]))[0][0]?.nombre || `#${id}`;

app.post('/api/purchases', async (req, res, next) => {
    const c = datosCompra(req.body);
    if (errorCompra(c)) return res.status(400).json({ error: errorCompra(c) });
    try {
        if (esquema.blindaje) c.fecha = fechaDocumento(c.fecha, { campo: 'La fecha de la compra' });
        const id = await transaccion(async (connection) => {
            if (esquema.trazabilidad) await exigirPeriodoAbierto(connection, c.fecha, 'compras');
            if (esquema.blindaje) await validarItemCompra(connection, c.invId);
            const metodoId = esquema.caja ? await metodoPagoId(connection, c.metodo, { crear: false }) : null;
            const [result] = await connection.query(
                `INSERT INTO compras (inventario_id, proveedor_id, cantidad, monto, precio_unitario, fecha${esquema.caja ? ', metodo_pago_id' : ''}) VALUES (?, ?, ?, ?, ?, ?${esquema.caja ? ', ?' : ''})`,
                [c.invId, c.suppId, c.cantidad, c.monto, c.precioUnitario, c.fecha, ...(esquema.caja ? [metodoId] : [])]
            );
            await entradaCompra(connection, result.insertId, c, req.user?.id);
            await dineroCompra(connection, result.insertId, c.monto, metodoId, await nombreItem(connection, c.invId), req.user?.id);
            if (esquema.trazabilidad) await connection.query('UPDATE compras SET creado_por = ? WHERE id = ?', [req.user?.id || null, result.insertId]);
            await auditar(connection, { accion: 'crear', entidad: 'compra', entidadId: result.insertId, resumen: `Compra #${result.insertId}: ${await nombreItem(connection, c.invId)} por $${Math.round(c.monto).toLocaleString('es-CO')}`,
                despues: await fila(connection, 'compras', result.insertId), usuario: usuarioDe(req) });
            return result.insertId;
        });
        res.status(201).json({ id, ...req.body, amount: c.monto });
    } catch (error) { next(error); }
});

app.put('/api/purchases/:id', async (req, res, next) => {
    const { id } = req.params;
    const c = datosCompra(req.body);
    if (errorCompra(c)) return res.status(400).json({ error: errorCompra(c) });
    try {
        await transaccion(async (connection) => {
            const orig = await exigirVigente(connection, 'compras', id, 'La compra');
            const compraAntes = await fila(connection, 'compras', id);
            if (esquema.blindaje) {
                c.fecha = fechaDocumento(c.fecha, { original: orig.fecha, campo: 'La fecha de la compra' });
                if (esquema.trazabilidad) {
                    await exigirPeriodoAbierto(connection, orig.fecha, 'compras');
                    await exigirPeriodoAbierto(connection, c.fecha, 'compras');
                }
                await validarItemCompra(connection, c.invId);
            }
            const metodoId = esquema.caja ? await metodoPagoId(connection, c.metodo, { crear: false }) : null;
            await reversaCompra(connection, id, 'Edición de la compra', req.user?.id);
            await connection.query(`UPDATE compras SET inventario_id = ?, proveedor_id = ?, cantidad = ?, monto = ?, precio_unitario = ?, fecha = ?${esquema.caja ? ', metodo_pago_id = ?' : ''} WHERE id = ?`,
                [c.invId, c.suppId, c.cantidad, c.monto, c.precioUnitario, c.fecha, ...(esquema.caja ? [metodoId] : []), id]);
            await entradaCompra(connection, Number(id), c, req.user?.id);
            // Si cambió el monto o el método, la diferencia queda en la caja abierta
            await dineroCompra(connection, id, c.monto, metodoId, await nombreItem(connection, c.invId), req.user?.id);
            await auditar(connection, { accion: 'editar', entidad: 'compra', entidadId: id, resumen: `Compra #${id} editada`,
                antes: compraAntes, despues: await fila(connection, 'compras', id), usuario: usuarioDe(req) });
        });
        res.json({ id, ...req.body, amount: c.monto });
    } catch (error) { next(error); }
});

// Anular una compra: sale del inventario lo que entró y el dinero vuelve en la caja abierta
app.delete('/api/purchases/:id', async (req, res, next) => {
    const { id } = req.params;
    const motivo = String(req.query.reason || 'Compra anulada').substring(0, 255);
    try {
        await transaccion(async (connection) => {
            await exigirVigente(connection, 'compras', id, 'La compra');
            await reversaCompra(connection, id, motivo, req.user?.id);
            if (!esquema.caja) {
                await connection.query('DELETE FROM compras WHERE id = ?', [id]);
                return;
            }
            const [[compra]] = await connection.query('SELECT inventario_id, metodo_pago_id FROM compras WHERE id = ?', [id]);
            const compraAntes = await fila(connection, 'compras', id);
            await connection.query('UPDATE compras SET anulada_en = NOW(), anulada_por = ?, motivo_anulacion = ? WHERE id = ?', [req.user?.id || null, motivo, id]);
            await dineroCompra(connection, id, 0, compra.metodo_pago_id, `anulada (${await nombreItem(connection, compra.inventario_id)})`, req.user?.id);
            await auditar(connection, { accion: 'anular', entidad: 'compra', entidadId: id, resumen: `Compra #${id} anulada: ${motivo}`,
                antes: compraAntes, despues: await fila(connection, 'compras', id), usuario: usuarioDe(req) });
        });
        res.json({ message: esquema.caja ? 'Compra anulada: stock y caja ajustados' : 'Purchase deleted and stock adjusted' });
    } catch (error) { next(error); }
});

// --- RECEPCIONES DE MERCANCÍA (migración 017) ---
// Una factura de proveedor con varias líneas, en una sola transacción: o entra todo o nada.
// Cada línea es una compra: suma stock, recalcula el costo promedio y sale de la caja con el método elegido.
const sinRecepciones = (res) => res.status(503).json({ error: 'Las recepciones aún no están disponibles (migración 017 pendiente)' });

app.post('/api/receptions', async (req, res, next) => {
    if (!esquema.recepciones) return sinRecepciones(res);
    const lineas = (Array.isArray(req.body.lines) ? req.body.lines : []).map((l) => datosCompra({ ...l, date: req.body.date, method: req.body.method, supplierId: req.body.supplierId }));
    if (!lineas.length) return res.status(400).json({ error: 'La recepción necesita al menos un producto' });
    const malas = lineas.map(errorCompra).filter(Boolean);
    if (malas.length) return res.status(400).json({ error: malas[0] });
    try {
        const fecha = fechaDocumento(req.body.date, { campo: 'La fecha de la recepción' });
        const factura = req.body.invoice ? String(req.body.invoice).trim().substring(0, 60) : null;
        const r = await transaccion(async (connection) => {
            if (esquema.trazabilidad) await exigirPeriodoAbierto(connection, fecha, 'recepciones de mercancía');
            const metodoId = await metodoPagoId(connection, req.body.method, { crear: false });
            const proveedor = Number.parseInt(req.body.supplierId, 10) || null;
            if (proveedor) {
                const [[p]] = await connection.query('SELECT id FROM proveedores WHERE id = ?', [proveedor]);
                if (!p) throw Object.assign(new Error('El proveedor no existe'), { status: 400 });
            }
            const [rec] = await connection.query('INSERT INTO recepciones (proveedor_id, factura, fecha, metodo_pago_id, notas, usuario_id) VALUES (?, ?, ?, ?, ?, ?)',
                [proveedor, factura, fecha, metodoId, req.body.notes ? String(req.body.notes).substring(0, 500) : null, req.user?.id || null]);
            let total = 0;
            for (const c of lineas) {
                await validarItemCompra(connection, c.invId);
                const [compra] = await connection.query(
                    'INSERT INTO compras (inventario_id, proveedor_id, cantidad, monto, precio_unitario, fecha, metodo_pago_id, recepcion_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
                    [c.invId, proveedor, c.cantidad, c.monto, c.precioUnitario, fecha, metodoId, rec.insertId]);
                await entradaCompra(connection, compra.insertId, c, req.user?.id);
                await dineroCompra(connection, compra.insertId, c.monto, metodoId, `${await nombreItem(connection, c.invId)}${factura ? ` (factura ${factura})` : ''}`, req.user?.id);
                total += c.monto;
            }
            if (esquema.trazabilidad) await connection.query('UPDATE compras SET creado_por = ? WHERE recepcion_id = ?', [req.user?.id || null, rec.insertId]);
            const [lineasRec] = await connection.query('SELECT id, inventario_id, cantidad, precio_unitario, monto FROM compras WHERE recepcion_id = ? ORDER BY id', [rec.insertId]);
            await auditar(connection, { accion: 'crear', entidad: 'recepcion', entidadId: rec.insertId, resumen: `Recepción #${rec.insertId}${factura ? ` (factura ${factura})` : ''}: ${lineas.length} producto(s) por $${Math.round(total).toLocaleString('es-CO')}`,
                despues: { ...(await fila(connection, 'recepciones', rec.insertId)), lineas: lineasRec }, usuario: usuarioDe(req) });
            return { id: rec.insertId, total: redondear2(total), lines: lineas.length };
        });
        res.status(201).json(r);
    } catch (error) { next(error); }
});

app.get('/api/receptions', async (req, res, next) => {
    if (!esquema.recepciones) return sinRecepciones(res);
    try {
        const [rows] = await db.query(`SELECT r.id, r.factura AS invoice, r.fecha AS date, p.nombre AS supplierName, m.nombre AS method, u.username AS user,
                COUNT(c.id) AS lineCount, COALESCE(SUM(IF(c.anulada_en IS NULL, c.monto, 0)), 0) AS total, SUM(c.anulada_en IS NULL) AS activeLines
            FROM recepciones r LEFT JOIN proveedores p ON p.id = r.proveedor_id LEFT JOIN metodos_pago m ON m.id = r.metodo_pago_id
            LEFT JOIN usuarios u ON u.id = r.usuario_id LEFT JOIN compras c ON c.recepcion_id = r.id
            GROUP BY r.id ORDER BY r.id DESC LIMIT 100`);
        res.json(rows.map((r) => ({ ...r, total: Number(r.total), lineCount: Number(r.lineCount), voided: Number(r.activeLines) === 0 })));
    } catch (error) { next(error); }
});

// Anular una recepción completa: cada línea vigente se anula como una compra
app.delete('/api/receptions/:id', async (req, res, next) => {
    if (!esquema.recepciones) return sinRecepciones(res);
    const motivo = String(req.query.reason || `Recepción #${req.params.id} anulada`).substring(0, 255);
    try {
        const n = await transaccion(async (connection) => {
            const [lineas] = await connection.query('SELECT id, inventario_id, metodo_pago_id FROM compras WHERE recepcion_id = ? AND anulada_en IS NULL FOR UPDATE', [req.params.id]);
            if (!lineas.length) throw Object.assign(new Error('La recepción no existe o ya está anulada'), { status: 400 });
            for (const l of lineas) {
                await reversaCompra(connection, l.id, motivo, req.user?.id);
                await connection.query('UPDATE compras SET anulada_en = NOW(), anulada_por = ?, motivo_anulacion = ? WHERE id = ?', [req.user?.id || null, motivo, l.id]);
                await dineroCompra(connection, l.id, 0, l.metodo_pago_id, `anulada (${await nombreItem(connection, l.inventario_id)})`, req.user?.id);
            }
            await auditar(connection, { accion: 'anular', entidad: 'recepcion', entidadId: req.params.id, resumen: `Recepción #${req.params.id} anulada (${lineas.length} línea(s)): ${motivo}`,
                antes: { lineas }, usuario: usuarioDe(req) });
            return lineas.length;
        });
        res.json({ message: `Recepción anulada: ${n} línea(s)` });
    } catch (error) { next(error); }
});

// --- CONTEO FÍSICO MASIVO ---
// { reason, lines: [{ productId, counted }] }: cada diferencia queda como ajuste con el motivo del conteo
app.post('/api/inventory/count', async (req, res, next) => {
    const lineas = Array.isArray(req.body.lines) ? req.body.lines : [];
    if (!lineas.length) return res.status(400).json({ error: 'El conteo no trae productos' });
    const motivo = `Conteo físico ${fechaDocumento(new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' })).slice(0, 10)}${req.body.reason ? `: ${String(req.body.reason).trim()}` : ''}`;
    try {
        const ajustes = await transaccion(async (connection) => {
            const hechos = [];
            const vistos = new Set();
            for (const l of lineas) {
                const id = Number.parseInt(l.productId, 10);
                const contado = num(l.counted);
                if (!id || contado === null || !(contado >= 0)) throw Object.assign(new Error('Cada línea del conteo necesita un producto y una cantidad de 0 o más'), { status: 400 });
                if (vistos.has(id)) throw Object.assign(new Error('Un producto aparece dos veces en el conteo'), { status: 400 });
                vistos.add(id);
                if ((await componentesDe(connection, id)).length) throw Object.assign(new Error('Los kits no se cuentan: cuenta sus componentes'), { status: 400 });
                const [[item]] = await connection.query('SELECT nombre, stock FROM inventario WHERE id = ? FOR UPDATE', [id]);
                if (!item) throw Object.assign(new Error(`El producto ${id} no existe`), { status: 400 });
                const diferencia = redondear2(contado - Number(item.stock));
                if (!diferencia) continue;
                await moverStock(connection, { inventarioId: id, cantidad: diferencia, tipo: 'ajuste', origenTipo: 'ajuste', motivo, usuarioId: req.user?.id });
                hechos.push({ productId: id, name: item.nombre, before: Number(item.stock), counted: contado, difference: diferencia });
            }
            if (hechos.length) {
                await auditar(connection, { accion: 'ajustar', entidad: 'conteo', resumen: `${motivo}: ${hechos.length} ajuste(s)`, despues: hechos, usuario: usuarioDe(req) });
            }
            return hechos;
        });
        res.status(201).json({ adjusted: ajustes.length, unchanged: lineas.length - ajustes.length, adjustments: ajustes });
    } catch (error) { next(error); }
});

// --- CONSULTA DE EXISTENCIAS ---
// Liviana (sin ventas, compras ni clientes): lo que hay, cuánto alcanza y qué lo limita
app.get('/api/stock', async (req, res, next) => {
    try {
        const [rows] = await db.query(`SELECT ${COLS_PRODUCTO()} FROM inventario ${esquema.inventarioTipos ? 'WHERE activo = 1' : ''} ORDER BY nombre ASC`);
        const porId = new Map(rows.map((r) => [r.id, r]));
        const kits = await resumenKits(db);
        // Componente que limita cada kit (el que alcanza para menos)
        const limita = new Map();
        if (esquema.kits) {
            const [comps] = await db.query('SELECT kit_id, componente_id, cantidad FROM kit_componentes');
            for (const c of comps) {
                const item = porId.get(c.componente_id);
                const alcanza = item ? Math.floor(Number(item.stock) / Number(c.cantidad) + 1e-9) : 0;
                const actual = limita.get(c.kit_id);
                if (!actual || alcanza < actual.alcanza) limita.set(c.kit_id, { alcanza, nombre: item?.name || `#${c.componente_id}` });
            }
        }
        // Decants que salen de cada esencia según la receta de 10 ml
        let mlDecant = 0;
        if (esquema.decants) {
            const [[r]] = await db.query("SELECT COALESCE(SUM(cantidad), 0) AS ml FROM recetas WHERE ambito = 'decant' AND rol = 'esencia'");
            mlDecant = Number(r.ml) || 0;
        }
        res.json(rows.map((r) => {
            const p = productoDesdeFila(r);
            const k = kits.get(r.id);
            return {
                id: p.id, name: p.name, code: p.code || null, category: p.category, type: p.type || 'terminado', unit: p.unit || 'und',
                stock: k ? k.stock : p.stock, minStock: p.minStock || 0, price: p.price, essenceClass: p.essenceClass || null,
                ...(k ? { isKit: true, limitedBy: limita.get(r.id)?.nombre || null } : {}),
                ...(p.type === 'esencia' && mlDecant > 0 ? { decants: Math.max(0, Math.floor(p.stock / mlDecant + 1e-9)) } : {})
            };
        }));
    } catch (error) { next(error); }
});

// --- GASTOS (Expenses) ---
app.get('/api/expenses', async (req, res, next) => {
    try {
        const [rows] = await db.query(esquema.categoriasGasto
            ? `SELECT g.id, g.descripcion as description, g.monto as amount, COALESCE(c.nombre, g.categoria) as category, g.fecha as date
                ${esquema.caja ? ', mp.nombre as method, mp.es_efectivo as isCash' : ''}
               FROM gastos g LEFT JOIN categorias_gasto c ON c.id = g.categoria_id
               ${esquema.caja ? 'LEFT JOIN metodos_pago mp ON mp.id = g.metodo_pago_id WHERE g.anulada_en IS NULL' : ''}
               ORDER BY g.fecha DESC`
            : 'SELECT id, descripcion as description, monto as amount, categoria as category, fecha as date FROM gastos ORDER BY fecha DESC');
        res.json(rows);
    } catch (error) { next(error); }
});

const dineroGasto = (connection, id, monto, metodoPagoId, descripcion, usuarioId) => sincronizarDinero(connection, {
    origenTipo: 'gasto', origenId: Number(id), tipo: 'gasto', monto: -monto, metodoPagoId, descripcion: `Gasto #${id}: ${descripcion}`, usuarioId });

app.post('/api/expenses', async (req, res, next) => {
    const { description, amount, category } = req.body;
    if (!String(description || '').trim() || !(Number(amount) > 0)) return res.status(400).json({ error: 'La descripción y un monto mayor que 0 son obligatorios' });
    try {
        const date = esquema.blindaje ? fechaDocumento(req.body.date, { campo: 'La fecha del gasto' }) : req.body.date;
        const monto = redondear2(amount);
        const id = await transaccion(async (connection) => {
            if (esquema.trazabilidad) await exigirPeriodoAbierto(connection, date, 'gastos');
            const categoriaId = await categoriaGastoId(connection, category, { crear: !esquema.blindaje });
            if (!esquema.categoriasGasto) {
                const [r] = await connection.query('INSERT INTO gastos (descripcion, monto, categoria, fecha) VALUES (?, ?, ?, ?)', [description, monto, category, date]);
                return r.insertId;
            }
            const metodoId = esquema.caja ? await metodoPagoId(connection, req.body.method, { crear: false }) : null;
            const [r] = await connection.query(
                `INSERT INTO gastos (descripcion, monto, categoria, categoria_id, fecha${esquema.caja ? ', metodo_pago_id' : ''}) VALUES (?, ?, ?, ?, ?${esquema.caja ? ', ?' : ''})`,
                [description, monto, category || 'Otros', categoriaId, date, ...(esquema.caja ? [metodoId] : [])]);
            await dineroGasto(connection, r.insertId, monto, metodoId, description, req.user?.id);
            if (esquema.trazabilidad) await connection.query('UPDATE gastos SET creado_por = ? WHERE id = ?', [req.user?.id || null, r.insertId]);
            await auditar(connection, { accion: 'crear', entidad: 'gasto', entidadId: r.insertId, resumen: `Gasto #${r.insertId}: ${description} por $${Math.round(monto).toLocaleString('es-CO')}`,
                despues: await fila(connection, 'gastos', r.insertId), usuario: usuarioDe(req) });
            return r.insertId;
        });
        res.status(201).json({ id, ...req.body });
    } catch (error) { next(error); }
});

app.put('/api/expenses/:id', async (req, res, next) => {
    const { id } = req.params;
    const { description, amount, category } = req.body;
    if (!String(description || '').trim() || !(Number(amount) > 0)) return res.status(400).json({ error: 'La descripción y un monto mayor que 0 son obligatorios' });
    try {
        const monto = redondear2(amount);
        await transaccion(async (connection) => {
            const orig = await exigirVigente(connection, 'gastos', id, 'El gasto');
            const date = esquema.blindaje ? fechaDocumento(req.body.date, { original: orig.fecha, campo: 'La fecha del gasto' }) : req.body.date;
            if (esquema.trazabilidad) {
                await exigirPeriodoAbierto(connection, orig.fecha, 'gastos');
                await exigirPeriodoAbierto(connection, date, 'gastos');
            }
            const gastoAntes = await fila(connection, 'gastos', id);
            const categoriaId = await categoriaGastoId(connection, category, { crear: !esquema.blindaje });
            if (!esquema.categoriasGasto) {
                await connection.query('UPDATE gastos SET descripcion = ?, monto = ?, categoria = ?, fecha = ? WHERE id = ?', [description, monto, category, date, id]);
                return;
            }
            const metodoId = esquema.caja ? await metodoPagoId(connection, req.body.method, { crear: false }) : null;
            await connection.query(`UPDATE gastos SET descripcion = ?, monto = ?, categoria = ?, categoria_id = ?, fecha = ?${esquema.caja ? ', metodo_pago_id = ?' : ''} WHERE id = ?`,
                [description, monto, category || 'Otros', categoriaId, date, ...(esquema.caja ? [metodoId] : []), id]);
            await dineroGasto(connection, id, monto, metodoId, description, req.user?.id);
            await auditar(connection, { accion: 'editar', entidad: 'gasto', entidadId: id, resumen: `Gasto #${id} editado`,
                antes: gastoAntes, despues: await fila(connection, 'gastos', id), usuario: usuarioDe(req) });
        });
        res.json({ id, ...req.body });
    } catch (error) { next(error); }
});

app.delete('/api/expenses/:id', async (req, res, next) => {
    const { id } = req.params;
    const motivo = String(req.query.reason || 'Gasto anulado').substring(0, 255);
    try {
        await transaccion(async (connection) => {
            await exigirVigente(connection, 'gastos', id, 'El gasto');
            if (!esquema.caja) {
                await connection.query('DELETE FROM gastos WHERE id = ?', [id]);
                return;
            }
            const [[g]] = await connection.query('SELECT descripcion, metodo_pago_id FROM gastos WHERE id = ?', [id]);
            const gastoAntes = await fila(connection, 'gastos', id);
            await connection.query('UPDATE gastos SET anulada_en = NOW(), anulada_por = ?, motivo_anulacion = ? WHERE id = ?', [req.user?.id || null, motivo, id]);
            await dineroGasto(connection, id, 0, g.metodo_pago_id, `anulado (${g.descripcion})`, req.user?.id);
            await auditar(connection, { accion: 'anular', entidad: 'gasto', entidadId: id, resumen: `Gasto #${id} anulado: ${motivo}`,
                antes: gastoAntes, despues: await fila(connection, 'gastos', id), usuario: usuarioDe(req) });
        });
        res.json({ message: esquema.caja ? 'Gasto anulado: la caja se ajustó' : 'Expense deleted' });
    } catch (error) { next(error); }
});

// Listas cerradas para los formularios
app.get('/api/payment-methods', async (req, res, next) => {
    try {
        if (!esquema.metodosPago) return res.json([{ id: null, name: 'Efectivo', isCash: 1 }, { id: null, name: 'Transferencia', isCash: 0 }]);
        // La tarjeta de regalo no se elige como método: se usa con su código al vender
        const [rows] = await db.query(`SELECT id, nombre as name, es_efectivo as isCash FROM metodos_pago WHERE activo = 1${esquema.tarjetas ? ' AND mueve_caja = 1' : ''} ORDER BY orden, nombre`);
        res.json(rows);
    } catch (error) { next(error); }
});

app.get('/api/expense-categories', async (req, res, next) => {
    try {
        if (!esquema.categoriasGasto) return res.json([]);
        const [rows] = await db.query('SELECT id, nombre as name FROM categorias_gasto WHERE activo = 1 ORDER BY nombre');
        res.json(rows);
    } catch (error) { next(error); }
});

// --- CAJA POR SESIONES (migración 016) ---
const sinCaja = (res) => res.status(503).json({ error: 'La caja por sesiones aún no está disponible (migración 016 pendiente)' });

// Sesión abierta con su resumen en vivo y sus movimientos
app.get('/api/cash/current', async (req, res, next) => {
    if (!esquema.caja) return sinCaja(res);
    try {
        const sesion = await sesionAbierta(db);
        res.json({ session: sesionPublica(sesion), summary: await resumenSesion(db, sesion, { conMovimientos: true }) });
    } catch (error) { next(error); }
});

// Historial de sesiones cerradas (la más reciente primero)
app.get('/api/cash/sessions', async (req, res, next) => {
    if (!esquema.caja) return sinCaja(res);
    try {
        const [rows] = await db.query(`SELECT s.*, ua.username AS abrio, uc.username AS cerro FROM sesiones_caja s
            LEFT JOIN usuarios ua ON ua.id = s.abierta_por LEFT JOIN usuarios uc ON uc.id = s.cerrada_por
            WHERE s.abierta IS NULL ORDER BY s.id DESC LIMIT 200`);
        res.json(rows.map((s) => {
            let resumen = null;
            try { resumen = s.resumen ? JSON.parse(s.resumen) : null; } catch { /* resumen ilegible: se muestra sin él */ }
            return { ...sesionPublica(s), openedBy: s.abrio, closedBy: s.cerro, summary: resumen };
        }));
    } catch (error) { next(error); }
});

app.get('/api/cash/sessions/:id', async (req, res, next) => {
    if (!esquema.caja) return sinCaja(res);
    try {
        const [[s]] = await db.query('SELECT * FROM sesiones_caja WHERE id = ?', [req.params.id]);
        if (!s) return res.status(404).json({ error: 'Sesión no encontrada' });
        res.json({ session: sesionPublica(s), summary: await resumenSesion(db, s, { conMovimientos: true }) });
    } catch (error) { next(error); }
});

// Ingreso o retiro manual de efectivo: { type: 'ingreso' | 'retiro', amount, reason }
app.post('/api/cash/movements', async (req, res, next) => {
    if (!esquema.caja) return sinCaja(res);
    try {
        await transaccion(async (c) => {
            await movimientoManual(c, { tipo: req.body.type, monto: req.body.amount, motivo: req.body.reason, usuarioId: req.user?.id });
            await auditar(c, { accion: req.body.type === 'retiro' ? 'retirar' : 'ingresar', entidad: 'caja',
                resumen: `${req.body.type === 'retiro' ? 'Retiro' : 'Ingreso'} de efectivo $${Math.round(Number(req.body.amount) || 0).toLocaleString('es-CO')}: ${req.body.reason}`,
                despues: { tipo: req.body.type, monto: Number(req.body.amount), motivo: req.body.reason }, usuario: usuarioDe(req) });
        });
        res.status(201).json({ ok: true });
    } catch (error) { next(error); }
});

// Cerrar la caja: { sessionId, countedCash, withdrawn, notes }. El servidor calcula lo esperado.
app.post('/api/cash/close', async (req, res, next) => {
    if (!esquema.caja) return sinCaja(res);
    try {
        const r = await transaccion(async (c) => {
            const cierre = await cerrarSesion(c, { sesionId: req.body.sessionId, contado: req.body.countedCash,
                retirado: req.body.withdrawn, notas: req.body.notes, usuarioId: req.user?.id });
            await auditar(c, { accion: 'cerrar', entidad: 'caja', entidadId: cierre.closedId,
                resumen: `Cierre de caja #${cierre.closedId}: contado $${Math.round(cierre.countedCash).toLocaleString('es-CO')}, diferencia $${Math.round(cierre.difference).toLocaleString('es-CO')}`,
                despues: { ...cierre, retirado: Number(req.body.withdrawn) || 0, notas: req.body.notes || null, sesion: await fila(c, 'sesiones_caja', cierre.closedId) }, usuario: usuarioDe(req) });
            return cierre;
        });
        res.status(201).json(r);
    } catch (error) { next(error); }
});

// Verificación: documentos cuyo libro de dinero no suma su monto vigente
app.get('/api/cash/audit', async (req, res, next) => {
    if (!esquema.caja) return res.json({ disponible: false, diferencias: [] });
    try {
        res.json({ disponible: true, diferencias: await auditarDinero(db) });
    } catch (error) { next(error); }
});

// --- CONTABILIDAD (migración 018): resultados, salud, periodos, bitácora y libros ---
const sinContabilidad = (res) => res.status(503).json({ error: 'La contabilidad aún no está disponible (migración 018 pendiente)' });
const rangoDe = (q) => {
    if (q.periodo) return limitesPeriodo(q.periodo);
    const re = /^\d{4}-\d{2}-\d{2}$/;
    if (!re.test(q.desde || '') || !re.test(q.hasta || '') || q.desde > q.hasta) throw Object.assign(new Error('Indica el periodo (AAAA-MM) o desde y hasta (AAAA-MM-DD)'), { status: 400 });
    return { desde: q.desde, hasta: q.hasta };
};

app.get('/api/contabilidad/resultados', async (req, res, next) => {
    try {
        const { desde, hasta } = rangoDe(req.query);
        res.json(await resultados(db, desde, hasta));
    } catch (error) { next(error); }
});

app.get('/api/contabilidad/salud', async (req, res, next) => {
    try { res.json(await salud(db)); } catch (error) { next(error); }
});

app.get('/api/contabilidad/periodos', async (req, res, next) => {
    if (!esquema.trazabilidad) return sinContabilidad(res);
    try { res.json(await listarPeriodos(db)); } catch (error) { next(error); }
});

// Cerrar un mes: { periodo: 'AAAA-MM', notas }
app.post('/api/contabilidad/periodos', async (req, res, next) => {
    if (!esquema.trazabilidad) return sinContabilidad(res);
    try {
        const r = await transaccion((c) => cerrarPeriodo(c, req.body.periodo, { usuario: usuarioDe(req), notas: req.body.notes }));
        res.status(201).json(r);
    } catch (error) { next(error); }
});

app.post('/api/contabilidad/periodos/:periodo/reabrir', async (req, res, next) => {
    if (!esquema.trazabilidad) return sinContabilidad(res);
    try {
        await transaccion((c) => reabrirPeriodo(c, req.params.periodo, { motivo: req.body.reason, usuario: usuarioDe(req) }));
        res.json({ ok: true });
    } catch (error) { next(error); }
});

// Bitácora: ?entidad=&entidadId=&q=&desde=&hasta=&pagina=
app.get('/api/contabilidad/auditoria', async (req, res, next) => {
    if (!esquema.trazabilidad) return sinContabilidad(res);
    try {
        const cond = [];
        const p = [];
        if (req.query.entidad) { cond.push('entidad = ?'); p.push(String(req.query.entidad)); }
        if (req.query.entidadId) { cond.push('entidad_id = ?'); p.push(String(req.query.entidadId)); }
        if (req.query.desde) { cond.push('creado_en >= ?'); p.push(`${req.query.desde} 00:00:00`); }
        if (req.query.hasta) { cond.push('creado_en <= ?'); p.push(`${req.query.hasta} 23:59:59`); }
        if (req.query.q) { cond.push('(resumen LIKE ? OR usuario LIKE ?)'); p.push(`%${req.query.q}%`, `%${req.query.q}%`); }
        const where = cond.length ? `WHERE ${cond.join(' AND ')}` : '';
        const pagina = Math.max(1, Number.parseInt(req.query.pagina, 10) || 1);
        const [[{ total }]] = await db.query(`SELECT COUNT(*) total FROM auditoria ${where}`, p);
        const [rows] = await db.query(`SELECT id, creado_en, usuario, accion, entidad, entidad_id, resumen, antes, despues, hash
            FROM auditoria ${where} ORDER BY id DESC LIMIT 50 OFFSET ?`, [...p, (pagina - 1) * 50]);
        res.json({ total: Number(total), pagina, registros: rows });
    } catch (error) { next(error); }
});

app.get('/api/contabilidad/libros', (req, res) => res.json(librosDisponibles()));

// Respaldo completo de la base en JSON (queda en la bitácora para que Salud sepa cuándo fue el último)
app.get('/api/contabilidad/respaldo', async (req, res, next) => {
    try {
        const r = await respaldoCompleto(db);
        const filas = Object.values(r.tablas).reduce((s, t) => s + t.length, 0);
        await transaccion((c) => auditar(c, { accion: 'respaldar', entidad: 'base', resumen: `Respaldo completo: ${Object.keys(r.tablas).length} tablas, ${filas} filas`, usuario: usuarioDe(req) }));
        res.set({ 'Content-Type': 'application/json; charset=utf-8', 'Content-Disposition': `attachment; filename="respaldo-data_${r.generado.slice(0, 10)}.json"` });
        res.send(JSON.stringify(r));
    } catch (error) { next(error); }
});

// Un libro en CSV para Excel: ?libro=ventas&periodo=AAAA-MM (o desde/hasta)
app.get('/api/contabilidad/exportar', async (req, res, next) => {
    try {
        const { desde, hasta } = rangoDe(req.query);
        const { nombre, contenido } = await exportarLibro(db, String(req.query.libro || ''), desde, hasta);
        res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${nombre}"` });
        res.send(contenido);
    } catch (error) { next(error); }
});

// --- TARJETAS DE REGALO (migración 020) ---
const sinTarjetas = (res) => res.status(503).json({ error: 'Las tarjetas de regalo aún no están disponibles (migración 020 pendiente)' });

app.get('/api/gift-cards', async (req, res, next) => {
    if (!esquema.tarjetas) return sinTarjetas(res);
    try { res.json(await listarTarjetas(db, { q: req.query.q, estado: req.query.status })); } catch (error) { next(error); }
});

app.get('/api/gift-cards/code/:code', async (req, res, next) => {
    if (!esquema.tarjetas) return sinTarjetas(res);
    try {
        const t = await buscarTarjeta(db, req.params.code);
        if (!t) return res.status(404).json({ error: 'No existe una tarjeta con ese código' });
        res.json(tarjetaPublica(t));
    } catch (error) { next(error); }
});

app.post('/api/gift-cards', async (req, res, next) => {
    if (!esquema.tarjetas) return sinTarjetas(res);
    try {
        const fecha = fechaDocumento(req.body.date, { campo: 'La fecha de la tarjeta' }).slice(0, 10);
        const t = await transaccion(async (c) => {
            await exigirPeriodoAbierto(c, fecha, 'tarjetas de regalo');
            const nueva = await emitirTarjeta(c, { valor: toNumber(req.body.value), fecha, comprador: req.body.buyer, para: req.body.recipient,
                notas: req.body.notes, metodoPagoId: req.body.methodId, usuarioId: req.user?.id });
            await auditar(c, { accion: 'crear', entidad: 'tarjeta_regalo', entidadId: nueva.id,
                resumen: `Tarjeta de regalo ${nueva.codigo} por $${Math.round(nueva.valor).toLocaleString('es-CO')} (vence ${String(nueva.vence).slice(0, 10)})`,
                despues: nueva, usuario: usuarioDe(req) });
            return nueva;
        });
        res.status(201).json(tarjetaPublica(t));
    } catch (error) { next(error); }
});

app.post('/api/gift-cards/:id/void', async (req, res, next) => {
    if (!esquema.tarjetas) return sinTarjetas(res);
    try {
        const t = await transaccion(async (c) => {
            const antes = await fila(c, 'tarjetas_regalo', req.params.id);
            await anularTarjeta(c, req.params.id, { motivo: req.body.reason, usuarioId: req.user?.id });
            const despues = await fila(c, 'tarjetas_regalo', req.params.id);
            await auditar(c, { accion: 'anular', entidad: 'tarjeta_regalo', entidadId: req.params.id,
                resumen: `Tarjeta de regalo ${despues.codigo} anulada: ${despues.motivo_anulacion}`, antes, despues, usuario: usuarioDe(req) });
            return despues;
        });
        res.json({ ok: true, code: t.codigo });
    } catch (error) { next(error); }
});

// Tareas automáticas (cierres a las 23:59 y reintentos)
app.get('/api/contabilidad/automaticos', async (req, res, next) => {
    if (!esquema.automaticos) return res.json({ disponible: false, tareas: [] });
    try {
        const [rows] = await db.query('SELECT clave, tipo, ejecutada_en, ok, detalle FROM tareas_automaticas ORDER BY ejecutada_en DESC LIMIT 100');
        res.json({ disponible: true, tareas: rows });
    } catch (error) { next(error); }
});

app.post('/api/contabilidad/automaticos/ejecutar', async (req, res, next) => {
    if (!esquema.automaticos) return res.status(503).json({ error: 'Cierres automáticos no disponibles (migración 019 pendiente)' });
    try {
        const resultado = await revisarCierres(db, { forzar: true });
        res.json({ ok: true, resultado });
    } catch (error) { next(error); }
});

// --- CIERRES DE CAJA DEL SISTEMA ANTERIOR (solo lectura desde la migración 016) ---
app.get('/api/cash-closings', async (req, res, next) => {
    try {
        const [rows] = await db.query(`
            SELECT id, fecha as date, efectivo_inicial as initialCash, efectivo_final as finalCash,
                   diferencia as difference, total_ventas as salesTotal, total_compras as purchasesTotal,
                   total_gastos as expensesTotal, ganancia as profit, notas as notes, fecha_creacion as createdAt
                   ${esquema.marcasCierre ? ', ultimo_pago_id as lastPaymentId, ultimo_gasto_id as lastExpenseId, ultima_compra_id as lastPurchaseId' : ''}
            FROM cierres_caja ORDER BY fecha DESC, id DESC
        `);
        res.json(rows);
    } catch (error) { next(error); }
});

app.post('/api/cash-closings', async (req, res, next) => {
    if (esquema.caja) return res.status(410).json({ error: 'El cierre de caja ahora se hace por sesiones: recarga el panel' });
    const { date, initialCash, finalCash, difference, salesTotal, purchasesTotal, expensesTotal, profit, notes,
            lastPaymentId, lastExpenseId, lastPurchaseId } = req.body;
    try {
        const campos = ['fecha', 'efectivo_inicial', 'efectivo_final', 'diferencia', 'total_ventas', 'total_compras', 'total_gastos', 'ganancia', 'notas'];
        const valores = [date, initialCash, finalCash, difference, salesTotal, purchasesTotal, expensesTotal, profit, notes];
        if (esquema.marcasCierre) {
            // Hasta dónde llega este cierre: se guarda en el servidor para que todos los equipos lo compartan
            campos.push('ultimo_pago_id', 'ultimo_gasto_id', 'ultima_compra_id');
            valores.push(parseInt(lastPaymentId, 10) || 0, parseInt(lastExpenseId, 10) || 0, parseInt(lastPurchaseId, 10) || 0);
        }
        const [result] = await db.query(
            `INSERT INTO cierres_caja (${campos.join(', ')}) VALUES (${campos.map(() => '?').join(', ')})`,
            valores
        );
        res.status(201).json({ id: result.insertId, ...req.body });
    } catch (error) { next(error); }
});

app.delete('/api/cash-closings/:id', async (req, res, next) => {
    if (esquema.caja) return res.status(410).json({ error: 'Los cierres son historia: no se borran' });
    try {
        await db.query('DELETE FROM cierres_caja WHERE id = ?', [req.params.id]);
        res.json({ message: 'Cash closing deleted' });
    } catch (error) { next(error); }
});

// --- Global Error Handler ---
app.use((err, req, res, next) => {
    // Errores de negocio (stock insuficiente, datos inválidos) se explican al usuario
    if (err.status && err.status < 500) return res.status(err.status).json({ error: err.message });
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Ya existe un registro con ese dato único (código o cédula)' });
    // Dos operaciones cruzadas (p. ej. dos cierres de caja a la vez): MySQL revierte una; nada quedó a medias
    if (err.code === 'ER_LOCK_DEADLOCK') return res.status(409).json({ error: 'Otra operación se cruzó con esta y no se guardó: recarga e intenta de nuevo' });
    console.error('API Error:', err.message);
    res.status(500).json({ error: 'Internal Server Error' });
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});

iniciarServidorIntegracion(db);
iniciarCierresAutomaticos(db);
