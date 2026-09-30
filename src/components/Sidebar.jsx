import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  LayoutDashboard,
  Package,
  ShoppingCart,
  TrendingUp,
  Receipt,
  LogOut,
  Users,
  Wallet,
  ShieldCheck,
  Clock,
  Store,
  ArrowUpRight,
  Gift,
  Settings,
  X
} from 'lucide-react';

// Panel de administración de la tienda web (mismo sistema, otro sitio)
const PANEL_TIENDA = import.meta.env.VITE_PAGE_ADMIN_URL || 'https://alta-densidad-page.vercel.app/admin';

const MENU = [
  { title: 'Resumen', items: [
    { id: 'dashboard', icon: LayoutDashboard, label: 'Dashboard' },
  ]},
  { title: 'Operación', items: [
    { id: 'sales', icon: TrendingUp, label: 'Ventas' },
    { id: 'purchases', icon: ShoppingCart, label: 'Compras' },
    { id: 'expenses', icon: Receipt, label: 'Gastos' },
    { id: 'cash', icon: Wallet, label: 'Caja' },
  ]},
  { title: 'Catálogo', items: [
    { id: 'inventory', icon: Package, label: 'Inventario' },
    { id: 'kits', icon: Gift, label: 'Kits' },
  ]},
  { title: 'Relaciones', items: [
    { id: 'clients', icon: Users, label: 'Clientes' },
    { id: 'collections', icon: Clock, label: 'Cartera' },
    { id: 'suppliers', icon: ShieldCheck, label: 'Proveedores' },
  ]},
  { title: 'Sistema', items: [
    { id: 'settings', icon: Settings, label: 'Configuraciones' },
  ]},
];

const Sidebar = ({ activeTab, setActiveTab, isOpen, setIsOpen, onLogout, username }) => {
  const seleccionar = (id) => {
    setActiveTab(id);
    setIsOpen(false);
  };

  return (
    <>
      <AnimatePresence>
        {isOpen && (
          <motion.div
            className="side-scrim"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setIsOpen(false)}
          />
        )}
      </AnimatePresence>

      <aside className={`sidebar${isOpen ? ' open' : ''}`} aria-label="Navegación principal">
        <div className="side-brand">
          <span className="side-brand-mark">AD</span>
          <div>
            <div className="side-brand-name">Alta Densidad</div>
            <div className="side-brand-sub">Sistema de gestión</div>
          </div>
          <button className="side-close" onClick={() => setIsOpen(false)} aria-label="Cerrar menú">
            <X size={18} />
          </button>
        </div>

        <nav className="side-nav">
          {MENU.map(group => (
            <div key={group.title} className="side-group">
              <span className="side-group-title">{group.title}</span>
              {group.items.map(item => (
                <button
                  key={item.id}
                  className={`side-item${activeTab === item.id ? ' active' : ''}`}
                  aria-current={activeTab === item.id ? 'page' : undefined}
                  onClick={() => seleccionar(item.id)}
                >
                  <item.icon size={17} strokeWidth={1.6} />
                  <span>{item.label}</span>
                </button>
              ))}
            </div>
          ))}
          <div className="side-group">
            <span className="side-group-title">Ecosistema</span>
            <a className="side-item side-link" href={PANEL_TIENDA} title="Ir al panel de la tienda web">
              <Store size={17} strokeWidth={1.6} />
              <span>Tienda web</span>
              <ArrowUpRight size={14} strokeWidth={1.6} className="side-ext" aria-hidden="true" />
            </a>
          </div>
        </nav>

        <div className="side-foot">
          <span className="side-avatar">{(username || 'A').charAt(0)}</span>
          <div className="side-user">
            <span className="side-user-name">{username || 'Administrador'}</span>
            <span className="side-user-role">Acceso privado</span>
          </div>
          <button className="side-logout" onClick={onLogout} title="Cerrar sesión" aria-label="Cerrar sesión">
            <LogOut size={16} />
          </button>
        </div>
      </aside>
    </>
  );
};

export default Sidebar;
