import React from 'react';
import { motion } from 'framer-motion';
import { 
  LayoutDashboard, 
  Package, 
  ShoppingCart, 
  TrendingUp, 
  Receipt, 
  Settings,
  LogOut,
  Users,
  Wallet,
  ShieldCheck,
  Clock
} from 'lucide-react';

const Sidebar = ({ activeTab, setActiveTab }) => {
  const menuItems = [
    { id: 'dashboard', icon: LayoutDashboard, label: 'Dashboard' },
    { id: 'inventory', icon: Package, label: 'Inventario' },
    { id: 'sales', icon: TrendingUp, label: 'Ventas' },
    { id: 'purchases', icon: ShoppingCart, label: 'Compras' },
    { id: 'expenses', icon: Receipt, label: 'Gastos' },
    { id: 'suppliers', icon: Users, label: 'Proveedores' },
    { id: 'cash', icon: Wallet, label: 'Caja' },
    { id: 'collections', icon: Clock, label: 'Cartera' },
  ];

  return (
    <aside className="glass" style={{
      width: '280px',
      height: '100vh',
      position: 'fixed',
      left: 0,
      top: 0,
      padding: '2.5rem 1.5rem',
      display: 'flex',
      flexDirection: 'column',
      zIndex: 1000,
      borderRight: '1px solid var(--glass-border)'
    }}>
      <div style={{ marginBottom: '3rem', padding: '0 0.5rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <div style={{ 
            width: '40px', height: '40px', borderRadius: '12px', 
            background: 'linear-gradient(135deg, var(--accent-primary), var(--accent-secondary))',
            display: 'flex', justifyContent: 'center', alignItems: 'center',
            boxShadow: '0 0 20px var(--accent-glow)'
          }}>
            <TrendingUp size={24} color="#000" />
          </div>
          <div>
            <h1 className="title-gradient" style={{ fontSize: '1.25rem', lineHeight: 1 }}>ALTA DENSIDAD</h1>
            <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>Premium Management</span>
          </div>
        </div>
      </div>

      <nav style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', flex: 1 }}>
        {menuItems.map((item) => (
          <button
            key={item.id}
            onClick={() => setActiveTab(item.id)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '1rem',
              padding: '1rem 1.25rem',
              borderRadius: '14px',
              width: '100%',
              transition: 'all var(--transition-smooth)',
              color: activeTab === item.id ? 'var(--accent-primary)' : 'var(--text-secondary)',
              background: activeTab === item.id ? 'rgba(226, 176, 76, 0.08)' : 'transparent',
              position: 'relative',
              border: 'none',
              textAlign: 'left'
            }}
          >
            {activeTab === item.id && (
              <motion.div 
                layoutId="activeTab"
                style={{ 
                  position: 'absolute', left: 0, width: '4px', height: '20px', 
                  background: 'var(--accent-primary)', borderRadius: '0 4px 4px 0',
                  boxShadow: '0 0 10px var(--accent-primary)'
                }}
              />
            )}
            <item.icon size={20} strokeWidth={activeTab === item.id ? 2.5 : 2} />
            <span style={{ fontWeight: activeTab === item.id ? 700 : 500, fontSize: '0.95rem' }}>{item.label}</span>
          </button>
        ))}
      </nav>

      <div style={{ marginTop: 'auto', paddingTop: '2rem', borderTop: '1px solid var(--glass-border)' }}>
        <button style={{
          display: 'flex',
          alignItems: 'center',
          gap: '1rem',
          color: 'var(--text-muted)',
          fontSize: '0.9rem',
          padding: '0.75rem 1.25rem',
          width: '100%',
          transition: 'color 0.3s'
        }} className="sidebar-footer-btn">
          <Settings size={18} />
          <span>Configuración</span>
        </button>
        <button style={{
          display: 'flex',
          alignItems: 'center',
          gap: '1rem',
          color: 'var(--error)',
          fontSize: '0.9rem',
          padding: '0.75rem 1.25rem',
          width: '100%',
          marginTop: '0.5rem'
        }}>
          <LogOut size={18} />
          <span>Cerrar Sesión</span>
        </button>
      </div>
    </aside>
  );
};

export default Sidebar;
