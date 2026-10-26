import React, { useCallback, useEffect, useState } from 'react';
import { ArrowDownCircle, ArrowUpCircle, Calculator, History, Lock, PlusCircle, MinusCircle, ChevronDown, ChevronRight, AlertTriangle } from 'lucide-react';
import { NumericFormat } from 'react-number-format';
import Ventana from './Ventana';
import CashRegisterAnterior from './CashRegisterAnterior';
import { api } from '../services/api';

// Caja por sesiones: siempre hay una abierta. El servidor lleva el libro de dinero y calcula el
// efectivo esperado; al cerrar se escribe lo contado y queda la diferencia. Nada se borra.

const pesos = (v) => `${v < 0 ? '-' : ''}$${Math.abs(Math.round(Number(v) || 0)).toLocaleString('es-CO')}`;
const conSigno = (v) => `${v < 0 ? '−' : '+'}$${Math.abs(Math.round(Number(v) || 0)).toLocaleString('es-CO')}`;
const fechaHora = (v) => (v ? new Date(String(v).replace(' ', 'T')).toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' }) : '');
const hora = (v) => (v ? new Date(String(v).replace(' ', 'T')).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' }) : '');

const TIPOS = { cobro: 'Cobro', gasto: 'Gasto', compra: 'Compra', ingreso: 'Ingreso de efectivo', retiro: 'Retiro de efectivo' };

const Fila = ({ etiqueta, valor, color, fuerte }) => (
  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '1rem', padding: '0.35rem 0' }}>
    <span style={{ color: fuerte ? 'var(--text-main)' : 'var(--text-secondary)', fontWeight: fuerte ? 500 : 400 }}>{etiqueta}</span>
    <span style={{ fontWeight: 500, color: color || 'var(--text-main)', fontSize: fuerte ? '1.6rem' : undefined }}>{valor}</span>
  </div>
);

const Diferencia = ({ valor }) => {
  if (valor === null || valor === undefined) return <span style={{ color: 'var(--text-muted)' }}>—</span>;
  if (Math.abs(valor) < 1) return <span style={{ color: 'var(--success)' }}>Cuadra</span>;
  return <span style={{ color: valor < 0 ? 'var(--error)' : 'var(--warning)' }}>{valor < 0 ? `Faltan ${pesos(-valor)}` : `Sobran ${pesos(valor)}`}</span>;
};

const Movimientos = ({ lista }) => (
  lista.length === 0
    ? <p style={{ color: 'var(--text-muted)', padding: '1.5rem 0', textAlign: 'center' }}>Sin movimientos todavía.</p>
    : (
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {lista.map((m) => (
          <div key={m.id} style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', padding: '0.7rem 0', borderBottom: '1px solid var(--glass-border)' }}>
            <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'flex-start', minWidth: 0 }}>
              {m.amount >= 0 ? <ArrowUpCircle size={15} color="var(--success)" style={{ flexShrink: 0, marginTop: 2 }} /> : <ArrowDownCircle size={15} color="var(--error)" style={{ flexShrink: 0, marginTop: 2 }} />}
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 500 }}>{m.description || TIPOS[m.type]}</div>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                  {TIPOS[m.type]} · {m.method}{m.isCash ? '' : ' (no entra al cajón)'} · {hora(m.createdAt)}{m.user ? ` · ${m.user}` : ''}
                </div>
              </div>
            </div>
            <span style={{ fontWeight: 500, whiteSpace: 'nowrap', color: m.amount < 0 ? 'var(--error)' : 'var(--success)', opacity: m.isCash ? 1 : 0.7 }}>{conSigno(m.amount)}</span>
          </div>
        ))}
      </div>
    )
);

const CashRegister = (props) => {
  const { notify } = props;
  const [estado, setEstado] = useState('cargando'); // cargando | listo | anterior | error
  const [actual, setActual] = useState(null);
  const [historial, setHistorial] = useState([]);
  const [detalle, setDetalle] = useState(null);
  const [cerrando, setCerrando] = useState(false);
  const [movimiento, setMovimiento] = useState(null); // 'ingreso' | 'retiro'
  const [form, setForm] = useState({ contado: '', retirado: '', notas: '', monto: '', motivo: '' });
  const [guardando, setGuardando] = useState(false);
  const [anteriores, setAnteriores] = useState({ abiertos: false, lista: [] });

  const cargar = useCallback(async () => {
    try {
      const [c, h] = await Promise.all([api.get('/cash/current'), api.get('/cash/sessions')]);
      setActual(c);
      setHistorial(Array.isArray(h) ? h : []);
      setEstado('listo');
    } catch (e) {
      // Servidor sin la migración 016: se usa el cierre anterior
      if (/migraci[oó]n 016/i.test(e.message)) setEstado('anterior');
      else { setEstado('error'); notify?.(e.message, 'error'); }
    }
  }, [notify]);

  useEffect(() => { cargar(); }, [cargar]);

  if (estado === 'anterior') return <CashRegisterAnterior {...props} />;

  const sesion = actual?.session;
  const resumen = actual?.summary;
  const esperado = resumen?.expectedCash ?? 0;
  const contado = form.contado === '' ? null : Number(form.contado);
  const retirado = Number(form.retirado) || 0;
  const otrosMedios = (resumen?.byMethod || []).filter((m) => !m.isCash && Math.abs(m.total) > 0);
  const sinArranque = sesion && resumen && sesion.initialCash === 0 && resumen.movementCount === 0;

  const cerrar = async (e) => {
    e.preventDefault();
    if (contado === null) { notify?.('Escribe cuánto efectivo contaste en el cajón.', 'warning'); return; }
    if (retirado > contado) { notify?.('No puedes retirar más de lo que contaste.', 'warning'); return; }
    setGuardando(true);
    try {
      const r = await api.post('/cash/close', { sessionId: sesion.id, countedCash: contado, withdrawn: retirado, notes: form.notas });
      notify?.(Math.abs(r.difference) < 1 ? 'Caja cerrada: cuadra.' : `Caja cerrada con diferencia de ${pesos(r.difference)}.`, Math.abs(r.difference) < 1 ? 'success' : 'warning');
      setCerrando(false);
      setForm({ contado: '', retirado: '', notas: '', monto: '', motivo: '' });
    } catch (err) {
      notify?.(err.message, 'error');
    } finally {
      setGuardando(false);
      cargar();
    }
  };

  const registrarMovimiento = async (e) => {
    e.preventDefault();
    setGuardando(true);
    try {
      await api.post('/cash/movements', { type: movimiento, amount: Number(form.monto), reason: form.motivo });
      notify?.(movimiento === 'ingreso' ? 'Ingreso de efectivo registrado.' : 'Retiro de efectivo registrado.', 'success');
      setMovimiento(null);
      setForm((f) => ({ ...f, monto: '', motivo: '' }));
      cargar();
    } catch (err) {
      notify?.(err.message, 'error');
    } finally {
      setGuardando(false);
    }
  };

  const verDetalle = async (id) => {
    try { setDetalle(await api.get(`/cash/sessions/${id}`)); } catch (err) { notify?.(err.message, 'error'); }
  };

  const verAnteriores = async () => {
    if (!anteriores.abiertos && !anteriores.lista.length) {
      try { setAnteriores({ abiertos: true, lista: await api.get('/cash-closings') }); } catch { setAnteriores({ abiertos: true, lista: [] }); }
    } else setAnteriores((a) => ({ ...a, abiertos: !a.abiertos }));
  };

  return (
    <div className="main-content">
      <header className="page-header">
        <div>
          <h2 className="title-gradient" style={{ fontSize: '2.5rem', marginBottom: '0.5rem' }}>Caja</h2>
          <p style={{ color: 'var(--text-secondary)', fontWeight: 500 }}>
            {sesion ? `Abierta desde ${fechaHora(sesion.openedAt)}` : estado === 'cargando' ? 'Cargando…' : 'No se pudo cargar la caja.'}
          </p>
        </div>
        {sesion && (
          <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
            <button className="btn-secondary" onClick={() => setMovimiento('ingreso')} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}><PlusCircle size={16} /> Ingreso</button>
            <button className="btn-secondary" onClick={() => setMovimiento('retiro')} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}><MinusCircle size={16} /> Retiro</button>
            <button className="btn-primary" onClick={() => setCerrando(true)} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}><Lock size={16} /> Cerrar caja</button>
          </div>
        )}
      </header>

      {sinArranque && (
        <div className="premium-card" style={{ marginBottom: '1.5rem', display: 'flex', gap: '0.75rem', alignItems: 'center', borderColor: 'var(--warning)' }}>
          <AlertTriangle size={18} color="var(--warning)" />
          <span>¿Hay efectivo en el cajón al empezar? Regístralo con <b>Ingreso</b> («Base del cajón») para que el cierre cuadre.</span>
        </div>
      )}

      {sesion && resumen && (
        <div className="stat-card-grid" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1.4fr)', gap: '2rem', marginBottom: '2rem' }}>
          <div className="premium-card">
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1.5rem' }}>
              <Calculator size={20} color="var(--accent-primary)" />
              <h3 style={{ fontSize: '1.1rem', fontWeight: 500 }}>EFECTIVO EN EL CAJÓN</h3>
            </div>
            <Fila etiqueta="Base al abrir" valor={pesos(resumen.initialCash)} />
            <Fila etiqueta="Entró en efectivo" valor={conSigno(resumen.cashIn)} color="var(--success)" />
            <Fila etiqueta="Salió en efectivo" valor={`−${pesos(resumen.cashOut)}`} color="var(--error)" />
            <div style={{ height: 1, background: 'var(--glass-border)', margin: '0.75rem 0' }} />
            <Fila etiqueta="Debe haber" valor={pesos(esperado)} color="var(--accent-primary)" fuerte />

            <div style={{ marginTop: '1.75rem' }}>
              <span className="up" style={{ fontSize: '10px', color: 'var(--text-muted)' }}>Otros medios (no están en el cajón)</span>
              {otrosMedios.length === 0
                ? <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginTop: '0.5rem' }}>Nada por transferencia, Nequi ni web en esta sesión.</p>
                : otrosMedios.map((m) => <Fila key={m.method} etiqueta={m.method} valor={conSigno(m.total)} color={m.total < 0 ? 'var(--error)' : 'var(--info)'} />)}
            </div>
            <div style={{ marginTop: '1.25rem', fontSize: '0.8rem', color: 'var(--text-muted)', lineHeight: 1.6 }}>
              Cobros {pesos(resumen.byType.collections)} · Gastos {pesos(resumen.byType.expenses)} · Compras {pesos(resumen.byType.purchases)}
            </div>
          </div>

          <div className="premium-card">
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem' }}>
              <History size={20} color="var(--text-muted)" />
              <h3 style={{ fontSize: '1.1rem', fontWeight: 500 }}>MOVIMIENTOS DE ESTA SESIÓN ({resumen.movementCount})</h3>
            </div>
            <div style={{ maxHeight: 460, overflowY: 'auto' }}><Movimientos lista={resumen.movements || []} /></div>
          </div>
        </div>
      )}

      <div className="premium-card">
        <h3 style={{ fontSize: '1.1rem', fontWeight: 500, marginBottom: '1rem' }}>CIERRES</h3>
        {historial.length === 0 && <p style={{ color: 'var(--text-muted)' }}>Todavía no hay cierres.</p>}
        <div className="table-responsive-wrapper">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            {historial.length > 0 && (
              <thead>
                <tr style={{ textAlign: 'left' }}>
                  {['Sesión', 'Debía haber', 'Contado', 'Diferencia', 'Quedó en el cajón'].map((t) => <th key={t} style={{ padding: '0.75rem 1rem', fontSize: '0.7rem', color: 'var(--text-muted)' }}>{t.toUpperCase()}</th>)}
                </tr>
              </thead>
            )}
            <tbody>
              {historial.map((h) => (
                <tr key={h.id} onClick={() => verDetalle(h.id)} className="hover-glow" style={{ borderTop: '1px solid var(--glass-border)', cursor: 'pointer' }}>
                  <td style={{ padding: '0.85rem 1rem' }}>
                    <span className="mobile-label">Sesión</span>
                    <div style={{ fontWeight: 500 }}>{h.type === 'regularizacion' ? 'Regularización (movimientos anteriores)' : fechaHora(h.closedAt)}</div>
                    <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>#{h.id} · desde {fechaHora(h.openedAt)}{h.closedBy ? ` · cerró ${h.closedBy}` : ''}</div>
                  </td>
                  <td style={{ padding: '0.85rem 1rem' }}><span className="mobile-label">Debía haber</span>{pesos(h.expectedCash)}</td>
                  <td style={{ padding: '0.85rem 1rem' }}><span className="mobile-label">Contado</span>{h.countedCash !== null ? pesos(h.countedCash) : h.type === 'normal' ? <small title="La cerró el sistema a las 23:59: nadie contó el efectivo">automático · sin arqueo</small> : '—'}</td>
                  <td style={{ padding: '0.85rem 1rem' }}><span className="mobile-label">Diferencia</span><Diferencia valor={h.difference} /></td>
                  <td style={{ padding: '0.85rem 1rem' }}><span className="mobile-label">Quedó</span>{h.countedCash === null ? '—' : pesos(h.countedCash - (h.withdrawn || 0))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <button onClick={verAnteriores} style={{ marginTop: '1.25rem', display: 'flex', alignItems: 'center', gap: '0.4rem', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
          {anteriores.abiertos ? <ChevronDown size={14} /> : <ChevronRight size={14} />} Cierres del sistema anterior
        </button>
        {anteriores.abiertos && (
          <div style={{ marginTop: '0.75rem', fontSize: '0.85rem' }}>
            {anteriores.lista.length === 0 && <p style={{ color: 'var(--text-muted)' }}>No hay.</p>}
            {anteriores.lista.map((c) => (
              <div key={c.id} style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', padding: '0.5rem 0', borderTop: '1px solid var(--glass-border)', color: 'var(--text-secondary)' }}>
                <span>{c.date}</span>
                <span>Ventas {pesos(c.salesTotal)} · Gastos {pesos(c.expensesTotal)} · Compras {pesos(c.purchasesTotal)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Cerrar caja: arqueo */}
      <Ventana abierta={cerrando} onCerrar={() => setCerrando(false)} eyebrow="Caja" titulo="Cerrar caja" ancho={520}>
        <form onSubmit={cerrar} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          <Fila etiqueta="Debe haber en el cajón" valor={pesos(esperado)} color="var(--accent-primary)" fuerte />
          <label style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            ¿Cuánto efectivo contaste?
            <NumericFormat autoFocus thousandSeparator="." decimalSeparator="," allowNegative={false} prefix="$" value={form.contado}
              onValueChange={(v) => setForm((f) => ({ ...f, contado: v.value }))} style={{ fontSize: '1.4rem', height: 56 }} placeholder="$0" />
          </label>
          {contado !== null && (
            <div style={{ padding: '0.9rem 1rem', border: '1px solid var(--glass-border)' }}>
              <Fila etiqueta="Diferencia" valor={<Diferencia valor={contado - esperado} />} />
            </div>
          )}
          <label style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            ¿Cuánto sacas del cajón? (consignación, caja fuerte…)
            <NumericFormat thousandSeparator="." decimalSeparator="," allowNegative={false} prefix="$" value={form.retirado}
              onValueChange={(v) => setForm((f) => ({ ...f, retirado: v.value }))} placeholder="$0" />
          </label>
          {contado !== null && <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>La próxima sesión arranca con <b>{pesos(Math.max(0, contado - retirado))}</b> en el cajón.</p>}
          <label style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            Notas (opcional)
            <textarea rows={2} value={form.notas} onChange={(e) => setForm((f) => ({ ...f, notas: e.target.value }))} placeholder="Ej. faltante por cambio mal dado" />
          </label>
          <button type="submit" className="btn-primary" disabled={guardando} style={{ height: 52 }}>{guardando ? 'Cerrando…' : 'Confirmar cierre'}</button>
        </form>
      </Ventana>

      {/* Ingreso o retiro de efectivo */}
      <Ventana abierta={!!movimiento} onCerrar={() => setMovimiento(null)} eyebrow="Caja" titulo={movimiento === 'retiro' ? 'Retiro de efectivo' : 'Ingreso de efectivo'} ancho={480}>
        <form onSubmit={registrarMovimiento} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            Monto
            <NumericFormat thousandSeparator="." decimalSeparator="," allowNegative={false} prefix="$" value={form.monto}
              onValueChange={(v) => setForm((f) => ({ ...f, monto: v.value }))} style={{ fontSize: '1.3rem', height: 52 }} placeholder="$0" />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            Motivo
            <input value={form.motivo} onChange={(e) => setForm((f) => ({ ...f, motivo: e.target.value }))}
              placeholder={movimiento === 'retiro' ? 'Ej. consignación en el banco' : 'Ej. base del cajón'} />
          </label>
          <button type="submit" className="btn-primary" disabled={guardando} style={{ height: 50 }}>{guardando ? 'Guardando…' : 'Registrar'}</button>
        </form>
      </Ventana>

      {/* Detalle de un cierre */}
      <Ventana abierta={!!detalle} onCerrar={() => setDetalle(null)} eyebrow="Cierre de caja"
        titulo={detalle ? (detalle.session.type === 'regularizacion' ? 'Regularización' : `Sesión #${detalle.session.id}`) : ''} ancho={640}>
        {detalle && (
          <div>
            <p style={{ color: 'var(--text-muted)', marginBottom: '1rem' }}>{fechaHora(detalle.session.openedAt)} → {fechaHora(detalle.session.closedAt)}</p>
            {detalle.session.notes && <p style={{ color: 'var(--text-secondary)', marginBottom: '1rem', lineHeight: 1.6 }}>{detalle.session.notes}</p>}
            <Fila etiqueta="Base al abrir" valor={pesos(detalle.session.initialCash)} />
            <Fila etiqueta="Debía haber" valor={pesos(detalle.session.expectedCash)} />
            <Fila etiqueta="Contado" valor={detalle.session.countedCash === null && detalle.session.type !== 'normal' ? '—' : detalle.session.countedCash === null ? 'Cierre automático de las 23:59 (sin arqueo)' : pesos(detalle.session.countedCash)} />
            <Fila etiqueta="Diferencia" valor={<Diferencia valor={detalle.session.difference} />} />
            <Fila etiqueta="Retirado al cerrar" valor={detalle.session.withdrawn === null ? '—' : pesos(detalle.session.withdrawn)} />
            {detalle.summary.byMethod.filter((m) => !m.isCash).map((m) => <Fila key={m.method} etiqueta={m.method} valor={conSigno(m.total)} color="var(--info)" />)}
            <div style={{ marginTop: '1.25rem', maxHeight: 360, overflowY: 'auto' }}><Movimientos lista={detalle.summary.movements || []} /></div>
          </div>
        )}
      </Ventana>
    </div>
  );
};

export default CashRegister;
