import React from 'react';
import { motion } from 'framer-motion';
import { X, Package, ShoppingBag, Receipt, DollarSign, Calendar, User, TrendingUp, CreditCard, Tag } from 'lucide-react';

const DetailModal = ({ item, type, onClose, suppliers = [], products = [] }) => {
  if (!item) return null;

  const getProductInfo = (pId) => products.find(p => String(p.id) === String(pId)) || { name: 'Desconocido' };
  const getSupplierInfo = (sId) => suppliers.find(s => String(s.id) === String(sId)) || { name: 'Desconocido' };

  const renderInventoryDetails = () => {
    const profit = item.price - item.costPrice;
    const margin = item.price > 0 ? (profit / item.price) * 100 : 0;
    const totalInvested = item.stock * item.costPrice;
    const potentialRevenue = item.stock * item.price;
    const totalPotentialProfit = potentialRevenue - totalInvested;

    return (
      <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '1.5rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', paddingBottom: '1rem', borderBottom: '1px solid var(--glass-border)' }}>
          <div style={{ width: '48px', height: '48px', borderRadius: '12px', background: 'rgba(226, 176, 76, 0.1)', display: 'flex', justifyContent: 'center', alignItems: 'center', color: 'var(--accent-primary)', fontSize: '1.2rem', fontWeight: 800 }}>
            {String(item.name).charAt(0).toUpperCase()}
          </div>
          <div>
            <h3 style={{ fontSize: '1.2rem', margin: 0 }}>{item.name}</h3>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Categoría: {item.category}</span>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '1rem' }}>
          <div className="glass" style={{ padding: '1rem', borderRadius: '12px' }}>
            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '0.2rem' }}>Precio de Venta</div>
            <div style={{ fontSize: '1.2rem', fontWeight: 800, color: 'var(--accent-primary)' }}>${Math.round(item.price).toLocaleString('es-CO')}</div>
          </div>
          <div className="glass" style={{ padding: '1rem', borderRadius: '12px' }}>
            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '0.2rem' }}>Costo Promedio</div>
            <div style={{ fontSize: '1.2rem', fontWeight: 800 }}>${Math.round(item.costPrice).toLocaleString('es-CO')}</div>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(100px, 1fr))', gap: '1rem' }}>
          <div className="glass" style={{ padding: '1rem', borderRadius: '12px', textAlign: 'center' }}>
            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '0.2rem' }}>Stock Actual</div>
            <div style={{ fontSize: '1.2rem', fontWeight: 800, color: item.stock < 5 ? 'var(--error)' : 'var(--success)' }}>{item.stock}</div>
          </div>
          <div className="glass" style={{ padding: '1rem', borderRadius: '12px', textAlign: 'center' }}>
            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '0.2rem' }}>Ganancia Unid.</div>
            <div style={{ fontSize: '1.2rem', fontWeight: 800, color: 'var(--success)' }}>${Math.round(profit).toLocaleString('es-CO')}</div>
          </div>
          <div className="glass" style={{ padding: '1rem', borderRadius: '12px', textAlign: 'center' }}>
            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '0.2rem' }}>Margen</div>
            <div style={{ fontSize: '1.2rem', fontWeight: 800, color: 'var(--info)' }}>{margin.toFixed(1)}%</div>
          </div>
        </div>

        <div style={{ background: 'rgba(255,255,255,0.02)', padding: '1rem', borderRadius: '12px', border: '1px solid var(--glass-border)' }}>
          <h4 style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}><TrendingUp size={16} /> PROYECCIÓN FINANCIERA (STOCK TOTAL)</h4>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem', fontSize: '0.85rem' }}>
            <span style={{ color: 'var(--text-muted)' }}>Capital Invertido:</span>
            <span style={{ fontWeight: 600 }}>${Math.round(totalInvested).toLocaleString('es-CO')}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem', fontSize: '0.85rem' }}>
            <span style={{ color: 'var(--text-muted)' }}>Ingreso Bruto Potencial:</span>
            <span style={{ fontWeight: 600 }}>${Math.round(potentialRevenue).toLocaleString('es-CO')}</span>
          </div>
          <div style={{ height: '1px', background: 'var(--glass-border)', margin: '0.5rem 0' }} />
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.9rem' }}>
            <span style={{ fontWeight: 700 }}>Ganancia Total Estimada:</span>
            <span style={{ fontWeight: 800, color: 'var(--success)' }}>+${Math.round(totalPotentialProfit).toLocaleString('es-CO')}</span>
          </div>
        </div>
      </div>
    );
  };

  const renderSalesDetails = () => {
    const total = parseFloat(item.total) || 0;
    const paid = (item.payments || []).reduce((acc, curr) => acc + (parseFloat(curr.amount) || 0), 0);
    const balance = total - paid;
    const itemsList = item.items && item.items.length > 0 ? item.items : [{
      productName: item.productName || getProductInfo(item.productId).name,
      quantity: item.quantity || 1,
      unitPrice: item.unitPrice || (total / (item.quantity || 1))
    }];

    return (
      <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '1.5rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', paddingBottom: '1rem', borderBottom: '1px solid var(--glass-border)' }}>
          <div>
            <h3 style={{ fontSize: '1.2rem', margin: '0 0 0.2rem 0', display: 'flex', alignItems: 'center', gap: '0.5rem' }}><User size={18} /> {item.customerName || 'Cliente General'}</h3>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}><Calendar size={14} /> Factura: #{item.id} • {item.date}</span>
            {(item.idDocument || item.phone || item.city || item.address) && (
              <div style={{ marginTop: '0.8rem', padding: '0.8rem', background: 'rgba(255,255,255,0.02)', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.05)', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                {item.idDocument && <div style={{ marginBottom: '0.2rem' }}><strong style={{ color: 'var(--text-secondary)' }}>Cédula/NIT:</strong> {item.idDocument}</div>}
                {item.phone && <div style={{ marginBottom: '0.2rem' }}><strong style={{ color: 'var(--text-secondary)' }}>Teléfono:</strong> {item.phone}</div>}
                {item.city && <div style={{ marginBottom: '0.2rem' }}><strong style={{ color: 'var(--text-secondary)' }}>Ciudad:</strong> {item.city}</div>}
                {item.address && <div><strong style={{ color: 'var(--text-secondary)' }}>Dirección:</strong> {item.address}</div>}
              </div>
            )}
          </div>
          <div style={{ padding: '0.4rem 0.8rem', borderRadius: '8px', fontSize: '0.75rem', fontWeight: 800, background: item.status === 'paid' ? 'rgba(50,215,75,0.1)' : 'rgba(255,159,10,0.1)', color: item.status === 'paid' ? 'var(--success)' : 'var(--warning)' }}>
            {item.status === 'paid' ? 'PAGADA' : 'PENDIENTE'}
          </div>
        </div>

        <div>
          <h4 style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '0.8rem' }}>PRODUCTOS FACTURADOS</h4>
          <div style={{ background: 'rgba(0,0,0,0.2)', borderRadius: '8px', overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: 'rgba(255,255,255,0.05)', textAlign: 'left', fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                  <th style={{ padding: '0.5rem 1rem' }}>Producto</th>
                  <th style={{ padding: '0.5rem 1rem' }}>Cant.</th>
                  <th style={{ padding: '0.5rem 1rem' }}>P.Unit</th>
                  <th style={{ padding: '0.5rem 1rem', textAlign: 'right' }}>Subtotal</th>
                </tr>
              </thead>
              <tbody>
                {itemsList.map((i, idx) => (
                  <tr key={idx} style={{ borderBottom: '1px solid rgba(255,255,255,0.02)' }}>
                    <td style={{ padding: '0.5rem 1rem', fontSize: '0.85rem' }}>{i.productName}</td>
                    <td style={{ padding: '0.5rem 1rem', fontSize: '0.85rem' }}>{i.quantity}</td>
                    <td style={{ padding: '0.5rem 1rem', fontSize: '0.85rem' }}>${Math.round(i.unitPrice).toLocaleString('es-CO')}</td>
                    <td style={{ padding: '0.5rem 1rem', fontSize: '0.85rem', textAlign: 'right', fontWeight: 600 }}>${Math.round(i.quantity * i.unitPrice).toLocaleString('es-CO')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '1rem' }}>
          <div className="glass" style={{ padding: '1rem', borderRadius: '12px' }}>
            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '0.2rem' }}>Total Factura</div>
            <div style={{ fontSize: '1.2rem', fontWeight: 800, color: 'var(--accent-primary)' }}>${Math.round(total).toLocaleString('es-CO')}</div>
          </div>
          <div className="glass" style={{ padding: '1rem', borderRadius: '12px' }}>
            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '0.2rem' }}>Saldo Pendiente</div>
            <div style={{ fontSize: '1.2rem', fontWeight: 800, color: balance > 0 ? 'var(--error)' : 'var(--success)' }}>${Math.round(balance).toLocaleString('es-CO')}</div>
          </div>
        </div>

        {item.payments && item.payments.length > 0 && (
          <div>
            <h4 style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '0.8rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}><CreditCard size={16} /> HISTORIAL DE ABONOS</h4>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {item.payments.map((p, idx) => (
                <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', padding: '0.75rem', background: 'rgba(255,255,255,0.02)', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.05)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                    <div style={{ fontSize: '0.85rem', fontWeight: 600 }}>{p.fecha ? p.fecha.split('T')[0] : p.date}</div>
                    <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>M: {p.metodo || p.method}</div>
                  </div>
                  <div style={{ fontWeight: 800, color: 'var(--success)' }}>+${Math.round(p.monto || p.amount).toLocaleString('es-CO')}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  };

  const renderPurchasesDetails = () => {
    const total = parseFloat(item.amount || item.total) || 0;
    const qty = parseInt(item.quantity) || 1;
    const unitPrice = parseFloat(item.unitPrice) || (total / qty);
    const supplierName = item.supplierName || getSupplierInfo(item.supplierId).name;
    const productName = item.productName || getProductInfo(item.productId || item.inventario_id).name;

    return (
      <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '1.5rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', paddingBottom: '1rem', borderBottom: '1px solid var(--glass-border)' }}>
          <div>
            <h3 style={{ fontSize: '1.2rem', margin: '0 0 0.2rem 0', display: 'flex', alignItems: 'center', gap: '0.5rem' }}><Package size={18} /> Compra: #{item.id}</h3>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}><Calendar size={14} /> Fecha: {item.date}</span>
          </div>
          <div style={{ padding: '0.4rem 0.8rem', borderRadius: '8px', fontSize: '0.75rem', fontWeight: 800, background: 'rgba(10,132,255,0.1)', color: 'var(--info)' }}>
            INGRESADA
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '1rem' }}>
          <div className="glass" style={{ padding: '1rem', borderRadius: '12px' }}>
            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '0.2rem' }}>Proveedor</div>
            <div style={{ fontSize: '1rem', fontWeight: 700 }}>{supplierName}</div>
          </div>
          <div className="glass" style={{ padding: '1rem', borderRadius: '12px' }}>
            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '0.2rem' }}>Producto Adquirido</div>
            <div style={{ fontSize: '1rem', fontWeight: 700 }}>{productName}</div>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(100px, 1fr))', gap: '1rem' }}>
          <div className="glass" style={{ padding: '1rem', borderRadius: '12px', textAlign: 'center' }}>
            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '0.2rem' }}>Cantidad</div>
            <div style={{ fontSize: '1.2rem', fontWeight: 800 }}>{qty}</div>
          </div>
          <div className="glass" style={{ padding: '1rem', borderRadius: '12px', textAlign: 'center' }}>
            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '0.2rem' }}>Precio Unitario</div>
            <div style={{ fontSize: '1.2rem', fontWeight: 800 }}>${Math.round(unitPrice).toLocaleString('es-CO')}</div>
          </div>
          <div className="glass" style={{ padding: '1rem', borderRadius: '12px', textAlign: 'center', border: '1px solid rgba(226,176,76,0.3)' }}>
            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '0.2rem' }}>Inversión Total</div>
            <div style={{ fontSize: '1.2rem', fontWeight: 800, color: 'var(--accent-primary)' }}>${Math.round(total).toLocaleString('es-CO')}</div>
          </div>
        </div>
      </div>
    );
  };

  const renderExpensesDetails = () => {
    return (
      <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '1.5rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', paddingBottom: '1rem', borderBottom: '1px solid var(--glass-border)' }}>
          <div>
            <h3 style={{ fontSize: '1.2rem', margin: '0 0 0.2rem 0', display: 'flex', alignItems: 'center', gap: '0.5rem' }}><DollarSign size={18} /> Gasto Operativo</h3>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}><Calendar size={14} /> Fecha: {item.date}</span>
          </div>
          <div style={{ padding: '0.4rem 0.8rem', borderRadius: '8px', fontSize: '0.75rem', fontWeight: 800, background: 'rgba(255,69,58,0.1)', color: 'var(--error)' }}>
            EGRESO
          </div>
        </div>

        <div className="glass" style={{ padding: '1.5rem', borderRadius: '12px' }}>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '0.5rem' }}>Descripción / Concepto</div>
          <div style={{ fontSize: '1.1rem', fontWeight: 600 }}>{item.description}</div>
        </div>

        <div className="glass" style={{ padding: '2rem', borderRadius: '12px', textAlign: 'center', border: '1px solid rgba(255,69,58,0.2)' }}>
          <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '0.5rem' }}>Monto Retirado</div>
          <div style={{ fontSize: '2.5rem', fontWeight: 900, color: 'var(--error)' }}>${Math.round(parseFloat(item.amount)).toLocaleString('es-CO')}</div>
        </div>
      </div>
    );
  };

  const renderContent = () => {
    switch (type) {
      case 'inventory': return renderInventoryDetails();
      case 'sales': return renderSalesDetails();
      case 'purchases': return renderPurchasesDetails();
      case 'expenses': return renderExpensesDetails();
      default: return null;
    }
  };

  const config = {
    inventory: { icon: Tag, title: 'Detalles de Producto', color: 'var(--accent-primary)' },
    sales: { icon: ShoppingBag, title: 'Detalle de Venta', color: 'var(--success)' },
    purchases: { icon: Receipt, title: 'Detalle de Compra', color: 'var(--info)' },
    expenses: { icon: DollarSign, title: 'Detalle de Gasto', color: 'var(--error)' }
  };

  const Icon = config[type]?.icon || Package;

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(10px)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 10000, padding: '2rem' }}>
      <motion.div initial={{ scale: 0.9, opacity: 0, y: 20 }} animate={{ scale: 1, opacity: 1, y: 0 }} exit={{ scale: 0.9, opacity: 0, y: 20 }} className="premium-card" style={{ maxWidth: '550px', width: '100%', maxHeight: '90vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <div style={{ padding: '0.5rem', borderRadius: '10px', background: 'rgba(255,255,255,0.05)', color: config[type]?.color }}>
              <Icon size={20} />
            </div>
            <h3 style={{ fontSize: '1rem', color: 'var(--text-primary)', margin: 0, textTransform: 'uppercase', letterSpacing: '1px' }}>{config[type]?.title}</h3>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}><X size={24} /></button>
        </div>

        {renderContent()}

        <button onClick={onClose} className="btn-secondary" style={{ width: '100%', marginTop: '2.5rem', height: '45px' }}>CERRAR</button>
      </motion.div>
    </div>
  );
};

export default DetailModal;
