import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import db from './db.js';
import initializeDatabase from './init-db.js';

dotenv.config();

// Ensure the Node backend always operates in Medellin Time
process.env.TZ = 'America/Bogota';

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

// Test DB Connection
try {
    await db.query('SELECT 1');
    console.log('Successfully connected to MySQL database');
} catch (error) {
    console.error('CRITICAL: Could not connect to MySQL. Application will start but API calls will fail.');
    console.error(error.message);
    // Removed process.exit(1) so it doesn't crash immediately, allowing frontend Demo Mode to work
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

// --- VENTAS & PAGOS (Sales & Payments) ---
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
        
        const salesWithDetails = await Promise.all((sales || []).map(async (sale) => {
            try {
                const [payments] = await db.query('SELECT id, venta_id as saleId, monto as amount, fecha as date, metodo as method FROM pagos WHERE venta_id = ?', [sale.id]);
                const [items] = await db.query('SELECT vd.id, vd.inventario_id as productId, vd.cantidad as quantity, vd.precio_unitario as unitPrice, vd.costo_al_vender as costAtSale, p.nombre as productName FROM venta_detalles vd LEFT JOIN inventario p ON vd.inventario_id = p.id WHERE vd.venta_id = ?', [sale.id]);
                return { ...sale, payments, items };
            } catch (e) { return { ...sale, payments: [], items: [] }; }
        }));
        res.json(salesWithDetails);
    } catch (error) { next(error); }
});

app.post('/api/sales', async (req, res, next) => {
    const { items, total, date, customerId, customerName, phone, idDocument, city, address, status, method, initialPayment } = req.body;
    let connection;
    try {
        connection = await db.getConnection();
        await connection.beginTransaction();

        let finalCustomerId = customerId;
        if (!finalCustomerId && customerName) {
            const [clientResult] = await connection.query(
                'INSERT INTO clientes (nombre, telefono, cedula, ciudad, direccion) VALUES (?, ?, ?, ?, ?)',
                [customerName, phone || null, idDocument || null, city || null, address || null]
            );
            finalCustomerId = clientResult.insertId;
        }

        const [saleResult] = await connection.query(
            'INSERT INTO ventas (total, fecha, cliente_id, estado, metodo) VALUES (?, ?, ?, ?, ?)',
            [total, date, finalCustomerId || null, status, method]
        );
        const saleId = saleResult.insertId;
        
        if (initialPayment > 0) {
            await connection.query('INSERT INTO pagos (venta_id, monto, fecha, metodo) VALUES (?, ?, ?, ?)', [saleId, initialPayment, date, method]);
        }
        
        if (items && items.length > 0) {
            for (const item of items) {
                const targetId = (item.productId && item.productId !== '') ? parseInt(item.productId) : null;
                const qty = parseInt(item.quantity) || 1;
                const price = parseFloat(item.unitPrice) || 0;
                const cost = parseFloat(item.costAtSale) || 0;
                
                await connection.query(
                    'INSERT INTO venta_detalles (venta_id, inventario_id, cantidad, precio_unitario, costo_al_vender) VALUES (?, ?, ?, ?, ?)',
                    [saleId, targetId, qty, price, cost]
                );
                await updateStock(connection, targetId, qty, 'subtract');
            }
        }
        
        await connection.commit();
        res.status(201).json({ id: saleId, ...req.body });
    } catch (error) {
        if (connection) await connection.rollback();
        next(error);
    } finally {
        if (connection) connection.release();
    }
});

app.post('/api/sales/:id/payments', async (req, res, next) => {
    const { id } = req.params;
    const { amount, date, method } = req.body;
    let connection;
    try {
        connection = await db.getConnection();
        await connection.beginTransaction();

        await connection.query(
            'INSERT INTO pagos (venta_id, monto, fecha, metodo) VALUES (?, ?, ?, ?)',
            [id, amount, date, method]
        );

        const [saleRows] = await connection.query('SELECT total FROM ventas WHERE id = ?', [id]);
        const [paymentRows] = await connection.query('SELECT SUM(monto) as totalPaid FROM pagos WHERE venta_id = ?', [id]);
        
        if (paymentRows[0].totalPaid >= saleRows[0].total) {
            await connection.query('UPDATE ventas SET estado = "paid" WHERE id = ?', [id]);
        }

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
    const { items, total, date, customerId, customerName, phone, idDocument, city, address, status, method } = req.body;
    let connection;
    try {
        connection = await db.getConnection();
        await connection.beginTransaction();
        
        let finalCustomerId = customerId;
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
        
        await connection.query('UPDATE ventas SET total = ?, fecha = ?, cliente_id = ?, estado = ?, metodo = ? WHERE id = ?', 
            [total, date, finalCustomerId || null, status, method, id]);
        
        if (items && items.length > 0) {
            for (const item of items) {
                const targetId = (item.productId && item.productId !== '') ? parseInt(item.productId) : null;
                const qty = parseInt(item.quantity) || 1;
                const price = parseFloat(item.unitPrice) || 0;
                const cost = parseFloat(item.costAtSale) || 0;
                
                await connection.query(
                    'INSERT INTO venta_detalles (venta_id, inventario_id, cantidad, precio_unitario, costo_al_vender) VALUES (?, ?, ?, ?, ?)',
                    [id, targetId, qty, price, cost]
                );
                await updateStock(connection, targetId, qty, 'subtract');
            }
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
            FROM cierres_caja ORDER BY fecha DESC
        `);
        res.json(rows);
    } catch (error) { next(error); }
});

app.post('/api/cash-closings', async (req, res, next) => {
    const { date, initialCash, finalCash, difference, salesTotal, purchasesTotal, expensesTotal, profit, notes } = req.body;
    try {
        const [result] = await db.query(
            'INSERT INTO cierres_caja (fecha, efectivo_inicial, efectivo_final, diferencia, total_ventas, total_compras, total_gastos, ganancia, notas) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [date, initialCash, finalCash, difference, salesTotal, purchasesTotal, expensesTotal, profit, notes]
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
    res.status(500).json({ error: 'Internal Server Error', details: err.message });
});

// Initialize schema, then start listening
await initializeDatabase(db);

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
