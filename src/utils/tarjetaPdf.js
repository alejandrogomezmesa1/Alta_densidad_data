// Tarjeta de regalo lista para imprimir: PDF de 85 × 55 mm con el frente y el reverso (el diseño de la
// pieza 10_papeleria/03 del brand book). El reverso lleva el valor, el código y la fecha de vencimiento.
const C = {
  tinta: [11, 11, 12], humo: [242, 238, 230], oro: [201, 169, 97], vino: [90, 18, 32], vinoClaro: [140, 42, 58],
  hueso: [244, 241, 234], oroPalido: [230, 213, 174]
};
const FUENTES = [['CG-L', 'CG-Light.ttf'], ['CG-LI', 'CG-LightItalic.ttf'], ['J-L', 'Jost-Light.ttf'], ['J-R', 'Jost-Regular.ttf'], ['J-M', 'Jost-Medium.ttf']];

const aBase64 = (buf) => {
  let s = '';
  const b = new Uint8Array(buf);
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
};

let recursos = null;
function cargar() {
  if (!recursos) {
    recursos = Promise.all([
      ...FUENTES.map(async ([n, a]) => [n, a, aBase64(await (await fetch(`/marca/${a}`)).arrayBuffer())]),
      fetch('/marca/isotipo-oro.png').then((r) => r.blob()).then((b) => new Promise((ok) => { const f = new FileReader(); f.onload = () => ok(f.result); f.readAsDataURL(b); }))
    ]).catch((e) => { recursos = null; throw e; });
  }
  return recursos;
}

const pesos = (n) => `$${Math.round(Number(n) || 0).toLocaleString('es-CO')}`;
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
export const fechaLarga = (iso) => { const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number); return `${d} ${MESES[m - 1]} ${y}`; };

// Texto con espaciado entre letras (jsPDF lo aplica en mm)
function texto(doc, t, x, y, { fuente, tam, color, track = 0, alinear = 'left' }) {
  doc.setFont(fuente, 'normal');
  doc.setFontSize(tam);
  doc.setTextColor(...color);
  const esp = track * tam * 0.3528;
  doc.setCharSpace(esp);
  const ancho = doc.getTextWidth(t) + esp * Math.max(0, t.length - 1);
  const x0 = alinear === 'center' ? x - ancho / 2 : alinear === 'right' ? x - ancho : x;
  doc.text(t, x0, y);
  doc.setCharSpace(0);
}

/** @param {{code, value, expires, date, buyer, recipient}} t */
export async function tarjetaPdf(t) {
  const [{ jsPDF }, r] = await Promise.all([import('jspdf'), cargar()]);
  const isotipo = r[r.length - 1];
  const doc = new jsPDF({ unit: 'mm', format: [85, 55], orientation: 'landscape' });
  for (const [n, a, datos] of r.slice(0, -1)) { doc.addFileToVFS(a, datos); doc.addFont(a, n, 'normal'); }

  // ── Frente: noche con partículas de luz ──
  doc.setFillColor(...C.tinta);
  doc.rect(0, 0, 85, 55, 'F');
  let semilla = 7;
  const azar = () => { semilla = (semilla * 9301 + 49297) % 233280; return semilla / 233280; };
  doc.setFillColor(...C.oro);
  for (let i = 0; i < 26; i += 1) {
    doc.setGState(new doc.GState({ opacity: 0.15 + azar() * 0.45 }));
    doc.circle(azar() * 85, azar() * 47, 0.06 + azar() * 0.22, 'F');
  }
  doc.setGState(new doc.GState({ opacity: 1 }));
  texto(doc, 'TARJETA DE REGALO', 6, 9, { fuente: 'J-M', tam: 5.5, color: C.oro, track: 0.3 });
  texto(doc, 'Regala', 6, 29, { fuente: 'CG-L', tam: 21, color: C.humo });
  texto(doc, 'lo que permanece.', 6, 38, { fuente: 'CG-LI', tam: 21, color: C.oro });
  doc.addImage(isotipo, 'PNG', 74, 44, 7, 7);

  // ── Reverso: vino, con valor, código y vencimiento ──
  doc.addPage([85, 55], 'landscape');
  doc.setFillColor(...C.vino);
  doc.rect(0, 0, 85, 55, 'F');
  texto(doc, pesos(t.value), 42.5, 17, { fuente: 'CG-L', tam: 26, color: C.hueso, alinear: 'center' });
  const linea = t.recipient || t.buyer ? [t.recipient && `Para ${t.recipient}`, t.buyer && `de ${t.buyer}`].filter(Boolean).join(' · ') : '';
  if (linea) texto(doc, linea.slice(0, 60), 42.5, 22.5, { fuente: 'CG-LI', tam: 8, color: C.oroPalido, alinear: 'center' });
  texto(doc, 'CÓDIGO', 6, 29, { fuente: 'J-M', tam: 4.6, color: C.oroPalido, track: 0.3 });
  texto(doc, t.code, 6, 34, { fuente: 'J-M', tam: 9.5, color: C.hueso, track: 0.1 });
  texto(doc, 'VÁLIDA HASTA', 79, 29, { fuente: 'J-M', tam: 4.6, color: C.oroPalido, track: 0.3, alinear: 'right' });
  texto(doc, fechaLarga(t.expires), 79, 34, { fuente: 'J-M', tam: 9.5, color: C.hueso, alinear: 'right' });
  doc.setDrawColor(...C.vinoClaro);
  doc.setLineWidth(0.25);
  doc.line(6, 37.5, 79, 37.5);
  texto(doc, 'Un solo uso, en la tienda física. Vigencia de 6 meses desde la compra.', 6, 42, { fuente: 'J-L', tam: 5.4, color: C.oroPalido });
  texto(doc, 'Si la compra vale más, pagas la diferencia; no se devuelve en efectivo.', 6, 45.5, { fuente: 'J-L', tam: 5.4, color: C.oroPalido });
  texto(doc, 'ALTA DENSIDAD · FRAGANCIAS · MEDELLÍN', 42.5, 51, { fuente: 'J-M', tam: 4.4, color: C.oro, track: 0.3, alinear: 'center' });

  doc.save(`tarjeta-de-regalo_${t.code}.pdf`);
}
