import { useState, useEffect, useCallback } from 'react';
import { api } from '../services/api';

export const useInventory = (notify) => {
  const [data, setData] = useState({
    inventory: [],
    sales: [],
    purchases: [],
    expenses: [],
    suppliers: [],
    customers: []
  });
  const [isDemo, setIsDemo] = useState(api.getDemoMode());

  const fetchData = useCallback(async () => {
    try {
      const [inventory, sales, purchases, expenses, suppliers, customers] = await Promise.all([
        api.get('/products'),
        api.get('/sales'),
        api.get('/purchases'),
        api.get('/expenses'),
        api.get('/suppliers'),
        api.get('/customers')
      ]);

      setData({ 
        inventory: Array.isArray(inventory) ? inventory : [], 
        sales: Array.isArray(sales) ? sales : [], 
        purchases: Array.isArray(purchases) ? purchases : [], 
        expenses: Array.isArray(expenses) ? expenses : [], 
        suppliers: Array.isArray(suppliers) ? suppliers : [],
        customers: Array.isArray(customers) ? customers : []
      });
      setIsDemo(api.getDemoMode());
    } catch (error) {
      console.error("Error fetching data:", error);
      if (!api.getDemoMode()) {
        notify?.('Error de conexión. Cambiando a Modo Demo (Local).', 'warning');
        api.setDemoMode(true);
        setIsDemo(true);
        fetchData(); // Retry in demo mode
      } else {
        notify?.('Error al cargar datos locales', 'error');
      }
    }
  }, [notify]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const toggleDemoMode = useCallback((enabled) => {
    api.setDemoMode(enabled);
    setIsDemo(enabled);
    fetchData();
    notify?.(enabled ? 'Modo Demo Activado' : 'Modo Demo Desactivado', 'info');
  }, [fetchData, notify]);

  // --- INVENTORY LOGIC ---
  const addProduct = useCallback(async (product) => {
    try {
      await api.post('/products', product);
      fetchData();
      notify?.('Producto añadido al inventario', 'success');
    } catch (error) { notify?.('Error al añadir producto', 'error'); }
  }, [fetchData, notify]);

  const updateProduct = useCallback(async (id, updates) => {
    try {
      await api.put(`/products/${id}`, updates);
      fetchData();
      notify?.('Producto actualizado correctamente', 'success');
    } catch (error) { notify?.('Error al actualizar producto', 'error'); }
  }, [fetchData, notify]);

  const deleteProduct = useCallback(async (id) => {
    try {
      await api.delete(`/products/${id}`);
      fetchData();
      notify?.('Producto eliminado', 'info');
    } catch (error) { notify?.('Error al eliminar producto', 'error'); }
  }, [fetchData, notify]);

  // --- SALES LOGIC ---
  const addSale = useCallback(async (sale) => {
    try {
      await api.post('/sales', sale);
      fetchData();
      notify?.('Venta registrada con éxito', 'success');
    } catch (error) { notify?.('Error al registrar venta', 'error'); }
  }, [fetchData, notify]);

  const addPaymentToSale = useCallback(async (saleId, payment) => {
    try {
      await api.post(`/sales/${saleId}/payments`, payment);
      fetchData();
      notify?.('Abono registrado correctamente', 'success');
    } catch (error) { notify?.('Error al registrar abono', 'error'); }
  }, [fetchData, notify]);

  const updateSale = useCallback(async (id, sale) => {
    try {
      await api.put(`/sales/${id}`, sale);
      fetchData();
      notify?.('Venta actualizada correctamente', 'success');
    } catch (error) { notify?.(error.message || 'Error al actualizar', 'error'); }
  }, [fetchData, notify]);

  const deleteSale = useCallback(async (saleId) => {
    try {
      await api.delete(`/sales/${saleId}`);
      fetchData();
      notify?.('Venta eliminada y stock revertido', 'info');
    } catch (error) { notify?.('Error al eliminar venta', 'error'); }
  }, [fetchData, notify]);

  // --- PURCHASES LOGIC ---
  const addPurchase = useCallback(async (purchase) => {
    try {
      const totalAmount = parseFloat(purchase.amount || purchase.total || 0);
      const quantity = parseInt(purchase.quantity);
      const unitPrice = parseFloat(purchase.unitPrice) || (totalAmount / (quantity || 1));

      await api.post('/purchases', { ...purchase, amount: totalAmount, unitPrice });
      fetchData();
      notify?.('Compra registrada. Stock incrementado', 'success');
    } catch (error) { notify?.('Error al registrar compra', 'error'); }
  }, [fetchData, notify]);

  const updatePurchase = useCallback(async (id, purchase) => {
    try {
      const totalAmount = parseFloat(purchase.amount || purchase.total || 0);
      const quantity = parseInt(purchase.quantity);
      const unitPrice = parseFloat(purchase.unitPrice) || (totalAmount / (quantity || 1));

      await api.put(`/purchases/${id}`, { ...purchase, amount: totalAmount, unitPrice });
      fetchData();
      notify?.('Compra actualizada correctamente', 'success');
    } catch (error) { notify?.(error.message || 'Error al actualizar', 'error'); }
  }, [fetchData, notify]);

  const deletePurchase = useCallback(async (purchaseId) => {
    try {
      await api.delete(`/purchases/${purchaseId}`);
      fetchData();
      notify?.('Compra eliminada y stock ajustado', 'info');
    } catch (error) { notify?.('Error al eliminar compra', 'error'); }
  }, [fetchData, notify]);

  // --- EXPENSES LOGIC ---
  const addExpense = useCallback(async (expense) => {
    try {
      await api.post('/expenses', expense);
      fetchData();
      notify?.('Gasto operativo registrado', 'success');
    } catch (error) { notify?.('Error al registrar gasto', 'error'); }
  }, [fetchData, notify]);

  const updateExpense = useCallback(async (id, expense) => {
    try {
      await api.put(`/expenses/${id}`, expense);
      fetchData();
      notify?.('Gasto actualizado', 'success');
    } catch (error) { notify?.(error.message || 'Error', 'error'); }
  }, [fetchData, notify]);

  const deleteExpense = useCallback(async (expenseId) => {
    try {
      await api.delete(`/expenses/${expenseId}`);
      fetchData();
      notify?.('Gasto eliminado', 'info');
    } catch (error) { notify?.('Error al eliminar gasto', 'error'); }
  }, [fetchData, notify]);

  // --- SUPPLIERS LOGIC ---
  const addSupplier = useCallback(async (supplier) => {
    try {
      await api.post('/suppliers', supplier);
      fetchData();
      notify?.('Proveedor añadido correctamente', 'success');
    } catch (error) { notify?.('Error al añadir proveedor', 'error'); }
  }, [fetchData, notify]);

  const updateSupplier = useCallback(async (id, updates) => {
    try {
      await api.put(`/suppliers/${id}`, updates);
      fetchData();
      notify?.('Proveedor actualizado', 'success');
    } catch (error) { notify?.('Error al actualizar proveedor', 'error'); }
  }, [fetchData, notify]);

  const deleteSupplier = useCallback(async (id) => {
    try {
      await api.delete(`/suppliers/${id}`);
      fetchData();
      notify?.('Proveedor eliminado', 'info');
    } catch (error) { notify?.('Error al eliminar proveedor', 'error'); }
  }, [fetchData, notify]);

  const getMostFrequentSupplierId = useCallback(() => {
    if (!data.purchases || !Array.isArray(data.purchases) || data.purchases.length === 0) return null;
    const counts = {};
    let maxCount = 0;
    let mostFrequentId = null;

    data.purchases.forEach(p => {
      if (p && p.supplierId) {
        counts[p.supplierId] = (counts[p.supplierId] || 0) + 1;
        if (counts[p.supplierId] > maxCount) {
          maxCount = counts[p.supplierId];
          mostFrequentId = p.supplierId;
        }
      }
    });
    return mostFrequentId;
  }, [data.purchases]);

  const updateCustomer = useCallback(async (id, updates) => {
    try {
      await api.put(`/customers/${id}`, updates);
      fetchData();
      notify?.('Datos del cliente actualizados', 'success');
    } catch (error) { notify?.('Error al actualizar cliente', 'error'); }
  }, [fetchData, notify]);

  const deleteCustomer = useCallback(async (id) => {
    try {
      await api.delete(`/customers/${id}`);
      fetchData();
      notify?.('Cliente eliminado del sistema', 'success');
    } catch (error) { notify?.('Error al eliminar cliente', 'error'); }
  }, [fetchData, notify]);

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
    isDemo,
    toggleDemoMode,
    addProduct,
    updateProduct,
    deleteProduct,
    addSale,
    updateSale,
    addPaymentToSale,
    deleteSale,
    addPurchase,
    updatePurchase,
    deletePurchase,
    addExpense,
    updateExpense,
    deleteExpense,
    addSupplier,
    updateSupplier,
    deleteSupplier,
    updateCustomer,
    deleteCustomer,
    getMostFrequentSupplierId,
    exportData,
    fetchData
  };
};
