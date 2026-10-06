// Dashboard: el valor del inventario (cuánto dinero hay en mercancía, a costo y a precio de venta,
// dónde está, qué no rota y qué datos faltan para que la cifra sea real) y un resumen corto de
// ventas. Lo que ya tiene su propia sección (Caja, Cartera, Gastos, semáforo del Inventario) no se
// repite aquí.
import React, { useMemo, useState } from 'react';
import {
  Wallet, Tag, TrendingUp, Package, AlertTriangle, Moon, FlaskConical, Star, X, ChevronRight, DollarSign, Receipt
} from 'lucide-react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar, PieChart, Pie, Cell, Legend
} from 'recharts';
import { TIPOS_INVENTARIO, formatoCantidad } from '../utils/inventario';

const pesos = (v) => `$${Math.round(Number(v) || 0).toLocaleString('es-CO')}`;
const corto = (v) => {
  const n = Math.abs(Number(v) || 0);
  if (n >= 1e6) return `$${(v / 1e6).toLocaleString('es-CO', { maximumFractionDigits: 1 })} M`;
  if (n >= 1e3) return `$${Math.round(v / 1e3).toLocaleString('es-CO')} mil`;
  return pesos(v);
};
const COSTO = '#9A7B3F';
const VENTA = '#C9A961';
const PALETA = ['#C9A961', '#3d7fc4', '#8B3A48', '#2f9e6e', '#F2EEE6', '#6B675F', '#9A7B3F'];
const DIAS_SIN_ROTAR = 60;

const fecha = (s) => new Date(String(s || '').split(/T| /)[0] + 'T00:00:00');
const costoVenta = (s) => (s.items && s.items.length
  ? s.items.reduce((t, i) => t + (Number(i.costAtSale) || 0) * (Number(i.quantity) || 1), 0)
  : (Number(s.costAtSale) || 0) * (Number(s.quantity) || 1));

const Tarjeta = ({ titulo, valor, detalle, icono: Icono, color = 'var(--accent-primary)', onClick }) => (
  <div className={`premium-card ${onClick ? 'hover-glow' : ''}`} onClick={onClick} style={{ cursor: onClick ? 'pointer' : 'default', minWidth: 0 }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
      <p className="up" style={{ color: 'var(--text-muted)', fontSize: '10px', margin: 0 }}>{titulo}</p>
      <Icono size={18} strokeWidth={1.6} color={color} />
    </div>
    <h3 style={{ fontSize: '1.9rem', fontWeight: 400, fontFamily: 'var(--f-display)', margin: 0 }}>{valor}</h3>
    {detalle && <p style={{ color: 'var(--text-muted)', fontSize: '0.78rem', margin: '0.4rem 0 0', display: 'flex', justifyContent: 'space-between', gap: 8 }}>
      <span>{detalle}</span>{onClick && <ChevronRight size={14} />}
    </p>}
  </div>
);

const Panel = ({ titulo, icono: Icono, accion, children, alto }) => (
  <section className="premium-card" style={{ minWidth: 0 }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', marginBottom: '1.25rem' }}>
      <h4 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '0.6rem', fontSize: '0.8rem', letterSpacing: '0.12em', textTransform: 'uppercase' }}>
        {Icono && <Icono size={17} color="var(--accent-primary)" />} {titulo}
      </h4>
      {accion}
    </div>
    {alto ? <div style={{ height: alto }}>{children}</div> : children}
  </section>
);

const tooltip = {
  contentStyle: { background: 'var(--bg-card, #16161a)', border: '1px solid var(--glass-border)', borderRadius: 0, fontSize: 12 },
  formatter: (v, n) => [pesos(v), n]
};

// Lista en ventana (detalle de las tarjetas)
const Lista = ({ datos, onCerrar }) => !datos ? null : (
  <div onClick={(e) => e.target === e.currentTarget && onCerrar()} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', display: 'grid', placeItems: 'center', zIndex: 10000, padding: '1.5rem' }}>
    <div className="premium-card" style={{ width: 'min(640px, 100%)', maxHeight: '82vh', overflowY: 'auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
        <h3 style={{ color: 'var(--accent-primary)', fontSize: '1.2rem', margin: 0 }}>{datos.titulo}</h3>
        <button type="button" onClick={onCerrar} aria-label="Cerrar" style={{ background: 'none', border: 0, color: 'var(--text-muted)', cursor: 'pointer' }}><X size={22} /></button>
      </div>
      {datos.nota && <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginTop: 0 }}>{datos.nota}</p>}
      {datos.filas.length === 0 ? <p style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '2rem' }}>Nada por aquí.</p> : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
          <tbody>
            {datos.filas.map((f, i) => (
              <tr key={i} style={{ borderBottom: '1px solid var(--glass-border)' }}>
                <td style={{ padding: '0.55rem 0.25rem' }}>{f.nombre}<div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{f.sub}</div></td>
                <td style={{ padding: '0.55rem 0.25rem', textAlign: 'right', whiteSpace: 'nowrap' }}>{f.valor}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  </div>
);

const Dashboard = ({ sales, inventory, expenses, setActiveTab }) => {
  const [periodo, setPeriodo] = useState('month');
  const [lista, setLista] = useState(null);
  const ventas = Array.isArray(sales) ? sales : [];
  const gastos = Array.isArray(expenses) ? expenses : [];
  const items = Array.isArray(inventory) ? inventory : [];

  // ── Inventario ──
  const inv = useMemo(() => {
    // Los kits compuestos no se cuentan: su valor ya está en sus componentes
    const base = items.filter((p) => !p.isKit);
    const conStock = base.filter((p) => Number(p.stock) > 0);
    const valor = (p) => Number(p.stock) * (Number(p.costPrice) || 0);
    const venta = (p) => (p.type === 'terminado' ? Number(p.stock) * (Number(p.price) || 0) : 0);
    const costoTotal = conStock.reduce((s, p) => s + valor(p), 0);
    const terminados = conStock.filter((p) => p.type === 'terminado');
    const costoTerminados = terminados.reduce((s, p) => s + valor(p), 0);
    const ventaTotal = terminados.reduce((s, p) => s + venta(p), 0);

    const porTipo = Object.entries(TIPOS_INVENTARIO).map(([t, nombre]) => {
      const g = conStock.filter((p) => (p.type || 'terminado') === t);
      return { nombre, costo: g.reduce((s, p) => s + valor(p), 0), venta: g.reduce((s, p) => s + venta(p), 0), n: g.length };
    }).filter((g) => g.n > 0);

    const cats = new Map();
    conStock.forEach((p) => {
      const c = (p.category || 'Sin categoría').trim();
      const g = cats.get(c) || { nombre: c, costo: 0, venta: 0, n: 0 };
      g.costo += valor(p); g.venta += venta(p); g.n += 1;
      cats.set(c, g);
    });
    const porCategoria = [...cats.values()].sort((a, b) => b.costo - a.costo).slice(0, 8);

    const esencias = conStock.filter((p) => p.type === 'esencia');
    const porClase = [['arabe', 'Árabe'], ['tradicional', 'Tradicional'], [null, 'Sin clasificar']].map(([c, nombre]) => {
      const g = esencias.filter((p) => (p.essenceClass || null) === c);
      return { nombre, value: g.reduce((s, p) => s + valor(p), 0), ml: g.reduce((s, p) => s + Number(p.stock), 0) };
    }).filter((g) => g.ml > 0);

    const top = [...conStock].sort((a, b) => valor(b) - valor(a)).slice(0, 10)
      .map((p) => ({ nombre: p.name.length > 26 ? p.name.slice(0, 25) + '…' : p.name, completo: p.name, costo: valor(p) }));

    // Capital dormido: con existencias y sin ventas en los últimos 60 días
    const desde = new Date(); desde.setDate(desde.getDate() - DIAS_SIN_ROTAR);
    const vendidos = new Set();
    ventas.filter((s) => fecha(s.date) >= desde).forEach((s) => (s.items || []).forEach((i) => i.productId && vendidos.add(String(i.productId))));
    const dormidos = terminados.filter((p) => !vendidos.has(String(p.id))).sort((a, b) => valor(b) - valor(a));

    // Datos que impiden que la cifra sea real
    const sinCosto = conStock.filter((p) => !(Number(p.costPrice) > 0));
    const sinPrecio = terminados.filter((p) => !(Number(p.price) > 0));
    const conPerdida = terminados.filter((p) => Number(p.price) > 0 && Number(p.costPrice) > 0 && Number(p.price) <= Number(p.costPrice));

    return {
      costoTotal, ventaTotal, costoTerminados, utilidad: ventaTotal - costoTerminados,
      margen: ventaTotal > 0 ? ((ventaTotal - costoTerminados) / ventaTotal) * 100 : 0,
      unidades: terminados.reduce((s, p) => s + Number(p.stock), 0),
      ml: esencias.reduce((s, p) => s + Number(p.stock), 0),
      referencias: conStock.length, porTipo, porCategoria, porClase, top,
      dormidos, valorDormido: dormidos.reduce((s, p) => s + valor(p), 0),
      sinCosto, sinPrecio, conPerdida, valor
    };
  }, [items, ventas]);

  // ── Ventas del periodo ──
  const vt = useMemo(() => {
    const ahora = new Date();
    const hoy = `${ahora.getFullYear()}-${String(ahora.getMonth() + 1).padStart(2, '0')}-${String(ahora.getDate()).padStart(2, '0')}`;
    const dentro = (d) => {
      if (periodo === 'all') return true;
      if (periodo === 'today') return String(d || '').startsWith(hoy);
      const limite = new Date(); limite.setDate(limite.getDate() - (periodo === 'week' ? 7 : 30));
      return fecha(d) >= limite;
    };
    const lista = ventas.filter((s) => dentro(s.date));
    const total = lista.reduce((t, s) => t + (Number(s.total) || 0), 0);
    const utilidadBruta = lista.reduce((t, s) => t + (Number(s.total) || 0) - costoVenta(s), 0);
    const gastoPeriodo = gastos.filter((g) => dentro(g.date)).reduce((t, g) => t + (Number(g.amount) || 0), 0);

    const serie = [];
    if (periodo === 'all') {
      for (let i = 11; i >= 0; i--) {
        const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - i);
        const clave = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        const g = lista.filter((s) => String(s.date || '').startsWith(clave));
        serie.push({ nombre: d.toLocaleDateString('es-CO', { month: 'short', year: '2-digit' }), Ventas: g.reduce((t, s) => t + (Number(s.total) || 0), 0), Utilidad: g.reduce((t, s) => t + (Number(s.total) || 0) - costoVenta(s), 0) });
      }
    } else {
      const dias = periodo === 'week' ? 7 : periodo === 'month' ? 30 : 1;
      for (let i = dias - 1; i >= 0; i--) {
        const d = new Date(); d.setDate(d.getDate() - i);
        const clave = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        const g = lista.filter((s) => String(s.date || '').startsWith(clave));
        serie.push({ nombre: d.toLocaleDateString('es-CO', { day: 'numeric', month: 'short' }), Ventas: g.reduce((t, s) => t + (Number(s.total) || 0), 0), Utilidad: g.reduce((t, s) => t + (Number(s.total) || 0) - costoVenta(s), 0) });
      }
    }

    const mapa = new Map();
    lista.forEach((s) => (s.items || []).forEach((i) => {
      const clave = i.productId || i.productName;
      const g = mapa.get(clave) || { nombre: items.find((p) => String(p.id) === String(i.productId))?.name || i.productName || 'Producto', unidades: 0, ingreso: 0 };
      g.unidades += Number(i.quantity) || 0; g.ingreso += (Number(i.unitPrice) || 0) * (Number(i.quantity) || 0);
      mapa.set(clave, g);
    }));
    const estrellas = [...mapa.values()].sort((a, b) => b.ingreso - a.ingreso).slice(0, 5);

    return { total, n: lista.length, utilidadBruta, utilidadNeta: utilidadBruta - gastoPeriodo, gastoPeriodo, ticket: lista.length ? total / lista.length : 0, serie, estrellas };
  }, [ventas, gastos, items, periodo]);

  const abrir = (titulo, productos, nota, valorDe = (p) => pesos(inv.valor(p))) => setLista({
    titulo, nota,
    filas: productos.map((p) => ({ nombre: p.name, sub: `${TIPOS_INVENTARIO[p.type] || ''} · ${formatoCantidad(p.stock, p.unit)} · costo ${pesos(p.costPrice)} · venta ${pesos(p.price)}`, valor: valorDe(p) }))
  });
  const alertas = inv.sinCosto.length + inv.sinPrecio.length + inv.conPerdida.length;
  const nombrePeriodo = { today: 'hoy', week: 'últimos 7 días', month: 'últimos 30 días', all: 'últimos 12 meses' }[periodo];

  return (
    <div className="main-content">
      <header className="page-header">
        <div>
          <h2 className="title-gradient" style={{ fontSize: '2.6rem', marginBottom: '0.25rem' }}>Valor del negocio</h2>
          <p style={{ color: 'var(--text-secondary)', fontWeight: 500 }}>Cuánto dinero hay en el inventario, dónde está y cómo se está moviendo.</p>
        </div>
      </header>

      {/* ── Inventario ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1.25rem', marginBottom: '1.25rem' }}>
        <Tarjeta titulo="Dinero en inventario (a costo)" valor={pesos(inv.costoTotal)} icono={Wallet}
          detalle={`${inv.referencias} referencias con existencias`}
          onClick={() => abrir('Inventario valorizado a costo', [...items].filter((p) => !p.isKit && Number(p.stock) > 0).sort((a, b) => inv.valor(b) - inv.valor(a)), 'Existencias × costo. Los kits compuestos no se suman: su valor ya está en sus componentes.')} />
        <Tarjeta titulo="Valor a precio de venta" valor={pesos(inv.ventaTotal)} icono={Tag} color="var(--success)"
          detalle={`${inv.unidades.toLocaleString('es-CO')} unidades terminadas`} />
        <Tarjeta titulo="Utilidad si se vende todo" valor={pesos(inv.utilidad)} icono={TrendingUp} color="var(--success)"
          detalle={`Margen ${inv.margen.toFixed(1)}% sobre la venta`} />
        <Tarjeta titulo="Datos por completar" valor={alertas} icono={AlertTriangle} color={alertas ? 'var(--warning)' : 'var(--success)'}
          detalle={alertas ? 'La cifra aún no es exacta' : 'Costos y precios completos'}
          onClick={() => setLista({
            titulo: 'Datos por completar', nota: 'Sin costo, el dinero en inventario sale menor de lo real; sin precio, el valor de venta también.',
            filas: [
              ...inv.sinCosto.map((p) => ({ nombre: p.name, sub: `Con existencias y costo en 0 · ${formatoCantidad(p.stock, p.unit)}`, valor: 'Sin costo' })),
              ...inv.sinPrecio.map((p) => ({ nombre: p.name, sub: 'Producto terminado sin precio de venta', valor: 'Sin precio' })),
              ...inv.conPerdida.map((p) => ({ nombre: p.name, sub: `Venta ${pesos(p.price)} ≤ costo ${pesos(p.costPrice)}`, valor: 'Pérdida' }))
            ]
          })} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 420px), 1fr))', gap: '1.25rem', marginBottom: '1.25rem' }}>
        <Panel titulo="Dónde está el dinero" icono={Package} alto={300}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={inv.porTipo} margin={{ left: 10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" vertical={false} />
              <XAxis dataKey="nombre" tick={{ fontSize: 11, fill: 'var(--text-muted)' }} />
              <YAxis tickFormatter={corto} tick={{ fontSize: 11, fill: 'var(--text-muted)' }} width={70} />
              <Tooltip {...tooltip} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="costo" name="A costo" fill={COSTO} />
              <Bar dataKey="venta" name="A precio de venta" fill={VENTA} />
            </BarChart>
          </ResponsiveContainer>
        </Panel>
        <Panel titulo="Por categoría" icono={Tag} alto={300}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={inv.porCategoria} layout="vertical" margin={{ left: 10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" horizontal={false} />
              <XAxis type="number" tickFormatter={corto} tick={{ fontSize: 11, fill: 'var(--text-muted)' }} />
              <YAxis type="category" dataKey="nombre" width={95} tick={{ fontSize: 11, fill: 'var(--text-muted)' }} />
              <Tooltip {...tooltip} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="costo" name="A costo" fill={COSTO} />
              <Bar dataKey="venta" name="A precio de venta" fill={VENTA} />
            </BarChart>
          </ResponsiveContainer>
        </Panel>
        <Panel titulo="Top 10: dónde hay más capital" icono={Wallet} alto={340}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={inv.top} layout="vertical" margin={{ left: 10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" horizontal={false} />
              <XAxis type="number" tickFormatter={corto} tick={{ fontSize: 11, fill: 'var(--text-muted)' }} />
              <YAxis type="category" dataKey="nombre" width={150} tick={{ fontSize: 11, fill: 'var(--text-muted)' }} />
              <Tooltip {...tooltip} labelFormatter={(_, p) => p?.[0]?.payload?.completo} />
              <Bar dataKey="costo" name="Capital a costo" fill={COSTO} />
            </BarChart>
          </ResponsiveContainer>
        </Panel>
        <Panel titulo="Esencias por clase" icono={FlaskConical}>
          {inv.porClase.length ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', alignItems: 'center', gap: '1rem' }}>
              <div style={{ height: 240, position: 'relative' }}>
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={inv.porClase} dataKey="value" nameKey="nombre" innerRadius={68} outerRadius={100} paddingAngle={3}>
                      {inv.porClase.map((_, i) => <Cell key={i} fill={PALETA[i % PALETA.length]} />)}
                    </Pie>
                    <Tooltip {...tooltip} formatter={(v, n, it) => [`${pesos(v)} · ${formatoCantidad(it.payload.ml, 'ml')}`, n]} />
                  </PieChart>
                </ResponsiveContainer>
                <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', pointerEvents: 'none', textAlign: 'center' }}>
                  <div><b style={{ fontFamily: 'var(--f-display)', fontSize: '1.3rem', fontWeight: 400 }}>{formatoCantidad(inv.ml, 'ml')}</b><div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>de esencia</div></div>
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>
                {inv.porClase.map((c, i) => (
                  <div key={c.nombre} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                    <i style={{ width: 10, height: 10, marginTop: 5, background: PALETA[i % PALETA.length], flex: 'none' }} />
                    <div>
                      <b style={{ fontWeight: 500 }}>{c.nombre}</b>
                      <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>{pesos(c.value)} · {formatoCantidad(c.ml, 'ml')}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : <p style={{ color: 'var(--text-muted)' }}>No hay esencias con existencias.</p>}
        </Panel>
      </div>

      <div style={{ marginBottom: '2rem' }}>
        <Panel titulo={`Capital dormido: sin ventas en ${DIAS_SIN_ROTAR} días`} icono={Moon}
          accion={<button type="button" className="btn-secondary" onClick={() => abrir(`Sin ventas en ${DIAS_SIN_ROTAR} días`, inv.dormidos, 'Productos terminados con existencias que no se han vendido en ese tiempo, del de más capital al de menos.')}>Ver los {inv.dormidos.length}</button>}>
          <p style={{ margin: 0 }}>
            <b style={{ fontSize: '1.6rem', fontFamily: 'var(--f-display)', fontWeight: 400 }}>{pesos(inv.valorDormido)}</b>
            <span style={{ color: 'var(--text-muted)', marginLeft: 10 }}>
              en {inv.dormidos.length} productos · {inv.costoTerminados > 0 ? ((inv.valorDormido / inv.costoTerminados) * 100).toFixed(0) : 0}% del capital en producto terminado
            </span>
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: '0.9rem' }}>
            {inv.dormidos.slice(0, 8).map((p) => (
              <span key={p.id} className="glass" style={{ padding: '0.35rem 0.6rem', fontSize: '0.78rem' }}>{p.name} · {pesos(inv.valor(p))}</span>
            ))}
          </div>
        </Panel>
      </div>

      {/* ── Ventas (resumen; el detalle está en Ventas, Caja y Cartera) ── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem', marginBottom: '1rem' }}>
        <h3 style={{ margin: 0, fontFamily: 'var(--f-display)', fontWeight: 400, fontSize: '1.6rem' }}>Ventas · {nombrePeriodo}</h3>
        <div className="glass" style={{ display: 'flex', padding: '0.3rem' }}>
          {[['today', 'Hoy'], ['week', 'Semana'], ['month', 'Mes'], ['all', 'Año']].map(([p, t]) => (
            <button key={p} type="button" onClick={() => setPeriodo(p)} style={{ padding: '0.5rem 0.9rem', background: periodo === p ? 'var(--accent-primary)' : 'transparent', color: periodo === p ? 'var(--bg-main)' : 'var(--text-secondary)', border: 0, cursor: 'pointer', fontWeight: 500 }}>{t}</button>
          ))}
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1.25rem', marginBottom: '1.25rem' }}>
        <Tarjeta titulo="Vendido" valor={pesos(vt.total)} icono={DollarSign} detalle={`${vt.n} ventas · ticket ${pesos(vt.ticket)}`} onClick={() => setActiveTab?.('sales')} />
        <Tarjeta titulo="Utilidad bruta" valor={pesos(vt.utilidadBruta)} icono={TrendingUp} color="var(--success)" detalle={`Margen ${vt.total > 0 ? ((vt.utilidadBruta / vt.total) * 100).toFixed(1) : 0}%`} />
        <Tarjeta titulo="Utilidad después de gastos" valor={pesos(vt.utilidadNeta)} icono={Receipt} color={vt.utilidadNeta >= 0 ? 'var(--success)' : 'var(--error)'} detalle={`Gastos ${pesos(vt.gastoPeriodo)}`} onClick={() => setActiveTab?.('expenses')} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 420px), 1fr))', gap: '1.25rem' }}>
        <Panel titulo="Ventas y utilidad" icono={TrendingUp} alto={280}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={vt.serie}>
              <defs>
                <linearGradient id="gv" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor={VENTA} stopOpacity={0.35} /><stop offset="95%" stopColor={VENTA} stopOpacity={0} /></linearGradient>
                <linearGradient id="gu" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#2f9e6e" stopOpacity={0.3} /><stop offset="95%" stopColor="#2f9e6e" stopOpacity={0} /></linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" vertical={false} />
              <XAxis dataKey="nombre" tick={{ fontSize: 11, fill: 'var(--text-muted)' }} />
              <YAxis tickFormatter={corto} tick={{ fontSize: 11, fill: 'var(--text-muted)' }} width={70} />
              <Tooltip {...tooltip} />
              <Area type="monotone" dataKey="Ventas" stroke={VENTA} strokeWidth={2.5} fill="url(#gv)" />
              <Area type="monotone" dataKey="Utilidad" stroke="#2f9e6e" strokeWidth={2} fill="url(#gu)" />
            </AreaChart>
          </ResponsiveContainer>
        </Panel>
        <Panel titulo="Productos estrella" icono={Star}>
          {vt.estrellas.length === 0 ? <p style={{ color: 'var(--text-muted)' }}>Sin ventas en este periodo.</p> : vt.estrellas.map((p, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '0.6rem 0', borderBottom: '1px solid var(--glass-border)' }}>
              <span><b style={{ color: 'var(--accent-primary)', marginRight: 8 }}>{i + 1}</b>{p.nombre}<small style={{ color: 'var(--text-muted)', marginLeft: 8 }}>{p.unidades} und</small></span>
              <b>{pesos(p.ingreso)}</b>
            </div>
          ))}
        </Panel>
      </div>

      <Lista datos={lista} onCerrar={() => setLista(null)} />
    </div>
  );
};

export default Dashboard;
