import React, { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, XCircle, AlertTriangle, Lock, Unlock, Download, RotateCcw, ChevronDown, ChevronRight, ShieldCheck } from 'lucide-react';
import { api } from '../services/api';
import { pesos, hoyBogota } from '../utils/inventario';

// Contabilidad: estado de resultados por mes, salud contable, cierres de periodo, bitácora de
// auditoría y libros en Excel. Todo lo calcula el servidor (backend/contabilidad.js).

const PESTANAS = [
  ['resultados', 'Resultados'], ['salud', 'Salud contable'], ['cierres', 'Cierres de mes'], ['auditoria', 'Auditoría'], ['libros', 'Libros']
];
const mesActual = () => hoyBogota().slice(0, 7);
const nombreMes = (p) => {
  const [y, m] = p.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('es-CO', { month: 'long', year: 'numeric' });
};
const fechaHora = (v) => (v ? new Date(String(v).replace(' ', 'T')).toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' }) : '');

const Linea = ({ etiqueta, valor, fuerte, signo, nivel = 0, nota }) => (
  <div className={`conta-linea${fuerte ? ' fuerte' : ''}`} style={{ paddingLeft: nivel * 18 }}>
    <span>{etiqueta}{nota && <small> · {nota}</small>}</span>
    <span style={{ color: valor < 0 ? 'var(--error)' : undefined }}>{signo === '-' && valor > 0 ? `(${pesos(valor)})` : pesos(valor)}</span>
  </div>
);

// ── Resultados ──
function Resultados({ notify }) {
  const [periodo, setPeriodo] = useState(mesActual());
  const [r, setR] = useState(null);
  useEffect(() => {
    setR(null);
    api.get(`/contabilidad/resultados?periodo=${periodo}`).then(setR).catch((e) => notify?.(e.message, 'error'));
  }, [periodo, notify]);
  return (
    <>
      <div className="conta-barra">
        <label>Mes <input type="month" value={periodo} max={mesActual()} onChange={(e) => e.target.value && setPeriodo(e.target.value)} /></label>
        {periodo === mesActual() && <span className="conta-nota">Mes en curso: las cifras cambian hasta que termine.</span>}
      </div>
      {!r ? <p className="conta-nota">Calculando…</p> : (
        <div className="dash-grid dash-2">
          <section className="premium-card">
            <h4 className="conta-titulo">Estado de resultados · {nombreMes(periodo)}</h4>
            <Linea etiqueta="Ventas brutas" nota={`${r.ventas.n} ventas`} valor={r.ventas.brutas} />
            {r.ventas.anulacionesAnteriores > 0 && <Linea etiqueta="Anulaciones de meses anteriores" nota={`${r.ventas.anulacionesN}`} valor={r.ventas.anulacionesAnteriores} signo="-" nivel={1} />}
            <Linea etiqueta="Ventas netas" valor={r.ventas.netas} fuerte />
            <Linea etiqueta="Costo de ventas" valor={r.costoVentas.neto} signo="-" />
            <Linea etiqueta="Utilidad bruta" nota={`margen ${r.margenBruto} %`} valor={r.utilidadBruta} fuerte />
            <Linea etiqueta="Gastos operativos" valor={r.gastos.total} signo="-" />
            {r.gastos.porCategoria.map((g) => <Linea key={g.categoria} etiqueta={g.categoria} nota={`${g.n}`} valor={g.total} nivel={1} />)}
            {r.gastos.anulacionesAnteriores > 0 && <Linea etiqueta="Gastos anulados de meses anteriores" valor={-r.gastos.anulacionesAnteriores} nivel={1} />}
            <Linea etiqueta="Ajustes de inventario (faltantes − sobrantes)" valor={r.ajustesInventario.neto} signo="-" />
            <Linea etiqueta="Utilidad operativa" valor={r.utilidadOperativa} fuerte />
            <p className="conta-nota" style={{ marginTop: '1rem' }}>
              Base de causación: cada venta, gasto y compra cuenta en el mes de su fecha; si se anula en un mes posterior, ese mes la resta.
              El costo de ventas es el costo promedio de cada producto en el momento de venderlo.
            </p>
          </section>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            <section className="premium-card">
              <h4 className="conta-titulo">Dinero del mes</h4>
              {r.dinero ? r.dinero.porMetodo.map((m) => (
                <div key={m.metodo} className="conta-linea">
                  <span>{m.metodo}{m.efectivo && !/efectivo/i.test(m.metodo) ? ' (efectivo)' : ''}</span>
                  <span>+{pesos(m.entradas)} · −{pesos(m.salidas)} = <b>{pesos(m.neto)}</b></span>
                </div>
              )) : <p className="conta-nota">Sin caja por sesiones todavía.</p>}
              {r.dinero && <Linea etiqueta="Flujo neto del mes" valor={r.dinero.neto} fuerte />}
            </section>
            <section className="premium-card">
              <h4 className="conta-titulo">Al cierre del mes</h4>
              <Linea etiqueta="Cartera (lo que deben los clientes)" nota={`${r.cartera.ventas} venta${r.cartera.ventas === 1 ? '' : 's'}`} valor={r.cartera.saldo} />
              <Linea etiqueta="Inventario al inicio" valor={r.inventario.inicial?.valor || 0} nota={r.inventario.inicial?.aproximado ? 'aproximado' : null} />
              <Linea etiqueta="Compras del mes" valor={r.compras.neto} nota={`${r.compras.n}`} />
              <Linea etiqueta="Inventario al cierre (a costo)" valor={r.inventario.final?.valor || 0} nota={r.inventario.final?.aproximado ? 'aproximado' : null} fuerte />
              {(r.inventario.final?.aproximado || r.inventario.inicial?.aproximado) && (
                <p className="conta-nota">«Aproximado»: antes del 25-10-2026 el sistema no guardaba el costo promedio de cada movimiento; para esas fechas se usa el costo actual.</p>
              )}
            </section>
            <section className="premium-card">
              <h4 className="conta-titulo">Ventas por canal</h4>
              {r.ventas.porOrigen.map((o) => <Linea key={o.origen} etiqueta={o.origen === 'web' ? 'Tienda web' : 'Punto de venta'} nota={`${o.n}`} valor={o.total} />)}
            </section>
          </div>
        </div>
      )}
    </>
  );
}

// ── Salud contable ──
function Salud({ notify }) {
  const [s, setS] = useState(null);
  const cargar = useCallback(() => { setS(null); api.get('/contabilidad/salud').then(setS).catch((e) => notify?.(e.message, 'error')); }, [notify]);
  useEffect(() => { cargar(); }, [cargar]);
  return (
    <section className="premium-card">
      <div className="conta-barra" style={{ justifyContent: 'space-between' }}>
        <h4 className="conta-titulo" style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
          {s && (s.ok ? <ShieldCheck size={18} color="var(--success)" /> : <XCircle size={18} color="var(--error)" />)}
          {s ? (s.ok ? 'La contabilidad cuadra' : 'Hay problemas que revisar') : 'Revisando…'}
        </h4>
        <button className="btn-secondary" onClick={cargar} style={{ display: 'flex', gap: 6, alignItems: 'center' }}><RotateCcw size={14} /> Revisar de nuevo</button>
      </div>
      {s?.controles.map((c) => (
        <div key={c.clave} className="conta-control">
          {c.ok ? <CheckCircle2 size={18} color="var(--success)" /> : c.nivel === 'critico' ? <XCircle size={18} color="var(--error)" /> : <AlertTriangle size={18} color="var(--warning)" />}
          <div>
            <b>{c.titulo}</b>
            <small>{c.detalle}</small>
          </div>
        </div>
      ))}
      <p className="conta-nota" style={{ marginTop: '1rem' }}>
        Rojo = la información no cuadra y hay que corregirlo antes de cerrar el mes. Amarillo = recomendación. Se revisa sola cada vez que abres esta pestaña.
      </p>
    </section>
  );
}

// ── Cierres de mes ──
function Cierres({ notify, confirm }) {
  const [lista, setLista] = useState(null);
  const [notas, setNotas] = useState('');
  const [motivo, setMotivo] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const cargar = useCallback(() => api.get('/contabilidad/periodos').then(setLista).catch((e) => notify?.(e.message, 'error')), [notify]);
  useEffect(() => { cargar(); }, [cargar]);

  const cerrados = (lista || []).filter((p) => p.estado === 'cerrado');
  const ultimo = cerrados[0];
  const [y, m] = mesActual().split('-').map(Number);
  const anterior = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
  const siguiente = ultimo ? (() => { const [a, b] = ultimo.periodo.split('-').map(Number); return b === 12 ? `${a + 1}-01` : `${a}-${String(b + 1).padStart(2, '0')}`; })() : anterior;
  const porCerrar = siguiente <= anterior ? siguiente : null;

  const cerrar = () => confirm?.(`¿Cerrar ${nombreMes(porCerrar)}? Desde ese momento nadie podrá registrar ni editar ventas, compras, gastos o abonos con fecha de ese mes o anterior.`, async () => {
    setOcupado(true);
    try { await api.post('/contabilidad/periodos', { periodo: porCerrar, notes: notas }); notify?.(`${nombreMes(porCerrar)} cerrado.`, 'success'); setNotas(''); cargar(); } catch (e) { notify?.(e.message, 'error'); } finally { setOcupado(false); }
  });
  const reabrir = () => confirm?.(`¿Reabrir ${nombreMes(ultimo.periodo)}? Queda registrado en la auditoría con el motivo y la foto que tenía.`, async () => {
    setOcupado(true);
    try { await api.post(`/contabilidad/periodos/${ultimo.periodo}/reabrir`, { reason: motivo }); notify?.('Mes reabierto.', 'info'); setMotivo(''); cargar(); } catch (e) { notify?.(e.message, 'error'); } finally { setOcupado(false); }
  });

  return (
    <div className="dash-grid dash-2">
      <section className="premium-card">
        <h4 className="conta-titulo">Cerrar un mes</h4>
        <p className="conta-nota" style={{ marginBottom: '1rem' }}>
          Cerrar un mes guarda la foto de sus cifras con una huella digital y bloquea los documentos con fecha de ese mes.
          Se cierra en orden, cuando el mes ya terminó y la salud contable no tiene problemas. Lo que se anule después cuenta en el mes en que se anula.
        </p>
        {porCerrar ? (
          <>
            <label className="conta-campo">Notas del cierre (opcional)<input value={notas} onChange={(e) => setNotas(e.target.value)} placeholder="Ej. revisado con el contador" /></label>
            <button className="btn-primary" onClick={cerrar} disabled={ocupado} style={{ display: 'flex', gap: 8, alignItems: 'center' }}><Lock size={15} /> Cerrar {nombreMes(porCerrar)}</button>
          </>
        ) : <p><CheckCircle2 size={16} color="var(--success)" style={{ verticalAlign: -3 }} /> Todos los meses terminados están cerrados.</p>}
        {ultimo && (
          <div style={{ marginTop: '1.75rem', paddingTop: '1.25rem', borderTop: '1px solid var(--glass-border)' }}>
            <h4 className="conta-titulo">Reabrir {nombreMes(ultimo.periodo)}</h4>
            <p className="conta-nota" style={{ marginBottom: '0.75rem' }}>Solo el último mes cerrado, con un motivo. Úsalo para corregir un error antes de volver a cerrarlo.</p>
            <label className="conta-campo">Motivo<input value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ej. faltó registrar la factura del proveedor X" /></label>
            <button className="btn-secondary" onClick={reabrir} disabled={ocupado || motivo.trim().length < 10} style={{ display: 'flex', gap: 8, alignItems: 'center' }}><Unlock size={15} /> Reabrir</button>
          </div>
        )}
      </section>
      <section className="premium-card">
        <h4 className="conta-titulo">Historial de cierres</h4>
        {lista && !lista.length && <p className="conta-nota">Todavía no se ha cerrado ningún mes.</p>}
        {(lista || []).map((p) => (
          <div key={p.periodo} className="conta-periodo">
            <div>
              <b style={{ textTransform: 'capitalize' }}>{nombreMes(p.periodo)}</b>
              <small>
                {p.estado === 'cerrado' ? `Cerrado ${fechaHora(p.cerrado_en)}${p.cerrado_por ? ` por ${p.cerrado_por}` : ''}` : `Reabierto ${fechaHora(p.reabierto_en)}: ${p.motivo_reapertura}`}
              </small>
              <small title={p.hash}>{p.verificado ? '✓ Foto íntegra' : '✗ La foto no coincide con su huella'} · huella {p.hash.slice(0, 12)}…</small>
            </div>
            {p.resumen && (
              <div style={{ textAlign: 'right' }}>
                <small>Ventas netas {pesos(p.resumen.ventas.netas)}</small>
                <b>Utilidad {pesos(p.resumen.utilidadOperativa)}</b>
              </div>
            )}
          </div>
        ))}
      </section>
    </div>
  );
}

// ── Auditoría ──
const ENTIDADES = { '': 'Todo', venta: 'Ventas', compra: 'Compras', recepcion: 'Recepciones', gasto: 'Gastos', producto: 'Productos', inventario: 'Ajustes', conteo: 'Conteos', caja: 'Caja', cliente: 'Clientes', proveedor: 'Proveedores', kit: 'Kits', recetas: 'Recetas', configuracion: 'Configuración', periodo: 'Cierres de mes' };

function Diferencias({ antes, despues }) {
  let a = null; let d = null;
  try { a = antes ? JSON.parse(antes) : null; } catch { a = antes; }
  try { d = despues ? JSON.parse(despues) : null; } catch { d = despues; }
  const plano = (o) => (o && typeof o === 'object' && !Array.isArray(o) ? o : null);
  if (plano(a) && plano(d)) {
    const claves = [...new Set([...Object.keys(a), ...Object.keys(d)])].filter((k) => JSON.stringify(a[k]) !== JSON.stringify(d[k]));
    return (
      <table className="conta-diff">
        <thead><tr><th>Campo</th><th>Antes</th><th>Después</th></tr></thead>
        <tbody>{claves.map((k) => <tr key={k}><td>{k}</td><td>{JSON.stringify(a[k])}</td><td>{JSON.stringify(d[k])}</td></tr>)}</tbody>
      </table>
    );
  }
  return <pre className="conta-json">{JSON.stringify({ antes: a, despues: d }, null, 2)}</pre>;
}

function Auditoria({ notify }) {
  const [filtro, setFiltro] = useState({ entidad: '', q: '', desde: '', hasta: '' });
  const [pagina, setPagina] = useState(1);
  const [datos, setDatos] = useState(null);
  const [abierto, setAbierto] = useState(null);
  useEffect(() => {
    const p = new URLSearchParams({ ...Object.fromEntries(Object.entries(filtro).filter(([, v]) => v)), pagina });
    api.get(`/contabilidad/auditoria?${p}`).then(setDatos).catch((e) => notify?.(e.message, 'error'));
  }, [filtro, pagina, notify]);
  const cambiar = (k, v) => { setFiltro((f) => ({ ...f, [k]: v })); setPagina(1); };
  const paginas = datos ? Math.max(1, Math.ceil(datos.total / 50)) : 1;
  return (
    <section className="premium-card" style={{ padding: 0 }}>
      <div className="conta-filtros">
        <select value={filtro.entidad} onChange={(e) => cambiar('entidad', e.target.value)}>{Object.entries(ENTIDADES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        <input value={filtro.q} onChange={(e) => cambiar('q', e.target.value)} placeholder="Buscar en la descripción o el usuario…" />
        <input type="date" value={filtro.desde} onChange={(e) => cambiar('desde', e.target.value)} aria-label="Desde" />
        <input type="date" value={filtro.hasta} onChange={(e) => cambiar('hasta', e.target.value)} aria-label="Hasta" />
      </div>
      {datos && !datos.registros.length && <p className="conta-nota" style={{ padding: '1.5rem' }}>Sin registros con estos filtros.</p>}
      {datos?.registros.map((r) => (
        <div key={r.id} className="conta-registro">
          <button className="conta-registro-cabeza" onClick={() => setAbierto(abierto === r.id ? null : r.id)}>
            {abierto === r.id ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
            <span className="conta-registro-fecha">{fechaHora(r.creado_en)}</span>
            <span className={`conta-accion conta-accion--${r.accion}`}>{r.accion}</span>
            <span className="conta-registro-resumen">{r.resumen}</span>
            <span className="conta-registro-usuario">{r.usuario || 'sistema'}</span>
          </button>
          {abierto === r.id && (
            <div className="conta-registro-detalle">
              <Diferencias antes={r.antes} despues={r.despues} />
              <small>Registro #{r.id} · huella {r.hash}</small>
            </div>
          )}
        </div>
      ))}
      {datos && datos.total > 50 && (
        <div className="conta-barra" style={{ padding: '1rem 1.25rem', justifyContent: 'space-between' }}>
          <span className="conta-nota">{datos.total} registros · página {pagina} de {paginas}</span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn-secondary" disabled={pagina <= 1} onClick={() => setPagina(pagina - 1)}>Anterior</button>
            <button className="btn-secondary" disabled={pagina >= paginas} onClick={() => setPagina(pagina + 1)}>Siguiente</button>
          </div>
        </div>
      )}
    </section>
  );
}

// ── Libros ──
function Libros({ notify }) {
  const [periodo, setPeriodo] = useState(mesActual());
  const [libros, setLibros] = useState([]);
  const [bajando, setBajando] = useState('');
  useEffect(() => { api.get('/contabilidad/libros').then(setLibros).catch(() => {}); }, []);
  const bajar = async (l) => {
    setBajando(l.clave);
    try { await api.descargar(`/contabilidad/exportar?libro=${l.clave}&periodo=${periodo}`, `${l.clave}_${periodo}.csv`); } catch (e) { notify?.(e.message, 'error'); } finally { setBajando(''); }
  };
  const respaldo = async () => {
    setBajando('respaldo');
    try { await api.descargar('/contabilidad/respaldo', `respaldo-data_${hoyBogota()}.json`); notify?.('Respaldo descargado: guárdalo fuera de este computador.', 'success'); } catch (e) { notify?.(e.message, 'error'); } finally { setBajando(''); }
  };
  return (
    <section className="premium-card">
      <div className="conta-barra">
        <label>Mes <input type="month" value={periodo} max={mesActual()} onChange={(e) => e.target.value && setPeriodo(e.target.value)} /></label>
        <span className="conta-nota">Archivos CSV que abren directo en Excel (separador «;», tildes y ñ correctas). Para entregar al contador.</span>
      </div>
      <div className="conta-libros">
        <button className="conta-libro" onClick={respaldo} disabled={Boolean(bajando)}>
          <ShieldCheck size={16} />
          <span><b>Respaldo completo de la base</b> · todas las tablas en un archivo; guárdalo fuera del computador (Drive, correo)</span>
          <small>{bajando === 'respaldo' ? 'Preparando…' : `respaldo-data_${hoyBogota()}.json`}</small>
        </button>
        {libros.map((l) => (
          <button key={l.clave} className="conta-libro" onClick={() => bajar(l)} disabled={Boolean(bajando)}>
            <Download size={16} />
            <span>{l.nombre}</span>
            <small>{bajando === l.clave ? 'Descargando…' : `${l.clave}_${periodo}.csv`}</small>
          </button>
        ))}
      </div>
    </section>
  );
}

const Contabilidad = ({ notify, confirm }) => {
  const [pestana, setPestana] = useState('resultados');
  return (
    <div className="main-content">
      <header className="page-header">
        <div>
          <h2 className="title-gradient" style={{ fontSize: '2.5rem', marginBottom: '0.25rem' }}>Contabilidad</h2>
          <p style={{ color: 'var(--text-secondary)' }}>Resultados por mes, controles de integridad, cierres y auditoría de cada cambio.</p>
        </div>
      </header>
      <div className="chips" style={{ marginBottom: '1.5rem' }}>
        {PESTANAS.map(([k, t]) => <button key={k} className={`chip${pestana === k ? ' active' : ''}`} onClick={() => setPestana(k)}>{t}</button>)}
      </div>
      {pestana === 'resultados' && <Resultados notify={notify} />}
      {pestana === 'salud' && <Salud notify={notify} />}
      {pestana === 'cierres' && <Cierres notify={notify} confirm={confirm} />}
      {pestana === 'auditoria' && <Auditoria notify={notify} />}
      {pestana === 'libros' && <Libros notify={notify} />}
    </div>
  );
};

export default Contabilidad;
