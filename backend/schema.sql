CREATE DATABASE IF NOT EXISTS alta_densidad_data;
USE alta_densidad_data;

-- 0. Tabla Usuarios (users)
CREATE TABLE IF NOT EXISTS usuarios (
    id INT AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(100) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL,
    fecha_creacion DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 1. Tabla Proveedores (suppliers)
CREATE TABLE IF NOT EXISTS proveedores (
    id INT AUTO_INCREMENT PRIMARY KEY,
    nombre VARCHAR(255) NOT NULL,
    telefono VARCHAR(50),
    email VARCHAR(255),
    direccion TEXT,
    fecha_creacion DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 2. Tabla Clientes (customers)
CREATE TABLE IF NOT EXISTS clientes (
    id INT AUTO_INCREMENT PRIMARY KEY,
    nombre VARCHAR(255) NOT NULL,
    cedula VARCHAR(50) NULL,
    telefono VARCHAR(50) NULL,
    ciudad VARCHAR(100) NULL,
    direccion VARCHAR(255) NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 3. Tabla Productos (products/inventory)
CREATE TABLE IF NOT EXISTS inventario (
    id INT AUTO_INCREMENT PRIMARY KEY,
    nombre VARCHAR(255) NOT NULL,
    categoria VARCHAR(100),
    precio DECIMAL(15, 2) DEFAULT 0.00,
    precio_costo DECIMAL(15, 2) DEFAULT 0.00,
    stock INT DEFAULT 0,
    fecha_creacion DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 4. Tabla Ventas (sales)
CREATE TABLE IF NOT EXISTS ventas (
    id INT AUTO_INCREMENT PRIMARY KEY,
    cliente_id INT NULL,
    total DECIMAL(15, 2) NOT NULL,
    fecha DATETIME NOT NULL,
    estado ENUM('paid', 'pending') DEFAULT 'paid',
    metodo VARCHAR(50) DEFAULT 'Efectivo',
    CONSTRAINT fk_ventas_cliente FOREIGN KEY (cliente_id) REFERENCES clientes(id) ON DELETE SET NULL
);

-- 5. Detalles de Venta (sale_details)
CREATE TABLE IF NOT EXISTS venta_detalles (
    id INT AUTO_INCREMENT PRIMARY KEY,
    venta_id INT NOT NULL,
    inventario_id INT NULL,
    cantidad INT NOT NULL,
    precio_unitario DECIMAL(15, 2) NOT NULL,
    costo_al_vender DECIMAL(15, 2) NOT NULL,
    FOREIGN KEY (venta_id) REFERENCES ventas(id) ON DELETE CASCADE,
    FOREIGN KEY (inventario_id) REFERENCES inventario(id) ON DELETE SET NULL
);

-- 6. Tabla Pagos (payments)
CREATE TABLE IF NOT EXISTS pagos (
    id INT AUTO_INCREMENT PRIMARY KEY,
    venta_id INT,
    monto DECIMAL(15, 2) NOT NULL,
    fecha DATETIME NOT NULL,
    metodo VARCHAR(50) DEFAULT 'Efectivo',
    FOREIGN KEY (venta_id) REFERENCES ventas(id) ON DELETE CASCADE
);

-- 7. Tabla Compras (purchases)
CREATE TABLE IF NOT EXISTS compras (
    id INT AUTO_INCREMENT PRIMARY KEY,
    inventario_id INT,
    proveedor_id INT,
    cantidad INT NOT NULL,
    monto DECIMAL(15, 2) NOT NULL,
    precio_unitario DECIMAL(15, 2) NOT NULL,
    fecha DATETIME NOT NULL,
    FOREIGN KEY (inventario_id) REFERENCES inventario(id) ON DELETE SET NULL,
    FOREIGN KEY (proveedor_id) REFERENCES proveedores(id) ON DELETE SET NULL
);

-- 8. Tabla Gastos (expenses)
CREATE TABLE IF NOT EXISTS gastos (
    id INT AUTO_INCREMENT PRIMARY KEY,
    descripcion VARCHAR(255) NOT NULL,
    monto DECIMAL(15, 2) NOT NULL,
    categoria VARCHAR(100),
    fecha DATETIME NOT NULL
);

-- 9. Tabla Cierres de Caja (cash_closings)
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
