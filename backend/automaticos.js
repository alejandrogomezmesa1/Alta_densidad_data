// ============================================================
// Cierres automáticos: caja diaria y mes contable a las 23:59
// (Hora de Colombia, UTC-5)
// ------------------------------------------------------------
// - Caja diaria: si a las 23:59 la caja tiene movimientos y nadie la cerró,
//   se cierra sola marcada «sin arqueo» y la siguiente arranca con el efectivo
//   que debía haber. Si se cerró antes contando el efectivo, se respeta ese cierre.
// - Mes contable: a las 23:59 del último día del mes, si la salud contable no tiene
//   problemas críticos, cierra el mes (y meses pendientes en orden) guardando su foto
//   y su huella digital SHA-256. Si hay problemas de integridad, no cierra y reintenta
//   cada hora, avisándolo en Contabilidad → Salud contable.
// - Candado: la tabla `tareas_automaticas` (migración 019) asegura que dos instancias
//   del servidor (o reinicios concurrentes) nunca ejecuten el mismo cierre dos veces.
// ============================================================
import { esquema } from './estado.js';
import { leerConfiguraciones } from './configuraciones.js';
import { sesionAbierta, resumenSesion, cerrarSesion } from './caja.js';
import { cerrarPeriodo, mesesPendientes, limitesPeriodo } from './contabilidad.js';
import { auditar, fila } from './auditoria.js';

// Hora oficial de Colombia (UTC-5 sin horario de verano)
const ahoraLocal = () => new Date(Date.now() - 5 * 3600 * 1000).toISOString().replace('T', ' ').slice(0, 19);
const hoyLocal = () => ahoraLocal().slice(0, 10);

const USUARIO_AUTOMATICO = { id: null, nombre: 'Cierre automático (23:59)' };

/**
 * Ejecuta una tarea protegida por candado en `tareas_automaticas`.
 * Garantiza idempotencia y previene colisiones entre múltiples instancias.
 */
export async function conCandado(db, clave, tipo, fn) {
    let yaRegistrada = false;
    try {
        await db.query(
            "INSERT INTO tareas_automaticas (clave, tipo, ejecutada_en, ok, detalle) VALUES (?, ?, NOW(), NULL, 'En curso')",
            [clave, tipo]
        );
    } catch (e) {
        if (e.code === 'ER_DUP_ENTRY') {
            yaRegistrada = true;
            const [[prev]] = await db.query('SELECT ok, ejecutada_en, detalle FROM tareas_automaticas WHERE clave = ?', [clave]);
            if (prev?.ok === 1) {
                return { omitido: true, razon: 'ya_completada', detalle: prev.detalle };
            }
            if (prev?.ok === 0) {
                // Reintento: esperar al menos 45 minutos desde el último intento fallido
                const ejecutadaMs = new Date(String(prev.ejecutada_en).replace(' ', 'T') + '-05:00').getTime();
                const transcurrido = Date.now() - (Number.isFinite(ejecutadaMs) ? ejecutadaMs : Date.now());
                if (transcurrido < 45 * 60 * 1000) {
                    return { omitido: true, razon: 'esperando_reintento', detalle: prev.detalle };
                }
                await db.query("UPDATE tareas_automaticas SET ok = NULL, detalle = 'Reintentando...', ejecutada_en = NOW() WHERE clave = ?", [clave]);
            } else if (prev?.ok === null) {
                // Posible tarea colgada: permitir retomar si pasaron más de 5 minutos
                const ejecutadaMs = new Date(String(prev.ejecutada_en).replace(' ', 'T') + '-05:00').getTime();
                const transcurrido = Date.now() - (Number.isFinite(ejecutadaMs) ? ejecutadaMs : Date.now());
                if (transcurrido < 5 * 60 * 1000) {
                    return { omitido: true, razon: 'en_curso' };
                }
                await db.query("UPDATE tareas_automaticas SET ejecutada_en = NOW(), detalle = 'Tomando tarea previa colgada' WHERE clave = ?", [clave]);
            }
        } else {
            throw e;
        }
    }

    try {
        const resultado = await fn();
        const detalle = String(resultado?.detalle || 'Completada con éxito').slice(0, 500);
        await db.query(
            'UPDATE tareas_automaticas SET ok = 1, detalle = ?, ejecutada_en = NOW() WHERE clave = ?',
            [detalle, clave]
        );
        return { ok: true, resultado };
    } catch (err) {
        const detalleError = String(err.message || 'Error desconocido').slice(0, 500);
        await db.query(
            'UPDATE tareas_automaticas SET ok = 0, detalle = ?, ejecutada_en = NOW() WHERE clave = ?',
            [detalleError, clave]
        ).catch(() => {});
        throw err;
    }
}

/**
 * Cierre automático de caja para una fecha dada (YYYY-MM-DD).
 */
export async function cerrarCajaAuto(db, fecha) {
    const clave = `caja_${fecha}`;
    return conCandado(db, clave, 'caja', async () => {
        const conn = await db.getConnection();
        try {
            await conn.beginTransaction();
            const sesion = await sesionAbierta(conn, { bloquear: true });
            const resumen = await resumenSesion(conn, sesion);

            // Si nadie operó en esta sesión, no se crea un cierre vacío
            if (resumen.movementCount === 0) {
                await conn.commit();
                return { detalle: 'Sin movimientos en la sesión actual; no requiere cierre', cerrado: false };
            }

            const cierre = await cerrarSesion(conn, {
                sesionId: sesion.id,
                automatico: true,
                notas: 'Cierre automático de las 23:59 (sin arqueo)'
            });

            await auditar(conn, {
                accion: 'cerrar',
                entidad: 'caja',
                entidadId: cierre.closedId,
                resumen: `Cierre automático de caja #${cierre.closedId} (23:59, sin arqueo): esperado $${Math.round(cierre.expectedCash).toLocaleString('es-CO')}`,
                despues: {
                    ...cierre,
                    retirado: 0,
                    notas: 'Cierre automático de las 23:59 (sin arqueo)',
                    sesion: await fila(conn, 'sesiones_caja', cierre.closedId)
                },
                usuario: USUARIO_AUTOMATICO
            });

            await conn.commit();
            return {
                cerrado: true,
                detalle: `Caja #${cierre.closedId} cerrada automáticamente (${resumen.movementCount} movimientos, esperado $${Math.round(cierre.expectedCash).toLocaleString('es-CO')})`,
                cierre
            };
        } catch (err) {
            await conn.rollback().catch(() => {});
            throw err;
        } finally {
            conn.release();
        }
    });
}

/**
 * Cierre automático de un periodo contable mensual (AAAA-MM).
 */
export async function cerrarPeriodoAuto(db, periodo) {
    const clave = `mes_${periodo}`;
    return conCandado(db, clave, 'mes', async () => {
        const conn = await db.getConnection();
        try {
            await conn.beginTransaction();
            const r = await cerrarPeriodo(conn, periodo, {
                automatico: true,
                usuario: USUARIO_AUTOMATICO,
                notas: 'Cierre contable automático de las 23:59'
            });
            await conn.commit();
            return {
                periodo,
                hash: r.hash,
                detalle: `Mes ${periodo} cerrado con foto y huella (${r.hash.slice(0, 12)}…)`
            };
        } catch (err) {
            await conn.rollback().catch(() => {});
            throw err;
        } finally {
            conn.release();
        }
    });
}

const diaAnterior = (fecha) => {
    const d = new Date(`${fecha}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() - 1);
    return d.toISOString().slice(0, 10);
};

/**
 * Recuperación: si el cierre de las 23:59 de ayer no se hizo (servidor caído o reiniciando justo en ese
 * minuto) y la caja abierta viene de antes de hoy, se cierra ahora con la clave de ayer (una sola vez).
 */
async function recuperarCajaAtrasada(db, fecha) {
    const ayer = diaAnterior(fecha);
    const [[tarea]] = await db.query('SELECT ok FROM tareas_automaticas WHERE clave = ?', [`caja_${ayer}`]);
    if (tarea?.ok === 1) return null;
    const [[s]] = await db.query("SELECT id FROM sesiones_caja WHERE abierta = 1 AND abierta_en < ?", [`${fecha} 00:00:00`]);
    if (!s) return null;
    return cerrarCajaAuto(db, ayer);
}

/**
 * Revisa si corresponde ejecutar cierres de caja o de mes contable en este instante.
 * @param {object} db pool de MySQL
 * @param {{ forzar?: boolean }} opciones Si true, cierra ya los meses terminados que estén pendientes
 *   (la caja nunca se fuerza: se cierra a las 23:59 o, si ese cierre no se hizo, en la recuperación)
 */
export async function revisarCierres(db, { forzar = false } = {}) {
    if (!esquema.automaticos) return { ejecutado: false, razon: 'migracion_pendiente' };

    const ahora = ahoraLocal();
    const fecha = ahora.slice(0, 10);
    const hora = ahora.slice(11, 16);
    const minuto = ahora.slice(14, 16);

    const configs = await leerConfiguraciones(db);
    const resultado = { fecha, hora, caja: null, mes: null };

    // ── 1. Cierre diario de caja ──
    // A las 23:59 hora de Colombia el cierre del día; el resto del tiempo solo la recuperación del cierre
    // de ayer si no se hizo (casi siempre no hace nada)
    if (configs.cierre_automatico_caja !== false && esquema.caja) {
        try {
            resultado.caja = hora === '23:59' ? await cerrarCajaAuto(db, fecha) : await recuperarCajaAtrasada(db, fecha);
            if (resultado.caja?.resultado?.cerrado) {
                console.log(`[CIERRES AUTOMÁTICOS] ${resultado.caja.resultado.detalle}`);
            }
        } catch (e) {
            resultado.caja = { error: e.message };
            console.error(`[CIERRES AUTOMÁTICOS] Error en cierre de caja (${fecha}):`, e.message);
        }
    }

    // ── 2. Cierre contable mensual ──
    // Se ejecuta a las 23:59 del último día del mes, o en el reintento horario (minuto 59 de cada hora)
    if (configs.cierre_automatico_mes !== false && esquema.trazabilidad) {
        const [y, m] = fecha.split('-').map(Number);
        const periodoActual = fecha.slice(0, 7);
        const { hasta } = limitesPeriodo(periodoActual);
        const esUltimoDia = fecha === hasta;

        let limite = null;
        if (esUltimoDia && hora === '23:59') {
            // Último día a las 23:59: incluye el mes que termina hoy
            limite = periodoActual;
        } else if (minuto === '59' || forzar) {
            // Reintento cada hora: solo meses que ya terminaron (hasta el mes anterior)
            const mesAnterior = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
            limite = mesAnterior;
        }

        if (limite) {
            const pendientes = await mesesPendientes(db, limite).catch(() => []);
            if (pendientes.length > 0) {
                resultado.mes = [];
                for (const p of pendientes) {
                    try {
                        const r = await cerrarPeriodoAuto(db, p);
                        resultado.mes.push({ periodo: p, ...r });
                        if (r?.resultado?.hash) {
                            console.log(`[CIERRES AUTOMÁTICOS] ${r.resultado.detalle}`);
                        }
                        if (r?.omitido && r.razon === 'esperando_reintento') {
                            break;
                        }
                    } catch (e) {
                        resultado.mes.push({ periodo: p, error: e.message });
                        console.warn(`[CIERRES AUTOMÁTICOS] No se pudo cerrar el mes ${p}:`, e.message);
                        break; // Los meses se cierran en orden: si uno falla, no intentar el siguiente
                    }
                }
            }
        }
    }

    return resultado;
}

let timer = null;

/**
 * Arranca el servicio en segundo plano para revisar cierres cada 30 segundos.
 */
export function iniciarCierresAutomaticos(db) {
    if (timer) clearInterval(timer);

    // Revisión inicial a los 5 segundos tras arrancar
    setTimeout(() => {
        revisarCierres(db).catch((e) => console.error('[CIERRES AUTOMÁTICOS] Error en revisión inicial:', e.message));
    }, 5000).unref();

    // Ciclo periódico cada 30 segundos
    timer = setInterval(() => {
        revisarCierres(db).catch((e) => console.error('[CIERRES AUTOMÁTICOS] Error en ciclo periódico:', e.message));
    }, 30000);
    timer.unref();

    console.log('[CIERRES AUTOMÁTICOS] Servicio activo: caja diaria y cierres de mes a las 23:59 (hora de Colombia)');
}
