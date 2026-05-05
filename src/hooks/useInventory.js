import { useState, useEffect, useCallback } from 'react';

const STORAGE_KEY = 'alta_densidad_data_v2';

export const useInventory = (notify) => {
  const [data, setData] = useState(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    const initial = {
      inventory: [],
      sales: [],
      purchases: [],
      expenses: [],
      suppliers: []
    };
    try {
      return saved ? { ...initial, ...JSON.parse(saved) } : initial;
    } catch (e) {
      console.error("Error loading data:", e);
      return initial;
    }
  });

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  }, [data]);

  // --- INVENTORY LOGIC ---
  const addProduct = useCallback((product) => {
    setData(prev => ({
      ...prev,
      inventory: [...prev.inventory, { 
        ...product, 
        id: Date.now(), 
        price: parseFloat(product.price) || 0,
        costPrice: parseFloat(product.costPrice) || 0,
        stock: parseInt(product.stock) || 0,
        createdAt: new Date().toISOString()
      }]
    }));
    notify?.('Producto añadido al inventario', 'success');
  }, [notify]);

  const updateProduct = useCallback((id, updates) => {
    setData(prev => ({
      ...prev,
      inventory: prev.inventory.map(p => p.id === id ? { 
        ...p, 
        ...updates,
        price: updates.price !== undefined ? parseFloat(updates.price) : p.price,
        costPrice: updates.costPrice !== undefined ? parseFloat(updates.costPrice) : p.costPrice,
        stock: updates.stock !== undefined ? parseInt(updates.stock) : p.stock,
      } : p)
    }));
    notify?.('Producto actualizado correctamente', 'success');
  }, [notify]);

  const deleteProduct = useCallback((id) => {
    setData(prev => ({
      ...prev,
      inventory: prev.inventory.filter(p => p.id !== id)
    }));
    notify?.('Producto eliminado', 'info');
  }, [notify]);

  // --- SALES LOGIC (UPGRADED FOR INSTALLMENTS) ---
  const addSale = useCallback((sale) => {
    const productId = parseInt(sale.productId);
    const quantity = parseInt(sale.quantity);

    setData(prev => {
      const product = prev.inventory.find(p => p.id === productId);
      if (!product) {
        notify?.('Producto no encontrado', 'error');
        return prev;
      }
      
      const availableStock = Number(product.stock) || 0;
      if (availableStock < quantity) {
        notify?.(`Stock insuficiente. Disponible: ${availableStock}`, 'error');
        return prev;
      }

      const newStock = availableStock - quantity;
      const unitPrice = parseFloat(product.price) || 0;
      const totalAmount = parseFloat(sale.total || sale.amount) || (unitPrice * quantity);
      
      // Handle Initial Payment
      const initialPayment = parseFloat(sale.initialPayment) || 0;
      const status = initialPayment >= totalAmount ? 'paid' : 'pending';
      const payments = initialPayment > 0 ? [{ id: Date.now(), amount: initialPayment, date: sale.date, method: sale.method || 'Efectivo' }] : [];

      return {
        ...prev,
        sales: [...prev.sales, { 
          ...sale, 
          productId,
          quantity,
          id: Date.now(), 
          costAtSale: parseFloat(product.costPrice) || 0,
          total: totalAmount,
          productName: product.name,
          customerName: sale.customerName || 'Cliente General',
          status,
          payments
        }],
        inventory: prev.inventory.map(p => 
          p.id === productId ? { ...p, stock: newStock } : p
        )
      };
    });
    notify?.('Venta registrada con éxito', 'success');
  }, [notify]);

  const addPaymentToSale = useCallback((saleId, payment) => {
    setData(prev => {
      const sale = prev.sales.find(s => s.id === saleId);
      if (!sale) return prev;

      const newPayments = [...(sale.payments || []), { ...payment, id: Date.now() }];
      const totalPaid = newPayments.reduce((acc, curr) => acc + parseFloat(curr.amount), 0);
      const status = totalPaid >= sale.total ? 'paid' : 'pending';

      return {
        ...prev,
        sales: prev.sales.map(s => s.id === saleId ? { ...s, payments: newPayments, status } : s)
      };
    });
    notify?.('Abono registrado correctamente', 'success');
  }, [notify]);

  const deleteSale = useCallback((saleId) => {
    setData(prev => {
      const sale = prev.sales.find(s => s.id === saleId);
      if (!sale) return prev;
      
      return {
        ...prev,
        sales: prev.sales.filter(s => s.id !== saleId),
        inventory: prev.inventory.map(p => 
          p.id === sale.productId ? { ...p, stock: Number(p.stock) + (parseInt(sale.quantity) || 0) } : p
        )
      };
    });
    notify?.('Venta eliminada y stock revertido', 'info');
  }, [notify]);

  // --- PURCHASES LOGIC ---
  const addPurchase = useCallback((purchase) => {
    const productId = Number(purchase.productId);
    const quantity = Number(purchase.quantity);
    const totalAmount = parseFloat(purchase.amount || purchase.total || 0);
    const unitPrice = parseFloat(purchase.unitPrice) || (totalAmount / (quantity || 1));
    const supplierId = purchase.supplierId ? Number(purchase.supplierId) : null;

    setData(prev => {
      const product = prev.inventory.find(p => Number(p.id) === productId);
      const supplier = prev.suppliers?.find(s => Number(s.id) === supplierId);
      
      return {
        ...prev,
        purchases: [...prev.purchases, { 
          ...purchase, 
          productId,
          supplierId,
          supplierName: supplier?.name || 'Sin Proveedor',
          quantity,
          amount: totalAmount,
          unitPrice,
          id: Date.now(),
          productName: product?.name || 'Desconocido'
        }],
        inventory: prev.inventory.map(p => 
          Number(p.id) === productId ? { ...p, stock: Number(p.stock) + quantity } : p
        )
      };
    });
    notify?.('Compra registrada. Stock incrementado', 'success');
  }, [notify]);

  const deletePurchase = useCallback((purchaseId) => {
    setData(prev => {
      const purchase = prev.purchases.find(p => p.id === purchaseId);
      if (!purchase) return prev;
      
      return {
        ...prev,
        purchases: prev.purchases.filter(p => p.id !== purchaseId),
        inventory: prev.inventory.map(p => 
          p.id === purchase.productId ? { ...p, stock: Math.max(0, Number(p.stock) - (parseInt(purchase.quantity) || 0)) } : p
        )
      };
    });
    notify?.('Compra eliminada y stock ajustado', 'info');
  }, [notify]);

  // --- EXPENSES LOGIC ---
  const addExpense = useCallback((expense) => {
    const amount = parseFloat(expense.amount) || 0;
    setData(prev => ({
      ...prev,
      expenses: [...prev.expenses, { ...expense, amount, id: Date.now() }]
    }));
    notify?.('Gasto operativo registrado', 'success');
  }, [notify]);

  const deleteExpense = useCallback((expenseId) => {
    setData(prev => ({
      ...prev,
      expenses: prev.expenses.filter(e => e.id !== expenseId)
    }));
    notify?.('Gasto eliminado', 'info');
  }, [notify]);

  // --- SUPPLIERS LOGIC ---
  const addSupplier = useCallback((supplier) => {
    setData(prev => ({
      ...prev,
      suppliers: [...(prev.suppliers || []), { 
        ...supplier, 
        id: Date.now(),
        createdAt: new Date().toISOString()
      }]
    }));
    notify?.('Proveedor añadido correctamente', 'success');
  }, [notify]);

  const updateSupplier = useCallback((id, updates) => {
    setData(prev => ({
      ...prev,
      suppliers: (prev.suppliers || []).map(s => s.id === id ? { ...s, ...updates } : s)
    }));
    notify?.('Proveedor actualizado', 'success');
  }, [notify]);

  const deleteSupplier = useCallback((id) => {
    setData(prev => ({
      ...prev,
      suppliers: (prev.suppliers || []).filter(s => s.id !== id)
    }));
    notify?.('Proveedor eliminado', 'info');
  }, [notify]);

  const getMostFrequentSupplierId = useCallback(() => {
    if (!data.purchases || data.purchases.length === 0) return null;
    
    const counts = {};
    let maxCount = 0;
    let mostFrequentId = null;

    data.purchases.forEach(p => {
      if (p.supplierId) {
        counts[p.supplierId] = (counts[p.supplierId] || 0) + 1;
        if (counts[p.supplierId] > maxCount) {
          maxCount = counts[p.supplierId];
          mostFrequentId = p.supplierId;
        }
      }
    });

    return mostFrequentId;
  }, [data.purchases]);

  // --- SYSTEM LOGIC ---
  const clearAllData = useCallback(() => {
    setData({ inventory: [], sales: [], purchases: [], expenses: [] });
    notify?.('Sistema reiniciado. Todos los datos borrados.', 'warning');
  }, [notify]);

  const exportData = useCallback(() => {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `backup_alta_densidad_${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    notify?.('Copia de seguridad descargada', 'success');
  }, [data, notify]);

  return {
    ...data,
    addProduct,
    updateProduct,
    deleteProduct,
    addSale,
    addPaymentToSale,
    deleteSale,
    addPurchase,
    deletePurchase,
    addExpense,
    deleteExpense,
    addSupplier,
    updateSupplier,
    deleteSupplier,
    getMostFrequentSupplierId,
    clearAllData,
    exportData
  };
};
