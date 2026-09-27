import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, Search, Edit2, Trash2, Filter, Download, Package, X, Check, ArrowUpDown, ClipboardList, Eye, History, SlidersHorizontal } from 'lucide-react';
import { AjusteStockModal, MovimientosModal } from './StockModals';
import { TIPOS_INVENTARIO, formatoCantidad } from '../utils/inventario';
import DetailModal from './DetailModal';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { NumericFormat } from 'react-number-format';

const FORM_VACIO = { name: '', category: '', price: '', costPrice: '', stock: '0', type: 'terminado', minStock: '0', code: '', purchaseUnit: '', purchaseFactor: '1' };
const LIQUIDOS = ['esencia', 'base', 'feromona'];

// Stock bajo: usa el mínimo definido para el ítem; si no tiene, 1 unidad o menos
const stockBajo = (p) => (Number(p.minStock) > 0 ? Number(p.stock) <= Number(p.minStock) : Number(p.stock) <= 1);

const Inventory = ({ inventory, addProduct, updateProduct, deleteProduct, exportData, notify, confirm, onRefresh }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [isAdding, setIsAdding] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [selectedDetail, setSelectedDetail] = useState(null);
  const [formData, setFormData] = useState(FORM_VACIO);
  const [ajustando, setAjustando] = useState(null);
  const [historial, setHistorial] = useState(null);

  const items = Array.isArray(inventory) ? inventory : [];
  const filteredInventory = items.filter(p => 
    (String(p?.name || '')).toLowerCase().includes(searchTerm.toLowerCase()) ||
    (String(p?.category || '')).toLowerCase().includes(searchTerm.toLowerCase())
  ).sort((a, b) => b.id - a.id);

  const handleEdit = (product) => {
    setEditingId(product.id);
    setFormData({
      ...FORM_VACIO, ...product,
      price: String(product.price), costPrice: String(product.costPrice), stock: String(product.stock),
      type: product.type || 'terminado', minStock: String(product.minStock ?? 0), code: product.code || '',
      purchaseUnit: product.purchaseUnit || '', purchaseFactor: String(product.purchaseFactor ?? 1)
    });
    setIsAdding(true);
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (editingId) {
      // El stock no se edita aquí: se cambia con "Ajustar stock" para que quede el motivo
      const sinStock = { ...formData };
      delete sinStock.stock;
      updateProduct(editingId, sinStock);
      setEditingId(null);
    } else {
      addProduct(formData);
    }
    setFormData(FORM_VACIO);
    setIsAdding(false);
  };

  const handleCancel = () => {
    setIsAdding(false);
    setEditingId(null);
    setFormData(FORM_VACIO);
  };

  const handleExportStockZero = () => {
    const lowStockItems = items.filter(stockBajo);
    
    if (lowStockItems.length === 0) {
      notify?.('No hay productos bajo su stock mínimo para generar el reporte.', 'info');
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
    doc.text(`REPORTE DE FALTANTES (STOCK 0 y 1)`, pageWidth / 2, 28, { align: 'center' });
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
            <span style={{ fontSize: '0.85rem' }}>Reporte Faltantes (0-1)</span>
          </button>
          <button onClick={exportData} className="glass" style={{ padding: '0.8rem', borderRadius: 0, color: 'var(--text-secondary)', border: 'none', cursor: 'pointer' }}>
            <Download size={20} />
          </button>
          <button 
            onClick={() => setIsAdding(!isAdding)}
            className="btn-primary" 
            style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}
          >
            <Plus size={20} />
            {editingId ? 'Editando Producto' : 'Nuevo Producto'}
          </button>
        </div>
      </header>

      <AnimatePresence>
        {isAdding && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className="premium-card"
            style={{ marginBottom: '2.5rem', position: 'relative' }}
          >
            <button onClick={handleCancel} style={{ position: 'absolute', right: '1.5rem', top: '1.5rem', background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}>
              <X size={20} />
            </button>
            <h4 style={{ marginBottom: '1.5rem', color: 'var(--accent-primary)' }}>{editingId ? 'EDITAR PRODUCTO' : 'CREAR NUEVO PRODUCTO'}</h4>
            <form onSubmit={handleSubmit} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '1.5rem', alignItems: 'flex-end' }}>
              <div>
                <label style={{ display: 'block', marginBottom: '0.6rem', fontSize: '0.75rem', fontWeight: 500, color: 'var(--text-muted)' }}>NOMBRE</label>
                <input required type="text" value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} placeholder="Nombre del producto" style={{ width: '100%' }} />
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: '0.6rem', fontSize: '0.75rem', fontWeight: 500, color: 'var(--text-muted)' }}>CATEGORÍA</label>
                <input required type="text" value={formData.category} onChange={e => setFormData({...formData, category: e.target.value})} placeholder="Categoría" style={{ width: '100%' }} />
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: '0.6rem', fontSize: '0.75rem', fontWeight: 500, color: 'var(--text-muted)' }}>P. VENTA (COP)</label>
                <NumericFormat required value={formData.price} onValueChange={(values) => setFormData({...formData, price: values.value})} thousandSeparator="." decimalSeparator="," placeholder="0" style={{ width: '100%' }} />
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: '0.6rem', fontSize: '0.75rem', fontWeight: 500, color: 'var(--text-muted)' }}>P. COSTO (COP)</label>
                <NumericFormat required value={formData.costPrice} onValueChange={(values) => setFormData({...formData, costPrice: values.value})} thousandSeparator="." decimalSeparator="," placeholder="0" style={{ width: '100%' }} />
              </div>
              <div>
                <label htmlFor="inv-tipo" style={{ display: 'block', marginBottom: '0.6rem' }}>Tipo</label>
                <select id="inv-tipo" value={formData.type} onChange={e => setFormData({ ...formData, type: e.target.value })} style={{ width: '100%' }}>
                  {Object.entries(TIPOS_INVENTARIO).map(([v, t]) => <option key={v} value={v}>{t}</option>)}
                </select>
              </div>
              <div>
                <label htmlFor="inv-stock" style={{ display: 'block', marginBottom: '0.6rem' }}>
                  {editingId ? 'Stock actual' : 'Stock inicial'} ({LIQUIDOS.includes(formData.type) ? 'ml' : 'und'})
                </label>
                {editingId
                  ? <input id="inv-stock" value={formatoCantidad(formData.stock, LIQUIDOS.includes(formData.type) ? 'ml' : 'und')} readOnly title="Usa «Ajustar stock» en la tabla" style={{ width: '100%', opacity: 0.6 }} />
                  : <NumericFormat id="inv-stock" required value={formData.stock} onValueChange={(v) => setFormData({ ...formData, stock: v.value })} thousandSeparator="." decimalSeparator="," decimalScale={2} style={{ width: '100%' }} />}
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
                <button type="submit" className="btn-primary" style={{ flex: 1, height: '45px', fontSize: '0.8rem' }}>
                  {editingId ? 'ACTUALIZAR' : 'GUARDAR'}
                </button>
              </div>
            </form>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="premium-card" style={{ padding: 0 }}>
        <div className="search-filter-bar">
          <div style={{ position: 'relative', flex: 1 }}>
            <Search style={{ position: 'absolute', left: '1rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} size={18} />
            <input 
              type="text" 
              placeholder="Buscar por nombre, categoría..."
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              style={{ width: '100%', paddingLeft: '3rem', borderRadius: 0 }}
            />
          </div>
          <button className="glass" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.7rem 1.2rem', borderRadius: 0, color: 'var(--text-secondary)', fontWeight: 500, border: 'none', cursor: 'pointer' }}>
            <Filter size={16} />
            Filtrar
          </button>
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
                        <div className="up" style={{ fontSize: '9px', color: 'var(--accent-primary)', marginTop: '0.25rem' }}>{TIPOS_INVENTARIO[product.type]}</div>
                      )}
                    </td>
                    <td style={{ padding: '1.25rem 2rem' }}>
                      <span className="mobile-label">Stock</span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: stockBajo(product) ? 'var(--error)' : 'var(--success)' }} />
                        <span style={{ fontWeight: 500, color: stockBajo(product) ? 'var(--error)' : 'var(--success)', fontSize: '0.9rem' }}>{formatoCantidad(product.stock, product.unit)}</span>
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
            <div style={{ padding: '5rem', textAlign: 'center', color: 'var(--text-muted)' }}>
              <Package size={48} style={{ opacity: 0.1, marginBottom: '1rem' }} />
              <p>No hay productos registrados.</p>
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
