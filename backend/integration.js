// ============================================================
// Integración privada con la tienda web (AltaDensidadPAGE)
// ------------------------------------------------------------
// Corre en un puerto propio (INTEGRATION_PORT) que NO se publica en Railway:
// solo es alcanzable por la red privada (<servicio>.railway.internal).
// Además cada petición debe venir firmada con HMAC-SHA256 (INTEGRATION_SECRET),
// con timestamp y nonce para impedir reenvíos. Cualquier petición que no cumpla
// recibe un 404 genérico: el servicio no revela que existe.
// ============================================================
import express from 'express';
import crypto from 'crypto';
import { esquema } from './estado.js';
import { moverStock } from './inventario.js';
import { insertarPago } from './catalogos.js';

const MAX_SKEW_MS = 60 * 1000;
const NONCE_TTL_MS = 2 * MAX_SKEW_MS;
const nonces = new Map();

const notFound = (res) => res.status(404).json({ error: 'Not found' });

const sha256Hex = (buf) => crypto.createHash('sha256').update(buf || '').digest('hex');

// Fecha local de Medellín en el formato que usa el resto del sistema (DATETIME)
const fechaLocal = () => {
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

const verificarFirma = (secret) => (req, res, next) => {
    const ts = Number(req.get('x-ad-timestamp'));
    const nonce = req.get('x-ad-nonce') || '';
    const signature = req.get('x-ad-signature') || '';

    if (!ts || Math.abs(Date.now() - ts) > MAX_SKEW_MS) return notFound(res);
    if (!/^[a-f0-9]{32}$/.test(nonce) || nonces.has(nonce)) return notFound(res);
    if (!/^[a-f0-9]{64}$/.test(signature)) return notFound(res);

    const canonical = [ts, nonce, req.method, req.originalUrl, sha256Hex(req.rawBody)].join('\n');
    const expected = crypto.createHmac('sha256', secret).update(canonical).digest();
    const received = Buffer.from(signature, 'hex');
    if (!crypto.timingSafeEqual(expected, received)) return notFound(res);

    nonces.set(nonce, Date.now() + NONCE_TTL_MS);
    next();
};

// Limpieza periódica de nonces vencidos
setInterval(() => {
    const now = Date.now();
    for (const [n, exp] of nonces) if (exp < now) nonces.delete(n);
}, NONCE_TTL_MS).unref();

const texto = (v, max) => (v == null || v === '' ? null : String(v).trim().substring(0, max));

const crearRouter = (db) => {
    const router = express.Router();

    router.get('/v1/health', async (req, res, next) => {
        try {
            await db.query('SELECT 1');
            res.json({ ok: true });
        } catch (error) { next(error); }
    });

    // Inventario público para la web: sin costos ni datos internos
    router.get('/v1/inventory', async (req, res, next) => {
        try {
            const [rows] = await db.query(esquema.inventarioTipos
                ? 'SELECT id, nombre AS name, categoria, precio AS price, precio_costo AS cost, stock, tipo, unidad FROM inventario WHERE activo = 1'
                : 'SELECT id, nombre AS name, categoria, precio AS price, precio_costo AS cost, stock FROM inventario');
            // El costo no sale de DATA: solo se avisa si el precio no lo cubre (la web bloquea la venta).
            // tipo y unidad le dicen a la web qué es cada ítem (esencia, feromona, envase…) y si se vende por ml.
            res.json(rows.map(r => {
                const price = Number(r.price) || 0;
                const cost = Number(r.cost) || 0;
                return {
                    id: r.id, name: r.name, category: r.categoria || null, price, stock: Number(r.stock) || 0,
                    type: r.tipo || 'terminado', unit: r.unidad || 'und', priceReview: cost > 0 && price <= cost
                };
            }));
        } catch (error) { next(error); }
    });

    // Verificación en vivo antes de cobrar: { items: [{ inventoryId, quantity }] }
    router.post('/v1/inventory/check', async (req, res, next) => {
        try {
            const pedidos = new Map();
            for (const it of Array.isArray(req.body?.items) ? req.body.items : []) {
                const id = parseInt(it.inventoryId, 10);
                const qty = parseInt(it.quantity, 10);
                if (!id || !qty || qty < 1) continue;
                pedidos.set(id, (pedidos.get(id) || 0) + qty);
            }
            if (pedidos.size === 0) return res.json({ ok: true, faltantes: [] });

            const [rows] = await db.query('SELECT id, stock FROM inventario WHERE id IN (?)', [[...pedidos.keys()]]);
            const stock = new Map(rows.map(r => [r.id, Number(r.stock) || 0]));
            const faltantes = [...pedidos].filter(([id, qty]) => (stock.get(id) ?? 0) < qty)
                .map(([id, qty]) => ({ inventoryId: id, requested: qty, available: Math.max(0, stock.get(id) ?? 0) }));
            res.json({ ok: faltantes.length === 0, faltantes });
        } catch (error) { next(error); }
    });

    // Registrar venta aprobada de la web. Idempotente por externalReference.
    router.post('/v1/sales', async (req, res, next) => {
        const { externalReference, customer = {}, items, method } = req.body || {};
        const ref = texto(externalReference, 100);
        if (!ref || !Array.isArray(items) || items.length === 0) {
            return res.status(400).json({ error: 'externalReference e items son requeridos' });
        }

        let connection;
        try {
            const [existente] = await db.query('SELECT id FROM ventas WHERE referencia_externa = ?', [ref]);
            if (existente.length) return res.json({ saleId: existente[0].id, duplicated: true });

            connection = await db.getConnection();
            await connection.beginTransaction();

            let clienteId = null;
            const nombre = texto(customer.name, 255);
            const cedula = texto(customer.document, 50);
            if (cedula) {
                const [c] = await connection.query('SELECT id FROM clientes WHERE cedula = ? LIMIT 1', [cedula]);
                if (c.length) {
                    clienteId = c[0].id;
                    // Solo completa datos faltantes: no pisa lo registrado en el punto de venta
                    await connection.query(
                        'UPDATE clientes SET telefono = COALESCE(telefono, ?), ciudad = COALESCE(ciudad, ?), direccion = COALESCE(direccion, ?) WHERE id = ?',
                        [texto(customer.phone, 50), texto(customer.city, 100), texto(customer.address, 255), clienteId]
                    );
                }
            }
            if (!clienteId && nombre) {
                const [nuevo] = await connection.query(
                    'INSERT INTO clientes (nombre, telefono, cedula, ciudad, direccion) VALUES (?, ?, ?, ?, ?)',
                    [nombre, texto(customer.phone, 50), cedula, texto(customer.city, 100), texto(customer.address, 255)]
                );
                clienteId = nuevo.insertId;
            }

            const lineas = items.map(it => ({
                inventoryId: parseInt(it.inventoryId, 10) || null,
                quantity: Math.max(1, parseInt(it.quantity, 10) || 1),
                unitPrice: Math.max(0, parseFloat(it.unitPrice) || 0),
                description: texto(it.description, 255)
            }));
            const total = lineas.reduce((s, l) => s + l.quantity * l.unitPrice, 0);
            const fecha = fechaLocal();
            const metodo = texto(method, 50) || 'Mercado Pago (Web)';

            let ventaId;
            try {
                const [venta] = await connection.query(
                    "INSERT INTO ventas (total, fecha, cliente_id, estado, metodo, origen, referencia_externa) VALUES (?, ?, ?, 'paid', ?, 'web', ?)",
                    [total, fecha, clienteId, metodo, ref]
                );
                ventaId = venta.insertId;
            } catch (e) {
                // Otra notificación simultánea ya la registró
                if (e.code === 'ER_DUP_ENTRY') {
                    await connection.rollback();
                    const [dup] = await db.query('SELECT id FROM ventas WHERE referencia_externa = ?', [ref]);
                    return res.json({ saleId: dup[0]?.id, duplicated: true });
                }
                throw e;
            }

            await insertarPago(connection, { ventaId, monto: total, fecha, metodo });

            const sinStock = [];
            for (const l of lineas) {
                let costo = 0;
                let inventarioId = null;
                if (l.inventoryId) {
                    const [inv] = await connection.query('SELECT id FROM inventario WHERE id = ?', [l.inventoryId]);
                    if (inv.length) {
                        inventarioId = inv[0].id;
                        // El cliente ya pagó: se registra aunque falte stock, con alerta (regla D-07)
                        const r = await moverStock(connection, { inventarioId, cantidad: -l.quantity, tipo: 'venta', origenTipo: 'venta', origenId: ventaId,
                            motivo: `Pedido web ${ref}`, permitirNegativo: true });
                        costo = r.costo;
                        if (r.stock < 0) sinStock.push(inventarioId);
                    }
                }
                await connection.query(
                    'INSERT INTO venta_detalles (venta_id, inventario_id, cantidad, precio_unitario, costo_al_vender, descripcion) VALUES (?, ?, ?, ?, ?, ?)',
                    [ventaId, inventarioId, l.quantity, l.unitPrice, costo, l.description]
                );
            }

            await connection.commit();
            if (sinStock.length) console.warn(`[INTEGRACION] Venta web ${ref} dejó stock negativo en inventario: ${sinStock.join(', ')}`);
            res.status(201).json({ saleId: ventaId, stockInsuficiente: sinStock });
        } catch (error) {
            if (connection) await connection.rollback().catch(() => {});
            next(error);
        } finally {
            if (connection) connection.release();
        }
    });

    // Anular venta web (reembolso / cancelación): elimina la venta y devuelve el stock
    router.post('/v1/sales/:ref/cancel', async (req, res, next) => {
        const ref = texto(req.params.ref, 100);
        let connection;
        try {
            connection = await db.getConnection();
            await connection.beginTransaction();
            const [ventas] = await connection.query("SELECT id FROM ventas WHERE referencia_externa = ? AND origen = 'web' FOR UPDATE", [ref]);
            if (!ventas.length) {
                await connection.rollback();
                return res.json({ cancelled: false, notFound: true });
            }
            const ventaId = ventas[0].id;
            const [detalles] = await connection.query('SELECT inventario_id, cantidad FROM venta_detalles WHERE venta_id = ?', [ventaId]);
            for (const d of detalles) {
                if (d.inventario_id) {
                    await moverStock(connection, { inventarioId: d.inventario_id, cantidad: Number(d.cantidad), tipo: 'anulacion_venta',
                        origenTipo: 'venta', origenId: ventaId, motivo: `Reembolso del pedido web ${ref}` });
                }
            }
            await connection.query('DELETE FROM venta_detalles WHERE venta_id = ?', [ventaId]);
            await connection.query('DELETE FROM pagos WHERE venta_id = ?', [ventaId]);
            await connection.query('DELETE FROM ventas WHERE id = ?', [ventaId]);
            await connection.commit();
            res.json({ cancelled: true, saleId: ventaId });
        } catch (error) {
            if (connection) await connection.rollback().catch(() => {});
            next(error);
        } finally {
            if (connection) connection.release();
        }
    });

    return router;
};

export const iniciarServidorIntegracion = (db) => {
    const secret = process.env.INTEGRATION_SECRET;
    if (!secret || secret.length < 32) {
        console.warn('[INTEGRACION] INTEGRATION_SECRET ausente o corto (<32 caracteres): servidor de integración deshabilitado.');
        return null;
    }
    const port = parseInt(process.env.INTEGRATION_PORT || '7070', 10);
    if (String(port) === String(process.env.PORT)) {
        console.error('[INTEGRACION] INTEGRATION_PORT no puede ser igual a PORT (quedaría expuesto públicamente). Deshabilitado.');
        return null;
    }

    const app = express();
    app.disable('x-powered-by');
    app.use(express.json({ limit: '50kb', verify: (req, res, buf) => { req.rawBody = buf; } }));
    app.use(verificarFirma(secret));
    app.use('/internal', crearRouter(db));
    app.use((req, res) => notFound(res));
    app.use((err, req, res, next) => {
        console.error('[INTEGRACION] Error:', err.message);
        res.status(500).json({ error: 'Internal error' });
    });

    // '::' escucha en IPv6 e IPv4: la red privada de Railway usa IPv6
    return app.listen(port, '::', () => console.log(`[INTEGRACION] Servidor privado escuchando en puerto ${port}`));
};
