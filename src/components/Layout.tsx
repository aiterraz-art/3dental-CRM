import React from 'react';
import { Link, useLocation, useNavigate, Outlet } from 'react-router-dom';
import { LayoutDashboard, Map as MapIcon, Calendar, Users, Package, LogOut, Search, Bell, Settings, ShieldCheck, ShoppingBag, UserCircle, Truck } from 'lucide-react';
import { supabase } from '../services/supabase';
import { useUser } from '../contexts/UserContext';
import GlobalVisitTimer from './GlobalVisitTimer';

interface LayoutProps {
    children?: React.ReactNode;
    title?: string;
}

export const Layout: React.FC<LayoutProps> = ({ children }) => {
    const location = useLocation();
    const navigate = useNavigate();
    const { profile, isSupervisor, impersonatedUser, impersonateUser, stopImpersonation, effectiveRole, canImpersonate, realRole } = useUser();

    const menuItems = [
        { icon: <LayoutDashboard size={20} />, label: 'Dashboard', path: '/' },
        { icon: <MapIcon size={20} />, label: 'Mapa', path: '/map' },
        { icon: <Users size={20} />, label: 'Clientes', path: '/clients' },
        { icon: <ShoppingBag size={20} />, label: 'Cotizaciones', path: '/quotations' }, // Added Quotations
        { icon: <LayoutDashboard size={20} className="rotate-90" />, label: 'Embudo', path: '/pipeline' }, // Kanban
        { icon: <Package size={20} />, label: 'Inventario', path: '/inventory' },
        { icon: <Calendar size={20} />, label: 'Agenda', path: '/schedule' },
    ];

    // DRIVER ROLE LOGIC: Override menu entirely
    if (effectiveRole === 'driver') {
        // Clear standard menu items
        menuItems.length = 0;
        // Add Driver items
        menuItems.push({ icon: <LayoutDashboard size={20} />, label: 'Mi Panel', path: '/' });
        menuItems.push({ icon: <Truck size={20} />, label: 'Ruta', path: '/delivery' });
    } else if (isSupervisor) {
        // Only append supervisor items if NOT a driver
        menuItems.push({ icon: <ShieldCheck size={20} />, label: 'Mi Equipo', path: '/team' });
        menuItems.push({ icon: <React.Fragment><MapIcon size={20} className="text-indigo-400" /></React.Fragment>, label: 'Rutas', path: '/routes' });
        menuItems.push({ icon: <Truck size={20} />, label: 'Despacho', path: '/dispatch' });
    }

    // ADMIN: Add Settings
    if (profile?.role === 'admin' || profile?.role === 'manager') {
        menuItems.push({ icon: <Settings size={20} />, label: 'Configuración', path: '/settings' });
    }

    const handleLogout = async () => {
        await supabase.auth.signOut();
        navigate('/login');
    };

    // Role logic is now handled in UserContext provided via useUser()

    return (
        <div className="flex h-screen bg-premium-bg overflow-hidden font-outfit">
            {/* Sidebar (Desktop) */}
            <aside className="hidden lg:flex w-80 bg-side-gradient flex-col relative z-20">
                <div className="p-10 flex-1 overflow-y-auto">
                    <div className="flex items-center space-x-4 mb-12">
                        <div className="w-12 h-12 bg-white rounded-2xl p-2 flex items-center justify-center border border-white/30 shadow-2xl">
                            <img src="/logo_3dental.png" alt="3dental" className="w-full h-auto object-contain" />
                        </div>
                        <h1 className="text-white text-2xl font-black tracking-tight">3dental CRM</h1>
                    </div>

                    <nav className="space-y-3">
                        {menuItems.map((item) => (
                            <Link
                                key={item.path}
                                to={item.path}
                                className={`premium-sidebar-item ${location.pathname === item.path ? 'active' : ''}`}
                            >
                                <span className="relative z-10">{item.icon}</span>
                                <span className="font-bold relative z-10">{item.label}</span>
                                {location.pathname === item.path && (
                                    <div className="ml-auto w-1.5 h-6 bg-white rounded-full"></div>
                                )}
                            </Link>
                        ))}
                    </nav>

                    {/* Role Switcher (Admin only) */}
                    {canImpersonate && (
                        <div className="mt-12 pt-8 border-t border-white/20">
                            <p className="text-white text-[10px] font-black uppercase tracking-[0.2em] mb-4 flex items-center">
                                <ShieldCheck size={12} className="mr-2 text-premium-accent" />
                                Vista Admin
                            </p>
                            <div className="space-y-2">
                                <button
                                    onClick={() => impersonateUser('dcarvajal@3dental.cl')}
                                    className={`w-full flex items-center space-x-3 px-4 py-3 rounded-xl transition-all ${impersonatedUser?.email === 'dcarvajal@3dental.cl' ? 'bg-white text-indigo-600 shadow-lg' : 'text-white/60 hover:bg-white/10'}`}
                                >
                                    <UserCircle size={16} />
                                    <span className="text-xs font-bold">Simular: Daniela</span>
                                </button>
                                <button
                                    onClick={() => impersonateUser('nrigual@3dental.cl')}
                                    className={`w-full flex items-center space-x-3 px-4 py-3 rounded-xl transition-all ${impersonatedUser?.email === 'nrigual@3dental.cl' ? 'bg-white text-indigo-600 shadow-lg' : 'text-white/60 hover:bg-white/10'}`}
                                >
                                    <UserCircle size={16} />
                                    <span className="text-xs font-bold">Simular: Natalia</span>
                                </button>
                                <button
                                    onClick={() => impersonateUser('jmena@3dental.cl')}
                                    className={`w-full flex items-center space-x-3 px-4 py-3 rounded-xl transition-all ${impersonatedUser?.email === 'jmena@3dental.cl' ? 'bg-white text-indigo-600 shadow-lg' : 'text-white/60 hover:bg-white/10'}`}
                                >
                                    <Truck size={16} />
                                    <span className="text-xs font-bold">Simular: Juan (Reparto)</span>
                                </button>
                                {impersonatedUser && (
                                    <button
                                        onClick={stopImpersonation}
                                        className="w-full flex items-center space-x-3 px-4 py-3 rounded-xl transition-all bg-red-500/20 text-red-200 hover:bg-red-500/30 border border-red-500/30"
                                    >
                                        <LogOut size={16} />
                                        <span className="text-xs font-bold">Detener Simulación</span>
                                    </button>
                                )}
                            </div>
                        </div>
                    )}
                </div>

                <div className="p-10 space-y-6 shrink-0">
                    <div className="bg-white/10 backdrop-blur-lg rounded-[2.5rem] p-6 border border-white/20 shadow-xl">
                        <div className="flex items-center space-x-4">
                            <div className="w-12 h-12 bg-premium-accent rounded-full border-2 border-white/50 overflow-hidden shadow-lg">
                                <img src={`https://ui-avatars.com/api/?name=${profile?.email || 'User'}&background=0D8ABC&color=fff`} alt="Avatar" />
                            </div>
                            <div className="flex-1 min-w-0">
                                <p className="text-white font-bold truncate text-sm">{profile?.email?.split('@')[0] || 'Ventas'}</p>
                                <p className="text-white/60 text-[10px] font-black uppercase tracking-widest">{effectiveRole || profile?.role || 'Vendedor'}</p>
                            </div>
                        </div>
                        <button
                            onClick={handleLogout}
                            className="w-full mt-6 py-4 bg-white/10 hover:bg-white/20 text-white rounded-2xl flex items-center justify-center space-x-3 transition-all border border-white/10 group"
                        >
                            <LogOut size={18} className="group-hover:translate-x-1 transition-transform" />
                            <span className="font-bold text-xs uppercase tracking-widest">Cerrar Sesión Segura</span>
                        </button>
                    </div>
                </div>
            </aside>

            {/* Main Content */}
            <main className="flex-1 flex flex-col h-full overflow-hidden relative">
                <header className="lg:hidden h-20 bg-white border-b border-gray-100 flex items-center justify-between px-6 shrink-0 relative z-30">
                    <div className="flex items-center space-x-3">
                        <div className="w-10 h-10 bg-side-gradient rounded-xl flex items-center justify-center shadow-lg">
                            <span className="text-white font-black italic">S</span>
                        </div>
                        <h1 className="text-gray-900 font-black tracking-tight">SmileLink</h1>
                    </div>
                    <button className="p-3 bg-gray-50 text-gray-400 rounded-xl relative">
                        <Bell size={20} />
                        <span className="absolute top-3 right-3 w-2 h-2 bg-red-500 rounded-full border-2 border-white"></span>
                    </button>
                </header>

                <div className="flex-1 overflow-y-auto p-6 md:p-10 lg:p-12">
                    {children || <Outlet />}

                    <div className="mt-12 py-6 border-t border-gray-100/50 text-center">
                        <p className="text-[10px] font-medium text-gray-400 uppercase tracking-widest">
                            Diseñado y ejecutado por Alfredo Terraza
                        </p>
                    </div>
                </div>

                {/* Bottom Nav (Mobile) */}
                <nav className="lg:hidden h-24 bg-white border-t border-gray-100 flex items-center justify-around px-4 shrink-0 shadow-[0_-10px_40px_-15px_rgba(0,0,0,0.05)] relative z-30">
                    {menuItems.slice(0, 5).map((item) => (
                        <Link
                            key={item.path}
                            to={item.path}
                            className={`flex flex-col items-center justify-center space-y-1 w-16 h-16 rounded-2xl transition-all ${location.pathname === item.path
                                ? 'bg-dental-50 text-dental-600 shadow-inner'
                                : 'text-gray-300'
                                }`}
                        >
                            {item.icon}
                            <span className="text-[10px] font-black uppercase tracking-tighter">{item.label}</span>
                        </Link>
                    ))}
                    {isSupervisor && (
                        <Link
                            to="/team"
                            className={`flex flex-col items-center justify-center space-y-1 w-16 h-16 rounded-2xl transition-all ${location.pathname === '/team'
                                ? 'bg-dental-50 text-dental-600 shadow-inner'
                                : 'text-gray-300'
                                }`}
                        >
                            <ShieldCheck size={20} />
                            <span className="text-[10px] font-black uppercase tracking-tighter">Equipo</span>
                        </Link>
                    )}
                </nav>
            </main>
            <GlobalVisitTimer />
        </div>
    );
};
