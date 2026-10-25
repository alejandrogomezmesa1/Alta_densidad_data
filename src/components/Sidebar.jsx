import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { LogOut, Store, ArrowUpRight, X } from 'lucide-react';
import { MENU } from '../utils/menu';

// Panel de administración de la tienda web (mismo sistema, otro sitio)
const PANEL_TIENDA = import.meta.env.VITE_PAGE_ADMIN_URL || 'https://alta-densidad-page.vercel.app/admin';


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
          <div className="side-brand-txt">
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
                  data-label={item.label}
                  title={item.label}
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
            <a className="side-item side-link" href={PANEL_TIENDA} title="Ir al panel de la tienda web" data-label="Tienda web">
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
