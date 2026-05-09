import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, Search, Edit2, Trash2, Filter, Download, Package, X, Check, ArrowUpDown, ClipboardList, Eye } from 'lucide-react';
import DetailModal from './DetailModal';
import { NumericFormat } from 'react-number-format';

const Inventory = ({ inventory, addProduct, updateProduct, deleteProduct, exportData, notify, confirm }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [isAdding, setIsAdding] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [selectedDetail, setSelectedDetail] = useState(null);
  const [formData, setFormData] = useState({ name: '', category: '', price: '', costPrice: '', stock: '0' });

  const items = Array.isArray(inventory) ? inventory : [];
  const filteredInventory = items.filter(p => 
    (String(p?.name || '')).toLowerCase().includes(searchTerm.toLowerCase()) ||
    (String(p?.category || '')).toLowerCase().includes(searchTerm.toLowerCase())
  ).sort((a, b) => b.id - a.id);

  const handleEdit = (product) => {
    setEditingId(product.id);
    setFormData({ ...product, price: String(product.price), costPrice: String(product.costPrice), stock: String(product.stock) });
    setIsAdding(true);
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (editingId) {
      updateProduct(editingId, formData);
      setEditingId(null);
    } else {
      addProduct(formData);
    }
    setFormData({ name: '', category: '', price: '', costPrice: '', stock: '0' });
    setIsAdding(false);
  };

  const handleCancel = () => {
    setIsAdding(false);
    setEditingId(null);
    setFormData({ name: '', category: '', price: '', costPrice: '', stock: '0' });
  };

  const handleExportStockZero = () => {
    const lowStockItems = items.filter(p => Number(p.stock) === 0 || Number(p.stock) === 1);
    
    if (lowStockItems.length === 0) {
      notify?.('No hay productos con stock bajo (0 o 1)', 'info');
      return;
    }

    const printWindow = window.open('', '_blank');
    printWindow.document.write(`
      <html>
        <head>
          <title>Reporte de Pedido - Faltantes</title>
          <style>
            @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;700;800&display=swap');
            body { font-family: 'Inter', sans-serif; padding: 40px; color: #1a1a1a; max-width: 800px; margin: auto; }
            .header { text-align: center; border-bottom: 2px solid #E2B04C; padding-bottom: 20px; margin-bottom: 30px; }
            h1 { color: #E2B04C; margin: 0; font-size: 24px; text-transform: uppercase; letter-spacing: 2px; font-weight: 800; }
            .meta { color: #888; font-size: 12px; margin-top: 5px; font-weight: 600; }
            table { width: 100%; border-collapse: collapse; margin-top: 30px; }
            th { text-align: left; background: #f9f9f9; padding: 15px 12px; font-size: 11px; color: #888; text-transform: uppercase; letter-spacing: 1px; border-bottom: 2px solid #eee; }
            td { padding: 15px 12px; border-bottom: 1px solid #eee; font-size: 14px; }
            .qty-box { border: 1px solid #eee; width: 120px; height: 30px; border-radius: 4px; }
            .footer { margin-top: 80px; text-align: center; font-size: 11px; color: #999; border-top: 1px solid #eee; padding-top: 20px; }
            @media print {
              .btn-print { display: none; }
            }
          </style>
        </head>
        <body>
          <div class="header">
            <h1>ALTA DENSIDAD</h1>
            <p class="meta">REPORTE DE FALTANTES (STOCK 0 o 1) - ${new Date().toLocaleDateString('es-CO', { day: 'numeric', month: 'long', year: 'numeric' })}</p>
          </div>
          <table>
            <thead>
              <tr>
                <th style="width: 40%;">Producto</th>
                <th style="width: 25%;">Categoría</th>
                <th style="width: 20%;">Stock Act.</th>
                <th style="width: 15%;">Cant. Pedir</th>
              </tr>
            </thead>
            <tbody>
              ${lowStockItems.map(p => `
                <tr>
                  <td style="font-weight: 700;">${p.name}</td>
                  <td style="color: #666;">${p.category}</td>
                  <td style="font-weight: 800; color: ${p.stock === 0 ? '#FF453A' : '#E2B04C'}">${p.stock}</td>
                  <td><div class="qty-box"></div></td>
                </tr>
              `).join('')}
            </tbody>
          </table>
          <div class="footer">
            <p>Este documento es un auxiliar para la gestión de compras y pedidos.</p>
            <p>© ${new Date().getFullYear()} Alta Densidad Luxury Management</p>
          </div>
        </body>
      </html>
    `);
    printWindow.document.close();
    printWindow.focus();
    setTimeout(() => {
      printWindow.print();
    }, 500);
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
            style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', padding: '0.8rem 1.2rem', borderRadius: '12px', color: 'var(--error)', border: '1px solid rgba(255,69,58,0.2)', cursor: 'pointer', fontWeight: 600 }}
          >
            <ClipboardList size={20} />
            <span style={{ fontSize: '0.85rem' }}>Reporte Faltantes (0-1)</span>
          </button>
          <button onClick={exportData} className="glass" style={{ padding: '0.8rem', borderRadius: '12px', color: 'var(--text-secondary)', border: 'none', cursor: 'pointer' }}>
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
                <label style={{ display: 'block', marginBottom: '0.6rem', fontSize: '0.75rem', fontWeight: 800, color: 'var(--text-muted)' }}>NOMBRE</label>
                <input required type="text" value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} placeholder="Nombre del producto" style={{ width: '100%' }} />
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: '0.6rem', fontSize: '0.75rem', fontWeight: 800, color: 'var(--text-muted)' }}>CATEGORÍA</label>
                <input required type="text" value={formData.category} onChange={e => setFormData({...formData, category: e.target.value})} placeholder="Categoría" style={{ width: '100%' }} />
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: '0.6rem', fontSize: '0.75rem', fontWeight: 800, color: 'var(--text-muted)' }}>P. VENTA (COP)</label>
                <NumericFormat required value={formData.price} onValueChange={(values) => setFormData({...formData, price: values.value})} thousandSeparator="." decimalSeparator="," placeholder="0" style={{ width: '100%' }} />
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: '0.6rem', fontSize: '0.75rem', fontWeight: 800, color: 'var(--text-muted)' }}>P. COSTO (COP)</label>
                <NumericFormat required value={formData.costPrice} onValueChange={(values) => setFormData({...formData, costPrice: values.value})} thousandSeparator="." decimalSeparator="," placeholder="0" style={{ width: '100%' }} />
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: '0.6rem', fontSize: '0.75rem', fontWeight: 800, color: 'var(--text-muted)' }}>STOCK INICIAL</label>
                <NumericFormat required value={formData.stock} onValueChange={(values) => setFormData({...formData, stock: values.value})} thousandSeparator="." decimalSeparator="," style={{ width: '100%' }} />
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
              style={{ width: '100%', paddingLeft: '3rem', borderRadius: '12px' }}
            />
          </div>
          <button className="glass" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.7rem 1.2rem', borderRadius: '12px', color: 'var(--text-secondary)', fontWeight: 600, border: 'none', cursor: 'pointer' }}>
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
                        <div style={{ width: '36px', height: '36px', borderRadius: '10px', background: 'rgba(226, 176, 76, 0.08)', display: 'flex', justifyContent: 'center', alignItems: 'center', color: 'var(--accent-primary)', fontWeight: 800, fontSize: '0.9rem' }}>
                          {String(product.name || 'P').charAt(0).toUpperCase()}
                        </div>
                        <span style={{ fontWeight: 700, fontSize: '0.95rem' }}>{product.name}</span>
                      </div>
                    </td>
                    <td style={{ padding: '1.25rem 2rem' }}>
                      <span className="mobile-label">Categoría</span>
                      <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>{product.category}</span>
                    </td>
                    <td style={{ padding: '1.25rem 2rem' }}>
                      <span className="mobile-label">Stock</span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: product.stock < 2 ? 'var(--error)' : 'var(--success)', boxShadow: `0 0 10px ${product.stock < 2 ? 'var(--error)' : 'var(--success)'}` }} />
                        <span style={{ fontWeight: 700, color: product.stock < 2 ? 'var(--error)' : 'var(--success)', fontSize: '0.9rem' }}>{product.stock}</span>
                      </div>
                    </td>
                    <td style={{ padding: '1.25rem 2rem' }}>
                      <span className="mobile-label">Ganancia Est.</span>
                      <div style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--success)' }}>+${Math.round(profit).toLocaleString('es-CO')}</div>
                      <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>M: {margin.toFixed(1)}%</div>
                    </td>
                    <td style={{ padding: '1.25rem 2rem', fontWeight: 800 }}>
                      <span className="mobile-label">P. Venta</span>
                      ${Math.round(product.price).toLocaleString('es-CO')}
                    </td>
                    <td style={{ padding: '1.25rem 2rem' }}>
                      <div style={{ display: 'flex', gap: '0.5rem' }}>
                        <button onClick={() => setSelectedDetail(product)} style={{ padding: '0.5rem', borderRadius: '8px', background: 'rgba(255,255,255,0.03)', color: 'var(--info)', border: 'none', cursor: 'pointer' }}>
                          <Eye size={16} />
                        </button>
                        <button onClick={() => handleEdit(product)} style={{ padding: '0.5rem', borderRadius: '8px', background: 'rgba(255,255,255,0.03)', color: 'var(--text-muted)', border: 'none', cursor: 'pointer' }}>
                          <Edit2 size={16} />
                        </button>
                        <button 
                          onClick={() => confirm(`¿Estás seguro de eliminar "${product.name}"? Esta acción no se puede deshacer.`, () => {
                            deleteProduct(product.id);
                            notify('Producto eliminado correctamente.', 'info');
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
      </AnimatePresence>
    </div>
  );
};

export default Inventory;
