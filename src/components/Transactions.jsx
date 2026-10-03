import React, { useState, useMemo, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import Ventana from './Ventana';
import { Plus, Calendar, ShoppingBag, Receipt, DollarSign, X, Trash2, Search, ArrowDownCircle, ArrowUpCircle, Calculator, User, CreditCard, CheckCircle2, Clock, Printer, Edit2, ListPlus, Eye } from 'lucide-react';
import DetailModal from './DetailModal';
import { NumericFormat } from 'react-number-format';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { paidAmount, balanceOf } from '../utils/sales';
import { api } from '../services/api';

const Transactions = ({ type, data, products, customers = [], onAdd, onDelete, onUpdate, onAddPayment, notify, confirm, suppliers = [], mostFrequentSupplierId }) => {
  const [isAdding, setIsAdding] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedSale, setSelectedSale] = useState(null);
  const [selectedDetail, setSelectedDetail] = useState(null);
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('Efectivo');
  // Listas cerradas del servidor (métodos de pago, categorías de gasto)
  const [metodos, setMetodos] = useState([{ name: 'Efectivo' }, { name: 'Transferencia' }]);
  const [categorias, setCategorias] = useState([]);
  useEffect(() => {
    if (type === 'sales') api.get('/payment-methods').then(l => Array.isArray(l) && l.length && setMetodos(l)).catch(() => {});
    if (type === 'expenses') api.get('/expense-categories').then(l => Array.isArray(l) && setCategorias(l)).catch(() => {});
  }, [type]);
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

  // Al elegir el producto se propone su precio (de venta en ventas, de costo en compras); se puede cambiar
  const elegirProducto = (productId) => {
    const product = productList.find(p => String(p.id) === String(productId));
    const sugerido = product ? Number(type === 'purchases' ? product.costPrice : product.price) : 0;
    setCurrentItem(c => ({ ...c, productId, unitPrice: sugerido > 0 ? String(sugerido) : '' }));
  };

  const pesos = (v) => `$${Math.round(Number(v) || 0).toLocaleString('es-CO')}`;

  const addToCart = () => {
    if (!currentItem.productId) {
      notify?.('Selecciona el producto.', 'warning');
      return;
    }
    if (!(parseFloat(currentItem.quantity) > 0)) {
      notify?.('La cantidad debe ser mayor que 0.', 'warning');
      return;
    }
    if (!(parseFloat(currentItem.unitPrice) > 0)) {
      notify?.('El precio unitario es obligatorio y debe ser mayor que 0.', 'warning');
      return;
    }
    const product = productList.find(p => String(p.id) === String(currentItem.productId));
    if (!product) return;
    
    // Check stock for sales
    if (type === 'sales' && product.stock < parseFloat(currentItem.quantity)) {
      notify?.(`Stock insuficiente. Disponible: ${product.stock}`, 'error');
      return;
    }

    const anadir = () => {
      setCart(prev => [...prev, {
        ...currentItem,
        productName: product.name,
        costAtSale: product.costPrice || 0
      }]);
      setCurrentItem({ productId: '', quantity: '1', unitPrice: '' });
    };
    // Vender por debajo del costo es pérdida: se pide confirmación
    const costo = Number(product.costPrice) || 0;
    if (type === 'sales' && costo > 0 && parseFloat(currentItem.unitPrice) < costo) {
      confirm?.(`${product.name} se vendería a ${pesos(currentItem.unitPrice)}, por debajo de su costo (${pesos(costo)}). ¿Añadir de todos modos?`, anadir);
      return;
    }
    anadir();
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

  const [guardando, setGuardando] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (guardando) return;
    let payload;
    
    if (type === 'sales') {
      if (cart.length === 0) {
        notify?.('Agrega al menos un producto', 'error');
        return;
      }
      // Un producto elegido pero sin pulsar "Añadir" no entraría en la venta
      if (currentItem.productId) {
        notify?.('Tienes un producto seleccionado sin añadir: pulsa «Añadir» o quítalo antes de registrar.', 'warning');
        return;
      }
      if (!String(formData.customerName || '').trim()) {
        notify?.('El nombre del cliente es obligatorio.', 'warning');
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
        status: (parseFloat(formData.initialPayment) >= calculatedTotal) ? 'paid' : 'pending',
        initialPayment: parseFloat(formData.initialPayment) || 0,
        method: formData.method
      };
    } else if (type === 'purchases') {
      if (!currentItem.productId) {
        notify?.('Selecciona un producto', 'error');
        return;
      }
      if (!(parseFloat(currentItem.quantity) > 0) || !(parseFloat(currentItem.unitPrice) > 0)) {
        notify?.('La cantidad y el precio unitario deben ser mayores que 0.', 'warning');
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
      if (!String(formData.description || '').trim() || !(parseFloat(formData.amount) > 0)) {
        notify?.('La descripción y un monto mayor que 0 son obligatorios.', 'warning');
        return;
      }
      payload = {
        ...formData
      };
    }

    setGuardando(true);
    const ok = editingId ? await onUpdate(editingId, payload) : await onAdd(payload);
    setGuardando(false);
    // Si el servidor rechaza el registro, el formulario se conserva para corregirlo
    if (ok !== false) resetForm();
  };

  const handleEdit = (item) => {
    setEditingId(item.id);
    
    // Convert old single item format or new multi-item format into cart
    let loadedCart = [];
    if (item.items && item.items.length > 0) {
      loadedCart = item.items.map(i => ({
        productId: i.productId ? String(i.productId) : '',
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
        category: item.category || '',
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
    const amount = parseFloat(paymentAmount);
    const saldo = balanceOf(selectedSale);
    if (!(amount > 0)) {
      notify?.('El abono debe ser mayor a cero.', 'warning');
      return;
    }
    if (amount - saldo > 0.01) {
      notify?.(`El abono supera el saldo pendiente ($${Math.round(saldo).toLocaleString('es-CO')}).`, 'warning');
      return;
    }
    onAddPayment(selectedSale.id, { amount, date: new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' }), method: paymentMethod });
    setPaymentMethod('Efectivo');
    setSelectedSale(null);
    setPaymentAmount('');
  };

  const handlePrintReceipt = (item) => {
    const paid = paidAmount(item);
    const total = parseFloat(item.total || item.amount || 0);
    const balance = balanceOf(item);

    // Create PDF with ticket-like dimensions (80mm width is common for thermal printers)
    // For standard PDF viewers, we'll use a larger width but keep the ticket layout
    const doc = new jsPDF({
      unit: 'mm',
      format: [80, 200] // 80mm width, 200mm height (will auto-expand if needed, or we just use enough)
    });

    const pageWidth = doc.internal.pageSize.width;
    let currentY = 15;

    // Header
    doc.setFontSize(14);
    doc.setTextColor(20, 20, 22);
    doc.setFont('helvetica', 'bold');
    doc.text('ALTA DENSIDAD', pageWidth / 2, currentY, { align: 'center' });
    
    currentY += 5;
    doc.setFontSize(8);
    doc.text('NIT: 1025762052-4', pageWidth / 2, currentY, { align: 'center' });

    currentY += 4;
    doc.setFontSize(7);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(100, 100, 100);
    doc.text('Premium Management System', pageWidth / 2, currentY, { align: 'center' });

    currentY += 8;
    doc.setDrawColor(200, 200, 200);
    doc.line(10, currentY, pageWidth - 10, currentY);

    // Info
    currentY += 8;
    doc.setFontSize(8);
    doc.setTextColor(50, 50, 50);
    doc.text(`TICKET #: ${String(item.id).padStart(6, '0')}`, 10, currentY);
    currentY += 4;
    doc.text(`FECHA: ${item.date}`, 10, currentY);
    currentY += 4;
    doc.text(`CLIENTE: ${item.customerName || 'Cliente General'}`, 10, currentY);
    
    if (item.idDocument) {
      currentY += 4;
      doc.text(`ID/NIT: ${item.idDocument}`, 10, currentY);
    }
    if (item.phone) {
      currentY += 4;
      doc.text(`TEL: ${item.phone}`, 10, currentY);
    }

    currentY += 6;
    doc.line(10, currentY, pageWidth - 10, currentY);
    
    // Details Table
    currentY += 5;
    doc.setFont('helvetica', 'bold');
    doc.text('DETALLE DE VENTA', 10, currentY);
    
    const tableItems = item.items && item.items.length > 0 ? 
      item.items.map(i => [i.productName, i.quantity, `$${Math.round(i.unitPrice).toLocaleString('es-CO')}`, `$${Math.round(i.quantity * i.unitPrice).toLocaleString('es-CO')}`]) :
      [[item.productName || item.description || 'Producto', item.quantity || 1, `$${Math.round(total).toLocaleString('es-CO')}`, `$${Math.round(total).toLocaleString('es-CO')}`]];

    autoTable(doc, {
      startY: currentY + 3,
      head: [['Prod', 'Cant', 'Precio', 'Sub']],
      body: tableItems,
      theme: 'plain',
      styles: { fontSize: 7, cellPadding: 1 },
      headStyles: { fontStyle: 'bold', borderBottomColor: [0, 0, 0], borderBottomWidth: 0.1 },
      margin: { left: 10, right: 10 }
    });

    currentY = (doc).lastAutoTable.finalY + 8;
    
    // Totals
    doc.setFontSize(8);
    doc.setFont('helvetica', 'normal');
    doc.text('SUBTOTAL:', 45, currentY);
    doc.text(`$${Math.round(total).toLocaleString('es-CO')}`, pageWidth - 10, currentY, { align: 'right' });
    
    currentY += 4;
    doc.text('PAGADO:', 45, currentY);
    doc.text(`$${Math.round(paid).toLocaleString('es-CO')}`, pageWidth - 10, currentY, { align: 'right' });

    currentY += 6;
    doc.setFontSize(10);
    doc.setFont('helvetica', 'bold');
    doc.text('TOTAL PENDIENTE:', 10, currentY);
    doc.text(`$${Math.round(balance).toLocaleString('es-CO')}`, pageWidth - 10, currentY, { align: 'right' });

    // Footer
    currentY += 15;
    doc.setFontSize(8);
    doc.setFont('helvetica', 'normal');
    doc.text('¡Gracias por su compra!', pageWidth / 2, currentY, { align: 'center' });
    currentY += 4;
    doc.setFont('helvetica', 'bold');
    doc.text('Alta Densidad - Fragancias & Estilo', pageWidth / 2, currentY, { align: 'center' });
    
    doc.save(`Factura_${String(item.id).padStart(6, '0')}.pdf`);
    notify?.('Factura PDF generada con éxito.', 'success');
  };

  const Icon = config[type].icon;

  return (
    <div className="main-content">
      <header className="page-header">
        <div>
          <h2 className="title-gradient" style={{ fontSize: '2.5rem', marginBottom: '0.25rem' }}>{config[type].title}</h2>
          <p style={{ color: 'var(--text-secondary)', fontWeight: 500 }}>{config[type].subtitle}</p>
        </div>
        <button onClick={() => { resetForm(); setIsAdding(true); }} className="btn-primary" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.75rem' }}><Plus size={20} />{config[type].label}</button>
      </header>

      <Ventana abierta={isAdding} onCerrar={resetForm} eyebrow={config[type].title} titulo={editingId ? 'Editar registro' : config[type].label} ancho={1040}>
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
                    <label style={{ display: 'block', marginBottom: '0.6rem', fontSize: '0.75rem', fontWeight: 500, color: 'var(--text-muted)' }}>SELECCIONAR CLIENTE</label>
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
                  <label style={{ display: 'block', marginBottom: '0.6rem', fontSize: '0.75rem', fontWeight: 500, color: 'var(--text-muted)' }}>NOMBRE (Obligatorio)</label>
                  <input required type="text" readOnly={!!formData.customerId} value={formData.customerName} onChange={e => setFormData({...formData, customerName: e.target.value})} placeholder="Nombre del cliente" style={{ width: '100%', opacity: formData.customerId ? 0.7 : 1 }} />
                </div>
                <div>
                  <label style={{ display: 'block', marginBottom: '0.6rem', fontSize: '0.75rem', fontWeight: 500, color: 'var(--text-muted)' }}>CÉDULA / NIT</label>
                  <input type="text" readOnly={!!formData.customerId} value={formData.idDocument} onChange={e => setFormData({...formData, idDocument: e.target.value})} placeholder="Opcional" style={{ width: '100%', opacity: formData.customerId ? 0.7 : 1 }} />
                </div>
                <div>
                  <label style={{ display: 'block', marginBottom: '0.6rem', fontSize: '0.75rem', fontWeight: 500, color: 'var(--text-muted)' }}>TELÉFONO</label>
                  <input type="text" readOnly={!!formData.customerId} value={formData.phone} onChange={e => setFormData({...formData, phone: e.target.value})} placeholder="Opcional" style={{ width: '100%', opacity: formData.customerId ? 0.7 : 1 }} />
                </div>
                <div>
                  <label style={{ display: 'block', marginBottom: '0.6rem', fontSize: '0.75rem', fontWeight: 500, color: 'var(--text-muted)' }}>CIUDAD / MUNICIPIO</label>
                  <input type="text" readOnly={!!formData.customerId} value={formData.city} onChange={e => setFormData({...formData, city: e.target.value})} placeholder="Opcional" style={{ width: '100%', opacity: formData.customerId ? 0.7 : 1 }} />
                </div>
                <div style={{ gridColumn: '1 / -1' }}>
                  <label style={{ display: 'block', marginBottom: '0.6rem', fontSize: '0.75rem', fontWeight: 500, color: 'var(--text-muted)' }}>DIRECCIÓN</label>
                  <input type="text" readOnly={!!formData.customerId} value={formData.address} onChange={e => setFormData({...formData, address: e.target.value})} placeholder="Opcional" style={{ width: '100%', opacity: formData.customerId ? 0.7 : 1 }} />
                </div>
                <div style={{ gridColumn: '1 / -1', height: '1px', background: 'var(--glass-border)', margin: '1rem 0' }} />
              </>
            )}
            {type === 'purchases' && (
              <div>
                <label style={{ display: 'block', marginBottom: '0.6rem', fontSize: '0.75rem', fontWeight: 500, color: 'var(--text-muted)' }}>PROVEEDOR</label>
                <select value={formData.supplierId} onChange={e => setFormData({...formData, supplierId: e.target.value})} style={{ width: '100%', height: '45px' }}>
                  <option value="">Seleccionar Proveedor...</option>
                  {supplierList.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
            )}
            {type === 'expenses' && (
              <div style={{ gridColumn: 'span 2' }}>
                <label style={{ display: 'block', marginBottom: '0.6rem', fontSize: '0.75rem', fontWeight: 500, color: 'var(--text-muted)' }}>DESCRIPCIÓN</label>
                <input required type="text" value={formData.description} onChange={e => setFormData({...formData, description: e.target.value})} style={{ width: '100%' }} />
              </div>
            )}
            {type === 'expenses' && categorias.length > 0 && (
              <div>
                <label htmlFor="gasto-categoria" style={{ display: 'block', marginBottom: '0.6rem' }}>Categoría</label>
                <select id="gasto-categoria" required value={formData.category || ''} onChange={e => setFormData({ ...formData, category: e.target.value })} style={{ width: '100%', height: '45px' }}>
                  <option value="" disabled>Selecciona…</option>
                  {categorias.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
                </select>
              </div>
            )}
            <div>
              <label style={{ display: 'block', marginBottom: '0.6rem', fontSize: '0.75rem', fontWeight: 500, color: 'var(--text-muted)' }}>FECHA</label>
              <input required type="date" value={formData.date} onChange={e => setFormData({...formData, date: e.target.value})} style={{ width: '100%' }} />
            </div>
            {type === 'sales' && (
              <div>
                <label style={{ display: 'block', marginBottom: '0.6rem', fontSize: '0.75rem', fontWeight: 500, color: 'var(--text-muted)' }}>MÉTODO DE PAGO</label>
                <select required value={formData.method} onChange={e => setFormData({...formData, method: e.target.value})} style={{ width: '100%', height: '45px' }}>
                  {metodos.map(m => <option key={m.name} value={m.name}>{m.name}</option>)}
                </select>
              </div>
            )}
          </div>

          {/* Cart Section for Sales */}
          {type === 'sales' && (
            <div style={{ background: 'rgba(0,0,0,0.2)', padding: '1.5rem', borderRadius: 0, border: '1px solid rgba(255,255,255,0.05)' }}>
              <h5 style={{ marginBottom: '1rem', color: 'var(--text-secondary)' }}>Añadir Productos</h5>
              <div style={{ display: 'flex', gap: '1rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
                <div style={{ flex: 2, minWidth: '200px' }}>
                  <label style={{ display: 'block', marginBottom: '0.6rem', fontSize: '0.75rem', color: 'var(--text-muted)' }}>PRODUCTO</label>
                  <select value={currentItem.productId} onChange={e => elegirProducto(e.target.value)} style={{ width: '100%', height: '45px' }}>
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
                <button type="button" onClick={addToCart} style={{ height: '45px', padding: '0 1.5rem', background: 'var(--glass-bg)', color: 'var(--accent-primary)', border: '1px solid var(--accent-primary)', borderRadius: 0, fontWeight: 500, display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                  <ListPlus size={18} /> Añadir
                </button>
              </div>

              {/* Cart Items Table */}
              {cart.length > 0 && (
                <div className="table-responsive-wrapper" style={{ marginTop: '1.5rem', background: 'var(--bg-main)', borderRadius: 0 }}>
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
                          <td style={{ padding: '0.75rem 1rem', fontWeight: 500 }}>{item.productName}</td>
                          <td style={{ padding: '0.75rem 1rem' }}>{item.quantity}</td>
                          <td style={{ padding: '0.75rem 1rem' }}>${Math.round(item.unitPrice).toLocaleString('es-CO')}</td>
                          <td style={{ padding: '0.75rem 1rem', color: 'var(--accent-primary)', fontWeight: 500 }}>${Math.round(item.quantity * item.unitPrice).toLocaleString('es-CO')}</td>
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
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1.5rem', background: 'rgba(0,0,0,0.2)', padding: '1.5rem', borderRadius: 0, border: '1px solid rgba(255,255,255,0.05)' }}>
              <div>
                <label style={{ display: 'block', marginBottom: '0.6rem', fontSize: '0.75rem', fontWeight: 500, color: 'var(--text-muted)' }}>PRODUCTO A COMPRAR</label>
                <select required value={currentItem.productId} onChange={e => elegirProducto(e.target.value)} style={{ width: '100%', height: '45px' }}>
                  <option value="">Seleccionar Producto...</option>
                  {productList.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: '0.6rem', fontSize: '0.75rem', fontWeight: 500, color: 'var(--text-muted)' }}>CANTIDAD</label>
                <NumericFormat required thousandSeparator="." decimalSeparator="," allowNegative={false} value={currentItem.quantity} onValueChange={(values) => setCurrentItem({...currentItem, quantity: values.value})} style={{ width: '100%' }} />
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: '0.6rem', fontSize: '0.75rem', fontWeight: 500, color: 'var(--text-muted)' }}>PRECIO UNITARIO</label>
                <NumericFormat required thousandSeparator="." decimalSeparator="," allowNegative={false} value={currentItem.unitPrice} onValueChange={(values) => setCurrentItem({...currentItem, unitPrice: values.value})} style={{ width: '100%' }} />
              </div>
            </div>
          )}

          {/* Totals & Payments */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '2rem', background: 'rgba(201, 169, 97, 0.05)', padding: '1.5rem', borderRadius: 0, border: '1px solid rgba(201, 169, 97, 0.1)' }}>
            {type === 'expenses' ? (
              <div style={{ flex: 1 }}>
                <label style={{ display: 'block', marginBottom: '0.6rem', fontSize: '0.75rem', fontWeight: 500, color: 'var(--text-muted)' }}>MONTO TOTAL</label>
                <NumericFormat required thousandSeparator="." decimalSeparator="," allowNegative={false} value={formData.amount} onValueChange={(values) => setFormData({...formData, amount: values.value})} style={{ width: '100%', maxWidth: '300px', fontSize: '1.5rem', fontWeight: 500, color: 'var(--error)' }} />
              </div>
            ) : (
              <div>
                <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', textTransform: 'uppercase', fontWeight: 500, display: 'block', marginBottom: '0.5rem' }}>Total a Pagar</span>
                <span style={{ fontSize: '2.5rem', fontWeight: 500, color: 'var(--accent-primary)' }}>${Math.round(calculatedTotal).toLocaleString('es-CO')}</span>
              </div>
            )}

            {type === 'sales' && (
              <div style={{ flex: 1, minWidth: '200px' }}>
                <label style={{ display: 'block', marginBottom: '0.6rem', fontSize: '0.75rem', fontWeight: 500, color: 'var(--text-muted)' }}>ABONO INICIAL (Opcional)</label>
                <NumericFormat thousandSeparator="." decimalSeparator="," allowNegative={false} value={formData.initialPayment} onValueChange={(values) => setFormData({...formData, initialPayment: values.value})} placeholder="Ej. 50000" style={{ width: '100%' }} />
              </div>
            )}

            <div style={{ display: 'flex', gap: '1rem', width: '100%', maxWidth: '400px' }}>
              {editingId && <button type="button" onClick={resetForm} className="btn-secondary" style={{ flex: 1 }}>Cancelar</button>}
              <button type="submit" className="btn-primary" disabled={guardando} style={{ flex: 2, height: '50px' }}>{guardando ? 'Guardando…' : editingId ? 'Actualizar Registro' : config[type].submitText}</button>
            </div>
          </div>

        </form>
      </Ventana>

      <div className="premium-card" style={{ padding: 0 }}>
        <div className="search-filter-bar">
          <Search size={18} color="var(--text-muted)" />
          <input type="text" placeholder="Buscar..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} />
          <select value={dateFilter} onChange={e => setDateFilter(e.target.value)}>
            <option value="all">Todo</option>
            <option value="month">Mes</option>
            <option value="year">Año</option>
          </select>
        </div>

        <div className="table-responsive-wrapper">
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
                const balance = type === 'sales' ? balanceOf(item) : 0;

                let saleCost = 0;
                if (type === 'sales') {
                  if (item.items && item.items.length > 0) {
                     saleCost = item.items.reduce((sum, i) => sum + ((parseFloat(i.costAtSale) || 0) * parseInt(i.quantity || 1)), 0);
                  } else {
                     saleCost = (parseFloat(item.costAtSale) || 0) * (parseInt(item.quantity) || 1);
                  }
                }
                const saleProfit = type === 'sales' ? (total - saleCost) : 0;
                
                let conceptHtml = null;
                if (type === 'expenses') {
                  conceptHtml = <div style={{ fontWeight: 500 }}>{item.description}</div>;
                } else if (item.items && item.items.length > 0) {
                  conceptHtml = (
                    <div>
                      <div style={{ fontWeight: 500 }}>{item.items.length} producto(s)</div>
                      <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{item.items.map(i => i.productName).join(', ').substring(0, 40)}...</div>
                    </div>
                  );
                } else {
                  const product = productList.find(p => p.id === item.productId || p.id === item.inventario_id);
                  const pName = product?.name || item.productName || 'Desconocido';
                  conceptHtml = (
                    <div>
                      <div style={{ fontWeight: 500 }}>{pName}</div>
                      {supplier && <div style={{ fontSize: '0.7rem', color: 'var(--accent-primary)' }}>Prov: {supplier.name}</div>}
                      {item.quantity && <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Cant: {item.quantity}</div>}
                    </div>
                  );
                }

                return (
                  <motion.tr key={item.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} style={{ borderBottom: '1px solid var(--glass-border)' }}>
                    <td style={{ padding: '1.25rem 2rem' }}>
                      <span className="mobile-label">Fecha / Cliente</span>
                      <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{item.date}</div>
                      <div style={{ fontWeight: 500 }}>{item.customerName || (type === 'purchases' ? 'Compra' : 'General')}</div>
                    </td>
                    <td style={{ padding: '1.25rem 2rem' }}>
                      <span className="mobile-label">Concepto</span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        {type === 'sales' ? <ArrowUpCircle size={14} color="var(--success)" /> : <ArrowDownCircle size={14} color="var(--error)" />}
                        {conceptHtml}
                      </div>
                    </td>
                    <td style={{ padding: '1.25rem 2rem' }}>
                      <span className="mobile-label">Estado</span>
                      {type === 'sales' ? (
                        <span style={{ fontSize: '0.7rem', fontWeight: 500, color: item.status === 'paid' ? 'var(--success)' : 'var(--warning)' }}>{item.status === 'paid' ? 'PAGADA' : 'PENDIENTE'}</span>
                      ) : <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>CONTADO</span>}
                    </td>
                    <td style={{ padding: '1.25rem 2rem', fontWeight: 500 }}>
                      <span className="mobile-label">Total</span>
                      ${Math.round(total).toLocaleString('es-CO')}
                      {type === 'sales' && (
                        <div style={{ fontSize: '0.65rem', color: 'var(--success)', marginTop: '0.2rem' }}>
                          Ganancia: +${Math.round(saleProfit).toLocaleString('es-CO')}
                        </div>
                      )}
                    </td>
                    <td style={{ padding: '1.25rem 2rem' }}>
                      <div style={{ display: 'flex', gap: '0.5rem' }}>
                        <button className="btn-icon" onClick={() => setSelectedDetail(item)} title="Ver detalle" aria-label="Ver detalle"><Eye size={14} /></button>
                        <button className="btn-icon" onClick={() => handleEdit(item)} title="Editar" aria-label="Editar"><Edit2 size={14} /></button>
                        <button className="btn-icon danger" onClick={() => confirm('¿Eliminar registro?', () => onDelete(item.id))} title="Eliminar" aria-label="Eliminar"><Trash2 size={14} /></button>
                        {type === 'sales' && <button className="btn-icon" onClick={() => handlePrintReceipt(item)} title="Imprimir recibo" aria-label="Imprimir recibo"><Printer size={14} /></button>}
                        {type === 'sales' && balance > 0 && <button className="btn-secondary" onClick={() => setSelectedSale(item)} style={{ minHeight: 34, color: 'var(--accent-primary)', borderColor: 'var(--accent-primary)' }}>Abonar</button>}
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
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(12px)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 10000, padding: '1.5rem' }}>
            <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="premium-card" style={{ maxWidth: '450px', width: '100%', border: '1px solid var(--accent-primary)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '2rem', alignItems: 'center' }}>
                <div>
                  <h3 style={{ color: 'var(--accent-primary)', fontSize: '1.5rem', marginBottom: '0.25rem' }}>REGISTRAR ABONO</h3>
                  <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Venta #{String(selectedSale.id).padStart(6, '0')}</p>
                </div>
                <button onClick={() => setSelectedSale(null)} style={{ background: 'transparent', border: '1px solid var(--border-color)', color: 'var(--text-main)', cursor: 'pointer', width: '32px', height: '32px', display: 'flex', alignItems: 'center', justifyContent: 'center' }} aria-label="Cerrar"><X size={16} /></button>
              </div>

              <div style={{ background: 'rgba(0,0,0,0.2)', padding: '1.5rem', borderRadius: 0, marginBottom: '2rem', border: '1px solid var(--glass-border)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
                  <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Cliente:</span>
                  <span style={{ fontWeight: 500 }}>{selectedSale.customerName || 'General'}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
                  <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Total Venta:</span>
                  <span style={{ fontWeight: 500 }}>${Math.round(selectedSale.total).toLocaleString('es-CO')}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
                  <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Pagado:</span>
                  <span style={{ fontWeight: 500, color: 'var(--success)' }}>${Math.round((selectedSale.payments || []).reduce((acc, p) => acc + parseFloat(p.amount), 0)).toLocaleString('es-CO')}</span>
                </div>
                <div style={{ height: '1px', background: 'var(--glass-border)', margin: '0.75rem 0' }} />
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--accent-primary)', fontWeight: 500 }}>SALDO PENDIENTE:</span>
                  <span style={{ fontWeight: 500, color: 'var(--accent-primary)', fontSize: '1.25rem' }}>
                    ${Math.round(balanceOf(selectedSale)).toLocaleString('es-CO')}
                  </span>
                </div>
              </div>

              <form onSubmit={handleAddPayment}>
                <div style={{ marginBottom: '1.25rem' }}>
                  <label htmlFor="abono-metodo" style={{ display: 'block', marginBottom: '0.6rem' }}>Método de pago</label>
                  <select id="abono-metodo" value={paymentMethod} onChange={e => setPaymentMethod(e.target.value)} style={{ width: '100%', height: '45px' }}>
                    {metodos.map(m => <option key={m.name} value={m.name}>{m.name}</option>)}
                  </select>
                </div>
                <div style={{ marginBottom: '2rem' }}>
                  <label style={{ display: 'block', marginBottom: '0.75rem', fontSize: '0.75rem', fontWeight: 500, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '1px' }}>Monto del Abono (COP)</label>
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
                <button type="submit" className="btn-primary" style={{ width: '100%', height: '55px', fontSize: '1rem', fontWeight: 500, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.75rem' }}>
                  <CheckCircle2 size={20} /> CONFIRMAR ABONO
                </button>
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
