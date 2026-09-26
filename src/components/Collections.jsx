import React, { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Clock, User, Phone, DollarSign, ChevronRight, Search, Filter, Calendar, MessageSquare, AlertCircle, X } from 'lucide-react';
import { NumericFormat } from 'react-number-format';
import { paidAmount, balanceOf, saleProductNames } from '../utils/sales';

const Collections = ({ sales, onAddPayment, notify, confirm }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [filter, setFilter] = useState('all'); // all, critical (> 30 days?), high_value

  const debtors = useMemo(() => {
    const term = searchTerm.toLowerCase();
    const list = (sales || []).filter(s => {
      const matchesSearch = (s.customerName || '').toLowerCase().includes(term) ||
                            saleProductNames(s).toLowerCase().includes(term);
      return balanceOf(s) > 0.01 && matchesSearch;
    });

    return list.map(s => {
      const total = parseFloat(s.total) || 0;
      return {
        ...s,
        productName: s.productName || saleProductNames(s),
        balance: balanceOf(s),
        paidPercent: total > 0 ? (paidAmount(s) / total) * 100 : 0
      };
    }).sort((a, b) => b.balance - a.balance);
  }, [sales, searchTerm]);

  const stats = useMemo(() => {
    const totalDue = debtors.reduce((acc, d) => acc + d.balance, 0);
    return {
      totalDue,
      count: debtors.length,
      critical: debtors.filter(d => d.balance > 100000).length
    };
  }, [debtors]);

  const [selectedDebtor, setSelectedDebtor] = useState(null);
  const [paymentAmount, setPaymentAmount] = useState('');

  const handleQuickPayment = (e) => {
    e.preventDefault();
    if (!selectedDebtor || !paymentAmount) return;
    const amount = parseFloat(paymentAmount);
    if (!(amount > 0)) {
      notify('El abono debe ser mayor a cero.', 'warning');
      return;
    }
    if (amount - selectedDebtor.balance > 0.01) {
      notify(`El abono supera el saldo pendiente ($${Math.round(selectedDebtor.balance).toLocaleString('es-CO')}).`, 'warning');
      return;
    }

    onAddPayment(selectedDebtor.id, {
      amount,
      date: new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' }),
      method: 'Efectivo',
      note: 'Abono desde Cartera'
    });
    
    setSelectedDebtor(null);
    setPaymentAmount('');
  };

  return (
    <div className="main-content">
      <header className="page-header">
        <div>
          <h2 className="title-gradient" style={{ fontSize: '2.5rem', marginBottom: '0.5rem' }}>Gestión de Cartera</h2>
          <p style={{ color: 'var(--text-secondary)', fontWeight: 500 }}>Seguimiento de saldos pendientes y cobros activos.</p>
        </div>
      </header>

      <div className="stat-card-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '1.5rem', marginBottom: '3rem' }}>
        <div className="premium-card" style={{ borderLeft: '4px solid var(--error)' }}>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.75rem', fontWeight: 500, textTransform: 'uppercase', marginBottom: '0.5rem' }}>Total por Cobrar</p>
          <h3 style={{ fontSize: '1.8rem', fontWeight: 500, color: 'var(--error)' }}>${Math.round(stats.totalDue).toLocaleString('es-CO')}</h3>
          <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '0.5rem' }}>{stats.count} clientes con deuda activa</p>
        </div>
        <div className="premium-card" style={{ borderLeft: '4px solid var(--warning)' }}>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.75rem', fontWeight: 500, textTransform: 'uppercase', marginBottom: '0.5rem' }}>Saldos Críticos</p>
          <h3 style={{ fontSize: '1.8rem', fontWeight: 500, color: 'var(--warning)' }}>{stats.critical}</h3>
          <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '0.5rem' }}>Deudas mayores a $100.000</p>
        </div>
      </div>

      <div className="premium-card" style={{ padding: 0 }}>
        <div className="search-filter-bar">
          <div style={{ position: 'relative', flex: 1 }}>
            <Search size={18} style={{ position: 'absolute', left: '1rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
            <input 
              type="text" 
              placeholder="Buscar por cliente o producto..." 
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              style={{ width: '100%', paddingLeft: '3rem', height: '48px' }}
            />
          </div>
          <select style={{ height: '48px', padding: '0 1.5rem' }}>
            <option value="all">Todas las deudas</option>
            <option value="high">Deudas Altas</option>
            <option value="old">Antiguas</option>
          </select>
        </div>

        <div className="table-responsive-wrapper">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ textAlign: 'left', background: 'rgba(255,255,255,0.01)' }}>
                <th style={{ padding: '1.25rem 2rem', fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Cliente / Fecha</th>
                <th style={{ padding: '1.25rem 2rem', fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Concepto</th>
                <th style={{ padding: '1.25rem 2rem', fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Progreso de Pago</th>
                <th style={{ padding: '1.25rem 2rem', fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Saldo Pendiente</th>
                <th style={{ padding: '1.25rem 2rem', fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {debtors.length > 0 ? debtors.map((d, i) => (
                <tr key={d.id} style={{ borderBottom: '1px solid var(--glass-border)' }}>
                  <td style={{ padding: '1.25rem 2rem' }}>
                    <span className="mobile-label">Cliente / Fecha</span>
                    <div style={{ fontWeight: 500, fontSize: '0.95rem' }}>{d.customerName}</div>
                    <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                      <Calendar size={10} /> {d.date}
                    </div>
                  </td>
                  <td style={{ padding: '1.25rem 2rem' }}>
                    <span className="mobile-label">Concepto</span>
                    <div style={{ fontWeight: 500, fontSize: '0.85rem' }}>{d.productName}</div>
                    <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Total Venta: ${Math.round(d.total).toLocaleString('es-CO')}</div>
                  </td>
                  <td style={{ padding: '1.25rem 2rem' }}>
                    <span className="mobile-label">Progreso de Pago</span>
                    <div style={{ width: '150px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.65rem', marginBottom: '0.3rem' }}>
                        <span>{Math.round(d.paidPercent)}% pagado</span>
                      </div>
                      <div style={{ height: '6px', background: 'rgba(255,255,255,0.05)', borderRadius: 0, overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: `${d.paidPercent}%`, background: d.paidPercent > 50 ? 'var(--success)' : 'var(--accent-primary)' }} />
                      </div>
                    </div>
                  </td>
                  <td style={{ padding: '1.25rem 2rem' }}>
                    <span className="mobile-label">Saldo Pendiente</span>
                    <div style={{ fontWeight: 500, color: 'var(--error)', fontSize: '1.1rem' }}>
                      ${Math.round(d.balance).toLocaleString('es-CO')}
                    </div>
                  </td>
                  <td style={{ padding: '1.25rem 2rem' }}>
                    <div style={{ display: 'flex', gap: '0.75rem' }}>
                      <button 
                        onClick={() => setSelectedDebtor(d)}
                        className="btn-primary" 
                        style={{ padding: '0.5rem 1rem', fontSize: '0.7rem', height: 'auto' }}
                      >
                        ABONAR
                      </button>
                      <button 
                        style={{ padding: '0.5rem', borderRadius: 0, background: 'rgba(255,255,255,0.03)', color: 'var(--text-muted)', border: 'none' }}
                      >
                        <MessageSquare size={16} />
                      </button>
                    </div>
                  </td>
                </tr>
              )) : (
                <tr>
                  <td colSpan="5" style={{ padding: '4rem', textAlign: 'center', color: 'var(--text-muted)' }}>
                    <Clock size={48} style={{ opacity: 0.1, margin: '0 auto 1.5rem' }} />
                    <p>No hay saldos pendientes en cartera. ¡Felicidades!</p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal Abono Rápido */}
      <AnimatePresence>
        {selectedDebtor && (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(12px)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 10000, padding: '1.5rem' }}>
            <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }} className="premium-card" style={{ maxWidth: '450px', width: '100%', border: '1px solid var(--accent-primary)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '2rem', alignItems: 'center' }}>
                <div>
                  <h3 style={{ color: 'var(--accent-primary)', fontSize: '1.5rem', marginBottom: '0.25rem' }}>REGISTRAR COBRO</h3>
                  <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Gestión de Cartera - {selectedDebtor.date}</p>
                </div>
                <button onClick={() => setSelectedDebtor(null)} style={{ background: 'transparent', border: '1px solid var(--border-color)', color: 'var(--text-main)', cursor: 'pointer', width: '32px', height: '32px', display: 'flex', alignItems: 'center', justifyContent: 'center' }} aria-label="Cerrar"><X size={16} /></button>
              </div>

              <div style={{ background: 'rgba(0,0,0,0.2)', padding: '1.5rem', borderRadius: 0, marginBottom: '2rem', border: '1px solid var(--glass-border)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
                  <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Cliente:</span>
                  <span style={{ fontWeight: 500 }}>{selectedDebtor.customerName}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
                  <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Total Venta:</span>
                  <span style={{ fontWeight: 500 }}>${Math.round(selectedDebtor.total).toLocaleString('es-CO')}</span>
                </div>
                <div style={{ height: '1px', background: 'var(--glass-border)', margin: '0.75rem 0' }} />
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--error)', fontWeight: 500 }}>SALDO PENDIENTE:</span>
                  <span style={{ fontWeight: 500, color: 'var(--error)', fontSize: '1.25rem' }}>
                    ${Math.round(selectedDebtor.balance).toLocaleString('es-CO')}
                  </span>
                </div>
              </div>

              <form onSubmit={handleQuickPayment}>
                <div style={{ marginBottom: '2rem' }}>
                  <label style={{ display: 'block', marginBottom: '0.75rem', fontSize: '0.75rem', fontWeight: 500, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '1px' }}>Monto a Recibir (COP)</label>
                  <div style={{ position: 'relative' }}>
                    <div style={{ position: 'absolute', left: '1rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--accent-primary)', fontWeight: 500 }}>$</div>
                    <NumericFormat 
                      required 
                      autoFocus
                      thousandSeparator="." 
                      decimalSeparator="," 
                      allowNegative={false} 
                      value={paymentAmount} 
                      onValueChange={(values) => setPaymentAmount(values.value)} 
                      style={{ width: '100%', height: '60px', paddingLeft: '2.5rem', fontSize: '1.5rem', fontWeight: 500, borderRadius: 0 }} 
                      placeholder="0"
                    />
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '1rem' }}>
                  <button type="button" onClick={() => setSelectedDebtor(null)} className="btn-secondary" style={{ flex: 1 }}>CANCELAR</button>
                  <button type="submit" className="btn-primary" style={{ flex: 2, height: '55px', fontSize: '1rem', fontWeight: 500 }}>
                    GUARDAR PAGO
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default Collections;
