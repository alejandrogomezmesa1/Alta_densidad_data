import React, { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import { 
  TrendingUp, DollarSign, Package, Receipt, ArrowUpRight, ArrowDownRight, 
  Target, BarChart3, PieChart as PieIcon, Trophy, Clock, Zap, AlertCircle, 
  ChevronRight, Star, ShoppingCart, Activity, CheckCircle, Wallet, X
} from 'lucide-react';
import { 
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, 
  PieChart, Pie, Cell, Legend, BarChart, Bar
} from 'recharts';

const StatCard = ({ title, value, icon: Icon, color, percentage, subValue, trend, delay = 0, onClick }) => (
  <motion.div 
    initial={{ opacity: 0, y: 20 }}
    animate={{ opacity: 1, y: 0 }}
    transition={{ duration: 0.5, delay }}
    whileHover={{ y: -5, scale: 1.02 }}
    onClick={onClick}
    className="premium-card hover-glow" 
    style={{ flex: 1, minWidth: '220px', position: 'relative', overflow: 'hidden', cursor: onClick ? 'pointer' : 'default' }}
  >
    <div style={{ position: 'absolute', top: '-10%', right: '-10%', width: '100px', height: '100px', background: `rgba(${color}, 0.05)`, borderRadius: '50%', filter: 'blur(20px)' }} />
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.5rem' }}>
      <div style={{ padding: '0.75rem', borderRadius: '14px', background: `rgba(${color}, 0.1)`, color: `rgb(${color})` }}>
        <Icon size={24} />
      </div>
      {percentage !== undefined && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', color: trend === 'up' ? 'var(--success)' : 'var(--error)', fontSize: '0.8rem', fontWeight: 700 }}>
          {trend === 'up' ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}
          {percentage}%
        </div>
      )}
    </div>
    <div>
      <p style={{ color: 'var(--text-secondary)', fontSize: '0.8rem', fontWeight: 600, marginBottom: '0.5rem', textTransform: 'uppercase' }}>{title}</p>
      <h3 style={{ fontSize: '1.6rem', fontWeight: 800 }}>{value}</h3>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
        {subValue && <p style={{ color: 'var(--text-muted)', fontSize: '0.75rem', marginTop: '0.4rem' }}>{subValue}</p>}
        {onClick && <ChevronRight size={14} color="var(--text-muted)" />}
      </div>
    </div>
  </motion.div>
);

const DetailModal = ({ isOpen, onClose, title, data, type }) => {
  if (!isOpen) return null;
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(10px)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 10000, padding: '1.5rem' }}>
      <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="premium-card" style={{ maxWidth: '600px', width: '100%', maxHeight: '80vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
          <h3 style={{ color: 'var(--accent-primary)', fontSize: '1.25rem' }}>{title}</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}><X size={24} /></button>
        </div>
        
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {data.length === 0 ? (
            <p style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>No hay movimientos registrados.</p>
          ) : data.map((item, i) => (
            <div key={i} className="glass" style={{ padding: '1rem', borderRadius: '12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: '0.9rem' }}>{item.label}</div>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{item.sublabel}</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontWeight: 800, color: item.amount < 0 ? 'var(--error)' : 'var(--success)' }}>
                  {item.amount < 0 ? '-' : '+'}${Math.abs(Math.round(item.amount)).toLocaleString('es-CO')}
                </div>
                {item.extra && <div style={{ fontSize: '0.65rem', color: 'var(--accent-primary)' }}>{item.extra}</div>}
              </div>
            </div>
          ))}
        </div>
        <button onClick={onClose} className="btn-primary" style={{ width: '100%', marginTop: '1.5rem' }}>CERRAR</button>
      </motion.div>
    </div>
  );
};

const Dashboard = ({ sales, inventory, purchases, expenses, setActiveTab }) => {
  const [period, setPeriod] = useState('month');

  const salesList = Array.isArray(sales) ? sales : [];
  const expensesList = Array.isArray(expenses) ? expenses : [];
  const inventoryList = Array.isArray(inventory) ? inventory : [];

  const stats = useMemo(() => {
    const now = new Date();
    // Manual format to avoid environment-specific behavior of toLocaleDateString
    const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

    const safeParseDate = (dateStr) => {
      if (!dateStr) return new Date(0);
      const cleanDate = dateStr.split(/T| /)[0];
      // Append time to force local timezone parsing for YYYY-MM-DD
      return new Date(cleanDate + "T00:00:00");
    };

    const isToday = (dateStr) => {
      if (!dateStr) return false;
      return dateStr.split(/T| /)[0] === todayStr;
    };

    const currentSales = salesList.filter(s => {
      if (period === 'all') return true;
      if (period === 'today') return isToday(s.date);
      
      const d = safeParseDate(s.date);
      if (period === 'week') return d >= new Date(now.getTime() - 7*24*60*60*1000);
      if (period === 'month') return d >= new Date(now.getFullYear(), now.getMonth(), now.getDate() - 30);
      return isToday(s.date);
    });

    const currentExpenses = expensesList.filter(e => {
      if (period === 'all') return true;
      if (period === 'today') return isToday(e.date);

      const d = safeParseDate(e.date);
      if (period === 'week') return d >= new Date(now.getTime() - 7*24*60*60*1000);
      if (period === 'month') return d >= new Date(now.getFullYear(), now.getMonth(), now.getDate() - 30);
      return isToday(e.date);
    });

    const totalSales = currentSales.reduce((acc, curr) => acc + (parseFloat(curr.total) || 0), 0);
    const periodSalesItems = currentSales.map(s => ({
      label: s.customerName || 'Venta General',
      sublabel: s.productName || 'Varios productos',
      amount: parseFloat(s.total) || 0,
      extra: s.date
    }));

    const totalExpenses = currentExpenses.reduce((acc, curr) => acc + (parseFloat(curr.amount) || 0), 0);
    
    // PROFIT LOGIC: Proportional profit recognition based on payments received in period
    let totalProfitPeriod = 0;
    const profitItems = [];
    salesList.forEach(s => {
      const totalAmount = parseFloat(s.total) || 0;
      if (totalAmount <= 0) return;

      const paymentsInPeriod = (s.payments || []).filter(p => {
        if (period === 'all') return true;
        if (period === 'today') return isToday(p.date);

        const d = safeParseDate(p.date);
        if (period === 'week') return d >= new Date(now.getTime() - 7*24*60*60*1000);
        if (period === 'month') return d >= new Date(now.getFullYear(), now.getMonth(), now.getDate() - 30);
        return isToday(p.date);
      });

      if (paymentsInPeriod.length > 0) {
        const paidInPeriod = paymentsInPeriod.reduce((acc, curr) => acc + (parseFloat(curr.amount) || 0), 0);
        
        let cost = 0;
        if (s.items && s.items.length > 0) {
          cost = s.items.reduce((sum, i) => sum + ((parseFloat(i.costAtSale) || 0) * parseInt(i.quantity || 1)), 0);
        } else {
          cost = (parseFloat(s.costAtSale) || 0) * (parseInt(s.quantity) || 1);
        }

        const saleProfit = totalAmount - cost;
        const recognizedProfit = (paidInPeriod / totalAmount) * saleProfit;
        totalProfitPeriod += recognizedProfit;
        profitItems.push({
          label: s.customerName || 'Venta',
          sublabel: `Cobrado en periodo: $${paidInPeriod.toLocaleString('es-CO')}`,
          amount: recognizedProfit,
          extra: `Utilidad proporcional`
        });
      }
    });

    currentExpenses.forEach(e => {
      profitItems.push({
        label: `Gasto: ${e.description}`,
        sublabel: e.categoria,
        amount: -parseFloat(e.amount),
        extra: 'Deducción operativa'
      });
    });

    const netProfit = totalProfitPeriod - totalExpenses;
    
    const lowStockCount = inventoryList.filter(p => p.stock === 1).length;
    const outOfStockCount = inventoryList.filter(p => p.stock <= 0).length;
    const inventoryValue = inventoryList.reduce((acc, p) => acc + (p.stock * p.costPrice), 0);
    const potentialRevenue = inventoryList.reduce((acc, p) => acc + (p.stock * p.price), 0);

    const accountsReceivable = salesList.reduce((acc, sale) => {
      const paid = (sale.payments || []).reduce((pAcc, pCurr) => pAcc + (parseFloat(pCurr.amount) || 0), 0);
      return acc + (parseFloat(sale.total) - paid);
    }, 0);

    const accountsReceivableItems = salesList.filter(s => {
      const paid = (s.payments || []).reduce((acc, p) => acc + (parseFloat(p.amount) || 0), 0);
      return (parseFloat(s.total) - paid) > 0.01;
    }).map(s => {
      const paid = (s.payments || []).reduce((acc, p) => acc + (parseFloat(p.amount) || 0), 0);
      return {
        label: s.customerName || 'Cliente',
        sublabel: s.productName || 'Venta',
        amount: parseFloat(s.total) - paid,
        extra: `Total: $${Math.round(s.total).toLocaleString('es-CO')}`
      };
    });

    // CASH FLOW: All payments made in the period
    let totalCashIn = 0;
    const cashInItems = [];
    salesList.forEach(s => {
      const totalAmount = parseFloat(s.total) || 0;
      
      const paymentsInPeriod = (s.payments || []).filter(p => {
        if (period === 'all') return true;
        if (period === 'today') return isToday(p.date);

        const d = safeParseDate(p.date);
        if (period === 'week') return d >= new Date(now.getTime() - 7*24*60*60*1000);
        if (period === 'month') return d >= new Date(now.getFullYear(), now.getMonth(), now.getDate() - 30);
        return isToday(p.date);
      });

      let amt = paymentsInPeriod.reduce((acc, curr) => acc + (parseFloat(curr.amount) || 0), 0);
      
      // FALLBACK: If a sale is marked as 'paid' but has NO payment records in the database,
      // we count its total as collected on the date the sale was created.
      if (s.status === 'paid' && (!s.payments || s.payments.length === 0)) {
        const saleDateStr = s.date ? s.date.split(/T| /)[0] : '';
        const saleInPeriod = (period === 'all') || 
                             (period === 'today' && isToday(s.date)) ||
                             (period === 'week' && safeParseDate(s.date) >= new Date(now.getTime() - 7*24*60*60*1000)) ||
                             (period === 'month' && safeParseDate(s.date) >= new Date(now.getFullYear(), now.getMonth(), now.getDate() - 30));
        
        if (saleInPeriod) {
          amt += totalAmount;
        }
      }

      if (amt > 0) {
        totalCashIn += amt;
        cashInItems.push({
          label: s.customerName || 'Abono / Pago',
          sublabel: s.productName || 'Venta',
          amount: amt,
          extra: `Recaudo: ${s.date ? s.date.split(/T| /)[0] : 'Fecha no registrada'}`
        });
      }
    });

    const totalCOGS = currentSales.reduce((acc, curr) => {
      let cost = 0;
      if (curr.items && curr.items.length > 0) {
        cost = curr.items.reduce((sum, i) => sum + ((parseFloat(i.costAtSale) || 0) * parseInt(i.quantity || 1)), 0);
      } else {
        cost = (parseFloat(curr.costAtSale) || 0) * (parseInt(curr.quantity) || 0);
      }
      return acc + cost;
    }, 0);

    // Calculate Top Products based on revenue
    const productSalesMap = {};
    currentSales.forEach(sale => {
      const processItem = (pId, qty, rev) => {
        if (!productSalesMap[pId]) {
          const productInfo = inventoryList.find(p => String(p.id) === String(pId)) || { name: 'Producto Eliminado' };
          productSalesMap[pId] = { name: productInfo.name, qty: 0, revenue: 0 };
        }
        productSalesMap[pId].qty += parseInt(qty) || 0;
        productSalesMap[pId].revenue += parseFloat(rev) || 0;
      };

      if (sale.items && sale.items.length > 0) {
        sale.items.forEach(i => processItem(i.productId, i.quantity, i.unitPrice * i.quantity));
      } else if (sale.productId) {
        processItem(sale.productId, sale.quantity, sale.total);
      }
    });

    const topProducts = Object.values(productSalesMap)
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 5); // Top 5 products

    // Calculate Top Debtors
    const debtorsMap = {};
    salesList.forEach(sale => {
      const total = parseFloat(sale.total) || 0;
      const paid = (sale.payments || []).reduce((pAcc, p) => pAcc + (parseFloat(p.amount) || 0), 0);
      const balance = total - paid;
      if (balance > 0) {
        const cName = sale.customerName || 'Cliente General';
        if (!debtorsMap[cName]) debtorsMap[cName] = { name: cName, balance: 0 };
        debtorsMap[cName].balance += balance;
      }
    });
    const topDebtors = Object.values(debtorsMap).sort((a, b) => b.balance - a.balance).slice(0, 5);

    // Calculate Slow Moving Inventory (Capital Inmovilizado)
    const activeProductIds = new Set();
    currentSales.forEach(sale => {
      if (sale.items) {
        sale.items.forEach(i => activeProductIds.add(String(i.productId)));
      } else if (sale.productId) {
        activeProductIds.add(String(sale.productId));
      }
    });
    
    let slowMovingCapital = 0;
    let slowMovingProductsCount = 0;
    inventoryList.forEach(p => {
      if (p.stock > 0 && !activeProductIds.has(String(p.id))) {
        slowMovingCapital += (p.stock * p.costPrice);
        slowMovingProductsCount++;
      }
    });

    return { 
      totalSales, totalExpenses, netProfit, 
      lowStockCount, outOfStockCount, inventoryValue, potentialRevenue,
      accountsReceivable, topProducts, topDebtors, slowMovingCapital, slowMovingProductsCount,
      currentSales, totalCashIn, totalCOGS,
      avgTicket: currentSales.length > 0 ? totalSales / currentSales.length : 0,
      salesCount: currentSales.length,
      periodSalesItems, cashInItems, profitItems, accountsReceivableItems
    };
  }, [salesList, expensesList, inventoryList, period]);

  const chartData = useMemo(() => {
    const data = [];
    
    if (period === 'all') {
      // Group by month for the last 12 months
      for(let i=11; i>=0; i--) {
        const d = new Date();
        d.setMonth(d.getMonth() - i);
        const monthYear = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        
        const monthSales = stats.currentSales
          .filter(s => {
            const dateStr = s.date || '';
            return dateStr.startsWith(monthYear);
          })
          .reduce((acc, curr) => acc + (parseFloat(curr.total) || 0), 0);
          
        const monthProfit = stats.currentSales
          .filter(s => {
            const dateStr = s.date || '';
            return dateStr.startsWith(monthYear);
          })
          .reduce((acc, curr) => {
            let cost = 0;
            if (curr.items && curr.items.length > 0) {
              cost = curr.items.reduce((cAcc, item) => cAcc + ((parseFloat(item.costAtSale) || 0) * (parseInt(item.quantity) || 1)), 0);
            } else {
              cost = (parseFloat(curr.costAtSale) || 0) * (parseInt(curr.quantity) || 0);
            }
            return acc + (parseFloat(curr.total) - cost);
          }, 0);
          
        data.push({
          name: d.toLocaleDateString('es-ES', { month: 'short', year: '2-digit' }),
          ventas: monthSales,
          utilidad: monthProfit
        });
      }
    } else {
      const days = period === 'week' ? 7 : 30;
      for(let i=days-1; i>=0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        // Correctly format local date to YYYY-MM-DD
        const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        
        const daySales = stats.currentSales
          .filter(s => {
             const sDate = s.date ? s.date.split(/T| /)[0] : '';
             return sDate === dateStr;
          })
          .reduce((acc, curr) => acc + (parseFloat(curr.total) || 0), 0);
        
        const dayProfit = stats.currentSales
          .filter(s => {
             const sDate = s.date ? s.date.split(/T| /)[0] : '';
             return sDate === dateStr;
          })
          .reduce((acc, curr) => {
            let cost = 0;
            if (curr.items && curr.items.length > 0) {
              cost = curr.items.reduce((cAcc, item) => cAcc + ((parseFloat(item.costAtSale) || 0) * (parseInt(item.quantity) || 1)), 0);
            } else {
              cost = (parseFloat(curr.costAtSale) || 0) * (parseInt(curr.quantity) || 0);
            }
            return acc + (parseFloat(curr.total) - cost);
          }, 0);
        
        data.push({
          name: d.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' }),
          ventas: daySales,
          utilidad: dayProfit
        });
      }
    }
    return data;
  }, [stats.currentSales, period]);

  const categoryData = useMemo(() => {
    const categories = {};
    stats.currentSales.forEach(sale => {
      if (sale.items && sale.items.length > 0) {
        sale.items.forEach(i => {
          const product = inventoryList.find(p => String(p.id) === String(i.productId));
          const cat = product?.category || 'Otros';
          categories[cat] = (categories[cat] || 0) + ((parseFloat(i.unitPrice) || 0) * (parseInt(i.quantity) || 1));
        });
      } else if (sale.productId) {
        const product = inventoryList.find(p => String(p.id) === String(sale.productId));
        const cat = product?.category || 'Otros';
        categories[cat] = (categories[cat] || 0) + (parseFloat(sale.total) || 0);
      }
    });
    return Object.entries(categories).map(([name, value]) => ({ name, value }));
  }, [stats.currentSales, inventoryList]);

  const COLORS = ['#E2B04C', '#0A84FF', '#32D74B', '#FF453A', '#BF5AF2', '#FF9F0A'];

  const [activeModal, setActiveModal] = useState(null);

  return (
    <div className="main-content">
      <header className="page-header">
        <div>
          <h2 className="title-gradient" style={{ fontSize: '2.8rem', marginBottom: '0.5rem' }}>Evolución del Negocio</h2>
          <p style={{ color: 'var(--text-secondary)', fontWeight: 500, fontSize: '1.1rem' }}>Análisis histórico y proyección financiera (COP).</p>
        </div>
        <div className="glass" style={{ display: 'flex', padding: '0.4rem', borderRadius: '12px', flexWrap: 'wrap' }}>
          {['today', 'week', 'month', 'all'].map(p => (
            <button key={p} onClick={() => setPeriod(p)} style={{ flex: 1, minWidth: '80px', padding: '0.6rem 0.5rem', borderRadius: '10px', background: period === p ? 'var(--accent-primary)' : 'transparent', color: period === p ? '#000' : 'var(--text-secondary)', fontWeight: 700, border: 'none', cursor: 'pointer' }}>
              {p === 'today' ? 'Hoy' : p === 'week' ? 'Semana' : p === 'month' ? 'Mes' : 'Todo'}
            </button>
          ))}
        </div>
      </header>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1.5rem' }}>
          <StatCard 
            title={period === 'month' ? "Ventas Mes" : (period === 'week' ? "Ventas Semana" : (period === 'all' ? "Ventas Totales" : "Ventas Hoy"))} 
            value={`$${Math.round(stats.totalSales).toLocaleString('es-CO')}`} 
            icon={TrendingUp} 
            color="50, 215, 75" 
            onClick={() => setActiveModal({ title: period === 'month' ? "Ventas del Mes" : (period === 'week' ? "Ventas de la Semana" : (period === 'all' ? "Ventas Totales" : "Ventas Hoy")), data: stats.periodSalesItems })} 
          />
          <StatCard 
            title={period === 'month' ? "Recaudo Mes" : (period === 'week' ? "Recaudo Semana" : (period === 'all' ? "Recaudo Total" : "Recaudo Hoy"))} 
            value={`$${Math.round(stats.totalCashIn).toLocaleString('es-CO')}`} 
            icon={Wallet} 
            color="32, 215, 75" 
            onClick={() => setActiveModal({ title: 'Detalle de Recaudo', data: stats.cashInItems })} 
          />
          <StatCard 
            title={period === 'month' ? "Margen Mes" : (period === 'week' ? "Margen Semana" : (period === 'all' ? "Margen Total" : "Margen Hoy"))} 
            value={`$${Math.round(stats.netProfit).toLocaleString('es-CO')}`} 
            icon={DollarSign} 
            color="226, 176, 76" 
            subValue={`Rentabilidad: ${stats.totalSales > 0 ? ((stats.netProfit/stats.totalSales)*100).toFixed(1) : 0}%`} 
            onClick={() => setActiveModal({ title: 'Detalle de Margen Neto', data: stats.profitItems })} 
          />
          <StatCard 
            delay={0.4} 
            title="Cartera Cliente" 
            value={`$${Math.round(stats.accountsReceivable).toLocaleString('es-CO')}`} 
            icon={Clock} 
            color="255, 69, 58" 
            subValue="Por cobrar" 
            onClick={() => setActiveModal({ title: 'Detalle de Cartera', data: stats.accountsReceivableItems })} 
          />
        </div>

        <DetailModal 
          isOpen={!!activeModal} 
          onClose={() => setActiveModal(null)} 
          title={activeModal?.title} 
          data={activeModal?.data || []} 
        />
      
      {/* Critical Alerts Section */}
      {(stats.lowStockCount > 0 || stats.outOfStockCount > 0) && (
        <div style={{ marginBottom: '2rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem', color: 'var(--error)' }}>
            <AlertCircle size={20} />
            <h4 style={{ margin: 0, fontSize: '0.9rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Alertas de Inventario</h4>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '1rem' }}>
            {inventoryList.filter(p => p.stock <= 1).slice(0, 6).map(p => (
              <motion.div initial={{ x: -20, opacity: 0 }} animate={{ x: 0, opacity: 1 }} key={p.id} className="glass" style={{ padding: '1rem 1.5rem', borderRadius: '14px', borderLeft: '4px solid var(--error)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontSize: '0.85rem', fontWeight: 700 }}>{p.name}</div>
                  <div style={{ fontSize: '0.7rem', color: p.stock === 0 ? 'var(--error)' : 'var(--warning)', fontWeight: 600 }}>
                    {p.stock === 0 ? 'PRODUCTO AGOTADO' : 'ÚLTIMA UNIDAD'}
                  </div>
                </div>
                <button onClick={() => setActiveTab('inventory')} style={{ background: 'none', border: 'none', color: 'var(--accent-primary)', fontSize: '0.7rem', fontWeight: 700, cursor: 'pointer' }}>REURTIR</button>
              </motion.div>
            ))}
            {inventoryList.filter(p => p.stock > 0 && p.stock < 5).slice(0, 3).map(p => (
              <motion.div initial={{ x: -20, opacity: 0 }} animate={{ x: 0, opacity: 1 }} key={p.id} className="glass" style={{ padding: '1rem 1.5rem', borderRadius: '14px', borderLeft: '4px solid var(--warning)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontSize: '0.85rem', fontWeight: 700 }}>{p.name}</div>
                  <div style={{ fontSize: '0.7rem', color: 'var(--warning)', fontWeight: 600 }}>STOCK BAJO: {p.stock} UNIDADES</div>
                </div>
                <button onClick={() => setActiveTab('inventory')} style={{ background: 'none', border: 'none', color: 'var(--accent-primary)', fontSize: '0.7rem', fontWeight: 700, cursor: 'pointer' }}>REURTIR</button>
              </motion.div>
            ))}
          </div>
        </div>
      )}

      {/* Main Graph Restored */}
      <div className="premium-card" style={{ marginBottom: '2rem', height: '450px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '2.5rem' }}>
          <h4 style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', textTransform: 'uppercase' }}>
            <Activity size={20} color="var(--accent-primary)" /> 
            RENDIMIENTO {period === 'week' ? 'SEMANAL' : period === 'month' ? 'MENSUAL' : 'HISTÓRICO'}: VENTAS VS UTILIDAD
          </h4>
          <div style={{ display: 'flex', gap: '1.5rem', fontSize: '0.8rem', fontWeight: 600 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}><div style={{ width: '10px', height: '10px', borderRadius: '2px', background: 'var(--accent-primary)' }} /> VENTAS</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}><div style={{ width: '10px', height: '10px', borderRadius: '2px', background: 'var(--success)' }} /> UTILIDAD</div>
          </div>
        </div>
        <div style={{ height: '320px', minWidth: 0 }}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData}>
              <defs>
                <linearGradient id="colorV" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="var(--accent-primary)" stopOpacity={0.2}/><stop offset="95%" stopColor="var(--accent-primary)" stopOpacity={0}/></linearGradient>
                <linearGradient id="colorG" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="var(--success)" stopOpacity={0.1}/><stop offset="95%" stopColor="var(--success)" stopOpacity={0}/></linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
              <XAxis dataKey="name" stroke="var(--text-muted)" fontSize={12} tickLine={false} axisLine={false} />
              <YAxis 
                stroke="var(--text-muted)" 
                fontSize={10} 
                tickLine={false} 
                axisLine={false} 
                tickFormatter={(v) => `$${Number(v).toLocaleString('es-CO', { maximumFractionDigits: 0 })}`}
              />
              <Tooltip contentStyle={{ background: 'rgba(10,10,12,0.95)', border: '1px solid var(--glass-border)', borderRadius: '12px' }} />
              <Area type="monotone" dataKey="ventas" stroke="var(--accent-primary)" strokeWidth={3} fill="url(#colorV)" />
              <Area type="monotone" dataKey="utilidad" stroke="var(--success)" strokeWidth={2} fill="url(#colorG)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '2rem', marginBottom: '2rem' }}>
        {/* Top Products */}
        <div className="premium-card">
          <h4 style={{ marginBottom: '2rem', display: 'flex', alignItems: 'center', gap: '0.75rem' }}><Star size={20} color="var(--warning)" /> PRODUCTOS ESTRELLA</h4>
          <div className="table-responsive-wrapper">
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ textAlign: 'left', color: 'var(--text-muted)', fontSize: '0.7rem', textTransform: 'uppercase' }}>
                <th style={{ padding: '1rem 0' }}>Producto</th>
                <th>Ventas</th>
                <th style={{ textAlign: 'right' }}>Ingresos</th>
              </tr>
            </thead>
            <tbody>
              {stats.topProducts.map((p, i) => (
                <tr key={i} style={{ borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
                  <td style={{ padding: '1.2rem 0', fontWeight: 700, fontSize: '0.9rem' }}>
                    <span className="mobile-label">Producto</span>
                    {p.name}
                  </td>
                  <td style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                    <span className="mobile-label">Ventas</span>
                    {p.qty} u.
                  </td>
                  <td style={{ textAlign: 'right', fontWeight: 800, color: 'var(--success)' }}>
                    <span className="mobile-label" style={{ textAlign: 'left' }}>Ingresos</span>
                    ${Math.round(p.revenue).toLocaleString('es-CO')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>

        {/* Top Debtors */}
        <div className="premium-card">
          <h4 style={{ marginBottom: '2rem', display: 'flex', alignItems: 'center', gap: '0.75rem' }}><AlertCircle size={20} color="var(--error)" /> TOP DEUDORES</h4>
          <div className="table-responsive-wrapper">
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ textAlign: 'left', color: 'var(--text-muted)', fontSize: '0.7rem', textTransform: 'uppercase' }}>
                <th style={{ padding: '1rem 0' }}>Cliente</th>
                <th style={{ textAlign: 'right' }}>Deuda Pendiente</th>
              </tr>
            </thead>
            <tbody>
              {stats.topDebtors.map((d, i) => (
                <tr key={i} style={{ borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
                  <td style={{ padding: '1.2rem 0', fontWeight: 700, fontSize: '0.9rem' }}>
                    <span className="mobile-label">Cliente</span>
                    {d.name}
                  </td>
                  <td style={{ textAlign: 'right', fontWeight: 800, color: 'var(--error)' }}>
                    <span className="mobile-label" style={{ textAlign: 'left' }}>Deuda Pendiente</span>
                    ${Math.round(d.balance).toLocaleString('es-CO')}
                  </td>
                </tr>
              ))}
              {stats.topDebtors.length === 0 && (
                <tr>
                  <td colSpan="2" style={{ padding: '2rem 0', textAlign: 'center', color: 'var(--text-muted)' }}>No hay deudas pendientes registradas.</td>
                </tr>
              )}
            </tbody>
          </table>
          </div>
        </div>

        {/* Stock Status Radial */}
        <div className="premium-card">
          <h4 style={{ marginBottom: '2rem' }}><Zap size={20} color="var(--info)" /> ESTADO DE STOCK</h4>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
            <div style={{ background: 'rgba(255,255,255,0.02)', padding: '1.25rem', borderRadius: '16px', border: '1px solid var(--glass-border)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
                <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Bajo Stock (&lt;5)</span>
                <span style={{ fontWeight: 800, color: 'var(--error)' }}>{stats.lowStockCount}</span>
              </div>
              <div style={{ height: '6px', background: 'rgba(255,255,255,0.05)', borderRadius: '3px', overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${(stats.lowStockCount / (inventoryList.length || 1)) * 100}%`, background: 'var(--error)' }} />
              </div>
            </div>
            
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
              <div className="glass" style={{ padding: '1rem', borderRadius: '14px', textAlign: 'center' }}>
                <div style={{ fontSize: '1.2rem', fontWeight: 800, color: 'var(--success)' }}>{inventoryList.length - stats.outOfStockCount}</div>
                <div style={{ fontSize: '0.6rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Ok</div>
              </div>
              <div className="glass" style={{ padding: '1rem', borderRadius: '14px', textAlign: 'center' }}>
                <div style={{ fontSize: '1.2rem', fontWeight: 800, color: 'var(--error)' }}>{stats.outOfStockCount}</div>
                <div style={{ fontSize: '0.6rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Agotado</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2rem', marginBottom: '2rem' }}>
        {/* Sales by Category Restored */}
        <div className="premium-card">
          <h4 style={{ marginBottom: '2rem' }}><PieIcon size={20} color="var(--accent-primary)" /> VENTAS POR CATEGORÍA</h4>
          <div style={{ height: '300px', minWidth: 0 }}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={categoryData} cx="50%" cy="50%" innerRadius={60} outerRadius={80} paddingAngle={5} dataKey="value">
                  {categoryData.map((e, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                </Pie>
                <Tooltip contentStyle={{ background: '#000', border: '1px solid #333' }} />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Expenses Breakdown */}
        <div className="premium-card">
          <h4 style={{ marginBottom: '2rem' }}><BarChart3 size={20} color="var(--error)" /> ESTRUCTURA DE COSTOS</h4>
          <div style={{ height: '300px', minWidth: 0 }}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={[
                    { name: 'Inversión Productos', value: stats.totalCOGS },
                    { name: 'Gastos de Operación', value: stats.totalExpenses }
                  ]}
                  innerRadius={60}
                  outerRadius={80}
                  paddingAngle={10}
                  dataKey="value"
                >
                  <Cell fill="var(--accent-primary)" />
                  <Cell fill="var(--error)" />
                </Pie>
                <Tooltip contentStyle={{ background: '#000', border: '1px solid #333' }} />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Strategic Insights */}
      <div className="premium-card" style={{ background: 'linear-gradient(90deg, rgba(226,176,76,0.05) 0%, transparent 100%)', borderLeft: '4px solid var(--accent-primary)' }}>
        <h4 style={{ marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '0.75rem' }}><Activity size={20} color="var(--accent-primary)" /> INSIGHTS ESTRATÉGICOS</h4>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '2rem' }}>
          <div style={{ display: 'flex', gap: '1rem' }}>
            <div style={{ minWidth: '40px', height: '40px', borderRadius: '10px', background: 'rgba(50,215,75,0.1)', color: 'var(--success)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Trophy size={20} />
            </div>
            <div>
              <div style={{ fontWeight: 700, marginBottom: '0.25rem' }}>Ticket Promedio</div>
              <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Cada cliente deja en promedio <strong>${Math.round(stats.avgTicket).toLocaleString('es-CO')}</strong>.</p>
            </div>
          </div>
          <div style={{ display: 'flex', gap: '1rem' }}>
            <div style={{ minWidth: '40px', height: '40px', borderRadius: '10px', background: 'rgba(255,69,58,0.1)', color: 'var(--error)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <AlertCircle size={20} />
            </div>
            <div>
              <div style={{ fontWeight: 700, marginBottom: '0.25rem' }}>Cartera en Riesgo</div>
              <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Tienes <strong>${Math.round(stats.accountsReceivable).toLocaleString('es-CO')}</strong> por cobrar. Usa el panel de deudores para hacer seguimiento.</p>
            </div>
          </div>
          <div style={{ display: 'flex', gap: '1rem' }}>
            <div style={{ minWidth: '40px', height: '40px', borderRadius: '10px', background: 'rgba(255,159,10,0.1)', color: 'var(--warning)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Package size={20} />
            </div>
            <div>
              <div style={{ fontWeight: 700, marginBottom: '0.25rem' }}>Capital Inmovilizado</div>
              <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Tienes <strong>${Math.round(stats.slowMovingCapital).toLocaleString('es-CO')}</strong> atrapados en {stats.slowMovingProductsCount} productos sin rotación.</p>
            </div>
          </div>
          <div style={{ display: 'flex', gap: '1rem' }}>
            <div style={{ minWidth: '40px', height: '40px', borderRadius: '10px', background: 'rgba(10,132,255,0.1)', color: 'var(--info)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <CheckCircle size={20} />
            </div>
            <div>
              <div style={{ fontWeight: 700, marginBottom: '0.25rem' }}>Efectividad de Flujo</div>
              <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>El ingreso real del periodo cubre tus gastos operativos con un saldo de <strong>${Math.round(stats.totalCashIn - stats.totalExpenses).toLocaleString('es-CO')}</strong>.</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;


