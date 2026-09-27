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
