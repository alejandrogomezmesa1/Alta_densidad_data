import React, { useEffect, useMemo, useState } from 'react';
import { FileDown } from 'lucide-react';
import Ventana from './Ventana';
import { api } from '../services/api';
import { calcularLista, generarListaRevendedores } from '../utils/listaRevendedores';
import { CONFIG_DEFECTO, pesos } from '../utils/inventario';

// Ventana para sacar el PDF de precios para revendedores: qué líneas van y si salen los agotados.
// El descuento y el margen mínimo se cambian en Configuraciones.
const ListaRevendedores = ({ abierta, onCerrar, notify, config }) => {
  const [productos, setProductos] = useState(null);
  const [categorias, setCategorias] = useState(['1.1']);
  const [incluirAgotados, setIncluirAgotados] = useState(true);
  const [generando, setGenerando] = useState(false);
  const c = { ...CONFIG_DEFECTO, ...config };

  useEffect(() => {
    if (abierta && !productos) api.get('/products').then(setProductos).catch((e) => notify?.(e.message, 'error'));
  }, [abierta, productos, notify]);

  const lineas = useMemo(() => [...new Set((productos || []).filter((p) => (p.type || 'terminado') === 'terminado' && Number(p.price) > 0).map((p) => p.category))].sort(), [productos]);
  const vista = useMemo(() => (productos ? calcularLista(productos, { categorias, incluirAgotados, config }) : null), [productos, categorias, incluirAgotados, config]);

  const generar = async () => {
    setGenerando(true);
    try {
      const r = await generarListaRevendedores(productos, { categorias, incluirAgotados, config });
      notify?.(`PDF listo: ${r.total} perfumes${r.fuera.length ? ` · ${r.fuera.length} fuera por precio menor que su costo` : ''}`, r.fuera.length ? 'warning' : 'success');
    } catch (e) {
      notify?.(`No se pudo generar el PDF: ${e.message}`, 'error');
    } finally {
      setGenerando(false);
    }
  };

  return (
    <Ventana abierta={abierta} onCerrar={onCerrar} eyebrow="Revendedores" titulo="Lista de precios para revendedores" ancho={620}>
      {!vista ? <p style={{ color: 'var(--text-muted)' }}>Cargando precios…</p> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          <p style={{ color: 'var(--text-secondary)', lineHeight: 1.6 }}>
            <b>Precio del revendedor</b> = precio al público − {c.revendedor_descuento} %, redondeado a $1.000, y nunca menos que el costo + {c.revendedor_margen_minimo} %.
            Estos dos valores se cambian en Configuraciones.
          </p>
          <div>
            <span className="paso">Líneas que van en la lista</span>
            <div className="chips">
              {lineas.map((l) => (
                <button key={l} className={`chip${categorias.includes(l) ? ' active' : ''}`}
                  onClick={() => setCategorias((x) => (x.includes(l) ? x.filter((y) => y !== l) : [...x, l]))}>{l}</button>
              ))}
            </div>
          </div>
          <div className="chips">
            <button className={`chip${incluirAgotados ? ' active' : ''}`} onClick={() => setIncluirAgotados(true)}>Incluir agotados</button>
            <button className={`chip${!incluirAgotados ? ' active' : ''}`} onClick={() => setIncluirAgotados(false)}>Solo con stock</button>
          </div>
          <div style={{ padding: '0.9rem 1rem', border: '1px solid var(--glass-border)', fontSize: '0.9rem', lineHeight: 1.7 }}>
            <div><b>{vista.filas.length}</b> perfumes en la lista{vista.alPiso ? ` · ${vista.alPiso} subidos al margen mínimo` : ''}</div>
            {vista.sinCosto > 0 && <div style={{ color: 'var(--warning)' }}>{vista.sinCosto} sin costo cargado: su precio no se pudo comparar con el costo</div>}
            {vista.fuera.map((f) => <div key={f.nombre} style={{ color: 'var(--error)' }}>Fuera: {f.nombre} (público {pesos(f.publico)}, costo {pesos(f.costo)})</div>)}
          </div>
          <button className="btn-primary" onClick={generar} disabled={generando || !vista.filas.length} style={{ height: 52, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.6rem' }}>
            <FileDown size={18} /> {generando ? 'Generando…' : 'Descargar PDF'}
          </button>
        </div>
      )}
    </Ventana>
  );
};

export default ListaRevendedores;
