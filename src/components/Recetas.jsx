// Recetas y empaque: qué lleva cada tamaño de perfume preparado (la esencia y el envase que elige el
// cliente + alcohol, fijador, feromonas, colorante…) y qué empaque lleva cada pedido. Con los costos
// del inventario calcula en vivo el costo real de cada tamaño, para esencia árabe y tradicional.
import { useEffect, useMemo, useState } from 'react';
import { Plus, Save, Trash2, FlaskConical, Package } from 'lucide-react';
import { api } from '../services/api';

const pesos = (v) => `$${Math.round(Number(v) || 0).toLocaleString('es-CO')}`;
const cifra = (v) => Number(v || 0).toLocaleString('es-CO', { maximumFractionDigits: 3 });
const CLASES = [['arabe', 'Árabe'], ['tradicional', 'Tradicional']];
const TIPOS_INSUMO = ['base', 'feromona', 'accesorio', 'envase'];

const estiloCelda = { padding: '0.55rem 0.75rem', borderBottom: '1px solid var(--glass-border)', fontSize: '0.85rem' };

function Lineas({ lineas, insumos, envasesTam, costoEsencia, onCambiar, onQuitar, onAgregar, conRoles }) {
  return (
    <div className="table-responsive-wrapper">
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ textAlign: 'left', color: 'var(--text-muted)', fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
            <th style={estiloCelda}>Insumo</th><th style={estiloCelda}>Cantidad</th><th style={estiloCelda}>Costo unitario</th><th style={estiloCelda}>Subtotal</th><th style={estiloCelda} />
          </tr>
        </thead>
        <tbody>
          {lineas.map((l) => {
            const item = insumos.find((i) => i.id === Number(l.itemId));
            let unitario; let unidad; let nota = null;
            if (l.role === 'esencia') { unidad = 'ml'; unitario = null; nota = CLASES.map(([c, t]) => `${t} ${pesos(costoEsencia[c])}/ml`).join(' · '); }
            else if (l.role === 'envase') {
              unidad = 'und';
              const costos = envasesTam.map((e) => e.unitCost);
              unitario = costos.length ? Math.max(...costos) : 0;
              nota = costos.length ? `${envasesTam.length} diseño(s): ${pesos(Math.min(...costos))} a ${pesos(Math.max(...costos))}` : 'No hay envases de este tamaño en el inventario';
            } else { unidad = item ? item.unit : ''; unitario = item ? item.costPrice : 0; }
            const subtotal = l.role === 'esencia' ? null : Number(l.quantity) * (unitario || 0);
            return (
              <tr key={l.key}>
                <td style={estiloCelda}>
                  {l.role === 'esencia' && <b>Esencia elegida por el cliente</b>}
                  {l.role === 'envase' && <b>Envase elegido por el cliente</b>}
                  {l.role === 'insumo' && (
                    <select value={l.itemId || ''} onChange={(e) => onCambiar(l.key, { itemId: e.target.value })} style={{ width: '100%', minWidth: 200 }}>
                      <option value="">Elegir insumo…</option>
                      {insumos.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
                    </select>
                  )}
                  {nota && <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 2 }}>{nota}</div>}
                </td>
                <td style={estiloCelda}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <input type="number" min="0" step="0.1" value={l.quantity} onChange={(e) => onCambiar(l.key, { quantity: e.target.value })} style={{ width: 90 }} aria-label="Cantidad" />
                    <small style={{ color: 'var(--text-muted)' }}>{unidad}</small>
                  </span>
                </td>
                <td style={estiloCelda}>{l.role === 'esencia' ? 'Según clase' : `${pesos(unitario)}${unidad ? ` / ${unidad}` : ''}`}</td>
                <td style={estiloCelda}>{subtotal == null ? '—' : pesos(subtotal)}</td>
                <td style={{ ...estiloCelda, textAlign: 'right' }}>
                  {l.role === 'insumo' && <button type="button" className="btn-icon danger" onClick={() => onQuitar(l.key)} title="Quitar" aria-label="Quitar línea"><Trash2 size={14} /></button>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem', flexWrap: 'wrap' }}>
        <button type="button" className="btn-secondary" onClick={() => onAgregar('insumo')}><Plus size={14} /> Agregar insumo</button>
        {conRoles && !lineas.some((l) => l.role === 'esencia') && <button type="button" className="btn-secondary" onClick={() => onAgregar('esencia')}><Plus size={14} /> Esencia elegida</button>}
        {conRoles && !lineas.some((l) => l.role === 'envase') && <button type="button" className="btn-secondary" onClick={() => onAgregar('envase')}><Plus size={14} /> Envase elegido</button>}
      </div>
    </div>
  );
}

const Recetas = ({ notify, confirm, inventory }) => {
  const [datos, setDatos] = useState(null);
  const [lineas, setLineas] = useState([]);
  const [guardadas, setGuardadas] = useState('[]');
  const [guardando, setGuardando] = useState(false);
  const [nuevoMl, setNuevoMl] = useState('');

  const cargar = () => api.get('/recipes')
    .then((r) => {
      setDatos(r);
      const ls = r.lines.map((l, i) => ({ key: `l${i}`, scope: l.scope, ml: l.ml, role: l.role, itemId: l.itemId, quantity: String(l.quantity) }));
      setLineas(ls);
      setGuardadas(JSON.stringify(ls.map(({ key, ...x }) => x)));
    })
    .catch((err) => notify?.(`No se pudieron cargar las recetas: ${err.message}`, 'error'));
  useEffect(() => { cargar(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const insumos = useMemo(() => (Array.isArray(inventory) ? inventory : [])
    .filter((p) => TIPOS_INSUMO.includes(p.type))
    .sort((a, b) => a.name.localeCompare(b.name, 'es')), [inventory]);
  const tamanos = useMemo(() => [...new Set(lineas.filter((l) => l.scope === 'tamano').map((l) => Number(l.ml)))].sort((a, b) => a - b), [lineas]);
  const sucio = JSON.stringify(lineas.map(({ key, ...x }) => x)) !== guardadas;
  const costoEsencia = datos ? datos.essenceCost : {};
  const envasesDe = (ml) => (datos ? datos.containers.filter((e) => e.ml === ml) : []);

  const cambiar = (key, cambio) => setLineas((ls) => ls.map((l) => (l.key === key ? { ...l, ...cambio } : l)));
  const quitar = (key) => setLineas((ls) => ls.filter((l) => l.key !== key));
  const agregar = (scope, ml, role) => setLineas((ls) => [...ls, { key: `n${Date.now()}${Math.random()}`, scope, ml, role, itemId: '', quantity: role === 'envase' ? '1' : '0' }]);
  const agregarTamano = () => {
    const ml = parseInt(nuevoMl, 10);
    if (!(ml > 0) || tamanos.includes(ml)) { notify?.('Escribe un tamaño en ml que no exista todavía.', 'warning'); return; }
    setLineas((ls) => [...ls, { key: `n${Date.now()}e`, scope: 'tamano', ml, role: 'esencia', itemId: null, quantity: '0' }, { key: `n${Date.now()}v`, scope: 'tamano', ml, role: 'envase', itemId: null, quantity: '1' }]);
    setNuevoMl('');
  };
  const quitarTamano = (ml) => confirm?.(`¿Quitar la receta de ${ml} ml?`, () => setLineas((ls) => ls.filter((l) => !(l.scope === 'tamano' && Number(l.ml) === ml))));

  // Costo de un grupo de líneas (la esencia según la clase; el envase al costo más alto de su tamaño)
  const costo = (ls, ml, clase) => ls.reduce((s, l) => {
    const q = Number(l.quantity) || 0;
    if (l.role === 'esencia') return s + q * (costoEsencia[clase] || 0);
    if (l.role === 'envase') { const c = envasesDe(ml).map((e) => e.unitCost); return s + q * (c.length ? Math.max(...c) : 0); }
    const item = insumos.find((i) => i.id === Number(l.itemId));
    return s + q * (item ? item.costPrice : 0);
  }, 0);
  const lineasPedido = lineas.filter((l) => l.scope === 'pedido');
  const costoPedido = costo(lineasPedido);

  async function guardar() {
    const incompletas = lineas.filter((l) => l.role === 'insumo' && !l.itemId);
    if (incompletas.length) { notify?.('Hay líneas sin insumo elegido: elige uno o quítalas.', 'warning'); return; }
    setGuardando(true);
    try {
      await api.put('/recipes', { lines: lineas.map(({ key, ...l }) => ({ ...l, quantity: Number(l.quantity) || 0 })) });
      notify?.('Recetas guardadas.', 'success');
      await cargar();
    } catch (err) {
      notify?.(err.message, 'error');
    } finally {
      setGuardando(false);
    }
  }

  if (!datos) return <div className="main-content"><p style={{ color: 'var(--text-muted)' }}>Cargando recetas…</p></div>;

  return (
    <div className="main-content">
      <header className="page-header">
        <div>
          <h2 className="title-gradient" style={{ fontSize: '2.5rem', marginBottom: '0.25rem' }}>Recetas y empaque</h2>
          <p style={{ color: 'var(--text-secondary)', fontWeight: 500 }}>Qué lleva cada perfume preparado y cada pedido. Los costos salen del inventario.</p>
        </div>
        <button type="button" className="btn-primary" onClick={guardar} disabled={!sucio || guardando} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <Save size={16} /> {guardando ? 'Guardando…' : sucio ? 'Guardar cambios' : 'Guardado'}
        </button>
      </header>

      {tamanos.map((ml) => {
        const ls = lineas.filter((l) => l.scope === 'tamano' && Number(l.ml) === ml);
        return (
          <section key={ml} className="premium-card" style={{ marginBottom: '1.25rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
              <h3 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', margin: 0 }}><FlaskConical size={18} /> Perfume preparado de {ml} ml</h3>
              <div style={{ display: 'flex', gap: '1.25rem', alignItems: 'center', flexWrap: 'wrap' }}>
                {CLASES.map(([c, t]) => (
                  <span key={c} style={{ fontSize: '0.85rem' }}>Costo con esencia {t.toLowerCase()}: <b style={{ color: 'var(--accent-primary)' }}>{pesos(costo(ls, ml, c))}</b></span>
                ))}
                <button type="button" className="btn-icon danger" onClick={() => quitarTamano(ml)} title="Quitar tamaño" aria-label={`Quitar ${ml} ml`}><Trash2 size={14} /></button>
              </div>
            </div>
            <Lineas lineas={ls} insumos={insumos} envasesTam={envasesDe(ml)} costoEsencia={costoEsencia} conRoles
              onCambiar={cambiar} onQuitar={quitar} onAgregar={(role) => agregar('tamano', ml, role)} />
            {(() => {
              const liquido = ls.filter((l) => l.role === 'esencia' || (l.role === 'insumo' && insumos.find((i) => i.id === Number(l.itemId))?.unit === 'ml')).reduce((s, l) => s + (Number(l.quantity) || 0), 0);
              return liquido > 0 && Math.abs(liquido - ml) > 0.5
                ? <p style={{ fontSize: '0.8rem', color: 'var(--warning, #c9a227)', marginTop: '0.5rem' }}>Los líquidos suman {cifra(liquido)} ml y el frasco es de {ml} ml.</p>
                : null;
            })()}
          </section>
        );
      })}

      <section className="premium-card" style={{ marginBottom: '1.25rem', display: 'flex', gap: '0.75rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <div>
          <label htmlFor="rec-nuevo" style={{ display: 'block', marginBottom: '0.4rem', fontSize: '0.8rem' }}>Agregar tamaño (ml)</label>
          <input id="rec-nuevo" type="number" min="1" value={nuevoMl} onChange={(e) => setNuevoMl(e.target.value)} placeholder="Ej: 8" style={{ width: 120 }} />
        </div>
        <button type="button" className="btn-secondary" onClick={agregarTamano}><Plus size={14} /> Agregar tamaño</button>
      </section>

      <section className="premium-card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
          <h3 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', margin: 0 }}><Package size={18} /> Empaque por pedido</h3>
          <span style={{ fontSize: '0.85rem' }}>Costo por pedido: <b style={{ color: 'var(--accent-primary)' }}>{pesos(costoPedido)}</b></span>
        </div>
        <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: 0 }}>Bolsa de envío, sticker, papel… lo que va una sola vez por pedido, sin importar cuántos perfumes lleve.</p>
        <Lineas lineas={lineasPedido} insumos={insumos} envasesTam={[]} costoEsencia={costoEsencia}
          onCambiar={cambiar} onQuitar={quitar} onAgregar={() => agregar('pedido', null, 'insumo')} />
      </section>
    </div>
  );
};

export default Recetas;
