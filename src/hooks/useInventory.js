import { useState, useEffect, useCallback } from 'react';

const API_URL = 'http://localhost:5000/api';

export const useInventory = (notify) => {
  const [data, setData] = useState({
    inventory: [],
    sales: [],
    purchases: [],
    expenses: [],
    suppliers: []
  });

  const fetchData = useCallback(async () => {
    try {
      const [inventory, sales, purchases, expenses, suppliers] = await Promise.all([
        fetch(`${API_URL}/products`).then(res => res.json()),
        fetch(`${API_URL}/sales`).then(res => res.json()),
        fetch(`${API_URL}/purchases`).then(res => res.json()),
        fetch(`${API_URL}/expenses`).then(res => res.json()),
        fetch(`${API_URL}/suppliers`).then(res => res.json())
      ]);

      setData({ inventory, sales, purchases, expenses, suppliers });
    } catch (error) {
      console.error("Error fetching data:", error);
      notify?.('Error al conectar con el servidor', 'error');
    }
  }, [notify]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // --- INVENTORY LOGIC ---
  const addProduct = useCallback(async (product) => {
    try {
      const response = await fetch(`${API_URL}/products`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(product)
      });
      if (response.ok) {
        fetchData();
        notify?.('Producto añadido al inventario', 'success');
      }
    } catch (error) {
      notify?.('Error al añadir producto', 'error');
    }
  }, [fetchData, notify]);

  const updateProduct = useCallback(async (id, updates) => {
    try {
      const response = await fetch(`${API_URL}/products/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates)
      });
      if (response.ok) {
        fetchData();
        notify?.('Producto actualizado correctamente', 'success');
      }
    } catch (error) {
      notify?.('Error al actualizar producto', 'error');
    }
  }, [fetchData, notify]);

  const deleteProduct = useCallback(async (id) => {
    try {
      const response = await fetch(`${API_URL}/products/${id}`, { method: 'DELETE' });
      if (response.ok) {
        fetchData();
        notify?.('Producto eliminado', 'info');
      }
    } catch (error) {
      notify?.('Error al eliminar producto', 'error');
    }
  }, [fetchData, notify]);

  // --- SALES LOGIC ---
  const addSale = useCallback(async (sale) => {
    try {
      const product = data.inventory.find(p => p.id === parseInt(sale.productId));
      if (!product) {
        notify?.('Producto no encontrado', 'error');
        return;
      }
      
      if (product.stock < parseInt(sale.quantity)) {
        notify?.(`Stock insuficiente. Disponible: ${product.stock}`, 'error');
        return;
      }

      const totalAmount = parseFloat(sale.total || sale.amount) || (parseFloat(product.price) * parseInt(sale.quantity));
      const initialPayment = parseFloat(sale.initialPayment) || 0;
      const status = initialPayment >= totalAmount ? 'paid' : 'pending';

      const response = await fetch(`${API_URL}/sales`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...sale,
          total: totalAmount,
          costAtSale: product.costPrice,
          status,
          initialPayment
        })
      });

      if (response.ok) {
        fetchData();
        notify?.('Venta registrada con éxito', 'success');
      }
    } catch (error) {
      notify?.('Error al registrar venta', 'error');
    }
  }, [data.inventory, fetchData, notify]);

  const addPaymentToSale = useCallback(async (saleId, payment) => {
    try {
      const response = await fetch(`${API_URL}/sales/${saleId}/payments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payment)
      });
      if (response.ok) {
        fetchData();
        notify?.('Abono registrado correctamente', 'success');
      }
    } catch (error) {
      notify?.('Error al registrar abono', 'error');
    }
  }, [fetchData, notify]);

  const deleteSale = useCallback(async (saleId) => {
    try {
      const response = await fetch(`${API_URL}/sales/${saleId}`, { method: 'DELETE' });
      if (response.ok) {
        fetchData();
        notify?.('Venta eliminada y stock revertido', 'info');
      }
    } catch (error) {
      notify?.('Error al eliminar venta', 'error');
    }
  }, [fetchData, notify]);

  // --- PURCHASES LOGIC ---
  const addPurchase = useCallback(async (purchase) => {
    try {
      const totalAmount = parseFloat(purchase.amount || purchase.total || 0);
      const quantity = parseInt(purchase.quantity);
      const unitPrice = parseFloat(purchase.unitPrice) || (totalAmount / (quantity || 1));

      const response = await fetch(`${API_URL}/purchases`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...purchase,
          amount: totalAmount,
          unitPrice
        })
      });

      if (response.ok) {
        fetchData();
        notify?.('Compra registrada. Stock incrementado', 'success');
      }
    } catch (error) {
      notify?.('Error al registrar compra', 'error');
    }
  }, [fetchData, notify]);

  const deletePurchase = useCallback(async (purchaseId) => {
    try {
      const response = await fetch(`${API_URL}/purchases/${purchaseId}`, { method: 'DELETE' });
      if (response.ok) {
        fetchData();
        notify?.('Compra eliminada y stock ajustado', 'info');
      }
    } catch (error) {
      notify?.('Error al eliminar compra', 'error');
    }
  }, [fetchData, notify]);

  // --- EXPENSES LOGIC ---
  const addExpense = useCallback(async (expense) => {
    try {
      const response = await fetch(`${API_URL}/expenses`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(expense)
      });
      if (response.ok) {
        fetchData();
        notify?.('Gasto operativo registrado', 'success');
      }
    } catch (error) {
      notify?.('Error al registrar gasto', 'error');
    }
  }, [fetchData, notify]);

  const deleteExpense = useCallback(async (expenseId) => {
    try {
      const response = await fetch(`${API_URL}/expenses/${expenseId}`, { method: 'DELETE' });
      if (response.ok) {
        fetchData();
        notify?.('Gasto eliminado', 'info');
      }
    } catch (error) {
      notify?.('Error al eliminar gasto', 'error');
    }
  }, [fetchData, notify]);

  // --- SUPPLIERS LOGIC ---
  const addSupplier = useCallback(async (supplier) => {
    try {
      const response = await fetch(`${API_URL}/suppliers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(supplier)
      });
      if (response.ok) {
        fetchData();
        notify?.('Proveedor añadido correctamente', 'success');
      }
    } catch (error) {
      notify?.('Error al añadir proveedor', 'error');
    }
  }, [fetchData, notify]);

  const updateSupplier = useCallback(async (id, updates) => {
    try {
      const response = await fetch(`${API_URL}/suppliers/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates)
      });
      if (response.ok) {
        fetchData();
        notify?.('Proveedor actualizado', 'success');
      }
    } catch (error) {
      notify?.('Error al actualizar proveedor', 'error');
    }
  }, [fetchData, notify]);

  const deleteSupplier = useCallback(async (id) => {
    try {
      const response = await fetch(`${API_URL}/suppliers/${id}`, { method: 'DELETE' });
      if (response.ok) {
        fetchData();
        notify?.('Proveedor eliminado', 'info');
      }
    } catch (error) {
      notify?.('Error al eliminar proveedor', 'error');
    }
  }, [fetchData, notify]);

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
    exportData,
    fetchData
  };
};
