// Utilidades de inventario compartidas por las pantallas

export const TIPOS_INVENTARIO = {
  terminado: 'Producto terminado',
  esencia: 'Esencia',
  base: 'Base alcohólica',
  feromona: 'Feromonas',
  envase: 'Envase',
  accesorio: 'Accesorio'
};

// Cantidad con su unidad: 499,4 ml · 3
export const formatoCantidad = (valor, unidad) =>
  `${Number(valor).toLocaleString('es-CO', { maximumFractionDigits: 2 })}${unidad === 'ml' ? ' ml' : ''}`;

// ── Semáforo de stock (módulo Configuraciones) ──
// Rojo = agotado (0 o menos) · Amarillo = advertencia (en el límite o por debajo) · Verde = disponible.
// El límite es el stock mínimo del ítem si lo tiene; si no, el de Configuraciones según su unidad.
export const CONFIG_DEFECTO = { stock_advertencia_und: 1, stock_advertencia_ml: 30 };

export const NIVELES_STOCK = {
  agotado: { etiqueta: 'Agotado', color: 'var(--error)' },
  advertencia: { etiqueta: 'Advertencia', color: 'var(--warning)' },
  disponible: { etiqueta: 'Disponible', color: 'var(--success)' }
};

export const limiteAdvertencia = (p, config = CONFIG_DEFECTO) => {
  if (Number(p?.minStock) > 0) return Number(p.minStock);
  const c = { ...CONFIG_DEFECTO, ...config };
  return p?.unit === 'ml' ? Number(c.stock_advertencia_ml) : Number(c.stock_advertencia_und);
};

export const nivelStock = (p, config) => {
  const stock = Number(p?.stock) || 0;
  if (stock <= 0) return 'agotado';
  return stock <= limiteAdvertencia(p, config) ? 'advertencia' : 'disponible';
};

// Búsqueda sin tildes ni mayúsculas: «aventús» encuentra «Aventus»
export const normalizar = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
export const coincide = (texto, consulta) => {
  const palabras = normalizar(consulta).split(/\s+/).filter(Boolean);
  const base = normalizar(texto);
  return palabras.every((p) => base.includes(p));
};

export const pesos = (v) => `${Number(v) < 0 ? '-' : ''}$${Math.abs(Math.round(Number(v) || 0)).toLocaleString('es-CO')}`;
export const hoyBogota = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });
