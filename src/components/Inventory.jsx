import React, { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, Search, Edit2, Trash2, Filter, Download, Package, X, Check, ArrowUpDown, ClipboardList, Eye, History, SlidersHorizontal, RotateCcw } from 'lucide-react';
import { AjusteStockModal, MovimientosModal } from './StockModals';
import { TIPOS_INVENTARIO, formatoCantidad, nivelStock, NIVELES_STOCK } from '../utils/inventario';
import DetailModal from './DetailModal';
import Ventana from './Ventana';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { NumericFormat } from 'react-number-format';

const FORM_VACIO = { name: '', category: '', price: '', costPrice: '', stock: '0', type: 'terminado', minStock: '0', code: '', purchaseUnit: '', purchaseFactor: '1', essenceClass: '' };
const CLASES_ESENCIA = { arabe: 'Árabe', tradicional: 'Tradicional' };
const LIQUIDOS = ['esencia', 'base', 'feromona'];

const Inventory = ({ inventory, addProduct, updateProduct, deleteProduct, exportData, notify, confirm, onRefresh, config }) => {
  // Semáforo de stock con los límites de Configuraciones (o el stock mínimo del ítem)
  const nivel = (p) => nivelStock(p, config);
  const stockBajo = (p) => nivel(p) !== 'disponible';
  const [searchTerm, setSearchTerm] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');
  const [claseFilter, setClaseFilter] = useState('all');
  const [stockFilter, setStockFilter] = useState('all'); // 'all' | 'in_stock' | 'low' | 'out'
  const [sortBy, setSortBy] = useState('recent'); // 'recent' | 'name_asc' | 'name_desc' | 'stock_asc' | 'stock_desc'
  const [isAdding, setIsAdding] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [selectedDetail, setSelectedDetail] = useState(null);
  const [formData, setFormData] = useState(FORM_VACIO);
  const [intentado, setIntentado] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [ajustando, setAjustando] = useState(null);
  const [historial, setHistorial] = useState(null);

  const items = Array.isArray(inventory) ? inventory : [];

  // Categorías únicas detectadas dinámicamente desde los productos
  const categoriasDisponibles = useMemo(() => {
    const cats = new Set();
    items.forEach(p => {
      const c = (p?.category || '').trim();
      if (c) cats.add(c);
    });
    return Array.from(cats).sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' }));
  }, [items]);

  const hayFiltrosActivos = searchTerm.trim() !== '' || categoryFilter !== 'all' || typeFilter !== 'all' || claseFilter !== 'all' || stockFilter !== 'all' || sortBy !== 'recent';

  const limpiarFiltros = () => {
    setSearchTerm('');
    setCategoryFilter('all');
    setTypeFilter('all');
    setClaseFilter('all');
    setStockFilter('all');
    setSortBy('recent');
  };

  const filteredInventory = useMemo(() => {
    return items.filter(p => {
      // 1. Búsqueda por texto (nombre, categoría o código)
      if (searchTerm.trim()) {
        const q = searchTerm.toLowerCase();
        const matchName = String(p?.name || '').toLowerCase().includes(q);
        const matchCat = String(p?.category || '').toLowerCase().includes(q);
        const matchCode = String(p?.code || '').toLowerCase().includes(q);
        if (!matchName && !matchCat && !matchCode) return false;
      }

      // 2. Filtro por categoría exacta
      if (categoryFilter !== 'all') {
        if ((p?.category || '').trim().toLowerCase() !== categoryFilter.toLowerCase()) return false;
      }

      // 3. Filtro por tipo de producto (terminado, esencia, base, etc.)
      if (typeFilter !== 'all') {
        if ((p?.type || 'terminado') !== typeFilter) return false;
      }
      // 3b. Clase de esencia (árabe / tradicional / sin clasificar)
      if (claseFilter !== 'all') {
        if (p?.type !== 'esencia') return false;
        if (claseFilter === 'sin' ? !!p.essenceClass : p.essenceClass !== claseFilter) return false;
      }

      // 4. Filtro por estado de stock
      if (stockFilter === 'low') {
        if (nivel(p) !== 'advertencia') return false;
      } else if (stockFilter === 'out') {
        if (Number(p?.stock) > 0) return false;
      } else if (stockFilter === 'in_stock') {
        if (Number(p?.stock) <= 0) return false;
      }

      return true;
    }).sort((a, b) => {
      if (sortBy === 'name_asc') return (a.name || '').localeCompare(b.name || '');
      if (sortBy === 'name_desc') return (b.name || '').localeCompare(a.name || '');
      if (sortBy === 'stock_asc') return Number(a.stock) - Number(b.stock);
      if (sortBy === 'stock_desc') return Number(b.stock) - Number(a.stock);
      if (sortBy === 'price_desc') return Number(b.price) - Number(a.price);
      if (sortBy === 'price_asc') return Number(a.price) - Number(b.price);
      return b.id - a.id;
    });
  }, [items, searchTerm, categoryFilter, typeFilter, claseFilter, stockFilter, sortBy]);

  const handleEdit = (product) => {
    setEditingId(product.id);
    setIntentado(false);
    setFormData({
      ...FORM_VACIO, ...product,
      price: String(product.price), costPrice: String(product.costPrice), stock: String(product.stock),
      type: product.type || 'terminado', minStock: String(product.minStock ?? 0), code: product.code || '',
      purchaseUnit: product.purchaseUnit || '', purchaseFactor: String(product.purchaseFactor ?? 1),
      essenceClass: product.essenceClass || ''
    });
    setIsAdding(true);
  };

  // Campos obligatorios: nada se guarda con precio o costo vacío o en 0 (se vendería regalado o
  // el margen saldría falso). El costo de un kit compuesto lo calculan sus componentes.
  const editandoKit = Boolean(editingId && items.find((p) => p.id === editingId)?.isKit);
  const faltantes = [
    !String(formData.name).trim() && ['name', 'nombre'],
    !String(formData.category).trim() && ['category', 'categoría'],
    !(Number(formData.price) > 0) && ['price', 'precio de venta'],
    !editandoKit && !(Number(formData.costPrice) > 0) && ['costPrice', 'precio de costo'],
    !editingId && String(formData.stock).trim() === '' && ['stock', 'stock inicial'],
    formData.type === 'esencia' && !formData.essenceClass && ['essenceClass', 'clase de esencia']
  ].filter(Boolean);
  const invalido = (k) => (intentado && faltantes.some(([c]) => c === k) ? { borderColor: 'var(--error)', boxShadow: '0 0 0 1px var(--error)' } : {});

  const enviar = async () => {
    setGuardando(true);
    let ok;
    if (editingId) {
      // El stock no se edita aquí: se cambia con "Ajustar stock" para que quede el motivo
      const sinStock = { ...formData };
      delete sinStock.stock;
      ok = await updateProduct(editingId, sinStock);
    } else {
      ok = await addProduct(formData);
    }
    setGuardando(false);
    // Si el servidor rechaza el guardado, la ventana sigue abierta con lo escrito
    if (ok) handleCancel();
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (guardando) return;
    setIntentado(true);
    if (faltantes.length) {
      notify?.(`Completa los campos obligatorios: ${faltantes.map(([, t]) => t).join(', ')}.`, 'warning');
      return;
    }
    const precio = Number(formData.price);
    const costo = Number(formData.costPrice);
    if (!editandoKit && precio <= costo) {
      confirm?.(`El precio de venta ($${Math.round(precio).toLocaleString('es-CO')}) no supera el costo ($${Math.round(costo).toLocaleString('es-CO')}): cada venta daría pérdida y la tienda lo pondrá en revisión. ¿Guardar de todos modos?`, enviar);
      return;
    }
    enviar();
  };

  const handleCancel = () => {
    setIsAdding(false);
    setEditingId(null);
    setFormData(FORM_VACIO);
    setIntentado(false);
  };

  const handleExportStockZero = () => {
    const lowStockItems = items.filter(stockBajo);
    
    if (lowStockItems.length === 0) {
      notify?.('No hay productos agotados ni en advertencia para generar el reporte.', 'info');
      return;
    }

    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.width;

    // Header
    doc.setFontSize(22);
    doc.setTextColor(226, 176, 76); // Accent Primary
    doc.setFont('helvetica', 'bold');
    doc.text('ALTA DENSIDAD', pageWidth / 2, 20, { align: 'center' });

    doc.setFontSize(10);
    doc.setTextColor(100, 100, 100);
    doc.text(`REPORTE DE FALTANTES (AGOTADOS Y EN ADVERTENCIA)`, pageWidth / 2, 28, { align: 'center' });
    doc.text(`${new Date().toLocaleDateString('es-CO', { day: 'numeric', month: 'long', year: 'numeric' })}`, pageWidth / 2, 33, { align: 'center' });

    // Table
    const tableData = lowStockItems.map(p => [
      p.name,
      p.category,
      p.stock,
      '' // Space for manually writing "Qty to order"
    ]);

    autoTable(doc, {
      startY: 45,
      head: [['Producto', 'Categoría', 'Stock Act.', 'Cant. Pedir']],
      body: tableData,
      theme: 'grid',
      headStyles: {
        fillColor: [20, 20, 22],
        textColor: [226, 176, 76],
        fontSize: 10,
        fontStyle: 'bold',
        halign: 'left'
      },
      bodyStyles: {
        fontSize: 9,
        textColor: [50, 50, 50]
      },
      columnStyles: {
        2: { fontStyle: 'bold', halign: 'center' },
        3: { cellWidth: 30 }
      },
      didParseCell: (data) => {
        if (data.section === 'body' && data.column.index === 2) {
          const val = Number(data.cell.raw);
          if (val === 0) data.cell.styles.textColor = [255, 69, 58]; // Red
          else if (val === 1) data.cell.styles.textColor = [50, 215, 75]; // Green
        }
      }
    });

    // Footer
    const finalY = (doc).lastAutoTable?.finalY || 45;
    doc.setFontSize(8);
    doc.setTextColor(150, 150, 150);
    doc.text('Este documento es un auxiliar para la gestión de compras y pedidos.', pageWidth / 2, finalY + 20, { align: 'center' });
    doc.text(`© ${new Date().getFullYear()} Alta Densidad Luxury Management`, pageWidth / 2, finalY + 25, { align: 'center' });

    doc.save(`Faltantes_${new Date().toISOString().split('T')[0]}.pdf`);
    notify?.('Reporte PDF generado con éxito.', 'success');
  };

  return (
    <div className="main-content">
      <header className="page-header">
        <div>
          <h2 className="title-gradient" style={{ fontSize: '2.5rem', marginBottom: '0.25rem' }}>Inventario</h2>
          <p style={{ color: 'var(--text-secondary)', fontWeight: 500 }}>Gestión de productos, stock y valorización.</p>
        </div>
        <div style={{ display: 'flex', gap: '1rem' }}>
          <button 
            onClick={handleExportStockZero} 
            className="glass" 
            style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', padding: '0.8rem 1.2rem', borderRadius: 0, color: 'var(--error)', border: '1px solid rgba(194, 65, 59,0.2)', cursor: 'pointer', fontWeight: 500 }}
          >
            <ClipboardList size={20} />
            <span style={{ fontSize: '0.85rem' }}>Reporte Faltantes</span>
          </button>
          <button onClick={exportData} className="glass" style={{ padding: '0.8rem', borderRadius: 0, color: 'var(--text-secondary)', border: 'none', cursor: 'pointer' }}>
            <Download size={20} />
          </button>
          <button 
            onClick={() => { handleCancel(); setIsAdding(true); }}
            className="btn-primary" 
            style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}
          >
            <Plus size={20} />
            Nuevo Producto
          </button>
        </div>
      </header>

      <Ventana abierta={isAdding} onCerrar={handleCancel} eyebrow="Inventario" titulo={editingId ? 'Editar producto' : 'Nuevo producto'} ancho={880}>
        <form onSubmit={handleSubmit} noValidate style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '1.5rem', alignItems: 'flex-end' }}>
          <div>
            <label style={{ display: 'block', marginBottom: '0.6rem', fontSize: '0.75rem', fontWeight: 500, color: 'var(--text-muted)' }}>NOMBRE *</label>
            <input required type="text" value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} placeholder="Nombre del producto" style={{ width: '100%', ...invalido('name') }} />
          </div>
          <div>
            <label style={{ display: 'block', marginBottom: '0.6rem', fontSize: '0.75rem', fontWeight: 500, color: 'var(--text-muted)' }}>CATEGORÍA *</label>
            <input required type="text" value={formData.category} onChange={e => setFormData({...formData, category: e.target.value})} placeholder="Categoría" style={{ width: '100%', ...invalido('category') }} />
          </div>
          <div>
            <label style={{ display: 'block', marginBottom: '0.6rem', fontSize: '0.75rem', fontWeight: 500, color: 'var(--text-muted)' }}>P. VENTA (COP) *</label>
            <NumericFormat required allowNegative={false} value={formData.price} onValueChange={(values) => setFormData({...formData, price: values.value})} thousandSeparator="." decimalSeparator="," placeholder="0" style={{ width: '100%', ...invalido('price') }} />
          </div>
          <div>
            <label style={{ display: 'block', marginBottom: '0.6rem', fontSize: '0.75rem', fontWeight: 500, color: 'var(--text-muted)' }}>P. COSTO (COP){editandoKit ? '' : ' *'}</label>
            {editandoKit
              ? <input value={`$${Math.round(Number(formData.costPrice) || 0).toLocaleString('es-CO')}`} readOnly title="El costo de un kit sale de sus componentes" style={{ width: '100%', opacity: 0.6 }} />
              : <NumericFormat required allowNegative={false} value={formData.costPrice} onValueChange={(values) => setFormData({...formData, costPrice: values.value})} thousandSeparator="." decimalSeparator="," placeholder="0" style={{ width: '100%', ...invalido('costPrice') }} />}
          </div>
          <div>
            <label htmlFor="inv-tipo" style={{ display: 'block', marginBottom: '0.6rem' }}>Tipo</label>
            <select id="inv-tipo" value={formData.type} onChange={e => setFormData({ ...formData, type: e.target.value })} style={{ width: '100%' }}>
              {Object.entries(TIPOS_INVENTARIO).map(([v, t]) => <option key={v} value={v}>{t}</option>)}
            </select>
          </div>
          {formData.type === 'esencia' && (
            <div>
              <label htmlFor="inv-clase" style={{ display: 'block', marginBottom: '0.6rem' }}>Clase de esencia *</label>
              <select id="inv-clase" value={formData.essenceClass} onChange={e => setFormData({ ...formData, essenceClass: e.target.value })} style={{ width: '100%', ...invalido('essenceClass') }}>
                <option value="">Seleccionar…</option>
                <option value="arabe">Árabe</option>
                <option value="tradicional">Tradicional (diseñador)</option>
              </select>
            </div>
          )}
          <div>
            <label htmlFor="inv-stock" style={{ display: 'block', marginBottom: '0.6rem' }}>
              {editingId ? 'Stock actual' : 'Stock inicial'} ({LIQUIDOS.includes(formData.type) ? 'ml' : 'und'})
            </label>
            {editingId
              ? <input id="inv-stock" value={formatoCantidad(formData.stock, LIQUIDOS.includes(formData.type) ? 'ml' : 'und')} readOnly title="Usa «Ajustar stock» en la tabla" style={{ width: '100%', opacity: 0.6 }} />
              : <NumericFormat id="inv-stock" required allowNegative={false} value={formData.stock} onValueChange={(v) => setFormData({ ...formData, stock: v.value })} thousandSeparator="." decimalSeparator="," decimalScale={2} style={{ width: '100%', ...invalido('stock') }} />}
          </div>
          <div>
            <label htmlFor="inv-min" style={{ display: 'block', marginBottom: '0.6rem' }}>Stock mínimo</label>
            <NumericFormat id="inv-min" value={formData.minStock} onValueChange={(v) => setFormData({ ...formData, minStock: v.value })} thousandSeparator="." decimalSeparator="," decimalScale={2} style={{ width: '100%' }} />
          </div>
          <div>
            <label htmlFor="inv-codigo" style={{ display: 'block', marginBottom: '0.6rem' }}>Código (opcional)</label>
            <input id="inv-codigo" type="text" value={formData.code} onChange={e => setFormData({ ...formData, code: e.target.value.toUpperCase() })} placeholder="ESN-YARA" style={{ width: '100%' }} />
          </div>
          <div>
            <label htmlFor="inv-ucompra" style={{ display: 'block', marginBottom: '0.6rem' }}>Se compra por</label>
            <input id="inv-ucompra" type="text" value={formData.purchaseUnit} onChange={e => setFormData({ ...formData, purchaseUnit: e.target.value })} placeholder="kg, litro, caja…" style={{ width: '100%', textTransform: 'none' }} />
          </div>
          <div>
            <label htmlFor="inv-factor" style={{ display: 'block', marginBottom: '0.6rem' }}>
              Equivale a ({LIQUIDOS.includes(formData.type) ? 'ml' : 'und'})
            </label>
            <NumericFormat id="inv-factor" value={formData.purchaseFactor} onValueChange={(v) => setFormData({ ...formData, purchaseFactor: v.value })} thousandSeparator="." decimalSeparator="," decimalScale={4} style={{ width: '100%' }} />
          </div>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button type="submit" className="btn-primary" disabled={guardando} style={{ flex: 1, height: '45px', fontSize: '0.8rem' }}>
              {guardando ? 'GUARDANDO…' : editingId ? 'ACTUALIZAR' : 'GUARDAR'}
            </button>
          </div>
        </form>
      </Ventana>

      <div className="premium-card" style={{ padding: 0 }}>
        <div className="search-filter-bar" style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', alignItems: 'center' }}>
          {/* Campo de búsqueda */}
          <div style={{ position: 'relative', flex: '1 1 200px', minWidth: '180px' }}>
            <Search style={{ position: 'absolute', left: '1rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} size={16} />
            <input 
              type="text" 
              placeholder="Buscar por nombre, código..."
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              style={{ width: '100%', paddingLeft: '2.6rem', paddingRight: searchTerm ? '2.2rem' : '1rem', borderRadius: 0 }}
            />
            {searchTerm && (
              <button 
                type="button" 
                onClick={() => setSearchTerm('')} 
                style={{ position: 'absolute', right: '0.75rem', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 0 }}
                title="Limpiar búsqueda"
              >
                <X size={15} />
              </button>
            )}
          </div>

          {/* Selector de Categoría */}
          <div style={{ flex: '0 1 180px', minWidth: '140px' }}>
            <select
              value={categoryFilter}
              onChange={e => setCategoryFilter(e.target.value)}
              style={{ width: '100%', borderRadius: 0 }}
              title="Filtrar por categoría"
            >
              <option value="all">Todas las categorías ({categoriasDisponibles.length})</option>
              {categoriasDisponibles.map(cat => (
                <option key={cat} value={cat}>{cat}</option>
              ))}
            </select>
          </div>

          {/* Selector de Tipo de Producto */}
          <div style={{ flex: '0 1 150px', minWidth: '125px' }}>
            <select
              value={typeFilter}
              onChange={e => setTypeFilter(e.target.value)}
              style={{ width: '100%', borderRadius: 0 }}
              title="Filtrar por tipo"
            >
              <option value="all">Todos los tipos</option>
              {Object.entries(TIPOS_INVENTARIO).map(([v, t]) => (
                <option key={v} value={v}>{t}</option>
              ))}
            </select>
          </div>

          {/* Clase de esencia */}
          <div style={{ flex: '0 1 150px', minWidth: '125px' }}>
            <select value={claseFilter} onChange={e => setClaseFilter(e.target.value)} style={{ width: '100%', borderRadius: 0 }} title="Clase de esencia">
              <option value="all">Todas las clases</option>
              <option value="arabe">Esencias árabes</option>
              <option value="tradicional">Esencias tradicionales</option>
              <option value="sin">Esencias sin clasificar</option>
            </select>
          </div>

          {/* Selector de Estado de Stock */}
          <div style={{ flex: '0 1 150px', minWidth: '125px' }}>
            <select
              value={stockFilter}
              onChange={e => setStockFilter(e.target.value)}
              style={{ width: '100%', borderRadius: 0 }}
              title="Filtrar por stock"
            >
              <option value="all">Todo el stock</option>
              <option value="in_stock">Con stock</option>
              <option value="low">En advertencia (amarillo)</option>
              <option value="out">Agotados (0)</option>
            </select>
          </div>

          {/* Selector de Ordenamiento */}
          <div style={{ flex: '0 1 150px', minWidth: '125px' }}>
            <select
              value={sortBy}
              onChange={e => setSortBy(e.target.value)}
              style={{ width: '100%', borderRadius: 0 }}
              title="Ordenar por"
            >
              <option value="recent">Más recientes</option>
              <option value="name_asc">Nombre (A-Z)</option>
              <option value="name_desc">Nombre (Z-A)</option>
              <option value="stock_desc">Mayor stock</option>
              <option value="stock_asc">Menor stock</option>
              <option value="price_desc">Mayor precio</option>
              <option value="price_asc">Menor precio</option>
            </select>
          </div>

          {/* Botón de limpiar filtros cuando hay alguno activo */}
          {hayFiltrosActivos && (
            <button
              onClick={limpiarFiltros}
              className="glass"
              style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.65rem 0.9rem', borderRadius: 0, color: 'var(--accent-primary)', fontWeight: 500, border: '1px solid rgba(226, 176, 76, 0.4)', cursor: 'pointer', fontSize: '0.8rem' }}
              title="Restablecer todos los filtros"
            >
              <RotateCcw size={14} />
              <span>Limpiar</span>
            </button>
          )}

          <div style={{ marginLeft: 'auto', fontSize: '0.8rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
            <strong style={{ color: 'var(--text-primary)' }}>{filteredInventory.length}</strong> de {items.length} productos
          </div>
        </div>

        <div className="table-responsive-wrapper">
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
            <thead>
              <tr style={{ background: 'rgba(255,255,255,0.01)' }}>
                <th style={{ padding: '1.25rem 2rem', fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>Producto</th>
                <th style={{ padding: '1.25rem 2rem', fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>Categoría</th>
                <th style={{ padding: '1.25rem 2rem', fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>Stock</th>
                <th style={{ padding: '1.25rem 2rem', fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>Ganancia Est.</th>
                <th style={{ padding: '1.25rem 2rem', fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>P. Venta</th>
                <th style={{ padding: '1.25rem 2rem', fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {filteredInventory.map((product, idx) => {
                const profit = product.price - product.costPrice;
                const margin = product.price > 0 ? (profit / product.price) * 100 : 0;
                
                return (
                  <motion.tr 
                    key={product.id}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: idx * 0.03 }}
                    style={{ borderBottom: '1px solid var(--glass-border)' }}
                  >
                    <td style={{ padding: '1.25rem 2rem' }}>
                      <span className="mobile-label">Producto</span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                        <div style={{ width: '36px', height: '36px', borderRadius: 0, background: 'rgba(201, 169, 97, 0.08)', display: 'flex', justifyContent: 'center', alignItems: 'center', color: 'var(--accent-primary)', fontWeight: 500, fontSize: '0.9rem' }}>
                          {String(product.name || 'P').charAt(0).toUpperCase()}
                        </div>
                        <span style={{ fontWeight: 500, fontSize: '0.95rem' }}>{product.name}</span>
                      </div>
                    </td>
                    <td style={{ padding: '1.25rem 2rem' }}>
                      <span className="mobile-label">Categoría</span>
                      <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>{product.category}</span>
                      {product.type && product.type !== 'terminado' && (
                        <div className="up" style={{ fontSize: '9px', color: 'var(--accent-primary)', marginTop: '0.25rem' }}>
                          {TIPOS_INVENTARIO[product.type]}
                          {product.type === 'esencia' && <span style={{ marginLeft: 6, color: product.essenceClass ? 'var(--text-secondary)' : 'var(--warning, #c9a227)' }}>· {CLASES_ESENCIA[product.essenceClass] || 'Sin clasificar'}</span>}
                        </div>
                      )}
                    </td>
                    <td style={{ padding: '1.25rem 2rem' }}>
                      <span className="mobile-label">Stock</span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <div title={NIVELES_STOCK[nivel(product)].etiqueta} style={{ width: '6px', height: '6px', borderRadius: '50%', background: NIVELES_STOCK[nivel(product)].color }} />
                        <span style={{ fontWeight: 500, color: NIVELES_STOCK[nivel(product)].color, fontSize: '0.9rem', whiteSpace: 'nowrap' }}>{formatoCantidad(product.stock, product.unit)}</span>
                      </div>
                    </td>
                    <td style={{ padding: '1.25rem 2rem' }}>
                      <span className="mobile-label">Ganancia Est.</span>
                      <div style={{ fontSize: '0.9rem', fontWeight: 500, color: 'var(--success)' }}>+${Math.round(profit).toLocaleString('es-CO')}</div>
                      <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>M: {margin.toFixed(1)}%</div>
                    </td>
                    <td style={{ padding: '1.25rem 2rem', fontWeight: 500 }}>
                      <span className="mobile-label">P. Venta</span>
                      ${Math.round(product.price).toLocaleString('es-CO')}
                    </td>
                    <td style={{ padding: '1.25rem 2rem' }}>
                      <div style={{ display: 'flex', gap: '0.5rem' }}>
                        <button onClick={() => setSelectedDetail(product)} className="btn-icon">
                          <Eye size={16} />
                        </button>
                        <button onClick={() => handleEdit(product)} className="btn-icon" title="Editar" aria-label="Editar">
                          <Edit2 size={16} />
                        </button>
                        <button onClick={() => setAjustando(product)} className="btn-icon" title="Ajustar stock" aria-label="Ajustar stock">
                          <SlidersHorizontal size={16} />
                        </button>
                        <button onClick={() => setHistorial(product)} className="btn-icon" title="Historial de movimientos" aria-label="Historial de movimientos">
                          <History size={16} />
                        </button>
                        <button 
                          onClick={() => confirm(`¿Eliminar "${product.name}"? Dejará de aparecer, pero su historial de ventas y movimientos se conserva.`, () => {
                            deleteProduct(product.id);
                          })}
                          className="btn-icon danger" title="Eliminar" aria-label="Eliminar"
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
          {filteredInventory.length === 0 && (
            <div style={{ padding: '4rem 2rem', textAlign: 'center', color: 'var(--text-muted)' }}>
              <Package size={48} style={{ opacity: 0.15, marginBottom: '1rem', strokeWidth: 1.5 }} />
              <p style={{ fontSize: '1rem', color: 'var(--text-secondary)' }}>
                {items.length === 0 
                  ? 'No hay productos registrados en el inventario.' 
                  : 'No se encontraron productos que coincidan con los filtros seleccionados.'}
              </p>
              {hayFiltrosActivos && items.length > 0 && (
                <button 
                  onClick={limpiarFiltros} 
                  className="btn-primary" 
                  style={{ marginTop: '1.25rem', padding: '0.6rem 1.4rem', fontSize: '0.85rem' }}
                >
                  Restablecer todos los filtros
                </button>
              )}
            </div>
          )}
        </div>
      </div>
      
      <AnimatePresence>
        {selectedDetail && (
          <DetailModal item={selectedDetail} type="inventory" onClose={() => setSelectedDetail(null)} />
        )}
        {ajustando && <AjusteStockModal producto={ajustando} onClose={() => setAjustando(null)} onGuardado={onRefresh} notify={notify} />}
        {historial && <MovimientosModal producto={historial} onClose={() => setHistorial(null)} />}
      </AnimatePresence>
    </div>
  );
};

export default Inventory;
