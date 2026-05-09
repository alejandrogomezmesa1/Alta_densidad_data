import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { Lock, User, LogIn, TrendingUp, AlertCircle, Key } from 'lucide-react';
import { api } from '../services/api';

const Login = ({ onLoginSuccess, notify }) => {
  const [isRegistering, setIsRegistering] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      if (isRegistering) {
        const response = await fetch(`${import.meta.env.VITE_API_URL || 'http://localhost:5000/api'}/auth/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Registration failed');
        notify('Usuario registrado con éxito. Ahora puedes iniciar sesión.', 'success');
        setIsRegistering(false);
      } else {
        await api.login(username, password);
        notify('Bienvenido de nuevo', 'success');
        onLoginSuccess();
      }
    } catch (err) {
      setError(err.message);
      notify(err.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ 
      minHeight: '100vh', 
      display: 'flex', 
      alignItems: 'center', 
      justifyContent: 'center', 
      background: 'var(--bg-main)',
      position: 'relative',
      overflow: 'hidden'
    }}>
      {/* Background Glows */}
      <div style={{ position: 'absolute', top: '20%', left: '10%', width: '40vw', height: '40vw', background: 'radial-gradient(circle, rgba(226, 176, 76, 0.05), transparent)', pointerEvents: 'none' }} />
      <div style={{ position: 'absolute', bottom: '10%', right: '10%', width: '30vw', height: '30vw', background: 'radial-gradient(circle, rgba(10, 132, 255, 0.03), transparent)', pointerEvents: 'none' }} />

      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="premium-card"
        style={{ width: '100%', maxWidth: '400px', padding: '2.5rem', zIndex: 1 }}
      >
        <div style={{ textAlign: 'center', marginBottom: '2.5rem' }}>
          <div style={{ 
            display: 'inline-flex', 
            padding: '1rem', 
            borderRadius: '20px', 
            background: 'rgba(226, 176, 76, 0.1)', 
            color: 'var(--accent-primary)',
            marginBottom: '1.5rem'
          }}>
            <TrendingUp size={32} />
          </div>
          <h1 className="title-gradient" style={{ fontSize: '1.8rem', marginBottom: '0.5rem' }}>ALTA DENSIDAD</h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
            {isRegistering ? 'Crea una cuenta para gestionar tu data' : 'Ingresa tus credenciales para continuar'}
          </p>
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          <div style={{ position: 'relative' }}>
            <div style={{ position: 'absolute', left: '1rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }}>
              <User size={18} />
            </div>
            <input
              type="text"
              placeholder="Usuario"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              className="glass"
              style={{ width: '100%', padding: '0.85rem 1rem 0.85rem 3rem', borderRadius: '12px', border: '1px solid var(--glass-border)' }}
            />
          </div>

          <div style={{ position: 'relative' }}>
            <div style={{ position: 'absolute', left: '1rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }}>
              <Lock size={18} />
            </div>
            <input
              type="password"
              placeholder="Contraseña"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="glass"
              style={{ width: '100%', padding: '0.85rem 1rem 0.85rem 3rem', borderRadius: '12px', border: '1px solid var(--glass-border)' }}
            />
          </div>

          {error && (
            <motion.div 
              initial={{ opacity: 0, x: -10 }} 
              animate={{ opacity: 1, x: 0 }}
              style={{ color: 'var(--error)', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '0.5rem', background: 'rgba(255,69,58,0.05)', padding: '0.75rem', borderRadius: '8px' }}
            >
              <AlertCircle size={14} />
              {error}
            </motion.div>
          )}

          <button 
            type="submit" 
            disabled={loading}
            className="btn-primary"
            style={{ width: '100%', padding: '1rem', height: '54px', fontSize: '1rem', fontWeight: 700, marginTop: '1rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.75rem' }}
          >
            {loading ? (
              <div className="spinner-small" />
            ) : (
              <>
                {isRegistering ? <Key size={20} /> : <LogIn size={20} />}
                {isRegistering ? 'REGISTRAR' : 'ENTRAR'}
              </>
            )}
          </button>
        </form>

        <div style={{ marginTop: '2rem', textAlign: 'center' }}>
          <button 
            onClick={() => setIsRegistering(!isRegistering)}
            style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: '0.85rem', cursor: 'pointer', textDecoration: 'underline' }}
          >
            {isRegistering ? '¿Ya tienes cuenta? Inicia sesión' : '¿No tienes cuenta? Regístrate'}
          </button>
        </div>
      </motion.div>
    </div>
  );
};

export default Login;
