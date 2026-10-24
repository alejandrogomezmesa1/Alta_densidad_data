import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Search, Trash2, PackagePlus, ClipboardCheck, Plus, AlertTriangle } from 'lucide-react';
import { NumericFormat } from 'react-number-format';
import { api } from '../services/api';
import Ventana from './Ventana';
import { coincide, formatoCantidad, pesos, hoyBogota, TIPOS_INVENTARIO } from '../utils/inventario';

// Recibir mercancía: una factura del proveedor con varias líneas (entra todo o nada) y, aparte,
// el conteo físico: se escribe lo contado y cada diferencia queda como ajuste con su motivo.

const r2 = (n) => Math.round(Number(n) * 100) / 100;
const NUEVO = { name: '', category: '', type: 'terminado', price: '', essenceClass: '' };

const Recepcion = ({ products, suppliers, notify, confirm, onDone }) => {
  const [busqueda, setBusqueda] = useState('');
  const [lineas, setLineas] = useState([]);
  const [cabecera, setCabecera] = useState({ supplierId: '', invoice: '', date: hoyBogota(), method: 'Efectivo' });
  const [metodos, setMetodos] = useState([{ name: 'Efectivo' }]);
  const [recientes, setRecientes] = useState([]);
  const [nuevo, setNuevo] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const buscador = useRef(null);

  const cargar = useCallback(() => api.get('/receptions').then((r) => Array.isArray(r) && setRecientes(r)).catch(() => {}), []);
  useEffect(() => {
    api.get('/payment-methods').then((l) => Array.isArray(l) && l.length && setMetodos(l)).catch(() => {});
    cargar();
  }, [cargar]);

  const resultados = useMemo(() => (busqueda.trim().length < 2 ? [] : products
    .filter((p) => !p.isKit && coincide(`${p.name} ${p.category || ''} ${p.code || ''}`, busqueda)).slice(0, 12)), [products, busqueda]);

  // Cantidad y costo en la unidad en que se compra (kg, caja…) si el ítem la tiene; se convierte al guardar
  const agregar = (p) => {
    const factor = Number(p.purchaseFactor) > 0 ? Number(p.purchaseFactor) : 1;
    const enCompra = Boolean(p.purchaseUnit) && factor !== 1;
    setLineas((l) => (l.some((x) => x.productId === p.id) ? l : [...l, {
      productId: p.id, nombre: p.name, unidad: p.unit || 'und', factor, unidadCompra: p.purchaseUnit || null, enCompra,
      cantidad: '', costo: Number(p.costPrice) > 0 ? String(r2(Number(p.costPrice) * (enCompra ? factor : 1))) : '', costoActual: Number(p.costPrice) || 0
    }]));
    setBusqueda('');
    buscador.current?.focus();
  };
  const cambiar = (i, c) => setLineas((l) => l.map((x, j) => (j === i ? { ...x, ...c } : x)));

  const convertida = (l) => {
    const f = l.enCompra ? l.factor : 1;
    return { cantidad: r2((Number(l.cantidad) || 0) * f), costo: (Number(l.costo) || 0) / f };
  };
  const total = r2(lineas.reduce((s, l) => s + (Number(l.cantidad) || 0) * (Number(l.costo) || 0), 0));
  const problema = (l) => {
    const c = convertida(l);
    if (!(c.cantidad > 0)) return 'Escribe la cantidad';
    if (l.unidad === 'und' && !Number.isInteger(c.cantidad)) return 'Se cuenta por unidades enteras';
    if (!(c.costo > 0)) return 'Escribe el costo';
    return null;
  };

  const registrar = async () => {
    if (!lineas.length) { notify?.('Agrega al menos un producto.', 'warning'); return; }
    const malo = lineas.map(problema).find(Boolean);
    if (malo) { notify?.(`Revisa las líneas: ${malo.toLowerCase()}.`, 'warning'); return; }
    setGuardando(true);
    try {
      const r = await api.post('/receptions', {
        ...cabecera, supplierId: cabecera.supplierId || null,
        lines: lineas.map((l) => { const c = convertida(l); return { productId: l.productId, quantity: c.cantidad, unitPrice: c.costo }; })
      });
      notify?.(`Ingreso registrado: ${r.lines} producto(s) por ${pesos(r.total)}`, 'success');
      setLineas([]);
      setCabecera((c) => ({ ...c, invoice: '' }));
      cargar();
      onDone?.();
    } catch (e) {
      notify?.(e.message, 'error');
    } finally {
      setGuardando(false);
    }
  };

  const crear = async (e) => {
    e.preventDefault();
    if (!nuevo.name.trim() || !nuevo.category.trim()) { notify?.('Nombre y categoría son obligatorios.', 'warning'); return; }
    if (nuevo.type === 'terminado' && !(Number(nuevo.price) > 0)) { notify?.('Un producto para vender necesita precio de venta.', 'warning'); return; }
    if (nuevo.type === 'esencia' && !nuevo.essenceClass) { notify?.('Elige si la esencia es árabe o tradicional.', 'warning'); return; }
    try {
      const r = await api.post('/products', { ...nuevo, price: Number(nuevo.price) || 0, costPrice: 0, stock: 0 });
      notify?.(`«${nuevo.name}» creado: escribe cuánto llegó y su costo.`, 'success');
      agregar({ id: r.id, name: nuevo.name, unit: ['esencia', 'base', 'feromona'].includes(nuevo.type) ? 'ml' : 'und', costPrice: 0 });
      setNuevo(null);
      onDone?.();
    } catch (err) {
      notify?.(err.message, 'error');
    }
  };

  const anular = (id) => confirm?.('¿Anular este ingreso? Sale del inventario lo que entró y el dinero vuelve a la caja abierta.', async () => {
    try {
      await api.delete(`/receptions/${id}`);
      notify?.('Recepción anulada: el inventario y la caja se ajustaron.', 'info');
      cargar();
      onDone?.();
    } catch (e) { notify?.(e.message, 'error'); }
  });

  return (
    <>
      <div className="dia-grid">
        <div className="premium-card">
          <span className="paso">1 · Factura del proveedor</span>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: '1rem' }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>Proveedor
              <select value={cabecera.supplierId} onChange={(e) => setCabecera((c) => ({ ...c, supplierId: e.target.value }))}>
                <option value="">Sin proveedor</option>
                {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>N.º de factura
              <input value={cabecera.invoice} onChange={(e) => setCabecera((c) => ({ ...c, invoice: e.target.value }))} placeholder="Opcional" />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>Fecha
              <input type="date" value={cabecera.date} max={hoyBogota()} onChange={(e) => setCabecera((c) => ({ ...c, date: e.target.value }))} />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>¿Con qué se pagó?
              <select value={cabecera.method} onChange={(e) => setCabecera((c) => ({ ...c, method: e.target.value }))}>
                {metodos.map((m) => <option key={m.name} value={m.name}>{m.name}</option>)}
              </select>
            </label>
          </div>

          <span className="paso" style={{ marginTop: '1.75rem' }}>2 · Qué llegó</span>
          <div style={{ position: 'relative' }}>
            <Search size={18} style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
            <input ref={buscador} className="buscador-grande" style={{ paddingLeft: 42 }} value={busqueda} placeholder="Busca el producto…"
              onChange={(e) => setBusqueda(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && resultados[0]) { e.preventDefault(); agregar(resultados[0]); } }} />
          </div>
          {resultados.length > 0 && (
            <div style={{ border: '1px solid var(--glass-border)', marginTop: '0.5rem', maxHeight: 260, overflowY: 'auto' }}>
              {resultados.map((p) => (
                <button key={p.id} className="fila-item" onClick={() => agregar(p)}>
                  <span>{p.name} <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>· {p.category}</span></span>
                  <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>Hay {formatoCantidad(p.stock, p.unit)}</span>
                </button>
              ))}
            </div>
          )}
          <button onClick={() => setNuevo({ ...NUEVO, name: busqueda })} style={{ marginTop: '0.75rem', display: 'flex', gap: '0.4rem', alignItems: 'center', color: 'var(--accent-primary)', fontSize: '0.85rem' }}>
            <Plus size={14} /> ¿No existe? Crear producto nuevo
          </button>
        </div>

        <div className="premium-card">
          <span className="paso">3 · Revisar y registrar</span>
          {lineas.length === 0 && <p style={{ color: 'var(--text-muted)', padding: '1rem 0' }}>Busca cada producto de la factura y escribe cuánto llegó y a qué costo.</p>}
          {lineas.map((l, i) => {
            const c = convertida(l);
            const aviso = problema(l);
            return (
              <div key={l.productId} style={{ padding: '0.85rem 0', borderBottom: '1px solid var(--glass-border)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem' }}>
                  <span style={{ fontWeight: 500 }}>{l.nombre}</span>
                  <button className="btn-icon danger" onClick={() => setLineas((x) => x.filter((_, j) => j !== i))} aria-label={`Quitar ${l.nombre}`}><Trash2 size={14} /></button>
                </div>
                <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center', flexWrap: 'wrap', marginTop: '0.5rem' }}>
                  <NumericFormat value={l.cantidad} decimalSeparator="," thousandSeparator="." allowNegative={false} placeholder="Cantidad"
                    onValueChange={(v) => cambiar(i, { cantidad: v.value })} style={{ width: 110, height: 36 }} aria-label="Cantidad" />
                  {l.unidadCompra && l.factor !== 1 ? (
                    <select value={l.enCompra ? 'compra' : 'inv'} style={{ width: 'auto', height: 36 }} aria-label="Unidad"
                      onChange={(e) => {
                        const enCompra = e.target.value === 'compra';
                        cambiar(i, { enCompra, costo: l.costo ? String(r2(Number(l.costo) * (enCompra ? l.factor : 1 / l.factor))) : '' });
                      }}>
                      <option value="compra">{l.unidadCompra}</option>
                      <option value="inv">{l.unidad}</option>
                    </select>
                  ) : <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>{l.unidad}</span>}
                  <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>a</span>
                  <NumericFormat value={l.costo} prefix="$" thousandSeparator="." decimalSeparator="," allowNegative={false} placeholder="Costo c/u"
                    onValueChange={(v) => cambiar(i, { costo: v.value })} style={{ width: 130, height: 36 }} aria-label="Costo unitario" />
                  <span style={{ marginLeft: 'auto', fontWeight: 500 }}>{pesos((Number(l.cantidad) || 0) * (Number(l.costo) || 0))}</span>
                </div>
                {l.enCompra && c.cantidad > 0 && <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.35rem' }}>Entran {formatoCantidad(c.cantidad, l.unidad)} a {pesos(c.costo)} por {l.unidad}</div>}
                {!aviso && l.costoActual > 0 && c.costo > l.costoActual * 1.25 && (
                  <div style={{ fontSize: '0.75rem', color: 'var(--warning)', marginTop: '0.35rem', display: 'flex', gap: '0.35rem', alignItems: 'center' }}>
                    <AlertTriangle size={12} /> Más caro que el costo actual ({pesos(l.costoActual)}): revisa el precio de venta
                  </div>
                )}
                {aviso && <div style={{ fontSize: '0.75rem', color: 'var(--error)', marginTop: '0.35rem' }}>{aviso}</div>}
              </div>
            );
          })}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginTop: '1rem' }}>
            <span style={{ color: 'var(--text-secondary)' }}>Total de la factura</span>
            <span style={{ fontSize: '1.8rem', fontWeight: 500, color: 'var(--accent-primary)' }}>{pesos(total)}</span>
          </div>
          <button className="btn-primary" onClick={registrar} disabled={guardando || !lineas.length} style={{ width: '100%', height: 56, marginTop: '1rem' }}>
            {guardando ? 'Registrando…' : `Registrar ingreso (${cabecera.method})`}
          </button>
        </div>
      </div>

      <div className="premium-card" style={{ marginTop: '1.5rem' }}>
        <span className="paso">Últimos ingresos</span>
        {recientes.length === 0 && <p style={{ color: 'var(--text-muted)' }}>Todavía no hay ingresos registrados por aquí.</p>}
        {recientes.slice(0, 15).map((r) => (
          <div key={r.id} style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', alignItems: 'center', padding: '0.7rem 0', borderTop: '1px solid var(--glass-border)', opacity: r.voided ? 0.5 : 1 }}>
            <div>
              <div style={{ fontWeight: 500 }}>{r.supplierName || 'Sin proveedor'}{r.invoice ? ` · factura ${r.invoice}` : ''}</div>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{String(r.date).slice(0, 16)} · {r.lineCount} producto(s) · {r.method}{r.user ? ` · ${r.user}` : ''}</div>
            </div>
            <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
              <span style={{ fontWeight: 500 }}>{r.voided ? 'Anulada' : pesos(r.total)}</span>
              {!r.voided && <button className="btn-secondary" style={{ minHeight: 32 }} onClick={() => anular(r.id)}>Anular</button>}
            </div>
          </div>
        ))}
      </div>

      <Ventana abierta={!!nuevo} onCerrar={() => setNuevo(null)} eyebrow="Recibir mercancía" titulo="Producto nuevo" ancho={520}>
        {nuevo && (
          <form onSubmit={crear} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>Nombre<input value={nuevo.name} onChange={(e) => setNuevo({ ...nuevo, name: e.target.value })} /></label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>Categoría<input value={nuevo.category} onChange={(e) => setNuevo({ ...nuevo, category: e.target.value })} placeholder="Ej. Árabes, Envases…" /></label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>Tipo
              <select value={nuevo.type} onChange={(e) => setNuevo({ ...nuevo, type: e.target.value })}>
                {Object.entries(TIPOS_INVENTARIO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </label>
            {nuevo.type === 'esencia' && (
              <label style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>Clase de esencia
                <select value={nuevo.essenceClass} onChange={(e) => setNuevo({ ...nuevo, essenceClass: e.target.value })}>
                  <option value="">Elige…</option><option value="arabe">Árabe</option><option value="tradicional">Tradicional</option>
                </select>
              </label>
            )}
            <label style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>Precio de venta{nuevo.type === 'terminado' ? '' : ' (opcional)'}
              <NumericFormat value={nuevo.price} prefix="$" thousandSeparator="." decimalSeparator="," allowNegative={false} onValueChange={(v) => setNuevo({ ...nuevo, price: v.value })} />
            </label>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>El stock y el costo los pone este ingreso. El resto de la ficha se completa luego en Inventario.</p>
            <button type="submit" className="btn-primary">Crear y agregar al ingreso</button>
          </form>
        )}
      </Ventana>
    </>
  );
};

const Conteo = ({ products, notify, onDone }) => {
  const [busqueda, setBusqueda] = useState('');
  const [tipo, setTipo] = useState('all');
  const [contados, setContados] = useState({});
  const [motivo, setMotivo] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [resultado, setResultado] = useState(null);

  const lista = useMemo(() => products
    .filter((p) => !p.isKit && (tipo === 'all' || (p.type || 'terminado') === tipo))
    .filter((p) => !busqueda.trim() || coincide(`${p.name} ${p.category || ''} ${p.code || ''}`, busqueda)), [products, busqueda, tipo]);
  const porId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const escritos = Object.entries(contados).filter(([, v]) => v !== '' && v !== undefined);
  const conDiferencia = escritos.filter(([id, v]) => Math.abs(Number(v) - Number(porId.get(Number(id))?.stock || 0)) > 0.001);

  const guardar = async () => {
    if (!escritos.length) { notify?.('Escribe lo contado en al menos un producto.', 'warning'); return; }
    setGuardando(true);
    try {
      const r = await api.post('/inventory/count', { reason: motivo, lines: escritos.map(([id, v]) => ({ productId: Number(id), counted: Number(v) })) });
      setResultado(r);
      notify?.(`Conteo guardado: ${r.adjusted} ajuste(s), ${r.unchanged} sin diferencia.`, 'success');
      setContados({});
      onDone?.();
    } catch (e) {
      notify?.(e.message, 'error');
    } finally {
      setGuardando(false);
    }
  };

  return (
    <div className="premium-card" style={{ padding: 0 }}>
      <div style={{ padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
        <p style={{ color: 'var(--text-secondary)' }}>Escribe lo que contaste. Solo se guardan los productos que llenes, y cada diferencia queda como ajuste «Conteo físico».</p>
        <input className="buscador-grande" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} placeholder="Filtra por nombre, categoría o código…" />
        <div className="chips">
          {[['all', 'Todo'], ...Object.entries(TIPOS_INVENTARIO)].map(([k, v]) => <button key={k} className={`chip${tipo === k ? ' active' : ''}`} onClick={() => setTipo(k)}>{v}</button>)}
        </div>
      </div>
      <div style={{ maxHeight: 520, overflowY: 'auto', borderTop: '1px solid var(--glass-border)' }}>
        {lista.map((p) => {
          const v = contados[p.id] ?? '';
          const dif = v === '' ? null : r2(Number(v) - Number(p.stock));
          return (
            <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', padding: '0.6rem 1.25rem', borderBottom: '1px solid var(--glass-border)' }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 500 }}>{p.name}</div>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{p.category} · sistema: {formatoCantidad(p.stock, p.unit)}</div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexShrink: 0 }}>
                {dif !== null && <span style={{ fontSize: '0.8rem', color: dif === 0 ? 'var(--success)' : dif < 0 ? 'var(--error)' : 'var(--warning)' }}>{dif === 0 ? 'Cuadra' : `${dif > 0 ? '+' : ''}${formatoCantidad(dif, p.unit)}`}</span>}
                <NumericFormat value={v} decimalSeparator="," thousandSeparator="." allowNegative={false} decimalScale={p.unit === 'ml' ? 2 : 0} placeholder="Contado"
                  onValueChange={(x) => setContados((c) => ({ ...c, [p.id]: x.value }))} style={{ width: 110, height: 36 }} aria-label={`Contado de ${p.name}`} />
              </div>
            </div>
          );
        })}
      </div>
      <div style={{ padding: '1.25rem', display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
        <input value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Nota del conteo (opcional), ej. bodega" style={{ flex: 1, minWidth: 200 }} />
        <button className="btn-primary" onClick={guardar} disabled={guardando || !escritos.length}>
          {guardando ? 'Guardando…' : `Guardar conteo (${escritos.length} contados, ${conDiferencia.length} con diferencia)`}
        </button>
      </div>
      {resultado?.adjustments?.length > 0 && (
        <div style={{ padding: '0 1.25rem 1.25rem', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
          {resultado.adjustments.map((a) => <div key={a.productId}>{a.name}: {a.before} → {a.counted}</div>)}
        </div>
      )}
    </div>
  );
};

const Recibir = ({ products = [], suppliers = [], notify, confirm, onDone }) => {
  const [vista, setVista] = useState('recepcion');
  // Servidor sin la migración 017: la pantalla avisa en vez de fallar al guardar
  const [disponible, setDisponible] = useState(true);
  useEffect(() => { api.get('/receptions').then(() => setDisponible(true)).catch(() => setDisponible(false)); }, []);
  return (
    <div className="main-content">
      <header className="page-header">
        <div>
          <h2 className="title-gradient" style={{ fontSize: '2.5rem', marginBottom: '0.25rem' }}>Recibir mercancía</h2>
          <p style={{ color: 'var(--text-secondary)' }}>Lo que llega del proveedor y el conteo físico del inventario.</p>
        </div>
        <div className="chips">
          <button className={`chip${vista === 'recepcion' ? ' active' : ''}`} onClick={() => setVista('recepcion')} style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}><PackagePlus size={14} /> Ingreso de factura</button>
          <button className={`chip${vista === 'conteo' ? ' active' : ''}`} onClick={() => setVista('conteo')} style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}><ClipboardCheck size={14} /> Conteo físico</button>
        </div>
      </header>
      {!disponible && (
        <div className="premium-card" style={{ marginBottom: '1.5rem', display: 'flex', gap: '0.75rem', alignItems: 'center', borderColor: 'var(--warning)' }}>
          <AlertTriangle size={18} color="var(--warning)" />
          <span>El servidor todavía no tiene esta función. Mientras se actualiza, registra las compras en <b>Registros → Compras</b> y los conteos con <b>Ajustar stock</b> en Inventario.</span>
        </div>
      )}
      {!disponible ? null : vista === 'recepcion'
        ? <Recepcion products={products} suppliers={suppliers} notify={notify} confirm={confirm} onDone={onDone} />
        : <Conteo products={products} notify={notify} onDone={onDone} />}
    </div>
  );
};

export default Recibir;
