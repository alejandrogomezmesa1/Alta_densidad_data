// Lista de precios para revendedores (PDF)
// ------------------------------------------------------------
// Tu precio (lo que le cuesta al revendedor) = precio al público − descuento, redondeado a $1.000.
// Piso: nunca por debajo de costo + margen mínimo; si el piso no deja nada por debajo del precio al
// público, el perfume sale de la lista y se reporta. Descuento y margen vienen de Configuraciones.
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { CONFIG_DEFECTO, pesos } from './inventario';

const COLORES = { hueso: [244, 241, 234], hueso2: [234, 229, 218], filete: [214, 208, 195], tinta: [11, 11, 12], oro: [154, 123, 63], gris: [107, 103, 95] };
const FUENTES = { CG: 'CG-Regular.ttf', Jost: 'Jost-Regular.ttf', 'Jost-Medium': 'Jost-Medium.ttf', 'Jost-Light': 'Jost-Light.ttf' };

const aBase64 = (buffer) => {
  let binario = '';
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.length; i += 0x8000) binario += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binario);
};

async function cargarRecursos(doc) {
  const base = `${import.meta.env.BASE_URL}lista/`;
  await Promise.all(Object.entries(FUENTES).map(async ([nombre, archivo]) => {
    const r = await fetch(base + archivo);
    doc.addFileToVFS(archivo, aBase64(await r.arrayBuffer()));
    doc.addFont(archivo, nombre, 'normal');
  }));
  const logo = await fetch(`${base}logo.png`);
  return `data:image/png;base64,${aBase64(await logo.arrayBuffer())}`;
}

const mil = (n, arriba = false) => (arriba ? Math.ceil(n / 1000) : Math.round(n / 1000)) * 1000;
const fecha = (d) => d.toLocaleDateString('es-CO', { day: '2-digit', month: '2-digit', year: 'numeric' });

/** Calcula las filas de la lista: { filas, fuera, alPiso, sinCosto } */
export function calcularLista(productos, { categorias, incluirAgotados, config }) {
  const c = { ...CONFIG_DEFECTO, ...config };
  const descuento = Number(c.revendedor_descuento) / 100;
  const margen = Number(c.revendedor_margen_minimo) / 100;
  const filas = [];
  const fuera = [];
  let alPiso = 0;
  let sinCosto = 0;
  for (const p of productos) {
    if ((p.type || 'terminado') !== 'terminado' || !categorias.includes(p.category)) continue;
    const publico = Number(p.price) || 0;
    if (publico <= 0 || (!incluirAgotados && Number(p.stock) <= 0)) continue;
    const costo = Number(p.costPrice) || 0;
    let precio = mil(publico * (1 - descuento));
    if (costo > 0) {
      const piso = mil(costo * (1 + margen), true);
      if (piso >= publico) { fuera.push({ nombre: p.name, publico, costo }); continue; }
      if (precio < piso) { precio = piso; alPiso += 1; }
    } else sinCosto += 1;
    filas.push({ nombre: p.name, categoria: p.category, precio, publico });
  }
  filas.sort((a, b) => a.categoria.localeCompare(b.categoria) || a.nombre.localeCompare(b.nombre, 'es'));
  return { filas, fuera, alPiso, sinCosto };
}

export async function generarListaRevendedores(productos, opciones) {
  const { filas, ...resto } = calcularLista(productos, opciones);
  const doc = new jsPDF({ unit: 'mm', format: 'letter' });
  const logo = await cargarRecursos(doc);
  const ancho = doc.internal.pageSize.getWidth();
  const alto = doc.internal.pageSize.getHeight();
  const margen = 18;
  const hoy = new Date();
  const vigencia = new Date(hoy.getTime() + 15 * 86400000);

  const fondo = () => { doc.setFillColor(...COLORES.hueso); doc.rect(0, 0, ancho, alto, 'F'); };
  fondo();
  doc.addImage(logo, 'PNG', margen, 14, 70, 70 * 340 / 1960);
  doc.setFont('CG', 'normal'); doc.setFontSize(28); doc.setTextColor(...COLORES.tinta);
  doc.text('Lista de precios para revendedores', margen, 44);
  doc.setFont('Jost', 'normal'); doc.setFontSize(8); doc.setTextColor(...COLORES.gris);
  const nombres = opciones.categorias.map((l) => (l === '1.1' ? 'Perfumes 1.1' : l));
  doc.text(`${nombres.join(' · ').toUpperCase()}   ·   ${fecha(hoy)}`, margen, 50, { charSpace: 0.6 });

  // Cómo leer la lista
  const nota = `Tu precio es lo que te cuesta cada perfume. Precio al público es el que sugerimos para la venta: la diferencia es tu ganancia. `
    + `Precios por unidad en pesos colombianos, sujetos a disponibilidad y vigentes hasta el ${fecha(vigencia)}.`;
  doc.setFontSize(8.4);
  const lineas = doc.splitTextToSize(nota, ancho - 2 * margen - 12);
  const altoCaja = 10 + lineas.length * 4.3;
  doc.setFillColor(...COLORES.hueso2); doc.rect(margen, 56, ancho - 2 * margen, altoCaja, 'F');
  doc.setFillColor(...COLORES.oro); doc.rect(margen, 56, 0.8, altoCaja, 'F');
  doc.setFont('Jost-Medium', 'normal'); doc.setTextColor(...COLORES.oro); doc.text('CÓMO LEER ESTA LISTA', margen + 6, 62);
  doc.setFont('Jost', 'normal'); doc.setTextColor(...COLORES.tinta); doc.text(lineas, margen + 6, 67);

  const varias = opciones.categorias.length > 1;
  autoTable(doc, {
    startY: 56 + altoCaja + 8,
    margin: { left: margen, right: margen, top: 18, bottom: 22 },
    head: [['PERFUME', ...(varias ? ['LÍNEA'] : []), 'TU PRECIO', 'AL PÚBLICO']],
    body: filas.map((f) => [f.nombre, ...(varias ? [f.categoria] : []), pesos(f.precio), pesos(f.publico)]),
    theme: 'plain',
    styles: { font: 'Jost', fontStyle: 'normal', fontSize: 8.6, textColor: COLORES.tinta, cellPadding: { top: 2.2, bottom: 2.2, left: 1, right: 1 }, lineColor: COLORES.filete, lineWidth: { bottom: 0.15 } },
    headStyles: { font: 'Jost-Medium', fontStyle: 'normal', fontSize: 6.8, textColor: COLORES.gris, lineColor: COLORES.tinta, lineWidth: { bottom: 0.4 } },
    columnStyles: {
      [varias ? 2 : 1]: { halign: 'right', font: 'Jost-Medium', fontSize: 9.6 },
      [varias ? 3 : 2]: { halign: 'right', textColor: COLORES.gris, font: 'Jost-Light' },
      ...(varias ? { 1: { textColor: COLORES.gris, font: 'Jost-Light' } } : {})
    },
    didParseCell: (d) => {
      if (d.section === 'head' && d.column.index > (varias ? 1 : 0)) d.cell.styles.halign = 'right';
    },
    willDrawPage: (d) => { if (d.pageNumber > 1) fondo(); }
  });

  const nota2 = 'Fragancias 1.1 inspiradas en los perfumes de referencia. Las marcas se mencionan solo para identificar el aroma; Alta Densidad Fragancias no está afiliada a ellas.';
  doc.setFont('Jost-Light', 'normal'); doc.setFontSize(7.2); doc.setTextColor(...COLORES.gris);
  doc.text(doc.splitTextToSize(nota2, ancho - 2 * margen), margen, Math.min(doc.lastAutoTable.finalY + 8, alto - 26));

  const paginas = doc.getNumberOfPages();
  for (let i = 1; i <= paginas; i += 1) {
    doc.setPage(i);
    doc.setDrawColor(...COLORES.filete); doc.setLineWidth(0.15); doc.line(margen, alto - 14, ancho - margen, alto - 14);
    doc.setFont('Jost', 'normal'); doc.setFontSize(7); doc.setTextColor(...COLORES.gris);
    doc.text(`WhatsApp 304 647 7694  ·  @fragancias_alta_densidad  ·  Lista para revendedores vigente hasta el ${fecha(vigencia)}`, margen, alto - 9.5);
    doc.text(String(i), ancho - margen, alto - 9.5, { align: 'right' });
  }
  const archivo = `Lista_revendedores_${hoy.toLocaleDateString('en-CA', { timeZone: 'America/Bogota' })}.pdf`;
  doc.save(archivo);
  return { archivo, total: filas.length, ...resto };
}
