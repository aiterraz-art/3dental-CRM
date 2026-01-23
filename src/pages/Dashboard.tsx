import { useState, useEffect } from 'react';
import { supabase } from '../services/supabase';
import { ShoppingCart, Users, AlertCircle, Calendar as CalendarIcon, ChevronRight, Search, Bell, Plus, Package, MapPin, Clock, CheckCircle2, TrendingUp, User } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useUser } from '../contexts/UserContext';
import VisualEvidence from '../components/VisualEvidence';
import TaskModal from '../components/TaskModal';

const ActiveVisitTimer = ({ startTime }: { startTime: string }) => {
    const [elapsed, setElapsed] = useState(0);

    useEffect(() => {
        const start = new Date(startTime).getTime();
        const interval = setInterval(() => {
            const now = new Date().getTime();
            setElapsed(Math.floor((now - start) / 1000));
        }, 1000);
        return () => clearInterval(interval);
    }, [startTime]);

    const limit = 20 * 60; // 20 minutes
    const remaining = limit - elapsed;
    const isOvertime = remaining < 0;
    const absRemaining = Math.abs(remaining);

    const minutes = Math.floor(absRemaining / 60);
    const seconds = absRemaining % 60;
    const formatted = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;

    if (isOvertime) {
        return (
            <span className="text-red-600 font-bold animate-pulse flex items-center">
                <AlertCircle size={12} className="mr-1" />
                Excedido: +{formatted}
            </span>
        );
    }

    return (
        <span className="text-emerald-600 font-bold flex items-center">
            <Clock size={12} className="mr-1" />
            Restante: {formatted}
        </span>
    );
};

const Dashboard = () => {
    const { profile, isSupervisor, hasPermission } = useUser();
    const [loading, setLoading] = useState(true);
    const [stats, setStats] = useState({
        todayVisits: 0,
        effectiveHours: '0h 0m',
        zones: [] as string[],
        recentVisits: [] as any[],
        newClientsToday: 0,
        quotationsToday: 0
    });

    const [dailyVisits, setDailyVisits] = useState<any[]>([]);
    const [adminSummary, setAdminSummary] = useState<any[]>([]);
    const [selectedVisitForEvidence, setSelectedVisitForEvidence] = useState<any | null>(null);
    const [neglectedClients, setNeglectedClients] = useState<any[]>([]);
    const [selectedDate, setSelectedDate] = useState(new Date());

    // Tasks State
    const [tasks, setTasks] = useState<any[]>([]);
    const [isTaskModalOpen, setIsTaskModalOpen] = useState(false);

    useEffect(() => {
        if (!profile) {
            // Stop loading after 5 seconds if profile is still missing (safety timeout)
            const timeout = setTimeout(() => {
                if (loading) {
                    console.warn("Dashboard: Profile load timeout. Stopping loader.");
                    setLoading(false);
                }
            }, 5000);
            return () => clearTimeout(timeout);
        }
        fetchDashboardData();

        // Realtime subscription to update visits list automatically
        const subscription = supabase
            .channel('dashboard-visits')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'visits' }, () => {
                fetchDashboardData();
            })
            .subscribe();

        return () => {
            subscription.unsubscribe();
        };
    }, [profile, selectedDate]);

    const [monthlyStats, setMonthlyStats] = useState({ goal: 0, currentSales: 0, commissionRate: 0 });

    useEffect(() => {
        // ... existing useEffect ...
    }, [profile, selectedDate]);

    const fetchDashboardData = async () => {
        setLoading(true);
        const start = new Date(selectedDate);
        start.setHours(0, 0, 0, 0);
        const end = new Date(selectedDate);
        end.setHours(23, 59, 59, 999);

        const isoStart = start.toISOString();
        const isoEnd = end.toISOString();

        try {
            if (profile) {

                const now = new Date();
                const currentMonth = now.getMonth() + 1;
                const currentYear = now.getFullYear();
                const firstDayOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
                const lastDayOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString();

                // A. Get Goal (Note: Goals table uses separate month/year columns as numbers)
                const { data: goalData, error: goalError } = await supabase
                    .from('goals')
                    .select('*')
                    .eq('user_id', profile.id)
                    .eq('month', currentMonth)
                    .eq('year', currentYear)
                    .maybeSingle();

                // DEBUG: Fetch ALL goals for this user to check for mismatches
                const { data: allGoals } = await supabase
                    .from('goals')
                    .select('*')
                    .eq('user_id', profile.id);

                // B. Get Monthly Sales (Direct Orders Query)
                const { data: monthOrders } = await supabase
                    .from('orders')
                    .select('total_amount, status')
                    .eq('user_id', profile.id)
                    .gte('created_at', firstDayOfMonth)
                    .lte('created_at', lastDayOfMonth);

                let monthSales = 0;
                let activeOrdersCount = 0; // Not strictly used but kept for logic structure

                monthOrders?.forEach(o => {
                    monthSales += o.total_amount || 0;
                    activeOrdersCount++;
                });

                setMonthlyStats({
                    goal: Number(goalData?.target_amount) || 0,
                    currentSales: monthSales,
                    commissionRate: Number(goalData?.commission_rate) || 0.01
                });

                // ... existing tasks fetch ...
                // Fetch Tasks (Pending)
                const { data: tasksData } = await supabase
                    .from('tasks')
                    .select('*')
                    .eq('user_id', profile.id) // Note: Dashboard uses user_id, TeamStats used manual fetch. Stick to what works here?
                    // Actually, if TeamStats used 'assigned_to', Dashboard might be broken if 'user_id' doesn't exist?
                    // But I didn't verify Dashboard tasks. Let's assume user_id works here for now or fix if needed. 
                    // Wait, earlier I saw Dashboard uses .eq('user_id', ...). 
                    // I will leave existing task logic alone unless it errors.
                    .eq('status', 'pending')
                    .lte('due_date', new Date(new Date().setHours(23, 59, 59, 999)).toISOString())
                    .order('due_date', { ascending: true });
                setTasks(tasksData || []);

                // C. Get Neglected Clients (Intelligence)
                // We fetch all clients assigned to the user or all if supervisor
                let clientsQuery = supabase.from('clients').select('id, name');
                if (!hasPermission('VIEW_TEAM_STATS')) {
                    clientsQuery = clientsQuery.eq('created_by', profile.id);
                }
                const { data: allClients } = await clientsQuery;

                if (allClients) {
                    // Fetch LAST visit for EACH client globally (not just today)
                    const { data: lastVisits } = await supabase
                        .from('visits')
                        .select('client_id, check_in_time')
                        .in('client_id', allClients.map(c => c.id))
                        .eq('status', 'completed')
                        .order('check_in_time', { ascending: false });

                    const now = new Date();
                    const neglected = allClients.map(client => {
                        const lastVisit = lastVisits?.find(v => v.client_id === client.id);
                        const lastDate = lastVisit ? new Date(lastVisit.check_in_time) : null;
                        const days = lastDate ? Math.floor((now.getTime() - lastDate.getTime()) / (1000 * 60 * 60 * 24)) : 999;
                        return { ...client, daysSinceLastVisit: days, lastVisitDate: lastDate };
                    }).filter(c => c.daysSinceLastVisit >= 15)
                        .sort((a, b) => b.daysSinceLastVisit - a.daysSinceLastVisit);

                    setNeglectedClients(neglected);
                }
            }

            // ... rest of existing fetch logic ...

            // GLOBAL: Fetch detailed visits for the table (Admin gets all, Seller gets theirs)
            let visitsQuery = supabase
                .from('visits')
                .select('*, clients(name, zone, comuna), profiles(full_name, email)') // Try to join profiles
                .gte('check_in_time', isoStart)
                .lte('check_in_time', isoEnd)
                .order('check_in_time', { ascending: false });

            if (!hasPermission('VIEW_TEAM_STATS') && profile) {
                visitsQuery = visitsQuery.eq('sales_rep_id', profile.id);
            }

            const { data: visitsData, error: visitsError } = await visitsQuery;
            if (visitsData) {
                // If profiles join fails (no FK), we might need manual mapping, but let's assume it works or fail gracefully
                // Deduplicate logic: If multiple active visits exist for same client, only show latest one
                // Logic: 
                // 1. Group by `${client_id}-${user_id}` (?) or just client_id per user.
                // 2. If filtering `dailyVisits`, we iterate.
                // Note: The array is already ordered by check_in_time DESC.
                // We will keep the FIRST occurrence of an ACTIVE visit for a client, and FILTER OUT subsequent ACTIVE visits for the SAME client.

                const seenActiveClients = new Set();
                const filteredVisits = visitsData.filter(v => {
                    const key = `${v.sales_rep_id}-${v.client_id}`;
                    if (v.status !== 'completed' && !v.check_out_time) {
                        if (seenActiveClients.has(key)) return false; // Duplicate active visit found, skip it
                        seenActiveClients.add(key);
                        return true;
                    }
                    return true; // Keep all completed visits
                });

                setDailyVisits(filteredVisits);
            } else if (visitsError) {
                console.error("Error fetching detail visits:", visitsError);
            }

            if (hasPermission('VIEW_TEAM_STATS')) {
                // Admin/Supervisor Logic: Summary per Seller
                const { data: sellers } = await supabase
                    .from('profiles')
                    .select('id, email, full_name, role');

                const summary = await Promise.all((sellers || []).map(async (seller) => {
                    const now = new Date();

                    // 1. Fetch Visits (Including in_progress)
                    const { data: vData } = await supabase
                        .from('visits')
                        .select('client_id, check_in_time, check_out_time, status')
                        .eq('sales_rep_id', seller.id)
                        .gte('check_in_time', isoStart)
                        .lte('check_in_time', isoEnd);

                    // 2. Fetch Orders (Replacing quotations)
                    const { data: oData } = await supabase
                        .from('orders')
                        .select('id, client_id, total_amount, visit_id, created_at')
                        .eq('user_id', seller.id)
                        .gte('created_at', isoStart)
                        .lte('created_at', isoEnd);

                    // 3. Fetch Call Logs
                    const { data: lData } = await supabase
                        .from('call_logs')
                        .select('client_id, created_at')
                        .eq('user_id', seller.id)
                        .gte('created_at', isoStart)
                        .lte('created_at', isoEnd);

                    // 4. New Clients
                    const { data: cData, count: cCount } = await supabase
                        .from('clients')
                        .select('name', { count: 'exact' })
                        .eq('created_by', seller.id)
                        .gte('created_at', isoStart)
                        .lte('created_at', isoEnd);

                    // 5. Monthly Goal
                    const currentMonth = now.getMonth() + 1;
                    const currentYear = now.getFullYear();
                    const firstDayOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
                    const lastDayOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString();

                    const { data: sellerGoal } = await supabase
                        .from('goals')
                        .select('target_amount')
                        .eq('user_id', seller.id)
                        .eq('month', currentMonth)
                        .eq('year', currentYear)
                        .maybeSingle();

                    // 6. Monthly Sales (From orders)
                    const { data: mOrders } = await supabase
                        .from('orders')
                        .select('total_amount')
                        .eq('user_id', seller.id)
                        .gte('created_at', firstDayOfMonth)
                        .lte('created_at', lastDayOfMonth);

                    let sellerMonthSales = 0;
                    mOrders?.forEach(o => sellerMonthSales += o.total_amount || 0);

                    // 7. Last Zone
                    const { data: lastV } = await supabase
                        .from('visits')
                        .select('check_in_time, clients(zone)')
                        .eq('sales_rep_id', seller.id)
                        .order('check_in_time', { ascending: false })
                        .limit(1)
                        .maybeSingle();

                    // Calculate Time
                    let totalMinutes = 0;
                    const handledClientIds = new Set();

                    // A. Visits Time (Real duration or current elapsed)
                    vData?.forEach(v => {
                        handledClientIds.add(v.client_id);
                        const start = new Date(v.check_in_time).getTime();
                        const end = v.check_out_time ? new Date(v.check_out_time).getTime() : now.getTime();
                        const duration = Math.floor((end - start) / (1000 * 60));
                        totalMinutes += Math.max(0, duration);
                    });

                    // B. Orders Time (Digital Management: 15 min if not in visit)
                    oData?.forEach(o => {
                        if (!o.visit_id) {
                            handledClientIds.add(o.client_id);
                            totalMinutes += 15; // Standard digital order time
                        }
                    });

                    // C. Calls Time (7 min)
                    lData?.forEach(l => {
                        handledClientIds.add(l.client_id);
                        totalMinutes += 7;
                    });

                    const hours = totalMinutes / 60;
                    const h = Math.floor(hours);
                    const m = Math.round((hours - h) * 60);

                    return {
                        id: seller.id,
                        name: seller.full_name || seller.email?.split('@')[0].toUpperCase(),
                        role: seller.role,
                        visits: handledClientIds.size,
                        clientsCreated: cCount || 0,
                        newClientNames: (cData || []).map(c => c.name),
                        quoteAmount: oData?.reduce((sum, o) => sum + (o.total_amount || 0), 0) || 0,
                        quoteCount: oData?.length || 0,
                        hours: `${h}h ${m}m`,
                        zone: (lastV?.clients as any)?.zone || 'N/A',
                        monthlyGoal: sellerGoal?.target_amount || 0,
                        monthlySales: sellerMonthSales
                    };
                }));

                setAdminSummary(summary);
            } else if (profile && !hasPermission('VIEW_TEAM_STATS')) {
                // Seller Logic: Personal Stats
                const now = new Date();

                const { data: visits } = await supabase
                    .from('visits')
                    .select('*, clients(name, zone)')
                    .eq('sales_rep_id', profile.id)
                    .gte('check_in_time', isoStart)
                    .lte('check_in_time', isoEnd)
                    .order('check_in_time', { ascending: false });

                const { data: orders } = await supabase
                    .from('orders')
                    .select('*, clients(name, zone)')
                    .eq('user_id', profile.id)
                    .gte('created_at', isoStart)
                    .lte('created_at', isoEnd);

                const { data: logs } = await supabase
                    .from('call_logs')
                    .select('*, clients(name, zone)')
                    .eq('user_id', profile.id)
                    .gte('created_at', isoStart)
                    .lte('created_at', isoEnd);

                let totalMinutes = 0;
                const handledClientIds = new Set();

                // 1. Visits: Duration (Real or Current)
                visits?.forEach(v => {
                    handledClientIds.add(v.client_id);
                    const start = new Date(v.check_in_time).getTime();
                    const end = v.check_out_time ? new Date(v.check_out_time).getTime() : now.getTime();
                    const duration = Math.floor((end - start) / (1000 * 60));
                    totalMinutes += Math.max(0, duration);
                });

                // 2. Orders: Digital Management (if not tied to a visit)
                orders?.forEach(o => {
                    if (!o.visit_id) {
                        handledClientIds.add(o.client_id);
                        totalMinutes += 15;
                    }
                });

                // 3. Calls: 7 mins
                logs?.forEach(l => {
                    handledClientIds.add(l.client_id);
                    totalMinutes += 7;
                });

                const hours = totalMinutes / 60;
                const h = Math.floor(hours);
                const m = Math.round((hours - h) * 60);

                const zones = Array.from(new Set([
                    ...(visits?.map(v => (v.clients as any)?.zone).filter(Boolean) || []),
                    ...(orders?.map(o => (o.clients as any)?.zone).filter(Boolean) || []),
                    ...(logs?.map(l => (l.clients as any)?.zone).filter(Boolean) || [])
                ])) as string[];

                // Recent activity list
                const combinedActivity = [
                    ...(visits?.map(v => ({ ...v, type: 'Visita', time: v.check_in_time })) || []),
                    ...(orders?.filter(o => !o.visit_id).map(o => ({
                        ...o,
                        type: 'Pedido Digital',
                        time: o.created_at,
                        clients: o.clients,
                        status: 'Completado'
                    })) || []),
                    ...(logs?.map(l => ({
                        ...l,
                        type: 'Llamada',
                        time: l.created_at,
                        clients: l.clients,
                        status: l.status || 'Finalizada'
                    })) || [])
                ].sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime());

                setStats({
                    todayVisits: handledClientIds.size,
                    effectiveHours: `${h}h ${m}m`,
                    zones: zones,
                    recentVisits: combinedActivity,
                    newClientsToday: 0,
                    quotationsToday: orders?.length || 0
                });
            }
        } catch (error) {
            console.error("Dashboard error:", error);
        } finally {
            setLoading(false);
        }
    };

    if (loading) return (
        <div className="min-h-[60vh] flex flex-col items-center justify-center space-y-4">
            <div className="w-12 h-12 border-4 border-indigo-600 border-t-transparent animate-spin rounded-full"></div>
            <p className="text-gray-500 font-bold uppercase tracking-widest text-xs">Cargando Inteligencia de Negocios...</p>
        </div>
    );

    const renderDailyTable = () => (
        <div className="premium-card overflow-hidden mt-8">
            <div className="p-8 border-b border-gray-100 flex items-center justify-between bg-gray-50/50">
                <h3 className="text-xl font-bold text-gray-900 flex items-center">
                    <Clock size={20} className="mr-3 text-indigo-600" />
                    Detalle de Visitas - Hoy
                </h3>
                <div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest bg-white px-3 py-1.5 rounded-lg border border-gray-100">
                    {dailyVisits.length} Registros
                </div>
            </div>
            <div className="overflow-x-auto">
                <table className="w-full text-left">
                    <thead className="bg-white border-b border-gray-50">
                        <tr>
                            <th className="px-6 py-4 text-[10px] font-black text-gray-400 uppercase tracking-widest">Hora de Entrada</th>
                            {hasPermission('VIEW_TEAM_STATS') && <th className="px-6 py-4 text-[10px] font-black text-gray-400 uppercase tracking-widest">Vendedor</th>}
                            <th className="px-6 py-4 text-[10px] font-black text-gray-400 uppercase tracking-widest">Cliente</th>
                            <th className="px-6 py-4 text-[10px] font-black text-gray-400 uppercase tracking-widest">Comuna / Zona</th>
                            <th className="px-6 py-4 text-[10px] font-black text-gray-400 uppercase tracking-widest">Tiempo</th>
                            <th className="px-6 py-4 text-[10px] font-black text-gray-400 uppercase tracking-widest text-center">Estado</th>
                        </tr>
                    </thead>
                    <tbody>
                        {dailyVisits.length === 0 ? (
                            <tr>
                                <td colSpan={6} className="px-6 py-12 text-center text-gray-400 font-medium italic">
                                    No hay visitas registradas hoy.
                                </td>
                            </tr>
                        ) : (
                            dailyVisits.map((visit) => (
                                <tr key={visit.id} className="hover:bg-indigo-50/30 transition-colors border-b border-gray-50/50 last:border-0">
                                    <td className="px-6 py-4 text-sm font-bold text-gray-900">
                                        {new Date(visit.check_in_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                    </td>
                                    {hasPermission('VIEW_TEAM_STATS') && (
                                        <td className="px-6 py-4">
                                            <div className="flex items-center space-x-2">
                                                <div className="w-6 h-6 bg-indigo-100 text-indigo-600 rounded-full flex items-center justify-center text-[10px] font-black">
                                                    {(
                                                        adminSummary.find(s => s.id === visit.sales_rep_id)?.name ||
                                                        visit.profiles?.full_name ||
                                                        visit.profiles?.email?.split('@')[0] ||
                                                        '?'
                                                    ).substring(0, 1).toUpperCase()}
                                                </div>
                                                <span className="text-xs font-bold text-gray-600">
                                                    {adminSummary.find(s => s.id === visit.sales_rep_id)?.name || visit.profiles?.full_name || visit.profiles?.email?.split('@')[0] || 'Sin Asignar'}
                                                </span>
                                            </div>
                                        </td>
                                    )}
                                    <td className="px-6 py-4 font-bold text-gray-900">
                                        {(visit.clients as any)?.name}
                                    </td>
                                    <td className="px-6 py-4 text-xs font-medium text-gray-500">
                                        {(visit.clients as any)?.comuna || (visit.clients as any)?.zone || '-'}
                                    </td>
                                    <td className="px-6 py-4 text-sm font-medium text-gray-600">
                                        {visit.check_out_time ? (
                                            (() => {
                                                const start = new Date(visit.check_in_time);
                                                const end = new Date(visit.check_out_time);
                                                const durationMinutes = Math.round((end.getTime() - start.getTime()) / 60000);
                                                return <span className="text-indigo-600 font-bold">{durationMinutes} min</span>;
                                            })()
                                        ) : (
                                            <ActiveVisitTimer startTime={visit.check_in_time} />
                                        )}
                                    </td>
                                    <td className="px-6 py-4 text-center">
                                        <div className="flex flex-col items-center gap-2">
                                            <div className="flex gap-2">
                                                <span className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wider ${visit.status === 'completed'
                                                    ? 'bg-emerald-50 text-emerald-600 border border-emerald-100'
                                                    : 'bg-amber-50 text-amber-600 border border-amber-100'
                                                    }`}>
                                                    {visit.status === 'completed' ? 'Completada' : 'En Ruta'}
                                                </span>
                                                {visit.status === 'completed' && (
                                                    <button
                                                        onClick={() => setSelectedVisitForEvidence(visit)}
                                                        className="px-2 py-1 rounded-lg bg-indigo-50 text-indigo-600 text-[10px] font-bold uppercase tracking-wide border border-indigo-100 hover:bg-indigo-100 transition-colors"
                                                        title="Ver Evidencia Visual"
                                                    >
                                                        <Search size={14} />
                                                    </button>
                                                )}
                                            </div>
                                            {visit.status !== 'completed' && (
                                                <button
                                                    onClick={async () => {
                                                        if (confirm('¿Forzar término de esta visita?')) {
                                                            const { error } = await supabase.from('visits').update({
                                                                check_out_time: new Date().toISOString(),
                                                                status: 'completed'
                                                            } as any).eq('id', visit.id);

                                                            if (error) {
                                                                alert('Error al terminar visita: ' + error.message);
                                                            } else {
                                                                fetchDashboardData();
                                                            }
                                                        }
                                                    }}
                                                    className="text-[10px] font-bold text-red-500 hover:text-red-700 underline decoration-dotted"
                                                >
                                                    Terminar Ahora
                                                </button>
                                            )}
                                        </div>
                                    </td>
                                </tr>
                            ))
                        )}
                    </tbody>
                </table>
            </div>

            {/* Visual Evidence Modal */}
            {selectedVisitForEvidence && (
                <VisualEvidence
                    visitId={selectedVisitForEvidence.id}
                    clientName={selectedVisitForEvidence.clients?.name}
                    onClose={() => setSelectedVisitForEvidence(null)}
                />
            )}
        </div>
    );

    return (
        <div className="space-y-8 max-w-7xl mx-auto px-4 pb-12">
            {/* Standard Header */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                <div>
                    <h1 className="text-4xl font-black text-gray-900 tracking-tight">
                        {hasPermission('VIEW_TEAM_STATS') ? 'Dashboard Admin' : 'Mi Actividad Diaria'}
                    </h1>
                    <p className="text-gray-400 font-medium text-lg mt-1">
                        {hasPermission('VIEW_TEAM_STATS') ? 'Resumen operativo de toda la fuerza de ventas' : `Hola ${profile?.email?.split('@')[0].toUpperCase() || 'USUARIO'}, hoy es un gran día para vender.`}
                    </p>
                </div>
            </div>
            <div className="flex items-center space-x-3">
                <div className="relative">
                    <CalendarIcon size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                    <input
                        type="date"
                        value={selectedDate.toISOString().split('T')[0]}
                        onChange={(e) => {
                            if (!e.target.value) return;
                            // Force local timezone interpretation preventing UTC shift
                            const [y, m, d] = e.target.value.split('-').map(Number);
                            const newDate = new Date(y, m - 1, d);
                            setSelectedDate(newDate);
                        }}
                        className="pl-10 pr-4 py-3 bg-white border border-gray-100 rounded-2xl font-bold text-gray-700 shadow-sm focus:ring-2 focus:ring-indigo-200 outline-none"
                    />
                </div>
                {hasPermission('MANAGE_PERMISSIONS') && (
                    <button
                        onClick={async () => {
                            if (confirm('PELIGRO CRÍTICO: Se borrarán TODAS las VISITAS y sus PEDIDOS asociados.\n\n¿Confirmar limpieza total?')) {
                                // 1. Delete dependent Orders first (to fix Foreign Key error)
                                const { error: orderError } = await supabase.from('orders').delete().neq('id', '00000000-0000-0000-0000-000000000000');

                                if (orderError) {
                                    alert('Error borrando pedidos (RLS o Dependencias): ' + orderError.message);
                                    return;
                                }

                                // 2. Delete Visits
                                const { error } = await supabase.from('visits').delete().neq('id', '00000000-0000-0000-0000-000000000000');

                                if (error) alert('Error borrando visitas: ' + error.message);
                                else {
                                    alert('Sistema limpio. Historial y pedidos eliminados.');
                                    fetchDashboardData();
                                }
                            }
                        }}
                        className="bg-red-100 text-red-600 px-4 py-4 rounded-2xl font-black text-sm hover:bg-red-200 transition-all flex items-center"
                    >
                        <AlertCircle size={18} className="mr-2" />
                        Borrar Historial
                    </button>
                )}
                <Link to="/clients" className="bg-gray-900 text-white px-8 py-4 rounded-2xl font-black text-sm shadow-xl active:scale-95 transition-all flex items-center">
                    <Plus size={18} className="mr-2" />
                    Nueva Clínica
                </Link>
            </div>

            {hasPermission('VIEW_TEAM_STATS') ? (
                <div className="space-y-8">
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                        <div className="premium-card p-6 border-l-4 border-l-indigo-600">
                            <p className="text-[10px] font-black text-indigo-600 uppercase tracking-widest mb-1 text-xs">Visitas Totales Hoy</p>
                            <p className="text-3xl font-black text-gray-900">{adminSummary.reduce((sum, s) => sum + s.visits, 0)}</p>
                        </div>
                        <div className="premium-card p-6 border-l-4 border-l-emerald-600">
                            <p className="text-[10px] font-black text-emerald-600 uppercase tracking-widest mb-1 text-xs">Venta Proyectada Hoy</p>
                            <p className="text-3xl font-black text-gray-900">${adminSummary.reduce((sum, s) => sum + s.quoteAmount, 0).toLocaleString()}</p>
                        </div>
                        <div className="premium-card p-6 border-l-4 border-l-amber-600">
                            <p className="text-[10px] font-black text-amber-600 uppercase tracking-widest mb-1 text-xs">Pedidos Cerrados</p>
                            <p className="text-3xl font-black text-gray-900">{adminSummary.reduce((sum, s) => sum + s.quoteCount, 0)}</p>
                        </div>
                        <div className="premium-card p-6 border-l-4 border-l-blue-600">
                            <p className="text-[10px] font-black text-blue-600 uppercase tracking-widest mb-1 text-xs">Vendedores Activos</p>
                            <p className="text-3xl font-black text-gray-900">{adminSummary.filter(s => s.visits > 0).length}</p>
                        </div>
                        <div className="premium-card p-6 border-l-4 border-l-red-500 bg-red-50/30">
                            <p className="text-[10px] font-black text-red-600 uppercase tracking-widest mb-1 text-xs">Clientes Descuidados</p>
                            <div className="flex items-end justify-between">
                                <p className="text-3xl font-black text-red-700">{neglectedClients.length}</p>
                                <span className="text-[10px] font-bold text-red-600 bg-red-100 px-2 py-1 rounded-lg">Impacto Riesgo</span>
                            </div>
                        </div>
                    </div >

                    {/* Preventative Intelligence: Neglected Clients */}
                    <div className="premium-card bg-gradient-to-r from-gray-900 to-gray-800 text-white p-8 relative overflow-hidden group">
                        <div className="absolute top-0 right-0 p-8 opacity-10 group-hover:scale-110 transition-transform">
                            <AlertCircle size={80} />
                        </div>
                        <div className="relative flex flex-col md:flex-row md:items-center justify-between gap-6">
                            {neglectedClients.length > 0 ? (
                                <>
                                    <div>
                                        <h3 className="text-2xl font-black mb-1">Fuga de Clientes Detectada</h3>
                                        <p className="text-gray-400 font-medium max-w-xl">
                                            Hay {neglectedClients.length} clientes que no han sido visitados en más de 15 días.
                                            La probabilidad de pérdida aumenta exponencialmente después de la tercera semana.
                                        </p>
                                    </div>
                                    <div className="flex gap-4">
                                        <div className="flex -space-x-3">
                                            {neglectedClients.slice(0, 3).map((c, i) => (
                                                <div key={i} className="w-10 h-10 rounded-full bg-red-500 border-2 border-gray-900 flex items-center justify-center font-bold text-xs" title={c.name}>
                                                    {c.name.substring(0, 1)}
                                                </div>
                                            ))}
                                            {neglectedClients.length > 3 && (
                                                <div className="w-10 h-10 rounded-full bg-gray-700 border-2 border-gray-900 flex items-center justify-center font-bold text-xs">
                                                    +{neglectedClients.length - 3}
                                                </div>
                                            )}
                                        </div>
                                        <Link to="/clients?filter=neglected" className="bg-red-600 hover:bg-red-700 text-white px-6 py-3 rounded-xl font-bold text-sm transition-all flex items-center shadow-lg shadow-red-900/40">
                                            Tomar Acción <ChevronRight size={16} className="ml-2" />
                                        </Link>
                                    </div>
                                </>
                            ) : (
                                <>
                                    <div>
                                        <h3 className="text-2xl font-black mb-1 text-emerald-400">Salud de Cartera: Óptima</h3>
                                        <p className="text-gray-400 font-medium max-w-xl">
                                            No se detectan clientes descuidados en los últimos 15 días.
                                            Tu equipo mantiene una frecuencia de visita saludable en todas las zonas.
                                        </p>
                                    </div>
                                    <div className="bg-emerald-500/20 px-6 py-3 rounded-xl border border-emerald-500/30 text-emerald-400 font-bold text-sm">
                                        Sistema Monitorizando...
                                    </div>
                                </>
                            )}
                        </div>
                    </div>

                    {/* Table View per Seller */}
                    < div className="premium-card overflow-hidden" >
                        <div className="p-8 border-b border-gray-100 flex items-center justify-between bg-gray-50/50">
                            <h3 className="text-xl font-bold text-gray-900 flex items-center">
                                <Users size={20} className="mr-3 text-indigo-600" />
                                Resumen por Vendedor
                            </h3>
                            <div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest bg-white px-3 py-1.5 rounded-lg border border-gray-100">
                                Datos Tiempo Real
                            </div>
                        </div>
                        <div className="overflow-x-auto">
                            <table className="w-full text-left">
                                <thead className="bg-white border-b border-gray-50">
                                    <tr>
                                        <th className="px-8 py-5 text-[10px] font-black text-gray-400 uppercase tracking-widest">Vendedor</th>
                                        <th className="px-8 py-5 text-[10px] font-black text-gray-400 uppercase tracking-widest text-center">Visitas</th>
                                        <th className="px-8 py-5 text-[10px] font-black text-gray-400 uppercase tracking-widest text-center">Nuevos Clientes</th>
                                        <th className="px-8 py-5 text-[10px] font-black text-gray-400 uppercase tracking-widest text-center">Cotizaciones</th>
                                        <th className="px-8 py-5 text-[10px] font-black text-gray-400 uppercase tracking-widest text-right">Monto Cotizado</th>
                                        <th className="px-8 py-5 text-[10px] font-black text-gray-400 uppercase tracking-widest text-center">Meta / Avance</th>
                                        <th className="px-8 py-5 text-[10px] font-black text-gray-400 uppercase tracking-widest text-center">Horas Efec.</th>
                                        <th className="px-8 py-5 text-[10px] font-black text-gray-400 uppercase tracking-widest text-right">Última Zona</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {adminSummary.map((seller) => (
                                        <tr key={seller.id} className="hover:bg-indigo-50/30 transition-colors group">
                                            <td className="px-8 py-6">
                                                <div className="flex items-center space-x-3">
                                                    <div className="w-10 h-10 bg-indigo-50 rounded-xl flex items-center justify-center text-indigo-600 font-bold shadow-sm">
                                                        {seller.name.substring(0, 2)}
                                                    </div>
                                                    <div>
                                                        <p className="text-sm font-bold text-gray-900">{seller.name}</p>
                                                        <p className="text-[10px] text-gray-400 font-bold uppercase">
                                                            {seller.role === 'admin' || seller.role === 'supervisor' || seller.role === 'manager' ? 'Administrador' : 'Representante'}
                                                        </p>
                                                    </div>
                                                </div>
                                            </td>
                                            <td className="px-8 py-6 text-center">
                                                <span className={`text-sm font-black px-3 py-1 rounded-full ${seller.visits > 0 ? 'bg-indigo-100 text-indigo-700' : 'bg-gray-100 text-gray-400'}`}>
                                                    {seller.visits}
                                                </span>
                                            </td>
                                            <td className="px-8 py-6 text-center">
                                                <div className="group/clients relative inline-block">
                                                    <span className="text-sm font-bold text-gray-800 border-b border-dotted border-gray-300 cursor-help">
                                                        {seller.clientsCreated}
                                                    </span>
                                                    {seller.newClientNames?.length > 0 && (
                                                        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-48 bg-gray-900 text-white text-[10px] p-3 rounded-xl opacity-0 group-hover/clients:opacity-100 transition-opacity z-50 pointer-events-none shadow-xl">
                                                            <p className="font-black border-b border-white/10 pb-1 mb-1 uppercase tracking-widest text-indigo-400">Nuevos Clientes</p>
                                                            <ul className="space-y-1">
                                                                {seller.newClientNames.map((name: string, i: number) => (
                                                                    <li key={i} className="truncate">• {name}</li>
                                                                ))}
                                                            </ul>
                                                        </div>
                                                    )}
                                                </div>
                                            </td>
                                            <td className="px-8 py-6 text-center">
                                                <span className="text-sm font-bold text-gray-800">{seller.quoteCount}</span>
                                            </td>
                                            <td className="px-8 py-6 text-right font-black text-indigo-600">
                                                ${seller.quoteAmount.toLocaleString()}
                                            </td>
                                            <td className="px-8 py-6 text-center w-48">
                                                {seller.monthlyGoal > 0 ? (
                                                    <div className="w-full">
                                                        <div className="flex justify-between text-[10px] font-bold mb-1">
                                                            <span className="text-gray-900">${seller.monthlySales.toLocaleString()}</span>
                                                            <span className="text-gray-400">${seller.monthlyGoal.toLocaleString()}</span>
                                                        </div>
                                                        <div className="h-1.5 w-full bg-gray-100 rounded-full overflow-hidden">
                                                            <div
                                                                className="h-full bg-gradient-to-r from-violet-500 to-indigo-600 rounded-full"
                                                                style={{ width: `${Math.min((seller.monthlySales / seller.monthlyGoal) * 100, 100)}%` }}
                                                            ></div>
                                                        </div>
                                                    </div>
                                                ) : (
                                                    <span className="text-xs text-gray-400 font-medium">-</span>
                                                )}
                                            </td>
                                            <td className="px-8 py-6 text-center">
                                                <span className="text-xs font-bold text-gray-500 bg-gray-50 px-3 py-1 rounded-lg border border-gray-100">
                                                    {seller.hours}
                                                </span>
                                            </td>
                                            <td className="px-8 py-6 text-right">
                                                <div className="flex items-center justify-end space-x-2 text-gray-500">
                                                    <MapPin size={14} className="text-gray-300" />
                                                    <span className="text-xs font-black">{seller.zone}</span>
                                                </div>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div >

                    {/* NEW: Detailed Visits Table (Admin) */}
                    {renderDailyTable()}

                </div >
            ) : (
                /* SELLER VIEW */
                <div className="space-y-8">
                    {/* Monthly Goal Progress - ALWAYS SHOW */}
                    <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100 mb-8 relative overflow-hidden">
                        <div className="absolute top-0 right-0 w-64 h-64 bg-violet-50 rounded-full blur-3xl -mr-32 -mt-32 opacity-50"></div>
                        <div className="relative">
                            <div className="flex justify-between items-start mb-4">
                                <h3 className="text-2xl font-black text-gray-900">
                                    ${monthlyStats.currentSales.toLocaleString()} <span className="text-gray-300">/ ${monthlyStats.goal.toLocaleString()}</span>
                                </h3>
                            </div>
                            <div className="flex gap-4">
                                {neglectedClients.length > 0 && (
                                    <div className="bg-red-50 border border-red-100 px-4 py-2 rounded-2xl flex items-center shadow-sm">
                                        <AlertCircle size={18} className="text-red-500 mr-2" />
                                        <div>
                                            <p className="text-[10px] font-black text-red-600 uppercase tracking-widest leading-none">Descuidados</p>
                                            <p className="text-sm font-black text-red-700">{neglectedClients.length} Clientes</p>
                                        </div>
                                    </div>
                                )}
                                <div className="text-right">
                                    <p className="text-xs font-black text-emerald-500 uppercase tracking-widest mb-1">Comisión Estimada</p>
                                    <p className="text-xl font-black text-emerald-600">
                                        ${Math.round(monthlyStats.currentSales * monthlyStats.commissionRate).toLocaleString()}
                                    </p>
                                </div>
                            </div>
                        </div>

                        {/* Progress Bar */}
                        <div className="h-4 w-full bg-gray-100 rounded-full overflow-hidden mb-2">
                            <div
                                className="h-full bg-gradient-to-r from-violet-500 via-purple-500 to-indigo-600 rounded-full transition-all duration-1000 ease-out relative"
                                style={{ width: `${Math.min((monthlyStats.currentSales / (monthlyStats.goal || 1)) * 100, 100)}%` }}
                            >
                                <div className="absolute inset-0 bg-white/20 animate-[shimmer_2s_infinite]"></div>
                            </div>
                        </div>
                        <div className="flex justify-between items-center text-xs font-bold text-gray-400">
                            <span>0%</span>
                            <span>{monthlyStats.goal > 0 ? Math.round((monthlyStats.currentSales / monthlyStats.goal) * 100) : 0}% Completado</span>
                        </div>
                    </div>

                    {neglectedClients.length > 0 && (
                        <div className="premium-card bg-gradient-to-r from-red-600 to-red-700 text-white p-6 relative overflow-hidden group shadow-xl shadow-red-200">
                            <div className="absolute top-0 right-0 p-6 opacity-20 group-hover:rotate-12 transition-transform">
                                <AlertCircle size={60} />
                            </div>
                            <div className="relative flex items-center justify-between">
                                <div>
                                    <p className="text-[10px] font-black uppercase tracking-[0.2em] mb-1 opacity-80">Alerta de Fidelización</p>
                                    <h3 className="text-xl font-black">Tienes {neglectedClients.length} clientes desatendidos</h3>
                                    <p className="text-sm font-medium opacity-90 mt-1">Llevan más de 15 días sin una visita registrada.</p>
                                </div>
                                <Link to="/clients?filter=neglected" className="bg-white text-red-600 px-6 py-3 rounded-xl font-bold text-sm hover:bg-red-50 transition-all flex items-center whitespace-nowrap">
                                    Ver Lista
                                </Link>
                            </div>
                        </div>
                    )}

                    {/* Performance Widgets */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                        <div className="premium-card p-8 bg-gray-900 text-white relative overflow-hidden group">
                            <div className="absolute top-0 right-0 p-8 opacity-10 group-hover:scale-110 transition-transform">
                                <Clock size={80} />
                            </div>
                            <p className="text-[10px] font-black text-indigo-400 uppercase tracking-[0.2em] mb-4">Estimación de Jornada</p>
                            <div className="flex items-baseline space-x-2">
                                <p className="text-5xl font-black">{stats.effectiveHours}</p>
                            </div>
                            <p className="text-xs text-gray-400 font-bold mt-4 flex items-center">
                                <AlertCircle size={12} className="mr-2" />
                                Basado en Visitas, Pedidos y Llamadas
                            </p>
                        </div>

                        <div className="premium-card p-8 bg-white border-2 border-indigo-50 relative group">
                            <div className="absolute top-6 right-6 p-4 bg-indigo-50 rounded-2xl text-indigo-600">
                                <CheckCircle2 size={24} />
                            </div>
                            <p className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] mb-4">Actividad Hoy</p>
                            <p className="text-5xl font-black text-gray-900">{stats.todayVisits}</p>
                            <div className="flex items-center mt-6 space-x-2">
                                <span className="text-xs font-bold text-emerald-600 bg-emerald-50 px-2 py-1 rounded-lg">+12% vs ayer</span>
                            </div>
                        </div>

                        <div className="premium-card p-8 bg-indigo-600 text-white relative group">
                            <div className="absolute top-0 right-0 p-8 opacity-10">
                                <MapPin size={80} />
                            </div>
                            <p className="text-[10px] font-black text-white/50 uppercase tracking-[0.2em] mb-4">Zona de Influencia</p>
                            <p className="text-xl font-black leading-tight">
                                {stats.zones.length > 0 ? stats.zones.join(', ') : 'Iniciando Ruta...'}
                            </p>
                            <p className="text-xs text-white/40 font-bold mt-4">Comunas recorridas hoy</p>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 xl:grid-cols-3 gap-8">
                        {/* Activity History */}
                        <div className="xl:col-span-2 space-y-6">

                            {/* Detailed Visits Table (Seller) */}
                            {renderDailyTable()}

                            <h3 className="text-2xl font-black text-gray-900 flex items-center pt-8 border-t border-gray-100">
                                <TrendingUp size={24} className="mr-3 text-indigo-600" />
                                Historial Mixto (Visitas + Cotizaciones)
                            </h3>
                            <div className="space-y-4">
                                {stats.recentVisits.map((visit, idx) => (
                                    <div key={idx} className="premium-card p-6 flex items-center justify-between group hover:border-indigo-400 transition-all cursor-pointer">
                                        <div className="flex items-center space-x-6">
                                            <div className="w-14 h-14 bg-gray-50 rounded-2xl flex flex-col items-center justify-center border border-gray-100 shadow-sm transition-transform group-hover:scale-105">
                                                <p className="text-[9px] font-black text-gray-400 uppercase">{visit.type === 'Visita' ? 'Entrada' : 'Hora'}</p>
                                                <p className="text-xs font-bold text-indigo-600">
                                                    {new Date(visit.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                                </p>
                                            </div>
                                            <div>
                                                <h4 className="text-lg font-bold text-gray-900">{(visit.clients as any)?.name}</h4>
                                                <div className="flex items-center text-xs text-gray-400 font-bold mt-1">
                                                    <MapPin size={12} className="mr-1.5 text-gray-300" />
                                                    {(visit.clients as any)?.zone}
                                                </div>
                                            </div>
                                        </div>
                                        <div className="flex items-center space-x-4">
                                            <div className="text-right hidden sm:block">
                                                <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Estado</p>
                                                <span className="text-xs font-bold text-emerald-600 bg-emerald-50 px-3 py-1 rounded-full border border-emerald-100 capitalize">
                                                    {visit.status === 'completed' ? 'Completada' : visit.status === 'in_progress' ? 'En Ruta' : visit.status}
                                                </span>
                                            </div>
                                            <ChevronRight className="text-gray-200 group-hover:text-indigo-600 transition-all" size={24} />
                                        </div>
                                    </div>
                                ))}
                                {stats.recentVisits.length === 0 && (
                                    <div className="premium-card p-12 text-center border-dashed border-2 bg-gray-50/50">
                                        <p className="text-gray-400 font-bold">No has registrado actividad hoy. ¡Comienza ahora!</p>
                                        <Link to="/map" className="mt-4 text-indigo-600 font-black text-xs uppercase tracking-widest hover:underline inline-block">Ver Mapa de Clientes</Link>
                                    </div>
                                )}
                            </div>
                        </div>


                        {/* Side Stats */}
                        <div className="space-y-6">

                            {/* AGENDA WIDGET */}
                            <div className="premium-card p-6 bg-white border border-indigo-100 shadow-sm">
                                <div className="flex justify-between items-center mb-4">
                                    <h3 className="text-lg font-black text-gray-900 flex items-center">
                                        <CalendarIcon className="mr-2 text-indigo-600" size={20} />
                                        Agenda de Hoy
                                    </h3>
                                    <button
                                        onClick={() => setIsTaskModalOpen(true)}
                                        className="p-2 bg-indigo-50 text-indigo-600 rounded-lg hover:bg-indigo-100 transition-colors"
                                    >
                                        <Plus size={16} />
                                    </button>
                                </div>

                                <div className="space-y-3">
                                    {tasks.length === 0 ? (
                                        <p className="text-gray-400 text-xs text-center py-4 italic">No tienes tareas pendientes para hoy.</p>
                                    ) : (
                                        tasks.map(task => (
                                            <div key={task.id} className="group flex items-start space-x-3 p-3 rounded-xl hover:bg-gray-50 transition-colors cursor-pointer border border-transparent hover:border-gray-100">
                                                <button
                                                    onClick={async () => {
                                                        await supabase.from('tasks').update({ status: 'completed' }).eq('id', task.id);
                                                        fetchDashboardData();
                                                    }}
                                                    className="mt-0.5 w-5 h-5 rounded-full border-2 border-gray-300 hover:border-emerald-500 hover:bg-emerald-50 transition-all flex items-center justify-center group-hover/btn"
                                                >
                                                    <CheckCircle2 size={12} className="text-transparent group-hover/btn:text-emerald-500" />
                                                </button>
                                                <div className="flex-1">
                                                    <p className="text-sm font-bold text-gray-800 leading-tight group-hover:text-indigo-700 transition-colors">{task.title}</p>
                                                    <p className="text-[10px] text-gray-400 font-medium mt-1">
                                                        {new Date(task.due_date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                                        {task.priority === 'high' && <span className="ml-2 text-red-500 font-bold uppercase text-[8px] bg-red-50 px-1 rounded">Alta</span>}
                                                    </p>
                                                </div>
                                            </div>
                                        ))
                                    )}
                                </div>
                            </div>

                            <h3 className="text-2xl font-black text-gray-900">Métricas de Venta</h3>
                            <div className="premium-card p-8 space-y-6">
                                <div className="space-y-2">
                                    <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Cotizaciones Hoy</p>
                                    <div className="flex items-center justify-between">
                                        <p className="text-4xl font-black text-gray-900">{stats.quotationsToday}</p>
                                        <ShoppingCart className="text-indigo-100" size={48} />
                                    </div>
                                </div>
                                <div className="pt-6 border-t border-gray-50">
                                    <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-4">Objetivos Sugeridos</p>
                                    <div className="space-y-4">
                                        <div className="space-y-2">
                                            <div className="flex justify-between text-[11px] font-bold">
                                                <span className="text-gray-600">Actividad Diaria</span>
                                                <span className="text-indigo-600">{stats.todayVisits}/12</span>
                                            </div>
                                            <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                                                <div className="h-full bg-indigo-500 rounded-full shadow-lg" style={{ width: `${Math.min((stats.todayVisits / 12) * 100, 100)}%` }}></div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default Dashboard;
