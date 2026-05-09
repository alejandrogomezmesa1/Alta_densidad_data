USE alta_densidad_data;

-- 1. Create the new details table
CREATE TABLE IF NOT EXISTS venta_detalles (
    id INT AUTO_INCREMENT PRIMARY KEY,
    venta_id INT NOT NULL,
    inventario_id INT,
    cantidad INT NOT NULL,
    precio_unitario DECIMAL(15,2) NOT NULL,
    costo_al_vender DECIMAL(15,2) NOT NULL,
    FOREIGN KEY (venta_id) REFERENCES ventas(id) ON DELETE CASCADE,
    FOREIGN KEY (inventario_id) REFERENCES inventario(id) ON DELETE SET NULL
);

-- 2. Migrate existing data from ventas to venta_detalles
INSERT INTO venta_detalles (venta_id, inventario_id, cantidad, precio_unitario, costo_al_vender)
SELECT 
    id AS venta_id,
    inventario_id,
    cantidad,
    (total / cantidad) AS precio_unitario,
    costo_al_vender
FROM ventas
WHERE inventario_id IS NOT NULL;

-- 3. Drop obsolete columns from ventas (Safeguard check if they exist)
ALTER TABLE ventas DROP FOREIGN KEY ventas_ibfk_1; -- Assuming standard name, might need to be careful here
ALTER TABLE ventas DROP COLUMN inventario_id;
ALTER TABLE ventas DROP COLUMN cantidad;
ALTER TABLE ventas DROP COLUMN costo_al_vender;
