import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

dotenv.config();

const pool = mysql.createPool({
    host: process.env.DB_HOST || process.env.MYSQLHOST,
    user: process.env.DB_USER || process.env.MYSQLUSER,
    password: process.env.DB_PASS || process.env.MYSQLPASSWORD,
    database: process.env.DB_NAME || process.env.MYSQLDATABASE,
    port: process.env.DB_PORT || process.env.MYSQLPORT || 3306,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    timezone: '-05:00',
    dateStrings: true
});

// Toda la contabilidad va en hora de Colombia: las fechas que pone la base (NOW(), CURRENT_TIMESTAMP:
// movimientos, anulaciones, sesiones de caja) deben coincidir con las de los documentos. Railway
// corre en UTC, así que cada conexión fija su zona horaria apenas se abre.
export const ZONA_HORARIA = '-05:00';
pool.on('connection', (conexion) => { conexion.query(`SET time_zone = '${ZONA_HORARIA}'`); });

export default pool;
