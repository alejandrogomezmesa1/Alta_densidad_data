// ============================================================
// Recorrido del panel en Chrome (las 4 pantallas del día a día y sus flujos por la interfaz)
// ------------------------------------------------------------
// Complementa flujos.mjs: mismo backend de prueba (:5099 sobre una base *_test) y el panel con
//   VITE_API_URL=http://localhost:5099/api npx vite --port 5199
// Requiere puppeteer-core (no es dependencia del proyecto: npm i --no-save puppeteer-core) y Chrome.
//   node backend/tests/recorrido-panel.mjs      → capturas en $CAPTURAS (por defecto /tmp/ad-capturas)
// ============================================================
import fs from 'fs';
import puppeteer from 'puppeteer-core';

const OUT = (process.env.CAPTURAS || '/tmp/ad-capturas').replace(/\/?$/, '/');
fs.mkdirSync(OUT, { recursive: true });
const PANEL = process.env.FLUJOS_PANEL || 'http://localhost:5199';
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const login = await (await fetch('http://localhost:5099/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'prueba', password: 'prueba123' }) })).json();

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-first-run'] });
const errores = [];
const pasos = [];
const ok = (n, c, d = '') => { pasos.push(`${c ? 'OK   ' : 'FALLA'} ${n}${d ? ' — ' + d : ''}`); };

async function pagina(ancho, alto) {
    const p = await browser.newPage();
    await p.setViewport({ width: ancho, height: alto });
    p.on('console', (m) => { if (m.type() === 'error') errores.push(m.text()); });
    p.on('pageerror', (e) => errores.push(String(e)));
    await p.goto(PANEL);
    await p.evaluate((t) => { localStorage.setItem('alta_token', t); localStorage.setItem('alta_user', 'prueba'); }, login.token);
    await p.goto(PANEL, { waitUntil: 'networkidle0' });
    return p;
}
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
async function ir(p, etiqueta) {
    // En celular el menú es un panel deslizable: se abre con ☰ (en escritorio ☰ lo pliega, no hace falta)
    if (await p.evaluate(() => window.innerWidth <= 1024)) { await p.click('.top-toggle'); await esperar(400); }
    await p.evaluate((t) => [...document.querySelectorAll('.side-item')].find((b) => b.textContent.trim() === t)?.click(), etiqueta);
    await esperar(900);
}
const clicTexto = (p, sel, texto) => p.evaluate((s, t) => { const b = [...document.querySelectorAll(s)].find((x) => x.textContent.includes(t)); b?.click(); return !!b; }, sel, texto);
const texto = (p) => p.evaluate(() => document.body.innerText);

// ---- Escritorio ----
const p = await pagina(1440, 900);
for (const [t, f] of [['Vender', 'vender'], ['Recibir mercancía', 'recibir'], ['Caja', 'caja'], ['Consultar existencias', 'consultar']]) {
    await ir(p, t);
    await p.screenshot({ path: `${OUT}${f}.png` });
}

// Venta por la UI: buscar, Enter, efectivo con cambio, cobrar
await ir(p, 'Vender');
await p.type('.buscador-grande', 'santal');
await esperar(200);
await p.keyboard.press('Enter');
await esperar(300);
const enCarrito = (await texto(p)).includes('Santal 33');
ok('buscar «santal» y Enter agrega Santal 33', enCarrito);
await p.evaluate(() => { const l = [...document.querySelectorAll('label')].find((x) => x.textContent.includes('Recibe')); l?.querySelector('input')?.focus(); });
await p.keyboard.type('100000');
await esperar(200);
ok('muestra el cambio', (await texto(p)).includes('Cambio: $25.000'));
await p.screenshot({ path: `${OUT}vender_carrito.png` });
await clicTexto(p, 'button.btn-primary', 'Cobrar');
await esperar(1200);
const t1 = await texto(p);
ok('cobrar registra la venta y muestra el cambio', /Venta #\d+ · Consumidor final/.test(t1) && t1.includes('Cambio: $25.000'));
await p.screenshot({ path: `${OUT}vender_ok.png` });

// Fiado sin cliente: el botón queda bloqueado con la razón
await p.type('.buscador-grande', 'santal');
await p.keyboard.press('Enter');
await clicTexto(p, 'button.chip', 'Abona / fiado');
await esperar(200);
ok('fiado sin cliente se bloquea con la razón', (await texto(p)).includes('A crédito necesita el nombre del cliente'));

// Caja: la venta aparece, cerrar con arqueo
await ir(p, 'Caja');
const t2 = await texto(p);
ok('la caja muestra el cobro en efectivo', t2.includes('Pago de la venta'));
await clicTexto(p, 'button.btn-primary', 'Cerrar caja');
await esperar(500);
await p.keyboard.type('1000');
await esperar(200);
ok('el cierre calcula la diferencia en vivo', /Faltan|Sobran|Cuadra/.test(await texto(p)));
await p.screenshot({ path: `${OUT}caja_cierre.png` });
await clicTexto(p, 'button.btn-primary', 'Confirmar cierre');
await esperar(1200);
ok('el cierre queda en el historial', (await texto(p)).includes('Faltan') || (await texto(p)).includes('Sobran'));
await p.screenshot({ path: `${OUT}caja_despues.png` });

// Recibir: factura con una línea
await ir(p, 'Recibir mercancía');
await p.type('.buscador-grande', 'santal');
await esperar(300);
await p.keyboard.press('Enter');
await esperar(300);
await p.focus('input[aria-label="Cantidad"]');
await p.keyboard.type('2');
await esperar(200);
await p.screenshot({ path: `${OUT}recibir_linea.png` });
await clicTexto(p, 'button.btn-primary', 'Registrar ingreso');
await esperar(1200);
ok('registrar ingreso aparece en Últimos ingresos', (await texto(p)).includes('1 producto(s)'));

// Conteo
await clicTexto(p, 'button.chip', 'Conteo físico');
await esperar(500);
await p.screenshot({ path: `${OUT}conteo.png` });

// Consultar: buscar y abrir kárdex
await ir(p, 'Consultar existencias');
await p.type('.buscador-grande', 'santal');
await esperar(300);
await clicTexto(p, 'button.fila-item', 'Santal 33');
await esperar(800);
ok('consultar abre el historial del ítem', /Venta|Compra/.test(await texto(p)));
await p.screenshot({ path: `${OUT}consultar_kardex.png` });

// ---- Celular ----
const m = await pagina(390, 844);
for (const [t, f] of [['Vender', 'm_vender'], ['Caja', 'm_caja'], ['Consultar existencias', 'm_consultar'], ['Recibir mercancía', 'm_recibir']]) {
    await ir(m, t);
    const ancho = await m.evaluate(() => document.documentElement.scrollWidth);
    ok(`celular: ${t} sin scroll horizontal`, ancho <= 390, `ancho ${ancho}`);
    await m.screenshot({ path: `${OUT}${f}.png`, fullPage: false });
}

await ir(m, 'Vender');
await m.evaluate(() => document.querySelector('button.fila-item:not(:disabled)')?.click());
await esperar(400);
ok('celular: al agregar aparece la barra de la venta', await m.evaluate(() => !!document.querySelector('.barra-venta') && getComputedStyle(document.querySelector('.barra-venta')).display !== 'none'));
await m.screenshot({ path: `${OUT}m_vender_barra.png` });
await m.evaluate(() => document.querySelector('.barra-venta')?.click());
await esperar(900);
await m.screenshot({ path: `${OUT}m_vender_venta.png` });
console.log(pasos.join('\n'));
console.log(errores.length ? `\nErrores de consola:\n${[...new Set(errores)].join('\n')}` : '\nSin errores de consola');
await browser.close();
process.exit(pasos.some((p) => p.startsWith('FALLA')) ? 1 : 0);
