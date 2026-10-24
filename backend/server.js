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
        const [result] = await db.query(
            'INSERT INTO proveedores (nombre, telefono, email, direccion) VALUES (?, ?, ?, ?)',
            [name, phone, email, address]
        );
        res.status(201).json({ id: result.insertId, ...req.body });
    } catch (error) { next(error); }
});

app.put('/api/suppliers/:id', async (req, res, next) => {
    const { id } = req.params;
    const { name, phone, email, address } = req.body;
    try {
        await db.query(
            'UPDATE proveedores SET nombre = ?, telefono = ?, email = ?, direccion = ? WHERE id = ?',
            [name, phone, email, address, id]
        );
        res.json({ id, ...req.body });
    } catch (error) { next(error); }
});

app.delete('/api/suppliers/:id', async (req, res, next) => {
    try {
        const [[{ n }]] = await db.query('SELECT COUNT(*) AS n FROM compras WHERE proveedor_id = ?', [req.params.id]);
        if (Number(n) > 0) return res.status(400).json({ error: `Este proveedor tiene ${n} compra(s) registradas: no se puede eliminar` });
        await db.query('DELETE FROM proveedores WHERE id = ?', [req.params.id]);
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
        if (esquema.inventarioTipos) {
            await db.query('UPDATE inventario SET activo = 0 WHERE id = ?', [req.params.id]);
        } else {
            await db.query('DELETE FROM inventario WHERE id = ?', [req.params.id]);
        }
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
        const valores = await guardarConfiguraciones(db, req.body?.valores, { usuarioId: req.user?.id });
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
        await connection.query('DELETE FROM recetas');
        if (limpias.length) await connection.query('INSERT INTO recetas (ambito, ml, rol, inventario_id, cantidad, orden) VALUES ?', [limpias]);
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
        const [result] = await db.query(
            'INSERT INTO clientes (nombre, telefono, cedula, ciudad, direccion) VALUES (?, ?, ?, ?, ?)',
            [nombre, telefono || null, cedula || null, ciudad || null, direccion || null]
        );
        res.status(201).json({ id: result.insertId, ...req.body });
    } catch (error) { next(error); }
});

app.put('/api/customers/:id', async (req, res, next) => {
    const { id } = req.params;
    const { nombre, telefono, cedula, ciudad, direccion } = req.body;
    try {
        await db.query(
            'UPDATE clientes SET nombre = ?, telefono = ?, cedula = ?, ciudad = ?, direccion = ? WHERE id = ?',
            [nombre, telefono || null, cedula || null, ciudad || null, direccion || null, id]
        );
        res.json({ id, ...req.body });
    } catch (error) { next(error); }
});

app.delete('/api/customers/:id', async (req, res, next) => {
    try {
        // Con ventas, el cliente es parte de la historia (y quizá debe dinero): no se borra
        const [[{ n }]] = await db.query('SELECT COUNT(*) AS n FROM ventas WHERE cliente_id = ?', [req.params.id]);
        if (Number(n) > 0) return res.status(400).json({ error: `Este cliente tiene ${n} venta(s) registradas: no se puede eliminar` });
        await db.query('DELETE FROM clientes WHERE id = ?', [req.params.id]);
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
    const initialPayment = Math.min(Math.max(0, toNumber(req.body.initialPayment)), total);
    const status = initialPayment >= total ? 'paid' : 'pending';

    let connection;
    try {
        const fecha = esquema.blindaje ? fechaDocumento(date) : date;
        connection = await db.getConnection();
        await connection.beginTransaction();

        let finalCustomerId;
        if (esquema.blindaje) {
            await validarLineasVenta(connection, items);
            finalCustomerId = await resolverCliente(connection, req.body);
            // De contado puede ser «Consumidor final»; a crédito hay que saber quién debe
            if (esquema.caja && !finalCustomerId && initialPayment < total) {
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
            'INSERT INTO ventas (total, fecha, cliente_id, estado, metodo) VALUES (?, ?, ?, ?, ?)',
            [total, fecha, finalCustomerId, status, method]
        );
        const saleId = saleResult.insertId;

        if (initialPayment > 0) {
            await insertarPago(connection, { ventaId: saleId, monto: initialPayment, fecha, metodo: method, crear: !esquema.blindaje, usuarioId: req.user?.id });
        }

        for (const item of items) await insertarDetalle(connection, saleId, item, req.user?.id);

        await connection.commit();
        res.status(201).json({ id: saleId, ...req.body, total, status });
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

        await insertarPago(connection, { ventaId: id, monto: amount, fecha, metodo: method, crear: !esquema.blindaje, usuarioId: req.user?.id });
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

        for (const item of items) await insertarDetalle(connection, id, item, req.user?.id);

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
            const r = await anularVenta(connection, id, { motivo: req.query.reason || 'Venta anulada desde el panel', usuarioId: req.user?.id });
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
            FROM compras co LEFT JOIN inventario pr ON co.inventario_id = pr.id LEFT JOIN proveedores prve ON co.proveedor_id = prve.id
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
            if (esquema.blindaje) await validarItemCompra(connection, c.invId);
            const metodoId = esquema.caja ? await metodoPagoId(connection, c.metodo, { crear: false }) : null;
            const [result] = await connection.query(
                `INSERT INTO compras (inventario_id, proveedor_id, cantidad, monto, precio_unitario, fecha${esquema.caja ? ', metodo_pago_id' : ''}) VALUES (?, ?, ?, ?, ?, ?${esquema.caja ? ', ?' : ''})`,
                [c.invId, c.suppId, c.cantidad, c.monto, c.precioUnitario, c.fecha, ...(esquema.caja ? [metodoId] : [])]
            );
            await entradaCompra(connection, result.insertId, c, req.user?.id);
            await dineroCompra(connection, result.insertId, c.monto, metodoId, await nombreItem(connection, c.invId), req.user?.id);
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
            if (esquema.blindaje) {
                c.fecha = fechaDocumento(c.fecha, { original: orig.fecha, campo: 'La fecha de la compra' });
                await validarItemCompra(connection, c.invId);
            }
            const metodoId = esquema.caja ? await metodoPagoId(connection, c.metodo, { crear: false }) : null;
            await reversaCompra(connection, id, 'Edición de la compra', req.user?.id);
            await connection.query(`UPDATE compras SET inventario_id = ?, proveedor_id = ?, cantidad = ?, monto = ?, precio_unitario = ?, fecha = ?${esquema.caja ? ', metodo_pago_id = ?' : ''} WHERE id = ?`,
                [c.invId, c.suppId, c.cantidad, c.monto, c.precioUnitario, c.fecha, ...(esquema.caja ? [metodoId] : []), id]);
            await entradaCompra(connection, Number(id), c, req.user?.id);
            // Si cambió el monto o el método, la diferencia queda en la caja abierta
            await dineroCompra(connection, id, c.monto, metodoId, await nombreItem(connection, c.invId), req.user?.id);
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
            await connection.query('UPDATE compras SET anulada_en = NOW(), anulada_por = ?, motivo_anulacion = ? WHERE id = ?', [req.user?.id || null, motivo, id]);
            await dineroCompra(connection, id, 0, compra.metodo_pago_id, `anulada (${await nombreItem(connection, compra.inventario_id)})`, req.user?.id);
        });
        res.json({ message: esquema.caja ? 'Compra anulada: stock y caja ajustados' : 'Purchase deleted and stock adjusted' });
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
            const categoriaId = await categoriaGastoId(connection, category, { crear: !esquema.blindaje });
            if (!esquema.categoriasGasto) {
                await connection.query('UPDATE gastos SET descripcion = ?, monto = ?, categoria = ?, fecha = ? WHERE id = ?', [description, monto, category, date, id]);
                return;
            }
            const metodoId = esquema.caja ? await metodoPagoId(connection, req.body.method, { crear: false }) : null;
            await connection.query(`UPDATE gastos SET descripcion = ?, monto = ?, categoria = ?, categoria_id = ?, fecha = ?${esquema.caja ? ', metodo_pago_id = ?' : ''} WHERE id = ?`,
                [description, monto, category || 'Otros', categoriaId, date, ...(esquema.caja ? [metodoId] : []), id]);
            await dineroGasto(connection, id, monto, metodoId, description, req.user?.id);
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
            await connection.query('UPDATE gastos SET anulada_en = NOW(), anulada_por = ?, motivo_anulacion = ? WHERE id = ?', [req.user?.id || null, motivo, id]);
            await dineroGasto(connection, id, 0, g.metodo_pago_id, `anulado (${g.descripcion})`, req.user?.id);
        });
        res.json({ message: esquema.caja ? 'Gasto anulado: la caja se ajustó' : 'Expense deleted' });
    } catch (error) { next(error); }
});

// Listas cerradas para los formularios
app.get('/api/payment-methods', async (req, res, next) => {
    try {
        if (!esquema.metodosPago) return res.json([{ id: null, name: 'Efectivo', isCash: 1 }, { id: null, name: 'Transferencia', isCash: 0 }]);
        const [rows] = await db.query('SELECT id, nombre as name, es_efectivo as isCash FROM metodos_pago WHERE activo = 1 ORDER BY orden, nombre');
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
        await transaccion((c) => movimientoManual(c, { tipo: req.body.type, monto: req.body.amount, motivo: req.body.reason, usuarioId: req.user?.id }));
        res.status(201).json({ ok: true });
    } catch (error) { next(error); }
});

// Cerrar la caja: { sessionId, countedCash, withdrawn, notes }. El servidor calcula lo esperado.
app.post('/api/cash/close', async (req, res, next) => {
    if (!esquema.caja) return sinCaja(res);
    try {
        const r = await transaccion((c) => cerrarSesion(c, { sesionId: req.body.sessionId, contado: req.body.countedCash,
            retirado: req.body.withdrawn, notas: req.body.notes, usuarioId: req.user?.id }));
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
