// ============================================================
// Clasifica las esencias del inventario en árabe / tradicional por su marca (la que va entre
// paréntesis en el nombre) o por nombre cuando no la tiene. Solo toca las que están sin clasificar.
// Las que no se pueden deducir se listan para revisarlas a mano.
//   DATA_DB_URL=mysql://… node tools/clasificar_esencias.js            → solo muestra
//   DATA_DB_URL=mysql://… node tools/clasificar_esencias.js --aplicar  → guarda
// ============================================================
import mysql from 'mysql2/promise';

const APLICAR = process.argv.includes('--aplicar');
// Marcas: la misma categoría que tienen en la tienda (Árabe / Diseñador)
const ARABES = ['afnan', 'al haramain', 'armaf', 'bharara', 'dumont', 'french avenue', 'lattafa', 'montale', 'orientica', 'paris corner', 'rasasi', 'ahli'];
const TRADICIONALES = ['amouage', 'ariana grande', 'bond no. 9', 'burberry', 'bvlgari', 'calvin klein', 'carolina herrera', 'chanel', 'creed', 'dior',
    'dolce & gabbana', 'giorgio armani', 'hugo boss', 'jean paul gaultier', 'katy perry', 'lacoste', 'le labo', 'louis vuitton', 'montblanc', 'moschino',
    'paco rabanne', 'perry ellis', 'valentino', 'versace', "victoria's secret", 'victorinox', 'yves saint laurent'];
// Sin marca en el nombre: perfumes conocidos
const POR_NOMBRE = {
    'amber gold': 'arabe', 'berry on top': 'arabe', 'bharara king': 'arabe', 'bharara niche': 'arabe', 'bharara rose': 'arabe',
    'island bliss': 'arabe', 'mallow madness': 'arabe', 'bleu de chanel': 'tradicional', 'miss dior': 'tradicional', 'lacoste roja': 'tradicional'
};

const conn = await mysql.createConnection({ uri: process.env.DATA_DB_URL });
try {
    const [filas] = await conn.query("SELECT id, nombre, clase_esencia FROM inventario WHERE tipo = 'esencia' AND activo = 1 ORDER BY nombre");
    const plan = []; const dudas = [];
    for (const f of filas) {
        if (f.clase_esencia) continue;
        const m = /\(([^)]+)\)\s*$/.exec(f.nombre);
        const marca = m ? m[1].trim().toLowerCase() : null;
        const base = f.nombre.replace(/^Esencia\s+/i, '').replace(/\s*\([^)]*\)\s*$/, '').trim().toLowerCase();
        const clase = marca ? (ARABES.includes(marca) ? 'arabe' : TRADICIONALES.includes(marca) ? 'tradicional' : null) : POR_NOMBRE[base] || null;
        (clase ? plan : dudas).push({ ...f, clase });
    }
    console.log(`${APLICAR ? 'APLICANDO' : 'SIMULACIÓN'} · ${filas.length} esencias · ya clasificadas: ${filas.filter((f) => f.clase_esencia).length}`);
    console.log(`Árabes: ${plan.filter((p) => p.clase === 'arabe').length} · Tradicionales: ${plan.filter((p) => p.clase === 'tradicional').length}`);
    console.log(`Sin deducir (${dudas.length}):`, dudas.map((d) => `#${d.id} ${d.nombre}`).join(' | ') || '—');
    if (APLICAR) {
        await conn.beginTransaction();
        for (const p of plan) await conn.query('UPDATE inventario SET clase_esencia = ? WHERE id = ? AND clase_esencia IS NULL', [p.clase, p.id]);
        await conn.commit();
        console.log('Listo.');
    }
} catch (err) {
    await conn.rollback().catch(() => {});
    console.error('✘', err.message);
    process.exitCode = 1;
} finally {
    await conn.end();
}
