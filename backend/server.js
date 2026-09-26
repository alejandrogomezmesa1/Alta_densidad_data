import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import db from './db.js';
import { asegurarEsquemaIntegracion, iniciarServidorIntegracion } from './integration.js';

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

// Test DB Connection
let esquemaIntegracionListo = false;
let marcasCierreListas = false;
try {
    await db.query('SELECT 1');
    console.log('Successfully connected to MySQL database');
    
    // Ensure 'notas' column is large enough to hold all daily movements
    try {
        await db.query('ALTER TABLE cierres_caja MODIFY COLUMN notas MEDIUMTEXT;');
    } catch (e) {
        console.log('Note: Could not alter cierres_caja table (might not exist yet).');
    }

    try {
        const [marcas] = await db.query("SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'cierres_caja' AND COLUMN_NAME = 'ultimo_pago_id'");
        if (!marcas.length) {
            await db.query('ALTER TABLE cierres_caja ADD COLUMN ultimo_pago_id INT NULL, ADD COLUMN ultimo_gasto_id INT NULL, ADD COLUMN ultima_compra_id INT NULL');
        }
        marcasCierreListas = true;
    } catch (e) {
        console.error('No se pudieron preparar las marcas de cierre de caja:', e.message);
    }

    try {
        await asegurarEsquemaIntegracion(db);
        esquemaIntegracionListo = true;
    } catch (e) {
        console.error('[INTEGRACION] No se pudo preparar el esquema:', e.message);
    }
} catch (error) {
    console.error('CRITICAL: Could not connect to MySQL. Application will start but API calls will fail.');
    console.error(error.message);
}

// Utility: Update Stock
const updateStock = async (connection, inventoryId, quantity, operation = 'subtract') => {
    if (!inventoryId) return;
    const operator = operation === 'subtract' ? '-' : '+';
    await connection.query(`UPDATE inventario SET stock = stock ${operator} ? WHERE id = ?`, [quantity, inventoryId]);
};

// Utility: Update Stock and Cost
const updateStockAndCost = async (connection, inventoryId, quantity, purchaseUnitPrice, operation = 'add') => {
    if (!inventoryId) return;
    
    // Fetch current stock and cost
    const [rows] = await connection.query('SELECT stock, precio_costo FROM inventario WHERE id = ?', [inventoryId]);
    if (rows.length === 0) return;
    
    let currentStock = parseInt(rows[0].stock) || 0;
    let currentCost = parseFloat(rows[0].precio_costo) || 0;
    quantity = parseInt(quantity);
    purchaseUnitPrice = parseFloat(purchaseUnitPrice);
    
    let newStock, newCost;
    
    if (operation === 'add') {
        newStock = currentStock + quantity;
        if (newStock > 0) {
            newCost = ((currentStock * currentCost) + (quantity * purchaseUnitPrice)) / newStock;
        } else {
            newCost = purchaseUnitPrice;
        }
    } else if (operation === 'subtract') {
        newStock = currentStock - quantity;
        if (newStock > 0) {
            // Revert weighted average
            let prevTotalCost = (currentStock * currentCost) - (quantity * purchaseUnitPrice);
            newCost = prevTotalCost / newStock;
            if (newCost < 0) newCost = currentCost; // Safety fallback
        } else {
            newCost = currentCost; // Leave cost as is if stock is 0
        }
    }

    await connection.query('UPDATE inventario SET stock = ?, precio_costo = ? WHERE id = ?', [newStock, newCost, inventoryId]);
};

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

// --- PRODUCTOS (Products) ---
app.get('/api/products', async (req, res, next) => {
    try {
        const [rows] = await db.query('SELECT id, nombre as name, categoria as category, precio as price, precio_costo as costPrice, stock, fecha_creacion as createdAt FROM inventario ORDER BY nombre ASC');
        res.json(rows);
    } catch (error) { next(error); }
});

app.post('/api/products', async (req, res, next) => {
    const { name, category, price, costPrice, stock } = req.body;
    try {
        const [result] = await db.query('INSERT INTO inventario (nombre, categoria, precio, precio_costo, stock) VALUES (?, ?, ?, ?, ?)', [name, category, price, costPrice, stock]);
        res.status(201).json({ id: result.insertId, ...req.body });
    } catch (error) { next(error); }
});

app.put('/api/products/:id', async (req, res, next) => {
    const { id } = req.params;
    const { name, category, price, costPrice, stock } = req.body;
    try {
        await db.query(
            'UPDATE inventario SET nombre = ?, categoria = ?, precio = ?, precio_costo = ?, stock = ? WHERE id = ?',
            [name, category, price, costPrice, stock, id]
        );
        res.json({ id, ...req.body });
    } catch (error) { next(error); }
});

app.delete('/api/products/:id', async (req, res, next) => {
    try {
        await db.query('DELETE FROM inventario WHERE id = ?', [req.params.id]);
        res.json({ message: 'Product deleted' });
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

const insertarDetalle = async (connection, saleId, item) => {
    if (esquemaIntegracionListo) {
        await connection.query(
            'INSERT INTO venta_detalles (venta_id, inventario_id, cantidad, precio_unitario, costo_al_vender, descripcion) VALUES (?, ?, ?, ?, ?, ?)',
            [saleId, item.productId, item.quantity, item.unitPrice, item.costAtSale, item.productId ? null : item.description]
        );
    } else {
        await connection.query(
            'INSERT INTO venta_detalles (venta_id, inventario_id, cantidad, precio_unitario, costo_al_vender) VALUES (?, ?, ?, ?, ?)',
            [saleId, item.productId, item.quantity, item.unitPrice, item.costAtSale]
        );
    }
    await updateStock(connection, item.productId, item.quantity, 'subtract');
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
        const [payments] = await db.query('SELECT id, venta_id as saleId, monto as amount, fecha as date, metodo as method FROM pagos ORDER BY id ASC');
        const [items] = await db.query(`SELECT vd.id, vd.venta_id as saleId, vd.inventario_id as productId, vd.cantidad as quantity, vd.precio_unitario as unitPrice, vd.costo_al_vender as costAtSale, ${esquemaIntegracionListo ? 'COALESCE(p.nombre, vd.descripcion)' : 'p.nombre'} as productName FROM venta_detalles vd LEFT JOIN inventario p ON vd.inventario_id = p.id ORDER BY vd.id ASC`);

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
            await connection.query('INSERT INTO pagos (venta_id, monto, fecha, metodo) VALUES (?, ?, ?, ?)', [saleId, initialPayment, date, method]);
        }

        for (const item of items) await insertarDetalle(connection, saleId, item);

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

        await connection.query('INSERT INTO pagos (venta_id, monto, fecha, metodo) VALUES (?, ?, ?, ?)', [id, amount, date, method]);
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

        const [oldItems] = await connection.query('SELECT inventario_id, cantidad FROM venta_detalles WHERE venta_id = ?', [id]);
        for (const item of oldItems) {
            await updateStock(connection, item.inventario_id, item.cantidad, 'add');
        }
        await connection.query('DELETE FROM venta_detalles WHERE venta_id = ?', [id]);

        // Editar productos o precios no debe cambiar un estado de pago ya real:
        // se recalcula con los abonos registrados. Sin abonos se conserva el estado anterior.
        const [pagos] = await connection.query('SELECT COUNT(*) as n, COALESCE(SUM(monto), 0) as totalPaid FROM pagos WHERE venta_id = ?', [id]);
        const status = Number(pagos[0].n) > 0
            ? (toNumber(pagos[0].totalPaid) >= total - 0.01 ? 'paid' : 'pending')
            : actual[0].estado;

        await connection.query('UPDATE ventas SET total = ?, fecha = ?, cliente_id = ?, estado = ?, metodo = ? WHERE id = ?',
            [total, date, finalCustomerId, status, method, id]);

        for (const item of items) await insertarDetalle(connection, id, item);

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
        
        const [oldItems] = await connection.query('SELECT inventario_id, cantidad FROM venta_detalles WHERE venta_id = ?', [id]);
        for (const item of oldItems) {
            await updateStock(connection, item.inventario_id, item.cantidad, 'add');
        }
        
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

app.post('/api/purchases', async (req, res, next) => {
    const { productId, supplierId, quantity, amount, total, unitPrice, date } = req.body;
    const finalAmount = parseFloat(amount || total || 0);
    const finalQty = parseInt(quantity || 0);
    const finalUnitPrice = parseFloat(unitPrice || 0);
    let connection;
    try {
        connection = await db.getConnection();
        await connection.beginTransaction();
        const invId = (productId && productId !== '') ? parseInt(productId) : null;
        const suppId = (supplierId && supplierId !== '') ? parseInt(supplierId) : null;
        
        const [result] = await connection.query(
            'INSERT INTO compras (inventario_id, proveedor_id, cantidad, monto, precio_unitario, fecha) VALUES (?, ?, ?, ?, ?, ?)',
            [invId, suppId, finalQty, finalAmount, finalUnitPrice, date]
        );
        
        await updateStockAndCost(connection, invId, finalQty, finalUnitPrice, 'add');
        
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
    const { productId, supplierId, quantity, amount, total, unitPrice, date } = req.body;
    const finalAmount = parseFloat(amount || total || 0);
    const finalQty = parseInt(quantity || 0);
    const finalUnitPrice = parseFloat(unitPrice || 0);
    let connection;
    try {
        connection = await db.getConnection();
        await connection.beginTransaction();
        
        const [rows] = await connection.query('SELECT inventario_id, cantidad, precio_unitario FROM compras WHERE id = ?', [id]);
        if (rows.length > 0) {
            await updateStockAndCost(connection, rows[0].inventario_id, rows[0].cantidad, rows[0].precio_unitario, 'subtract');
        }
        
        const invId = (productId && productId !== '') ? parseInt(productId) : null;
        const suppId = (supplierId && supplierId !== '') ? parseInt(supplierId) : null;
        
        await connection.query('UPDATE compras SET inventario_id = ?, proveedor_id = ?, cantidad = ?, monto = ?, precio_unitario = ?, fecha = ? WHERE id = ?', [invId, suppId, finalQty, finalAmount, finalUnitPrice, date, id]);
        
        await updateStockAndCost(connection, invId, finalQty, finalUnitPrice, 'add');
        
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
        
        const [rows] = await connection.query('SELECT inventario_id, cantidad, precio_unitario FROM compras WHERE id = ?', [id]);
        if (rows.length > 0) {
            await updateStockAndCost(connection, rows[0].inventario_id, rows[0].cantidad, rows[0].precio_unitario, 'subtract');
        }
        
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
        const [rows] = await db.query('SELECT id, descripcion as description, monto as amount, categoria as category, fecha as date FROM gastos ORDER BY fecha DESC');
        res.json(rows);
    } catch (error) { next(error); }
});

app.post('/api/expenses', async (req, res, next) => {
    const { description, amount, category, date } = req.body;
    try {
        const [result] = await db.query(
            'INSERT INTO gastos (descripcion, monto, categoria, fecha) VALUES (?, ?, ?, ?)',
            [description, amount, category, date]
        );
        res.status(201).json({ id: result.insertId, ...req.body });
    } catch (error) { next(error); }
});

app.put('/api/expenses/:id', async (req, res, next) => {
    const { id } = req.params;
    const { description, amount, category, date } = req.body;
    try {
        await db.query(
            'UPDATE gastos SET descripcion = ?, monto = ?, categoria = ?, fecha = ? WHERE id = ?',
            [description, amount, category, date, id]
        );
        res.json({ id, ...req.body });
    } catch (error) { next(error); }
});

app.delete('/api/expenses/:id', async (req, res, next) => {
    try {
        await db.query('DELETE FROM gastos WHERE id = ?', [req.params.id]);
        res.json({ message: 'Expense deleted' });
    } catch (error) { next(error); }
});

// --- CIERRES DE CAJA (Cash Closings) ---
app.get('/api/cash-closings', async (req, res, next) => {
    try {
        const [rows] = await db.query(`
            SELECT id, fecha as date, efectivo_inicial as initialCash, efectivo_final as finalCash,
                   diferencia as difference, total_ventas as salesTotal, total_compras as purchasesTotal,
                   total_gastos as expensesTotal, ganancia as profit, notas as notes, fecha_creacion as createdAt
                   ${marcasCierreListas ? ', ultimo_pago_id as lastPaymentId, ultimo_gasto_id as lastExpenseId, ultima_compra_id as lastPurchaseId' : ''}
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
        if (marcasCierreListas) {
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
    console.error('API Error:', err.message);
    res.status(500).json({ error: 'Internal Server Error' });
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});

iniciarServidorIntegracion(db);
