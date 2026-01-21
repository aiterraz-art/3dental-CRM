import { useState, useEffect } from 'react';
import { supabase } from '../services/supabase';
import { Calendar as CalendarIcon, Clock, MapPin, RefreshCw, Plus, ChevronLeft, ChevronRight, Check, Bell, Package, CheckCircle2 } from 'lucide-react';
import { clientService } from '../services/clientService';
import { useNavigate } from 'react-router-dom';
import { useUser } from '../contexts/UserContext';

interface CalendarEvent {
    id: string;
    summary: string;
    start: { dateTime: string };
    location?: string;
}

const Schedule = () => {
    const navigate = useNavigate();
    const { profile } = useUser();
    const [events, setEvents] = useState<CalendarEvent[]>([]);
    const [tasks, setTasks] = useState<any[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [showAddModal, setShowAddModal] = useState(false);
    const [newEvent, setNewEvent] = useState({ summary: '', date: '', time: '' });
    const [clients, setClients] = useState<any[]>([]);

    const fetchGoogleEvents = async () => {
        setLoading(true);
        setError(null);
        try {
            const { data: { session } } = await supabase.auth.getSession();
            if (!session?.provider_token) {
                console.warn("Google token not found");
                return;
            }
            const response = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=' + new Date().toISOString(), {
                headers: { Authorization: `Bearer ${session.provider_token}` }
            });
            const data = await response.json();
            if (data.items) setEvents(data.items);
        } catch (err) {
            console.error("Calendar sync failed:", err);
        } finally {
            setLoading(false);
        }
    };

    const fetchTasks = async () => {
        if (!profile) return;
        const { data } = await (supabase.from('crm_tasks') as any)
            .select('*, clients(name)')
            .eq('assigned_to', profile.id)
            .eq('status', 'pending');
        if (data) setTasks(data);
    };

    useEffect(() => {
        fetchGoogleEvents();
        fetchTasks();
        clientService.getClients().then(setClients);
    }, [profile]);

    const handleCreateEvent = async () => {
        if (!newEvent.summary || !newEvent.date || !newEvent.time) return;
        setLoading(true);
        try {
            const { data: { session } } = await supabase.auth.getSession();
            if (!session?.provider_token) throw new Error("No token");
            const startDateTime = new Date(`${newEvent.date}T${newEvent.time}:00`).toISOString();
            const endDateTime = new Date(new Date(startDateTime).getTime() + 60 * 60 * 1000).toISOString();
            const response = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${session.provider_token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ summary: newEvent.summary, start: { dateTime: startDateTime }, end: { dateTime: endDateTime } }),
            });
            if (response.ok) {
                setShowAddModal(false);
                fetchGoogleEvents();
            }
        } catch (err) {
            setError("Failed to create event.");
        } finally {
            setLoading(false);
        }
    };

    const handleCompleteTask = async (taskId: string) => {
        await (supabase.from('crm_tasks') as any).update({ status: 'completed' }).eq('id', taskId);
        fetchTasks();
    };

    return (
        <div className="flex h-full gap-8">
            <div className="flex-1 space-y-8">
                <div className="flex items-center justify-between">
                    <h2 className="text-4xl font-black text-gray-900">Agenda</h2>
                    <div className="flex items-center bg-white rounded-2xl border border-gray-100 p-1.5 shadow-sm">
                        <button className="p-2 hover:bg-gray-50 rounded-xl"><ChevronLeft size={18} /></button>
                        <button className="px-6 py-2 text-sm font-bold text-dental-600 bg-dental-50 rounded-xl mx-2">Today</button>
                        <button className="p-2 hover:bg-gray-50 rounded-xl"><ChevronRight size={18} /></button>
                    </div>
                </div>

                {/* Calendar Grid Mockup */}
                <div className="premium-card h-[calc(100vh-250px)] overflow-hidden flex flex-col">
                    <div className="grid grid-cols-7 border-b border-gray-50 py-4">
                        {['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'].map(day => (
                            <div key={day} className="text-center text-[10px] font-black text-gray-400 tracking-widest">{day}</div>
                        ))}
                    </div>
                    <div className="flex-1 grid grid-cols-7 grid-rows-5 relative">
                        {Array.from({ length: 35 }).map((_, i) => (
                            <div key={i} className="border-r border-b border-gray-50/50 p-2">
                                <span className={`text-xs font-bold ${i === (new Date().getDate() + 7) ? 'text-dental-600 underline decoration-2' : 'text-gray-300'}`}>{i + 1}</span>
                                {/* Render events if applicable */}
                            </div>
                        ))}
                    </div>
                </div>
            </div>

            {/* Right Sidebar: Missions & Tasks */}
            <div className="w-80 flex flex-col space-y-6">
                <div className="premium-card p-6 bg-gray-900 text-white space-y-4">
                    <div className="flex justify-between items-center text-white/40">
                        <span className="text-[10px] font-black uppercase tracking-widest">Supervisor Missions</span>
                        <Bell size={14} className="animate-pulse" />
                    </div>
                    {tasks.length === 0 ? (
                        <p className="text-xs text-white/30 italic py-4">No active missions from boss.</p>
                    ) : (
                        <div className="space-y-4">
                            {tasks.map(task => (
                                <div key={task.id} className="bg-white/5 border border-white/10 p-4 rounded-2xl group hover:bg-white/10 transition-all cursor-pointer">
                                    <div className="flex justify-between items-start">
                                        <p className="text-xs font-black text-white">{task.title}</p>
                                        <button onClick={() => handleCompleteTask(task.id)}>
                                            <CheckCircle2 size={16} className="text-white/20 group-hover:text-dental-400" />
                                        </button>
                                    </div>
                                    <p className="text-[9px] text-white/40 mt-1 uppercase font-bold">{task.clients?.name || 'Field Duty'}</p>
                                    <p className="text-[10px] text-white/60 mt-2 leading-tight">{task.description}</p>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {/* Priority Sidebar */}
                <div className="flex-1 bg-white rounded-[2.5rem] shadow-sm border border-gray-100 p-6 space-y-6">
                    <div className="flex items-center justify-between">
                        <h3 className="font-bold text-gray-900">Google Events</h3>
                        <button onClick={fetchGoogleEvents} className="text-dental-500"><RefreshCw size={14} /></button>
                    </div>

                    <div className="space-y-4 overflow-y-auto max-h-[300px]">
                        {events.slice(0, 5).map(event => (
                            <div key={event.id} className="flex items-center space-x-3">
                                <div className="w-10 h-10 bg-blue-50 text-blue-600 rounded-xl flex items-center justify-center shrink-0">
                                    <CalendarIcon size={14} />
                                </div>
                                <div className="min-w-0">
                                    <p className="text-xs font-bold text-gray-900 truncate">{event.summary}</p>
                                    <p className="text-[10px] text-gray-400 font-medium uppercase">{new Date(event.start.dateTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>
                                </div>
                            </div>
                        ))}
                    </div>

                    <button
                        onClick={() => setShowAddModal(true)}
                        className="w-full border-2 border-dashed border-gray-100 text-gray-300 py-3 rounded-2xl text-[10px] font-bold uppercase tracking-widest hover:border-dental-200 hover:text-dental-400 transition-all mt-4"
                    >
                        + Schedule Google Event
                    </button>
                </div>
            </div>

            {/* Add Modal */}
            {showAddModal && (
                <div className="fixed inset-0 bg-black/50 z-[2000] flex items-center justify-center p-4">
                    <div className="bg-white w-full max-w-md rounded-3xl p-8 space-y-6 animate-in zoom-in duration-300">
                        <h3 className="text-2xl font-black text-gray-900">Sincronizar Google</h3>
                        <div className="space-y-4">
                            <input type="text" placeholder="Asunto" className="w-full p-4 bg-gray-50 border-none rounded-2xl outline-none focus:ring-2 focus:ring-dental-500" value={newEvent.summary} onChange={(e) => setNewEvent({ ...newEvent, summary: e.target.value })} />
                            <div className="grid grid-cols-2 gap-4">
                                <input type="date" className="p-4 bg-gray-50 border-none rounded-2xl" value={newEvent.date} onChange={(e) => setNewEvent({ ...newEvent, date: e.target.value })} />
                                <input type="time" className="p-4 bg-gray-50 border-none rounded-2xl" value={newEvent.time} onChange={(e) => setNewEvent({ ...newEvent, time: e.target.value })} />
                            </div>
                        </div>
                        <div className="flex space-x-4">
                            <button onClick={() => setShowAddModal(false)} className="flex-1 py-4 font-bold text-gray-400">Cancelar</button>
                            <button onClick={handleCreateEvent} className="flex-1 bg-dental-600 text-white py-4 rounded-2xl font-bold">Confirmar</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default Schedule;
