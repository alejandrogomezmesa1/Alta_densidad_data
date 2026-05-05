import React, { useState, useMemo, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, Calendar, ShoppingBag, Receipt, DollarSign, X, Trash2, Search, ArrowDownCircle, ArrowUpCircle, Calculator, User, CreditCard, CheckCircle2, Clock, Printer } from 'lucide-react';

const Transactions = ({ type, data, products, onAdd, onDelete, onAddPayment, notify, confirm, suppliers = [], mostFrequentSupplierId }) => {
  const [isAdding, setIsAdding] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [inputMode, setInputMode] = useState('total'); 
  const [selectedSale, setSelectedSale] = useState(null); // For adding payments
  const [paymentAmount, setPaymentAmount] = useState('');
  const [dateFilter, setDateFilter] = useState('all');
  const [selectedMonth, setSelectedMonth] = useState(''); // Formato: "YYYY-MM"
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear().toString());

  const [formData, setFormData] = useState({
    productId: '',
    quantity: '1',
    amount: '',
    unitPrice: '',
    description: '',
    customerName: '',
    initialPayment: '',
    method: 'Efectivo',
    supplierId: '',
    date: new Date().toISOString().split('T')[0]
  });

  const config = {
    sales: { title: 'Ventas y Cartera', subtitle: 'Gestión de facturación y abonos.', icon: ShoppingBag, color: 'var(--success)', label: 'Registrar Venta' },
    purchases: { title: 'Compras', subtitle: 'Entradas de nuevo inventario.', icon: Receipt, color: 'var(--info)', label: 'Registrar Compra' },
    expenses: { title: 'Gastos', subtitle: 'Egresos operativos y generales.', icon: DollarSign, color: 'var(--error)', label: 'Registrar Gasto' }
  };

  useEffect(() => {
    if (type === 'purchases' && formData.quantity) {
      const q = parseFloat(formData.quantity) || 0;
      if (inputMode === 'unit' && formData.unitPrice) {
        const total = q * (parseFloat(formData.unitPrice) || 0);
        if (String(total) !== formData.amount) setFormData(prev => ({ ...prev, amount: String(total) }));
      } else if (inputMode === 'total' && formData.amount) {
        const unit = (parseFloat(formData.amount) || 0) / q;
        if (String(unit) !== formData.unitPrice) setFormData(prev => ({ ...prev, unitPrice: String(unit.toFixed(2)) }));
      }
    }
  }, [formData.quantity, formData.unitPrice, formData.amount, inputMode, type]);
  
  const availableYears = useMemo(() => {
    const list = Array.isArray(data) ? data : [];
    const years = list.map(item => new Date(item.date).getFullYear().toString());
    const currentYear = new Date().getFullYear().toString();
    const uniqueYears = [...new Set([...years, currentYear])].sort().reverse();
    return uniqueYears;
  }, [data]);

  const availableMonths = useMemo(() => {
    const list = Array.isArray(data) ? data : [];
    const months = list.map(item => {
      const d = new Date(item.date);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    });
    // Ordenar de más reciente a más antiguo
    const uniqueMonths = [...new Set(months)].sort().reverse();
    return uniqueMonths;
  }, [data]);

  // Inicializar selectedMonth si está vacío y hay meses disponibles
  useEffect(() => {
    if (!selectedMonth && availableMonths.length > 0) {
      const now = new Date();
      const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      if (availableMonths.includes(currentMonth)) {
        setSelectedMonth(currentMonth);
      } else {
        setSelectedMonth(availableMonths[0]);
      }
    }
  }, [availableMonths, selectedMonth]);

  const filteredData = useMemo(() => {
    const list = Array.isArray(data) ? data : [];
    const productList = Array.isArray(products) ? products : [];
    const now = new Date();
    
    return list.filter(item => {
      // Date filtering logic
      const itemDate = new Date(item.date);
      let matchesDate = true;
      
      if (dateFilter === 'year') {
        matchesDate = itemDate.getFullYear().toString() === selectedYear;
      } else if (dateFilter === 'month') {
        if (!selectedMonth) {
          matchesDate = itemDate.getFullYear() === now.getFullYear() && itemDate.getMonth() === now.getMonth();
        } else {
          const [y, m] = selectedMonth.split('-').map(Number);
          matchesDate = itemDate.getFullYear() === y && (itemDate.getMonth() + 1) === m;
        }
      } else if (dateFilter === 'week') {
        // Simple week logic: within last 7 days or current week (Sun-Sat)
        const startOfWeek = new Date(now);
        startOfWeek.setDate(now.getDate() - now.getDay());
        startOfWeek.setHours(0,0,0,0);
        const endOfWeek = new Date(startOfWeek);
        endOfWeek.setDate(startOfWeek.getDate() + 6);
        endOfWeek.setHours(23,59,59,999);
        matchesDate = itemDate >= startOfWeek && itemDate <= endOfWeek;
      }

      const pName = productList.find(p => p.id === item.productId)?.name || item.productName || item.description || item.customerName || '';
      const matchesSearch = pName.toLowerCase().includes(searchTerm.toLowerCase());
      
      return matchesDate && matchesSearch;
    }).sort((a, b) => b.id - a.id);
  }, [data, products, searchTerm, dateFilter, selectedMonth, selectedYear]);

  const handlePrintReceipt = (item) => {
    const paid = (item.payments || []).reduce((acc, curr) => acc + curr.amount, 0);
    const balance = item.total - paid;
    
    const printWindow = window.open('', '_blank');
    printWindow.document.write(`
      <html>
        <head>
          <title>Recibo - ${item.customerName}</title>
          <style>
            @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;700;800&display=swap');
            body { font-family: 'Inter', sans-serif; padding: 40px; color: #1a1a1a; max-width: 800px; margin: auto; }
            .header { text-align: center; border-bottom: 2px solid #f0f0f0; padding-bottom: 20px; margin-bottom: 30px; }
            .title { font-size: 28px; font-weight: 800; color: #E2B04C; margin: 0; letter-spacing: -1px; }
            .details { display: flex; justify-content: space-between; margin-bottom: 40px; }
            table { width: 100%; border-collapse: collapse; margin-bottom: 40px; }
            th { text-align: left; background: #f9f9f9; padding: 12px; font-size: 11px; color: #888; text-transform: uppercase; letter-spacing: 1px; }
            td { padding: 15px 12px; border-bottom: 1px solid #eee; font-size: 14px; }
            .totals { float: right; width: 280px; }
            .row { display: flex; justify-content: space-between; padding: 10px 0; font-size: 14px; }
            .total-row { font-size: 18px; font-weight: 800; border-top: 2px solid #1a1a1a; margin-top: 10px; padding-top: 10px; }
            .footer { margin-top: 120px; text-align: center; font-size: 11px; color: #999; border-top: 1px solid #eee; padding-top: 20px; clear: both; }
            .stamp { color: ${item.status === 'paid' ? '#32D74B' : '#FF453A'}; font-weight: 800; text-transform: uppercase; font-size: 18px; border: 4px solid; padding: 8px 15px; display: inline-block; transform: rotate(-5deg); margin-top: 30px; opacity: 0.8; }
          </style>
        </head>
        <body>
          <div class="header">
            <h1 class="title">ALTA DENSIDAD</h1>
            <p style="margin: 5px 0; color: #888; font-size: 12px; font-weight: 600;">LUXURY BUSINESS MANAGEMENT</p>
          </div>
          <div class="details">
            <div>
              <p style="font-size: 11px; color: #888; text-transform: uppercase; margin-bottom: 5px;">Cliente</p>
              <p style="font-size: 16px; font-weight: 700; margin: 0;">${item.customerName || 'Cliente General'}</p>
            </div>
            <div style="text-align: right;">
              <p style="font-size: 11px; color: #888; text-transform: uppercase; margin-bottom: 5px;">Recibo #</p>
              <p style="font-size: 16px; font-weight: 700; margin: 0;">${String(item.id).slice(-6)}</p>
              <p style="font-size: 12px; color: #666; margin-top: 5px;">${item.date}</p>
            </div>
          </div>
          <table>
            <thead>
              <tr>
                <th>Descripción del Producto / Concepto</th>
                <th style="text-align: center;">Cant.</th>
                <th style="text-align: right;">Precio</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td style="font-weight: 700;">${item.productName || item.description}</td>
                <td style="text-align: center;">${item.quantity || 1}</td>
                <td style="text-align: right;">$${Math.round(item.total).toLocaleString('es-CO')}</td>
              </tr>
            </tbody>
          </table>
          <div class="totals">
            <div class="row"><span>Subtotal:</span> <span>$${Math.round(item.total).toLocaleString('es-CO')}</span></div>
            <div class="total-row">
              <span>TOTAL:</span> <span>$${Math.round(item.total).toLocaleString('es-CO')}</span>
            </div>
            <div class="row" style="margin-top: 15px; color: #32D74B; font-weight: 700;"><span>Total Abonado:</span> <span>$${Math.round(paid).toLocaleString('es-CO')}</span></div>
            <div class="row" style="color: ${balance > 0 ? '#FF453A' : '#666'}; font-weight: 700;"><span>Saldo Pendiente:</span> <span>$${Math.round(balance).toLocaleString('es-CO')}</span></div>
          </div>
          <div style="text-align: center; width: 100%;">
            <div class="stamp">${item.status === 'paid' ? 'DOCUMENTO PAGADO' : 'PENDIENTE DE PAGO'}</div>
          </div>
          <div class="footer">
            <p style="font-weight: 700; color: #1a1a1a;">Gracias por su confianza en Alta Densidad</p>
            <p>Este es un comprobante digital generado automáticamente.</p>
          </div>
        </body>
      </html>
    `);
    printWindow.document.close();
    printWindow.print();
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    onAdd(formData);
    setIsAdding(false);
    setFormData({ productId: '', quantity: '1', amount: '', unitPrice: '', description: '', customerName: '', initialPayment: '', method: 'Efectivo', supplierId: mostFrequentSupplierId || '', date: new Date().toISOString().split('T')[0] });
    notify(`${config[type].label} guardado correctamente.`, 'success');
  };

  const handleAddPayment = (e) => {
    e.preventDefault();
    if (!selectedSale || !paymentAmount) return;
    onAddPayment(selectedSale.id, {
      amount: parseFloat(paymentAmount),
      date: new Date().toISOString().split('T')[0],
      method: 'Efectivo'
    });
    setSelectedSale(null);
    setPaymentAmount('');
    notify('Abono registrado con éxito.', 'success');
  };

  const Icon = config[type].icon;

  return (
    <div className="main-content">
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '3rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1.5rem' }}>
          <div style={{ padding: '1rem', borderRadius: '20px', background: 'rgba(255,255,255,0.03)', border: '1px solid var(--glass-border)', color: config[type].color }}>
            <Icon size={32} />
          </div>
          <div>
            <h2 className="title-gradient" style={{ fontSize: '2.5rem', marginBottom: '0.25rem' }}>{config[type].title}</h2>
            <p style={{ color: 'var(--text-secondary)', fontWeight: 500 }}>{config[type].subtitle}</p>
          </div>
        </div>
        <button onClick={() => setIsAdding(!isAdding)} className="btn-primary" style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <Plus size={20} />
          {config[type].label}
        </button>
      </header>

      <AnimatePresence>
        {isAdding && (
          <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }} className="premium-card" style={{ marginBottom: '3rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1.5rem' }}>
              <h4 style={{ color: 'var(--accent-primary)' }}>NUEVO REGISTRO DE {config[type].title.toUpperCase()}</h4>
              <button onClick={() => {
                setIsAdding(false);
                setFormData(prev => ({ ...prev, supplierId: mostFrequentSupplierId || '' }));
              }} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}><X size={20} /></button>
            </div>
            
            <form onSubmit={handleSubmit} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1.5rem', alignItems: 'flex-end' }}>
              {type === 'sales' && (
                <div style={{ gridColumn: 'span 1' }}>
                  <label style={{ display: 'block', marginBottom: '0.6rem', fontSize: '0.75rem', fontWeight: 800, color: 'var(--text-muted)' }}>CLIENTE</label>
                  <div style={{ position: 'relative' }}>
                    <User size={14} style={{ position: 'absolute', left: '1rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                    <input type="text" value={formData.customerName} onChange={e => setFormData({...formData, customerName: e.target.value})} placeholder="Nombre del cliente" style={{ width: '100%', paddingLeft: '2.5rem' }} />
                  </div>
                </div>
              )}

              {type !== 'expenses' ? (
                <div style={{ gridColumn: 'span 2' }}>
                  <label style={{ display: 'block', marginBottom: '1rem', fontSize: '0.75rem', fontWeight: 800, color: 'var(--text-muted)' }}>SELECCIONAR PRODUCTO</label>
                  
                  <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1rem' }}>
                    <div style={{ flex: 1, position: 'relative' }}>
                      <Search size={14} style={{ position: 'absolute', left: '1rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                      <input 
                        type="text" 
                        placeholder="Buscar producto..." 
                        value={formData.productSearch || ''} 
                        onChange={e => setFormData({...formData, productSearch: e.target.value})}
                        style={{ width: '100%', paddingLeft: '2.5rem', height: '40px', fontSize: '0.85rem' }}
                      />
                    </div>
                    <select 
                      value={formData.categoryFilter || 'all'} 
                      onChange={e => setFormData({...formData, categoryFilter: e.target.value})}
                      style={{ height: '40px', padding: '0 1rem', fontSize: '0.8rem', width: 'auto' }}
                    >
                      <option value="all">Todas las Categorías</option>
                      {[...new Set(products.map(p => p.category))].map(cat => (
                        <option key={cat} value={cat}>{cat}</option>
                      ))}
                    </select>
                  </div>

                  <div style={{ 
                    display: 'grid', 
                    gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', 
                    gap: '0.75rem', 
                    maxHeight: '200px', 
                    overflowY: 'auto',
                    padding: '0.5rem',
                    background: 'rgba(0,0,0,0.1)',
                    borderRadius: '12px',
                    border: '1px solid var(--glass-border)'
                  }}>
                    {products
                      .filter(p => {
                        const matchesSearch = p.name.toLowerCase().includes((formData.productSearch || '').toLowerCase());
                        const matchesCat = formData.categoryFilter === 'all' || !formData.categoryFilter || p.category === formData.categoryFilter;
                        return matchesSearch && matchesCat;
                      })
                      .map(p => (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => setFormData({...formData, productId: p.id, productName: p.name})}
                          style={{
                            padding: '0.75rem',
                            borderRadius: '10px',
                            background: formData.productId === p.id ? 'rgba(226, 176, 76, 0.15)' : 'rgba(255,255,255,0.02)',
                            border: `1px solid ${formData.productId === p.id ? 'var(--accent-primary)' : 'var(--glass-border)'}`,
                            textAlign: 'left',
                            transition: 'all 0.2s',
                            color: formData.productId === p.id ? 'var(--accent-primary)' : 'var(--text-main)'
                          }}
                        >
                          <div style={{ fontWeight: 700, fontSize: '0.8rem', marginBottom: '0.25rem' }}>{p.name}</div>
                          <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', display: 'flex', justifyContent: 'space-between' }}>
                            <span>Stock: {p.stock}</span>
                            <span>${Math.round(p.price).toLocaleString('es-CO')}</span>
                          </div>
                        </button>
                      ))}
                  </div>
                  
                  <div style={{ marginTop: '1rem', display: 'flex', alignItems: 'center', gap: '1rem' }}>
                    <div>
                      <label style={{ display: 'block', marginBottom: '0.6rem', fontSize: '0.75rem', fontWeight: 800, color: 'var(--text-muted)' }}>CANTIDAD</label>
                      <input required type="number" min="1" value={formData.quantity} onChange={e => setFormData({...formData, quantity: e.target.value})} style={{ width: '100px' }} />
                    </div>
                    {formData.productId && (
                      <div style={{ paddingTop: '1.25rem', fontSize: '0.85rem', color: 'var(--accent-primary)', fontWeight: 700 }}>
                        Seleccionado: {formData.productName}
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div style={{ gridColumn: 'span 2' }}>
                  <label style={{ display: 'block', marginBottom: '0.6rem', fontSize: '0.75rem', fontWeight: 800, color: 'var(--text-muted)' }}>DESCRIPCIÓN</label>
                  <input required type="text" value={formData.description} onChange={e => setFormData({...formData, description: e.target.value})} placeholder="Ej: Pago de Luz" style={{ width: '100%' }} />
                </div>
              )}

              {type === 'sales' && (
                <div>
                  <label style={{ display: 'block', marginBottom: '0.6rem', fontSize: '0.75rem', fontWeight: 800, color: 'var(--text-muted)' }}>ABONO INICIAL (COP)</label>
                  <input type="number" value={formData.initialPayment} onChange={e => setFormData({...formData, initialPayment: e.target.value})} placeholder="Dejar vacío si es total" style={{ width: '100%' }} />
                </div>
              )}

              {type === 'purchases' && (
                <div style={{ gridColumn: 'span 2', display: 'flex', gap: '1rem', alignItems: 'flex-end' }}>
                  <div style={{ flex: 1 }}>
                    <label style={{ display: 'block', marginBottom: '0.6rem', fontSize: '0.75rem', fontWeight: 800, color: 'var(--text-muted)' }}>PROVEEDOR</label>
                    <select 
                      value={formData.supplierId || mostFrequentSupplierId || ''} 
                      onChange={e => setFormData({...formData, supplierId: e.target.value})}
                      style={{ width: '100%', height: '40px' }}
                    >
                      <option value="">Seleccionar Proveedor</option>
                      {suppliers.map(s => (
                        <option key={s.id} value={s.id}>{s.name} {s.id === mostFrequentSupplierId ? '(Frecuente)' : ''}</option>
                      ))}
                    </select>
                  </div>
                  <div style={{ flex: 1 }}>
                    <label style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.6rem', fontSize: '0.75rem', fontWeight: 800, color: 'var(--text-muted)' }}>
                      {inputMode === 'unit' ? 'PRECIO UNITARIO' : 'MONTO TOTAL'}
                      <button type="button" onClick={() => setInputMode(inputMode === 'unit' ? 'total' : 'unit')} style={{ background: 'none', border: 'none', color: 'var(--accent-primary)', fontSize: '0.65rem', cursor: 'pointer' }}>CAMBIAR</button>
                    </label>
                    <input required type="number" value={inputMode === 'unit' ? formData.unitPrice : formData.amount} onChange={e => setFormData({...formData, [inputMode === 'unit' ? 'unitPrice' : 'amount']: e.target.value})} placeholder="0" style={{ width: '100%' }} />
                  </div>
                </div>
              )}

              {type === 'expenses' && (
                <div>
                  <label style={{ display: 'block', marginBottom: '0.6rem', fontSize: '0.75rem', fontWeight: 800, color: 'var(--text-muted)' }}>MONTO (COP)</label>
                  <input required type="number" value={formData.amount} onChange={e => setFormData({...formData, amount: e.target.value})} style={{ width: '100%' }} />
                </div>
              )}

              <div>
                <label style={{ display: 'block', marginBottom: '0.6rem', fontSize: '0.75rem', fontWeight: 800, color: 'var(--text-muted)' }}>FECHA</label>
                <input required type="date" value={formData.date} onChange={e => setFormData({...formData, date: e.target.value})} style={{ width: '100%' }} />
              </div>

              <button type="submit" className="btn-primary" style={{ height: '48px' }}>GUARDAR REGISTRO</button>
            </form>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="premium-card" style={{ padding: 0 }}>
        <div style={{ padding: '1.5rem 2rem', borderBottom: '1px solid var(--glass-border)', display: 'flex', gap: '1rem', alignItems: 'center' }}>
          <Search size={18} color="var(--text-muted)" />
          <input type="text" placeholder="Buscar por cliente, producto o descripción..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} style={{ flex: 1, background: 'transparent', border: 'none', color: '#fff' }} />
          
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', background: 'rgba(255,255,255,0.03)', padding: '0.4rem 1rem', borderRadius: '10px', border: '1px solid var(--glass-border)' }}>
            <Calendar size={14} color="var(--accent-primary)" />
            <select 
              value={dateFilter} 
              onChange={e => setDateFilter(e.target.value)}
              style={{ background: 'transparent', border: 'none', color: 'var(--text-secondary)', fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer', outline: 'none' }}
            >
              <option value="all">Todo el tiempo</option>
              <option value="year">Por Año</option>
              <option value="month">Por Mes</option>
              <option value="week">Esta Semana</option>
            </select>
          </div>

          {dateFilter === 'year' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', background: 'rgba(255,255,255,0.03)', padding: '0.4rem 1rem', borderRadius: '10px', border: '1px solid var(--glass-border)' }}>
              <select 
                value={selectedYear} 
                onChange={e => setSelectedYear(e.target.value)}
                style={{ background: 'transparent', border: 'none', color: 'var(--accent-primary)', fontSize: '0.8rem', fontWeight: 700, cursor: 'pointer', outline: 'none' }}
              >
                {availableYears.map(y => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
            </div>
          )}

          {dateFilter === 'month' && availableMonths.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', background: 'rgba(255,255,255,0.03)', padding: '0.4rem 1rem', borderRadius: '10px', border: '1px solid var(--glass-border)' }}>
              <select 
                value={selectedMonth} 
                onChange={e => setSelectedMonth(e.target.value)}
                style={{ background: 'transparent', border: 'none', color: 'var(--accent-primary)', fontSize: '0.8rem', fontWeight: 700, cursor: 'pointer', outline: 'none' }}
              >
                {availableMonths.map(m => {
                  const [y, monthNum] = m.split('-');
                  const date = new Date(y, monthNum - 1);
                  const monthName = date.toLocaleString('es-ES', { month: 'long' });
                  return (
                    <option key={m} value={m}>
                      {monthName.charAt(0).toUpperCase() + monthName.slice(1)} {y}
                    </option>
                  );
                })}
              </select>
            </div>
          )}
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ textAlign: 'left', background: 'rgba(255,255,255,0.01)' }}>
                <th style={{ padding: '1.25rem 2rem', fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Fecha / Cliente</th>
                <th style={{ padding: '1.25rem 2rem', fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Concepto</th>
                <th style={{ padding: '1.25rem 2rem', fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Estado / Pago</th>
                <th style={{ padding: '1.25rem 2rem', fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Total</th>
                <th style={{ padding: '1.25rem 2rem', fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {filteredData.map((item, idx) => {
                const pName = products.find(p => p.id === item.productId)?.name || item.productName || item.description || 'Desconocido';
                const total = type === 'sales' ? (item.total || 0) : (item.amount || 0);
                const paid = type === 'sales' ? (item.payments || []).reduce((acc, curr) => acc + curr.amount, 0) : total;
                const balance = total - paid;

                return (
                  <motion.tr key={item.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: idx * 0.02 }} style={{ borderBottom: '1px solid var(--glass-border)' }}>
                    <td style={{ padding: '1.25rem 2rem' }}>
                      <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '0.25rem' }}>{item.date}</div>
                      <div style={{ fontWeight: 700, fontSize: '0.9rem' }}>{item.customerName || 'Cliente General'}</div>
                    </td>
                    <td style={{ padding: '1.25rem 2rem' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                        {type === 'sales' ? <ArrowUpCircle size={16} color="var(--success)" /> : <ArrowDownCircle size={16} color="var(--error)" />}
                        <div>
                          <div style={{ fontWeight: 700 }}>{pName}</div>
                          {type !== 'expenses' && <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Cantidad: {item.quantity}</div>}
                          {type === 'purchases' && item.supplierName && (
                            <div style={{ fontSize: '0.7rem', color: 'var(--accent-primary)', fontWeight: 600 }}>Proveedor: {item.supplierName}</div>
                          )}
                        </div>
                      </div>
                    </td>
                    <td style={{ padding: '1.25rem 2rem' }}>
                      {type === 'sales' ? (
                        <div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
                            {item.status === 'paid' ? <CheckCircle2 size={14} color="var(--success)" /> : <Clock size={14} color="var(--accent-primary)" />}
                            <span style={{ fontSize: '0.75rem', fontWeight: 800, textTransform: 'uppercase', color: item.status === 'paid' ? 'var(--success)' : 'var(--accent-primary)' }}>
                              {item.status === 'paid' ? 'Pagada' : 'Pendiente'}
                            </span>
                          </div>
                          <div style={{ fontSize: '0.8rem', fontWeight: 600 }}>
                            Pagado: ${Math.round(paid).toLocaleString('es-CO')}
                          </div>
                          {balance > 0 && <div style={{ fontSize: '0.75rem', color: 'var(--error)', fontWeight: 700 }}>Debe: ${Math.round(balance).toLocaleString('es-CO')}</div>}
                        </div>
                      ) : (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--text-muted)', fontSize: '0.8rem' }}>
                          <CreditCard size={14} /> Contado
                        </div>
                      )}
                    </td>
                    <td style={{ padding: '1.25rem 2rem', fontWeight: 800, fontSize: '1rem' }}>
                      ${Math.round(total).toLocaleString('es-CO')}
                    </td>
                    <td style={{ padding: '1.25rem 2rem' }}>
                      <div style={{ display: 'flex', gap: '0.5rem' }}>
                        {type === 'sales' && (
                          <button onClick={() => handlePrintReceipt(item)} style={{ padding: '0.5rem', borderRadius: '8px', background: 'rgba(255,255,255,0.03)', color: 'var(--text-muted)', border: 'none', cursor: 'pointer' }}>
                            <Printer size={16} />
                          </button>
                        )}
                        {type === 'sales' && balance > 0 && (
                          <button onClick={() => setSelectedSale(item)} className="glass" style={{ padding: '0.5rem 0.8rem', borderRadius: '8px', fontSize: '0.7rem', color: 'var(--accent-primary)', fontWeight: 700, border: 'none', cursor: 'pointer' }}>ABONAR</button>
                        )}
                         <button 
                           onClick={() => confirm('¿Estás seguro de eliminar este registro?', () => {
                             onDelete(item.id);
                             notify('Registro eliminado.', 'info');
                           })} 
                           style={{ padding: '0.5rem', borderRadius: '8px', background: 'rgba(255,69,58,0.08)', color: 'var(--error)', border: 'none', cursor: 'pointer' }}
                         >
                           <Trash2 size={16} />
                         </button>
                      </div>
                    </td>
                  </motion.tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Payment Modal */}
      <AnimatePresence>
        {selectedSale && (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', backdropFilter: 'blur(10px)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 10000, padding: '2rem' }}>
            <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }} className="premium-card" style={{ maxWidth: '450px', width: '100%' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '2rem' }}>
                <h3 style={{ color: 'var(--accent-primary)' }}>REGISTRAR ABONO</h3>
                <button onClick={() => setSelectedSale(null)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}><X size={24} /></button>
              </div>
              <p style={{ color: 'var(--text-secondary)', marginBottom: '1.5rem' }}>Registrando pago para la venta de <strong>{selectedSale.productName}</strong> a <strong>{selectedSale.customerName}</strong>.</p>
              
              <div style={{ background: 'rgba(255,255,255,0.02)', padding: '1.5rem', borderRadius: '16px', marginBottom: '2rem', border: '1px solid var(--glass-border)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                  <span style={{ color: 'var(--text-muted)' }}>Total Venta:</span>
                  <span style={{ fontWeight: 700 }}>${Math.round(selectedSale.total).toLocaleString('es-CO')}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--text-muted)' }}>Saldo Pendiente:</span>
                  <span style={{ fontWeight: 800, color: 'var(--error)' }}>${Math.round(selectedSale.total - (selectedSale.payments || []).reduce((acc, c) => acc + c.amount, 0)).toLocaleString('es-CO')}</span>
                </div>
              </div>

              <form onSubmit={handleAddPayment}>
                <label style={{ display: 'block', marginBottom: '0.6rem', fontSize: '0.75rem', fontWeight: 800, color: 'var(--text-muted)' }}>MONTO DEL ABONO (COP)</label>
                <input required autoFocus type="number" value={paymentAmount} onChange={e => setPaymentAmount(e.target.value)} placeholder="Ej: 50000" style={{ width: '100%', marginBottom: '2rem', fontSize: '1.2rem', fontWeight: 700 }} />
                <button type="submit" className="btn-primary" style={{ width: '100%', height: '50px' }}>CONFIRMAR ABONO</button>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default Transactions;
