import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Search, Trash2, User, CheckCircle2, Minus, Plus, AlertTriangle, X } from 'lucide-react';
import { NumericFormat } from 'react-number-format';
import { api } from '../services/api';
import { coincide, normalizar, formatoCantidad, nivelStock, NIVELES_STOCK, pesos, hoyBogota } from '../utils/inventario';

// Punto de venta en una sola pantalla: 1) buscar y agregar, 2) cliente (opcional), 3) cobrar.
// El servidor valida stock, costo, fecha y cliente; aquí se avisa antes para no llegar al error.

const FILTROS = {
  venta: { etiqueta: 'Perfumes, kits y esencias', tipos: ['terminado', 'esencia'] },
  insumos: { etiqueta: 'Insumos', tipos: ['envase', 'base', 'feromona', 'accesorio'] },
  todo: { etiqueta: 'Todo', tipos: null }
};

const r2 = (n) => Math.round(Number(n) * 100) / 100;

const Vender = ({ products = [], customers = [], notify, onDone, config }) => {
  const [busqueda, setBusqueda] = useState('');
  const [filtro, setFiltro] = useState('venta');
  const [carrito, setCarrito] = useState([]);
  const [cliente, setCliente] = useState({ id: null, nombre: '', cedula: '', telefono: '' });
  const [verClientes, setVerClientes] = useState(false);
  const [metodos, setMetodos] = useState([{ name: 'Efectivo', isCash: 1 }]);
  const [metodo, setMetodo] = useState('Efectivo');
  const [pagaCompleto, setPagaCompleto] = useState(true);
  const [abono, setAbono] = useState('');
  const [recibe, setRecibe] = useState('');
  const [fecha, setFecha] = useState(hoyBogota());
  const [otraFecha, setOtraFecha] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [ultima, setUltima] = useState(null);
  const buscador = useRef(null);
  const venta = useRef(null);

  useEffect(() => {
    // Los métodos de la tienda web (Mercado Pago) no se cobran en el mostrador
    api.get('/payment-methods').then((l) => Array.isArray(l) && l.length && setMetodos(l.filter((m) => !/\(web\)/i.test(m.name)))).catch(() => {});
    buscador.current?.focus();
  }, []);

  const resultados = useMemo(() => {
    const tipos = FILTROS[filtro].tipos;
    const q = normalizar(busqueda);
    const prioridad = (p) => (q && normalizar(p.name).startsWith(q) ? 0 : 2) + ((p.type || 'terminado') === 'terminado' ? 0 : 1);
    return products
      .filter((p) => !tipos || tipos.includes(p.type || 'terminado'))
      .filter((p) => !busqueda.trim() || coincide(`${p.name} ${p.category || ''} ${p.code || ''}`, busqueda))
      // Primero lo que hay, luego lo que empieza con lo buscado, luego perfumes y kits antes que esencias
      .sort((a, b) => (Number(b.stock) > 0) - (Number(a.stock) > 0) || prioridad(a) - prioridad(b) || a.name.localeCompare(b.name))
      .slice(0, 40);
  }, [products, busqueda, filtro]);

  const total = r2(carrito.reduce((s, l) => s + (Number(l.cantidad) || 0) * (Number(l.precio) || 0), 0));
  const metodoActual = metodos.find((m) => m.name === metodo);
  const pagaAhora = pagaCompleto ? total : Math.min(Number(abono) || 0, total);
  const cambio = pagaCompleto && Number(metodoActual?.isCash) === 1 && Number(recibe) > 0 ? Number(recibe) - total : null;
  const sinCliente = !cliente.id && !cliente.nombre.trim();

  // Problemas por línea, para avisar antes de cobrar
  const problema = (l) => {
    const cantidad = Number(l.cantidad) || 0;
    if (!(cantidad > 0)) return 'Escribe la cantidad';
    if (l.unidad === 'und' && !Number.isInteger(cantidad)) return 'Se vende por unidades enteras';
    if (cantidad > l.stock) return `Solo hay ${formatoCantidad(l.stock, l.unidad)}`;
    if (!(Number(l.precio) > 0)) return 'Escribe el precio';
    if (l.costo > 0 && Number(l.precio) < l.costo && !l.bajoCosto) return `Por debajo del costo (${pesos(l.costo)})`;
    return null;
  };
  const bloqueos = [
    !carrito.length && 'Agrega al menos un producto',
    carrito.some(problema) && 'Revisa las líneas marcadas',
    !pagaCompleto && sinCliente && 'A crédito necesita el nombre del cliente',
    cambio !== null && cambio < 0 && 'Lo recibido no alcanza'
  ].filter(Boolean);

  const agregar = (p) => {
    if (Number(p.stock) <= 0) return;
    setCarrito((c) => {
      const i = c.findIndex((l) => l.productId === p.id);
      const paso = p.unit === 'ml' ? 10 : 1;
      if (i >= 0) return c.map((l, j) => (j === i ? { ...l, cantidad: String(r2((Number(l.cantidad) || 0) + paso)) } : l));
      return [...c, { productId: p.id, nombre: p.name, unidad: p.unit || 'und', stock: Number(p.stock) || 0, costo: Number(p.costPrice) || 0,
        precio: Number(p.price) > 0 ? String(p.price) : '', cantidad: String(paso), bajoCosto: false }];
    });
    setBusqueda('');
    buscador.current?.focus();
  };

  const cambiar = (i, cambios) => setCarrito((c) => c.map((l, j) => (j === i ? { ...l, ...cambios } : l)));
  const sumar = (i, delta) => {
    const l = carrito[i];
    const paso = l.unidad === 'ml' ? 10 : 1;
    cambiar(i, { cantidad: String(Math.max(paso, r2((Number(l.cantidad) || 0) + delta * paso))) });
  };

  const sugerencias = useMemo(() => {
    const q = cliente.nombre.trim();
    if (cliente.id || q.length < 2) return [];
    return customers.filter((c) => coincide(`${c.nombre} ${c.cedula || ''} ${c.telefono || ''}`, q)).slice(0, 5);
  }, [customers, cliente]);

  const limpiar = () => {
    setCarrito([]);
    setCliente({ id: null, nombre: '', cedula: '', telefono: '' });
    setPagaCompleto(true);
    setAbono('');
    setRecibe('');
    setMetodo('Efectivo');
    setFecha(hoyBogota());
    setOtraFecha(false);
    buscador.current?.focus();
  };

  const cobrar = async () => {
    if (bloqueos.length || guardando) { if (bloqueos.length) notify?.(bloqueos[0], 'warning'); return; }
    setGuardando(true);
    try {
      const r = await api.post('/sales', {
        date: fecha, method: metodo, initialPayment: pagaAhora,
        customerId: cliente.id || undefined, customerName: cliente.nombre.trim() || undefined,
        idDocument: cliente.cedula || undefined, phone: cliente.telefono || undefined,
        items: carrito.map((l) => ({ productId: l.productId, quantity: Number(l.cantidad), unitPrice: Number(l.precio), allowBelowCost: l.bajoCosto }))
      });
      setUltima({ id: r.id, total, pagado: pagaAhora, cambio, metodo, cliente: cliente.nombre.trim() || 'Consumidor final' });
      notify?.(`Venta #${r.id} registrada`, 'success');
      limpiar();
      onDone?.();
    } catch (e) {
      notify?.(e.message, 'error');
    } finally {
      setGuardando(false);
    }
  };

  return (
    <div className="main-content">
      <header className="page-header">
        <div>
          <h2 className="title-gradient" style={{ fontSize: '2.5rem', marginBottom: '0.25rem' }}>Vender</h2>
          <p style={{ color: 'var(--text-secondary)' }}>Busca, agrega y cobra. Sin cliente queda como Consumidor final.</p>
        </div>
      </header>

      {ultima && (
        <div className="premium-card" style={{ marginBottom: '1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', borderColor: 'var(--success)' }}>
          <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
            <CheckCircle2 size={20} color="var(--success)" />
            <span>
              Venta #{ultima.id} · {ultima.cliente} · {pesos(ultima.total)} por {ultima.metodo}
              {ultima.pagado < ultima.total && ` · queda debiendo ${pesos(ultima.total - ultima.pagado)}`}
              {ultima.cambio > 0 && <b> · Cambio: {pesos(ultima.cambio)}</b>}
            </span>
          </div>
          <button className="btn-icon" onClick={() => setUltima(null)} aria-label="Cerrar aviso"><X size={14} /></button>
        </div>
      )}

      <div className="dia-grid">
        {/* 1. Productos */}
        <div className="premium-card" style={{ padding: 0 }}>
          <div style={{ padding: '1.25rem 1.25rem 0.75rem' }}>
            <span className="paso">1 · Agrega productos</span>
            <div style={{ position: 'relative' }}>
              <Search size={18} style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
              <input ref={buscador} className="buscador-grande" style={{ paddingLeft: 42 }} value={busqueda} placeholder="Nombre, categoría o código…"
                onChange={(e) => setBusqueda(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && resultados[0]) { e.preventDefault(); agregar(resultados[0]); } }} />
            </div>
            <div className="chips" style={{ marginTop: '0.75rem' }}>
              {Object.entries(FILTROS).map(([k, f]) => <button key={k} className={`chip${filtro === k ? ' active' : ''}`} onClick={() => setFiltro(k)}>{f.etiqueta}</button>)}
            </div>
          </div>
          <div style={{ maxHeight: 520, overflowY: 'auto', borderTop: '1px solid var(--glass-border)' }}>
            {resultados.length === 0 && <p style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>Nada coincide con «{busqueda}».</p>}
            {resultados.map((p) => {
              const n = nivelStock(p, config);
              return (
                <button key={p.id} className="fila-item" disabled={Number(p.stock) <= 0} onClick={() => agregar(p)}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 500 }}>{p.name}</div>
                    <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{p.category}{p.isKit ? ' · kit' : ''}{p.code ? ` · ${p.code}` : ''}</div>
                  </div>
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <div style={{ fontWeight: 500 }}>{Number(p.price) > 0 ? `${pesos(p.price)}${p.unit === 'ml' ? ' /ml' : ''}` : 'Sin precio'}</div>
                    <div style={{ fontSize: '0.72rem', color: NIVELES_STOCK[n].color }}>{n === 'agotado' ? 'Agotado' : `Hay ${formatoCantidad(p.stock, p.unit)}`}</div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* 2 y 3. Venta y cobro */}
        <div ref={venta} style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', scrollMarginTop: 72 }}>
          <div className="premium-card">
            <span className="paso">Venta</span>
            {carrito.length === 0 && <p style={{ color: 'var(--text-muted)', padding: '1rem 0' }}>Toca un producto de la lista (o Enter en el buscador) para agregarlo.</p>}
            {carrito.map((l, i) => {
              const aviso = problema(l);
              const bajo = l.costo > 0 && Number(l.precio) > 0 && Number(l.precio) < l.costo;
              return (
                <div key={l.productId} style={{ padding: '0.85rem 0', borderBottom: '1px solid var(--glass-border)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', alignItems: 'center' }}>
                    <span style={{ fontWeight: 500 }}>{l.nombre}</span>
                    <button className="btn-icon danger" onClick={() => setCarrito((c) => c.filter((_, j) => j !== i))} aria-label={`Quitar ${l.nombre}`}><Trash2 size={14} /></button>
                  </div>
                  <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap', marginTop: '0.5rem' }}>
                    <div className="stepper">
                      <button onClick={() => sumar(i, -1)} aria-label="Menos"><Minus size={14} /></button>
                      <NumericFormat value={l.cantidad} decimalSeparator="," thousandSeparator="." allowNegative={false} decimalScale={l.unidad === 'ml' ? 2 : 0}
                        onValueChange={(v) => cambiar(i, { cantidad: v.value })} aria-label="Cantidad" />
                      <button onClick={() => sumar(i, 1)} aria-label="Más"><Plus size={14} /></button>
                    </div>
                    <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>{l.unidad === 'ml' ? 'ml ×' : '×'}</span>
                    <NumericFormat value={l.precio} prefix="$" thousandSeparator="." decimalSeparator="," allowNegative={false}
                      onValueChange={(v) => cambiar(i, { precio: v.value, bajoCosto: false })} style={{ width: 130, height: 36 }} aria-label="Precio unitario" />
                    <span style={{ marginLeft: 'auto', fontWeight: 500, color: 'var(--accent-primary)' }}>{pesos((Number(l.cantidad) || 0) * (Number(l.precio) || 0))}</span>
                  </div>
                  {aviso && <div style={{ marginTop: '0.4rem', fontSize: '0.78rem', color: 'var(--error)', display: 'flex', gap: '0.4rem', alignItems: 'center' }}><AlertTriangle size={13} /> {aviso}</div>}
                  {bajo && (
                    <label style={{ marginTop: '0.4rem', fontSize: '0.78rem', display: 'flex', gap: '0.5rem', alignItems: 'center', color: 'var(--warning)' }}>
                      <input type="checkbox" checked={l.bajoCosto} onChange={(e) => cambiar(i, { bajoCosto: e.target.checked })} style={{ width: 'auto' }} />
                      Confirmo venderlo por debajo del costo
                    </label>
                  )}
                </div>
              );
            })}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginTop: '1rem' }}>
              <span style={{ color: 'var(--text-secondary)' }}>Total</span>
              <span style={{ fontSize: '2rem', fontWeight: 500, color: 'var(--accent-primary)' }}>{pesos(total)}</span>
            </div>
          </div>

          <div className="premium-card">
            <span className="paso">2 · Cliente (opcional)</span>
            {cliente.id ? (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem' }}>
                <span style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}><User size={16} /> {cliente.nombre}{cliente.cedula ? ` · ${cliente.cedula}` : ''}</span>
                <button className="btn-secondary" onClick={() => setCliente({ id: null, nombre: '', cedula: '', telefono: '' })} style={{ minHeight: 34 }}>Cambiar</button>
              </div>
            ) : (
              <div style={{ position: 'relative' }}>
                <input value={cliente.nombre} placeholder="Consumidor final — o escribe nombre, cédula o teléfono"
                  onChange={(e) => { setCliente((c) => ({ ...c, nombre: e.target.value })); setVerClientes(true); }}
                  onFocus={() => setVerClientes(true)} onBlur={() => setTimeout(() => setVerClientes(false), 150)} style={{ width: '100%' }} />
                {verClientes && sugerencias.length > 0 && (
                  <div className="premium-card" style={{ position: 'absolute', zIndex: 20, left: 0, right: 0, top: '100%', padding: 0 }}>
                    {sugerencias.map((c) => (
                      <button key={c.id} className="fila-item" onMouseDown={() => setCliente({ id: c.id, nombre: c.nombre, cedula: c.cedula || '', telefono: c.telefono || '' })}>
                        <span>{c.nombre}</span><span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{[c.cedula, c.telefono].filter(Boolean).join(' · ')}</span>
                      </button>
                    ))}
                  </div>
                )}
                {cliente.nombre.trim() && (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '0.75rem', marginTop: '0.75rem' }}>
                    <input value={cliente.cedula} placeholder="Cédula (opcional)" onChange={(e) => setCliente((c) => ({ ...c, cedula: e.target.value }))} />
                    <input value={cliente.telefono} placeholder="Teléfono (opcional)" onChange={(e) => setCliente((c) => ({ ...c, telefono: e.target.value }))} />
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="premium-card">
            <span className="paso">3 · Cobrar</span>
            <div className="chips">
              {metodos.map((m) => <button key={m.name} className={`chip${metodo === m.name ? ' active' : ''}`} onClick={() => setMetodo(m.name)}>{m.name}</button>)}
            </div>
            <div className="chips" style={{ marginTop: '1rem' }}>
              <button className={`chip${pagaCompleto ? ' active' : ''}`} onClick={() => setPagaCompleto(true)}>Paga completo</button>
              <button className={`chip${!pagaCompleto ? ' active' : ''}`} onClick={() => setPagaCompleto(false)}>Abona / fiado</button>
            </div>
            {!pagaCompleto && (
              <label style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', marginTop: '1rem' }}>
                Abona ahora
                <NumericFormat value={abono} prefix="$" thousandSeparator="." decimalSeparator="," allowNegative={false} onValueChange={(v) => setAbono(v.value)} placeholder="$0" />
                <span style={{ fontSize: '0.85rem', textTransform: 'none', letterSpacing: 0, color: sinCliente ? 'var(--error)' : 'var(--text-secondary)' }}>
                  {sinCliente ? 'Escribe el nombre del cliente: queda debiendo.' : `Queda debiendo ${pesos(total - pagaAhora)}`}
                </span>
              </label>
            )}
            {pagaCompleto && Number(metodoActual?.isCash) === 1 && (
              <label style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', marginTop: '1rem' }}>
                Recibe (para calcular el cambio)
                <NumericFormat value={recibe} prefix="$" thousandSeparator="." decimalSeparator="," allowNegative={false} onValueChange={(v) => setRecibe(v.value)} placeholder="Opcional" />
                {cambio !== null && <span style={{ fontWeight: 500, fontSize: '1.25rem', textTransform: 'none', letterSpacing: 0, color: cambio < 0 ? 'var(--error)' : 'var(--success)' }}>{cambio < 0 ? `Faltan ${pesos(-cambio)}` : `Cambio: ${pesos(cambio)}`}</span>}
              </label>
            )}
            <div style={{ marginTop: '1rem', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
              {otraFecha
                ? <label style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>Fecha <input type="date" value={fecha} max={hoyBogota()} onChange={(e) => setFecha(e.target.value)} style={{ width: 'auto' }} /></label>
                : <button onClick={() => setOtraFecha(true)} style={{ textDecoration: 'underline', color: 'var(--text-muted)' }}>Hoy · cambiar fecha</button>}
            </div>
            <button className="btn-primary" onClick={cobrar} disabled={guardando || bloqueos.length > 0} title={bloqueos[0] || ''}
              style={{ width: '100%', height: 58, fontSize: '1.05rem', marginTop: '1.25rem' }}>
              {guardando ? 'Registrando…' : pagaCompleto ? `Cobrar ${pesos(total)}` : `Registrar venta (${pesos(pagaAhora)} ahora)`}
            </button>
            {bloqueos.length > 0 && carrito.length > 0 && <p style={{ marginTop: '0.6rem', fontSize: '0.8rem', color: 'var(--text-muted)', textAlign: 'center' }}>{bloqueos[0]}</p>}
          </div>
        </div>
      </div>

      {/* En el celular la venta queda debajo de la lista: esta barra lleva a ella */}
      {carrito.length > 0 && <div className="mobile-only" style={{ height: 72 }} aria-hidden="true" />}
      {carrito.length > 0 && (
        <button className="mobile-only barra-venta" onClick={() => venta.current?.scrollIntoView({ behavior: 'smooth' })}>
          <span>{carrito.length} producto(s)</span>
          <b>{pesos(total)} · Ver venta</b>
        </button>
      )}
    </div>
  );
};

export default Vender;
