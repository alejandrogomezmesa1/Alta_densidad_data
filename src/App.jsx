import React, { useState, useCallback, useEffect, useRef } from 'react';
import Sidebar from './components/Sidebar';
import { MENU } from './utils/menu';
import Dashboard from './components/Dashboard';
import Inventory from './components/Inventory';
import Kits from './components/Kits';
import Configuraciones from './components/Configuraciones';
import Recetas from './components/Recetas';
import { CONFIG_DEFECTO } from './utils/inventario';
import Transactions from './components/Transactions';
import CashRegister from './components/CashRegister';
import Collections from './components/Collections';
import Vender from './components/Vender';
import Recibir from './components/Recibir';
import Consultar from './components/Consultar';
import Contabilidad from './components/Contabilidad';
import Suppliers from './components/Suppliers';
import Clients from './components/Clients';
import Login from './components/Login';
import { api } from './services/api';
import { useInventory } from './hooks/useInventory';
import { AnimatePresence, motion } from 'framer-motion';
import { CheckCircle, XCircle, AlertTriangle, Info, X, Menu } from 'lucide-react';

const Notification = ({ id, message, type, onClose }) => {
  const icons = {
    success: <CheckCircle size={16} color="var(--success)" />,
    error: <XCircle size={16} color="var(--error)" />,
    warning: <AlertTriangle size={16} color="var(--warning)" />,
    info: <Info size={16} color="var(--info)" />
  };

  React.useEffect(() => {
    const timer = setTimeout(() => onClose(id), 4000);
    return () => clearTimeout(timer);
  }, [id, onClose]);

  return (
    <motion.div
      initial={{ opacity: 0, x: 24 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 16 }}
      className={`toast ${type}`}
      role="status"
    >
      {icons[type]}
      <p style={{ flex: 1 }}>{message}</p>
      <button onClick={() => onClose(id)} aria-label="Cerrar" style={{ color: 'var(--text-muted)', display: 'grid', placeItems: 'center' }}>
        <X size={14} />
      </button>
    </motion.div>
  );
};

const ConfirmModal = ({ isOpen, message, onConfirm, onCancel }) => (
  <AnimatePresence>
    {isOpen && (
      <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 20000, padding: '1.5rem' }}>
        <motion.div initial={{ y: 12, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 12, opacity: 0 }} className="premium-card" style={{ maxWidth: '420px', width: '100%', padding: '2rem' }} role="alertdialog" aria-modal="true">
          <span className="up" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '10px', color: 'var(--accent-primary)', marginBottom: '0.75rem' }}>
            <AlertTriangle size={14} /> Confirmar acción
          </span>
          <p style={{ color: 'var(--text-secondary)', marginBottom: '2rem', lineHeight: 1.6 }}>{message}</p>
          <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
            <button onClick={onCancel} className="btn-secondary">Cancelar</button>
            <button onClick={onConfirm} className="btn-primary">Confirmar</button>
          </div>
        </motion.div>
      </div>
    )}
  </AnimatePresence>
);

// Escritorio: el menú lateral se pliega a solo íconos; en móvil/tablet es un panel deslizable
const ESCRITORIO = '(min-width: 1025px)';

function App() {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [compacto, setCompacto] = useState(() => document.documentElement.classList.contains('side-compacto'));

  // Pasar de escritorio a móvil (o al revés) cierra el panel móvil; Escape también lo cierra
  useEffect(() => {
    const mq = window.matchMedia(ESCRITORIO);
    const cambio = () => setIsSidebarOpen(false);
    mq.addEventListener('change', cambio);
    return () => mq.removeEventListener('change', cambio);
  }, []);
  useEffect(() => {
    if (!isSidebarOpen) return undefined;
    const esc = (e) => { if (e.key === 'Escape') setIsSidebarOpen(false); };
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [isSidebarOpen]);

  const alternarMenu = () => {
    if (window.matchMedia(ESCRITORIO).matches) {
      const nuevo = !compacto;
      document.documentElement.classList.toggle('side-compacto', nuevo);
      try { localStorage.setItem('data_sidebar', nuevo ? 'compacto' : 'expandido'); } catch { /* sin almacenamiento */ }
      setCompacto(nuevo);
      // Los gráficos del Dashboard recalculan su ancho tras la transición
      setTimeout(() => window.dispatchEvent(new Event('resize')), 320);
    } else {
      setIsSidebarOpen((a) => !a);
    }
  };
  const grupoActual = MENU.find((g) => g.items.some((i) => i.id === activeTab)) || MENU[0];
  const seccionActual = grupoActual.items.find((i) => i.id === activeTab) || grupoActual.items[0];
  const fechaHoy = new Date().toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long' });
  const [notifications, setNotifications] = useState([]);
  const [confirmConfig, setConfirmConfig] = useState({ isOpen: false, message: '', onConfirm: () => {} });
  const [auth, setAuth] = useState({ 
    isAuthenticated: api.isAuthenticated(), 
    username: localStorage.getItem('alta_user') 
  });

  useEffect(() => {
    // Check auth on mount
    setAuth({ 
      isAuthenticated: api.isAuthenticated(), 
      username: localStorage.getItem('alta_user') 
    });
  }, []);

  const handleLoginSuccess = () => {
    setAuth({ 
      isAuthenticated: true, 
      username: localStorage.getItem('alta_user') 
    });
  };

  const handleLogout = () => {
    api.logout();
    setAuth({ isAuthenticated: false, username: null });
  };

  const notify = useCallback((message, type = 'success') => {
    const id = Date.now() + Math.random();
    setNotifications(prev => [...prev, { id, message, type }]);
  }, []);

  // Si el servidor rechaza el token (vencido o inválido), volver al login.
  // Varias peticiones pueden fallar a la vez: solo se avisa una vez.
  const authRef = useRef(auth.isAuthenticated);
  useEffect(() => { authRef.current = auth.isAuthenticated; }, [auth.isAuthenticated]);
  useEffect(() => {
    const onExpired = () => {
      if (!authRef.current) return;
      authRef.current = false;
      notify('Tu sesión expiró. Ingresa de nuevo.', 'warning');
      setAuth({ isAuthenticated: false, username: null });
    };
    window.addEventListener('alta:session-expired', onExpired);
    return () => window.removeEventListener('alta:session-expired', onExpired);
  }, [notify]);

  const removeNotification = useCallback((id) => {
    setNotifications(prev => prev.filter(n => n.id !== id));
  }, []);

  const requestConfirm = (message, onConfirm) => {
    setConfirmConfig({
      isOpen: true,
      message,
      onConfirm: () => {
        onConfirm();
        setConfirmConfig(prev => ({ ...prev, isOpen: false }));
      }
    });
  };

  const { 
    inventory, sales, purchases, expenses, customers,
    addProduct, updateProduct, deleteProduct, 
    addSale, updateSale, deleteSale, addPaymentToSale,
    addPurchase, updatePurchase, deletePurchase, 
    addExpense, updateExpense, deleteExpense,
    suppliers, addSupplier, updateSupplier, deleteSupplier, getMostFrequentSupplierId,
    updateCustomer, deleteCustomer,
    exportData, fetchData
  } = useInventory(notify, auth.isAuthenticated); // Injecting notification system

  // Configuraciones del sistema (semáforo de stock…); se recargan al iniciar sesión
  const [config, setConfig] = useState(CONFIG_DEFECTO);
  useEffect(() => {
    if (!auth.isAuthenticated) return;
    api.get('/settings').then((r) => setConfig({ ...CONFIG_DEFECTO, ...r.valores })).catch(() => {});
  }, [auth.isAuthenticated]);

  const renderContent = () => {
    const commonProps = { notify, confirm: requestConfirm, config };
    
    switch(activeTab) {
      case 'vender':
        return <Vender {...commonProps} products={inventory} customers={customers} onDone={fetchData} />;
      case 'recibir':
        return <Recibir {...commonProps} products={inventory} suppliers={suppliers} onDone={fetchData} />;
      case 'consultar':
        return <Consultar {...commonProps} />;
      case 'contabilidad':
        return <Contabilidad {...commonProps} />;
      case 'dashboard':
        return <Dashboard {...commonProps} sales={sales} inventory={inventory} purchases={purchases} expenses={expenses} setActiveTab={setActiveTab} />;
      case 'inventory':
        return <Inventory 
          {...commonProps}
          inventory={inventory} 
          addProduct={addProduct} 
          updateProduct={updateProduct}
          deleteProduct={deleteProduct} 
          exportData={exportData}
          onRefresh={fetchData}
        />;
      case 'settings':
        return <Configuraciones {...commonProps} onGuardado={(v) => setConfig({ ...CONFIG_DEFECTO, ...v })} />;
      case 'recipes':
        return <Recetas {...commonProps} inventory={inventory} />;
      case 'kits':
        return <Kits {...commonProps} inventory={inventory} onRefresh={fetchData} />;
      case 'sales':
        return <Transactions 
          {...commonProps}
          type="sales" 
          data={sales} 
          products={inventory} 
          customers={customers}
          onAdd={addSale} 
          onDelete={deleteSale}
          onUpdate={updateSale}
          onAddPayment={addPaymentToSale}
        />;
      case 'purchases':
        return <Transactions 
          {...commonProps}
          type="purchases" 
          data={purchases} 
          products={inventory} 
          onAdd={addPurchase} 
          onDelete={deletePurchase}
          onUpdate={updatePurchase}
          suppliers={suppliers}
          mostFrequentSupplierId={getMostFrequentSupplierId()}
        />;
      case 'expenses':
        return <Transactions 
          {...commonProps}
          type="expenses" 
          data={expenses} 
          products={inventory}
          onAdd={addExpense} 
          onDelete={deleteExpense}
          onUpdate={updateExpense}
        />;
      case 'suppliers':
        return <Suppliers 
          {...commonProps}
          suppliers={suppliers}
          addSupplier={addSupplier}
          updateSupplier={updateSupplier}
          deleteSupplier={deleteSupplier}
        />;
      case 'clients':
        return <Clients 
          {...commonProps}
          customers={customers}
          sales={sales}
          updateCustomer={updateCustomer}
          deleteCustomer={deleteCustomer}
        />;
      case 'cash':
        return <CashRegister 
          {...commonProps}
          sales={sales} 
          purchases={purchases} 
          expenses={expenses} 
        />;
      case 'collections':
        return <Collections {...commonProps} sales={sales} onAddPayment={addPaymentToSale} />;
      default:
        return <Dashboard {...commonProps} sales={sales} inventory={inventory} purchases={purchases} expenses={expenses} />;
    }
  };

  if (!auth.isAuthenticated) {
    return (
      <div style={{ background: 'var(--bg-main)' }}>
        <div style={{ position: 'fixed', bottom: '1.5rem', right: '1.5rem', zIndex: 9999, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.5rem' }}>
          <AnimatePresence>
            {notifications.map(n => (
              <Notification key={n.id} {...n} onClose={removeNotification} />
            ))}
          </AnimatePresence>
        </div>
        <Login onLoginSuccess={handleLoginSuccess} notify={notify} />
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: 'var(--bg-main)', position: 'relative' }}>
      {/* Notifications & Status Layer */}
      <div style={{ position: 'fixed', bottom: '1.5rem', right: '1.5rem', zIndex: 9999, pointerEvents: 'none', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.5rem' }}>
        <AnimatePresence>
          {notifications.map(n => (
            <Notification key={n.id} {...n} onClose={removeNotification} />
          ))}
        </AnimatePresence>
      </div>

      <ConfirmModal 
        isOpen={confirmConfig.isOpen} 
        message={confirmConfig.message} 
        onConfirm={confirmConfig.onConfirm} 
        onCancel={() => setConfirmConfig(prev => ({ ...prev, isOpen: false }))} 
      />

      <Sidebar 
        activeTab={activeTab} 
        setActiveTab={setActiveTab} 
        isOpen={isSidebarOpen} 
        setIsOpen={setIsSidebarOpen} 
        onLogout={handleLogout}
        username={auth.username}
      />
      
      <div className="content-shell">
        {/* Barra superior (como el panel de la tienda): plegar el menú, sección actual y fecha */}
        <header className="top-bar">
          <button className="top-toggle" onClick={alternarMenu} aria-label="Mostrar u ocultar menú"
            aria-expanded={isSidebarOpen || !compacto}>
            <Menu size={18} />
          </button>
          <div className="top-crumb">
            <span className="top-crumb-kicker">{grupoActual.title}</span>
            <h1 className="top-crumb-title">{seccionActual.label}</h1>
          </div>
          <span className="top-date">{fechaHoy}</span>
        </header>
        <AnimatePresence mode="wait">
          <motion.div
            key={activeTab}
            initial={{ opacity: 0, x: 10 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -10 }}
            transition={{ duration: 0.3, ease: 'easeOut' }}
          >
            {renderContent()}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}

export default App;
