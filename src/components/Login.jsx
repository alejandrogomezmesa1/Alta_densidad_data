import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { Lock, User, LogIn, AlertCircle } from 'lucide-react';
import { api } from '../services/api';

const Login = ({ onLoginSuccess, notify }) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      await api.login(username, password);
      notify('Bienvenido de nuevo', 'success');
      onLoginSuccess();
    } catch (err) {
      const mensajes = {
        'Failed to fetch': 'No se pudo conectar con el servidor. Intenta de nuevo en unos segundos.',
        'Invalid username or password': 'Usuario o contraseña incorrectos.'
      };
      setError(mensajes[err.message] || err.message || 'No se pudo iniciar sesión.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      minHeight: '100vh',
      display: 'grid',
      placeItems: 'center',
      background: 'var(--bg-main)',
      padding: '1.5rem'
    }}>
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.2, 0.7, 0.2, 1] }}
        style={{ width: '100%', maxWidth: '400px', background: 'var(--bg-card)', border: '1px solid var(--border-color)', padding: '3rem 2.5rem 2.25rem' }}
      >
        <div style={{ textAlign: 'center', marginBottom: '2.5rem' }}>
          <span className="side-brand-mark" style={{ width: 52, height: 52, fontSize: 20, margin: '0 auto 1.5rem' }}>AD</span>
          <p className="up" style={{ fontSize: '10px', color: 'var(--accent-primary)', marginBottom: '0.75rem' }}>Sistema de gestión</p>
          <h1 style={{ fontFamily: 'var(--f-display)', fontWeight: 300, fontSize: '2.4rem', letterSpacing: '0.04em' }}>Alta Densidad</h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '13px', marginTop: '0.75rem' }}>
            Ingresa tus credenciales para continuar
          </p>
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            Usuario
            <div style={{ position: 'relative' }}>
              <User size={15} style={{ position: 'absolute', left: '0.9rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
              <input
                type="text"
                autoComplete="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                style={{ width: '100%', paddingLeft: '2.6rem', textTransform: 'none', letterSpacing: 0 }}
              />
            </div>
          </label>

          <label style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            Contraseña
            <div style={{ position: 'relative' }}>
              <Lock size={15} style={{ position: 'absolute', left: '0.9rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
              <input
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                style={{ width: '100%', paddingLeft: '2.6rem', textTransform: 'none', letterSpacing: 0 }}
              />
            </div>
          </label>

          {error && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              role="alert"
              style={{ color: 'var(--error)', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '0.5rem', borderLeft: '2px solid var(--error)', background: 'var(--error-glow)', padding: '0.7rem 0.9rem' }}
            >
              <AlertCircle size={14} />
              {error}
            </motion.div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="btn-primary"
            style={{ width: '100%', height: '48px', marginTop: '0.75rem' }}
          >
            {loading ? <div className="spinner-small" /> : <><LogIn size={16} /> Entrar</>}
          </button>
        </form>

        <p className="up" style={{ marginTop: '2.25rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '9px' }}>
          Acceso privado · Alta Densidad
        </p>
      </motion.div>
    </div>
  );
};

export default Login;
