import React, { useState, useMemo, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, Calendar, ShoppingBag, Receipt, DollarSign, X, Trash2, Search, ArrowDownCircle, ArrowUpCircle, Calculator, User, CreditCard, CheckCircle2, Clock, Printer, Edit2, ListPlus, Eye } from 'lucide-react';
import DetailModal from './DetailModal';
import { NumericFormat } from 'react-number-format';

const Transactions = ({ type, data, products, customers = [], onAdd, onDelete, onUpdate, onAddPayment, notify, confirm, suppliers = [], mostFrequentSupplierId }) => {
  const [isAdding, setIsAdding] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedSale, setSelectedSale] = useState(null);
  const [selectedDetail, setSelectedDetail] = useState(null);
  const [paymentAmount, setPaymentAmount] = useState('');
  const [dateFilter, setDateFilter] = useState('all');
  const [selectedMonth, setSelectedMonth] = useState('');
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear().toString());

  // Cart State for Sales and Purchases
  const [cart, setCart] = useState([]);
  const [currentItem, setCurrentItem] = useState({ productId: '', quantity: '1', unitPrice: '' });

  // Global Form State
  const [formData, setFormData] = useState({
    amount: '', // For expenses mostly
    description: '',
    customerId: '',
    customerName: '',
    phone: '',
    idDocument: '',
    city: '',
    address: '',
    initialPayment: '',
    method: 'Efectivo',
    supplierId: '',
    date: new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' })
  });

  const config = {
    sales: { title: 'Ventas y Cartera', subtitle: 'Gestión de facturación y abonos.', icon: ShoppingBag, color: 'var(--success)', label: 'Registrar Venta', submitText: 'Guardar Venta' },
    purchases: { title: 'Compras', subtitle: 'Entradas de nuevo inventario.', icon: Receipt, color: 'var(--info)', label: 'Registrar Compra', submitText: 'Guardar Compra' },
    expenses: { title: 'Gastos', subtitle: 'Egresos operativos y generales.', icon: DollarSign, color: 'var(--error)', label: 'Registrar Gasto', submitText: 'Guardar Gasto' }
  };

  const productList = useMemo(() => Array.isArray(products) ? products : [], [products]);
  const supplierList = useMemo(() => Array.isArray(suppliers) ? suppliers : [], [suppliers]);
  const dataList = useMemo(() => Array.isArray(data) ? data : [], [data]);

  const availableYears = useMemo(() => {
    const years = dataList.map(item => {
      const d = new Date(item.date);
      return isNaN(d.getTime()) ? null : d.getFullYear().toString();
    }).filter(y => y !== null);
    const currentYear = new Date().getFullYear().toString();
    return [...new Set([...years, currentYear])].sort().reverse();
  }, [dataList]);

  const availableMonths = useMemo(() => {
    const months = dataList.map(item => {
      const d = new Date(item.date);
      if (isNaN(d.getTime())) return null;
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    }).filter(m => m !== null);
    return [...new Set(months)].sort().reverse();
  }, [dataList]);

  useEffect(() => {
    if (!selectedMonth && availableMonths.length > 0) {
      const now = new Date();
      const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      setSelectedMonth(availableMonths.includes(currentMonth) ? currentMonth : availableMonths[0]);
    }
  }, [availableMonths, selectedMonth]);

  // Handle current item price auto-fill
  useEffect(() => {
    if (currentItem.productId && type === 'sales') {
      const product = productList.find(p => String(p.id) === String(currentItem.productId));
      if (product && !currentItem.unitPrice) {
        setCurrentItem(prev => ({ ...prev, unitPrice: String(product.price) }));
      }
    }
  }, [currentItem.productId, productList, type]);

  const filteredData = useMemo(() => {
    const now = new Date();
    return dataList.filter(item => {
      if (!item) return false;
      const itemDate = new Date(item.date);
      let matchesDate = true;
      
      if (dateFilter === 'year') matchesDate = itemDate.getFullYear().toString() === selectedYear;
      else if (dateFilter === 'month') {
        if (!selectedMonth) matchesDate = itemDate.getFullYear() === now.getFullYear() && itemDate.getMonth() === now.getMonth();
        else {
          const [y, m] = selectedMonth.split('-').map(Number);
          matchesDate = itemDate.getFullYear() === y && (itemDate.getMonth() + 1) === m;
        }
      } else if (dateFilter === 'week') {
        const startOfWeek = new Date(now);
        startOfWeek.setDate(now.getDate() - now.getDay());
        startOfWeek.setHours(0,0,0,0);
        const endOfWeek = new Date(startOfWeek);
        endOfWeek.setDate(startOfWeek.getDate() + 6);
        endOfWeek.setHours(23,59,59,999);
        matchesDate = itemDate >= startOfWeek && itemDate <= endOfWeek;
      }

      // Search across items
      let pNames = '';
      if (item.items && item.items.length > 0) {
         pNames = item.items.map(i => i.productName).join(' ');
      } else {
         const product = productList.find(p => p.id === item.productId || p.id === item.inventario_id);
         pNames = product?.name || item.productName || '';
      }
      const searchStr = `${pNames} ${item.description || ''} ${item.customerName || ''}`.toLowerCase();
      
      return matchesDate && searchStr.includes(searchTerm.toLowerCase());
    }).sort((a, b) => (b.id || 0) - (a.id || 0));
  }, [dataList, productList, searchTerm, dateFilter, selectedMonth, selectedYear]);

  const calculatedTotal = useMemo(() => {
    if (type === 'expenses') return parseFloat(formData.amount) || 0;
    if (type === 'purchases') return (parseFloat(currentItem.quantity) || 0) * (parseFloat(currentItem.unitPrice) || 0);
    return cart.reduce((sum, item) => sum + (parseFloat(item.quantity) * parseFloat(item.unitPrice)), 0);
  }, [cart, formData.amount, type, currentItem.quantity, currentItem.unitPrice]);

  const addToCart = () => {
    if (!currentItem.productId || !currentItem.quantity || !currentItem.unitPrice) {
      notify?.('Por favor completa los detalles del producto', 'warning');
      return;
    }
    const product = productList.find(p => String(p.id) === String(currentItem.productId));
    if (!product) return;
    
    // Check stock for sales
    if (type === 'sales' && product.stock < parseInt(currentItem.quantity)) {
      notify?.(`Stock insuficiente. Disponible: ${product.stock}`, 'error');
      return;
    }

    setCart(prev => [...prev, {
      ...currentItem,
      productName: product.name,
      costAtSale: product.costPrice || 0
    }]);
    
    setCurrentItem({ productId: '', quantity: '1', unitPrice: '' });
  };

  const removeFromCart = (index) => {
    setCart(prev => prev.filter((_, i) => i !== index));
  };

  const resetForm = () => {
    setIsAdding(false);
    setEditingId(null);
    setCart([]);
    setCurrentItem({ productId: '', quantity: '1', unitPrice: '' });
    setFormData({ amount: '', description: '', customerId: '', customerName: '', phone: '', idDocument: '', city: '', address: '', initialPayment: '', method: 'Efectivo', supplierId: mostFrequentSupplierId || '', date: new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' }) });
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    let payload;
    
    if (type === 'sales') {
      if (cart.length === 0) {
        notify?.('Agrega al menos un producto', 'error');
        return;
      }
      payload = {
        items: cart,
        total: calculatedTotal,
        date: formData.date,
        customerId: formData.customerId,
        customerName: formData.customerName,
        phone: formData.phone,
        idDocument: formData.idDocument,
        city: formData.city,
        address: formData.address,
        status: (parseFloat(formData.initialPayment) >= calculatedTotal) ? 'paid' : 'pending'
      };
    } else if (type === 'purchases') {
      if (!currentItem.productId) {
        notify?.('Selecciona un producto', 'error');
        return;
      }
      payload = {
        ...formData,
        productId: currentItem.productId,
        quantity: currentItem.quantity,
        amount: calculatedTotal,
        unitPrice: parseFloat(currentItem.unitPrice || 0)
      };
    } else {
      payload = {
        ...formData
      };
    }

    if (editingId) {
      onUpdate(editingId, payload);
    } else {
      onAdd(payload);
    }
    resetForm();
  };

  const handleEdit = (item) => {
    setEditingId(item.id);
    
    // Convert old single item format or new multi-item format into cart
    let loadedCart = [];
    if (item.items && item.items.length > 0) {
      loadedCart = item.items.map(i => ({
        productId: String(i.productId),
        productName: i.productName,
        quantity: String(i.quantity),
        unitPrice: String(i.unitPrice),
        costAtSale: i.costAtSale
      }));
    } else if (item.productId) {
      const product = productList.find(p => p.id === item.productId || p.id === item.inventario_id);
      loadedCart = [{
        productId: String(item.productId || item.inventario_id),
        productName: item.productName || product?.name || 'Desconocido',
        quantity: String(item.quantity || 1),
        unitPrice: String(item.unitPrice || (item.total / item.quantity) || item.total),
        costAtSale: item.costAtSale || 0
      }];
    }

    if (type === 'purchases') {
      setCurrentItem({
        productId: String(item.productId || item.inventario_id || ''),
        quantity: String(item.quantity || '1'),
        unitPrice: String(item.unitPrice || (item.total / item.quantity) || item.amount / item.quantity || '0')
      });
      setFormData({
        amount: String(item.total || item.amount || '0'),
        description: item.description || '',
        customerName: item.customerName || '',
        initialPayment: '0',
        method: item.method || 'Efectivo',
        supplierId: item.supplierId || '',
        date: item.date ? new Date(item.date).toLocaleDateString('en-CA', { timeZone: 'America/Bogota' }) : new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' })
      });
    } else {
      setCart(loadedCart);
      setFormData({
        amount: String(item.total || item.amount || '0'),
        description: item.description || '',
        customerId: item.customerId || '',
        customerName: item.customerName || '',
        phone: item.phone || '',
        idDocument: item.idDocument || '',
        city: item.city || '',
        address: item.address || '',
        initialPayment: '0',
        method: item.method || 'Efectivo',
        supplierId: item.supplierId || '',
        date: item.date ? new Date(item.date).toLocaleDateString('en-CA', { timeZone: 'America/Bogota' }) : new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' })
      });
    }
    
    setIsAdding(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleAddPayment = (e) => {
    e.preventDefault();
    if (!selectedSale || !paymentAmount) return;
    onAddPayment(selectedSale.id, { amount: parseFloat(paymentAmount), date: new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' }), method: 'Efectivo' });
    setSelectedSale(null);
    setPaymentAmount('');
  };

  const handlePrintReceipt = (item) => {
    const paid = (item.payments || []).reduce((acc, curr) => acc + (parseFloat(curr.amount) || 0), 0);
    const total = parseFloat(item.total || item.amount || 0);
    const balance = total - paid;
    
    let itemsHtml = '';
    if (item.items && item.items.length > 0) {
      itemsHtml = item.items.map(i => `
        <div style="display: flex; justify-content: space-between; margin-bottom: 5px;">
          <span>${i.productName} (x${i.quantity})</span>
          <span>$${Math.round(i.quantity * i.unitPrice).toLocaleString('es-CO')}</span>
        </div>
      `).join('');
    } else {
      itemsHtml = `
        <div style="display: flex; justify-content: space-between; margin-bottom: 5px;">
          <span>${item.productName || item.description || 'Producto'} (x${item.quantity || 1})</span>
          <span>$${Math.round(total).toLocaleString('es-CO')}</span>
        </div>
      `;
    }

    const printWindow = window.open('', '_blank');
    printWindow.document.write(`
      <html>
        <head>
          <title>Recibo - Alta Densidad</title>
          <style>
            @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;700;900&display=swap');
            body { 
              font-family: 'Inter', sans-serif; 
              color: #000; 
              width: 380px; 
              margin: 0 auto; 
              padding: 20px;
              font-size: 12px;
              line-height: 1.5;
            }
            .header { text-align: center; margin-bottom: 20px; }
            .logo { font-weight: 900; font-size: 20px; letter-spacing: 2px; margin-bottom: 5px; }
            .subtitle { font-size: 9px; text-transform: uppercase; letter-spacing: 1px; color: #666; }
            .divider { border-top: 1px dashed #000; margin: 15px 0; }
            .info-row { display: flex; justify-content: space-between; gap: 10px; margin-bottom: 4px; }
            .label { font-weight: 700; text-transform: uppercase; font-size: 10px; white-space: nowrap; }
            .value { text-align: right; word-break: break-all; }
            .total-section { font-size: 15px; font-weight: 900; margin-top: 15px; border-top: 2px solid #000; padding-top: 10px; }
            .footer { text-align: center; margin-top: 40px; font-size: 10px; color: #555; }
            @media print {
              body { width: 100%; max-width: 400px; margin: 0 auto; padding: 10px; }
            }
          </style>
        </head>
        <body>
          <div class="header">
            <div class="logo">ALTA DENSIDAD</div>
            <div class="subtitle">Premium Management System</div>
          </div>
          
          <div class="divider"></div>
          
          <div class="info-row"><span class="label">Ticket #</span><span class="value">${String(item.id).padStart(6, '0')}</span></div>
          <div class="info-row"><span class="label">Fecha</span><span class="value">${item.date}</span></div>
          <div class="info-row"><span class="label">Cliente</span><span class="value">${item.customerName || 'Cliente General'}</span></div>
          ${item.idDocument ? `<div class="info-row"><span class="label">ID/Cédula</span><span class="value">${item.idDocument}</span></div>` : ''}
          ${item.phone ? `<div class="info-row"><span class="label">Teléfono</span><span class="value">${item.phone}</span></div>` : ''}
          
          <div class="divider"></div>
          
          <div class="label" style="margin-bottom: 10px; font-size: 11px;">DETALLE DE COMPRA</div>
          <div style="margin-bottom: 5px;">
            ${item.items && item.items.length > 0 ? 
              item.items.map(i => `
                <div style="display: flex; justify-content: space-between; gap: 10px; margin-bottom: 8px;">
                  <span style="flex: 1;">${i.productName} (x${i.quantity})</span>
                  <span style="font-weight: 700;">$${Math.round(i.quantity * i.unitPrice).toLocaleString('es-CO')}</span>
                </div>
              `).join('') :
              `<div style="display: flex; justify-content: space-between; gap: 10px; margin-bottom: 8px;">
                <span style="flex: 1;">${item.productName || item.description || 'Producto'} (x${item.quantity || 1})</span>
                <span style="font-weight: 700;">$${Math.round(total).toLocaleString('es-CO')}</span>
              </div>`
            }
          </div>
          
          <div class="divider"></div>
          
          <div class="info-row"><span class="label">Subtotal</span><span style="font-weight: 700;">$${Math.round(total).toLocaleString('es-CO')}</span></div>
          <div class="info-row"><span class="label">Pagado</span><span style="font-weight: 700;">$${Math.round(paid).toLocaleString('es-CO')}</span></div>
          
          <div class="info-row total-section">
            <span class="label" style="font-size: 12px;">TOTAL PENDIENTE</span>
            <span>$${Math.round(balance).toLocaleString('es-CO')}</span>
          </div>
          
          <div class="footer">
            <p>¡Gracias por su compra!</p>
            <p style="font-weight: 700;">Alta Densidad - Fragancias & Estilo</p>
            <p>${new Date().toLocaleString('es-CO')}</p>
          </div>
        </body>
      </html>
    `);
    printWindow.document.close();
    printWindow.print();
  };

  const Icon = config[type].icon;

  return (
    <div className="main-content">
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '3rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1.5rem' }}>
          <div style={{ padding: '1rem', borderRadius: '20px', background: 'rgba(255,255,255,0.03)', border: '1px solid var(--glass-border)', color: config[type].color }}><Icon size={32} /></div>
          <div>
            <h2 className="title-gradient" style={{ fontSize: '2.5rem', marginBottom: '0.25rem' }}>{config[type].title}</h2>
            <p style={{ color: 'var(--text-secondary)', fontWeight: 500 }}>{config[type].subtitle}</p>
          </div>
        </div>
        <button onClick={() => { if(!isAdding) setIsAdding(true); else resetForm(); }} className="btn-primary" style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}><Plus size={20} />{config[type].label}</button>
      </header>

      <AnimatePresence>
        {isAdding && (
          <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }} className="premium-card" style={{ marginBottom: '3rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1.5rem' }}>
              <h4 style={{ color: 'var(--accent-primary)' }}>{editingId ? 'EDITAR REGISTRO' : `NUEVO REGISTRO DE ${config[type].title.toUpperCase()}`}</h4>
              <button onClick={resetForm} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}><X size={20} /></button>
            </div>
            
            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
              
              {/* Header Info */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1.5rem' }}>
                {type === 'sales' && (
                  <>
                    <div style={{ gridColumn: '1 / -1' }}>
                      <h5 style={{ fontSize: '0.85rem', color: 'var(--accent-primary)', marginBottom: '1rem', textTransform: 'uppercase', letterSpacing: '1px' }}>Datos del Cliente</h5>
                    </div>
                    <div style={{ gridColumn: '1 / -1', display: 'flex', gap: '1rem', alignItems: 'flex-end' }}>
                      <div style={{ flex: 1 }}>
                        <label style={{ display: 'block', marginBottom: '0.6rem', fontSize: '0.75rem', fontWeight: 800, color: 'var(--text-muted)' }}>SELECCIONAR CLIENTE</label>
                        <select 
                          value={formData.customerId || 'NEW'} 
                          onChange={(e) => {
                            const cid = e.target.value;
                            if (cid === 'NEW') {
                              setFormData(prev => ({...prev, customerId: '', customerName: '', phone: '', idDocument: '', city: '', address: ''}));
                            } else {
                              const cust = customers.find(c => String(c.id) === String(cid));
                              if (cust) {
                                setFormData(prev => ({
                                  ...prev, 
                                  customerId: cust.id, 
                                  customerName: cust.nombre, 
                                  phone: cust.telefono || '', 
                                  idDocument: cust.cedula || '', 
                                  city: cust.ciudad || '', 
                                  address: cust.direccion || ''
                                }));
                              }
                            }
                          }}
                          style={{ width: '100%', height: '45px' }}
                        >
                          <option value="NEW">+ Crear Nuevo Cliente</option>
                          {customers.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                        </select>
                      </div>
                    </div>
                    <div>
                      <label style={{ display: 'block', marginBottom: '0.6rem', fontSize: '0.75rem', fontWeight: 800, color: 'var(--text-muted)' }}>NOMBRE (Obligatorio)</label>
                      <input required type="text" readOnly={!!formData.customerId} value={formData.customerName} onChange={e => setFormData({...formData, customerName: e.target.value})} placeholder="Nombre del cliente" style={{ width: '100%', opacity: formData.customerId ? 0.7 : 1 }} />
                    </div>
                    <div>
                      <label style={{ display: 'block', marginBottom: '0.6rem', fontSize: '0.75rem', fontWeight: 800, color: 'var(--text-muted)' }}>CÉDULA / NIT</label>
                      <input type="text" readOnly={!!formData.customerId} value={formData.idDocument} onChange={e => setFormData({...formData, idDocument: e.target.value})} placeholder="Opcional" style={{ width: '100%', opacity: formData.customerId ? 0.7 : 1 }} />
                    </div>
                    <div>
                      <label style={{ display: 'block', marginBottom: '0.6rem', fontSize: '0.75rem', fontWeight: 800, color: 'var(--text-muted)' }}>TELÉFONO</label>
                      <input type="text" readOnly={!!formData.customerId} value={formData.phone} onChange={e => setFormData({...formData, phone: e.target.value})} placeholder="Opcional" style={{ width: '100%', opacity: formData.customerId ? 0.7 : 1 }} />
                    </div>
                    <div>
                      <label style={{ display: 'block', marginBottom: '0.6rem', fontSize: '0.75rem', fontWeight: 800, color: 'var(--text-muted)' }}>CIUDAD / MUNICIPIO</label>
                      <input type="text" readOnly={!!formData.customerId} value={formData.city} onChange={e => setFormData({...formData, city: e.target.value})} placeholder="Opcional" style={{ width: '100%', opacity: formData.customerId ? 0.7 : 1 }} />
                    </div>
                    <div style={{ gridColumn: '1 / -1' }}>
                      <label style={{ display: 'block', marginBottom: '0.6rem', fontSize: '0.75rem', fontWeight: 800, color: 'var(--text-muted)' }}>DIRECCIÓN</label>
                      <input type="text" readOnly={!!formData.customerId} value={formData.address} onChange={e => setFormData({...formData, address: e.target.value})} placeholder="Opcional" style={{ width: '100%', opacity: formData.customerId ? 0.7 : 1 }} />
                    </div>
                    <div style={{ gridColumn: '1 / -1', height: '1px', background: 'var(--glass-border)', margin: '1rem 0' }} />
                  </>
                )}
                {type === 'purchases' && (
                  <div>
                    <label style={{ display: 'block', marginBottom: '0.6rem', fontSize: '0.75rem', fontWeight: 800, color: 'var(--text-muted)' }}>PROVEEDOR</label>
                    <select value={formData.supplierId} onChange={e => setFormData({...formData, supplierId: e.target.value})} style={{ width: '100%', height: '45px' }}>
                      <option value="">Seleccionar Proveedor...</option>
                      {supplierList.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                  </div>
                )}
                {type === 'expenses' && (
                  <div style={{ gridColumn: 'span 2' }}>
                    <label style={{ display: 'block', marginBottom: '0.6rem', fontSize: '0.75rem', fontWeight: 800, color: 'var(--text-muted)' }}>DESCRIPCIÓN</label>
                    <input required type="text" value={formData.description} onChange={e => setFormData({...formData, description: e.target.value})} style={{ width: '100%' }} />
                  </div>
                )}
                <div>
                  <label style={{ display: 'block', marginBottom: '0.6rem', fontSize: '0.75rem', fontWeight: 800, color: 'var(--text-muted)' }}>FECHA</label>
                  <input required type="date" value={formData.date} onChange={e => setFormData({...formData, date: e.target.value})} style={{ width: '100%' }} />
                </div>
                {type === 'sales' && (
                  <div>
                    <label style={{ display: 'block', marginBottom: '0.6rem', fontSize: '0.75rem', fontWeight: 800, color: 'var(--text-muted)' }}>MÉTODO DE PAGO</label>
                    <select required value={formData.method} onChange={e => setFormData({...formData, method: e.target.value})} style={{ width: '100%', height: '45px' }}>
                      <option value="Efectivo">Efectivo</option>
                      <option value="Transferencia">Transferencia</option>
                    </select>
                  </div>
                )}
              </div>

              {/* Cart Section for Sales */}
              {type === 'sales' && (
                <div style={{ background: 'rgba(0,0,0,0.2)', padding: '1.5rem', borderRadius: '16px', border: '1px solid rgba(255,255,255,0.05)' }}>
                  <h5 style={{ marginBottom: '1rem', color: 'var(--text-secondary)' }}>Añadir Productos</h5>
                  <div style={{ display: 'flex', gap: '1rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
                    <div style={{ flex: 2, minWidth: '200px' }}>
                      <label style={{ display: 'block', marginBottom: '0.6rem', fontSize: '0.75rem', color: 'var(--text-muted)' }}>PRODUCTO</label>
                      <select value={currentItem.productId} onChange={e => setCurrentItem({...currentItem, productId: e.target.value})} style={{ width: '100%', height: '45px' }}>
                        <option value="">Seleccionar...</option>
                        {productList.map(p => <option key={p.id} value={p.id}>{p.name} (Stock: {p.stock})</option>)}
                      </select>
                    </div>
                    <div style={{ flex: 1, minWidth: '100px' }}>
                      <label style={{ display: 'block', marginBottom: '0.6rem', fontSize: '0.75rem', color: 'var(--text-muted)' }}>CANTIDAD</label>
                      <NumericFormat thousandSeparator="." decimalSeparator="," allowNegative={false} value={currentItem.quantity} onValueChange={(values) => setCurrentItem({...currentItem, quantity: values.value})} style={{ width: '100%' }} />
                    </div>
                    <div style={{ flex: 1, minWidth: '120px' }}>
                      <label style={{ display: 'block', marginBottom: '0.6rem', fontSize: '0.75rem', color: 'var(--text-muted)' }}>P. UNITARIO</label>
                      <NumericFormat thousandSeparator="." decimalSeparator="," allowNegative={false} value={currentItem.unitPrice} onValueChange={(values) => setCurrentItem({...currentItem, unitPrice: values.value})} style={{ width: '100%' }} />
                    </div>
                    <button type="button" onClick={addToCart} style={{ height: '45px', padding: '0 1.5rem', background: 'var(--glass-bg)', color: 'var(--accent-primary)', border: '1px solid var(--accent-primary)', borderRadius: '10px', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                      <ListPlus size={18} /> Añadir
                    </button>
                  </div>

                  {/* Cart Items Table */}
                  {cart.length > 0 && (
                    <div style={{ marginTop: '1.5rem', background: 'var(--bg-main)', borderRadius: '12px', overflow: 'hidden' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                        <thead>
                          <tr style={{ background: 'rgba(255,255,255,0.02)', textAlign: 'left' }}>
                            <th style={{ padding: '0.75rem 1rem', fontSize: '0.75rem', color: 'var(--text-muted)' }}>Producto</th>
                            <th style={{ padding: '0.75rem 1rem', fontSize: '0.75rem', color: 'var(--text-muted)' }}>Cant.</th>
                            <th style={{ padding: '0.75rem 1rem', fontSize: '0.75rem', color: 'var(--text-muted)' }}>P. Unit</th>
                            <th style={{ padding: '0.75rem 1rem', fontSize: '0.75rem', color: 'var(--text-muted)' }}>Subtotal</th>
                            <th></th>
                          </tr>
                        </thead>
                        <tbody>
                          {cart.map((item, idx) => (
                            <tr key={idx} style={{ borderBottom: '1px solid var(--glass-border)' }}>
                              <td style={{ padding: '0.75rem 1rem', fontWeight: 600 }}>{item.productName}</td>
                              <td style={{ padding: '0.75rem 1rem' }}>{item.quantity}</td>
                              <td style={{ padding: '0.75rem 1rem' }}>${Math.round(item.unitPrice).toLocaleString('es-CO')}</td>
                              <td style={{ padding: '0.75rem 1rem', color: 'var(--accent-primary)', fontWeight: 700 }}>${Math.round(item.quantity * item.unitPrice).toLocaleString('es-CO')}</td>
                              <td style={{ padding: '0.75rem 1rem', textAlign: 'right' }}>
                                <button type="button" onClick={() => removeFromCart(idx)} style={{ background: 'none', border: 'none', color: 'var(--error)', cursor: 'pointer' }}><Trash2 size={16} /></button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}

              {/* Single Product Section for Purchases */}
              {type === 'purchases' && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1.5rem', background: 'rgba(0,0,0,0.2)', padding: '1.5rem', borderRadius: '16px', border: '1px solid rgba(255,255,255,0.05)' }}>
                  <div>
                    <label style={{ display: 'block', marginBottom: '0.6rem', fontSize: '0.75rem', fontWeight: 800, color: 'var(--text-muted)' }}>PRODUCTO A COMPRAR</label>
                    <select required value={currentItem.productId} onChange={e => setCurrentItem({...currentItem, productId: e.target.value})} style={{ width: '100%', height: '45px' }}>
                      <option value="">Seleccionar Producto...</option>
                      {productList.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label style={{ display: 'block', marginBottom: '0.6rem', fontSize: '0.75rem', fontWeight: 800, color: 'var(--text-muted)' }}>CANTIDAD</label>
                    <NumericFormat required thousandSeparator="." decimalSeparator="," allowNegative={false} value={currentItem.quantity} onValueChange={(values) => setCurrentItem({...currentItem, quantity: values.value})} style={{ width: '100%' }} />
                  </div>
                  <div>
                    <label style={{ display: 'block', marginBottom: '0.6rem', fontSize: '0.75rem', fontWeight: 800, color: 'var(--text-muted)' }}>PRECIO UNITARIO</label>
                    <NumericFormat required thousandSeparator="." decimalSeparator="," allowNegative={false} value={currentItem.unitPrice} onValueChange={(values) => setCurrentItem({...currentItem, unitPrice: values.value})} style={{ width: '100%' }} />
                  </div>
                </div>
              )}

              {/* Totals & Payments */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '2rem', background: 'rgba(226, 176, 76, 0.05)', padding: '1.5rem', borderRadius: '16px', border: '1px solid rgba(226, 176, 76, 0.1)' }}>
                {type === 'expenses' ? (
                  <div style={{ flex: 1 }}>
                    <label style={{ display: 'block', marginBottom: '0.6rem', fontSize: '0.75rem', fontWeight: 800, color: 'var(--text-muted)' }}>MONTO TOTAL</label>
                    <NumericFormat required thousandSeparator="." decimalSeparator="," allowNegative={false} value={formData.amount} onValueChange={(values) => setFormData({...formData, amount: values.value})} style={{ width: '100%', maxWidth: '300px', fontSize: '1.5rem', fontWeight: 800, color: 'var(--error)' }} />
                  </div>
                ) : (
                  <div>
                    <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', textTransform: 'uppercase', fontWeight: 800, display: 'block', marginBottom: '0.5rem' }}>Total a Pagar</span>
                    <span style={{ fontSize: '2.5rem', fontWeight: 900, color: 'var(--accent-primary)' }}>${Math.round(calculatedTotal).toLocaleString('es-CO')}</span>
                  </div>
                )}

                {type === 'sales' && (
                  <div style={{ flex: 1, minWidth: '200px' }}>
                    <label style={{ display: 'block', marginBottom: '0.6rem', fontSize: '0.75rem', fontWeight: 800, color: 'var(--text-muted)' }}>ABONO INICIAL (Opcional)</label>
                    <NumericFormat thousandSeparator="." decimalSeparator="," allowNegative={false} value={formData.initialPayment} onValueChange={(values) => setFormData({...formData, initialPayment: values.value})} placeholder="Ej. 50000" style={{ width: '100%' }} />
                  </div>
                )}

                <div style={{ display: 'flex', gap: '1rem', width: '100%', maxWidth: '400px' }}>
                  {editingId && <button type="button" onClick={resetForm} className="btn-secondary" style={{ flex: 1 }}>Cancelar</button>}
                  <button type="submit" className="btn-primary" style={{ flex: 2, height: '50px' }}>{editingId ? 'Actualizar Registro' : config[type].submitText}</button>
                </div>
              </div>

            </form>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="premium-card" style={{ padding: 0 }}>
        <div style={{ padding: '1.5rem 2rem', borderBottom: '1px solid var(--glass-border)', display: 'flex', gap: '1rem', alignItems: 'center' }}>
          <Search size={18} color="var(--text-muted)" />
          <input type="text" placeholder="Buscar..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} style={{ flex: 1, background: 'transparent', border: 'none', color: '#fff' }} />
          <select value={dateFilter} onChange={e => setDateFilter(e.target.value)} style={{ background: 'transparent', border: 'none', color: 'var(--accent-primary)', fontWeight: 600 }}>
            <option value="all">Todo</option>
            <option value="month">Mes</option>
            <option value="year">Año</option>
          </select>
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ textAlign: 'left', background: 'rgba(255,255,255,0.01)' }}>
                <th style={{ padding: '1.25rem 2rem', fontSize: '0.7rem', color: 'var(--text-muted)' }}>FECHA / CLIENTE</th>
                <th style={{ padding: '1.25rem 2rem', fontSize: '0.7rem', color: 'var(--text-muted)' }}>CONCEPTOS</th>
                <th style={{ padding: '1.25rem 2rem', fontSize: '0.7rem', color: 'var(--text-muted)' }}>ESTADO</th>
                <th style={{ padding: '1.25rem 2rem', fontSize: '0.7rem', color: 'var(--text-muted)' }}>TOTAL</th>
                <th style={{ padding: '1.25rem 2rem', fontSize: '0.7rem', color: 'var(--text-muted)' }}>ACCIONES</th>
              </tr>
            </thead>
            <tbody>
              {filteredData.map((item) => {
                const supplier = supplierList.find(s => s.id === item.supplierId || s.id == item.supplierId);
                const total = parseFloat(item.total || item.amount || 0);
                const paid = (item.payments || []).reduce((acc, curr) => acc + (parseFloat(curr.amount) || 0), 0);
                const balance = total - paid;
                
                let conceptHtml = null;
                if (type === 'expenses') {
                  conceptHtml = <div style={{ fontWeight: 700 }}>{item.description}</div>;
                } else if (item.items && item.items.length > 0) {
                  conceptHtml = (
                    <div>
                      <div style={{ fontWeight: 700 }}>{item.items.length} producto(s)</div>
                      <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{item.items.map(i => i.productName).join(', ').substring(0, 40)}...</div>
                    </div>
                  );
                } else {
                  const product = productList.find(p => p.id === item.productId || p.id === item.inventario_id);
                  const pName = product?.name || item.productName || 'Desconocido';
                  conceptHtml = (
                    <div>
                      <div style={{ fontWeight: 700 }}>{pName}</div>
                      {supplier && <div style={{ fontSize: '0.7rem', color: 'var(--accent-primary)' }}>Prov: {supplier.name}</div>}
                      {item.quantity && <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Cant: {item.quantity}</div>}
                    </div>
                  );
                }

                return (
                  <motion.tr key={item.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} style={{ borderBottom: '1px solid var(--glass-border)' }}>
                    <td style={{ padding: '1.25rem 2rem' }}>
                      <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{item.date}</div>
                      <div style={{ fontWeight: 700 }}>{item.customerName || (type === 'purchases' ? 'Compra' : 'General')}</div>
                    </td>
                    <td style={{ padding: '1.25rem 2rem' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        {type === 'sales' ? <ArrowUpCircle size={14} color="var(--success)" /> : <ArrowDownCircle size={14} color="var(--error)" />}
                        {conceptHtml}
                      </div>
                    </td>
                    <td style={{ padding: '1.25rem 2rem' }}>
                      {type === 'sales' ? (
                        <span style={{ fontSize: '0.7rem', fontWeight: 800, color: item.status === 'paid' ? 'var(--success)' : 'var(--warning)' }}>{item.status === 'paid' ? 'PAGADA' : 'PENDIENTE'}</span>
                      ) : <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>CONTADO</span>}
                    </td>
                    <td style={{ padding: '1.25rem 2rem', fontWeight: 800 }}>${Math.round(total).toLocaleString('es-CO')}</td>
                    <td style={{ padding: '1.25rem 2rem' }}>
                      <div style={{ display: 'flex', gap: '0.5rem' }}>
                        <button onClick={() => setSelectedDetail(item)} style={{ background: 'var(--info)', color: 'white', border: 'none', padding: '0.4rem', borderRadius: '6px', cursor: 'pointer' }} title="Ver Detalles"><Eye size={14} /></button>
                        <button onClick={() => handleEdit(item)} style={{ background: 'var(--accent-primary)', color: 'white', border: 'none', padding: '0.4rem', borderRadius: '6px', cursor: 'pointer' }}><Edit2 size={14} /></button>
                        <button onClick={() => confirm('¿Eliminar registro?', () => onDelete(item.id))} style={{ background: 'rgba(239, 68, 68, 0.1)', color: '#ef4444', border: 'none', padding: '0.4rem', borderRadius: '6px', cursor: 'pointer' }}><Trash2 size={14} /></button>
                        {type === 'sales' && <button onClick={() => handlePrintReceipt(item)} style={{ background: 'rgba(255,255,255,0.05)', color: 'var(--text-primary)', border: 'none', padding: '0.4rem', borderRadius: '6px', cursor: 'pointer' }}><Printer size={14} /></button>}
                        {type === 'sales' && balance > 0 && <button onClick={() => setSelectedSale(item)} style={{ background: 'var(--glass-bg)', color: 'var(--accent-primary)', border: '1px solid var(--accent-primary)', padding: '0.4rem 0.8rem', borderRadius: '6px', fontSize: '0.7rem', fontWeight: 700, cursor: 'pointer' }}>ABONAR</button>}
                      </div>
                    </td>
                  </motion.tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <AnimatePresence>
        {selectedSale && (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', backdropFilter: 'blur(10px)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 10000 }}>
            <motion.div initial={{ scale: 0.9 }} animate={{ scale: 1 }} className="premium-card" style={{ maxWidth: '400px', width: '90%' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1.5rem' }}>
                <h3 style={{ color: 'var(--accent-primary)' }}>ABONAR</h3>
                <button onClick={() => setSelectedSale(null)} style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer' }}><X size={24} /></button>
              </div>
              <form onSubmit={handleAddPayment}>
                <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.8rem' }}>MONTO DEL ABONO (COP)</label>
                <NumericFormat required thousandSeparator="." decimalSeparator="," allowNegative={false} value={paymentAmount} onValueChange={(values) => setPaymentAmount(values.value)} style={{ width: '100%', marginBottom: '1.5rem', fontSize: '1.2rem' }} />
                <button type="submit" className="btn-primary" style={{ width: '100%' }}>CONFIRMAR</button>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {selectedDetail && (
          <DetailModal 
            item={selectedDetail} 
            type={type} 
            onClose={() => setSelectedDetail(null)} 
            suppliers={suppliers} 
            products={products || []} 
          />
        )}
      </AnimatePresence>
    </div>
  );
};

export default Transactions;
