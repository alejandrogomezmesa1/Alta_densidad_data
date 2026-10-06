import React, { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  TrendingUp, DollarSign, Package, ArrowUpRight, ArrowDownRight,
  BarChart3, PieChart as PieIcon, Clock, Zap, AlertCircle,
  ChevronRight, ShoppingCart, Activity, Wallet, X, Layers,
  Droplets, Box, FlaskConical, Sparkles, Gem, Archive
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend, Treemap
} from 'recharts';
import { getPayments, balanceOf, saleProductNames } from '../utils/sales';
import { nivelStock, formatoCantidad, TIPOS_INVENTARIO } from '../utils/inventario';

/* ── Formato de moneda COP ─────────────────────────────────────────── */
const fmtCOP = (v) => `$${Math.round(Number(v) || 0).toLocaleString('es-CO')}`;
const fmtPct = (v) => `${(Number(v) || 0).toFixed(1)}%`;

/* ── Paleta Haute Parfumerie (oros, marfiles, vino, grises) ────────── */
const PALETTE = ['#C9A961', '#9A7B3F', '#F2EEE6', '#6B675F', '#5A1220', '#3d7fc4', '#2f9e6e', '#c98a1b', '#8B3A48', '#4A90D9'];

/* ── Íconos por tipo de inventario ─────────────────────────────────── */
const TIPO_ICONS = {
  terminado: Package,
  esencia: Droplets,
  base: FlaskConical,
  feromona: Sparkles,
  envase: Box,
  accesorio: Gem,
};

/* ═══════════════════════════════════════════════════════════════════════
   STAT CARD — tarjeta de KPI compacta con glow
   ═══════════════════════════════════════════════════════════════════════ */
const StatCard = ({ title, value, icon: Icon, color, subValue, detail, delay = 0, onClick }) => (
  <motion.div
    initial={{ opacity: 0, y: 20 }}
    animate={{ opacity: 1, y: 0 }}
    transition={{ duration: 0.5, delay }}
    onClick={onClick}
    className="premium-card hover-glow"
    style={{ flex: 1, minWidth: '220px', position: 'relative', overflow: 'hidden', cursor: onClick ? 'pointer' : 'default' }}
  >
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.5rem' }}>
      <div style={{ width: '38px', height: '38px', display: 'grid', placeItems: 'center', border: `1px solid rgba(${color}, 0.45)`, color: `rgb(${color})` }}>
        <Icon size={18} strokeWidth={1.6} />
      </div>
      {detail && (
        <div style={{ fontSize: '0.75rem', color: `rgb(${color})`, fontWeight: 500 }}>{detail}</div>
      )}
    </div>
    <div>
      <p className="up" style={{ color: 'var(--text-muted)', fontSize: '10px', marginBottom: '0.6rem' }}>{title}</p>
      <h3 style={{ fontSize: '2rem', fontWeight: 400, fontFamily: 'var(--f-display)' }}>{value}</h3>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
        {subValue && <p style={{ color: 'var(--text-muted)', fontSize: '0.75rem', marginTop: '0.4rem' }}>{subValue}</p>}
        {onClick && <ChevronRight size={14} color="var(--text-muted)" />}
      </div>
    </div>
  </motion.div>
);

/* ═══════════════════════════════════════════════════════════════════════
   DETAIL MODAL — lista de ítems al hacer clic en una tarjeta
   ═══════════════════════════════════════════════════════════════════════ */
const DetailModal = ({ isOpen, onClose, title, data }) => {
  if (!isOpen) return null;
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(10px)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 10000, padding: '1.5rem' }}>
      <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="premium-card" style={{ maxWidth: '650px', width: '100%', maxHeight: '80vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
          <h3 style={{ color: 'var(--accent-primary)', fontSize: '1.25rem' }}>{title}</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}><X size={24} /></button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {data.length === 0 ? (
            <p style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>Sin datos.</p>
          ) : data.map((item, i) => (
            <div key={i} className="glass" style={{ padding: '1rem', borderRadius: 0, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontWeight: 500, fontSize: '0.9rem' }}>{item.label}</div>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{item.sublabel}</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontWeight: 500, color: item.color || 'var(--text-main)' }}>{item.value}</div>
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

/* ═══════════════════════════════════════════════════════════════════════
   CUSTOM TOOLTIP para recharts
   ═══════════════════════════════════════════════════════════════════════ */
const ChartTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: 'rgba(11,11,12,0.95)', border: '1px solid var(--glass-border)', padding: '0.75rem 1rem', fontSize: '0.8rem' }}>
      <p style={{ color: 'var(--text-muted)', marginBottom: '0.4rem' }}>{label}</p>
      {payload.map((p, i) => (
        <p key={i} style={{ color: p.color || 'var(--text-main)', fontWeight: 500 }}>
          {p.name}: {fmtCOP(p.value)}
        </p>
      ))}
    </div>
  );
};

/* ═══════════════════════════════════════════════════════════════════════
   DASHBOARD PRINCIPAL
   ═══════════════════════════════════════════════════════════════════════ */
const Dashboard = ({ sales, inventory, purchases, expenses, setActiveTab, config }) => {
  const [activeModal, setActiveModal] = useState(null);

  const salesList = Array.isArray(sales) ? sales : [];
  const expensesList = Array.isArray(expenses) ? expenses : [];
  const inventoryList = Array.isArray(inventory) ? inventory : [];

  /* ── 1. Cómputos de inventario (el corazón del nuevo dashboard) ──── */
  const inv = useMemo(() => {
    let totalCost = 0;
    let totalSale = 0;
    let activeCount = 0;
    let totalItems = inventoryList.length;
    let outOfStock = 0;
    let lowStock = 0;
    let zeroPrice = 0;
    let zeroCost = 0;

    // Por tipo
    const byType = {};
    // Por categoría
    const byCat = {};
    // Top productos por valor de costo
    const topByCost = [];
    // Slow-moving
    const recentSaleIds = new Set();

    // Ítems vendidos en los últimos 30 días
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 30);
    salesList.forEach(s => {
      const d = new Date((s.date || '').split(/T| /)[0] + 'T00:00:00');
      if (d >= thirtyDaysAgo) {
        if (s.items?.length) {
          s.items.forEach(i => i.productId && recentSaleIds.add(String(i.productId)));
        } else if (s.productId) {
          recentSaleIds.add(String(s.productId));
        }
      }
    });

    let slowCost = 0;
    let slowCount = 0;

    inventoryList.forEach(p => {
      const stock = Number(p.stock) || 0;
      const cost = Number(p.costPrice) || 0;
      const price = Number(p.price) || 0;
      const itemCostValue = stock * cost;
      const itemSaleValue = stock * price;

      totalCost += itemCostValue;
      totalSale += itemSaleValue;

      if (stock > 0) activeCount++;
      if (nivelStock(p, config) === 'agotado') outOfStock++;
      if (nivelStock(p, config) === 'advertencia') lowStock++;
      if (price === 0 && stock > 0) zeroPrice++;
      if (cost === 0 && stock > 0) zeroCost++;

      // Por tipo
      const type = p.type || 'terminado';
      if (!byType[type]) byType[type] = { cost: 0, sale: 0, count: 0, stock: 0, unit: p.unit };
      byType[type].cost += itemCostValue;
      byType[type].sale += itemSaleValue;
      byType[type].count++;
      byType[type].stock += stock;

      // Por categoría
      const cat = (p.category || 'Sin categoría').trim();
      if (!byCat[cat]) byCat[cat] = { cost: 0, sale: 0, count: 0 };
      byCat[cat].cost += itemCostValue;
      byCat[cat].sale += itemSaleValue;
      byCat[cat].count++;

      // Top por valor
      if (stock > 0) {
        topByCost.push({ id: p.id, name: p.name, stock, cost, price, costValue: itemCostValue, saleValue: itemSaleValue, type, unit: p.unit, category: cat });
      }

      // Slow-moving
      if (stock > 0 && !recentSaleIds.has(String(p.id))) {
        slowCost += itemCostValue;
        slowCount++;
      }
    });

    topByCost.sort((a, b) => b.costValue - a.costValue);

    // Datos para charts
    const typeChartData = Object.entries(byType)
      .map(([key, v]) => ({
        name: TIPOS_INVENTARIO[key] || key,
        key,
        costo: Math.round(v.cost),
        venta: Math.round(v.sale),
        items: v.count,
        stock: v.stock,
        unit: v.unit,
      }))
      .sort((a, b) => b.costo - a.costo);

    const catChartData = Object.entries(byCat)
      .map(([name, v]) => ({ name, value: Math.round(v.cost), sale: Math.round(v.sale), count: v.count }))
      .sort((a, b) => b.value - a.value);

    const margin = totalSale - totalCost;
    const marginPct = totalCost > 0 ? (margin / totalCost) * 100 : 0;

    return {
      totalCost, totalSale, margin, marginPct,
      activeCount, totalItems, outOfStock, lowStock,
      zeroPrice, zeroCost,
      typeChartData, catChartData,
      topByCost: topByCost.slice(0, 15),
      slowCost, slowCount,
    };
  }, [inventoryList, salesList, config]);

  /* ── 2. Resumen financiero rápido (compacto, no redundante) ──────── */
  const finance = useMemo(() => {
    const now = new Date();
    const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const thirtyDaysAgo = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 30);

    const monthSales = salesList.filter(s => {
      const d = new Date((s.date || '').split(/T| /)[0] + 'T00:00:00');
      return d >= thirtyDaysAgo;
    });
    const totalMonthSales = monthSales.reduce((a, s) => a + (parseFloat(s.total) || 0), 0);

    const todaySales = salesList.filter(s => (s.date || '').split(/T| /)[0] === todayStr);
    const totalToday = todaySales.reduce((a, s) => a + (parseFloat(s.total) || 0), 0);

    let totalCashMonth = 0;
    salesList.forEach(s => {
      const payments = getPayments(s).filter(p => {
        const d = new Date((p.date || '').split(/T| /)[0] + 'T00:00:00');
        return d >= thirtyDaysAgo;
      });
      totalCashMonth += payments.reduce((a, p) => a + (parseFloat(p.amount) || 0), 0);
    });

    const accountsReceivable = salesList.reduce((acc, sale) => acc + balanceOf(sale), 0);

    const monthExpenses = expensesList.filter(e => {
      const d = new Date((e.date || '').split(/T| /)[0] + 'T00:00:00');
      return d >= thirtyDaysAgo;
    }).reduce((a, e) => a + (parseFloat(e.amount) || 0), 0);

    return { totalMonthSales, totalToday, totalCashMonth, accountsReceivable, monthExpenses };
  }, [salesList, expensesList]);

  /* ── 3. Datos para el modal "Top por valor" ─────────────────────── */
  const topDetailItems = inv.topByCost.map(p => ({
    label: p.name,
    sublabel: `${TIPOS_INVENTARIO[p.type] || p.type} · ${formatoCantidad(p.stock, p.unit)}${p.unit === 'ml' ? '' : ' und'}`,
    value: fmtCOP(p.costValue),
    extra: `Venta: ${fmtCOP(p.saleValue)}`,
    color: 'var(--accent-primary)',
  }));

  /* ── 4. Datos para el modal "Slow-moving" ───────────────────────── */
  const slowItems = useMemo(() => {
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 30);
    const recentIds = new Set();
    salesList.forEach(s => {
      const d = new Date((s.date || '').split(/T| /)[0] + 'T00:00:00');
      if (d >= thirtyDaysAgo) {
        if (s.items?.length) s.items.forEach(i => i.productId && recentIds.add(String(i.productId)));
        else if (s.productId) recentIds.add(String(s.productId));
      }
    });
    return inventoryList
      .filter(p => (Number(p.stock) || 0) > 0 && !recentIds.has(String(p.id)))
      .sort((a, b) => (b.stock * b.costPrice) - (a.stock * a.costPrice))
      .slice(0, 20)
      .map(p => ({
        label: p.name,
        sublabel: `${formatoCantidad(p.stock, p.unit)}${p.unit === 'ml' ? '' : ' und'} · ${TIPOS_INVENTARIO[p.type] || p.type || 'Producto'}`,
        value: fmtCOP(p.stock * (p.costPrice || 0)),
        color: 'var(--warning)',
      }));
  }, [inventoryList, salesList]);

  /* ── 5. Items con costo 0 (modal) ───────────────────────────────── */
  const zeroCostItems = useMemo(() =>
    inventoryList
      .filter(p => (Number(p.stock) || 0) > 0 && !(Number(p.costPrice) || 0))
      .map(p => ({
        label: p.name,
        sublabel: `${formatoCantidad(p.stock, p.unit)}${p.unit === 'ml' ? '' : ' und'}`,
        value: 'Sin costo',
        color: 'var(--error)',
      }))
  , [inventoryList]);

  /* ── Custom treemap content ─────────────────────────────────────── */
  const TreemapContent = ({ x, y, width, height, name, costo, index }) => {
    if (width < 50 || height < 35) return null;
    return (
      <g>
        <rect x={x} y={y} width={width} height={height} fill={PALETTE[index % PALETTE.length]} fillOpacity={0.85} stroke="var(--bg-main)" strokeWidth={2} />
        <text x={x + width / 2} y={y + height / 2 - 8} textAnchor="middle" fill="var(--bg-main)" fontSize={11} fontWeight={600} fontFamily="var(--f-ui)">
          {name}
        </text>
        <text x={x + width / 2} y={y + height / 2 + 10} textAnchor="middle" fill="var(--bg-main)" fontSize={10} fontFamily="var(--f-ui)" opacity={0.8}>
          {fmtCOP(costo)}
        </text>
      </g>
    );
  };

  return (
    <div className="main-content">
      <header className="page-header">
        <div>
          <h2 className="title-gradient" style={{ fontSize: '2.8rem', marginBottom: '0.5rem' }}>Centro de Inteligencia</h2>
          <p style={{ color: 'var(--text-secondary)', fontWeight: 500, fontSize: '1.1rem' }}>
            Radiografía completa de tu inventario y capital (COP).
          </p>
        </div>
      </header>

      {/* ── Barra financiera compacta (resumen, no chart redundante) ──── */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="glass"
        style={{ display: 'flex', flexWrap: 'wrap', gap: '1px', marginBottom: '2rem', overflow: 'hidden' }}
      >
        {[
          { label: 'Ventas hoy', value: fmtCOP(finance.totalToday), icon: ShoppingCart, color: 'var(--success)' },
          { label: 'Ventas mes', value: fmtCOP(finance.totalMonthSales), icon: TrendingUp, color: 'var(--accent-primary)' },
          { label: 'Recaudo mes', value: fmtCOP(finance.totalCashMonth), icon: Wallet, color: 'var(--accent-secondary)' },
          { label: 'Cartera', value: fmtCOP(finance.accountsReceivable), icon: Clock, color: 'var(--error)' },
          { label: 'Gastos mes', value: fmtCOP(finance.monthExpenses), icon: ArrowDownRight, color: 'var(--error)' },
        ].map((item, i) => (
          <div key={i} style={{ flex: '1 1 160px', padding: '1rem 1.25rem', background: 'var(--c-surface)', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <item.icon size={16} color={item.color} strokeWidth={1.8} />
            <div>
              <div className="up" style={{ fontSize: '9px', color: 'var(--text-muted)', marginBottom: '0.25rem' }}>{item.label}</div>
              <div style={{ fontSize: '1.1rem', fontWeight: 500, fontFamily: 'var(--f-display)' }}>{item.value}</div>
            </div>
          </div>
        ))}
      </motion.div>

      {/* ── KPIs principales de inventario ──────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1.5rem', marginBottom: '2rem' }}>
        <StatCard
          title="Inversión en Inventario"
          value={fmtCOP(inv.totalCost)}
          icon={DollarSign}
          color="201, 169, 97"
          subValue={`${inv.activeCount} ítems con existencias`}
          onClick={() => setActiveModal({ title: 'Top 15 — Mayor capital invertido', data: topDetailItems })}
        />
        <StatCard
          title="Valor de Venta Potencial"
          value={fmtCOP(inv.totalSale)}
          icon={TrendingUp}
          color="47, 158, 110"
          subValue={`${inv.totalItems} ítems en catálogo`}
          delay={0.1}
        />
        <StatCard
          title="Margen Potencial"
          value={fmtCOP(inv.margin)}
          icon={Activity}
          color="242, 238, 230"
          detail={inv.margin > 0 ? `+${fmtPct(inv.marginPct)}` : fmtPct(inv.marginPct)}
          subValue="Diferencia venta − costo"
          delay={0.2}
        />
        <StatCard
          title="Capital Inmovilizado"
          value={fmtCOP(inv.slowCost)}
          icon={Archive}
          color="194, 65, 59"
          subValue={`${inv.slowCount} productos sin venta en 30 días`}
          delay={0.3}
          onClick={() => setActiveModal({ title: 'Productos sin movimiento (30 días)', data: slowItems })}
        />
      </div>

      {/* ── Alertas de inventario ───────────────────────────────────────── */}
      {(inv.outOfStock > 0 || inv.lowStock > 0 || inv.zeroCost > 0) && (
        <div style={{ marginBottom: '2rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '1rem' }}>
            <AlertCircle size={15} color="var(--error)" />
            <span className="up" style={{ fontSize: '10px', color: 'var(--error)' }}>Alertas de inventario</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1rem' }}>
            {inv.outOfStock > 0 && (
              <motion.div initial={{ x: -20, opacity: 0 }} animate={{ x: 0, opacity: 1 }} className="glass" style={{ padding: '1.25rem 1.5rem', borderRadius: 0, borderLeft: '4px solid var(--error)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }} onClick={() => setActiveTab('inventory')}>
                <div>
                  <div style={{ fontSize: '1.5rem', fontWeight: 500, color: 'var(--error)', fontFamily: 'var(--f-display)' }}>{inv.outOfStock}</div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Productos agotados</div>
                </div>
                <ChevronRight size={16} color="var(--text-muted)" />
              </motion.div>
            )}
            {inv.lowStock > 0 && (
              <motion.div initial={{ x: -20, opacity: 0 }} animate={{ x: 0, opacity: 1 }} transition={{ delay: 0.1 }} className="glass" style={{ padding: '1.25rem 1.5rem', borderRadius: 0, borderLeft: '4px solid var(--warning)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }} onClick={() => setActiveTab('inventory')}>
                <div>
                  <div style={{ fontSize: '1.5rem', fontWeight: 500, color: 'var(--warning)', fontFamily: 'var(--f-display)' }}>{inv.lowStock}</div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>En advertencia</div>
                </div>
                <ChevronRight size={16} color="var(--text-muted)" />
              </motion.div>
            )}
            {inv.zeroCost > 0 && (
              <motion.div initial={{ x: -20, opacity: 0 }} animate={{ x: 0, opacity: 1 }} transition={{ delay: 0.2 }} className="glass" style={{ padding: '1.25rem 1.5rem', borderRadius: 0, borderLeft: '4px solid var(--info)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }} onClick={() => setActiveModal({ title: 'Productos con costo $0', data: zeroCostItems })}>
                <div>
                  <div style={{ fontSize: '1.5rem', fontWeight: 500, color: 'var(--info)', fontFamily: 'var(--f-display)' }}>{inv.zeroCost}</div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Con costo $0 (vigilante ciego)</div>
                </div>
                <ChevronRight size={16} color="var(--text-muted)" />
              </motion.div>
            )}
          </div>
        </div>
      )}

      {/* ── Mapa de capital por tipo (Treemap) ─────────────────────────── */}
      {inv.typeChartData.length > 0 && (
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }} className="premium-card" style={{ marginBottom: '2rem' }}>
          <h4 style={{ marginBottom: '2rem', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <Layers size={20} color="var(--accent-primary)" /> DISTRIBUCIÓN DE CAPITAL POR TIPO
          </h4>
          <div style={{ height: '280px', minWidth: 0 }}>
            <ResponsiveContainer width="100%" height="100%">
              <Treemap
                data={inv.typeChartData}
                dataKey="costo"
                nameKey="name"
                content={<TreemapContent />}
              >
                <Tooltip content={({ payload }) => {
                  if (!payload?.length) return null;
                  const d = payload[0]?.payload;
                  if (!d) return null;
                  return (
                    <div style={{ background: 'rgba(11,11,12,0.95)', border: '1px solid var(--glass-border)', padding: '0.75rem 1rem', fontSize: '0.8rem' }}>
                      <p style={{ fontWeight: 600, marginBottom: '0.3rem' }}>{d.name}</p>
                      <p>Costo: {fmtCOP(d.costo)}</p>
                      <p>Venta: {fmtCOP(d.venta)}</p>
                      <p style={{ color: 'var(--text-muted)' }}>{d.items} ítems</p>
                    </div>
                  );
                }} />
              </Treemap>
            </ResponsiveContainer>
          </div>
          {/* Leyenda descriptiva debajo */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1.25rem', marginTop: '1.5rem', paddingTop: '1rem', borderTop: '1px solid var(--glass-border)' }}>
            {inv.typeChartData.map((t, i) => {
              const Icon = TIPO_ICONS[t.key] || Package;
              const pct = inv.totalCost > 0 ? ((t.costo / inv.totalCost) * 100).toFixed(1) : '0.0';
              return (
                <div key={t.key} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.8rem' }}>
                  <div style={{ width: 12, height: 12, background: PALETTE[i % PALETTE.length], flexShrink: 0 }} />
                  <Icon size={14} color="var(--text-muted)" />
                  <span style={{ color: 'var(--text-secondary)' }}>{t.name}</span>
                  <span style={{ color: 'var(--accent-primary)', fontWeight: 500 }}>{pct}%</span>
                </div>
              );
            })}
          </div>
        </motion.div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))', gap: '2rem', marginBottom: '2rem' }}>
        {/* ── Top 15 productos con más capital invertido (horizontal bar) ── */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }} className="premium-card">
          <h4 style={{ marginBottom: '2rem', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <BarChart3 size={20} color="var(--accent-primary)" /> TOP CAPITAL INVERTIDO
          </h4>
          <div style={{ height: Math.max(320, inv.topByCost.length * 32), minWidth: 0 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={inv.topByCost.slice(0, 10)}
                layout="vertical"
                margin={{ left: 10, right: 20, top: 0, bottom: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" horizontal={false} />
                <XAxis type="number" stroke="var(--text-muted)" fontSize={10} tickFormatter={v => fmtCOP(v)} tickLine={false} axisLine={false} />
                <YAxis type="category" dataKey="name" width={140} stroke="var(--text-muted)" fontSize={11} tickLine={false} axisLine={false} />
                <Tooltip content={({ payload }) => {
                  if (!payload?.length) return null;
                  const d = payload[0]?.payload;
                  if (!d) return null;
                  return (
                    <div style={{ background: 'rgba(11,11,12,0.95)', border: '1px solid var(--glass-border)', padding: '0.75rem 1rem', fontSize: '0.8rem' }}>
                      <p style={{ fontWeight: 600, marginBottom: '0.3rem' }}>{d.name}</p>
                      <p>Costo inv.: {fmtCOP(d.costValue)}</p>
                      <p>Venta pot.: {fmtCOP(d.saleValue)}</p>
                      <p style={{ color: 'var(--text-muted)' }}>{formatoCantidad(d.stock, d.unit)}{d.unit === 'ml' ? '' : ' und'}</p>
                    </div>
                  );
                }} />
                <Bar dataKey="costValue" name="Capital" fill="var(--accent-primary)" radius={[0, 2, 2, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </motion.div>

        {/* ── Distribución por categoría (pie) ────────────────────────────── */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }} className="premium-card">
          <h4 style={{ marginBottom: '2rem', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <PieIcon size={20} color="var(--accent-primary)" /> CAPITAL POR CATEGORÍA
          </h4>
          {inv.catChartData.length > 0 ? (
            <div style={{ height: '350px', minWidth: 0 }}>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={inv.catChartData} cx="50%" cy="45%" innerRadius={60} outerRadius={90} paddingAngle={3} dataKey="value">
                    {inv.catChartData.map((_, i) => <Cell key={i} fill={PALETTE[i % PALETTE.length]} />)}
                  </Pie>
                  <Tooltip content={({ payload }) => {
                    if (!payload?.length) return null;
                    const d = payload[0]?.payload;
                    if (!d) return null;
                    return (
                      <div style={{ background: 'rgba(11,11,12,0.95)', border: '1px solid var(--glass-border)', padding: '0.75rem 1rem', fontSize: '0.8rem' }}>
                        <p style={{ fontWeight: 600, marginBottom: '0.3rem' }}>{d.name}</p>
                        <p>Costo: {fmtCOP(d.value)}</p>
                        <p>Venta: {fmtCOP(d.sale)}</p>
                        <p style={{ color: 'var(--text-muted)' }}>{d.count} ítems</p>
                      </div>
                    );
                  }} />
                  <Legend
                    formatter={(value) => <span style={{ color: 'var(--text-secondary)', fontSize: '0.8rem' }}>{value}</span>}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '3rem 0' }}>Sin categorías registradas.</p>
          )}
        </motion.div>
      </div>

      {/* ── Costo vs Venta por tipo (bar agrupado) ─────────────────────── */}
      {inv.typeChartData.length > 0 && (
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.5 }} className="premium-card" style={{ marginBottom: '2rem' }}>
          <h4 style={{ marginBottom: '2rem', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <Zap size={20} color="var(--accent-primary)" /> COSTO vs VENTA POR TIPO
          </h4>
          <div style={{ height: '320px', minWidth: 0 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={inv.typeChartData} margin={{ left: 10, right: 10, top: 5, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
                <XAxis dataKey="name" stroke="var(--text-muted)" fontSize={11} tickLine={false} axisLine={false} />
                <YAxis stroke="var(--text-muted)" fontSize={10} tickLine={false} axisLine={false} tickFormatter={v => fmtCOP(v)} />
                <Tooltip content={<ChartTooltip />} />
                <Bar dataKey="costo" name="Costo" fill="var(--accent-primary)" radius={[2, 2, 0, 0]} />
                <Bar dataKey="venta" name="Venta" fill="var(--success)" radius={[2, 2, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div style={{ display: 'flex', gap: '2rem', justifyContent: 'center', marginTop: '1rem', fontSize: '0.8rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}><div style={{ width: 10, height: 10, background: 'var(--accent-primary)' }} /> Costo</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}><div style={{ width: 10, height: 10, background: 'var(--success)' }} /> Venta</div>
          </div>
        </motion.div>
      )}

      {/* ── Salud del inventario (resumen bottom) ──────────────────────── */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.6 }}
        className="premium-card"
        style={{ background: 'linear-gradient(90deg, rgba(201,169,97,0.05) 0%, transparent 100%)', borderLeft: '4px solid var(--accent-primary)', marginBottom: '2rem' }}
      >
        <h4 style={{ marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <Activity size={20} color="var(--accent-primary)" /> SALUD DEL INVENTARIO
        </h4>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '2rem' }}>
          {/* Cobertura de stock */}
          <div style={{ display: 'flex', gap: '1rem' }}>
            <div style={{ minWidth: '40px', height: '40px', background: 'rgba(47,158,110,0.1)', color: 'var(--success)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Package size={20} />
            </div>
            <div>
              <div style={{ fontWeight: 500, marginBottom: '0.25rem' }}>Cobertura</div>
              <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                <strong>{inv.activeCount}</strong> de {inv.totalItems} ítems tienen existencias ({inv.totalItems > 0 ? ((inv.activeCount / inv.totalItems) * 100).toFixed(0) : 0}%).
              </p>
            </div>
          </div>
          {/* Margen global */}
          <div style={{ display: 'flex', gap: '1rem' }}>
            <div style={{ minWidth: '40px', height: '40px', background: 'rgba(201,169,97,0.1)', color: 'var(--accent-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <TrendingUp size={20} />
            </div>
            <div>
              <div style={{ fontWeight: 500, marginBottom: '0.25rem' }}>Margen Global</div>
              <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                Si vendes todo al precio actual tu margen sería de <strong>{fmtPct(inv.marginPct)}</strong> sobre la inversión.
              </p>
            </div>
          </div>
          {/* Capital inmovilizado */}
          <div style={{ display: 'flex', gap: '1rem' }}>
            <div style={{ minWidth: '40px', height: '40px', background: 'rgba(194,65,59,0.1)', color: 'var(--error)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <AlertCircle size={20} />
            </div>
            <div>
              <div style={{ fontWeight: 500, marginBottom: '0.25rem' }}>Rotación</div>
              <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                {inv.slowCount > 0
                  ? <><strong>{fmtCOP(inv.slowCost)}</strong> ({inv.slowCount} ítems) sin venta en 30 días. Considera promociones.</>
                  : 'Todos los ítems con stock tuvieron movimiento en los últimos 30 días. ¡Excelente rotación!'
                }
              </p>
            </div>
          </div>
          {/* Vigilante de precios */}
          <div style={{ display: 'flex', gap: '1rem' }}>
            <div style={{ minWidth: '40px', height: '40px', background: 'rgba(61,127,196,0.1)', color: 'var(--info)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Zap size={20} />
            </div>
            <div>
              <div style={{ fontWeight: 500, marginBottom: '0.25rem' }}>Vigilante de Costos</div>
              <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                {inv.zeroCost > 0
                  ? <><strong>{inv.zeroCost}</strong> ítems con existencias tienen costo $0. El vigilante de precios está ciego para ellos.</>
                  : 'Todos los ítems con existencias tienen costo registrado. ✓'
                }
              </p>
            </div>
          </div>
        </div>
      </motion.div>

      {/* ── Modal ──────────────────────────────────────────────────────── */}
      <DetailModal
        isOpen={!!activeModal}
        onClose={() => setActiveModal(null)}
        title={activeModal?.title}
        data={activeModal?.data || []}
      />
    </div>
  );
};

export default Dashboard;
