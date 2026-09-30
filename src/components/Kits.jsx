// Creador de kits: un kit se arma eligiendo ítems del inventario (perfumes, minis, cremas,
// esencias…) con su cantidad. Sus existencias y su costo se calculan con los componentes,
// y al venderlo DATA descuenta cada componente.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus, Search, Trash2, X, Gift, AlertTriangle, Save } from 'lucide-react';
import { NumericFormat } from 'react-number-format';
import { api } from '../services/api';
import { formatoCantidad } from '../utils/inventario';

const pesos = (n) => `$${Math.round(Number(n) || 0).toLocaleString('es-CO')}`;
const VACIO = { id: null, name: '', price: '', components: [] };
const alcanza = (c) => Math.max(0, Math.floor(Number(c.stock) / Number(c.quantity) + 1e-9));

const Kits = ({ inventory, notify, confirm, onRefresh }) => {
  const [kits, setKits] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [editor, setEditor] = useState(null);
  const [busqueda, setBusqueda] = useState('');
  const [filtro, setFiltro] = useState('');
  const [guardando, setGuardando] = useState(false);

  const cargar = useCallback(async () => {
    try {
      setKits(await api.get('/kits'));
    } catch (err) {
      notify?.(`No se pudieron cargar los kits: ${err.message}`, 'error');
    } finally {
      setCargando(false);
    }
  }, [notify]);

  useEffect(() => { cargar(); }, [cargar]);

  const items = Array.isArray(inventory) ? inventory : [];
  const idsKitsCompuestos = useMemo(() => new Set(kits.filter((k) => k.components.length).map((k) => k.id)), [kits]);

  // Candidatos a componente: cualquier ítem activo que no sea un kit ni el kit que se edita
  const candidatos = useMemo(() => {
    if (!editor) return [];
    const q = busqueda.trim().toLowerCase();
    if (!q) return [];
    const usados = new Set(editor.components.map((c) => c.productId));
    return items
      .filter((p) => p.id !== editor.id && !idsKitsCompuestos.has(p.id) && !/kit/i.test(p.category || '') && !usados.has(p.id))
      .filter((p) => [p.name, p.category, p.code].some((t) => String(t || '').toLowerCase().includes(q)))
      .slice(0, 8);
  }, [items, editor, busqueda, idsKitsCompuestos]);

  const abrir = (kit) => {
    setBusqueda('');
    setEditor(kit
      ? { id: kit.id, name: kit.name, price: String(kit.price), components: kit.components.map((c) => ({ ...c })) }
      : { ...VACIO });
  };

  const agregar = (p) => {
    setEditor((e) => ({ ...e, components: [...e.components, { productId: p.id, name: p.name, quantity: 1, stock: p.stock, costPrice: p.costPrice, unit: p.unit || 'und' }] }));
    setBusqueda('');
  };
  const cambiarCantidad = (id, quantity) => setEditor((e) => ({ ...e, components: e.components.map((c) => (c.productId === id ? { ...c, quantity } : c)) }));
  const quitar = (id) => setEditor((e) => ({ ...e, components: e.components.filter((c) => c.productId !== id) }));

  const resumen = useMemo(() => {
    if (!editor) return null;
    const validos = editor.components.filter((c) => Number(c.quantity) > 0);
    const costo = validos.reduce((s, c) => s + Number(c.quantity) * Number(c.costPrice || 0), 0);
    const disponibles = validos.length ? Math.min(...validos.map(alcanza)) : 0;
    const precio = Number(editor.price) || 0;
    return { costo, disponibles, precio, margen: precio > 0 ? (precio - costo) / precio : null, revision: costo > 0 && precio <= costo };
  }, [editor]);

  async function guardar() {
    const nombre = editor.name.trim();
    if (!nombre) { notify?.('El kit necesita un nombre.', 'warning'); return; }
    if (!(Number(editor.price) > 0)) { notify?.('El kit necesita un precio de venta.', 'warning'); return; }
    if (!editor.components.length) { notify?.('Agrega al menos un componente.', 'warning'); return; }
    if (editor.components.some((c) => !(Number(c.quantity) > 0))) { notify?.('Cada componente necesita una cantidad mayor que 0.', 'warning'); return; }
    setGuardando(true);
    try {
      let id = editor.id;
      if (id) {
        // Nombre y precio del ítem; el stock y el costo del kit los calculan sus componentes
        const actual = items.find((p) => p.id === id) || {};
        await api.put(`/products/${id}`, {
          name: nombre, category: actual.category || 'Kit', price: Number(editor.price), costPrice: actual.costPrice || 0,
          code: actual.code, type: actual.type || 'terminado', unit: actual.unit, minStock: actual.minStock,
          purchaseUnit: actual.purchaseUnit, purchaseFactor: actual.purchaseFactor
        });
      } else {
        const creado = await api.post('/products', { name: nombre, category: 'Kit', price: Number(editor.price), costPrice: 0, stock: 0, type: 'terminado' });
        id = creado.id;
      }
      await api.put(`/kits/${id}/components`, { components: editor.components.map((c) => ({ productId: c.productId, quantity: Number(c.quantity) })) });
      notify?.(editor.id ? 'Kit actualizado.' : 'Kit creado.', 'success');
      setEditor(null);
      await Promise.all([cargar(), onRefresh?.()]);
    } catch (err) {
      notify?.(err.message, 'error');
    } finally {
      setGuardando(false);
    }
  }

  const eliminar = (kit) => {
    confirm?.(`¿Eliminar el kit «${kit.name}»? Deja de estar a la venta; sus componentes no se tocan y las ventas pasadas se conservan.`, async () => {
      try {
        await api.put(`/kits/${kit.id}/components`, { components: [] });
        await api.delete(`/products/${kit.id}`);
        notify?.('Kit eliminado.', 'success');
        if (editor?.id === kit.id) setEditor(null);
        await Promise.all([cargar(), onRefresh?.()]);
      } catch (err) {
        notify?.(err.message, 'error');
      }
    });
  };

  const q = filtro.trim().toLowerCase();
  // Primero los kits ya armados; luego los que aún descuentan su propio stock
  const visibles = kits
    .filter((k) => !q || k.name.toLowerCase().includes(q) || k.components.some((c) => c.name.toLowerCase().includes(q)))
    .sort((a, b) => (b.components.length > 0) - (a.components.length > 0) || a.name.localeCompare(b.name));

  return (
    <div className="main-content">
      <header className="page-header">
        <div>
          <h2 className="title-gradient" style={{ fontSize: '2.5rem', marginBottom: '0.25rem' }}>Kits</h2>
          <p style={{ color: 'var(--text-secondary)', fontWeight: 500 }}>Arma kits con cualquier producto del inventario. Sus existencias y su costo salen de los componentes.</p>
        </div>
        <button onClick={() => abrir(null)} className="btn-primary" style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <Plus size={20} /> Nuevo kit
        </button>
      </header>

      {editor && (
        <div className="premium-card kit-editor">
          <button onClick={() => setEditor(null)} className="kit-cerrar" aria-label="Cerrar editor"><X size={20} /></button>
          <h4 style={{ marginBottom: '1.5rem', color: 'var(--accent-primary)' }}>{editor.id ? 'EDITAR KIT' : 'NUEVO KIT'}</h4>
          <div className="kit-campos">
            <div>
              <label htmlFor="kit-nombre">Nombre</label>
              <input id="kit-nombre" type="text" value={editor.name} onChange={(e) => setEditor({ ...editor, name: e.target.value })} placeholder="Kit Khamrah mini" style={{ width: '100%', textTransform: 'none' }} />
            </div>
            <div>
              <label htmlFor="kit-precio">Precio de venta (COP)</label>
              <NumericFormat id="kit-precio" value={editor.price} onValueChange={(v) => setEditor({ ...editor, price: v.value })} thousandSeparator="." decimalSeparator="," placeholder="0" style={{ width: '100%' }} />
            </div>
          </div>

          <label htmlFor="kit-buscar" style={{ display: 'block', margin: '1.5rem 0 0.6rem' }}>Agregar componente</label>
          <div className="kit-buscador">
            <Search size={16} className="kit-buscador-ico" />
            <input id="kit-buscar" type="text" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} placeholder="Buscar perfume, mini, crema, esencia…" autoComplete="off" style={{ width: '100%', paddingLeft: '2.6rem', textTransform: 'none' }} />
            {candidatos.length > 0 && (
              <ul className="kit-sugerencias" role="listbox">
                {candidatos.map((p) => (
                  <li key={p.id}>
                    <button type="button" onClick={() => agregar(p)}>
                      <span>{p.name}</span>
                      <small>{p.category} · {formatoCantidad(p.stock, p.unit)} en stock</small>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="kit-componentes">
            {editor.components.length === 0 && <p className="kit-vacio">Aún no hay componentes. Busca arriba y agrega los productos que forman el kit.</p>}
            {editor.components.map((c) => (
              <div className="kit-comp" key={c.productId}>
                <div className="kit-comp-nombre">
                  <b>{c.name}</b>
                  <small>{formatoCantidad(c.stock, c.unit)} en stock · costo {pesos(c.costPrice)}{c.unit === 'ml' ? ' / ml' : ''}</small>
                </div>
                <NumericFormat value={c.quantity} onValueChange={(v) => cambiarCantidad(c.productId, v.value)} decimalSeparator="," thousandSeparator="." decimalScale={2}
                  aria-label={`Cantidad de ${c.name}`} className="kit-comp-cant" />
                <span className="kit-comp-unidad">{c.unit === 'ml' ? 'ml' : 'und'}</span>
                <button type="button" className="kit-comp-quitar" onClick={() => quitar(c.productId)} aria-label={`Quitar ${c.name}`}><Trash2 size={16} /></button>
              </div>
            ))}
          </div>

          <div className="kit-resumen">
            <div><span>Costo del kit</span><b>{pesos(resumen.costo)}</b></div>
            <div><span>Precio</span><b>{pesos(resumen.precio)}</b></div>
            <div><span>Margen</span><b>{resumen.margen == null ? '—' : `${Math.round(resumen.margen * 100)} %`}</b></div>
            <div><span>Se pueden armar</span><b>{resumen.disponibles}</b></div>
            <button type="button" className="btn-primary" onClick={guardar} disabled={guardando} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Save size={16} /> {guardando ? 'Guardando…' : 'Guardar kit'}
            </button>
          </div>
          {resumen.revision && (
            <p className="kit-alerta"><AlertTriangle size={14} /> El precio no cubre el costo de los componentes: la tienda web lo mostrará «en revisión» y no lo venderá.</p>
          )}
        </div>
      )}

      <div className="premium-card" style={{ padding: 0 }}>
        <div className="search-filter-bar">
          <div style={{ position: 'relative', maxWidth: 360 }}>
            <Search style={{ position: 'absolute', left: '1rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} size={16} />
            <input type="text" placeholder="Buscar kit o componente…" value={filtro} onChange={(e) => setFiltro(e.target.value)} style={{ width: '100%', paddingLeft: '2.6rem', textTransform: 'none' }} />
          </div>
        </div>
        {cargando ? <p className="kit-vacio" style={{ padding: '2rem' }}>Cargando kits…</p> : (
          <div className="kit-lista">
            {visibles.length === 0 && <p className="kit-vacio" style={{ padding: '2rem' }}>No hay kits. Crea el primero con «Nuevo kit».</p>}
            {visibles.map((k) => (
              <article key={k.id} className={`kit-tarjeta ${editor?.id === k.id ? 'on' : ''}`}>
                <header>
                  <Gift size={18} />
                  <h3>{k.name}</h3>
                  <div className="kit-acciones">
                    <button type="button" className="btn-secondary" onClick={() => abrir(k)}>Editar</button>
                    <button type="button" className="kit-comp-quitar" onClick={() => eliminar(k)} aria-label={`Eliminar ${k.name}`}><Trash2 size={16} /></button>
                  </div>
                </header>
                {k.components.length ? (
                  <ul className="kit-tarjeta-comp">
                    {k.components.map((c) => (
                      <li key={c.productId} className={alcanza(c) === 0 ? 'falta' : ''}>
                        <span>{formatoCantidad(c.quantity, c.unit)} × {c.name}</span>
                        <small>{formatoCantidad(c.stock, c.unit)} en stock</small>
                      </li>
                    ))}
                  </ul>
                ) : <p className="kit-vacio">Sin componentes: todavía descuenta su propio stock. Edítalo para armarlo.</p>}
                <footer>
                  <span>Precio <b>{pesos(k.price)}</b></span>
                  {k.components.length > 0 && <span>Costo <b>{pesos(k.costPrice)}</b></span>}
                  {k.components.length > 0 && <span>Disponibles <b className={k.stock === 0 ? 'falta' : ''}>{k.stock}</b></span>}
                  {k.priceReview && <span className="kit-alerta"><AlertTriangle size={14} /> Precio en revisión</span>}
                </footer>
              </article>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default Kits;
