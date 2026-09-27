// Las notas del cierre guardan todos los movimientos del día: TEXT (64 KB) se queda corto.
export const nombre = 'Notas del cierre de caja como MEDIUMTEXT';

export async function up(conn, h) {
    if ((await h.tipoColumna('cierres_caja', 'notas')) !== 'mediumtext') {
        await conn.query('ALTER TABLE cierres_caja MODIFY COLUMN notas MEDIUMTEXT');
    }
}
