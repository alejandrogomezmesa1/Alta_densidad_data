CREATE DATABASE IF NOT EXISTS alta_densidad_db;
USE alta_densidad_db;

-- 1. Tabla Proveedores (suppliers)
CREATE TABLE IF NOT EXISTS proveedores (
    id INT AUTO_INCREMENT PRIMARY KEY,
    nombre VARCHAR(255) NOT NULL,
    telefono VARCHAR(50),
    email VARCHAR(255),
    direccion TEXT,
    fecha_creacion DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 2. Tabla Productos (products)
CREATE TABLE IF NOT EXISTS productos (
    id INT AUTO_INCREMENT PRIMARY KEY,
    nombre VARCHAR(255) NOT NULL,
    categoria VARCHAR(100),
    precio DECIMAL(15, 2) DEFAULT 0.00,
    precio_costo DECIMAL(15, 2) DEFAULT 0.00,
    stock INT DEFAULT 0,
    fecha_creacion DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 3. Tabla Ventas (sales)
CREATE TABLE IF NOT EXISTS ventas (
    id INT AUTO_INCREMENT PRIMARY KEY,
    producto_id INT,
    cantidad INT NOT NULL,
    total DECIMAL(15, 2) NOT NULL,
    costo_al_vender DECIMAL(15, 2) NOT NULL,
    fecha DATETIME NOT NULL,
    nombre_cliente VARCHAR(255) DEFAULT 'Cliente General',
    estado ENUM('paid', 'pending') DEFAULT 'paid',
    metodo VARCHAR(50) DEFAULT 'Efectivo',
    FOREIGN KEY (producto_id) REFERENCES productos(id) ON DELETE SET NULL
);

-- 4. Tabla Pagos (payments)
CREATE TABLE IF NOT EXISTS pagos (
    id INT AUTO_INCREMENT PRIMARY KEY,
    venta_id INT,
    monto DECIMAL(15, 2) NOT NULL,
    fecha DATETIME NOT NULL,
    metodo VARCHAR(50) DEFAULT 'Efectivo',
    FOREIGN KEY (venta_id) REFERENCES ventas(id) ON DELETE CASCADE
);

-- 5. Tabla Compras (purchases)
CREATE TABLE IF NOT EXISTS compras (
    id INT AUTO_INCREMENT PRIMARY KEY,
    producto_id INT,
    proveedor_id INT,
    cantidad INT NOT NULL,
    monto DECIMAL(15, 2) NOT NULL,
    precio_unitario DECIMAL(15, 2) NOT NULL,
    fecha DATETIME NOT NULL,
    FOREIGN KEY (producto_id) REFERENCES productos(id) ON DELETE SET NULL,
    FOREIGN KEY (proveedor_id) REFERENCES proveedores(id) ON DELETE SET NULL
);

-- 6. Tabla Gastos (expenses)
CREATE TABLE IF NOT EXISTS gastos (
    id INT AUTO_INCREMENT PRIMARY KEY,
    descripcion VARCHAR(255) NOT NULL,
    monto DECIMAL(15, 2) NOT NULL,
    categoria VARCHAR(100),
    fecha DATETIME NOT NULL
);

-- 7. Tabla Cierres de Caja (cash_closings)
CREATE TABLE IF NOT EXISTS cierres_caja (
    id INT AUTO_INCREMENT PRIMARY KEY,
    fecha DATE NOT NULL,
    efectivo_inicial DECIMAL(15, 2) DEFAULT 0.00,
    efectivo_final DECIMAL(15, 2) DEFAULT 0.00,
    diferencia DECIMAL(15, 2) DEFAULT 0.00,
    total_ventas DECIMAL(15, 2) DEFAULT 0.00,
    total_compras DECIMAL(15, 2) DEFAULT 0.00,
    total_gastos DECIMAL(15, 2) DEFAULT 0.00,
    ganancia DECIMAL(15, 2) DEFAULT 0.00,
    notas TEXT,
    fecha_creacion DATETIME DEFAULT CURRENT_TIMESTAMP
);
