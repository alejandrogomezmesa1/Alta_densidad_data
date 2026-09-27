// Hasta qué pago, gasto y compra llega cada cierre: compartido entre todos los equipos.
export const nombre = 'Marcas de cierre de caja';

export async function up(conn, h) {
    for (const col of ['ultimo_pago_id', 'ultimo_gasto_id', 'ultima_compra_id']) {
        if (!(await h.columnaExiste('cierres_caja', col))) {
            await conn.query(`ALTER TABLE cierres_caja ADD COLUMN ${col} INT NULL`);
        }
    }
}
