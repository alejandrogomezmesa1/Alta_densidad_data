import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Search, RotateCcw } from 'lucide-react';
import { api } from '../services/api';
import { MovimientosModal } from './StockModals';
import { coincide, formatoCantidad, nivelStock, NIVELES_STOCK, pesos, TIPOS_INVENTARIO } from '../utils/inventario';

// Consultar existencias: solo lectura y liviana (/api/stock, sin ventas ni clientes).
// Para kits dice cuántos alcanzan y qué componente los limita; para esencias, cuántos decants salen.

const Consultar = ({ notify, config }) => {
  const [items, setItems] = useState(null);
  const [busqueda, setBusqueda] = useState('');
  const [tipo, setTipo] = useState('all');
  const [nivel, setNivel] = useState('all');
  const [historial, setHistorial] = useState(null);
  const buscador = useRef(null);

  // Si el servidor aún no tiene /api/stock, se usa la lista completa de productos
  const cargar = useCallback(() => api.get('/stock').catch(() => api.get('/products')).then(setItems).catch((e) => notify?.(e.message, 'error')), [notify]);
  useEffect(() => { cargar(); buscador.current?.focus(); }, [cargar]);

  const lista = useMemo(() => (items || [])
    .filter((p) => tipo === 'all' || (tipo === 'kit' ? p.isKit : (p.type || 'terminado') === tipo && !p.isKit))
    .filter((p) => nivel === 'all' || nivelStock(p, config) === nivel)
    .filter((p) => !busqueda.trim() || coincide(`${p.name} ${p.category || ''} ${p.code || ''}`, busqueda)), [items, busqueda, tipo, nivel, config]);

  const conteo = useMemo(() => {
    const c = { agotado: 0, advertencia: 0, disponible: 0 };
    (items || []).forEach((p) => { c[nivelStock(p, config)] += 1; });
    return c;
  }, [items, config]);

  return (
    <div className="main-content">
      <header className="page-header">
        <div>
          <h2 className="title-gradient" style={{ fontSize: '2.5rem', marginBottom: '0.25rem' }}>Consultar existencias</h2>
          <p style={{ color: 'var(--text-secondary)' }}>
            {items ? `${items.length} ítems · ${conteo.agotado} agotados · ${conteo.advertencia} por acabarse` : 'Cargando…'}
          </p>
        </div>
        <button className="btn-secondary" onClick={cargar} style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}><RotateCcw size={15} /> Actualizar</button>
      </header>

      <div className="premium-card" style={{ padding: 0 }}>
        <div style={{ padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <div style={{ position: 'relative' }}>
            <Search size={18} style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
            <input ref={buscador} className="buscador-grande" style={{ paddingLeft: 42 }} value={busqueda} onChange={(e) => setBusqueda(e.target.value)} placeholder="¿Qué buscas? Nombre, categoría o código" />
          </div>
          <div className="chips">
            {[['all', 'Todo'], ['kit', 'Kits'], ...Object.entries(TIPOS_INVENTARIO)].map(([k, v]) => <button key={k} className={`chip${tipo === k ? ' active' : ''}`} onClick={() => setTipo(k)}>{v}</button>)}
          </div>
          <div className="chips">
            {[['all', 'Cualquier nivel'], ...Object.entries(NIVELES_STOCK).map(([k, v]) => [k, v.etiqueta])].map(([k, v]) => (
              <button key={k} className={`chip${nivel === k ? ' active' : ''}`} onClick={() => setNivel(k)} style={k !== 'all' ? { borderLeft: `3px solid ${NIVELES_STOCK[k].color}` } : undefined}>{v}</button>
            ))}
          </div>
        </div>
        <div style={{ borderTop: '1px solid var(--glass-border)' }}>
          {items && lista.length === 0 && <p style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>Nada coincide.</p>}
          {lista.slice(0, 300).map((p) => {
            const n = nivelStock(p, config);
            return (
              <button key={p.id} className="fila-item" onClick={() => !p.isKit && setHistorial(p)} title={p.isKit ? '' : 'Ver movimientos'} style={{ borderLeft: `3px solid ${NIVELES_STOCK[n].color}` }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 500 }}>{p.name}</div>
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                    {p.isKit ? 'Kit' : TIPOS_INVENTARIO[p.type] || p.type} · {p.category}{p.code ? ` · ${p.code}` : ''}{Number(p.price) > 0 ? ` · ${pesos(p.price)}${p.unit === 'ml' ? '/ml' : ''}` : ''}
                  </div>
                </div>
                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                  <div style={{ fontSize: '1.15rem', fontWeight: 500, color: NIVELES_STOCK[n].color }}>{formatoCantidad(p.stock, p.unit)}{p.unit === 'und' ? ' und' : ''}</div>
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                    {p.isKit ? `alcanzan · limita ${p.limitedBy || '—'}` : p.decants !== undefined ? `≈ ${p.decants} decants de 10 ml` : NIVELES_STOCK[n].etiqueta}
                  </div>
                </div>
              </button>
            );
          })}
          {lista.length > 300 && <p style={{ padding: '1rem', textAlign: 'center', color: 'var(--text-muted)' }}>Mostrando 300 de {lista.length}: afina la búsqueda.</p>}
        </div>
      </div>

      {historial && <MovimientosModal producto={historial} onClose={() => setHistorial(null)} />}
    </div>
  );
};

export default Consultar;
