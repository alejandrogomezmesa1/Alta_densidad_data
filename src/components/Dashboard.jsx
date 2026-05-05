import React, { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import { 
  TrendingUp, DollarSign, Package, Receipt, ArrowUpRight, ArrowDownRight, 
  Target, BarChart3, PieChart as PieIcon, Trophy, Clock, Zap, AlertCircle, 
  ChevronRight, Star, ShoppingCart, Activity, CheckCircle, Wallet
} from 'lucide-react';
import { 
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, 
  PieChart, Pie, Cell, Legend, BarChart, Bar
} from 'recharts';

const StatCard = ({ title, value, icon: Icon, color, percentage, subValue, trend }) => (
  <motion.div 
    whileHover={{ y: -5, scale: 1.02 }}
    className="premium-card" 
    style={{ flex: 1, minWidth: '220px', position: 'relative', overflow: 'hidden' }}
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
      {subValue && <p style={{ color: 'var(--text-muted)', fontSize: '0.75rem', marginTop: '0.4rem' }}>{subValue}</p>}
    </div>
  </motion.div>
);

const Dashboard = ({ sales, inventory, purchases, expenses }) => {
  const [period, setPeriod] = useState('month');

  const salesList = Array.isArray(sales) ? sales : [];
  const expensesList = Array.isArray(expenses) ? expenses : [];
  const inventoryList = Array.isArray(inventory) ? inventory : [];

  const stats = useMemo(() => {
    const now = new Date();
    const currentSales = salesList.filter(s => {
      const d = new Date(s.date);
      if (period === 'week') return d >= new Date(now.getTime() - 7*24*60*60*1000);
      if (period === 'month') return d >= new Date(now.getFullYear(), now.getMonth() - 1, now.getDate());
      return true;
    });

    const totalSales = currentSales.reduce((acc, curr) => acc + (parseFloat(curr.total) || 0), 0);
    const totalExpenses = expensesList.reduce((acc, curr) => acc + (parseFloat(curr.amount) || 0), 0);
    
    // NEW PROFIT LOGIC: Only recognize profit when sale is FULLY PAID today
    let totalProfitToday = 0;
    salesList.forEach(s => {
      const totalAmount = parseFloat(s.total) || 0;
      const payments = s.payments || [];
      const totalPaid = payments.reduce((pAcc, pCurr) => pAcc + (parseFloat(pCurr.amount) || 0), 0);
      
      if (totalPaid >= totalAmount && totalAmount > 0) {
        // Find if the FINAL payment was today
        const lastPayment = payments.reduce((latest, p) => {
          return !latest || new Date(p.date) > new Date(latest.date) ? p : latest;
        }, null);

        if (lastPayment) {
          const lpDate = new Date(lastPayment.date);
          if (lpDate.toDateString() === now.toDateString()) {
            const cost = (parseFloat(s.costAtSale) || 0) * (parseInt(s.quantity) || 1);
            totalProfitToday += (totalAmount - cost);
          }
        }
      }
    });

    const netProfit = totalProfitToday - totalExpenses;
    
    const lowStockCount = inventoryList.filter(p => p.stock < 5).length;
    const outOfStockCount = inventoryList.filter(p => p.stock <= 0).length;
    const inventoryValue = inventoryList.reduce((acc, p) => acc + (p.stock * p.costPrice), 0);
    const potentialRevenue = inventoryList.reduce((acc, p) => acc + (p.stock * p.price), 0);

    const accountsReceivable = salesList.reduce((acc, sale) => {
      const paid = (sale.payments || []).reduce((pAcc, pCurr) => pAcc + (parseFloat(pCurr.amount) || 0), 0);
      return acc + (parseFloat(sale.total) - paid);
    }, 0);

    // CASH FLOW: All payments made today
    let cashInToday = 0;
    salesList.forEach(s => {
      const todayP = (s.payments || []).filter(p => {
        const d = new Date(p.date);
        return d.toDateString() === now.toDateString();
      });
      cashInToday += todayP.reduce((acc, curr) => acc + (parseFloat(curr.amount) || 0), 0);
    });

    const totalCOGS = currentSales.reduce((acc, curr) => {
      const cost = (parseFloat(curr.costAtSale) || 0) * (parseInt(curr.quantity) || 0);
      return acc + cost;
    }, 0);

    return { 
      totalSales, totalExpenses, netProfit: totalProfitToday - totalExpenses, 
      lowStockCount, outOfStockCount, inventoryValue, potentialRevenue,
      accountsReceivable, topProducts: [], // Simplified for now
      currentSales, cashInToday, totalCOGS,
      avgTicket: currentSales.length > 0 ? totalSales / currentSales.length : 0,
      salesCount: currentSales.length
    };
  }, [salesList, expensesList, inventoryList, period]);

  const chartData = useMemo(() => {
    const days = period === 'week' ? 7 : (period === 'month' ? 30 : 60);
    const data = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().split('T')[0];
      const daySales = stats.currentSales
        .filter(s => s.date === dateStr)
        .reduce((acc, curr) => acc + (parseFloat(curr.total) || 0), 0);
      const dayProfit = stats.currentSales
        .filter(s => s.date === dateStr)
        .reduce((acc, curr) => {
          const cost = (parseFloat(curr.costAtSale) || 0) * (parseInt(curr.quantity) || 0);
          return acc + (parseFloat(curr.total) - cost);
        }, 0);
      
      data.push({
        name: d.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' }),
        ventas: daySales,
        ganancia: dayProfit
      });
    }
    return data;
  }, [stats.currentSales, period]);

  const categoryData = useMemo(() => {
    const categories = {};
    stats.currentSales.forEach(sale => {
      const product = inventoryList.find(p => p.id === sale.productId);
      const cat = product?.category || 'Otros';
      categories[cat] = (categories[cat] || 0) + (parseFloat(sale.total) || 0);
    });
    return Object.entries(categories).map(([name, value]) => ({ name, value }));
  }, [stats.currentSales, inventoryList]);

  const COLORS = ['#E2B04C', '#0A84FF', '#32D74B', '#FF453A', '#BF5AF2', '#FF9F0A'];

  return (
    <div className="main-content">
      <header style={{ marginBottom: '3rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: '2rem' }}>
          <div>
            <h2 className="title-gradient" style={{ fontSize: '2.8rem', marginBottom: '0.5rem' }}>Evolución del Negocio</h2>
            <p style={{ color: 'var(--text-secondary)', fontWeight: 500, fontSize: '1.1rem' }}>Análisis histórico y proyección financiera (COP).</p>
          </div>
          <div className="glass" style={{ display: 'flex', padding: '0.4rem', borderRadius: '12px' }}>
            {['week', 'month', 'all'].map(p => (
              <button key={p} onClick={() => setPeriod(p)} style={{ padding: '0.6rem 1.2rem', borderRadius: '10px', background: period === p ? 'var(--accent-primary)' : 'transparent', color: period === p ? '#000' : 'var(--text-secondary)', fontWeight: 700, border: 'none', cursor: 'pointer' }}>
                {p === 'week' ? 'Semana' : p === 'month' ? 'Mes' : 'Todo'}
              </button>
            ))}
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1.5rem' }}>
          <StatCard title="Ventas Hoy" value={`$${Math.round(stats.totalSales).toLocaleString('es-CO')}`} icon={TrendingUp} color="50, 215, 75" trend="up" percentage={14} />
          <StatCard title="Recaudo Hoy" value={`$${Math.round(stats.cashInToday).toLocaleString('es-CO')}`} icon={Wallet} color="32, 215, 75" subValue="Efectivo real en caja" />
          <StatCard title="Margen Neto" value={`$${Math.round(stats.netProfit).toLocaleString('es-CO')}`} icon={DollarSign} color="226, 176, 76" subValue={`Rentabilidad: ${stats.totalSales > 0 ? ((stats.netProfit/stats.totalSales)*100).toFixed(1) : 0}%`} />
          <StatCard title="Cartera Cliente" value={`$${Math.round(stats.accountsReceivable).toLocaleString('es-CO')}`} icon={Clock} color="255, 69, 58" subValue="Por cobrar" />
        </div>
      </header>

      {/* Main Graph Restored */}
      <div className="premium-card" style={{ marginBottom: '2rem', height: '450px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '2.5rem' }}>
          <h4 style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}><Activity size={20} color="var(--accent-primary)" /> RENDIMIENTO DIARIO: VENTAS VS GANANCIAS</h4>
          <div style={{ display: 'flex', gap: '1.5rem', fontSize: '0.8rem', fontWeight: 600 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}><div style={{ width: '10px', height: '10px', borderRadius: '2px', background: 'var(--accent-primary)' }} /> VENTAS</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}><div style={{ width: '10px', height: '10px', borderRadius: '2px', background: 'var(--success)' }} /> GANANCIA</div>
          </div>
        </div>
        <div style={{ height: '320px' }}>
          <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
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
              <Area type="monotone" dataKey="ganancia" stroke="var(--success)" strokeWidth={2} fill="url(#colorG)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '2rem', marginBottom: '2rem' }}>
        {/* Top Products */}
        <div className="premium-card" style={{ gridColumn: 'span 2' }}>
          <h4 style={{ marginBottom: '2rem', display: 'flex', alignItems: 'center', gap: '0.75rem' }}><Star size={20} color="var(--warning)" /> PRODUCTOS ESTRELLA</h4>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ textAlign: 'left', color: 'var(--text-muted)', fontSize: '0.7rem', textTransform: 'uppercase' }}>
                <th style={{ padding: '1rem 0' }}>Producto</th>
                <th>Ventas</th>
                <th style={{ textAlign: 'right' }}>Ingresos (COP)</th>
              </tr>
            </thead>
            <tbody>
              {stats.topProducts.map((p, i) => (
                <tr key={i} style={{ borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
                  <td style={{ padding: '1.2rem 0', fontWeight: 700, fontSize: '0.9rem' }}>{p.name}</td>
                  <td style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>{p.qty} unid.</td>
                  <td style={{ textAlign: 'right', fontWeight: 800, color: 'var(--success)' }}>${Math.round(p.revenue).toLocaleString('es-CO')}</td>
                </tr>
              ))}
            </tbody>
          </table>
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
          <div style={{ height: '300px' }}>
            <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
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
          <div style={{ height: '300px' }}>
            <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
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
              <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Tienes <strong>${Math.round(stats.accountsReceivable).toLocaleString('es-CO')}</strong> por cobrar. ¡Ojo con el recaudo!</p>
            </div>
          </div>
          <div style={{ display: 'flex', gap: '1rem' }}>
            <div style={{ minWidth: '40px', height: '40px', borderRadius: '10px', background: 'rgba(10,132,255,0.1)', color: 'var(--info)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <CheckCircle size={20} />
            </div>
            <div>
              <div style={{ fontWeight: 700, marginBottom: '0.25rem' }}>Actividad del Periodo</div>
              <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Has realizado <strong>{stats.salesCount}</strong> transacciones exitosas recientemente.</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;


