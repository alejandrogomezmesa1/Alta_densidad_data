// Uso: node migrate.js         → aplica las migraciones pendientes
//      node migrate.js status  → muestra cuáles están aplicadas
import db from './db.js';
import { ejecutarMigraciones, estadoMigraciones } from './migrator.js';

const comando = process.argv[2] || 'up';
try {
    if (comando === 'status') {
        for (const m of await estadoMigraciones(db)) {
            console.log(`${m.aplicada_en ? '✔' : '·'} ${m.archivo}${m.aplicada_en ? `  (${m.aplicada_en})` : '  pendiente'}`);
        }
    } else {
        const r = await ejecutarMigraciones(db);
        if (r.error) process.exitCode = 1;
    }
} finally {
    await db.end();
}
