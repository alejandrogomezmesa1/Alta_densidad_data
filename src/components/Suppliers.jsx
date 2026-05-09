import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, Search, Edit2, Trash2, Filter, Download, Users, X, Phone, Mail, Tag, MapPin } from 'lucide-react';

const Suppliers = ({ suppliers, addSupplier, updateSupplier, deleteSupplier, notify, confirm }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [isAdding, setIsAdding] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [formData, setFormData] = useState({ name: '', phone: '', email: '', category: '', address: '' });

  const items = Array.isArray(suppliers) ? suppliers : [];
  const filteredSuppliers = items.filter(s => 
    (String(s?.name || '')).toLowerCase().includes(searchTerm.toLowerCase()) ||
    (String(s?.category || '')).toLowerCase().includes(searchTerm.toLowerCase())
  ).sort((a, b) => b.id - a.id);

  const handleEdit = (supplier) => {
    setEditingId(supplier.id);
    setFormData({ ...supplier });
    setIsAdding(true);
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (editingId) {
      updateSupplier(editingId, formData);
      setEditingId(null);
    } else {
      addSupplier(formData);
    }
    setFormData({ name: '', phone: '', email: '', category: '', address: '' });
    setIsAdding(false);
  };

  const handleCancel = () => {
    setIsAdding(false);
    setEditingId(null);
    setFormData({ name: '', phone: '', email: '', category: '', address: '' });
  };

  return (
    <div className="main-content">
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '3rem' }}>
        <div>
          <h2 className="title-gradient" style={{ fontSize: '2.5rem', marginBottom: '0.5rem' }}>Proveedores</h2>
          <p style={{ color: 'var(--text-secondary)', fontWeight: 500 }}>Gestiona tus aliados estratégicos y fuentes de abastecimiento.</p>
        </div>
        <div style={{ display: 'flex', gap: '1rem' }}>
          <button 
            onClick={() => setIsAdding(!isAdding)}
            className="btn-primary" 
            style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}
          >
            <Plus size={20} />
            {editingId ? 'Editando Proveedor' : 'Nuevo Proveedor'}
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
            <h4 style={{ marginBottom: '1.5rem', color: 'var(--accent-primary)' }}>{editingId ? 'EDITAR PROVEEDOR' : 'REGISTRAR NUEVO PROVEEDOR'}</h4>
            <form onSubmit={handleSubmit} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1.5rem', alignItems: 'flex-end' }}>
              <div style={{ gridColumn: 'span 1' }}>
                <label style={{ display: 'block', marginBottom: '0.6rem', fontSize: '0.75rem', fontWeight: 800, color: 'var(--text-muted)' }}>NOMBRE / RAZÓN SOCIAL</label>
                <input required type="text" value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} placeholder="Nombre de la empresa" style={{ width: '100%' }} />
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: '0.6rem', fontSize: '0.75rem', fontWeight: 800, color: 'var(--text-muted)' }}>CATEGORÍA</label>
                <input type="text" value={formData.category} onChange={e => setFormData({...formData, category: e.target.value})} placeholder="Ej: Electrónica" style={{ width: '100%' }} />
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: '0.6rem', fontSize: '0.75rem', fontWeight: 800, color: 'var(--text-muted)' }}>TELÉFONO</label>
                <div style={{ position: 'relative' }}>
                  <Phone size={14} style={{ position: 'absolute', left: '1rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                  <input type="text" value={formData.phone} onChange={e => setFormData({...formData, phone: e.target.value})} placeholder="300..." style={{ width: '100%', paddingLeft: '2.5rem' }} />
                </div>
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: '0.6rem', fontSize: '0.75rem', fontWeight: 800, color: 'var(--text-muted)' }}>EMAIL</label>
                <div style={{ position: 'relative' }}>
                  <Mail size={14} style={{ position: 'absolute', left: '1rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                  <input type="email" value={formData.email} onChange={e => setFormData({...formData, email: e.target.value})} placeholder="contacto@..." style={{ width: '100%', paddingLeft: '2.5rem' }} />
                </div>
              </div>
              <div style={{ gridColumn: 'span 1' }}>
                <label style={{ display: 'block', marginBottom: '0.6rem', fontSize: '0.75rem', fontWeight: 800, color: 'var(--text-muted)' }}>DIRECCIÓN</label>
                <div style={{ position: 'relative' }}>
                  <MapPin size={14} style={{ position: 'absolute', left: '1rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                  <input type="text" value={formData.address} onChange={e => setFormData({...formData, address: e.target.value})} placeholder="Calle..." style={{ width: '100%', paddingLeft: '2.5rem' }} />
                </div>
              </div>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button type="submit" className="btn-primary" style={{ flex: 1, height: '45px', fontSize: '0.8rem' }}>
                  {editingId ? 'ACTUALIZAR' : 'GUARDAR PROVEEDOR'}
                </button>
              </div>
            </form>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="premium-card" style={{ padding: 0 }}>
        <div style={{ padding: '1.5rem 2rem', display: 'flex', gap: '1.5rem', alignItems: 'center' }}>
          <div style={{ position: 'relative', flex: 1 }}>
            <Search style={{ position: 'absolute', left: '1rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} size={18} />
            <input 
              type="text" 
              placeholder="Buscar proveedor por nombre o categoría..."
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              style={{ width: '100%', paddingLeft: '3rem', borderRadius: '12px' }}
            />
          </div>
        </div>

        <div className="table-responsive-wrapper">
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
            <thead>
              <tr style={{ background: 'rgba(255,255,255,0.01)' }}>
                <th style={{ padding: '1.25rem 2rem', fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>Proveedor</th>
                <th style={{ padding: '1.25rem 2rem', fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>Categoría</th>
                <th style={{ padding: '1.25rem 2rem', fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>Contacto</th>
                <th style={{ padding: '1.25rem 2rem', fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>Ubicación</th>
                <th style={{ padding: '1.25rem 2rem', fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {filteredSuppliers.map((supplier, idx) => (
                <motion.tr 
                  key={supplier.id}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: idx * 0.03 }}
                  style={{ borderBottom: '1px solid var(--glass-border)' }}
                >
                  <td style={{ padding: '1.25rem 2rem' }}>
                    <span className="mobile-label">Proveedor</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                      <div style={{ width: '36px', height: '36px', borderRadius: '10px', background: 'rgba(226, 176, 76, 0.08)', display: 'flex', justifyContent: 'center', alignItems: 'center', color: 'var(--accent-primary)', fontWeight: 800, fontSize: '0.9rem' }}>
                        {String(supplier.name || 'S').charAt(0).toUpperCase()}
                      </div>
                      <span style={{ fontWeight: 700, fontSize: '0.95rem' }}>{supplier.name}</span>
                    </div>
                  </td>
                  <td style={{ padding: '1.25rem 2rem' }}>
                    <span className="mobile-label">Categoría</span>
                    <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>{supplier.category || 'General'}</span>
                  </td>
                  <td style={{ padding: '1.25rem 2rem' }}>
                    <span className="mobile-label">Contacto</span>
                    <div style={{ fontSize: '0.85rem', fontWeight: 600 }}>{supplier.phone || 'Sin teléfono'}</div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{supplier.email || 'Sin email'}</div>
                  </td>
                  <td style={{ padding: '1.25rem 2rem' }}>
                    <span className="mobile-label">Ubicación</span>
                    <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>{supplier.address || 'N/A'}</span>
                  </td>
                  <td style={{ padding: '1.25rem 2rem' }}>
                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                      <button onClick={() => handleEdit(supplier)} style={{ padding: '0.5rem', borderRadius: '8px', background: 'rgba(255,255,255,0.03)', color: 'var(--text-muted)', border: 'none', cursor: 'pointer' }}>
                        <Edit2 size={16} />
                      </button>
                      <button 
                        onClick={() => confirm(`¿Estás seguro de eliminar a "${supplier.name}"?`, () => {
                          deleteSupplier(supplier.id);
                          notify('Proveedor eliminado correctamente.', 'info');
                        })}
                        style={{ padding: '0.5rem', borderRadius: '8px', background: 'rgba(255,69,58,0.08)', color: 'var(--error)', border: 'none', cursor: 'pointer' }}
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </td>
                </motion.tr>
              ))}
            </tbody>
          </table>
          {filteredSuppliers.length === 0 && (
            <div style={{ padding: '5rem', textAlign: 'center', color: 'var(--text-muted)' }}>
              <Users size={48} style={{ opacity: 0.1, marginBottom: '1rem' }} />
              <p>No hay proveedores registrados.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default Suppliers;
