import React, { useState, useEffect } from 'react';
import { supabase } from '../services/supabase';
import { useUser } from '../contexts/UserContext';
import { Shield, User, Search, CheckCircle, Ban, Edit, Save, AlertTriangle } from 'lucide-react';
import { Profile } from '../contexts/UserContext';

const Settings: React.FC = () => {
    const { profile, isSupervisor, hasPermission } = useUser();
    const [users, setUsers] = useState<Profile[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [editingId, setEditingId] = useState<string | null>(null);
    const [activeTab, setActiveTab] = useState<'users' | 'permissions'>('users');

    // Temporary state for editing users
    const [tempRole, setTempRole] = useState<string>('');
    const [tempStatus, setTempStatus] = useState<string>('');

    // Permissions State
    const [rolePerms, setRolePerms] = useState<Record<string, string[]>>({});
    const [savingPerms, setSavingPerms] = useState(false);

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
        if (data) {
            const matrix: Record<string, string[]> = {};
            data.forEach((p: any) => {
                if (!matrix[p.role]) matrix[p.role] = [];
                matrix[p.role].push(p.permission);
            });
            setRolePerms(matrix);
        } else {
            // Fallback defaults if table empty
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
        if (role === 'manager' && perm === 'MANAGE_PERMISSIONS') return; // Prevent lockout

        setRolePerms(prev => {
            const current = prev[role] || [];
            if (current.includes(perm)) {
                return { ...prev, [role]: current.filter(p => p !== perm) };
            } else {
                return { ...prev, [role]: [...current, perm] };
            }
        });
    };

    const savePermissions = async () => {
        setSavingPerms(true);
        try {
            // DELETE ALL and RE-INSERT (Simple approach for small matrix)
            // Note: In production we might want to do diffing
            const { error: delError } = await supabase.from('role_permissions').delete().neq('id', '00000000-0000-0000-0000-000000000000');
            if (delError) throw delError;

            const toInsert = [];
            for (const [role, perms] of Object.entries(rolePerms)) {
                for (const permission of perms) {
                    toInsert.push({ role, permission });
                }
            }

            const { error: insError } = await supabase.from('role_permissions').insert(toInsert);
            if (insError) throw insError;

            alert('Matriz de permisos actualizada correctamente.');
        } catch (error: any) {
            console.error('Error saving permissions:', error);
            alert('Error al guardar: ' + error.message);
        } finally {
            setSavingPerms(false);
        }
    };

    const fetchUsers = async () => {
        setLoading(true);
        try {
            // Fetch from public schema
            const { data: publicData, error: publicError } = await supabase
                .from('profiles')
                .select('*')
                .order('email');

            // Fetch from crm schema (Explicit fallback/sync)
            const { data: crmData, error: crmError } = await (supabase
                .schema('crm')
                .from('profiles') as any)
                .select('*')
                .order('email');

            if (publicError && crmError) {
                console.error('Error fetching users from both schemas:', { publicError, crmError });
            }

            // Unify and deduplicate by ID
            const unifiedUsersMap = new Map<string, Profile>();

            // Add public data first
            (publicData || []).forEach((u: any) => unifiedUsersMap.set(u.id, u as Profile));

            // Overwrite/Add crm data (usually more up-to-date for management)
            (crmData || []).forEach((u: any) => unifiedUsersMap.set(u.id, u as Profile));

            setUsers(Array.from(unifiedUsersMap.values()).sort((a, b) => (a.email || '').localeCompare(b.email || '')));
        } catch (err) {
            console.error('Unexpected error in fetchUsers:', err);
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
            // Update in crm schema (Preferred for master record)
            const { error: crmError } = await (supabase
                .schema('crm')
                .from('profiles') as any)
                .update({ role: tempRole, status: tempStatus })
                .eq('id', id);

            // Also try to update in public schema (for view cache)
            const { error: publicError } = await supabase
                .from('profiles')
                .update({ role: tempRole, status: tempStatus })
                .eq('id', id);

            if (crmError && publicError) throw crmError || publicError;

            alert('Usuario actualizado correctamente en el sistema.');
            setEditingId(null);
            fetchUsers();
        } catch (error: any) {
            alert('Error al actualizar: ' + error.message);
        }
    };

    if (!profile || (!isSupervisor && !hasPermission('MANAGE_USERS'))) {
        return (
            <div className="flex flex-col items-center justify-center h-full text-gray-500">
                <Shield size={64} className="mb-4 text-red-400" />
                <h2 className="text-2xl font-bold">Acceso Denegado</h2>
                <p>Solo los administradores pueden ver esta página.</p>
            </div>
        );
    }

    const filteredUsers = users.filter(u =>
        (u.email?.toLowerCase() || '').includes(searchTerm.toLowerCase()) ||
        (u.full_name?.toLowerCase() || '').includes(searchTerm.toLowerCase())
    );

    return (
        <div className="max-w-7xl mx-auto space-y-8 pb-20">
            <div className="flex justify-between items-end">
                <div>
                    <h2 className="text-4xl font-black text-gray-900 tracking-tight">Configuración Global</h2>
                    <p className="text-gray-400 font-medium mt-1 text-lg">Control maestro de accesos y permisos</p>
                </div>
                <div className="flex bg-gray-100 p-1.5 rounded-2xl">
                    <button
                        onClick={() => setActiveTab('users')}
                        className={`px-6 py-2.5 rounded-xl font-bold transition-all ${activeTab === 'users' ? 'bg-white text-indigo-600 shadow-sm' : 'text-gray-400 hover:text-gray-600'}`}
                    >
                        Usuarios
                    </button>
                    <button
                        onClick={() => setActiveTab('permissions')}
                        className={`px-6 py-2.5 rounded-xl font-bold transition-all ${activeTab === 'permissions' ? 'bg-white text-indigo-600 shadow-sm' : 'text-gray-400 hover:text-gray-600'}`}
                    >
                        Matriz de Roles
                    </button>
                </div>
            </div>

            {activeTab === 'users' ? (
                <div className="bg-white rounded-[2.5rem] shadow-xl border border-gray-100 overflow-hidden animate-in fade-in duration-300">
                    <div className="p-8 border-b border-gray-100 flex flex-col md:flex-row justify-between items-center gap-4">
                        <h3 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
                            <User className="text-indigo-600" />
                            Usuarios del Sistema
                        </h3>
                        <div className="relative w-full md:w-96">
                            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={20} />
                            <input
                                type="text"
                                placeholder="Buscar por email o nombre..."
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                className="w-full pl-12 pr-4 py-3 bg-gray-50 border-none rounded-xl font-medium focus:ring-2 focus:ring-indigo-500"
                            />
                        </div>
                    </div>

                    <div className="overflow-x-auto">
                        <table className="w-full">
                            <thead className="bg-gray-50">
                                <tr>
                                    <th className="px-8 py-4 text-left text-xs font-black text-gray-400 uppercase tracking-wider">Usuario</th>
                                    <th className="px-8 py-4 text-left text-xs font-black text-gray-400 uppercase tracking-wider">Rol Asignado</th>
                                    <th className="px-8 py-4 text-left text-xs font-black text-gray-400 uppercase tracking-wider">Estado</th>
                                    <th className="px-8 py-4 text-right text-xs font-black text-gray-400 uppercase tracking-wider">Acciones</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100">
                                {loading ? (
                                    <tr><td colSpan={4} className="p-8 text-center text-gray-400">Cargando perfiles...</td></tr>
                                ) : filteredUsers.length === 0 ? (
                                    <tr><td colSpan={4} className="p-8 text-center text-gray-400">No se encontraron usuarios activos.</td></tr>
                                ) : (
                                    filteredUsers.map(user => (
                                        <tr key={user.id} className="hover:bg-gray-50 transition-colors">
                                            <td className="px-8 py-4">
                                                <div className="flex items-center">
                                                    <div className="h-10 w-10 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-700 font-bold mr-3">
                                                        {user.email?.charAt(0).toUpperCase()}
                                                    </div>
                                                    <div>
                                                        <p className="font-bold text-gray-900">{user.email}</p>
                                                        <p className="text-[10px] text-gray-400 font-mono">{user.full_name || 'Sin nombre cargado'}</p>
                                                    </div>
                                                </div>
                                            </td>

                                            <td className="px-8 py-4">
                                                {editingId === user.id ? (
                                                    <select
                                                        value={tempRole}
                                                        onChange={(e) => setTempRole(e.target.value)}
                                                        className="bg-white border border-gray-100 text-gray-900 text-sm rounded-xl focus:ring-2 focus:ring-indigo-500 block w-full p-2.5 font-bold"
                                                    >
                                                        <option value="manager">Manager (Acceso Total)</option>
                                                        <option value="jefe">Jefe (Visualización)</option>
                                                        <option value="administrativo">Administrativo (Carga)</option>
                                                        <option value="seller">Vendedor</option>
                                                        <option value="driver">Repartidor (Driver)</option>
                                                    </select>
                                                ) : (
                                                    <span className={`px-3 py-1 rounded-full text-[10px] font-black uppercase
                                                        ${user.role === 'manager' ? 'bg-indigo-100 text-indigo-700' :
                                                            user.role === 'jefe' ? 'bg-purple-100 text-purple-700' :
                                                                user.role === 'administrativo' ? 'bg-blue-100 text-blue-700' :
                                                                    user.role === 'driver' ? 'bg-amber-100 text-amber-700' :
                                                                        user.role === 'seller' ? 'bg-green-100 text-green-700' :
                                                                            'bg-gray-100 text-gray-600'}`}>
                                                        {user.role === 'manager' ? 'Manager' :
                                                            user.role === 'jefe' ? 'Jefe' :
                                                                user.role === 'administrativo' ? 'Admin Ops' :
                                                                    user.role === 'driver' ? 'Repartidor' :
                                                                        user.role === 'seller' ? 'Vendedor' :
                                                                            user.role || 'Sin Rol'}
                                                    </span>
                                                )}
                                            </td>

                                            <td className="px-8 py-4">
                                                {editingId === user.id ? (
                                                    <select
                                                        value={tempStatus}
                                                        onChange={(e) => setTempStatus(e.target.value)}
                                                        className="bg-white border border-gray-100 text-gray-900 text-sm rounded-xl focus:ring-2 focus:ring-indigo-500 block w-full p-2.5 font-bold"
                                                    >
                                                        <option value="pending">Pendiente</option>
                                                        <option value="active">Activo</option>
                                                        <option value="suspended">Suspendido</option>
                                                    </select>
                                                ) : (
                                                    <div className="flex items-center gap-2">
                                                        {user.status === 'active' ? (
                                                            <><CheckCircle size={14} className="text-green-500" /><span className="text-green-700 font-bold text-xs">Activo</span></>
                                                        ) : (
                                                            <><Ban size={14} className="text-red-400" /><span className="text-red-500 font-bold text-xs">{user.status === 'pending' ? 'Pendiente' : 'Suspendido'}</span></>
                                                        )}
                                                    </div>
                                                )}
                                            </td>

                                            <td className="px-8 py-4 text-right">
                                                {editingId === user.id ? (
                                                    <div className="flex justify-end gap-2">
                                                        <button onClick={() => setEditingId(null)} className="px-4 py-2 text-gray-400 hover:text-gray-600 font-black text-xs uppercase tracking-widest transition-all">Cancelar</button>
                                                        <button onClick={() => handleSave(user.id)} className="px-6 py-2 bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 flex items-center gap-2 font-black text-xs uppercase tracking-widest shadow-lg shadow-indigo-100 transition-all">
                                                            <Save size={14} /> Guardar
                                                        </button>
                                                    </div>
                                                ) : (
                                                    <button
                                                        onClick={() => handleEdit(user)}
                                                        disabled={user.email === 'aterraza@3dental.cl'}
                                                        className="text-indigo-600 hover:text-indigo-800 font-black text-xs uppercase tracking-widest flex items-center justify-end w-full gap-2 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
                                                    >
                                                        <Edit size={14} /> Editar Perfil
                                                    </button>
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
                <div className="animate-in slide-in-from-right-8 duration-300 space-y-8">
                    <div className="bg-white rounded-[2.5rem] shadow-xl border border-gray-100 overflow-hidden">
                        <div className="p-8 border-b border-gray-100 flex justify-between items-center">
                            <div>
                                <h3 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
                                    <Shield className="text-indigo-600" />
                                    Matriz de Permisos por Rol
                                </h3>
                                <p className="text-gray-400 text-sm mt-1">Configuración masiva de accesos para cada nivel jerárquico</p>
                            </div>
                            <button
                                onClick={savePermissions}
                                disabled={savingPerms}
                                className="px-8 py-4 bg-gray-900 text-white rounded-2xl font-black text-xs uppercase tracking-widest flex items-center gap-3 shadow-2xl hover:bg-black transition-all active:scale-95 disabled:opacity-50"
                            >
                                {savingPerms ? 'Guardando...' : <><Save size={18} /> Aplicar a todo el sistema</>}
                            </button>
                        </div>

                        <div className="overflow-x-auto">
                            <table className="w-full text-left border-collapse">
                                <thead className="bg-gray-50/80">
                                    <tr>
                                        <th className="p-8 text-xs font-black text-gray-400 uppercase tracking-widest border-r border-gray-100">Permiso / Módulo</th>
                                        {roles.map(role => (
                                            <th key={role} className="p-4 text-center text-xs font-black text-gray-600 uppercase tracking-widest min-w-[120px]">
                                                {role === 'administrativo' ? 'Admin Ops' : role}
                                            </th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-100">
                                    {permissionList.map(perm => (
                                        <tr key={perm.key} className="hover:bg-gray-50/50 transition-colors">
                                            <td className="p-8 border-r border-gray-100 bg-white sticky left-0 z-10 shadow-sm">
                                                <div className="flex flex-col">
                                                    <span className="font-bold text-gray-900">{perm.label}</span>
                                                    <span className="text-[10px] text-gray-400 font-medium leading-relaxed max-w-[200px]">{perm.desc}</span>
                                                </div>
                                            </td>
                                            {roles.map(role => {
                                                const isEnabled = (rolePerms[role] || []).includes(perm.key);
                                                const isLocked = role === 'manager' && perm.key === 'MANAGE_PERMISSIONS';

                                                return (
                                                    <td key={`${role}-${perm.key}`} className="p-4 text-center">
                                                        <button
                                                            onClick={() => togglePermission(role, perm.key)}
                                                            disabled={isLocked}
                                                            className={`w-12 h-12 rounded-2xl flex items-center justify-center mx-auto transition-all ${isEnabled
                                                                ? 'bg-emerald-50 text-emerald-600 ring-2 ring-emerald-100 ring-offset-2'
                                                                : 'bg-gray-50 text-gray-300 hover:bg-gray-100'
                                                                } ${isLocked ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer active:scale-90'}`}
                                                        >
                                                            {isEnabled ? <CheckCircle size={24} /> : <Ban size={24} />}
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

                    <div className="bg-amber-50 rounded-3xl p-6 border border-amber-100 flex items-start gap-4">
                        <AlertTriangle className="text-amber-500 shrink-0 mt-1" size={24} />
                        <div>
                            <p className="font-bold text-amber-900">Nota de Seguridad</p>
                            <p className="text-amber-700 text-sm mt-1">Los cambios aplicados aquí afectan a todos los usuarios actuales y futuros con el rol seleccionado. El rol de <b>Manager</b> tiene protección contra bloqueo de permisos críticos para asegurar el acceso administrativo.</p>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default Settings;
