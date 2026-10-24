// ============================================================
// Pruebas de flujos de DATA (regresión)
// ------------------------------------------------------------
// Recorre de punta a punta los flujos del negocio contra un backend corriendo sobre una COPIA local
// de la base: consultar existencias, ingresar inventario (crear, comprar, ajustar), vender (contado,
// crédito, kits, ml, edición, anulación), ventas web, gastos, caja por sesiones (libro de dinero,
// arqueo, anulaciones) e integridad referencial.
// Después de cada bloque verifica que el libro de inventario cuadre con el stock.
//
//   1. Cargar un respaldo en un MySQL local, en una base cuyo nombre termine en _test.
//   2. Arrancar el backend contra esa base (PORT, INTEGRATION_PORT e INTEGRATION_SECRET de prueba).
//   3. node backend/tests/flujos.mjs   (variables: ver CONFIG)
//
// Deja datos de prueba en la base: úsala solo para esto y recárgala del respaldo al terminar.
// Lo que todavía no resuelve el sistema queda como PENDIENTE (no cuenta como falla).
// ============================================================
import crypto from 'crypto';
import mysql from 'mysql2/promise';

const CONFIG = {
    api: process.env.FLUJOS_API || 'http://localhost:5099/api',
    integracion: process.env.FLUJOS_INTEGRACION || 'http://localhost:7099',
    secreto: process.env.INTEGRATION_SECRET || '0123456789abcdef0123456789abcdef0123',
    usuario: process.env.FLUJOS_USUARIO || 'prueba',
    clave: process.env.FLUJOS_CLAVE || 'prueba123',
    db: {
        host: process.env.FLUJOS_DB_HOST || '127.0.0.1', port: Number(process.env.FLUJOS_DB_PORT || 3399),
        user: process.env.FLUJOS_DB_USER || 'root', password: process.env.FLUJOS_DB_PASS || '',
        database: process.env.FLUJOS_DB_NAME || 'data_test', dateStrings: true
    }
};
// Nunca contra producción
if (!/_test$/.test(CONFIG.db.database) || !['127.0.0.1', 'localhost'].includes(CONFIG.db.host)) {
    console.error('Las pruebas solo corren contra una base local cuyo nombre termine en _test.');
    process.exit(2);
}

const db = await mysql.createConnection(CONFIG.db);
const resultados = [];
let token;
const reg = (grupo, nombre, ok, detalle = '') => {
    resultados.push({ grupo, nombre, ok, detalle });
    const marca = ok === true ? 'OK       ' : ok === false ? 'FALLA    ' : 'PENDIENTE';
    console.log(`${marca} [${grupo}] ${nombre}${detalle ? ' — ' + detalle : ''}`);
};

async function call(method, path, body) {
    const r = await fetch(CONFIG.api + path, {
        method, body: body ? JSON.stringify(body) : undefined,
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }
    });
    const t = await r.text();
    let j; try { j = JSON.parse(t); } catch { j = t; }
    return { status: r.status, body: j };
}
async function integ(method, path, body) {
    const raw = body ? Buffer.from(JSON.stringify(body)) : Buffer.alloc(0);
    const ts = Date.now();
    const nonce = crypto.randomBytes(16).toString('hex');
    const canon = [ts, nonce, method, path, crypto.createHash('sha256').update(raw).digest('hex')].join('\n');
    const sig = crypto.createHmac('sha256', CONFIG.secreto).update(canon).digest('hex');
    const r = await fetch(CONFIG.integracion + path, {
        method, body: body ? raw : undefined,
        headers: { 'Content-Type': 'application/json', 'x-ad-timestamp': ts, 'x-ad-nonce': nonce, 'x-ad-signature': sig }
    });
    return { status: r.status, body: await r.json().catch(() => null) };
}
const q = async (sql, p) => (await db.query(sql, p))[0];
const uno = async (sql, p) => (await q(sql, p))[0];
const stock = async (id) => Number((await uno('SELECT stock FROM inventario WHERE id=?', [id])).stock);
const costo = async (id) => Number((await uno('SELECT precio_costo FROM inventario WHERE id=?', [id])).precio_costo);
const auditoria = async () => (await call('GET', '/inventory/audit')).body.diferencias || [];
const libroCuadra = async (grupo, paso) => {
    const d = await auditoria();
    reg(grupo, `libro de inventario cuadra tras ${paso}`, d.length === 0, d.length ? JSON.stringify(d.slice(0, 3)) : '');
};
const hoy = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });
const ayer = new Date(Date.now() - 86400000).toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });
const venta = (items, extra = {}) => call('POST', '/sales', { date: hoy, method: 'Efectivo', customerName: 'Cliente Prueba', initialPayment: 0, ...extra, items });

// Ítems de la copia: un kit compuesto, una esencia con stock, un perfume y un envase
const kit = await uno('SELECT kit_id AS id FROM kit_componentes GROUP BY kit_id HAVING COUNT(*) > 1 ORDER BY kit_id LIMIT 1');
const esencia = await uno("SELECT id FROM inventario WHERE activo=1 AND tipo='esencia' AND stock >= 100 ORDER BY id LIMIT 1");
const perfume = await uno("SELECT id, precio FROM inventario WHERE activo=1 AND tipo='terminado' AND stock >= 3 AND id NOT IN (SELECT kit_id FROM kit_componentes) AND id NOT IN (SELECT componente_id FROM kit_componentes) ORDER BY id LIMIT 1");

// ---------- 0. Sesión ----------
{
    const G = 'Sesión';
    reg(G, 'la API sin token responde 401', (await call('GET', '/products')).status === 401);
    reg(G, 'login con clave errada rechazado', (await call('POST', '/auth/login', { username: CONFIG.usuario, password: 'x' })).status === 401);
    token = (await call('POST', '/auth/login', { username: CONFIG.usuario, password: CONFIG.clave })).body.token;
    reg(G, 'login correcto entrega token', !!token);
    if (!token) process.exit(1);
    await libroCuadra(G, 'cargar la copia');
}

// ---------- 1. Consultar existencias ----------
{
    const G = 'Consulta';
    const r = await call('GET', '/products');
    reg(G, `lista de ítems activos (${r.body.length})`, r.status === 200 && r.body.length > 0);
    if (kit) {
        const k = r.body.find((p) => p.id === kit.id);
        const comps = await q('SELECT kc.cantidad, i.stock FROM kit_componentes kc JOIN inventario i ON i.id=kc.componente_id WHERE kit_id=?', [kit.id]);
        const esperado = Math.min(...comps.map((c) => Math.floor(Number(c.stock) / Number(c.cantidad))));
        reg(G, 'existencias de un kit = lo que alcanzan sus componentes', k?.stock === esperado, `kit ${kit.id}: ${k?.stock} (esperado ${esperado})`);
    }
    const f = await call('GET', '/products?type=esencia');
    reg(G, 'filtro por tipo', f.body.every((p) => p.type === 'esencia'));
    reg(G, 'kárdex de un ítem', Array.isArray((await call('GET', `/products/${perfume.id}/movements`)).body));
    reg(G, 'consulta liviana de existencias sin cargar ventas, compras y clientes', null, 'fase C: el panel trae todo para consultar stock');
}

// ---------- 2. Ingreso al inventario ----------
let pid;
{
    const G = 'Ingreso';
    const crear = await call('POST', '/products', { name: 'PRUEBA Perfume', category: 'Prueba', price: 50000, costPrice: 20000, stock: 5, type: 'terminado' });
    pid = crear.body.id;
    reg(G, 'crear ítem con stock inicial deja movimiento «inicial»', crear.status === 201 && (await stock(pid)) === 5
        && Number((await uno("SELECT COUNT(*) n FROM movimientos_inventario WHERE inventario_id=? AND tipo='inicial'", [pid])).n) === 1);

    const c1 = await call('POST', '/purchases', { productId: pid, quantity: 5, unitPrice: 30000, amount: 150000, date: hoy });
    reg(G, 'compra suma stock', c1.status === 201 && (await stock(pid)) === 10);
    reg(G, 'compra recalcula el costo promedio (25.000)', (await costo(pid)) === 25000, `costo ${await costo(pid)}`);
    const fc = (await uno('SELECT fecha FROM compras WHERE id=?', [c1.body.id])).fecha;
    reg(G, 'compra de hoy guarda la hora real', !fc.endsWith('00:00:00'), fc);

    const c2 = await call('POST', '/purchases', { productId: pid, quantity: 2, unitPrice: 30000, amount: 999, date: hoy });
    reg(G, 'el monto de la compra es cantidad × precio (ignora el que llegue)', Number((await uno('SELECT monto FROM compras WHERE id=?', [c2.body.id])).monto) === 60000);

    const e0 = await stock(esencia.id);
    const c3 = await call('POST', '/purchases', { productId: esencia.id, quantity: 250.5, unitPrice: 230, date: hoy });
    reg(G, 'compra de esencia con decimales (250,5 ml)', c3.status === 201 && Number((await uno('SELECT cantidad FROM compras WHERE id=?', [c3.body.id])).cantidad) === 250.5
        && (await stock(esencia.id)) === e0 + 250.5);
    await call('DELETE', `/purchases/${c3.body.id}`);
    reg(G, 'eliminar esa compra devuelve exactamente lo que entró', (await stock(esencia.id)) === e0, `${e0} → ${await stock(esencia.id)}`);

    const fr = await call('POST', '/purchases', { productId: pid, quantity: 1.5, unitPrice: 30000, date: hoy });
    reg(G, 'compra de 1,5 unidades de algo que se cuenta por unidad rechazada', fr.status === 400, fr.body.error);

    const s1 = await stock(pid); const sp = await stock(perfume.id);
    await call('PUT', `/purchases/${c2.body.id}`, { productId: perfume.id, quantity: 2, unitPrice: 31500, date: hoy });
    reg(G, 'editar compra cambiando de producto mueve ambos stocks', (await stock(pid)) === s1 - 2 && (await stock(perfume.id)) === sp + 2);
    await call('DELETE', `/purchases/${c2.body.id}`);

    reg(G, 'compra con precio 0 rechazada', (await call('POST', '/purchases', { productId: pid, quantity: 1, unitPrice: 0, date: hoy })).status === 400);
    const sf = await call('POST', '/purchases', { productId: pid, quantity: 1, unitPrice: 30000 });
    reg(G, 'compra sin fecha rechazada con mensaje claro', sf.status === 400, sf.body.error);
    const fut = await call('POST', '/purchases', { productId: pid, quantity: 1, unitPrice: 30000, date: '2099-01-01' });
    reg(G, 'compra con fecha futura rechazada', fut.status === 400, fut.body.error);
    reg(G, 'una factura de proveedor con varios productos', null, 'fase D: cada producto es una compra aparte');

    reg(G, 'ajuste sin motivo rechazado', (await call('POST', `/products/${pid}/adjustments`, { newStock: 3 })).status === 400);
    const aj = await call('POST', `/products/${pid}/adjustments`, { newStock: 7, reason: 'Conteo físico' });
    reg(G, 'ajuste por conteo deja el stock contado', aj.status === 201 && (await stock(pid)) === 7);
    reg(G, 'ajuste a negativo rechazado', (await call('POST', `/products/${pid}/adjustments`, { newStock: -1, reason: 'Conteo físico' })).status === 400);
    reg(G, 'ajuste a 2,5 unidades rechazado', (await call('POST', `/products/${pid}/adjustments`, { newStock: 2.5, reason: 'Conteo físico' })).status === 400);
    if (kit) reg(G, 'ajuste directo a un kit rechazado', (await call('POST', `/products/${kit.id}/adjustments`, { newStock: 9, reason: 'Conteo físico' })).status === 400);

    const ficha = { name: 'PRUEBA Perfume', category: 'Prueba', price: 50000, costPrice: 25000, type: 'terminado' };
    const conStock = await call('PUT', `/products/${pid}`, { ...ficha, stock: 12 });
    reg(G, 'la ficha no cambia el stock (solo «Ajustar stock» con motivo)', conStock.status === 400 && (await stock(pid)) === 7, conStock.body.error);
    const mismoStock = await call('PUT', `/products/${pid}`, { ...ficha, stock: 7 });
    reg(G, 'guardar la ficha con el mismo stock sí se permite', mismoStock.status === 200);

    await call('PUT', `/products/${pid}`, { ...ficha, costPrice: 26000 });
    const mc = await uno("SELECT motivo, cantidad FROM movimientos_inventario WHERE inventario_id=? AND tipo='cambio_costo' ORDER BY id DESC LIMIT 1", [pid]);
    reg(G, 'cambiar el costo a mano queda en el kárdex', (await costo(pid)) === 26000 && mc && Number(mc.cantidad) === 0, mc?.motivo);
    await call('PUT', `/products/${pid}`, ficha);

    const tipo = await call('PUT', `/products/${pid}`, { ...ficha, type: 'esencia', essenceClass: 'arabe' });
    reg(G, 'cambiar und → ml con stock rechazado', tipo.status === 400 && (await uno('SELECT unidad FROM inventario WHERE id=?', [pid])).unidad === 'und', tipo.body.error);

    const cx = await call('POST', '/purchases', { productId: pid, quantity: 3, unitPrice: 25000, date: hoy });
    await call('POST', `/products/${pid}/adjustments`, { newStock: 1, reason: 'Rotura' });
    reg(G, 'no deja eliminar una compra cuyas unidades ya salieron', (await call('DELETE', `/purchases/${cx.body.id}`)).status === 400);
    await call('POST', `/products/${pid}/adjustments`, { newStock: 10, reason: 'Corrección de registro' });
    await call('DELETE', `/purchases/${cx.body.id}`);
    await call('POST', `/products/${pid}/adjustments`, { newStock: 10, reason: 'Corrección de registro' });

    const desact = await call('DELETE', `/products/${pid}`);
    reg(G, 'desactivar un ítem con stock rechazado', desact.status === 400, desact.body.error);
    await libroCuadra(G, 'ingresos y ajustes');
}

// ---------- 3. Venta ----------
{
    const G = 'Venta';
    const s0 = await stock(pid);
    const v1 = await venta([{ productId: pid, quantity: 2, unitPrice: 50000 }], { initialPayment: 100000 });
    reg(G, 'venta de contado: stock baja y queda pagada', v1.status === 201 && v1.body.status === 'paid' && (await stock(pid)) === s0 - 2);
    reg(G, 'la línea guarda el costo del momento', Number((await uno('SELECT costo_al_vender c FROM venta_detalles WHERE venta_id=?', [v1.body.id])).c) === await costo(pid));
    const fv = (await uno('SELECT fecha FROM ventas WHERE id=?', [v1.body.id])).fecha;
    reg(G, 'venta de hoy guarda la hora real', !fv.endsWith('00:00:00'), fv);
    const vAyer = await venta([{ productId: pid, quantity: 1, unitPrice: 50000 }], { date: ayer, initialPayment: 50000 });
    reg(G, 'venta con fecha anterior queda en ese día', (await uno('SELECT fecha FROM ventas WHERE id=?', [vAyer.body.id])).fecha.startsWith(ayer));
    await call('DELETE', `/sales/${vAyer.body.id}`);

    const bajo = await venta([{ productId: pid, quantity: 1, unitPrice: 1 }], { initialPayment: 1 });
    reg(G, 'venta bajo costo sin confirmar rechazada', bajo.status === 400, bajo.body.error);
    const bajoOk = await venta([{ productId: pid, quantity: 1, unitPrice: 1, allowBelowCost: true }], { initialPayment: 1 });
    reg(G, 'venta bajo costo confirmada en el panel se registra', bajoOk.status === 201);
    await call('DELETE', `/sales/${bajoOk.body.id}`);

    const v3 = await venta([{ productId: pid, quantity: 1, unitPrice: 50000 }], { customerName: 'Cliente Crédito', initialPayment: 20000 });
    reg(G, 'venta con abono parcial queda pendiente', v3.body.status === 'pending');
    reg(G, 'abono mayor al saldo rechazado', (await call('POST', `/sales/${v3.body.id}/payments`, { amount: 40000, date: hoy, method: 'Nequi' })).status === 400);
    reg(G, 'abono con método inexistente rechazado', (await call('POST', `/sales/${v3.body.id}/payments`, { amount: 1000, date: hoy, method: 'Bitcoin' })).status === 400);
    reg(G, 'abono sin fecha rechazado', (await call('POST', `/sales/${v3.body.id}/payments`, { amount: 1000, method: 'Nequi' })).status === 400);
    const ab = await call('POST', `/sales/${v3.body.id}/payments`, { amount: 30000, date: hoy, method: 'Nequi' });
    reg(G, 'abono que completa el saldo la marca pagada', ab.status === 201 && (await uno('SELECT estado FROM ventas WHERE id=?', [v3.body.id])).estado === 'paid');

    const n0 = Number((await uno('SELECT COUNT(*) n FROM clientes')).n);
    const sinStock = await venta([{ productId: pid, quantity: 1, unitPrice: 50000 }, { productId: perfume.id, quantity: 999, unitPrice: Number(perfume.precio) }], { customerName: 'No Debe Quedar' });
    reg(G, 'venta sin stock rechazada y revertida completa', sinStock.status === 400 && Number((await uno('SELECT COUNT(*) n FROM clientes')).n) === n0, sinStock.body.error);
    reg(G, 'vender 1,5 unidades rechazado', (await venta([{ productId: pid, quantity: 1.5, unitPrice: 50000 }])).status === 400);
    reg(G, 'línea con cantidad 0 rechazada', (await venta([{ productId: pid, quantity: 0, unitPrice: 50000 }])).status === 400);

    // Kits: salen los componentes y al anular vuelve exactamente lo que salió
    if (kit) {
        const comps = await q('SELECT componente_id id, cantidad FROM kit_componentes WHERE kit_id=?', [kit.id]);
        // Stock suficiente para el kit
        for (const c of comps) if ((await stock(c.id)) < Number(c.cantidad)) await call('POST', `/products/${c.id}/adjustments`, { newStock: Number(c.cantidad) + 1, reason: 'Corrección de registro' });
        const antes = await Promise.all(comps.map((c) => stock(c.id)));
        const precioKit = Number((await uno('SELECT precio FROM inventario WHERE id=?', [kit.id])).precio) || 100000;
        const vk = await venta([{ productId: kit.id, quantity: 1, unitPrice: precioKit, allowBelowCost: true }], { method: 'Transferencia', initialPayment: precioKit });
        const despues = await Promise.all(comps.map((c) => stock(c.id)));
        reg(G, 'venta de kit descuenta cada componente', vk.status === 201 && comps.every((c, i) => despues[i] === antes[i] - Number(c.cantidad)), vk.body.error || '');
        const nc = Number((await uno('SELECT COUNT(*) n FROM venta_consumos WHERE venta_id=? AND venta_detalle_id IS NOT NULL', [vk.body.id])).n);
        reg(G, 'la venta de kit guarda lo que salió de cada componente', nc === comps.length, `${nc} consumos`);
        await call('PUT', `/kits/${kit.id}/components`, { components: [{ productId: comps[0].id, quantity: 1 }] });
        await call('DELETE', `/sales/${vk.body.id}`);
        const final = await Promise.all(comps.map((c) => stock(c.id)));
        reg(G, 'anular la venta de un kit devuelve lo que salió aunque cambie su composición', final.every((s, i) => s === antes[i]), `${antes.join(',')} → ${final.join(',')}`);
        await call('PUT', `/kits/${kit.id}/components`, { components: comps.map((c) => ({ productId: c.id, quantity: Number(c.cantidad) })) });
    }

    const e0 = await stock(esencia.id);
    const ve = await venta([{ productId: esencia.id, quantity: 12.5, unitPrice: 400 }], { initialPayment: 5000 });
    reg(G, 'vender 12,5 ml de esencia descuenta y cobra 12,5 ml', ve.status === 201 && (await stock(esencia.id)) === e0 - 12.5 && Number(ve.body.total) === 5000, `total ${ve.body.total}`);
    await call('DELETE', `/sales/${ve.body.id}`);
    reg(G, 'anularla devuelve los 12,5 ml', (await stock(esencia.id)) === e0);

    const inactivo = await uno('SELECT id FROM inventario WHERE activo=0 LIMIT 1');
    if (inactivo) reg(G, 'no se vende un ítem desactivado', (await venta([{ productId: inactivo.id, quantity: 1, unitPrice: 1000 }])).status === 400);
    reg(G, 'método de pago inexistente rechazado', (await venta([{ productId: pid, quantity: 1, unitPrice: 50000 }], { method: 'Bitcoin', initialPayment: 50000 })).status === 400);

    // Clientes sin duplicar: nombre exacto, cédula, teléfono
    const cuantos = async (n) => Number((await uno('SELECT COUNT(*) n FROM clientes WHERE nombre=?', [n])).n);
    const vd = await venta([{ productId: pid, quantity: 1, unitPrice: 50000 }], { customerName: '  cliente   prueba ', initialPayment: 50000 });
    reg(G, 'escribir un cliente que ya existe no lo duplica', (await cuantos('Cliente Prueba')) === 1, `${await cuantos('Cliente Prueba')} «Cliente Prueba»`);
    await call('DELETE', `/sales/${vd.body.id}`);
    const ced = await uno('SELECT id, cedula FROM clientes WHERE cedula IS NOT NULL LIMIT 1');
    if (ced) {
        const vc = await venta([{ productId: pid, quantity: 1, unitPrice: 50000 }], { customerName: 'Otro Nombre', idDocument: ced.cedula, initialPayment: 50000 });
        reg(G, 'cédula ya registrada: se reutiliza su cliente', vc.status === 201 && (await uno('SELECT cliente_id c FROM ventas WHERE id=?', [vc.body.id])).c === ced.id, vc.body.error || '');
        await call('DELETE', `/sales/${vc.body.id}`);
    }

    // Concurrencia
    await call('POST', `/products/${pid}/adjustments`, { newStock: 1, reason: 'Corrección de registro' });
    const par = await Promise.all([1, 2].map(() => venta([{ productId: pid, quantity: 1, unitPrice: 50000 }], { initialPayment: 50000 })));
    reg(G, 'dos ventas simultáneas de la última unidad: solo una pasa', par.map((x) => x.status).sort().join() === '201,400' && (await stock(pid)) === 0);
    for (const x of par) if (x.status === 201) await call('DELETE', `/sales/${x.body.id}`);
    await call('POST', `/products/${pid}/adjustments`, { newStock: 10, reason: 'Corrección de registro' });

    // Edición
    const v4 = await venta([{ productId: pid, quantity: 2, unitPrice: 50000 }], { customerName: 'Cliente Edición', initialPayment: 100000 });
    const f4 = (await uno('SELECT fecha FROM ventas WHERE id=?', [v4.body.id])).fecha;
    const menos = await call('PUT', `/sales/${v4.body.id}`, { date: hoy, customerName: 'Cliente Edición', method: 'Efectivo', items: [{ productId: pid, quantity: 1, unitPrice: 50000 }] });
    reg(G, 'editar una venta a menos de lo ya pagado rechazado', menos.status === 400 && (await stock(pid)) === 8, menos.body.error);
    const nC = Number((await uno('SELECT COUNT(*) n FROM clientes')).n);
    const mas = await call('PUT', `/sales/${v4.body.id}`, { date: hoy, customerName: 'Cliente Edición', method: 'Efectivo', items: [{ productId: pid, quantity: 3, unitPrice: 50000 }] });
    reg(G, 'editar una venta (más unidades) mueve el stock y la deja pendiente', mas.status === 200 && (await stock(pid)) === 7 && mas.body.status === 'pending');
    reg(G, 'editar no crea otro cliente', Number((await uno('SELECT COUNT(*) n FROM clientes')).n) === nC);
    reg(G, 'editar conserva la fecha y hora original', (await uno('SELECT fecha FROM ventas WHERE id=?', [v4.body.id])).fecha === f4);
    await call('DELETE', `/sales/${v4.body.id}`);
    reg(G, 'anular la venta devuelve el stock', (await stock(pid)) === 10);
    const anulada = await uno('SELECT anulada_en, (SELECT COUNT(*) FROM pagos WHERE venta_id = ventas.id AND anulada_en IS NOT NULL) AS pagos FROM ventas WHERE id=?', [v4.body.id]);
    reg(G, 'la venta anulada queda como historia con sus pagos anulados', !!anulada?.anulada_en && Number(anulada.pagos) === 1);
    reg(G, 'la venta anulada ya no aparece en la lista', !(await call('GET', '/sales')).body.some((x) => x.id === v4.body.id));
    reg(G, 'una venta anulada no se edita', (await call('PUT', `/sales/${v4.body.id}`, { date: hoy, customerName: 'Cliente Edición', method: 'Efectivo', items: [{ productId: pid, quantity: 1, unitPrice: 50000 }] })).status === 400);
    reg(G, 'una venta anulada no recibe abonos', (await call('POST', `/sales/${v4.body.id}/payments`, { amount: 1000, date: hoy, method: 'Efectivo' })).status === 400);
    reg(G, 'una venta no se anula dos veces', (await call('DELETE', `/sales/${v4.body.id}`)).status === 400 && (await stock(pid)) === 10);

    // Consumidor final: de contado sin cliente sí; a crédito no
    const cf = await call('POST', '/sales', { date: hoy, method: 'Efectivo', initialPayment: 50000, items: [{ productId: pid, quantity: 1, unitPrice: 50000 }] });
    reg(G, 'venta de contado sin cliente (Consumidor final)', cf.status === 201 && (await uno('SELECT cliente_id c FROM ventas WHERE id=?', [cf.body.id])).c === null);
    await call('DELETE', `/sales/${cf.body.id}`);
    const cred = await call('POST', '/sales', { date: hoy, method: 'Efectivo', initialPayment: 10000, items: [{ productId: pid, quantity: 1, unitPrice: 50000 }] });
    reg(G, 'venta a crédito sin cliente rechazada', cred.status === 400 && (await stock(pid)) === 10, cred.body.error);

    reg(G, 'venta sin fecha rechazada con mensaje claro', (await venta([{ productId: pid, quantity: 1, unitPrice: 50000 }], { date: undefined })).status === 400);
    reg(G, 'venta con fecha futura rechazada', (await venta([{ productId: pid, quantity: 1, unitPrice: 50000 }], { date: '2099-01-01' })).status === 400);
    reg(G, 'venta con fecha imposible rechazada', (await venta([{ productId: pid, quantity: 1, unitPrice: 50000 }], { date: '2026-02-31' })).status === 400);
    await libroCuadra(G, 'ventas');
}

// ---------- 4. Ventas web ----------
{
    const G = 'Web';
    const s0 = await stock(pid);
    const ref = 'TEST' + Date.now();
    const w1 = await integ('POST', '/internal/v1/sales', { externalReference: ref, customer: { name: 'Web Cliente' }, items: [{ inventoryId: pid, quantity: 1, unitPrice: 50000 }, { description: 'Envío', quantity: 1, unitPrice: 12000 }] });
    const w2 = await integ('POST', '/internal/v1/sales', { externalReference: ref, customer: { name: 'Web Cliente' }, items: [{ inventoryId: pid, quantity: 1, unitPrice: 50000 }] });
    reg(G, 'venta web registrada una sola vez', w1.status === 201 && w2.body?.duplicated && (await stock(pid)) === s0 - 1);
    const ed = await call('PUT', `/sales/${w1.body.saleId}`, { date: hoy, customerName: 'Web Cliente', method: 'Mercado Pago (Web)', items: [{ productId: pid, quantity: 1, unitPrice: 50000 }] });
    reg(G, 'el panel no edita ventas web', ed.status === 400, ed.body.error);
    reg(G, 'el panel no elimina ventas web', (await call('DELETE', `/sales/${w1.body.saleId}`)).status === 400 && (await stock(pid)) === s0 - 1);
    const lista = (await call('GET', '/sales')).body.find((s) => s.id === w1.body.saleId);
    reg(G, 'el panel sabe que la venta es web', lista?.origin === 'web');
    const c = await integ('POST', `/internal/v1/sales/${ref}/cancel`);
    reg(G, 'reembolso web devuelve el stock', c.body?.cancelled && (await stock(pid)) === s0);
    reg(G, 'la venta web reembolsada queda anulada (no se borra)', !!(await uno('SELECT anulada_en FROM ventas WHERE id=?', [w1.body.saleId]))?.anulada_en);
    const c2 = await integ('POST', `/internal/v1/sales/${ref}/cancel`);
    reg(G, 'repetir el reembolso no devuelve dos veces', c2.body?.cancelled && (await stock(pid)) === s0);

    // Insumo por ml desde la web (esencia suelta)
    const e0 = await stock(esencia.id);
    const ref2 = 'TESTML' + Date.now();
    const wm = await integ('POST', '/internal/v1/sales', { externalReference: ref2, customer: { name: 'Web Cliente' }, items: [{ inventoryId: esencia.id, quantity: 30, unitPrice: 500 }] });
    reg(G, 'esencia por ml vendida en la web', wm.status === 201 && (await stock(esencia.id)) === e0 - 30);
    await integ('POST', `/internal/v1/sales/${ref2}/cancel`);
    reg(G, 'su reembolso devuelve los ml', (await stock(esencia.id)) === e0);

    if (kit) {
        const comps = await q('SELECT componente_id id, cantidad FROM kit_componentes WHERE kit_id=?', [kit.id]);
        const antes = await Promise.all(comps.map((x) => stock(x.id)));
        const ref3 = 'TESTKIT' + Date.now();
        await integ('POST', '/internal/v1/sales', { externalReference: ref3, customer: { name: 'Web Cliente' }, items: [{ inventoryId: kit.id, quantity: 1, unitPrice: 100000 }] });
        await call('PUT', `/kits/${kit.id}/components`, { components: [{ productId: comps[0].id, quantity: 1 }] });
        await integ('POST', `/internal/v1/sales/${ref3}/cancel`);
        const final = await Promise.all(comps.map((x) => stock(x.id)));
        reg(G, 'reembolso de un kit web devuelve lo que salió aunque cambie el kit', final.every((s, i) => s === antes[i]), `${antes.join(',')} → ${final.join(',')}`);
        await call('PUT', `/kits/${kit.id}/components`, { components: comps.map((x) => ({ productId: x.id, quantity: Number(x.cantidad) })) });
    }

    const rec = await q("SELECT rol, cantidad FROM recetas WHERE ambito='decant'");
    const ml = rec.filter((r) => r.rol === 'esencia').reduce((s, r) => s + Number(r.cantidad), 0);
    reg(G, 'receta de decant con ml de esencia', ml > 0 ? true : null, ml > 0 ? `${ml} ml` : 'dato pendiente del usuario: hoy un decant solo descuenta el envase');
    await libroCuadra(G, 'ventas web');
}

// ---------- 5. Gastos ----------
{
    const G = 'Gasto';
    const g = await call('POST', '/expenses', { description: 'Domicilio', amount: 8000, category: 'Transporte y envíos', date: hoy });
    reg(G, 'gasto registrado', g.status === 201);
    const inv = await call('POST', '/expenses', { description: 'Algo', amount: 1000, category: 'Categoría Inventada', date: hoy });
    reg(G, 'categoría inexistente rechazada', inv.status === 400 && Number((await uno("SELECT COUNT(*) n FROM categorias_gasto WHERE nombre='Categoría Inventada'")).n) === 0, inv.body.error);
    reg(G, 'gasto sin fecha rechazado', (await call('POST', '/expenses', { description: 'X', amount: 1000, category: 'Otros' })).status === 400);
    reg(G, 'gasto con fecha futura rechazado', (await call('POST', '/expenses', { description: 'X', amount: 1000, category: 'Otros', date: '2099-01-01' })).status === 400);
    reg(G, 'gasto con método inexistente rechazado', (await call('POST', '/expenses', { description: 'X', amount: 1000, category: 'Otros', date: hoy, method: 'Bitcoin' })).status === 400);
    await call('DELETE', `/expenses/${g.body.id}`);
    reg(G, 'el gasto anulado deja de listarse', !(await call('GET', '/expenses')).body.some((x) => x.id === g.body.id));
}

// ---------- 6. Caja por sesiones ----------
{
    const G = 'Caja';
    const actual = async () => (await call('GET', '/cash/current')).body;
    const esperado = async () => (await actual()).summary.expectedCash;
    const audit = async () => (await call('GET', '/cash/audit')).body.diferencias || [];
    const cerca = (a, b) => Math.abs(a - b) < 0.01;

    const c0 = await actual();
    reg(G, 'hay una sesión de caja abierta', c0.session?.open === true);
    const reg0 = (await call('GET', '/cash/sessions')).body.find((h) => h.type === 'regularizacion');
    reg(G, 'los movimientos anteriores quedaron en una sesión de regularización', !!reg0, reg0?.notes?.slice(0, 80));
    reg(G, 'el libro de dinero cuadra con pagos, gastos y compras', (await audit()).length === 0, JSON.stringify((await audit()).slice(0, 3)));

    const e0 = await esperado();
    await call('POST', '/cash/movements', { type: 'ingreso', amount: 100000, reason: 'Base del cajón' });
    reg(G, 'ingreso de efectivo suma al esperado', cerca(await esperado(), e0 + 100000));
    reg(G, 'movimiento sin motivo rechazado', (await call('POST', '/cash/movements', { type: 'retiro', amount: 1000, reason: '' })).status === 400);

    const ve = await venta([{ productId: pid, quantity: 1, unitPrice: 50000 }], { initialPayment: 50000 });
    reg(G, 'venta en efectivo suma al cajón', cerca(await esperado(), e0 + 150000));
    const vn = await venta([{ productId: pid, quantity: 1, unitPrice: 50000 }], { method: 'Nequi', initialPayment: 50000 });
    const nequi = (await actual()).summary.byMethod.find((m) => m.method === 'Nequi');
    reg(G, 'venta por Nequi no entra al cajón y se ve aparte', cerca(await esperado(), e0 + 150000) && nequi?.total >= 50000);

    const g1 = await call('POST', '/expenses', { description: 'Bolsas', amount: 8000, category: 'Otros', date: hoy, method: 'Efectivo' });
    reg(G, 'gasto en efectivo resta del cajón', cerca(await esperado(), e0 + 142000));
    const g2 = await call('POST', '/expenses', { description: 'Pauta', amount: 30000, category: 'Publicidad', date: hoy, method: 'Transferencia' });
    reg(G, 'gasto por transferencia no resta del cajón', cerca(await esperado(), e0 + 142000));
    await call('PUT', `/expenses/${g1.body.id}`, { description: 'Bolsas', amount: 10000, category: 'Otros', date: hoy, method: 'Efectivo' });
    reg(G, 'corregir el monto de un gasto ajusta la diferencia', cerca(await esperado(), e0 + 140000));
    await call('PUT', `/expenses/${g1.body.id}`, { description: 'Bolsas', amount: 10000, category: 'Otros', date: hoy, method: 'Transferencia' });
    reg(G, 'cambiar el método de un gasto a transferencia lo saca del cajón', cerca(await esperado(), e0 + 150000));
    const gAyer = await call('POST', '/expenses', { description: 'Olvidado de ayer', amount: 5000, category: 'Otros', date: ayer, method: 'Efectivo' });
    reg(G, 'un gasto con fecha de ayer registrado hoy entra a la caja abierta', cerca(await esperado(), e0 + 145000));

    const cp = await call('POST', '/purchases', { productId: pid, quantity: 1, unitPrice: 20000, date: hoy, method: 'Efectivo' });
    reg(G, 'compra en efectivo resta del cajón', cerca(await esperado(), e0 + 125000));
    const ct = await call('POST', '/purchases', { productId: pid, quantity: 1, unitPrice: 20000, date: hoy, method: 'Transferencia' });
    reg(G, 'compra por transferencia no resta del cajón', cerca(await esperado(), e0 + 125000));

    await call('DELETE', `/sales/${ve.body.id}`);
    reg(G, 'anular una venta en efectivo registra la devolución', cerca(await esperado(), e0 + 75000));
    await call('POST', '/cash/movements', { type: 'retiro', amount: 20000, reason: 'Consignación' });
    reg(G, 'retiro de efectivo resta', cerca(await esperado(), e0 + 55000));
    reg(G, 'el libro de dinero sigue cuadrando', (await audit()).length === 0);

    // Cierre con faltante (con base suficiente para retirar 30.000)
    const previo = await esperado();
    if (previo < 100000) await call('POST', '/cash/movements', { type: 'ingreso', amount: Math.ceil(100000 - previo), reason: 'Base para la prueba de cierre' });
    const antes = await actual();
    const debe = antes.summary.expectedCash;
    const cierre = await call('POST', '/cash/close', { sessionId: antes.session.id, countedCash: debe - 5000, withdrawn: 30000, notes: 'Prueba' });
    reg(G, 'cerrar calcula la diferencia en el servidor', cierre.status === 201 && cerca(cierre.body.difference, -5000), JSON.stringify(cierre.body));
    const nueva = await actual();
    reg(G, 'la siguiente sesión arranca con lo que quedó en el cajón', nueva.session.id !== antes.session.id && cerca(nueva.session.initialCash, debe - 5000 - 30000));
    reg(G, 'cerrar otra vez la misma sesión rechazado', (await call('POST', '/cash/close', { sessionId: antes.session.id, countedCash: 0 })).status === 409);
    reg(G, 'retirar más de lo contado rechazado', (await call('POST', '/cash/close', { sessionId: nueva.session.id, countedCash: 1000, withdrawn: 2000 })).status === 400);

    // Anular algo de una sesión cerrada: la corrección cae en la abierta y la cerrada no cambia
    await call('DELETE', `/expenses/${gAyer.body.id}`);
    const cerrada = (await call('GET', `/cash/sessions/${antes.session.id}`)).body;
    reg(G, 'una sesión cerrada no cambia aunque se anule algo suyo', cerca(cerrada.summary.expectedCash, debe) && cerca(cerrada.session.difference, -5000));
    reg(G, 'la anulación queda en la sesión abierta', cerca(await esperado(), nueva.session.initialCash + 5000));

    // Dos cierres simultáneos
    const sid = (await actual()).session.id;
    const dos = await Promise.all([1, 2].map(() => call('POST', '/cash/close', { sessionId: sid, countedCash: 0 })));
    reg(G, 'dos cierres simultáneos: solo uno pasa', dos.filter((d) => d.status === 201).length === 1, dos.map((d) => d.status).join('/'));
    reg(G, 'siempre hay exactamente una sesión abierta', Number((await uno('SELECT COUNT(*) n FROM sesiones_caja WHERE abierta = 1')).n) === 1);

    // Web: entra como Mercado Pago (no efectivo) y el reembolso lo devuelve
    const e1 = await esperado();
    const ref = 'TESTCAJA' + Date.now();
    await integ('POST', '/internal/v1/sales', { externalReference: ref, customer: { name: 'Web Caja' }, items: [{ inventoryId: pid, quantity: 1, unitPrice: 50000 }] });
    const mp = () => actual().then((a) => a.summary.byMethod.find((m) => m.method === 'Mercado Pago (Web)')?.total || 0);
    const mp1 = await mp();
    await integ('POST', `/internal/v1/sales/${ref}/cancel`);
    reg(G, 'venta web entra como Mercado Pago y su reembolso la devuelve, sin tocar el cajón', mp1 >= 50000 && cerca(await mp(), mp1 - 50000) && cerca(await esperado(), e1));

    reg(G, 'el sistema anterior ya no crea cierres', (await call('POST', '/cash-closings', { date: hoy, finalCash: 99999999 })).status === 410);
    reg(G, 'el sistema anterior ya no borra cierres', (await call('DELETE', '/cash-closings/1')).status === 410);
    for (const x of [vn, g2, g1, cp, ct]) if (x.body?.id) await call('DELETE', `/${x === vn ? 'sales' : x === cp || x === ct ? 'purchases' : 'expenses'}/${x.body.id}`);
    reg(G, 'el libro de dinero cuadra al final', (await audit()).length === 0, JSON.stringify((await audit()).slice(0, 3)));
}

// ---------- 7. Integridad referencial ----------
{
    const G = 'Integridad';
    const cli = await call('POST', '/customers', { nombre: 'Con Deuda Prueba' });
    const v = await venta([{ productId: pid, quantity: 1, unitPrice: 50000 }], { customerId: cli.body.id, customerName: 'Con Deuda Prueba' });
    const del = await call('DELETE', `/customers/${cli.body.id}`);
    reg(G, 'no se borra un cliente con ventas', del.status === 400 && (await uno('SELECT cliente_id c FROM ventas WHERE id=?', [v.body.id])).c === cli.body.id, del.body.error);
    await call('DELETE', `/sales/${v.body.id}`);
    const libre = await call('POST', '/customers', { nombre: 'Sin Ventas Prueba' });
    reg(G, 'un cliente sin ventas sí se borra', (await call('DELETE', `/customers/${libre.body.id}`)).status === 200);
    const prov = await call('POST', '/suppliers', { name: 'Prov Prueba' });
    const cp = await call('POST', '/purchases', { productId: pid, supplierId: prov.body.id, quantity: 1, unitPrice: 25000, date: hoy });
    reg(G, 'no se borra un proveedor con compras', (await call('DELETE', `/suppliers/${prov.body.id}`)).status === 400);
    await call('DELETE', `/purchases/${cp.body.id}`);
    await call('DELETE', `/suppliers/${prov.body.id}`);
    const fk = await q("SELECT 1 FROM information_schema.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA=DATABASE() AND CONSTRAINT_NAME='fk_venta_consumos_venta'");
    reg(G, 'venta_consumos con llave foránea a ventas', fk.length === 1);
    const borrados = await uno(`SELECT (SELECT COUNT(*) FROM ventas WHERE anulada_en IS NOT NULL) v, (SELECT COUNT(*) FROM compras WHERE anulada_en IS NOT NULL) c, (SELECT COUNT(*) FROM gastos WHERE anulada_en IS NOT NULL) g`);
    reg(G, 'ventas, compras y gastos se anulan en vez de borrarse', Number(borrados.v) > 0 && Number(borrados.c) > 0 && Number(borrados.g) > 0, `${borrados.v} ventas, ${borrados.c} compras, ${borrados.g} gastos anulados`);

    await call('POST', `/products/${pid}/adjustments`, { newStock: 0, reason: 'Corrección de registro' });
    reg(G, 'desactivar un ítem en 0 sí se permite', (await call('DELETE', `/products/${pid}`)).status === 200);
    await libroCuadra(G, 'todas las pruebas');
}

const fallas = resultados.filter((r) => r.ok === false);
console.log(`\n${resultados.filter((r) => r.ok === true).length} OK · ${fallas.length} fallas · ${resultados.filter((r) => r.ok === null).length} pendientes`);
await db.end();
process.exit(fallas.length ? 1 : 0);
