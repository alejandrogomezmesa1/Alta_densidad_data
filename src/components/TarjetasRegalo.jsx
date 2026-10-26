import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Ticket, Printer, Copy, Search, Ban, CheckCircle2, X } from 'lucide-react';
import { NumericFormat } from 'react-number-format';
import { api } from '../services/api';
import { pesos, hoyBogota } from '../utils/inventario';
import { tarjetaPdf, fechaLarga } from '../utils/tarjetaPdf';

// Tarjetas de regalo (solo tienda física): se venden aquí y se usan en Vender con su código.
// Reglas: 6 meses de vigencia desde la venta, un solo uso, sin vueltas. Vender la tarjeta mete el
// dinero a la caja; usarla no (ese dinero ya entró).

const VALORES = [50000, 100000, 150000, 200000, 300000];
const ESTADOS = {
  activa: { etiqueta: 'Activa', color: 'var(--success)' },
  redimida: { etiqueta: 'Usada', color: 'var(--text-secondary)' },
  vencida: { etiqueta: 'Vencida', color: 'var(--warning)' },
  anulada: { etiqueta: 'Anulada', color: 'var(--error)' }
};
const FORM = { valor: '', comprador: '', para: '', notas: '', metodoId: null };

// Fecha de vencimiento que tendrá una tarjeta vendida hoy (la confirma el servidor)
function venceDesde(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  const f = new Date(Date.UTC(y, m - 1 + 6, 1));
  const ultimo = new Date(Date.UTC(f.getUTCFullYear(), f.getUTCMonth() + 1, 0)).getUTCDate();
  return `${f.getUTCFullYear()}-${String(f.getUTCMonth() + 1).padStart(2, '0')}-${String(Math.min(d, ultimo)).padStart(2, '0')}`;
}

const TarjetasRegalo = ({ notify, confirm }) => {
  const [lista, setLista] = useState(null);
  const [metodos, setMetodos] = useState([]);
  const [form, setForm] = useState(FORM);
  const [guardando, setGuardando] = useState(false);
  const [nueva, setNueva] = useState(null);
  const [q, setQ] = useState('');
  const [estado, setEstado] = useState('');
  const [anulando, setAnulando] = useState(null); // { id, code, motivo }

  const cargar = useCallback(() => {
    api.get('/gift-cards').then(setLista).catch((e) => { setLista([]); notify?.(e.message, 'error'); });
  }, [notify]);

  useEffect(() => {
    cargar();
    api.get('/payment-methods').then((l) => {
      const m = (Array.isArray(l) ? l : []).filter((x) => x.id && !/\(web\)/i.test(x.name));
      setMetodos(m);
      setForm((f) => ({ ...f, metodoId: f.metodoId || m[0]?.id || null }));
    }).catch(() => {});
  }, [cargar]);

  const filtradas = useMemo(() => (lista || [])
    .filter((t) => !estado || t.status === estado)
    .filter((t) => {
      const s = q.trim().toLowerCase().replace(/[^a-z0-9áéíóúñ ]/g, '');
      return !s || `${t.code} ${t.buyer || ''} ${t.recipient || ''}`.toLowerCase().replace(/[^a-z0-9áéíóúñ ]/g, '').includes(s);
    }), [lista, q, estado]);

  const resumen = useMemo(() => {
    const activas = (lista || []).filter((t) => t.status === 'activa');
    const hoy = new Date(`${hoyBogota()}T00:00:00Z`);
    const pronto = activas.filter((t) => (new Date(`${t.expires}T00:00:00Z`) - hoy) / 86400000 <= 30);
    return { n: activas.length, total: activas.reduce((s, t) => s + t.value, 0), pronto: pronto.length };
  }, [lista]);

  const valor = Number(form.valor) || 0;

  const vender = async () => {
    if (valor < 1000) return notify?.('Escribe el valor de la tarjeta', 'warning');
    if (!form.metodoId) return notify?.('Elige con qué la pagaron', 'warning');
    setGuardando(true);
    try {
      const t = await api.post('/gift-cards', { value: valor, buyer: form.comprador, recipient: form.para, notes: form.notas, methodId: form.metodoId, date: hoyBogota() });
      setNueva(t);
      setForm((f) => ({ ...FORM, metodoId: f.metodoId }));
      notify?.(`Tarjeta ${t.code} vendida por ${pesos(t.value)}`, 'success');
      cargar();
    } catch (e) {
      notify?.(e.message, 'error');
    } finally {
      setGuardando(false);
    }
  };

  const imprimir = async (t) => {
    try { await tarjetaPdf(t); } catch (e) { notify?.('No se pudo armar el PDF: ' + e.message, 'error'); }
  };
  const copiar = async (code) => {
    try { await navigator.clipboard.writeText(code); notify?.(`Código ${code} copiado`, 'success'); } catch { notify?.(code, 'info'); }
  };

  const anular = async () => {
    if ((anulando?.motivo || '').trim().length < 5) return notify?.('Escribe el motivo (mínimo 5 letras)', 'warning');
    try {
      await api.post(`/gift-cards/${anulando.id}/void`, { reason: anulando.motivo });
      notify?.(`Tarjeta ${anulando.code} anulada: el dinero sale de la caja`, 'success');
      setAnulando(null);
      cargar();
    } catch (e) {
      notify?.(e.message, 'error');
    }
  };

  return (
    <div className="main-content">
      <header className="page-header">
        <div>
          <h2 className="title-gradient" style={{ fontSize: '2.5rem', marginBottom: '0.25rem' }}>Tarjetas de regalo</h2>
          <p style={{ color: 'var(--text-secondary)' }}>Valen 6 meses desde la compra, se usan una sola vez y no dan vueltas. Se cobran en Vender con su código.</p>
        </div>
      </header>

      <div className="dash-grid dash-3" style={{ marginBottom: '1.5rem' }}>
        <div className="premium-card"><span className="paso">Activas</span><div style={{ fontSize: '2rem', fontWeight: 500 }}>{lista ? resumen.n : '…'}</div></div>
        <div className="premium-card"><span className="paso">Por usar (lo que debe la tienda)</span><div style={{ fontSize: '2rem', fontWeight: 500, color: 'var(--accent-primary)' }}>{lista ? pesos(resumen.total) : '…'}</div></div>
        <div className="premium-card"><span className="paso">Vencen en 30 días</span><div style={{ fontSize: '2rem', fontWeight: 500, color: resumen.pronto ? 'var(--warning)' : undefined }}>{lista ? resumen.pronto : '…'}</div></div>
      </div>

      <div className="dia-grid">
        {/* Vender una tarjeta */}
        <div className="premium-card">
          <span className="paso">Vender una tarjeta</span>
          <div className="chips">
            {VALORES.map((v) => <button key={v} className={`chip${valor === v ? ' active' : ''}`} onClick={() => setForm((f) => ({ ...f, valor: String(v) }))}>{pesos(v)}</button>)}
          </div>
          <label style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', marginTop: '1rem' }}>
            Valor
            <NumericFormat value={form.valor} prefix="$" thousandSeparator="." decimalSeparator="," allowNegative={false} decimalScale={0}
              onValueChange={(v) => setForm((f) => ({ ...f, valor: v.value }))} placeholder="$0" />
          </label>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: '0.75rem', marginTop: '0.75rem' }}>
            <input value={form.comprador} maxLength={120} placeholder="Quién la compra (opcional)" onChange={(e) => setForm((f) => ({ ...f, comprador: e.target.value }))} />
            <input value={form.para} maxLength={120} placeholder="Para quién es (opcional)" onChange={(e) => setForm((f) => ({ ...f, para: e.target.value }))} />
          </div>
          <input value={form.notas} maxLength={255} placeholder="Nota interna (opcional)" onChange={(e) => setForm((f) => ({ ...f, notas: e.target.value }))} style={{ width: '100%', marginTop: '0.75rem' }} />
          <span className="paso" style={{ marginTop: '1.25rem' }}>La pagan con</span>
          <div className="chips">
            {metodos.map((m) => <button key={m.id} className={`chip${form.metodoId === m.id ? ' active' : ''}`} onClick={() => setForm((f) => ({ ...f, metodoId: m.id }))}>{m.name}</button>)}
          </div>
          <p style={{ marginTop: '1rem', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
            Vence el <b>{fechaLarga(venceDesde(hoyBogota()))}</b>. El dinero entra a la caja ahora; no cuenta como venta hasta que se use.
          </p>
          <button className="btn-primary" onClick={vender} disabled={guardando || valor < 1000 || !form.metodoId} style={{ width: '100%', height: 54, marginTop: '1rem' }}>
            {guardando ? 'Registrando…' : valor >= 1000 ? `Vender tarjeta de ${pesos(valor)}` : 'Escribe el valor'}
          </button>

          {nueva && (
            <div className="premium-card" style={{ marginTop: '1.25rem', borderColor: 'var(--success)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', alignItems: 'flex-start' }}>
                <span style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}><CheckCircle2 size={18} color="var(--success)" /> Tarjeta vendida</span>
                <button className="btn-icon" onClick={() => setNueva(null)} aria-label="Cerrar"><X size={14} /></button>
              </div>
              <div style={{ fontSize: '1.6rem', letterSpacing: '0.08em', fontWeight: 500, margin: '0.5rem 0', overflowWrap: 'anywhere' }}>{nueva.code}</div>
              <div style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>{pesos(nueva.value)} · vence el {fechaLarga(nueva.expires)}</div>
              <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', marginTop: '1rem' }}>
                <button className="btn-primary" onClick={() => imprimir(nueva)}><Printer size={16} /> Imprimir (PDF 85 × 55 mm)</button>
                <button className="btn-secondary" onClick={() => copiar(nueva.code)}><Copy size={16} /> Copiar código</button>
              </div>
            </div>
          )}
        </div>

        {/* Lista */}
        <div className="premium-card" style={{ padding: 0, minWidth: 0 }}>
          <div style={{ padding: '1.25rem 1.25rem 0.75rem' }}>
            <span className="paso">Tarjetas</span>
            <div style={{ position: 'relative' }}>
              <Search size={18} style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Código, comprador o destinatario…" style={{ width: '100%', paddingLeft: 42 }} />
            </div>
            <div className="chips" style={{ marginTop: '0.75rem' }}>
              <button className={`chip${!estado ? ' active' : ''}`} onClick={() => setEstado('')}>Todas</button>
              {Object.entries(ESTADOS).map(([k, e]) => <button key={k} className={`chip${estado === k ? ' active' : ''}`} onClick={() => setEstado(estado === k ? '' : k)}>{e.etiqueta}</button>)}
            </div>
          </div>
          <div style={{ maxHeight: 620, overflowY: 'auto', borderTop: '1px solid var(--glass-border)' }}>
            {!lista && <p style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>Cargando…</p>}
            {lista && !filtradas.length && <p style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>{lista.length ? 'Nada coincide.' : 'Todavía no se ha vendido ninguna tarjeta.'}</p>}
            {filtradas.map((t) => (
              <div key={t.id} style={{ padding: '0.9rem 1.25rem', borderBottom: '1px solid var(--glass-border)', display: 'grid', gap: '0.35rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', alignItems: 'baseline', flexWrap: 'wrap' }}>
                  <span style={{ fontWeight: 500, letterSpacing: '0.06em', display: 'flex', gap: '0.5rem', alignItems: 'center' }}><Ticket size={15} /> {t.code}</span>
                  <span style={{ fontWeight: 500, color: 'var(--accent-primary)' }}>{pesos(t.value)}</span>
                </div>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
                  <span style={{ color: ESTADOS[t.status]?.color, fontWeight: 500 }}>{ESTADOS[t.status]?.etiqueta}</span>
                  <span>Vendida {fechaLarga(t.date)}{t.method ? ` · ${t.method}` : ''}</span>
                  <span>Vence {fechaLarga(t.expires)}</span>
                  {(t.buyer || t.recipient) && <span>{[t.recipient && `Para ${t.recipient}`, t.buyer && `de ${t.buyer}`].filter(Boolean).join(' · ')}</span>}
                  {t.status === 'redimida' && <span>Usada en la venta #{t.saleId}: {pesos(t.applied)}{t.leftover > 0 ? ` (sobraron ${pesos(t.leftover)})` : ''}</span>}
                  {t.status === 'anulada' && <span>Anulada: {t.voidReason}</span>}
                </div>
                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                  {t.status === 'activa' && <button className="btn-secondary" style={{ minHeight: 32 }} onClick={() => imprimir(t)}><Printer size={14} /> PDF</button>}
                  <button className="btn-secondary" style={{ minHeight: 32 }} onClick={() => copiar(t.code)}><Copy size={14} /> Código</button>
                  {(t.status === 'activa' || t.status === 'vencida') && (
                    <button className="btn-secondary" style={{ minHeight: 32, color: 'var(--error)' }} onClick={() => setAnulando({ id: t.id, code: t.code, motivo: '' })}><Ban size={14} /> Anular</button>
                  )}
                </div>
                {anulando?.id === t.id && (
                  <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
                    <input autoFocus value={anulando.motivo} onChange={(e) => setAnulando((a) => ({ ...a, motivo: e.target.value }))} placeholder="Motivo de la anulación" style={{ flex: '1 1 200px' }} />
                    <button className="btn-primary" style={{ minHeight: 36, background: 'var(--error)' }}
                      onClick={() => confirm ? confirm(`¿Anular la tarjeta ${t.code}? Los ${pesos(t.value)} salen de la caja.`, anular) : anular()}>Anular</button>
                    <button className="btn-secondary" style={{ minHeight: 36 }} onClick={() => setAnulando(null)}>Cancelar</button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default TarjetasRegalo;
