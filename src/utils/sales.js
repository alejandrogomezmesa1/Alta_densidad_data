// Cálculos de pagos y saldos compartidos por todas las pantallas.
// Algunas ventas antiguas quedaron marcadas como pagadas sin registros en `pagos`:
// se tratan como pagadas por su total en la fecha de la venta, para que no aparezcan
// como deuda en Cartera ni en el Dashboard.

export const toNumber = (v) => Number.parseFloat(v) || 0;

export const getPayments = (sale) => {
  const payments = Array.isArray(sale?.payments) ? sale.payments : [];
  if (payments.length === 0 && sale?.status === 'paid') {
    return [{ amount: toNumber(sale.total), date: sale.date, method: sale.method, synthetic: true }];
  }
  return payments;
};

export const paidAmount = (sale) => getPayments(sale).reduce((acc, p) => acc + toNumber(p.amount), 0);

export const balanceOf = (sale) => Math.max(0, toNumber(sale?.total) - paidAmount(sale));

// Nombre legible de una venta a partir de sus líneas (incluye líneas sin producto, como el envío web)
export const saleProductNames = (sale) => {
  if (Array.isArray(sale?.items) && sale.items.length) {
    return sale.items.map(i => i.productName).filter(Boolean).join(', ');
  }
  return sale?.productName || '';
};
