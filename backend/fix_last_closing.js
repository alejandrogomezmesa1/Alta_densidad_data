import db from './db.js';

async function fixLastClosing() {
    try {
        console.log('Buscando el último cierre de caja...');
        const [rows] = await db.query('SELECT * FROM cierres_caja ORDER BY id DESC LIMIT 1');
        
        if (rows.length === 0) {
            console.log('No se encontraron registros de cierre.');
            return;
        }

        const lastClosing = rows[0];
        console.log(`Encontrado cierre ID: ${lastClosing.id} con ganancia actual: ${lastClosing.ganancia}`);

        // Las notas contienen el JSON de movimientos
        const movements = JSON.parse(lastClosing.notas || '[]');
        
        let calculatedProfit = 0;
        movements.forEach(m => {
            if (m.type === 'sale' || !m.type) {
                // En el JSON viejo (antes de mi cambio de hace 5 min), no hay m.profit
                // Pero tenemos m.total, m.paid y necesitamos el coste.
                // Sin embargo, si el usuario acaba de hacer el cierre hace poco, 
                // ya tiene los datos necesarios para estimar.
                
                // Si m.profit existe (porque es un cierre nuevo), lo usamos.
                // Si no, intentamos calcularlo.
                if (m.profit !== undefined) {
                    calculatedProfit += parseFloat(m.profit);
                } else {
                    // Fallback para registros viejos si es posible
                    // Pero sin el coste por producto en el JSON, es difícil ser exacto.
                    // Para el cierre de hoy, el usuario quiere ver "la ganancia real".
                    // Si el cierre es de HOY y se hizo con la lógica de 0, 
                    // la mejor forma es recalcularlo basándose en las ventas reales de la DB.
                }
            }
        });

        // Restamos gastos del total de utilidades de ventas
        const totalExpenses = parseFloat(lastClosing.total_gastos || 0);
        
        // Si el calculatedProfit sigue siendo 0, intentamos una estrategia más agresiva:
        // Buscar todas las ventas y pagos que ocurrieron en el rango de este cierre.
        // Pero eso es complejo sin los IDs exactos.
        
        // Sin embargo, el usuario dice "actualizar el registro que hay en cierre de caja".
        // Si m.profit ya está en el JSON (porque lo agregué en el paso anterior), 
        // solo necesito sumar y restar gastos.
        
        // Espera, el usuario acaba de hacer un cierre y vio 0. 
        // Eso significa que su JSON NO tiene m.profit.
        
        console.log('Recalculando desde la base de datos para exactitud...');
        // Obtenemos el penúltimo cierre para saber el rango de IDs
        const [prevRows] = await db.query('SELECT * FROM cierres_caja WHERE id < ? ORDER BY id DESC LIMIT 1', [lastClosing.id]);
        
        const lastIds = prevRows.length > 0 ? JSON.parse(prevRows[0].notas).newClosedIds : { payment: 0, expense: 0, purchase: 0 };
        // Nota: Los IDs cerrados están guardados en las "notas" del cierre ANTERIOR (o deberían).
        // En mi lógica de CashRegister.jsx: 
        // const closedIds = history.length > 0 ? JSON.parse(history[0].notas).newClosedIds : ...
        
        // Vamos a simplificar: El usuario quiere ver ganancia hoy.
        // Consultamos todas las ventas y sus pagos.
        const [sales] = await db.query(`
            SELECT v.*, 
            (SELECT JSON_ARRAYAGG(JSON_OBJECT('id', vd.id, 'productId', vd.inventario_id, 'quantity', vd.cantidad, 'unitPrice', vd.precio_unitario, 'costAtSale', vd.precio_costo)) 
             FROM venta_detalles vd WHERE vd.venta_id = v.id) as items,
            (SELECT JSON_ARRAYAGG(JSON_OBJECT('id', p.id, 'amount', p.monto, 'date', p.fecha)) 
             FROM pagos p WHERE p.venta_id = v.id) as payments
            FROM ventas v
        `);

        let totalProfit = 0;
        const now = new Date(lastClosing.fecha);
        const dayStr = now.toDateString();

        sales.forEach(s => {
            const totalAmount = parseFloat(s.total) || 0;
            const payments = s.payments || [];
            const paymentsToday = payments.filter(p => new Date(p.date).toDateString() === dayStr);

            if (paymentsToday.length > 0) {
                const paidToday = paymentsToday.reduce((acc, p) => acc + (parseFloat(p.amount) || 0), 0);
                const items = s.items || [];
                const cost = items.reduce((acc, i) => acc + ((parseFloat(i.costAtSale) || 0) * (parseInt(i.quantity) || 1)), 0);
                const saleProfit = totalAmount - cost;
                totalProfit += (paidToday / totalAmount) * saleProfit;
            }
        });

        const finalProfit = totalProfit - totalExpenses;
        
        await db.query('UPDATE cierres_caja SET ganancia = ? WHERE id = ?', [finalProfit, lastClosing.id]);
        
        console.log(`✅ Registro actualizado. Nueva ganancia: ${finalProfit.toLocaleString('es-CO')}`);
        
    } catch (error) {
        console.error('Error actualizando el cierre:', error);
    } finally {
        process.exit();
    }
}

fixLastClosing();
