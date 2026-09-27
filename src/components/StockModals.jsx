import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { X, History, SlidersHorizontal } from 'lucide-react';
import { api } from '../services/api';
import { formatoCantidad } from '../utils/inventario';

const TIPOS_MOVIMIENTO = {
  inicial: 'Saldo inicial',
  compra: 'Compra',
  anulacion_compra: 'Compra anulada',
  venta: 'Venta',
  anulacion_venta: 'Venta devuelta',
  ajuste: 'Ajuste',
  consumo_produccion: 'Consumo en producción',
  salida_produccion: 'Salida de producción'
};

const MOTIVOS = ['Conteo físico', 'Rotura', 'Vencimiento', 'Corrección de registro', 'Muestra o regalo', 'Otro'];

const Fondo = ({ children, onClose, ancho = 520 }) => (
  <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 10000, padding: '1.5rem' }} onClick={onClose}>
    <motion.div initial={{ y: 12, opacity: 0 }} animate={{ y: 0, opacity: 1 }} className="premium-card"
      style={{ width: '100%', maxWidth: ancho, maxHeight: '85vh', overflowY: 'auto', padding: '2rem' }}
      onClick={e => e.stopPropagation()} role="dialog" aria-modal="true">
      {children}
    </motion.div>
  </div>
);

const Encabezado = ({ icono: Icono, titulo, sub, onClose }) => (
  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem', marginBottom: '1.5rem' }}>
    <div>
      <span className="up" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '10px', color: 'var(--accent-primary)' }}>
        <Icono size={14} /> {titulo}
      </span>
      <h3 style={{ fontSize: '1.6rem', fontWeight: 300, marginTop: '0.4rem' }}>{sub}</h3>
    </div>
    <button className="btn-icon" onClick={onClose} aria-label="Cerrar"><X size={16} /></button>
  </div>
);

// Ajuste de stock con motivo obligatorio (regla I-05)
export const AjusteStockModal = ({ producto, onClose, onGuardado, notify }) => {
  const [nuevoStock, setNuevoStock] = useState(String(producto.stock));
  const [motivo, setMotivo] = useState(MOTIVOS[0]);
  const [detalle, setDetalle] = useState('');
  const [guardando, setGuardando] = useState(false);
  const diferencia = (Number(nuevoStock) || 0) - Number(producto.stock);

  const guardar = async (e) => {
    e.preventDefault();
    if (!diferencia) { notify?.('El stock nuevo es igual al actual.', 'info'); return; }
    if (motivo === 'Otro' && detalle.trim().length < 3) { notify?.('Describe el motivo del ajuste.', 'warning'); return; }
    setGuardando(true);
    try {
      await api.post(`/products/${producto.id}/adjustments`, {
        newStock: Number(nuevoStock),
        reason: [motivo, detalle.trim()].filter(Boolean).join(': ')
      });
      notify?.(`Stock de ${producto.name} ajustado`, 'success');
      onGuardado?.();
      onClose();
    } catch (err) {
      notify?.(err.message, 'error');
    } finally {
      setGuardando(false);
    }
  };

  return (
    <Fondo onClose={onClose}>
      <Encabezado icono={SlidersHorizontal} titulo="Ajustar stock" sub={producto.name} onClose={onClose} />
      <form onSubmit={guardar} style={{ display: 'flex', flexDirection: 'column', gap: '1.1rem' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            Stock actual
            <input value={formatoCantidad(producto.stock, producto.unit)} readOnly style={{ opacity: 0.7 }} />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }} htmlFor="ajuste-nuevo">
            Stock contado
            <input id="ajuste-nuevo" type="number" step={producto.unit === 'ml' ? '0.1' : '1'} min="0" required
              value={nuevoStock} onChange={e => setNuevoStock(e.target.value)} />
          </label>
        </div>
        <p style={{ fontSize: '13px', color: diferencia < 0 ? 'var(--error)' : diferencia > 0 ? 'var(--success)' : 'var(--text-muted)' }}>
          {diferencia ? `Diferencia: ${diferencia > 0 ? '+' : ''}${formatoCantidad(diferencia, producto.unit)}` : 'Sin cambios'}
        </p>
        <label style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }} htmlFor="ajuste-motivo">
          Motivo
          <select id="ajuste-motivo" value={motivo} onChange={e => setMotivo(e.target.value)}>
            {MOTIVOS.map(m => <option key={m}>{m}</option>)}
          </select>
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }} htmlFor="ajuste-detalle">
          Detalle {motivo === 'Otro' ? '(obligatorio)' : '(opcional)'}
          <input id="ajuste-detalle" value={detalle} onChange={e => setDetalle(e.target.value)} placeholder="Ej. conteo del 27-09, frasco roto en bodega" style={{ textTransform: 'none', letterSpacing: 0 }} />
        </label>
        <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end', marginTop: '0.5rem' }}>
          <button type="button" className="btn-secondary" onClick={onClose}>Cancelar</button>
          <button type="submit" className="btn-primary" disabled={guardando}>{guardando ? 'Guardando…' : 'Registrar ajuste'}</button>
        </div>
      </form>
    </Fondo>
  );
};

// Kárdex: historial de movimientos de un ítem
export const MovimientosModal = ({ producto, onClose }) => {
  const [movimientos, setMovimientos] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get(`/products/${producto.id}/movements`).then(setMovimientos).catch(e => setError(e.message));
  }, [producto.id]);

  return (
    <Fondo onClose={onClose} ancho={820}>
      <Encabezado icono={History} titulo="Historial de movimientos" sub={producto.name} onClose={onClose} />
      {error && <p style={{ color: 'var(--error)' }}>{error}</p>}
      {!movimientos && !error && <p style={{ color: 'var(--text-muted)' }}>Cargando…</p>}
      {movimientos && movimientos.length === 0 && (
        <p style={{ color: 'var(--text-muted)' }}>Aún no hay movimientos registrados para este ítem.</p>
      )}
      {movimientos && movimientos.length > 0 && (
        <div className="table-responsive-wrapper">
          <table style={{ width: '100%', fontVariantNumeric: 'tabular-nums' }}>
            <thead>
              <tr>{['Fecha', 'Movimiento', 'Cantidad', 'Saldo', 'Detalle', 'Usuario'].map(h => <th key={h} style={{ padding: '0.7rem 0.8rem' }}>{h}</th>)}</tr>
            </thead>
            <tbody>
              {movimientos.map(m => (
                <tr key={m.id}>
                  <td style={{ padding: '0.7rem 0.8rem', whiteSpace: 'nowrap', color: 'var(--text-muted)' }}><span className="mobile-label">Fecha</span>{String(m.createdAt).slice(0, 16)}</td>
                  <td style={{ padding: '0.7rem 0.8rem' }}><span className="mobile-label">Movimiento</span>{TIPOS_MOVIMIENTO[m.type] || m.type}</td>
                  <td style={{ padding: '0.7rem 0.8rem', color: m.quantity < 0 ? 'var(--error)' : 'var(--success)' }}>
                    <span className="mobile-label">Cantidad</span>{m.quantity > 0 ? '+' : ''}{formatoCantidad(m.quantity, producto.unit)}
                  </td>
                  <td style={{ padding: '0.7rem 0.8rem' }}><span className="mobile-label">Saldo</span>{formatoCantidad(m.balance, producto.unit)}</td>
                  <td style={{ padding: '0.7rem 0.8rem', color: 'var(--text-secondary)', fontSize: '12px' }}>
                    <span className="mobile-label">Detalle</span>{m.reason || (m.sourceType ? `${m.sourceType} #${m.sourceId}` : '—')}
                  </td>
                  <td style={{ padding: '0.7rem 0.8rem', color: 'var(--text-muted)', fontSize: '12px' }}><span className="mobile-label">Usuario</span>{m.user || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Fondo>
  );
};
