// Módulo Configuraciones: todo lo ajustable del sistema. Las definiciones llegan del servidor
// (backend/configuraciones.js), así que cada configuración nueva aparece aquí sola, en su grupo.
import React, { useEffect, useMemo, useState } from 'react';
import { Save, SlidersHorizontal } from 'lucide-react';
import { api } from '../services/api';
import { NIVELES_STOCK } from '../utils/inventario';

const Semaforo = ({ und, ml }) => (
  <div className="cfg-semaforo" aria-label="Así se verá el stock">
    {[
      ['agotado', 'Agotado: 0'],
      ['advertencia', `Advertencia: 1 a ${und} und · hasta ${ml} ml`],
      ['disponible', `Disponible: más de ${und} und · más de ${ml} ml`]
    ].map(([nivel, texto]) => (
      <span key={nivel} className="cfg-nivel">
        <i style={{ background: NIVELES_STOCK[nivel].color }} />
        <b style={{ color: NIVELES_STOCK[nivel].color }}>{NIVELES_STOCK[nivel].etiqueta}</b>
        <small>{texto.split(': ')[1]}</small>
      </span>
    ))}
  </div>
);

const Configuraciones = ({ notify, onGuardado }) => {
  const [definiciones, setDefiniciones] = useState([]);
  const [valores, setValores] = useState({});
  const [guardados, setGuardados] = useState({});
  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    api.get('/settings')
      .then((r) => { setDefiniciones(r.definiciones); setValores(r.valores); setGuardados(r.valores); })
      .catch((err) => notify?.(`No se pudieron cargar las configuraciones: ${err.message}`, 'error'))
      .finally(() => setCargando(false));
  }, [notify]);

  const grupos = useMemo(() => definiciones.reduce((m, d) => m.set(d.grupo, [...(m.get(d.grupo) || []), d]), new Map()), [definiciones]);
  const cambiados = Object.keys(valores).filter((k) => String(valores[k]) !== String(guardados[k]));

  async function guardar(e) {
    e.preventDefault();
    if (!cambiados.length) return;
    setGuardando(true);
    try {
      const r = await api.put('/settings', { valores: Object.fromEntries(cambiados.map((k) => [k, valores[k]])) });
      setValores(r.valores);
      setGuardados(r.valores);
      onGuardado?.(r.valores);
      notify?.('Configuraciones guardadas.', 'success');
    } catch (err) {
      notify?.(err.message, 'error');
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="main-content">
      <header className="page-header">
        <div>
          <h2 className="title-gradient" style={{ fontSize: '2.5rem', marginBottom: '0.25rem' }}>Configuraciones</h2>
          <p style={{ color: 'var(--text-secondary)', fontWeight: 500 }}>Ajustes del sistema. También se pueden cambiar desde el panel de la tienda web.</p>
        </div>
        <button type="submit" form="form-config" className="btn-primary" disabled={!cambiados.length || guardando} style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
          <Save size={18} /> {guardando ? 'Guardando…' : cambiados.length ? `Guardar (${cambiados.length})` : 'Sin cambios'}
        </button>
      </header>

      {cargando ? <p className="kit-vacio">Cargando…</p> : (
        <form id="form-config" onSubmit={guardar} className="cfg-grupos">
          {[...grupos].map(([grupo, defs]) => (
            <section key={grupo} className="premium-card cfg-grupo">
              <h4><SlidersHorizontal size={16} /> {grupo}</h4>
              {grupo.startsWith('Inventario · semáforo') && (
                <Semaforo und={valores.stock_advertencia_und} ml={valores.stock_advertencia_ml} />
              )}
              {defs.map((d) => (
                <div key={d.clave} className="cfg-campo">
                  <div className="cfg-texto">
                    <label htmlFor={`cfg-${d.clave}`}>{d.etiqueta}</label>
                    <p>{d.ayuda}</p>
                  </div>
                  <div className="cfg-control">
                    {d.tipo === 'booleano' ? (
                      <input id={`cfg-${d.clave}`} type="checkbox" checked={!!valores[d.clave]} onChange={(e) => setValores({ ...valores, [d.clave]: e.target.checked })} />
                    ) : (
                      <input id={`cfg-${d.clave}`} type="number" min={d.min} max={d.max} step={d.paso || 1} value={valores[d.clave] ?? ''}
                        onChange={(e) => setValores({ ...valores, [d.clave]: e.target.value })} style={{ width: 120, textAlign: 'right' }} />
                    )}
                    {d.unidad && <span>{d.unidad}</span>}
                  </div>
                </div>
              ))}
            </section>
          ))}
        </form>
      )}
    </div>
  );
};

export default Configuraciones;
