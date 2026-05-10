import React, { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Wallet, ArrowDownCircle, ArrowUpCircle, Calculator, CheckCircle, Save, History, DollarSign, Trash2, X } from 'lucide-react';
import { api } from '../services/api';

const CashRegister = ({ sales, purchases, expenses, notify, confirm }) => {
  const [closingHistory, setClosingHistory] = useState([]);
  const [selectedHistory, setSelectedHistory] = useState(null);
  const [closedIds, setClosedIds] = useState(() => {
    try {
      const stored = localStorage.getItem('alta_densidad_closed_ids');
      return stored ? JSON.parse(stored) : { payment: 0, expense: 0, purchase: 0 };
    } catch {
      return { payment: 0, expense: 0, purchase: 0 };
    }
  });

  const fetchData = React.useCallback(async () => {
    try {
      const data = await api.get('/cash-closings');
      setClosingHistory(data.map(h => {
        let movements = [];
        try {
          movements = h.notes ? JSON.parse(h.notes) : [];
        } catch (e) {
          console.error("Error parsing movements JSON:", e);
        }
        return {
          ...h,
          movements
        };
      }));
    } catch (error) {
      console.error("Error fetching cash closings:", error);
    }
  }, []);

  React.useEffect(() => {
    fetchData();
  }, [fetchData]);

  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });

  const dailyStats = useMemo(() => {
    // Safely handle inputs
    const salesArr = Array.isArray(sales) ? sales : [];
    const expensesArr = Array.isArray(expenses) ? expenses : [];
    const purchasesArr = Array.isArray(purchases) ? purchases : [];

    // Only count transactions AFTER the last closing
    const activeExpenses = expensesArr.filter(e => {
      const eDate = e.date ? e.date.split(/T| /)[0] : '';
      return eDate === today && e.id > closedIds.expense;
    });
    const totalExpenses = activeExpenses.reduce((acc, e) => acc + (parseFloat(e.amount) || 0), 0);

    const activePurchases = purchasesArr.filter(p => {
      const pDate = p.date ? p.date.split(/T| /)[0] : (p.fecha ? p.fecha.split(/T| /)[0] : '');
      return pDate === today && p.id > closedIds.purchase;
    });
    const totalPurchases = activePurchases.reduce((acc, p) => acc + (parseFloat(p.total) || parseFloat(p.amount) || 0), 0);
    
    // CASH IN: All payments made today, even from old sales
    let cashSales = 0;
    const movements = [];
    let currentMaxPaymentId = closedIds.payment;

    salesArr.forEach(s => {
      const paymentsThisSession = (s.payments || []).filter(p => p.id > closedIds.payment);
      if (paymentsThisSession.length > 0) {
        const paidThisSession = paymentsThisSession.reduce((acc, curr) => acc + (parseFloat(curr.amount) || 0), 0);
        cashSales += paidThisSession;
        
        paymentsThisSession.forEach(p => {
            if (p.id > currentMaxPaymentId) currentMaxPaymentId = p.id;
        });

        const totalPaidAllTime = (s.payments || []).reduce((acc, curr) => acc + (parseFloat(curr.amount) || 0), 0);
        const totalAmount = parseFloat(s.total) || 0;
        const balance = totalAmount - totalPaidAllTime;

        let pNames = '';
        if (s.items && s.items.length > 0) {
           pNames = s.items.map(i => i.productName).join(', ');
        } else {
           pNames = s.productName;
        }

        movements.push({
          type: 'sale',
          id: s.id,
          customer: s.customerName || 'Cliente General',
          product: pNames,
          paid: paidThisSession,
          total: totalAmount,
          balance: balance,
          isFull: balance <= 0,
          profit: recognizedProfit
        });
      }
    });

    activeExpenses.forEach(e => {
      movements.push({
        type: 'expense',
        id: e.id,
        description: e.description || 'Gasto Operativo',
        category: e.categoria || 'Gasto',
        amount: parseFloat(e.amount) || 0
      });
    });

    activePurchases.forEach(p => {
      let pNames = '';
      if (p.items && p.items.length > 0) {
         pNames = p.items.map(i => i.productName).join(', ');
      } else {
         pNames = p.productName;
      }
      movements.push({
        type: 'purchase',
        id: p.id,
        supplier: p.supplierName || 'Proveedor',
        product: pNames,
        amount: parseFloat(p.total) || parseFloat(p.amount) || 0
      });
    });

    // PROFIT LOGIC: Proportional profit recognition based on payments received today
    let totalProfit = 0;
    salesArr.forEach(s => {
      const totalAmount = parseFloat(s.total) || 0;
      if (totalAmount <= 0) return;

      const paymentsThisSession = (s.payments || []).filter(p => p.id > closedIds.payment);
      if (paymentsThisSession.length > 0) {
        const paidThisSession = paymentsThisSession.reduce((acc, curr) => acc + (parseFloat(curr.amount) || 0), 0);
        
        let cost = 0;
        if (s.items && s.items.length > 0) {
           cost = s.items.reduce((sum, i) => sum + ((parseFloat(i.costAtSale) || 0) * parseInt(i.quantity || 1)), 0);
        } else {
           cost = (parseFloat(s.costAtSale) || 0) * (parseInt(s.quantity) || 1);
        }

        const saleProfit = totalAmount - cost;
        // Recognize profit proportional to what was actually paid today
        const recognizedProfit = (paidThisSession / totalAmount) * saleProfit;
        totalProfit += recognizedProfit;
      }
    });

    const maxExpenseId = activeExpenses.reduce((max, e) => Math.max(max, e.id), closedIds.expense);
    const maxPurchaseId = activePurchases.reduce((max, p) => Math.max(max, p.id), closedIds.purchase);
    
    return {
      salesCount: movements.length,
      cashIn: cashSales,
      cashOut: totalExpenses + totalPurchases,
      expensesTotal: totalExpenses,
      purchasesTotal: totalPurchases,
      profit: totalProfit - totalExpenses, // Real profit = Profit from sales - operating expenses
      net: cashSales - (totalExpenses + totalPurchases),
      movements: movements,
      newClosedIds: {
        payment: currentMaxPaymentId,
        expense: maxExpenseId,
        purchase: maxPurchaseId
      }
    };
  }, [sales, expenses, purchases, today, closedIds]);

  const handleCloseDay = () => {
    if (dailyStats.salesCount === 0 && dailyStats.cashIn === 0 && dailyStats.cashOut === 0) {
      notify('No hay movimientos nuevos para cerrar.', 'info');
      return;
    }

    confirm('¿Estás seguro de cerrar la caja actual? El resumen se reiniciará para nuevos movimientos.', async () => {
      const newClosing = {
        date: today,
        initialCash: 0,
        finalCash: dailyStats.net,
        difference: 0,
        salesTotal: dailyStats.cashIn,
        purchasesTotal: dailyStats.purchasesTotal,
        expensesTotal: dailyStats.expensesTotal,
        profit: dailyStats.profit,
        notes: JSON.stringify(dailyStats.movements)
      };
      
      try {
        await api.post('/cash-closings', newClosing);

        setClosedIds(dailyStats.newClosedIds);
        localStorage.setItem('alta_densidad_closed_ids', JSON.stringify(dailyStats.newClosedIds));
        // Clean up old corrupt id
        localStorage.removeItem('alta_densidad_last_closing_id');
        fetchData();
        notify('Cierre de caja guardado con éxito.', 'success');
      } catch (error) {
        console.error("Error al cerrar caja:", error);
        notify(`Error al guardar: ${error.message}`, 'error');
      }
    });
  };

  const deleteHistoryItem = (id) => {
    confirm('¿Eliminar este registro del historial?', async () => {
      try {
        await api.delete(`/cash-closings/${id}`);
        fetchData();
        notify('Registro eliminado.', 'info');
      } catch (error) {
        notify('Error al eliminar registro.', 'error');
      }
    });
  };

  return (
    <div className="main-content">
      <header className="page-header">
        <div>
          <h2 className="title-gradient" style={{ fontSize: '2.5rem', marginBottom: '0.5rem' }}>Cierre de Caja</h2>
          <p style={{ color: 'var(--text-secondary)', fontWeight: 500 }}>Control de flujo de efectivo diario y auditoría.</p>
        </div>
      </header>

      <div className="stat-card-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1.5fr', gap: '2rem' }}>
        {/* Daily Summary */}
        <div>
          <div className="premium-card" style={{ marginBottom: '2rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '2.5rem' }}>
              <div style={{ padding: '0.75rem', borderRadius: '12px', background: 'rgba(226, 176, 76, 0.1)', color: 'var(--accent-primary)' }}>
                <Calculator size={24} />
              </div>
              <h3 style={{ fontSize: '1.25rem', fontWeight: 800 }}>RESUMEN DE HOY</h3>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.2rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
                  <ArrowUpCircle size={16} color="var(--success)" />
                  Ingresos Efectivo (Ventas/Abonos)
                </div>
                <div style={{ fontWeight: 800, color: 'var(--success)' }}>+${dailyStats.cashIn.toLocaleString('es-CO')}</div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
                  <ArrowDownCircle size={16} color="var(--error)" />
                  Egresos (Gastos y Compras)
                </div>
                <div style={{ fontWeight: 800, color: 'var(--error)' }}>-${dailyStats.cashOut.toLocaleString('es-CO')}</div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.75rem', borderRadius: '10px', background: 'rgba(50,215,75,0.05)' }}>
                <div style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--success)' }}>GANANCIA ESTIMADA</div>
                <div style={{ fontWeight: 800, color: 'var(--success)' }}>+${dailyStats.profit.toLocaleString('es-CO')}</div>
              </div>

              <div style={{ height: '1px', background: 'var(--glass-border)', margin: '0.5rem 0' }} />

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ fontWeight: 800, color: 'var(--text-secondary)' }}>EFECTIVO EN CAJA</div>
                <div style={{ fontWeight: 900, fontSize: '1.8rem', color: 'var(--accent-primary)' }}>${dailyStats.net.toLocaleString('es-CO')}</div>
              </div>
            </div>

            <button 
              onClick={handleCloseDay}
              className="btn-primary" 
              style={{ width: '100%', marginTop: '2.5rem', height: '56px', fontSize: '1rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.75rem' }}
            >
              <Save size={20} />
              CERRAR CAJA DE HOY
            </button>
          </div>
          
          <div className="premium-card" style={{ background: 'rgba(50,215,75,0.05)', border: '1px solid rgba(50,215,75,0.1)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', color: 'var(--success)' }}>
              <CheckCircle size={18} />
              <span style={{ fontSize: '0.85rem', fontWeight: 700 }}>CAJA BALANCEADA Y AUDITADA</span>
            </div>
          </div>
        </div>

        {/* History */}
        <div className="premium-card">
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '2rem' }}>
            <div style={{ padding: '0.75rem', borderRadius: '12px', background: 'rgba(255,255,255,0.03)', color: 'var(--text-muted)' }}>
              <History size={24} />
            </div>
            <h3 style={{ fontSize: '1.25rem', fontWeight: 800 }}>HISTORIAL DE CIERRES</h3>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {closingHistory.length > 0 ? closingHistory.map((h, i) => (
              <div 
                key={i}
                onClick={() => setSelectedHistory(h)}
                style={{ 
                  padding: '1.25rem', 
                  borderRadius: '16px', 
                  background: 'rgba(255,255,255,0.01)', 
                  border: '1px solid var(--glass-border)',
                  display: 'grid',
                  gridTemplateColumns: '1.2fr 1fr 1fr 1fr',
                  gap: '1rem',
                  alignItems: 'center',
                  cursor: 'pointer'
                }}
                className="hover-glow"
              >
                <div>
                  <div style={{ fontWeight: 800, fontSize: '0.9rem' }}>{h.date}</div>
                  <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>{new Date(h.createdAt).toLocaleTimeString()}</div>
                </div>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: '0.6rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Egresos Totales</div>
                  <div style={{ fontWeight: 700, color: 'var(--error)', fontSize: '0.85rem' }}>-${Math.round(Number(h.expensesTotal || 0) + Number(h.purchasesTotal || 0)).toLocaleString('es-CO')}</div>
                </div>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: '0.6rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Ganancia</div>
                  <div style={{ fontWeight: 700, color: 'var(--success)', fontSize: '0.85rem' }}>+${Math.round(Number(h.profit || 0)).toLocaleString('es-CO')}</div>
                </div>
                <div style={{ textAlign: 'right', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '1rem' }}>
                  <div>
                    <div style={{ fontSize: '0.6rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Saldo Final</div>
                    <div style={{ fontWeight: 800, fontSize: '1rem', color: 'var(--accent-primary)' }}>${Math.round(Number(h.initialCash || 0) + Number(h.salesTotal || 0) - Number(h.expensesTotal || 0) - Number(h.purchasesTotal || 0)).toLocaleString('es-CO')}</div>
                  </div>
                  <button 
                    onClick={(e) => { e.stopPropagation(); deleteHistoryItem(h.id); }}
                    style={{ background: 'rgba(255,69,58,0.1)', color: 'var(--error)', border: 'none', padding: '0.5rem', borderRadius: '8px', cursor: 'pointer' }}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            )) : (
              <div style={{ textAlign: 'center', padding: '4rem', color: 'var(--text-muted)' }}>
                <Wallet size={48} style={{ margin: '0 auto 1.5rem', opacity: 0.2 }} />
                <p>No hay cierres de caja registrados aún.</p>
              </div>
            )}
          </div>
        </div>
      </div>
      {/* Modal Detalles de Cierre */}
      <AnimatePresence>
        {selectedHistory && (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(10px)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 10000, padding: '2rem' }}>
            <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }} className="premium-card" style={{ maxWidth: '500px', width: '100%' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
                <div>
                  <h3 style={{ fontSize: '1.5rem', color: 'var(--accent-primary)' }}>DETALLE DE CIERRE</h3>
                  <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>{selectedHistory.date} • {new Date(selectedHistory.createdAt).toLocaleTimeString()}</p>
                </div>
                <button onClick={() => setSelectedHistory(null)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}><X size={24} /></button>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem', marginBottom: '2rem' }}>
                <div className="glass" style={{ padding: '1.5rem', borderRadius: '16px', textAlign: 'center' }}>
                  <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '0.5rem' }}>Movimientos</div>
                  <div style={{ fontSize: '1.5rem', fontWeight: 800 }}>{selectedHistory.movements.length}</div>
                </div>
                <div className="glass" style={{ padding: '1.5rem', borderRadius: '16px', textAlign: 'center' }}>
                  <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '0.5rem' }}>Efectivo Total</div>
                  <div style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--accent-primary)' }}>${Math.round(Number(selectedHistory.initialCash || 0) + Number(selectedHistory.salesTotal || 0) - Number(selectedHistory.expensesTotal || 0) - Number(selectedHistory.purchasesTotal || 0)).toLocaleString('es-CO')}</div>
                </div>
              </div>

              <div style={{ background: 'rgba(255,255,255,0.02)', borderRadius: '20px', padding: '1.5rem', border: '1px solid var(--glass-border)', marginBottom: '2rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1.2rem' }}>
                  <span style={{ color: 'var(--text-secondary)' }}>Ingresos (Ventas/Abonos)</span>
                  <span style={{ fontWeight: 700, color: 'var(--success)' }}>+${Math.round(Number(selectedHistory.salesTotal || 0)).toLocaleString('es-CO')}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1.2rem' }}>
                  <span style={{ color: 'var(--text-secondary)' }}>Egresos (Gastos)</span>
                  <span style={{ fontWeight: 700, color: 'var(--error)' }}>-${Math.round(Number(selectedHistory.expensesTotal || 0)).toLocaleString('es-CO')}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1.2rem' }}>
                  <span style={{ color: 'var(--text-secondary)' }}>Egresos (Compras)</span>
                  <span style={{ fontWeight: 700, color: 'var(--error)' }}>-${Math.round(Number(selectedHistory.purchasesTotal || 0)).toLocaleString('es-CO')}</span>
                </div>
                <div style={{ height: '1px', background: 'var(--glass-border)', margin: '1.2rem 0' }} />
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ fontWeight: 800 }}>GANANCIA REAL</span>
                  <span style={{ fontWeight: 900, color: 'var(--success)', fontSize: '1.2rem' }}>+${Math.round(Number(selectedHistory.profit || 0)).toLocaleString('es-CO')}</span>
                </div>
              </div>

              {selectedHistory.movements && selectedHistory.movements.length > 0 && (
                <div style={{ marginTop: '1.5rem' }}>
                  <h4 style={{ fontSize: '0.8rem', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '1rem', letterSpacing: '1px' }}>Detalle de Movimientos</h4>
                  <div style={{ maxHeight: '200px', overflowY: 'auto', paddingRight: '0.5rem' }}>
                    {selectedHistory.movements.map((m, idx) => (
                      <div key={idx} style={{ padding: '0.75rem', borderRadius: '12px', background: 'rgba(255,255,255,0.01)', border: '1px solid rgba(255,255,255,0.03)', marginBottom: '0.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div>
                          <div style={{ fontSize: '0.85rem', fontWeight: 700 }}>
                            {m.type === 'expense' ? `Gasto: ${m.description}` : 
                             m.type === 'purchase' ? `Compra: ${m.supplier}` : 
                             m.customer}
                          </div>
                          <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                            {m.type === 'expense' ? m.category : m.product}
                          </div>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                          <div style={{ fontSize: '0.85rem', fontWeight: 800, color: m.type === 'expense' || m.type === 'purchase' ? 'var(--error)' : 'var(--success)' }}>
                            {m.type === 'expense' || m.type === 'purchase' ? `-$${m.amount.toLocaleString('es-CO')}` : `+$${(m.paid || 0).toLocaleString('es-CO')}`}
                          </div>
                          {(m.type === 'sale' || !m.type) ? (
                            <>
                              {m.balance > 0 ? (
                                <div style={{ fontSize: '0.65rem', color: 'var(--warning)', fontWeight: 700 }}>Debe: ${Math.round(m.balance).toLocaleString('es-CO')}</div>
                              ) : (
                                <div style={{ fontSize: '0.65rem', color: 'var(--success)', fontWeight: 800, textTransform: 'uppercase' }}>PAGADA</div>
                              )}
                              <div style={{ fontSize: '0.65rem', color: 'var(--success)', marginTop: '0.1rem', fontWeight: 600 }}>Ganancia: +${Math.round(m.profit || 0).toLocaleString('es-CO')}</div>
                            </>
                          ) : null}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <button onClick={() => setSelectedHistory(null)} className="btn-primary" style={{ width: '100%', marginTop: '2.5rem', height: '50px' }}>CERRAR DETALLE</button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default CashRegister;
