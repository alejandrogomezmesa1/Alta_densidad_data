import React, { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Users, 
  Search, 
  UserPlus, 
  Phone, 
  MapPin, 
  CreditCard, 
  Calendar, 
  ChevronRight, 
  Filter,
  Trash2,
  Edit,
  X,
  ShoppingBag,
  DollarSign
} from 'lucide-react';

const Clients = ({ customers, sales, updateCustomer, deleteCustomer, notify, confirm }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [isEditing, setIsEditing] = useState(null);
  const [formData, setFormData] = useState({ nombre: '', telefono: '', cedula: '', ciudad: '', direccion: '' });
  const [selectedClient, setSelectedClient] = useState(null);

  const clientStats = useMemo(() => {
    return (customers || []).map(client => {
      const clientSales = (sales || []).filter(s => s.customerId === client.id);
      const totalSpent = clientSales.reduce((acc, s) => acc + (parseFloat(s.total) || 0), 0);
      return {
        ...client,
        salesCount: clientSales.length,
        totalSpent,
        lastPurchase: clientSales.length > 0 ? clientSales[0].date : 'Nunca'
      };
    });
  }, [customers, sales]);

  const filteredClients = useMemo(() => {
    return clientStats.filter(c => 
      c.nombre.toLowerCase().includes(searchTerm.toLowerCase()) || 
      (c.cedula && c.cedula.includes(searchTerm))
    );
  }, [clientStats, searchTerm]);

  const handleEdit = (client) => {
    setIsEditing(client.id);
    setFormData({
      nombre: client.nombre,
      telefono: client.telefono || '',
      cedula: client.cedula || '',
      ciudad: client.ciudad || '',
      direccion: client.direccion || ''
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    await updateCustomer(isEditing, formData);
    setIsEditing(null);
  };

  const handleDelete = (id) => {
    confirm('¿Seguro que quieres eliminar este cliente? Se perderá el vínculo con sus ventas históricas.', () => {
      deleteCustomer(id);
    });
  };

  return (
    <div className="main-content">
      <header className="page-header">
        <div>
          <h2 className="title-gradient" style={{ fontSize: '2.5rem', marginBottom: '0.5rem' }}>Directorio de Clientes</h2>
          <p style={{ color: 'var(--text-secondary)', fontWeight: 500 }}>Gestión de relaciones y fidelización (CRM)</p>
        </div>
        
        <div style={{ position: 'relative', width: '300px', maxWidth: '100%' }}>
          <Search size={18} style={{ position: 'absolute', left: '1rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
          <input 
            type="text" 
            placeholder="Buscar por nombre o cédula..." 
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            style={{ width: '100%', paddingLeft: '2.5rem' }}
          />
        </div>
      </header>

      <div className="stat-card-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1.5rem' }}>
        {filteredClients.map((client) => (
          <motion.div 
            layout
            key={client.id}
            className="premium-card"
            style={{ position: 'relative', overflow: 'hidden' }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.5rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                <div style={{ 
                  width: '50px', height: '50px', borderRadius: '15px', 
                  background: 'rgba(226, 176, 76, 0.1)', color: 'var(--accent-primary)',
                  display: 'flex', justifyContent: 'center', alignItems: 'center',
                  fontSize: '1.2rem', fontWeight: 800
                }}>
                  {client.nombre.charAt(0).toUpperCase()}
                </div>
                <div>
                  <h3 style={{ margin: 0, fontSize: '1.1rem' }}>{client.nombre}</h3>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>ID: #{String(client.id).padStart(4, '0')}</span>
                </div>
              </div>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button onClick={() => handleEdit(client)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}><Edit size={16} /></button>
                <button onClick={() => handleDelete(client.id)} style={{ background: 'none', border: 'none', color: 'var(--error)', opacity: 0.6, cursor: 'pointer' }}><Trash2 size={16} /></button>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1.5rem' }}>
              <div style={{ padding: '1rem', background: 'rgba(255,255,255,0.02)', borderRadius: '12px', border: '1px solid var(--glass-border)' }}>
                <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '0.25rem' }}>Total Compras</div>
                <div style={{ fontSize: '1.1rem', fontWeight: 800, color: 'var(--success)' }}>${Math.round(client.totalSpent).toLocaleString('es-CO')}</div>
              </div>
              <div style={{ padding: '1rem', background: 'rgba(255,255,255,0.02)', borderRadius: '12px', border: '1px solid var(--glass-border)' }}>
                <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '0.25rem' }}>Frecuencia</div>
                <div style={{ fontSize: '1.1rem', fontWeight: 800, color: 'var(--accent-primary)' }}>{client.salesCount} <span style={{ fontSize: '0.7rem', fontWeight: 400 }}>pedidos</span></div>
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}><Phone size={14} color="var(--accent-primary)" /> {client.telefono || 'Sin teléfono'}</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}><MapPin size={14} color="var(--accent-primary)" /> {client.ciudad ? `${client.ciudad}, ${client.direccion || ''}` : 'Sin dirección'}</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}><CreditCard size={14} color="var(--accent-primary)" /> {client.cedula || 'Sin documento'}</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}><Calendar size={14} color="var(--text-muted)" /> <span style={{ fontSize: '0.75rem' }}>Última compra: {client.lastPurchase}</span></div>
            </div>

            <button 
                onClick={() => setSelectedClient(client)}
                style={{ 
                    width: '100%', marginTop: '1.5rem', padding: '0.75rem', 
                    background: 'rgba(255,255,255,0.05)', border: '1px solid var(--glass-border)',
                    borderRadius: '10px', color: '#fff', fontSize: '0.8rem', fontWeight: 600,
                    cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem'
                }}
            >
                Ver Historial Completo <ChevronRight size={14} />
            </button>
          </motion.div>
        ))}
      </div>

      <AnimatePresence>
        {isEditing && (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', backdropFilter: 'blur(8px)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 10000 }}>
            <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="premium-card" style={{ maxWidth: '450px', width: '90%' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '2rem' }}>
                <h3 style={{ color: 'var(--accent-primary)' }}>Editar Cliente</h3>
                <button onClick={() => setIsEditing(null)} style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer' }}><X size={20} /></button>
              </div>
              <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>NOMBRE</label>
                  <input required type="text" value={formData.nombre} onChange={e => setFormData({...formData, nombre: e.target.value})} style={{ width: '100%' }} />
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>TELÉFONO</label>
                    <input type="text" value={formData.telefono} onChange={e => setFormData({...formData, telefono: e.target.value})} style={{ width: '100%' }} />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>CÉDULA/NIT</label>
                    <input type="text" value={formData.cedula} onChange={e => setFormData({...formData, cedula: e.target.value})} style={{ width: '100%' }} />
                  </div>
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>CIUDAD</label>
                  <input type="text" value={formData.ciudad} onChange={e => setFormData({...formData, ciudad: e.target.value})} style={{ width: '100%' }} />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>DIRECCIÓN</label>
                  <input type="text" value={formData.direccion} onChange={e => setFormData({...formData, direccion: e.target.value})} style={{ width: '100%' }} />
                </div>
                <button type="submit" className="btn-primary" style={{ marginTop: '1rem' }}>GUARDAR CAMBIOS</button>
              </form>
            </motion.div>
          </div>
        )}

        {selectedClient && (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(12px)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 10000, padding: '2rem' }}>
            <motion.div initial={{ y: 50, opacity: 0 }} animate={{ y: 0, opacity: 1 }} className="premium-card" style={{ maxWidth: '700px', width: '100%', maxHeight: '85vh', overflowY: 'auto' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '2.5rem', alignItems: 'center' }}>
                <div>
                    <h3 style={{ margin: 0, color: 'var(--accent-primary)' }}>Historial: {selectedClient.nombre}</h3>
                    <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-muted)' }}>Resumen de actividad comercial</p>
                </div>
                <button onClick={() => setSelectedClient(null)} style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer' }}><X size={24} /></button>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1rem', marginBottom: '2rem' }}>
                <div className="glass" style={{ padding: '1rem', borderRadius: '12px', textAlign: 'center' }}>
                    <DollarSign size={20} color="var(--success)" style={{ marginBottom: '0.5rem' }} />
                    <div style={{ fontSize: '1.2rem', fontWeight: 800 }}>${Math.round(selectedClient.totalSpent).toLocaleString('es-CO')}</div>
                    <div style={{ fontSize: '0.6rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Invertido</div>
                </div>
                <div className="glass" style={{ padding: '1rem', borderRadius: '12px', textAlign: 'center' }}>
                    <ShoppingBag size={20} color="var(--accent-primary)" style={{ marginBottom: '0.5rem' }} />
                    <div style={{ fontSize: '1.2rem', fontWeight: 800 }}>{selectedClient.salesCount}</div>
                    <div style={{ fontSize: '0.6rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Compras</div>
                </div>
                <div className="glass" style={{ padding: '1rem', borderRadius: '12px', textAlign: 'center' }}>
                    <Calendar size={20} color="var(--info)" style={{ marginBottom: '0.5rem' }} />
                    <div style={{ fontSize: '0.85rem', fontWeight: 700 }}>{selectedClient.lastPurchase}</div>
                    <div style={{ fontSize: '0.6rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Última vez</div>
                </div>
              </div>

              <h4 style={{ fontSize: '0.9rem', marginBottom: '1rem', color: 'var(--text-secondary)' }}>FACTURAS RECIENTES</h4>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                {(sales || []).filter(s => s.customerId === selectedClient.id).map(sale => (
                  <div key={sale.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1rem', background: 'rgba(255,255,255,0.02)', borderRadius: '12px', border: '1px solid var(--glass-border)' }}>
                    <div>
                        <div style={{ fontWeight: 700 }}>Factura #{sale.id}</div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{sale.date} • {sale.method}</div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                        <div style={{ fontWeight: 800, color: 'var(--accent-primary)' }}>${Math.round(sale.total).toLocaleString('es-CO')}</div>
                        <div style={{ fontSize: '0.7rem', color: sale.status === 'paid' ? 'var(--success)' : 'var(--warning)' }}>{sale.status === 'paid' ? 'PAGADO' : 'PENDIENTE'}</div>
                    </div>
                  </div>
                ))}
              </div>

              <button onClick={() => setSelectedClient(null)} className="btn-secondary" style={{ width: '100%', marginTop: '2rem' }}>CERRAR PANEL</button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default Clients;
