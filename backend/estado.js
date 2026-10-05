// Qué partes del esquema están disponibles, según las migraciones aplicadas al arrancar.
// Si una migración falla, la función que depende de ella se desactiva y el resto sigue.
export const esquema = {
    integracion: false,      // 003: ventas web
    marcasCierre: false,     // 004: marcas de cierre de caja
    inventarioTipos: false,  // 005: tipo, unidad, activo
    libro: false,            // 006: movimientos de inventario
    metodosPago: false,      // 007
    categoriasGasto: false,  // 008
    kits: false,             // 010: kits compuestos
    configuraciones: false,  // 011: módulo Configuraciones
    claseEsencia: false      // 012: esencia árabe / tradicional
};

export const actualizarEsquema = (aplicadas) => {
    esquema.integracion = aplicadas.has('003');
    esquema.marcasCierre = aplicadas.has('004');
    esquema.inventarioTipos = aplicadas.has('005');
    esquema.libro = aplicadas.has('006');
    esquema.metodosPago = aplicadas.has('007');
    esquema.categoriasGasto = aplicadas.has('008');
    esquema.kits = aplicadas.has('010');
    esquema.configuraciones = aplicadas.has('011');
    esquema.claseEsencia = aplicadas.has('012');
};
