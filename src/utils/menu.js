// Secciones del menú lateral (las usan el Sidebar y la barra superior)
import {
  LayoutDashboard, Package, ShoppingCart, TrendingUp, Receipt, Users, Wallet, ShieldCheck, Clock,
  Gift, Settings, FlaskConical, ShoppingBag, PackagePlus, Search, BookOpenCheck, Ticket
} from 'lucide-react';

// Arriba lo de todos los días; abajo los registros y la administración
export const MENU = [
  { title: 'Día a día', items: [
    { id: 'vender', icon: ShoppingBag, label: 'Vender' },
    { id: 'recibir', icon: PackagePlus, label: 'Recibir mercancía' },
    { id: 'cash', icon: Wallet, label: 'Caja' },
    { id: 'consultar', icon: Search, label: 'Consultar existencias' },
  ]},
  { title: 'Resumen', items: [
    { id: 'dashboard', icon: LayoutDashboard, label: 'Dashboard' },
    { id: 'contabilidad', icon: BookOpenCheck, label: 'Contabilidad' },
  ]},
  { title: 'Registros', items: [
    { id: 'sales', icon: TrendingUp, label: 'Ventas' },
    { id: 'giftcards', icon: Ticket, label: 'Tarjetas de regalo' },
    { id: 'purchases', icon: ShoppingCart, label: 'Compras' },
    { id: 'expenses', icon: Receipt, label: 'Gastos' },
    { id: 'collections', icon: Clock, label: 'Cartera' },
  ]},
  { title: 'Catálogo', items: [
    { id: 'inventory', icon: Package, label: 'Inventario' },
    { id: 'kits', icon: Gift, label: 'Kits' },
    { id: 'recipes', icon: FlaskConical, label: 'Recetas y empaque' },
  ]},
  { title: 'Relaciones', items: [
    { id: 'clients', icon: Users, label: 'Clientes' },
    { id: 'suppliers', icon: ShieldCheck, label: 'Proveedores' },
  ]},
  { title: 'Sistema', items: [
    { id: 'settings', icon: Settings, label: 'Configuraciones' },
  ]},
];
