// Ventana emergente común del panel: los formularios (crear o editar producto, venta, compra,
// gasto, proveedor, kit…) se abren encima de la página, no desplegados dentro de ella.
// Cierra con Escape, con la X o haciendo clic fuera; bloquea el scroll de la página mientras
// está abierta y enfoca el primer campo. El contenido se desplaza por dentro si es largo.
import React, { useEffect, useRef } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { X } from 'lucide-react';

const Ventana = ({ abierta, onCerrar, eyebrow, titulo, ancho = 720, children }) => {
  const caja = useRef(null);
  const cerrar = useRef(onCerrar);
  cerrar.current = onCerrar;

  useEffect(() => {
    if (!abierta) return undefined;
    const previo = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e) => { if (e.key === 'Escape') cerrar.current?.(); };
    document.addEventListener('keydown', onKey);
    // Con un formulario abierto, salir del panel (atrás, recargar, cerrar la pestaña) pide confirmar
    const antesDeSalir = (e) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', antesDeSalir);
    // Primer campo editable, después de la animación de entrada
    const t = setTimeout(() => {
      const campo = caja.current?.querySelector('input:not([type=hidden]):not([readonly]):not([disabled]), select, textarea');
      campo?.focus();
    }, 120);
    return () => {
      document.body.style.overflow = previo;
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('beforeunload', antesDeSalir);
      clearTimeout(t);
    };
  }, [abierta]);

  return (
    <AnimatePresence>
      {abierta && (
        <motion.div
          className="ventana-fondo"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }}
          // mousedown: arrastrar para seleccionar texto y soltar fuera no cierra la ventana
          onMouseDown={(e) => { if (e.target === e.currentTarget) onCerrar?.(); }}
        >
          <motion.div
            ref={caja}
            className="ventana premium-card"
            style={{ maxWidth: ancho }}
            initial={{ y: 16, opacity: 0, scale: 0.98 }} animate={{ y: 0, opacity: 1, scale: 1 }} exit={{ y: 10, opacity: 0, scale: 0.98 }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            role="dialog" aria-modal="true" aria-label={titulo}
          >
            <header className="ventana-cab">
              <div>
                {eyebrow && <span className="up ventana-eyebrow">{eyebrow}</span>}
                <h3>{titulo}</h3>
              </div>
              <button type="button" className="btn-icon" onClick={onCerrar} aria-label="Cerrar"><X size={16} /></button>
            </header>
            <div className="ventana-cuerpo">{children}</div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default Ventana;
