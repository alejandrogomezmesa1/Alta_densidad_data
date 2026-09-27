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
import { moverStock, auditarStock } from './inventario.js';
import { insertarPago, categoriaGastoId } from './catalogos.js';

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

// --- PROTECT ALL FOLLOWING ROUTES ---
app.use('/api/suppliers', authenticateToken);
app.use('/api/products', authenticateToken);
app.use('/api/customers', authenticateToken);
app.use('/api/sales', authenticateToken);
app.use('/api/purchases', authenticateToken);
app.use('/api/expenses', authenticateToken);
app.use('/api/cash-closings', authenticateToken);
app.use('/api/inventory', authenticateToken);
app.use('/api/payment-methods', authenticateToken);
app.use('/api/expense-categories', authenticateToken);

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
    } : {})
});

const COLS_PRODUCTO = () => `id, nombre as name, categoria as category, precio as price, precio_costo as costPrice, stock, fecha_creacion as createdAt
    ${esquema.inventarioTipos ? ', codigo as code, tipo as type, unidad as unit, stock_minimo as minStock, unidad_compra as purchaseUnit, factor_compra as purchaseFactor' : ''}`;

app.get('/api/products', async (req, res, next) => {
    try {
        const [rows] = await db.query(`SELECT ${COLS_PRODUCTO()} FROM inventario ${esquema.inventarioTipos ? 'WHERE activo = 1' : ''} ORDER BY nombre ASC`);
        res.json(rows.map(productoDesdeFila));
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

app.post('/api/products', async (req, res, next) => {
    const { name, category, price, costPrice } = req.body;
    const stockInicial = num(req.body.stock) || 0;
    if (!name || !String(name).trim()) return res.status(400).json({ error: 'El nombre es obligatorio' });
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
    let connection;
    try {
        connection = await db.getConnection();
        await connection.beginTransaction();
        const [actual] = await connection.query('SELECT stock FROM inventario WHERE id = ? FOR UPDATE', [id]);
        if (!actual.length) {
            await connection.rollback();
            return res.status(404).json({ error: 'Producto no encontrado' });
        }
        if (esquema.inventarioTipos) {
            const d = datosInventario(req.body);
            await connection.query(
                'UPDATE inventario SET nombre = ?, categoria = ?, precio = ?, precio_costo = ?, codigo = ?, tipo = ?, unidad = ?, stock_minimo = ?, unidad_compra = ?, factor_compra = ? WHERE id = ?',
                [name, category, num(price) || 0, num(costPrice) || 0, d.codigo, d.tipo, d.unidad, d.stockMinimo, d.unidadCompra, d.factorCompra, id]
            );
        } else {
            await connection.query('UPDATE inventario SET nombre = ?, categoria = ?, precio = ?, precio_costo = ? WHERE id = ?',
                [name, category, num(price) || 0, num(costPrice) || 0, id]);
        }
        // Un cambio de stock desde el formulario queda como ajuste en el libro (regla I-05)
        const nuevo = num(req.body.stock);
        const diferencia = nuevo === null ? 0 : nuevo - (Number(actual[0].stock) || 0);
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
    return {
        productId: Number.isInteger(productId) ? productId : null,
        quantity: Math.max(1, Number.parseInt(item.quantity, 10) || 1),
        unitPrice: Math.max(0, toNumber(item.unitPrice)),
        costAtSale: Math.max(0, toNumber(item.costAtSale)),
        description: item.productName ? String(item.productName).substring(0, 255) : null
    };
});

const totalDeItems = (items) => items.reduce((sum, i) => sum + i.quantity * i.unitPrice, 0);

// Descuenta el stock y registra la línea con el costo real del momento (regla I-07)
const insertarDetalle = async (connection, saleId, item, usuarioId) => {
    let costo = 0;
    if (item.productId) {
        const r = await moverStock(connection, { inventarioId: item.productId, cantidad: -item.quantity, tipo: 'venta',
            origenTipo: 'venta', origenId: saleId, usuarioId });
        costo = r ? r.costo : 0;
    }
    if (esquema.integracion) {
        await connection.query(
            'INSERT INTO venta_detalles (venta_id, inventario_id, cantidad, precio_unitario, costo_al_vender, descripcion) VALUES (?, ?, ?, ?, ?, ?)',
            [saleId, item.productId, item.quantity, item.unitPrice, costo, item.productId ? null : item.description]
        );
    } else {
        await connection.query(
            'INSERT INTO venta_detalles (venta_id, inventario_id, cantidad, precio_unitario, costo_al_vender) VALUES (?, ?, ?, ?, ?)',
            [saleId, item.productId, item.quantity, item.unitPrice, costo]
        );
    }
};

// Devuelve al inventario las líneas de una venta (edición o anulación)
const devolverDetalles = async (connection, saleId, motivo, usuarioId) => {
    const [oldItems] = await connection.query('SELECT inventario_id, cantidad FROM venta_detalles WHERE venta_id = ?', [saleId]);
    for (const item of oldItems) {
        if (item.inventario_id) {
            await moverStock(connection, { inventarioId: item.inventario_id, cantidad: Number(item.cantidad), tipo: 'anulacion_venta',
                origenTipo: 'venta', origenId: Number(saleId), motivo, usuarioId });
        }
    }
};

app.get('/api/sales', async (req, res, next) => {
    try {
        const [sales] = await db.query(`
            SELECT v.id, v.total, v.fecha as date, v.estado as status, v.metodo as method,
                   c.id as customerId, c.nombre as customerName, c.telefono as phone,
                   c.cedula as idDocument, c.ciudad as city, c.direccion as address
            FROM ventas v
            LEFT JOIN clientes c ON v.cliente_id = c.id
            ORDER BY v.fecha DESC
        `);
        if (!sales.length) return res.json([]);

        // Dos consultas en total (antes eran 2 por cada venta)
        const [payments] = await db.query(esquema.metodosPago
            ? 'SELECT p.id, p.venta_id as saleId, p.monto as amount, p.fecha as date, COALESCE(m.nombre, p.metodo) as method, COALESCE(m.es_efectivo, 1) as isCash FROM pagos p LEFT JOIN metodos_pago m ON m.id = p.metodo_pago_id ORDER BY p.id ASC'
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
    if (!items.length) return res.status(400).json({ error: 'La venta debe tener al menos un producto' });

    // El total y el estado se calculan en el servidor, no se confía en el cliente
    const total = totalDeItems(items);
    const initialPayment = Math.min(Math.max(0, toNumber(req.body.initialPayment)), total);
    const status = initialPayment >= total ? 'paid' : 'pending';

    let connection;
    try {
        connection = await db.getConnection();
        await connection.beginTransaction();

        let finalCustomerId = customerId || null;
        if (!finalCustomerId && customerName) {
            const [clientResult] = await connection.query(
                'INSERT INTO clientes (nombre, telefono, cedula, ciudad, direccion) VALUES (?, ?, ?, ?, ?)',
                [customerName, phone || null, idDocument || null, city || null, address || null]
            );
            finalCustomerId = clientResult.insertId;
        }

        const [saleResult] = await connection.query(
            'INSERT INTO ventas (total, fecha, cliente_id, estado, metodo) VALUES (?, ?, ?, ?, ?)',
            [total, date, finalCustomerId, status, method]
        );
        const saleId = saleResult.insertId;

        if (initialPayment > 0) {
            await insertarPago(connection, { ventaId: saleId, monto: initialPayment, fecha: date, metodo: method });
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
        connection = await db.getConnection();
        await connection.beginTransaction();

        const [saleRows] = await connection.query('SELECT total FROM ventas WHERE id = ? FOR UPDATE', [id]);
        if (!saleRows.length) {
            await connection.rollback();
            return res.status(404).json({ error: 'Venta no encontrada' });
        }
        const total = toNumber(saleRows[0].total);
        const [paidRows] = await connection.query('SELECT COALESCE(SUM(monto), 0) as totalPaid FROM pagos WHERE venta_id = ?', [id]);
        const saldo = total - toNumber(paidRows[0].totalPaid);

        if (amount - saldo > 0.01) {
            await connection.rollback();
            return res.status(400).json({ error: `El abono supera el saldo pendiente ($${Math.round(saldo).toLocaleString('es-CO')})` });
        }

        await insertarPago(connection, { ventaId: id, monto: amount, fecha: date, metodo: method });
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
    if (!items.length) return res.status(400).json({ error: 'La venta debe tener al menos un producto' });
    const total = totalDeItems(items);

    let connection;
    try {
        connection = await db.getConnection();
        await connection.beginTransaction();

        const [actual] = await connection.query('SELECT estado FROM ventas WHERE id = ? FOR UPDATE', [id]);
        if (!actual.length) {
            await connection.rollback();
            return res.status(404).json({ error: 'Venta no encontrada' });
        }

        let finalCustomerId = customerId || null;
        if (!finalCustomerId && customerName) {
            const [clientResult] = await connection.query(
                'INSERT INTO clientes (nombre, telefono, cedula, ciudad, direccion) VALUES (?, ?, ?, ?, ?)',
                [customerName, phone || null, idDocument || null, city || null, address || null]
            );
            finalCustomerId = clientResult.insertId;
        }

        await devolverDetalles(connection, id, 'Edición de la venta', req.user?.id);
        await connection.query('DELETE FROM venta_detalles WHERE venta_id = ?', [id]);

        // Editar productos o precios no debe cambiar un estado de pago ya real:
        // se recalcula con los abonos registrados. Sin abonos se conserva el estado anterior.
        const [pagos] = await connection.query('SELECT COUNT(*) as n, COALESCE(SUM(monto), 0) as totalPaid FROM pagos WHERE venta_id = ?', [id]);
        const status = Number(pagos[0].n) > 0
            ? (toNumber(pagos[0].totalPaid) >= total - 0.01 ? 'paid' : 'pending')
            : actual[0].estado;

        await connection.query('UPDATE ventas SET total = ?, fecha = ?, cliente_id = ?, estado = ?, metodo = ? WHERE id = ?',
            [total, date, finalCustomerId, status, method, id]);

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
        
        await devolverDetalles(connection, id, 'Venta eliminada', req.user?.id);
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
app.get('/api/purchases', async (req, res, next) => {
    try {
        const [rows] = await db.query(`SELECT co.id, co.inventario_id as productId, co.proveedor_id as supplierId, co.cantidad, co.monto as amount, co.precio_unitario as unitPrice, co.fecha as date, pr.nombre as productName, prve.nombre as supplierName FROM compras co LEFT JOIN inventario pr ON co.inventario_id = pr.id LEFT JOIN proveedores prve ON co.proveedor_id = prve.id ORDER BY co.fecha DESC`);
        res.json(rows || []);
    } catch (error) { next(error); }
});

const datosCompra = (body) => ({
    invId: body.productId ? parseInt(body.productId, 10) : null,
    suppId: body.supplierId ? parseInt(body.supplierId, 10) : null,
    cantidad: Math.max(0, parseFloat(body.quantity) || 0),
    precioUnitario: Math.max(0, parseFloat(body.unitPrice) || 0),
    monto: parseFloat(body.amount || body.total || 0) || 0,
    fecha: body.date
});

// Entrada de una compra: suma stock y recalcula el costo promedio (reglas I-02, I-03)
const entradaCompra = (connection, compraId, c, usuarioId) => moverStock(connection, {
    inventarioId: c.invId, cantidad: c.cantidad, tipo: 'compra', costoUnitario: c.precioUnitario, recalcularCosto: true,
    origenTipo: 'compra', origenId: compraId, usuarioId
});

// Reversa de una compra (edición o eliminación). Si esas unidades ya se vendieron, no se permite.
const reversaCompra = async (connection, compraId, motivo, usuarioId) => {
    const [rows] = await connection.query('SELECT inventario_id, cantidad, precio_unitario FROM compras WHERE id = ?', [compraId]);
    if (rows.length && rows[0].inventario_id) {
        await moverStock(connection, {
            inventarioId: rows[0].inventario_id, cantidad: -Number(rows[0].cantidad), tipo: 'anulacion_compra',
            costoUnitario: Number(rows[0].precio_unitario), recalcularCosto: true, origenTipo: 'compra', origenId: Number(compraId), motivo, usuarioId
        });
    }
    return rows.length > 0;
};

app.post('/api/purchases', async (req, res, next) => {
    const c = datosCompra(req.body);
    if (!c.invId || !c.cantidad) return res.status(400).json({ error: 'Producto y cantidad son obligatorios' });
    let connection;
    try {
        connection = await db.getConnection();
        await connection.beginTransaction();
        const [result] = await connection.query(
            'INSERT INTO compras (inventario_id, proveedor_id, cantidad, monto, precio_unitario, fecha) VALUES (?, ?, ?, ?, ?, ?)',
            [c.invId, c.suppId, c.cantidad, c.monto, c.precioUnitario, c.fecha]
        );
        await entradaCompra(connection, result.insertId, c, req.user?.id);
        await connection.commit();
        res.status(201).json({ id: result.insertId, ...req.body });
    } catch (error) {
        if (connection) await connection.rollback();
        next(error);
    } finally {
        if (connection) connection.release();
    }
});

app.put('/api/purchases/:id', async (req, res, next) => {
    const { id } = req.params;
    const c = datosCompra(req.body);
    if (!c.invId || !c.cantidad) return res.status(400).json({ error: 'Producto y cantidad son obligatorios' });
    let connection;
    try {
        connection = await db.getConnection();
        await connection.beginTransaction();
        if (!(await reversaCompra(connection, id, 'Edición de la compra', req.user?.id))) {
            await connection.rollback();
            return res.status(404).json({ error: 'Compra no encontrada' });
        }
        await connection.query('UPDATE compras SET inventario_id = ?, proveedor_id = ?, cantidad = ?, monto = ?, precio_unitario = ?, fecha = ? WHERE id = ?',
            [c.invId, c.suppId, c.cantidad, c.monto, c.precioUnitario, c.fecha, id]);
        await entradaCompra(connection, Number(id), c, req.user?.id);
        await connection.commit();
        res.json({ id, ...req.body });
    } catch (error) {
        if (connection) await connection.rollback();
        next(error);
    } finally {
        if (connection) connection.release();
    }
});

app.delete('/api/purchases/:id', async (req, res, next) => {
    const { id } = req.params;
    let connection;
    try {
        connection = await db.getConnection();
        await connection.beginTransaction();
        await reversaCompra(connection, id, 'Compra eliminada', req.user?.id);
        await connection.query('DELETE FROM compras WHERE id = ?', [id]);
        await connection.commit();
        res.json({ message: 'Purchase deleted and stock adjusted' });
    } catch (error) {
        if (connection) await connection.rollback();
        next(error);
    } finally {
        if (connection) connection.release();
    }
});

// --- GASTOS (Expenses) ---
app.get('/api/expenses', async (req, res, next) => {
    try {
        const [rows] = await db.query(esquema.categoriasGasto
            ? 'SELECT g.id, g.descripcion as description, g.monto as amount, COALESCE(c.nombre, g.categoria) as category, g.fecha as date FROM gastos g LEFT JOIN categorias_gasto c ON c.id = g.categoria_id ORDER BY g.fecha DESC'
            : 'SELECT id, descripcion as description, monto as amount, categoria as category, fecha as date FROM gastos ORDER BY fecha DESC');
        res.json(rows);
    } catch (error) { next(error); }
});

app.post('/api/expenses', async (req, res, next) => {
    const { description, amount, category, date } = req.body;
    try {
        const categoriaId = await categoriaGastoId(db, category);
        const [result] = esquema.categoriasGasto
            ? await db.query('INSERT INTO gastos (descripcion, monto, categoria, categoria_id, fecha) VALUES (?, ?, ?, ?, ?)', [description, amount, category || 'Otros', categoriaId, date])
            : await db.query('INSERT INTO gastos (descripcion, monto, categoria, fecha) VALUES (?, ?, ?, ?)', [description, amount, category, date]);
        res.status(201).json({ id: result.insertId, ...req.body });
    } catch (error) { next(error); }
});

app.put('/api/expenses/:id', async (req, res, next) => {
    const { id } = req.params;
    const { description, amount, category, date } = req.body;
    try {
        const categoriaId = await categoriaGastoId(db, category);
        if (esquema.categoriasGasto) {
            await db.query('UPDATE gastos SET descripcion = ?, monto = ?, categoria = ?, categoria_id = ?, fecha = ? WHERE id = ?', [description, amount, category || 'Otros', categoriaId, date, id]);
        } else {
            await db.query('UPDATE gastos SET descripcion = ?, monto = ?, categoria = ?, fecha = ? WHERE id = ?', [description, amount, category, date, id]);
        }
        res.json({ id, ...req.body });
    } catch (error) { next(error); }
});

app.delete('/api/expenses/:id', async (req, res, next) => {
    try {
        await db.query('DELETE FROM gastos WHERE id = ?', [req.params.id]);
        res.json({ message: 'Expense deleted' });
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

// --- CIERRES DE CAJA (Cash Closings) ---
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
    console.error('API Error:', err.message);
    res.status(500).json({ error: 'Internal Server Error' });
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});

iniciarServidorIntegracion(db);
