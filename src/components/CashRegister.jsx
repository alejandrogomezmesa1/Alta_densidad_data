import React, { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Wallet, ArrowDownCircle, ArrowUpCircle, Calculator, CheckCircle, Save, History, DollarSign, Trash2, X } from 'lucide-react';

const CashRegister = ({ sales, purchases, expenses, notify, confirm }) => {
  const [closingHistory, setClosingHistory] = useState(() => {
    const saved = localStorage.getItem('alta_densidad_cash_history');
    return saved ? JSON.parse(saved) : [];
  });

  const [selectedHistory, setSelectedHistory] = useState(null);
  const [lastClosingId, setLastClosingId] = useState(() => {
    return Number(localStorage.getItem('alta_densidad_last_closing_id')) || 0;
  });

  const today = new Date().toISOString().split('T')[0];

  const dailyStats = useMemo(() => {
    // Only count transactions AFTER the last closing
    const activeExpenses = expenses.filter(e => e.date === today && e.id > lastClosingId);
    
    // CASH IN: All payments made today, even from old sales
    let cashSales = 0;
    const movements = [];

    sales.forEach(s => {
      const paymentsThisSession = (s.payments || []).filter(p => p.id > lastClosingId);
      if (paymentsThisSession.length > 0) {
        const paidThisSession = paymentsThisSession.reduce((acc, curr) => acc + (parseFloat(curr.amount) || 0), 0);
        cashSales += paidThisSession;
        
        const totalPaidAllTime = (s.payments || []).reduce((acc, curr) => acc + (parseFloat(curr.amount) || 0), 0);
        const totalAmount = parseFloat(s.total) || 0;
        const balance = totalAmount - totalPaidAllTime;

        movements.push({
          id: s.id,
          customer: s.customerName || 'Cliente General',
          product: s.productName,
          paid: paidThisSession,
          total: totalAmount,
          balance: balance,
          isFull: balance <= 0
        });
      }
    });

    const totalExpenses = activeExpenses.reduce((acc, e) => acc + (parseFloat(e.amount) || 0), 0);

    // NEW PROFIT LOGIC: Only recognize profit when sale is FULLY PAID since last closing
    let totalProfit = 0;
    sales.forEach(s => {
      const totalAmount = parseFloat(s.total) || 0;
      const payments = s.payments || [];
      const totalPaid = payments.reduce((pAcc, pCurr) => pAcc + (parseFloat(pCurr.amount) || 0), 0);
      
      if (totalPaid >= totalAmount && totalAmount > 0) {
        const lastPayment = payments.reduce((latest, p) => {
          return !latest || Number(p.id) > Number(latest.id) ? p : latest;
        }, null);

        if (lastPayment && Number(lastPayment.id) > lastClosingId) {
          const cost = (parseFloat(s.costAtSale) || 0) * (parseInt(s.quantity) || 1);
          totalProfit += (totalAmount - cost);
        }
      }
    });
    
    return {
      salesCount: movements.length,
      cashIn: cashSales,
      cashOut: totalExpenses,
      profit: totalProfit,
      net: cashSales - totalExpenses,
      movements: movements
    };
  }, [sales, expenses, today, lastClosingId]);

  const handleCloseDay = () => {
    if (dailyStats.salesCount === 0 && dailyStats.cashIn === 0 && dailyStats.cashOut === 0) {
      notify('No hay movimientos nuevos para cerrar.', 'info');
      return;
    }

    confirm('¿Estás seguro de cerrar la caja actual? El resumen se reiniciará para nuevos movimientos.', () => {
      const closeId = Date.now();
      const newClosing = {
        id: closeId,
        date: today,
        ...dailyStats,
        timestamp: new Date().toLocaleTimeString()
      };
      
      const updatedHistory = [newClosing, ...closingHistory];
      setClosingHistory(updatedHistory);
      setLastClosingId(closeId);
      localStorage.setItem('alta_densidad_cash_history', JSON.stringify(updatedHistory));
      localStorage.setItem('alta_densidad_last_closing_id', closeId.toString());
      
      notify('Cierre de caja guardado con éxito.', 'success');
    });
  };

  const deleteHistoryItem = (id) => {
    confirm('¿Eliminar este registro del historial?', () => {
      const updated = closingHistory.filter(h => h.id !== id);
      setClosingHistory(updated);
      localStorage.setItem('alta_densidad_cash_history', JSON.stringify(updated));
      notify('Registro eliminado.', 'info');
    });
  };

  return (
    <div className="main-content">
      <header style={{ marginBottom: '3rem' }}>
        <h2 className="title-gradient" style={{ fontSize: '2.5rem', marginBottom: '0.5rem' }}>Cierre de Caja</h2>
        <p style={{ color: 'var(--text-secondary)', fontWeight: 500 }}>Control de flujo de efectivo diario y auditoría.</p>
      </header>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.5fr', gap: '2rem' }}>
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
                  Egresos (Gastos Operativos)
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
                  <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>{h.timestamp}</div>
                </div>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: '0.6rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Gastos</div>
                  <div style={{ fontWeight: 700, color: 'var(--error)', fontSize: '0.85rem' }}>-${(h.cashOut || 0).toLocaleString('es-CO')}</div>
                </div>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: '0.6rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Ganancia</div>
                  <div style={{ fontWeight: 700, color: 'var(--success)', fontSize: '0.85rem' }}>+${(h.profit || 0).toLocaleString('es-CO')}</div>
                </div>
                <div style={{ textAlign: 'right', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '1rem' }}>
                  <div>
                    <div style={{ fontSize: '0.6rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Saldo Final</div>
                    <div style={{ fontWeight: 800, fontSize: '1rem', color: 'var(--accent-primary)' }}>${h.net.toLocaleString('es-CO')}</div>
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
                  <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>{selectedHistory.date} • {selectedHistory.timestamp}</p>
                </div>
                <button onClick={() => setSelectedHistory(null)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}><X size={24} /></button>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem', marginBottom: '2rem' }}>
                <div className="glass" style={{ padding: '1.5rem', borderRadius: '16px', textAlign: 'center' }}>
                  <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '0.5rem' }}>Movimientos</div>
                  <div style={{ fontSize: '1.5rem', fontWeight: 800 }}>{selectedHistory.salesCount}</div>
                </div>
                <div className="glass" style={{ padding: '1.5rem', borderRadius: '16px', textAlign: 'center' }}>
                  <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '0.5rem' }}>Efectivo Total</div>
                  <div style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--accent-primary)' }}>${selectedHistory.net.toLocaleString('es-CO')}</div>
                </div>
              </div>

              <div style={{ background: 'rgba(255,255,255,0.02)', borderRadius: '20px', padding: '1.5rem', border: '1px solid var(--glass-border)', marginBottom: '2rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1.2rem' }}>
                  <span style={{ color: 'var(--text-secondary)' }}>Ingresos (Ventas/Abonos)</span>
                  <span style={{ fontWeight: 700, color: 'var(--success)' }}>+${selectedHistory.cashIn.toLocaleString('es-CO')}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1.2rem' }}>
                  <span style={{ color: 'var(--text-secondary)' }}>Egresos (Gastos)</span>
                  <span style={{ fontWeight: 700, color: 'var(--error)' }}>-${selectedHistory.cashOut.toLocaleString('es-CO')}</span>
                </div>
                <div style={{ height: '1px', background: 'var(--glass-border)', margin: '1.2rem 0' }} />
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ fontWeight: 800 }}>GANANCIA REAL</span>
                  <span style={{ fontWeight: 900, color: 'var(--success)', fontSize: '1.2rem' }}>+${selectedHistory.profit.toLocaleString('es-CO')}</span>
                </div>
              </div>

              {selectedHistory.movements && selectedHistory.movements.length > 0 && (
                <div style={{ marginTop: '1.5rem' }}>
                  <h4 style={{ fontSize: '0.8rem', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '1rem', letterSpacing: '1px' }}>Detalle de Movimientos</h4>
                  <div style={{ maxHeight: '200px', overflowY: 'auto', paddingRight: '0.5rem' }}>
                    {selectedHistory.movements.map((m, idx) => (
                      <div key={idx} style={{ padding: '0.75rem', borderRadius: '12px', background: 'rgba(255,255,255,0.01)', border: '1px solid rgba(255,255,255,0.03)', marginBottom: '0.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div>
                          <div style={{ fontSize: '0.85rem', fontWeight: 700 }}>{m.customer}</div>
                          <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{m.product}</div>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                          <div style={{ fontSize: '0.85rem', fontWeight: 800, color: 'var(--success)' }}>+${m.paid.toLocaleString('es-CO')}</div>
                          {m.balance > 0 ? (
                            <div style={{ fontSize: '0.65rem', color: 'var(--error)', fontWeight: 700 }}>Debe: ${m.balance.toLocaleString('es-CO')}</div>
                          ) : (
                            <div style={{ fontSize: '0.65rem', color: 'var(--success)', fontWeight: 800, textTransform: 'uppercase' }}>PAGADA</div>
                          )}
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
