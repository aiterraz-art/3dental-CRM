import React, { useState, useEffect } from 'react';
import { supabase } from '../services/supabase';
import { useUser } from '../contexts/UserContext';
import { Shield, User, Search, CheckCircle, Ban, Edit, Save, AlertTriangle, Trash2 } from 'lucide-react';
import { Profile } from '../contexts/UserContext';

const Settings: React.FC = () => {
    const { profile, isSupervisor, hasPermission } = useUser();
    const [users, setUsers] = useState<Profile[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [editingId, setEditingId] = useState<string | null>(null);
    const [activeTab, setActiveTab] = useState<'users' | 'permissions'>('users');

    const [tempRole, setTempRole] = useState<string>('');
    const [tempStatus, setTempStatus] = useState<string>('');
    const [rolePerms, setRolePerms] = useState<Record<string, string[]>>({});
    const [savingPerms, setSavingPerms] = useState(false);

    const [isInviteModalOpen, setIsInviteModalOpen] = useState(false);
    const [sendingInvite, setSendingInvite] = useState(false);
    const [inviteData, setInviteData] = useState({ email: '', full_name: '', role: 'seller' });

    const roles = ['manager', 'jefe', 'administrativo', 'seller', 'driver'];
    const permissionList = [
        { key: 'UPLOAD_EXCEL', label: 'Cargar Excel', desc: 'Permite subir archivos de inventario, precios y despacho.' },
        { key: 'MANAGE_INVENTORY', label: 'Gestión Inventario', desc: 'Crear, editar y eliminar productos.' },
        { key: 'MANAGE_PRICING', label: 'Modificar Precios', desc: 'Cambiar precios de venta.' },
        { key: 'VIEW_METAS', label: 'Ver Metas', desc: 'Visualizar indicadores de venta y facturación.' },
        { key: 'MANAGE_METAS', label: 'Configurar Metas', desc: 'Asignar objetivos comerciales a vendedores.' },
        { key: 'MANAGE_DISPATCH', label: 'Gestionar Despacho', desc: 'Crear y asignar rutas de transporte.' },
        { key: 'EXECUTE_DELIVERY', label: 'Realizar Entregas', desc: 'Módulo de repartidor para completar pedidos.' },
        { key: 'MANAGE_USERS', label: 'Gestionar Usuarios', desc: 'Editar roles y estados de perfiles.' },
        { key: 'MANAGE_PERMISSIONS', label: 'Matriz Permisos', desc: 'Configurar los accesos de cada rol.' },
        { key: 'VIEW_ALL_CLIENTS', label: 'Ver Todos Clientes', desc: 'Acceso a la cartera total de clientes (vs solo propios).' },
        { key: 'MANAGE_CLIENTS', label: 'Gestionar Clientes', desc: 'Editar, eliminar y crear fichas de clientes.' },
        { key: 'IMPORT_CLIENTS', label: 'Importar Clientes', desc: 'Subida masiva de clientes vía CSV.' },
        { key: 'VIEW_TEAM_STATS', label: 'Panel Equipo', desc: 'Acceso a estadísticas y supervisión de representantes.' },
        { key: 'VIEW_ALL_TEAM_STATS', label: 'Ver Todo el Equipo', desc: 'Supervisión global (vs solo subordinados directos).' }
    ];

    useEffect(() => {
        fetchUsers();
        fetchRolePermissions();
    }, []);

    const fetchRolePermissions = async () => {
        const { data } = await supabase.from('role_permissions').select('*');
        if (data && data.length > 0) {
            const matrix: Record<string, string[]> = {};
            data.forEach((p: any) => {
                if (!matrix[p.role]) matrix[p.role] = [];
                matrix[p.role].push(p.permission);
            });
            setRolePerms(matrix);
        } else {
            setRolePerms({
                'manager': permissionList.map(p => p.key),
                'jefe': ['MANAGE_INVENTORY', 'VIEW_METAS', 'MANAGE_DISPATCH', 'VIEW_ALL_CLIENTS', 'VIEW_TEAM_STATS'],
                'administrativo': ['UPLOAD_EXCEL', 'MANAGE_INVENTORY', 'MANAGE_PRICING', 'MANAGE_DISPATCH'],
                'seller': ['VIEW_METAS'],
                'driver': ['EXECUTE_DELIVERY']
            });
        }
    };

    const togglePermission = (role: string, perm: string) => {
        if (role === 'manager' && perm === 'MANAGE_PERMISSIONS') return;
        setRolePerms(prev => {
            const current = prev[role] || [];
            return current.includes(perm) ? { ...prev, [role]: current.filter(p => p !== perm) } : { ...prev, [role]: [...current, perm] };
        });
    };

    const savePermissions = async () => {
        setSavingPerms(true);
        try {
            await supabase.from('role_permissions').delete().neq('role', 'none');
            const toInsert = [];
            for (const [role, perms] of Object.entries(rolePerms)) {
                for (const permission of perms) toInsert.push({ role, permission });
            }
            const { error } = await supabase.from('role_permissions').insert(toInsert);
            if (error) throw error;
            alert('Matriz de permisos actualizada.');
        } catch (error: any) {
            alert('Error al guardar: ' + error.message);
        } finally {
            setSavingPerms(false);
        }
    };

    const fetchUsers = async () => {
        setLoading(true);
        try {
            const { data: publicData } = await supabase.from('profiles').select('*').order('email');
            let crmData = [];
            try {
                const { data } = await (supabase.schema('crm').from('profiles') as any).select('*').order('email');
                if (data) crmData = data;
            } catch (e) { }

            const unifiedUsersMap = new Map<string, Profile>();
            (publicData || []).forEach((u: any) => unifiedUsersMap.set(u.id, u as Profile));
            (crmData || []).forEach((u: any) => unifiedUsersMap.set(u.id, u as Profile));

            setUsers(Array.from(unifiedUsersMap.values()).sort((a, b) => (a.email || '').localeCompare(b.email || '')));
        } catch (err) {
            console.error('fetchUsers error:', err);
        } finally {
            setLoading(false);
        }
    };

    const handleEdit = (user: Profile) => {
        if (user.email === 'aterraza@3dental.cl') {
            alert("No se puede editar al Super Admin.");
            return;
        }
        setEditingId(user.id);
        setTempRole(user.role || 'seller');
        setTempStatus(user.status || 'pending');
    };

    const handleSave = async (id: string) => {
        try {
            const { error: pubError } = await supabase.from('profiles').update({ role: tempRole, status: tempStatus }).eq('id', id);
            try {
                await (supabase.schema('crm').from('profiles') as any).update({ role: tempRole, status: tempStatus }).eq('id', id);
            } catch (e) { }

            if (pubError) throw pubError;
            alert('Usuario actualizado.');
            setEditingId(null);
            fetchUsers();
        } catch (error: any) {
            alert('Error: ' + error.message);
        }
    };

    const handleInviteUser = async (e: React.FormEvent) => {
        e.preventDefault();
        setSendingInvite(true);
        try {
            const { data: existing } = await supabase.from('profiles').select('id').eq('email', inviteData.email).maybeSingle();
            if (existing) {
                alert("Este usuario ya existe.");
                return;
            }

            const newId = crypto.randomUUID();
            const profileData = { id: newId, email: inviteData.email.toLowerCase(), full_name: inviteData.full_name, role: inviteData.role, status: 'active' };

            const { error: pubErr } = await supabase.from('profiles').insert(profileData);
            try {
                await (supabase.schema('crm').from('profiles') as any).insert(profileData);
            } catch (e) { }

            if (pubErr) throw pubErr;

            const { data: { session } } = await supabase.auth.getSession();
            if (session?.provider_token) {
                const subject = "Bienvenido a 3dental CRM 🏥";
                const message = `Hola ${inviteData.full_name},\n\nSe te ha dado acceso con el rol de ${inviteData.role.toUpperCase()}.\n\nEnlace: https://3dental-crm.vercel.app/`;
                const rawMime = [`From: ${session.user.email}`, `To: ${inviteData.email}`, `Subject: =?utf-8?B?${btoa(unescape(encodeURIComponent(subject)))}?=`, 'MIME-Version: 1.0', 'Content-Type: text/plain; charset="UTF-8"', '', message].join('\r\n');
                const encoded = btoa(unescape(encodeURIComponent(rawMime))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
                await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', { method: 'POST', headers: { 'Authorization': `Bearer ${session.provider_token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ raw: encoded }) });
            }

            alert('Invitación enviada.');
            setIsInviteModalOpen(false);
            setInviteData({ email: '', full_name: '', role: 'seller' });
            fetchUsers();
        } catch (error: any) {
            alert('Error: ' + error.message);
        } finally {
            setSendingInvite(false);
        }
    };

    const handleDeleteUser = async (id: string, email: string) => {
        if (email === 'aterraza@3dental.cl') {
            alert("No es posible borrar al Super Admin.");
            return;
        }

        if (!window.confirm(`¿Estás seguro de eliminar permanentemente a ${email}? Se borrarán todas sus visitas y desvincularán sus clientes.`)) {
            return;
        }

        try {
            // 1. Unbind from clients (created_by)
            await supabase.from('clients').update({ created_by: null }).eq('created_by', id);

            // 2. Clear activity records by this user
            await supabase.from('visits').delete().eq('sales_rep_id', id);
            await supabase.from('quotations').update({ seller_id: null }).eq('seller_id', id);
            await supabase.from('delivery_routes').update({ driver_id: null }).eq('driver_id', id);

            // 3. Clear Task assignments
            await supabase.from('tasks').delete().eq('assigned_to', id);
            await supabase.from('tasks').delete().eq('assigned_by', id);

            // 4. Delete Meta configurations
            await supabase.from('meta_config').delete().eq('id', id);

            // 5. Delete from public schema
            const { error: pubErr } = await supabase.from('profiles').delete().eq('id', id);

            // 6. Delete from crm schema silently
            try {
                await (supabase.schema('crm').from('profiles') as any).delete().eq('id', id);
            } catch (e) { }

            if (pubErr) throw pubErr;

            alert('Usuario eliminado con éxito de todos los registros.');
            fetchUsers();
        } catch (error: any) {
            console.error('Delete error:', error);
            alert('Error al eliminar: ' + (error.message || 'Existen restricciones de base de datos pendientes.'));
        }
    };

    if (!profile || (!isSupervisor && !hasPermission('MANAGE_USERS'))) return <div className="p-20 text-center text-gray-400 font-bold shrink-0 grow h-full flex flex-col items-center justify-center">Acceso Denegado</div>;

    const filteredUsers = users.filter(u => (u.email?.toLowerCase() || '').includes(searchTerm.toLowerCase()) || (u.full_name?.toLowerCase() || '').includes(searchTerm.toLowerCase()));

    return (
        <div className="max-w-7xl mx-auto space-y-8 pb-20">
            <div className="flex justify-between items-end">
                <div>
                    <h2 className="text-4xl font-black text-gray-900 tracking-tight">Configuración Global</h2>
                    <p className="text-gray-400 font-medium mt-1 text-lg">Control maestro de accesos y permisos</p>
                </div>
                <div className="flex bg-gray-100 p-1.5 rounded-2xl">
                    <button onClick={() => setActiveTab('users')} className={`px-6 py-2.5 rounded-xl font-bold transition-all ${activeTab === 'users' ? 'bg-white text-indigo-600 shadow-sm' : 'text-gray-400 hover:text-gray-600'}`}>Usuarios</button>
                    <button onClick={() => setActiveTab('permissions')} className={`px-6 py-2.5 rounded-xl font-bold transition-all ${activeTab === 'permissions' ? 'bg-white text-indigo-600 shadow-sm' : 'text-gray-400 hover:text-gray-600'}`}>Roles</button>
                    <button onClick={() => setIsInviteModalOpen(true)} className="ml-4 px-6 py-2.5 bg-gray-900 text-white rounded-xl font-bold hover:bg-black transition-all shadow-lg flex items-center gap-2"><User size={16} /> Invitar</button>
                </div>
            </div>

            {activeTab === 'users' ? (
                <div className="bg-white rounded-[2.5rem] shadow-xl border border-gray-100 overflow-hidden">
                    <div className="p-8 border-b border-gray-100 flex justify-between items-center bg-white/50 backdrop-blur-md sticky top-0 z-20">
                        <h3 className="text-2xl font-black text-gray-800 flex items-center gap-3"><User className="text-indigo-600" /> Miembros del Equipo</h3>
                        <div className="relative w-96">
                            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={20} />
                            <input type="text" placeholder="Buscar por email o nombre..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="w-full pl-12 pr-4 py-3 bg-gray-50 border-none rounded-xl font-medium focus:ring-2 focus:ring-indigo-500 shadow-inner" />
                        </div>
                    </div>

                    <div className="overflow-x-auto">
                        <table className="w-full">
                            <thead className="bg-gray-50/50">
                                <tr>
                                    <th className="px-8 py-4 text-left text-xs font-black text-gray-400 uppercase tracking-widest">Perfil</th>
                                    <th className="px-8 py-4 text-left text-xs font-black text-gray-400 uppercase tracking-widest">Rol</th>
                                    <th className="px-8 py-4 text-left text-xs font-black text-gray-400 uppercase tracking-widest">Estado</th>
                                    <th className="px-8 py-4 text-right text-xs font-black text-gray-400 uppercase tracking-widest">Acciones</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100">
                                {loading ? (
                                    <tr><td colSpan={4} className="p-20 text-center text-gray-400 font-bold uppercase tracking-widest animate-pulse">Sincronizando...</td></tr>
                                ) : filteredUsers.length === 0 ? (
                                    <tr><td colSpan={4} className="p-20 text-center text-gray-400 font-bold">Sin resultados.</td></tr>
                                ) : (
                                    filteredUsers.map(user => (
                                        <tr key={user.id} className="hover:bg-gray-50/50 transition-colors group">
                                            <td className="px-8 py-6">
                                                <div className="flex items-center gap-4">
                                                    <div className="h-12 w-12 rounded-2xl bg-indigo-100 flex items-center justify-center text-indigo-700 font-black text-xl shadow-inner group-hover:scale-110 transition-all">{user.email?.charAt(0).toUpperCase()}</div>
                                                    <div>
                                                        <p className="font-black text-gray-900 leading-tight">{user.email}</p>
                                                        <p className="text-xs text-gray-400 font-bold mt-0.5">{user.full_name || 'Nombre no definido'}</p>
                                                    </div>
                                                </div>
                                            </td>
                                            <td className="px-8 py-6">
                                                {editingId === user.id ? (
                                                    <select value={tempRole} onChange={(e) => setTempRole(e.target.value)} className="bg-gray-50 border-none text-gray-900 text-sm rounded-xl focus:ring-2 focus:ring-indigo-500 block w-full p-3 font-bold shadow-sm">
                                                        {roles.map(r => <option key={r} value={r}>{r.charAt(0).toUpperCase() + r.slice(1)}</option>)}
                                                    </select>
                                                ) : (
                                                    <span className={`px-4 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-widest shadow-sm ${user.role === 'manager' ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-600'}`}>{user.role || 'Sin Rol'}</span>
                                                )}
                                            </td>
                                            <td className="px-8 py-6">
                                                {editingId === user.id ? (
                                                    <select value={tempStatus} onChange={(e) => setTempStatus(e.target.value)} className="bg-gray-50 border-none text-gray-900 text-sm rounded-xl focus:ring-2 focus:ring-indigo-500 block w-full p-3 font-bold shadow-sm">
                                                        <option value="pending">Pendiente</option>
                                                        <option value="active">Activo</option>
                                                        <option value="suspended">Suspendido</option>
                                                    </select>
                                                ) : (
                                                    <div className="flex items-center gap-2">
                                                        <div className={`h-2 w-2 rounded-full ${user.status === 'active' ? 'bg-emerald-500 animate-pulse' : 'bg-rose-500'}`}></div>
                                                        <span className={`font-black text-[10px] uppercase tracking-widest ${user.status === 'active' ? 'text-emerald-700' : 'text-rose-700'}`}>{user.status || 'Pendiente'}</span>
                                                    </div>
                                                )}
                                            </td>
                                            <td className="px-8 py-6 text-right">
                                                {editingId === user.id ? (
                                                    <div className="flex justify-end gap-3">
                                                        <button onClick={() => setEditingId(null)} className="px-4 py-2 text-gray-400 hover:text-gray-600 font-black text-[10px] uppercase tracking-widest">Cancelar</button>
                                                        <button onClick={() => handleSave(user.id)} className="px-6 py-2 bg-indigo-600 text-white rounded-xl font-black text-[10px] uppercase tracking-widest shadow-lg shadow-indigo-100 flex items-center gap-2 hover:bg-indigo-700 active:scale-95 transition-all"><Save size={14} /> Guardar</button>
                                                    </div>
                                                ) : (
                                                    <div className="flex justify-end items-center gap-6">
                                                        <button onClick={() => handleDeleteUser(user.id, user.email || '')} disabled={user.email === 'aterraza@3dental.cl'} className="text-gray-300 hover:text-rose-500 transition-all disabled:opacity-0 hover:scale-125"><Trash2 size={18} /></button>
                                                        <button onClick={() => handleEdit(user)} disabled={user.email === 'aterraza@3dental.cl'} className="text-indigo-600 hover:text-indigo-800 font-black text-[10px] uppercase tracking-widest group-hover:translate-x-[-4px] transition-all flex items-center gap-2 disabled:opacity-20"><Edit size={14} /> Editar</button>
                                                    </div>
                                                )}
                                            </td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            ) : (
                <div className="space-y-8 animate-in slide-in-from-bottom-8 duration-500">
                    <div className="bg-white rounded-[2.5rem] shadow-xl border border-gray-100 overflow-hidden">
                        <div className="p-10 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">
                            <div>
                                <h3 className="text-3xl font-black text-gray-900 flex items-center gap-3"><Shield className="text-indigo-600" /> Permisos Maestros</h3>
                                <p className="text-gray-400 font-medium mt-1">Configura el ADN de cada rol en el sistema</p>
                            </div>
                            <button onClick={savePermissions} disabled={savingPerms} className="px-10 py-5 bg-gray-900 text-white rounded-2xl font-black text-xs uppercase tracking-widest shadow-2xl hover:bg-black active:scale-95 transition-all disabled:opacity-50 flex items-center gap-3"><Save size={20} /> Guardar Cambios</button>
                        </div>
                        <div className="overflow-x-auto">
                            <table className="w-full text-left">
                                <thead className="bg-white">
                                    <tr>
                                        <th className="p-10 text-[10px] font-black text-gray-400 uppercase tracking-widest border-r border-gray-100 sticky left-0 z-10 bg-white">Módulo / Permiso</th>
                                        {roles.map(r => <th key={r} className="p-6 text-center text-[10px] font-black text-gray-900 uppercase tracking-widest min-w-[140px]">{r}</th>)}
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-100">
                                    {permissionList.map(p => (
                                        <tr key={p.key} className="hover:bg-gray-50/30 transition-colors">
                                            <td className="p-10 border-r border-gray-100 bg-white sticky left-0 z-10 shadow-sm">
                                                <p className="font-black text-gray-900 text-sm leading-none">{p.label}</p>
                                                <p className="text-[10px] text-gray-400 mt-1.5 font-medium leading-relaxed max-w-[200px]">{p.desc}</p>
                                            </td>
                                            {roles.map(r => {
                                                const active = (rolePerms[r] || []).includes(p.key);
                                                const locked = r === 'manager' && p.key === 'MANAGE_PERMISSIONS';
                                                return (
                                                    <td key={`${r}-${p.key}`} className="p-6 text-center">
                                                        <button onClick={() => togglePermission(r, p.key)} disabled={locked} className={`w-14 h-14 rounded-2xl mx-auto flex items-center justify-center transition-all ${active ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-200 ring-4 ring-indigo-50' : 'bg-gray-50 text-gray-200 hover:bg-gray-100'} ${locked ? 'opacity-30' : 'active:scale-90 hover:scale-105'}`}>
                                                            {active ? <CheckCircle size={28} /> : <Ban size={28} />}
                                                        </button>
                                                    </td>
                                                );
                                            })}
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            )}

            {isInviteModalOpen && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 backdrop-blur-md bg-black/40 animate-in fade-in duration-300">
                    <div className="bg-white rounded-[3rem] w-full max-w-xl p-12 shadow-2xl relative animate-in zoom-in-95 duration-300 border border-gray-100">
                        <h3 className="text-4xl font-black text-gray-900 mb-2">Crear Invitación</h3>
                        <p className="text-gray-400 font-bold mb-10 text-lg leading-snug">Pre-registra al nuevo miembro y dale la bienvenida oficial.</p>
                        <form onSubmit={handleInviteUser} className="space-y-8">
                            <div className="space-y-3">
                                <label className="text-[11px] font-black text-gray-400 uppercase tracking-[0.2em] ml-2">Nombre y Apellido</label>
                                <input required type="text" value={inviteData.full_name} onChange={e => setInviteData(p => ({ ...p, full_name: e.target.value }))} className="w-full h-16 px-8 bg-gray-50 border-none rounded-2xl font-black text-gray-900 focus:ring-4 focus:ring-indigo-100 transition-all placeholder:text-gray-300" placeholder="Andrés Pereira" />
                            </div>
                            <div className="space-y-3">
                                <label className="text-[11px] font-black text-gray-400 uppercase tracking-[0.2em] ml-2">Email Corporativo</label>
                                <input required type="email" value={inviteData.email} onChange={e => setInviteData(p => ({ ...p, email: e.target.value.toLowerCase() }))} className="w-full h-16 px-8 bg-gray-50 border-none rounded-2xl font-black text-gray-900 focus:ring-4 focus:ring-indigo-100 transition-all placeholder:text-gray-300" placeholder="apereira@3dental.cl" />
                            </div>
                            <div className="space-y-3">
                                <label className="text-[11px] font-black text-gray-400 uppercase tracking-[0.2em] ml-2">Rol de Acceso</label>
                                <select value={inviteData.role} onChange={e => setInviteData(p => ({ ...p, role: e.target.value }))} className="w-full h-16 px-8 bg-gray-50 border-none rounded-2xl font-black text-gray-900 focus:ring-4 focus:ring-indigo-100 transition-all appearance-none cursor-pointer">
                                    {roles.map(r => <option key={r} value={r}>{r.toUpperCase()}</option>)}
                                </select>
                            </div>
                            <div className="flex gap-4 pt-6">
                                <button type="button" onClick={() => setIsInviteModalOpen(false)} disabled={sendingInvite} className="flex-1 h-16 text-gray-400 font-black uppercase tracking-widest text-xs hover:text-gray-600 transition-all">Cancelar</button>
                                <button type="submit" disabled={sendingInvite} className="flex-[2] h-16 bg-gray-900 text-white rounded-2xl font-black uppercase tracking-widest text-xs shadow-2xl hover:bg-black active:scale-95 transition-all disabled:opacity-50">{sendingInvite ? 'Enviando...' : 'Generar Invitación'}</button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
};

export default Settings;
