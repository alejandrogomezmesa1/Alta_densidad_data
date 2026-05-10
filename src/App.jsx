import React, { useState, useCallback, useEffect } from 'react';
import Sidebar from './components/Sidebar';
import Dashboard from './components/Dashboard';
import Inventory from './components/Inventory';
import Transactions from './components/Transactions';
import CashRegister from './components/CashRegister';
import Collections from './components/Collections';
import Suppliers from './components/Suppliers';
import Clients from './components/Clients';
import Login from './components/Login';
import { api } from './services/api';
import { useInventory } from './hooks/useInventory';
import { AnimatePresence, motion } from 'framer-motion';
import { CheckCircle, XCircle, AlertTriangle, Info, X, Menu, TrendingUp } from 'lucide-react';

const Notification = ({ id, message, type, onClose }) => {
  const icons = {
    success: <CheckCircle size={20} color="var(--success)" />,
    error: <XCircle size={20} color="var(--error)" />,
    warning: <AlertTriangle size={20} color="var(--accent-primary)" />,
    info: <Info size={20} color="var(--info)" />
  };

  React.useEffect(() => {
    const timer = setTimeout(() => onClose(id), 4000);
    return () => clearTimeout(timer);
  }, [id, onClose]);

  return (
    <motion.div
      initial={{ opacity: 0, x: 50, scale: 0.9 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      exit={{ opacity: 0, x: 20, scale: 0.9 }}
      className="glass"
      style={{
        padding: '1rem 1.5rem',
        borderRadius: '16px',
        marginBottom: '0.75rem',
        display: 'flex',
        alignItems: 'center',
        gap: '1rem',
        minWidth: '300px',
        boxShadow: '0 10px 30px rgba(0,0,0,0.3)',
        border: '1px solid var(--glass-border)',
        pointerEvents: 'auto'
      }}
    >
      {icons[type]}
      <p style={{ flex: 1, fontSize: '0.9rem', fontWeight: 600 }}>{message}</p>
      <button onClick={() => onClose(id)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}>
        <X size={16} />
      </button>
    </motion.div>
  );
};

const ConfirmModal = ({ isOpen, message, onConfirm, onCancel }) => (
  <AnimatePresence>
    {isOpen && (
      <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(8px)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 20000, padding: '2rem' }}>
        <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }} className="premium-card" style={{ maxWidth: '400px', width: '100%', textAlign: 'center' }}>
          <div style={{ padding: '1rem', borderRadius: '50%', background: 'rgba(226, 176, 76, 0.1)', color: 'var(--accent-primary)', width: '64px', height: '64px', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1.5rem' }}>
            <AlertTriangle size={32} />
          </div>
          <h3 style={{ fontSize: '1.25rem', marginBottom: '1rem' }}>¿Confirmar Acción?</h3>
          <p style={{ color: 'var(--text-secondary)', marginBottom: '2.5rem', lineHeight: '1.6' }}>{message}</p>
          <div style={{ display: 'flex', gap: '1rem' }}>
            <button onClick={onCancel} style={{ flex: 1, background: 'rgba(255,255,255,0.03)', border: '1px solid var(--glass-border)', color: 'var(--text-muted)' }}>CANCELAR</button>
            <button onClick={onConfirm} className="btn-primary" style={{ flex: 1 }}>CONFIRMAR</button>
          </div>
        </motion.div>
      </div>
    )}
  </AnimatePresence>
);

function App() {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
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
    exportData
  } = useInventory(notify); // Injecting notification system

  const renderContent = () => {
    const commonProps = { notify, confirm: requestConfirm };
    
    switch(activeTab) {
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
        />;
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
        <div style={{ position: 'fixed', top: '2rem', right: '2rem', zIndex: 9999, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.5rem' }}>
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
      <div style={{ position: 'fixed', top: '2rem', right: '2rem', zIndex: 9999, pointerEvents: 'none', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.5rem' }}>
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

      {/* Background Glows */}
      <div style={{ position: 'fixed', top: '-10%', right: '-5%', width: '40vw', height: '40vw', background: 'radial-gradient(circle, rgba(226, 176, 76, 0.03), transparent)', pointerEvents: 'none' }} />
      <div style={{ position: 'fixed', bottom: '-5%', left: '20%', width: '30vw', height: '30vw', background: 'radial-gradient(circle, rgba(10, 132, 255, 0.02), transparent)', pointerEvents: 'none' }} />

      <Sidebar 
        activeTab={activeTab} 
        setActiveTab={setActiveTab} 
        isOpen={isSidebarOpen} 
        setIsOpen={setIsSidebarOpen} 
        onLogout={handleLogout}
      />
      
      {/* Mobile Top Header */}
      <div className="mobile-only glass" style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        height: '60px',
        padding: '0 1.5rem',
        alignItems: 'center',
        justifyContent: 'space-between',
        zIndex: 900,
        borderBottom: '1px solid var(--glass-border)'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <TrendingUp size={20} color="var(--accent-primary)" />
          <h1 className="title-gradient" style={{ fontSize: '1rem' }}>ALTA DENSIDAD</h1>
        </div>
        <button onClick={() => setIsSidebarOpen(true)} style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer' }}>
          <Menu size={24} />
        </button>
      </div>

      <div style={{ flex: 1, width: '100%' }}>
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
