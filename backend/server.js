import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import db from './db.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

// Test DB Connection
try {
    await db.query('SELECT 1');
    console.log('Successfully connected to MySQL database');
} catch (error) {
    console.error('CRITICAL: Could not connect to MySQL. Check if service is running and credentials are correct.');
    console.error(error.message);
    process.exit(1);
}

// --- PROVEEDORES (Suppliers) ---
app.get('/api/suppliers', async (req, res) => {
    try {
        const [rows] = await db.query('SELECT id, nombre as name, telefono as phone, email, direccion as address, fecha_creacion as createdAt FROM proveedores ORDER BY nombre ASC');
        res.json(rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/suppliers', async (req, res) => {
    const { name, phone, email, address } = req.body;
    try {
        const [result] = await db.query(
            'INSERT INTO proveedores (nombre, telefono, email, direccion) VALUES (?, ?, ?, ?)',
            [name, phone, email, address]
        );
        res.status(201).json({ id: result.insertId, ...req.body });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.put('/api/suppliers/:id', async (req, res) => {
    const { id } = req.params;
    const { name, phone, email, address } = req.body;
    try {
        await db.query(
            'UPDATE proveedores SET nombre = ?, telefono = ?, email = ?, direccion = ? WHERE id = ?',
            [name, phone, email, address, id]
        );
        res.json({ id, ...req.body });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.delete('/api/suppliers/:id', async (req, res) => {
    try {
        await db.query('DELETE FROM proveedores WHERE id = ?', [req.params.id]);
        res.json({ message: 'Supplier deleted' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// --- PRODUCTOS (Products) ---
app.get('/api/products', async (req, res) => {
    try {
        const [rows] = await db.query('SELECT id, nombre as name, categoria as category, precio as price, precio_costo as costPrice, stock, fecha_creacion as createdAt FROM productos ORDER BY nombre ASC');
        res.json(rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/products', async (req, res) => {
    const { name, category, price, costPrice, stock } = req.body;
    try {
        const [result] = await db.query(
            'INSERT INTO productos (nombre, categoria, precio, precio_costo, stock) VALUES (?, ?, ?, ?, ?)',
            [name, category, price, costPrice, stock]
        );
        res.status(201).json({ id: result.insertId, ...req.body });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.put('/api/products/:id', async (req, res) => {
    const { id } = req.params;
    const { name, category, price, costPrice, stock } = req.body;
    try {
        await db.query(
            'UPDATE productos SET nombre = ?, categoria = ?, precio = ?, precio_costo = ?, stock = ? WHERE id = ?',
            [name, category, price, costPrice, stock, id]
        );
        res.json({ id, ...req.body });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.delete('/api/products/:id', async (req, res) => {
    try {
        await db.query('DELETE FROM productos WHERE id = ?', [req.params.id]);
        res.json({ message: 'Product deleted' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// --- VENTAS & PAGOS (Sales & Payments) ---
app.get('/api/sales', async (req, res) => {
    try {
        const [rows] = await db.query(`
            SELECT v.id, v.producto_id as productId, v.cantidad as quantity, v.total, v.costo_al_vender as costAtSale, 
                   v.fecha as date, v.nombre_cliente as customerName, v.estado as status, v.metodo as method,
                   p.nombre as productName 
            FROM ventas v
            LEFT JOIN productos p ON v.producto_id = p.id 
            ORDER BY v.fecha DESC
        `);
        
        // Fetch payments for each sale
        const salesWithPayments = await Promise.all(rows.map(async (sale) => {
            const [payments] = await db.query('SELECT id, venta_id as saleId, monto as amount, fecha as date, metodo as method FROM pagos WHERE venta_id = ?', [sale.id]);
            return { ...sale, payments };
        }));
        
        res.json(salesWithPayments);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/sales', async (req, res) => {
    const { productId, quantity, total, costAtSale, date, customerName, status, method, initialPayment } = req.body;
    const connection = await db.getConnection();
    try {
        await connection.beginTransaction();

        // 1. Insert Sale
        const [saleResult] = await connection.query(
            'INSERT INTO ventas (producto_id, cantidad, total, costo_al_vender, fecha, nombre_cliente, estado, metodo) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [productId, quantity, total, costAtSale, date, customerName, status, method]
        );
        const saleId = saleResult.insertId;

        // 2. Insert Initial Payment if exists
        if (initialPayment > 0) {
            await connection.query(
                'INSERT INTO pagos (venta_id, monto, fecha, metodo) VALUES (?, ?, ?, ?)',
                [saleId, initialPayment, date, method]
            );
        }

        // 3. Update Product Stock
        await connection.query(
            'UPDATE productos SET stock = stock - ? WHERE id = ?',
            [quantity, productId]
        );

        await connection.commit();
        res.status(201).json({ id: saleId, ...req.body });
    } catch (error) {
        await connection.rollback();
        res.status(500).json({ error: error.message });
    } finally {
        connection.release();
    }
});

app.post('/api/sales/:id/payments', async (req, res) => {
    const { id } = req.params;
    const { amount, date, method } = req.body;
    const connection = await db.getConnection();
    try {
        await connection.beginTransaction();

        // 1. Insert Payment
        await connection.query(
            'INSERT INTO pagos (venta_id, monto, fecha, metodo) VALUES (?, ?, ?, ?)',
            [id, amount, date, method]
        );

        // 2. Check if Sale is now fully paid
        const [saleRows] = await connection.query('SELECT total FROM ventas WHERE id = ?', [id]);
        const [paymentRows] = await connection.query('SELECT SUM(monto) as totalPaid FROM pagos WHERE venta_id = ?', [id]);
        
        const total = saleRows[0].total;
        const totalPaid = paymentRows[0].totalPaid;

        if (totalPaid >= total) {
            await connection.query('UPDATE ventas SET estado = "paid" WHERE id = ?', [id]);
        }

        await connection.commit();
        res.status(201).json({ message: 'Payment added' });
    } catch (error) {
        await connection.rollback();
        res.status(500).json({ error: error.message });
    } finally {
        connection.release();
    }
});

app.delete('/api/sales/:id', async (req, res) => {
    const { id } = req.params;
    const connection = await db.getConnection();
    try {
        await connection.beginTransaction();

        // Get sale info to revert stock
        const [saleRows] = await connection.query('SELECT producto_id, cantidad FROM ventas WHERE id = ?', [id]);
        if (saleRows.length > 0) {
            const { producto_id, cantidad } = saleRows[0];
            await connection.query('UPDATE productos SET stock = stock + ? WHERE id = ?', [cantidad, producto_id]);
        }

        await connection.query('DELETE FROM ventas WHERE id = ?', [id]);

        await connection.commit();
        res.json({ message: 'Sale deleted and stock reverted' });
    } catch (error) {
        await connection.rollback();
        res.status(500).json({ error: error.message });
    } finally {
        connection.release();
    }
});

// --- COMPRAS (Purchases) ---
app.get('/api/purchases', async (req, res) => {
    try {
        const [rows] = await db.query(`
            SELECT co.id, co.producto_id as productId, co.proveedor_id as supplierId, co.cantidad, 
                   co.monto as amount, co.precio_unitario as unitPrice, co.fecha as date,
                   pr.nombre as productName, prve.nombre as supplierName 
            FROM compras co
            LEFT JOIN productos pr ON co.producto_id = pr.id
            LEFT JOIN proveedores prve ON co.proveedor_id = prve.id
            ORDER BY co.fecha DESC
        `);
        res.json(rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/purchases', async (req, res) => {
    const { productId, supplierId, quantity, amount, unitPrice, date } = req.body;
    const connection = await db.getConnection();
    try {
        await connection.beginTransaction();

        const [result] = await connection.query(
            'INSERT INTO compras (producto_id, proveedor_id, cantidad, monto, precio_unitario, fecha) VALUES (?, ?, ?, ?, ?, ?)',
            [productId, supplierId, quantity, amount, unitPrice, date]
        );

        await connection.query(
            'UPDATE productos SET stock = stock + ? WHERE id = ?',
            [quantity, productId]
        );

        await connection.commit();
        res.status(201).json({ id: result.insertId, ...req.body });
    } catch (error) {
        await connection.rollback();
        res.status(500).json({ error: error.message });
    } finally {
        connection.release();
    }
});

app.delete('/api/purchases/:id', async (req, res) => {
    const { id } = req.params;
    const connection = await db.getConnection();
    try {
        await connection.beginTransaction();

        const [rows] = await connection.query('SELECT producto_id, cantidad FROM compras WHERE id = ?', [id]);
        if (rows.length > 0) {
            const { producto_id, cantidad } = rows[0];
            await connection.query('UPDATE productos SET stock = stock - ? WHERE id = ?', [cantidad, producto_id]);
        }

        await connection.query('DELETE FROM compras WHERE id = ?', [id]);

        await connection.commit();
        res.json({ message: 'Purchase deleted and stock adjusted' });
    } catch (error) {
        await connection.rollback();
        res.status(500).json({ error: error.message });
    } finally {
        connection.release();
    }
});

// --- GASTOS (Expenses) ---
app.get('/api/expenses', async (req, res) => {
    try {
        const [rows] = await db.query('SELECT id, descripcion as description, monto as amount, categoria as category, fecha as date FROM gastos ORDER BY fecha DESC');
        res.json(rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/expenses', async (req, res) => {
    const { description, amount, category, date } = req.body;
    try {
        const [result] = await db.query(
            'INSERT INTO gastos (descripcion, monto, categoria, fecha) VALUES (?, ?, ?, ?)',
            [description, amount, category, date]
        );
        res.status(201).json({ id: result.insertId, ...req.body });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.delete('/api/expenses/:id', async (req, res) => {
    try {
        await db.query('DELETE FROM gastos WHERE id = ?', [req.params.id]);
        res.json({ message: 'Expense deleted' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// --- CIERRES DE CAJA (Cash Closings) ---
app.get('/api/cash-closings', async (req, res) => {
    try {
        const [rows] = await db.query(`
            SELECT id, fecha as date, efectivo_inicial as initialCash, efectivo_final as finalCash, 
                   diferencia as difference, total_ventas as salesTotal, total_compras as purchasesTotal, 
                   total_gastos as expensesTotal, notas as notes, fecha_creacion as createdAt 
            FROM cierres_caja ORDER BY fecha DESC
        `);
        res.json(rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/cash-closings', async (req, res) => {
    const { date, initialCash, finalCash, difference, salesTotal, purchasesTotal, expensesTotal, notes } = req.body;
    try {
        const [result] = await db.query(
            'INSERT INTO cierres_caja (fecha, efectivo_inicial, efectivo_final, diferencia, total_ventas, total_compras, total_gastos, notas) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [date, initialCash, finalCash, difference, salesTotal, purchasesTotal, expensesTotal, notes]
        );
        res.status(201).json({ id: result.insertId, ...req.body });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.delete('/api/cash-closings/:id', async (req, res) => {
    try {
        await db.query('DELETE FROM cierres_caja WHERE id = ?', [req.params.id]);
        res.json({ message: 'Cash closing deleted' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
