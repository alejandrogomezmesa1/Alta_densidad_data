// Fase 2 · Una cédula = un cliente. Las cédulas vacías pasan a NULL (no cuentan como repetidas).
export const nombre = 'Cédula única por cliente';

export async function up(conn, h) {
    await conn.query("UPDATE clientes SET cedula = NULL WHERE cedula IS NOT NULL AND TRIM(cedula) = ''");
    await conn.query('UPDATE clientes SET cedula = TRIM(cedula) WHERE cedula IS NOT NULL');
    if (await h.indiceExiste('clientes', 'uq_clientes_cedula')) return;
    const [dup] = await conn.query('SELECT cedula, COUNT(*) AS n FROM clientes WHERE cedula IS NOT NULL GROUP BY cedula HAVING n > 1');
    if (dup.length) {
        throw new Error(`Hay cédulas repetidas que se deben unificar antes: ${dup.map(d => `${d.cedula} (${d.n})`).join(', ')}`);
    }
    await conn.query('ALTER TABLE clientes ADD UNIQUE INDEX uq_clientes_cedula (cedula)');
}
